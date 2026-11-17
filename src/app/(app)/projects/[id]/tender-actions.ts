"use server";

/**
 * Recording what each tenderer priced — §1.4 (D1.3), §5.2, §7.4.
 *
 * ── Every figure crosses the same reader the bill's do ─────────────────────────────────────
 *
 * `readRate` refuses "1,234" rather than guessing, because a thousands separator to one reader is a
 * decimal comma to another and the two readings are a factor of a thousand apart. A tender rate is
 * not exempt from that — it is arguably the figure where it matters most, since a rate a thousand
 * times too small wins an award. So this uses the same reader, produces the same refusals, and the
 * screen shows them the same way.
 *
 * ── A rate is written, an amount never is ──────────────────────────────────────────────────
 *
 * `round(bill.output_quantity × rate)` happens in `tender_prices_extend`, at §5.2's single rounding
 * point, against the quantity the signature froze. Nothing here multiplies anything, for the same
 * reason nothing in `bill-actions.ts` does.
 */

import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth";
import { db } from "@/db/client";
import { runItems, runs, tenderPrices, tenderReturns } from "@/db/schema";
import { readAmount, readRate } from "@/domain/amount";

export type TenderAction = { ok: true } | { ok: false; reason: string };

/**
 * The signed bill a return must belong to, and the guard every action here starts with.
 *
 * Two things are checked together on purpose: that the return is this project's, and that the bill
 * behind it is still the signed one. A tender priced against an issue of the bill that has since
 * been superseded is not editable — a revision is a new invitation, not a correction to an old one.
 */
async function openReturn(projectId: string, returnId: string) {
  const [entry] = await db
    .select({ id: tenderReturns.id, billRunId: tenderReturns.billRunId })
    .from(tenderReturns)
    .where(
      and(
        eq(tenderReturns.id, returnId),
        eq(tenderReturns.projectId, projectId),
        isNull(tenderReturns.deletedAt),
      ),
    );

  if (!entry) return { entry: null, reason: "That tender is not on this project." } as const;
  return { entry, reason: "" } as const;
}

/**
 * The signed bill of this project's bill step — what a tender is invited on.
 *
 * `signed_at is not null` is in the where clause rather than checked after, the same sentence
 * `loadSignedBill` carries: a project mid revision has a draft as its newest run, and a tender
 * invited on an unapproved schedule is precisely what the chain exists to prevent.
 */
async function signedBillRun(projectId: string): Promise<string | null> {
  const [run] = await db
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(
        eq(runs.projectId, projectId),
        eq(runs.module, "/bill"),
        isNotNull(runs.signedAt),
        isNull(runs.deletedAt),
      ),
    )
    .orderBy(desc(runs.signedAt))
    .limit(1);

  return run?.id ?? null;
}

export async function addTenderer(projectId: string, name: string): Promise<TenderAction> {
  const session = await requireSession();

  const tenderer = name.trim();
  if (tenderer === "") return { ok: false, reason: "A tender needs the tenderer's name on it." };

  const billRunId = await signedBillRun(projectId);
  if (!billRunId) {
    return {
      ok: false,
      reason:
        "There is no signed bill to price against. A tender is invited on a schedule, and the schedule is the bill.",
    };
  }

  const existing = await db
    .select({ tenderer: tenderReturns.tenderer })
    .from(tenderReturns)
    .where(
      and(
        eq(tenderReturns.projectId, projectId),
        eq(tenderReturns.billRunId, billRunId),
        isNull(tenderReturns.deletedAt),
      ),
    );

  // Two columns with one name is a comparison nobody can read, and the likeliest cause is a second
  // click rather than a second tenderer.
  if (existing.some((e) => e.tenderer.toLowerCase() === tenderer.toLowerCase())) {
    return { ok: false, reason: `${tenderer} is already in this comparison.` };
  }

  await db.insert(tenderReturns).values({
    projectId,
    billRunId,
    tenderer,
    createdBy: session.email,
  });

  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true };
}

/**
 * Withdraw a tender from the comparison. Soft, like every other withdrawal here.
 *
 * A tender that was received and then excluded — late, non-responsive, withdrawn by the contractor
 * — is a fact about the adjudication, and deleting the row would leave a recommendation nobody can
 * reconstruct. It leaves the comparison; it does not leave the record.
 */
export async function withdrawTender(projectId: string, returnId: string): Promise<TenderAction> {
  const { entry, reason } = await openReturn(projectId, returnId);
  if (!entry) return { ok: false, reason };

  await db
    .update(tenderReturns)
    .set({ deletedAt: new Date() })
    .where(eq(tenderReturns.id, returnId));

  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true };
}

