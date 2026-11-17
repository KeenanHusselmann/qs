"use server";

/**
 * Correcting a bill, and signing it — PLATFORM.md §1.3.1, §1.3.3, §5, §7.4.
 *
 * ── The same three acts as a field run, over rows ──────────────────────────────────────────
 *
 * A run proposes, a person corrects, a signature freezes. What a bill adds is the two things a fixed
 * field set never had to answer (§1.3.3): a QS will **add** a row the agent did not propose, and a
 * QS will **strike** one it did. The first is a row with no `proposed_*` at all — pure override,
 * with a person as its source. The second is emphatically not a delete: `proposed` is the record of
 * what the machine said, and losing it loses the thing that makes the bill reviewable.
 *
 * ── There is no reason box, and that is a decision ─────────────────────────────────────────
 *
 * The field table asks for a reason beside a correction, because ten figures at a time is a pace
 * where a sentence is worth typing. A bill is four hundred cells and §7.4 requires that a column be
 * pastable straight out of Excel — nobody annotates four hundred cells, and a reason box that is
 * always empty is a record of nothing. What is recorded instead is stronger: **who** and **when** on
 * the row, and `quantity_source` saying whether the figure was typed or pasted (§6.3), which a
 * reason field could never have told anybody.
 *
 * ── The acts are here; the writing is in `bill-writes.ts` ─────────────────────────────────
 *
 * §4.8's pricing screen writes the same rows through the same rules, and a `"use server"` module
 * cannot lend a helper to another one — every one of its exports is a server action reachable from
 * a browser. So `openBill`, `cellWrite` and `writeOverrides` sit in a plain module both action
 * files import, and there is one implementation of what a correction is.
 */

import { and, asc, eq, sql } from "drizzle-orm";
import { after } from "next/server";
import { toldSignedOff } from "@/lib/notifications";
import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { db } from "@/db/client";
import { runItems, runs } from "@/db/schema";
import { blockingRows, EDITABLE_CELLS, workingRow, type EditableCell } from "@/lib/agent/bill";
import { cellWrite, draftBillFor, openBill, writeOverrides, type BillAction } from "@/lib/agent/bill-writes";
import { loadLatestBill, nextSeq, SEQ_STEP } from "@/lib/agent/persist-bill";

/**
 * One cell, corrected.
 *
 * The agent's proposal stays exactly where it was — that is the point of there being two maps — and
 * the amount follows by itself, because the database recomputes `round(quantity × rate)` on the way
 * in. Nothing here multiplies anything.
 */
export async function correctCell(
  projectId: string,
  runId: string,
  itemId: string,
  cell: EditableCell,
  value: string,
): Promise<BillAction> {
  const session = await requireSession();

  const { run, reason } = await openBill(projectId, runId);
  if (!run) return { ok: false, reason };

  const [item] = await db
    .select({
      id: runItems.id,
      rowType: runItems.rowType,
      runId: runItems.runId,
      unit: sql<string | null>`coalesce(${runItems.overrideUnit}, ${runItems.proposedUnit})`,
    })
    .from(runItems)
    .where(eq(runItems.id, itemId))
    .limit(1);

  if (!item || item.runId !== runId) return { ok: false, reason: "That row is not part of this bill." };

  // §4.7 — a heading is a grouping, and a heading carrying a quantity is a bug. The database says so
  // too; this is the sentence that arrives before the stack trace would.
  if (item.rowType !== "item" && cell !== "description") {
    return { ok: false, reason: "A heading carries no unit, quantity or rate — only its own words." };
  }

  const write = cellWrite(cell, value, item.unit);
  if (!write.ok) return { ok: false, reason: write.reason };

  const written = await writeOverrides(itemId, write.columns, session.email, "typed");
  if (!written) return { ok: false, reason: "That row is not part of this bill." };

  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true };
}

/**
 * A block of cells out of a spreadsheet — §7.4, and not optional.
 *
 * > "if a QS can't paste a column from Excel, they won't use the product"
 *
 * ── What it does when the block runs past the end of the bill ─────────────────────────────
 *
 * It appends. A QS pasting forty measured quantities against a bill of twelve rows means the other
 * twenty-eight, and refusing them would send them back to the spreadsheet they are trying to leave.
 * The appended rows are hand-entered rows in the §1.3.3 sense: no `proposed_*` at all, a person as
 * their source, and `imported` recorded as where the figures came from.
 *
 * ── And when a cell cannot be read ────────────────────────────────────────────────────────
 *
 * The rest of the block still lands, and every refusal is named and handed back. Refusing forty
 * cells because one says `1,234` would be the paranoia without the point of it; writing that one is
 * the thousand-fold error §5 exists to prevent. So: neither, and the reader is told which cells they
 * have to settle themselves.
 */
export async function pasteBlock(
  projectId: string,
  runId: string,
  startItemId: string,
  startCell: EditableCell,
  block: string[][],
): Promise<
  | { ok: true; written: number; appended: number; refusals: { at: string; reason: string }[] }
  | { ok: false; reason: string }
> {
  const session = await requireSession();

  const { run, reason } = await openBill(projectId, runId);
  if (!run) return { ok: false, reason };

  const rows = await db
    .select()
    .from(runItems)
    .where(eq(runItems.runId, runId))
    .orderBy(asc(runItems.seq));

  const startRow = rows.findIndex((row) => row.id === startItemId);
  if (startRow < 0) return { ok: false, reason: "That row is not part of this bill." };

  const startColumn = EDITABLE_CELLS.indexOf(startCell);
  const refusals: { at: string; reason: string }[] = [];

  let written = 0;
  let appended = 0;
  let seq = await nextSeq(runId);

  for (const [down, line] of block.entries()) {
    let target = rows[startRow + down];

    if (!target) {
      // Past the end of the bill: a new hand-entered row, in the section the paste started in.
      const [created] = await db
        .insert(runItems)
        .values({
          runId,
          seq,
          parentId: rows[startRow].parentId,
          rowType: "item",
          quantitySource: "imported",
        })
        .returning();

      target = created;
      rows.push(created);
      seq += SEQ_STEP;
      appended += 1;
    }

    for (const [across, typed] of line.entries()) {
      const cell = EDITABLE_CELLS[startColumn + across];
      // A block wider than the editable columns is normal — a QS selects more of the spreadsheet
      // than the bill has cells. The extra columns are dropped rather than refused one by one.
      if (!cell) break;

      const where = `row ${startRow + down + 1}, ${cell}`;

      if (target.rowType !== "item" && cell !== "description") {
        refusals.push({ at: where, reason: "a heading carries no unit, quantity or rate" });
        continue;
      }

      // A unit pasted in the same line counts: it is the unit this row is about to have.
      const unitAt = EDITABLE_CELLS.indexOf("unit") - startColumn;
      const pastedUnit = unitAt >= 0 ? line[unitAt]?.trim() : undefined;
      const write = cellWrite(cell, typed, pastedUnit || target.overrideUnit || target.proposedUnit);
      if (!write.ok) {
        refusals.push({ at: `${where} — "${typed.trim()}"`, reason: write.reason });
        continue;
      }

      if (await writeOverrides(target.id, write.columns, session.email, "pasted")) written += 1;
    }
  }

  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true, written, appended, refusals };
}

/**
 * A row the agent did not propose — §1.3.3's "manual entry never disappears".
 *
 * It has no `proposed_*` at all, which is the honest record: nothing was read from any document, and
 * a hand-entered value is an override with a person as its source. It lands at the end of the bill,
 * in whatever section the bill currently ends in, because that is where somebody adding a row while
 * reading it is looking.
 */
export async function addRow(
  projectId: string,
  runId: string,
  rowType: "item" | "heading",
): Promise<BillAction> {
  await requireSession();

  const { run, reason } = await openBill(projectId, runId);
  if (!run) return { ok: false, reason };

  const rows = await db
    .select({ id: runItems.id, parentId: runItems.parentId, rowType: runItems.rowType })
    .from(runItems)
    .where(eq(runItems.runId, runId))
    .orderBy(asc(runItems.seq));

  const last = rows[rows.length - 1];
  const parentId =
    rowType === "heading" ? null : (last?.rowType === "heading" ? last.id : (last?.parentId ?? null));

  await db.insert(runItems).values({
    runId,
    seq: await nextSeq(runId),
    parentId,
    rowType,
    quantitySource: "manual",
  });

  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true };
}

/**
 * Open an empty bill to fill by hand – no specification, no agent (audit C1).
 *
 * The rows come after, through the same `addRow`, paste and Take-off sends as any draft. Opening it
 * with one empty section rather than nothing, because a bill is sections of items and the first
 * thing a QS does in a new one is name the first section.
 */
export async function startBill(projectId: string, module: string): Promise<BillAction> {
  const session = await requireSession();

  const draft = await draftBillFor(projectId, module, session.email);
  if (!draft.ok) return { ok: false, reason: draft.reason };
  if (!draft.created) {
    return { ok: false, reason: "This step already has a bill in progress. Reload to see it." };
  }

  await db.insert(runItems).values({
    runId: draft.runId,
    seq: await nextSeq(draft.runId),
    rowType: "heading",
    quantitySource: "manual",
  });

  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true };
}