/** What the tenderer wrote on the form. Uncorrected, and the thing the arithmetic check is against. */
export async function setStatedSum(
  projectId: string,
  returnId: string,
  typed: string,
): Promise<TenderAction> {
  const { entry, reason } = await openReturn(projectId, returnId);
  if (!entry) return { ok: false, reason };

  const value = typed.trim();

  if (value === "") {
    await db.update(tenderReturns).set({ statedSum: null }).where(eq(tenderReturns.id, returnId));
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true };
  }

  const reading = readAmount(value);
  if (!reading.ok) return { ok: false, reason: reading.reason };

  await db
    .update(tenderReturns)
    .set({ statedSum: reading.amount })
    .where(eq(tenderReturns.id, returnId));

  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true };
}

/**
 * One tenderer's rate against one bill item.
 *
 * An empty cell **deletes the price** rather than storing a null rate, because "not quoted" is the
 * absence of a row and the comparison counts it that way. Storing a null would make an unpriced
 * item and a cleared one two different states that read identically.
 */
export async function setTenderPrice(
  projectId: string,
  returnId: string,
  itemId: string,
  typed: string,
): Promise<TenderAction> {
  const { entry, reason } = await openReturn(projectId, returnId);
  if (!entry) return { ok: false, reason };

  // The item must belong to the bill this tender was invited on. Without this, a price could be
  // written against another project's row by anybody who could guess a uuid.
  const [item] = await db
    .select({ id: runItems.id })
    .from(runItems)
    .where(and(eq(runItems.id, itemId), eq(runItems.runId, entry.billRunId)));

  if (!item) return { ok: false, reason: "That item is not in the bill this tender was invited on." };

  const value = typed.trim();

  if (value === "") {
    await db
      .delete(tenderPrices)
      .where(and(eq(tenderPrices.returnId, returnId), eq(tenderPrices.itemId, itemId)));

    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true };
  }

  const reading = readRate(value);
  if (!reading.ok) return { ok: false, reason: reading.reason };

  await db
    .insert(tenderPrices)
    .values({
      returnId,
      itemId,
      rate: reading.rate.value,
      ratePrecision: reading.rate.precision,
    })
    .onConflictDoUpdate({
      target: [tenderPrices.returnId, tenderPrices.itemId],
      set: { rate: reading.rate.value, ratePrecision: reading.rate.precision, updatedAt: new Date() },
    });

  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true };
}

/**
 * A column of rates, pasted straight out of a tenderer's spreadsheet — §7.4.
 *
 * The bill's own grid makes this non-negotiable — *"if a QS can't paste a column from Excel, they
 * won't use the product"* — and a tender return is the case where it matters most: the rates arrive
 * as a spreadsheet, from somebody else, and typing four hundred of them by hand to compare five
 * tenders is the reason this work does not get done properly.
 *
 * A figure that cannot be read does not stop the paste. It is reported and skipped, so a column
 * with one bad cell in it lands and the QS is told which cell to look at, rather than losing the
 * other three hundred and ninety-nine.
 */
export async function pasteTenderColumn(
  projectId: string,
  returnId: string,
  itemIds: readonly string[],
  block: string,
): Promise<TenderAction & { written?: number; skipped?: string[] }> {
  const { entry, reason } = await openReturn(projectId, returnId);
  if (!entry) return { ok: false, reason };

  const lines = block
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.split("\t")[0].trim());

  // Only rows that are in this bill, in the order the screen shows them.
  const rows = await db
    .select({ id: runItems.id })
    .from(runItems)
    .where(and(eq(runItems.runId, entry.billRunId), inArray(runItems.id, [...itemIds])));

  const known = new Set(rows.map((r) => r.id));
  const targets = itemIds.filter((id) => known.has(id));

  const skipped: string[] = [];
  let written = 0;

  for (let i = 0; i < lines.length && i < targets.length; i += 1) {
    const cell = lines[i];
    if (cell === "") continue;

    const parsed = readRate(cell);
    if (!parsed.ok) {
      skipped.push(cell);
      continue;
    }

    await db
      .insert(tenderPrices)
      .values({
        returnId,
        itemId: targets[i],
        rate: parsed.rate.value,
        ratePrecision: parsed.rate.precision,
      })
      .onConflictDoUpdate({
        target: [tenderPrices.returnId, tenderPrices.itemId],
        set: { rate: parsed.rate.value, ratePrecision: parsed.rate.precision, updatedAt: new Date() },
      });

    written += 1;
  }

  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true, written, skipped };
}