/**
 * Strike a row out, or put it back.
 *
 * **Not a delete.** §1.3.1's whole position is that `proposed` is the record of what the machine
 * said; deleting a row the agent proposed would leave a bill nobody can review against the documents
 * it came from. The row stays, struck through, out of every total and out of the sign-off gate —
 * the same shape as withdraw-versus-delete in the corpus.
 */
export async function omitRow(
  projectId: string,
  runId: string,
  itemId: string,
  omitted: boolean,
): Promise<BillAction> {
  const session = await requireSession();

  const { run, reason } = await openBill(projectId, runId);
  if (!run) return { ok: false, reason };

  const changed = await db
    .update(runItems)
    .set(
      omitted
        ? { omittedAt: new Date(), omittedBy: session.email }
        : { omittedAt: null, omittedBy: null },
    )
    .where(and(eq(runItems.id, itemId), eq(runItems.runId, runId)))
    .returning({ id: runItems.id });

  if (changed.length === 0) return { ok: false, reason: "That row is not part of this bill." };

  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true };
}

/**
 * Freeze the bill — §1.3.1, the act the whole chain hangs from.
 *
 * `working` is copied into `output_*` for every row and the run is stamped with the signer's name.
 * The order inside the transaction is load-bearing for the same reason it is on a field run: the
 * freeze trigger refuses any write to a row whose run is signed, so stamping the run first would
 * lock the outputs out of their own sign-off.
 *
 * **`output_amount` is copied from `amount`, never recomputed.** The stored amount is what the
 * database's own trigger produced from these figures; recalculating it here would introduce a second
 * arithmetic at the exact moment the first one becomes permanent, and if the two ever disagreed the
 * signed bill would carry the answer nobody had been looking at.
 */
export async function signOffBill(projectId: string, runId: string): Promise<BillAction> {
  const session = await requireSession();

  const { run, reason } = await openBill(projectId, runId);
  if (!run) return { ok: false, reason };

  if (run.status === "running") {
    return { ok: false, reason: "This run is still reading. Wait for it to finish before signing it." };
  }

  const bill = await loadLatestBill(projectId, run.module);
  if (!bill || bill.id !== runId) {
    // A newer run exists. Signing the older one would freeze a bill the reader is not looking at.
    return { ok: false, reason: "A newer run has been started for this step. Reload to see it." };
  }

  const blocked = blockingRows(bill.rows);

  if (blocked.empty) {
    return {
      ok: false,
      reason:
        "There is nothing in this bill to sign. An approved total of nought over a job nobody has measured is worse than an unsigned step.",
    };
  }

  if (blocked.rows.length > 0) {
    const named = blocked.rows.slice(0, 3).map((row) => `${row.description} (${row.missing})`);
    const rest = blocked.rows.length - named.length;

    return {
      ok: false,
      reason: `${named.join(", ")}${rest > 0 ? ` and ${rest} more` : ""} ${
        blocked.rows.length === 1 ? "has" : "have"
      } no measure. Enter the figures, or strike the ${blocked.rows.length === 1 ? "row" : "rows"} out — a signed bill with a hole in it reads downstream as an approved total.`,
    };
  }

  try {
    await db.transaction(async (tx) => {
      for (const row of bill.rows) {
        // A struck row is not in the bill, so it freezes nothing. Its proposal stays as the record
        // of what was offered and why somebody disagreed with it.
        if (row.omitted) continue;

        const working = workingRow(row);

        await tx
          .update(runItems)
          .set(
            row.rowType === "item"
              ? {
                  outputDescription: working.description,
                  outputUnit: working.unit,
                  outputQuantity: working.quantity,
                  outputRate: working.rate ? BigInt(working.rate.value) : null,
                  outputRatePrecision: working.rate ? working.rate.precision : null,
                  outputAmount: row.amount === null ? null : BigInt(row.amount),
                }
              : { outputDescription: working.description },
          )
          .where(eq(runItems.id, row.id));
      }

      await tx
        .update(runs)
        .set({ signedBy: session.email, signedAt: new Date() })
        .where(eq(runs.id, runId));
    });
  } catch (error) {
    // The trigger's own words, which name the run and its signer, are more use than "failed".
    return {
      ok: false,
      reason: `The bill was not signed: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }

  revalidatePath(`/projects/${projectId}`, "layout");
  // The team hears it was signed – after the response, so telling them never costs the signature.
  after(() => toldSignedOff(projectId, run.module, session.email).catch((e) => console.error("[notifications]", e)));
  return { ok: true };
}

/**
 * Open a revision of a signed bill — PLATFORM.md §1.3.1, §6.3.
 *
 * ── Why this exists ────────────────────────────────────────────────────────────────────────
 *
 * Signing froze the rows, which is right: a signed bill is an issued instrument and the steps after
 * it read the total. But the only way onward from a signed bill was "Draft again", which re-reads
 * the corpus from nothing — so every quantity a QS had measured by hand and every rate they had
 * priced was proposed afresh by the agent and had to be typed again. The sign-off sentence had to
 * warn people about that, and it made signing feel like a door closing.
 *
 * That was never an integrity requirement. It was a missing feature. A signed bill that changes is
 * **Revision B** in every practice that has ever issued one: carried forward and amended, never
 * re-measured from nothing.
 *
 * ── What is carried, and what is not ───────────────────────────────────────────────────────
 *
 * The signed row's **output** — the figures the signature froze — becomes the revision's
 * **proposal**. That is the honest mapping: they are what this revision starts from, and the QS
 * overrides the ones that have moved, exactly as they would over an agent's proposal.
 *
 * Three things travel with each figure so that §1.3.1 still holds afterwards:
 *
 *   · the **citation** — a carried row still points at the document its work was described in;
 *   · `quantity_source` / `rate_source` — a figure a person measured in revision A is still a
 *     figure a person measured, and re-stamping it `ai_derived` would launder it (§6.3);
 *   · a note on every row naming the bill it came from and who signed it, which is what stops a
 *     carried figure reading as something this platform has just derived.
 *
 * A struck row does not travel: it was not in the bill that was signed. Nothing is spent — no
 * provider is called — so the run carries no token count rather than a nought that looks like one.
 *
 * The signed bill is untouched and stays the one every later step reads. It is replaced at the
 * moment the revision is signed, and not before — which is the behaviour the panel already had.
 */
export async function reviseBill(projectId: string, module: string): Promise<BillAction> {
  const session = await requireSession();

  const latest = await loadLatestBill(projectId, module);
  if (!latest) return { ok: false, reason: "There is no bill on this step to revise." };

  if (!latest.signedBy || !latest.signedAt) {
    // Not a failure worth a scary sentence: the thing they asked for is already in front of them.
    return {
      ok: false,
      reason: "This bill is not signed off, so it is still open — correct it in place.",
    };
  }

  const source = await db
    .select()
    .from(runItems)
    .where(eq(runItems.runId, latest.id))
    .orderBy(asc(runItems.seq));

  const carried = source.filter((row) => row.omittedAt === null);
  if (carried.length === 0) {
    return { ok: false, reason: "Every row in the signed bill was struck out. There is nothing to carry." };
  }

  const note = `Carried from the bill signed by ${latest.signedBy} on ${formatDate(latest.signedAt)}.`;

  // "review" and not a status of its own: a revision is a run with rows waiting for a person, which
  // is exactly what that status means. Nothing about it is running, and nothing about it failed.
  const [revision] = await db
    .insert(runs)
    .values({ projectId, module, status: "review", createdBy: session.email })
    .returning({ id: runs.id });

  /*
    Headings before their items, and a map from the old id to the new one.

    `parent_id` points at another row *in the same run*, so copying the column verbatim would make
    every item in the revision a child of a row in the signed bill — a foreign key that resolves,
    which is what makes it dangerous. Rows arrive in `seq` order and a heading always precedes the
    items under it, so one pass is enough to have the parent's new id by the time a child needs it.
  */
  const remapped = new Map<string, string>();

  for (const row of carried) {
    const [inserted] = await db
      .insert(runItems)
      .values({
        runId: revision.id,
        seq: row.seq,
        parentId: row.parentId ? (remapped.get(row.parentId) ?? null) : null,
        rowType: row.rowType,
        itemRef: row.itemRef,

        // The signature's own figures, offered to this revision as what it starts from.
        proposedDescription: row.outputDescription,
        proposedUnit: row.outputUnit,
        proposedQuantity: row.outputQuantity,
        proposedRate: row.outputRate,
        proposedRatePrecision: row.outputRatePrecision,
        proposedNote: note,

        sourceDocumentId: row.sourceDocumentId,
        sourceDocument: row.sourceDocument,
        sourcePage: row.sourcePage,
        sourceExcerpt: row.sourceExcerpt,

        quantitySource: row.quantitySource,
        rateSource: row.rateSource,
      })
      .returning({ id: runItems.id });

    remapped.set(row.id, inserted.id);
  }

  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true };
}
