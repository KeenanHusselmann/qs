"use server";

/**
 * Pricing a bill — PLATFORM.md §4.8, §5, §6.3.
 *
 * Three acts, over the rows §4.7 already produced:
 *
 *   · **a rate, set across a selection** — the bulk gesture that prices repeated work
 *   · **a percentage, applied across a selection** — escalation, or a margin moved
 *   · **a build-up behind one row** — what the rate is made of, and what it therefore is
 *
 * ── Why bulk application is not optional ───────────────────────────────────────────────────
 *
 * §4.8 says it outright: *"Nobody prices 4,000 items one at a time."* A screen that can only take
 * one rate per round trip is a screen a QS prices twenty rows on and then goes back to Excel, which
 * is the adoption failure §7.4 records about paste and §12 records about import.
 *
 * ── And why "apply a rate set" is not here ─────────────────────────────────────────────────
 *
 * §4.8 names two bulk actions and the other is *apply a rate set* — a named, reusable, versioned
 * price list (§6.3), which is the Rate Library, which is not built. Building a nameless imitation
 * of it inside this screen would put a second home for the firm's rates in the product before the
 * first one exists. What is here instead is the primitive underneath it: a rate a person states,
 * applied to the rows they selected, attributed to them. When the library lands it applies rates
 * through this same writer and records `rate_source = 'rate_set'`, which is why that value is
 * already in the check constraint.
 *
 * ── Every figure crosses a reader ─────────────────────────────────────────────────────────
 *
 * `readRate` and `readPercent`, exactly as a single cell does — and one refused figure never costs
 * the other thirty-nine their write. A bulk act that silently dropped what it could not read would
 * be the worst version of this screen: four thousand rows, and no way to tell which of them moved.
 */

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth";
import { db } from "@/db/client";
import { rateBuildUps, rateComponents, runItems } from "@/db/schema";
import { workingRow } from "@/lib/agent/bill";
import { openBill, writeOverrides, type BillAction } from "@/lib/agent/bill-writes";
import { asBillRow, loadBuildUps } from "@/lib/agent/persist-bill";
import { computeBuildUp, readBuildUpDraft, type BuildUpDraft } from "@/lib/pricing";
import { readPercent, readRate } from "@/domain/amount";
import { matchRates, priceResources } from "@/lib/rate-match";
import { proposeMethod } from "@/lib/agent/build-up-method";
import { ModelUnavailable, costOf } from "@/lib/agent/deepseek";
import { listRates } from "@/app/(app)/rates/actions";
import { adjustRate, formatRate, rate, rate as makeRate } from "@/domain/money";
import { forProject } from "@/lib/egress/scope";

/** What a bulk act did, and what it deliberately left alone. */
export type BulkOutcome =
  | {
      ok: true;
      written: number;
      /** Rows the act could not touch, each with the reason. Named, never counted away. */
      skipped: { description: string; reason: string }[];
    }
  | { ok: false; reason: string };

/**
 * The rows of this run a bulk act may write — **resolved on the server, from the run**.
 *
 * The screen sends a list of ids. A list of ids from a browser is a request, not a fact: §1.3.1's
 * warning about a client deciding its own prerequisites applies exactly here, and a crafted POST
 * naming another project's rows would otherwise reprice a bill nobody had opened. So the rows are
 * fetched by `run_id` and the selection is intersected with them.
 *
 * Headings and struck rows are excluded by construction rather than by a check the caller makes: a
 * heading carries no rate (§4.7) and a struck row is not in the bill.
 */
async function selectedItems(runId: string, itemIds: readonly string[]) {
  if (itemIds.length === 0) return [];

  const rows = await db
    .select()
    .from(runItems)
    .where(
      and(
        eq(runItems.runId, runId),
        eq(runItems.rowType, "item"),
        isNull(runItems.omittedAt),
        inArray(runItems.id, [...new Set(itemIds)]),
      ),
    )
    .orderBy(asc(runItems.seq));

  return rows;
}

const nameOf = (row: typeof runItems.$inferSelect) =>
  row.overrideDescription ?? row.proposedDescription ?? "An unnamed item";

/**
 * One rate, across a selection — §4.8's bulk application.
 *
 * The rate is read once and written to every selected item, so forty rows of 230mm brickwork are
 * priced by typing the figure once. It is `manual` on every one of them (§6.3): a person stated it,
 * and each row keeps the agent's own proposal underneath where there was one, so what changed stays
 * visible on the row rather than only in this action's return value.
 */
export async function applyRate(
  projectId: string,
  runId: string,
  itemIds: readonly string[],
  typed: string,
): Promise<BulkOutcome> {
  const session = await requireSession();

  const { run, reason } = await openBill(projectId, runId);
  if (!run) return { ok: false, reason };

  const reading = readRate(typed);
  if (!reading.ok) return { ok: false, reason: reading.reason };

  const rows = await selectedItems(runId, itemIds);
  if (rows.length === 0) return { ok: false, reason: "Nothing on this bill was selected." };

  let written = 0;
  for (const row of rows) {
    const done = await writeOverrides(
      row.id,
      { overrideRate: reading.rate.value, overrideRatePrecision: reading.rate.precision },
      session.email,
      "typed",
    );
    if (done) written += 1;
  }

  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true, written, skipped: [] };
}

/**
 * A percentage, across a selection — §4.8's "apply % markup across a selection".
 *
 * ── A row with no rate is skipped by name, not treated as nought ───────────────────────────
 *
 * Ten per cent of nothing is nothing, and writing R0,00 into an unpriced row would turn an item
 * nobody has priced into an item priced at zero — two different facts, and the second one passes
 * the sign-off gate. So those rows are left exactly as they were and handed back with the reason,
 * which is the same discipline the extension trigger applies to an unmeasured quantity.
 *
 * The band is -100% to +100%: below that a rate changes sign, which is not an adjustment.
 */
export async function adjustRates(
  projectId: string,
  runId: string,
  itemIds: readonly string[],
  typed: string,
): Promise<BulkOutcome> {
  const session = await requireSession();

  const { run, reason } = await openBill(projectId, runId);
  if (!run) return { ok: false, reason };

  const reading = readPercent(typed, { min: -100, max: 100 });
  if (!reading.ok) return { ok: false, reason: reading.reason };

  const rows = await selectedItems(runId, itemIds);
  if (rows.length === 0) return { ok: false, reason: "Nothing on this bill was selected." };

  const skipped: { description: string; reason: string }[] = [];
  let written = 0;

  for (const row of rows) {
    // `working`, not `proposed`: a rate a QS corrected is the rate they are adjusting. Human wins
    // here exactly as it does everywhere else (§1.3.1).
    const working = workingRow(asBillRow(row)).rate;

    if (working === null) {
      skipped.push({ description: nameOf(row), reason: "has no rate to adjust" });
      continue;
    }

    const moved = adjustRate(rate(BigInt(working.value), working.precision), reading.percent);

    const done = await writeOverrides(
      row.id,
      { overrideRate: moved.value, overrideRatePrecision: moved.precision },
      session.email,
      "typed",
    );
    if (done) written += 1;
  }

  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true, written, skipped };
}

export type BuildUpOutcome =
  | { ok: true; refusals: { at: string; reason: string }[] }
  | { ok: false; reason: string };

/**
 * Save a build-up and apply what it comes to — §4.8.
 *
 * ── The whole build-up at once, and the components replaced rather than diffed ─────────────
 *
 * A build-up is five rows a person retypes in place; it is not a bill, and nothing inserts into the
 * middle of one. Sending it whole means one round trip per edit instead of one per cell, and it
 * means the rate applied to the row is always computed from the state that was just saved rather
 * than from a state assembled out of several partial writes.
 *
 * ── The reading is `readBuildUpDraft`, which the editor also ran ───────────────────────────
 *
 * That is the point of it living in `pricing.ts`. The QS saw a rate the moment they stopped typing;
 * this is the copy that decides, and it decides by running the same function over the same strings.
 * Two readers would have been two answers to what `1,234` means, with only one of them on screen.
 *
 * ── What is applied to the row ────────────────────────────────────────────────────────────
 *
 * `plug ?? computed`, through the same writer a typed cell uses, recorded as `build_up`. A build-up
 * with no usable component and no plug applies **nothing** and clears the rate it had set: a rate
 * of R0,00 over an empty build-up would price an item at nought, which the sign-off gate would then
 * happily freeze.
 */
export async function saveBuildUp(
  projectId: string,
  runId: string,
  itemId: string,
  draft: BuildUpDraft,
): Promise<BuildUpOutcome> {
  const session = await requireSession();

  const { run, reason } = await openBill(projectId, runId);
  if (!run) return { ok: false, reason };

  const [item] = await db
    .select({ id: runItems.id, runId: runItems.runId, rowType: runItems.rowType })
    .from(runItems)
    .where(eq(runItems.id, itemId))
    .limit(1);

  if (!item || item.runId !== runId) {
    return { ok: false, reason: "That row is not part of this bill." };
  }
  if (item.rowType !== "item") {
    return { ok: false, reason: "A heading carries no rate, so there is nothing to build up." };
  }

  const read = readBuildUpDraft(draft, { id: "", itemId, by: session.email });

  const percentages = {
    wasteRate: read.buildUp.wasteRate,
    markupRate: read.buildUp.markupRate,
    plugRate: read.buildUp.plug === null ? null : BigInt(read.buildUp.plug.value),
    plugRatePrecision: read.buildUp.plug?.precision ?? null,
  };

  const [head] = await db
    .insert(rateBuildUps)
    .values({ runItemId: itemId, ...percentages, createdBy: session.email })
    .onConflictDoUpdate({ target: rateBuildUps.runItemId, set: percentages })
    .returning({ id: rateBuildUps.id });

  await db.delete(rateComponents).where(eq(rateComponents.buildUpId, head.id));

  if (read.buildUp.components.length > 0) {
    await db.insert(rateComponents).values(
      read.buildUp.components.map((component) => ({
        buildUpId: head.id,
        seq: component.seq,
        kind: component.kind,
        description: component.description,
        quantity: component.quantity,
        rate: component.rate === null ? null : BigInt(component.rate.value),
        ratePrecision: component.rate?.precision ?? null,
      })),
    );
  }

  await applyBuildUp(runId, itemId, session.email);

  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true, refusals: read.refusals };
}

/**
 * Put what the build-up comes to onto the row it belongs to.
 *
 * Re-read from the database rather than computed from the draft, so the figure applied is the one
 * derived from what was actually stored — including the components whose figures were refused and
 * stored as null. A rate computed from a draft the database did not accept in full would be a rate
 * the screen could never reproduce.
 */
async function applyBuildUp(runId: string, itemId: string, by: string) {
  const buildUp = (await loadBuildUps(runId)).get(itemId);
  if (!buildUp) return;

  const worked = computeBuildUp(buildUp);
  const usable = buildUp.components.filter((c) => c.quantity !== null && c.rate !== null).length;

  // Nothing to say yet. Clearing rather than writing nought — an item nobody has priced and an item
  // priced at nothing are different facts, and only the first is refused at sign-off.
  if (usable === 0 && !worked.plugged) {
    await writeOverrides(itemId, { overrideRate: null, overrideRatePrecision: null }, by, "build_up");
    return;
  }

  await writeOverrides(
    itemId,
    {
      overrideRate: BigInt(worked.applied.value),
      overrideRatePrecision: worked.applied.precision,
    },
    by,
    "build_up",
  );
}

/**
 * Take the build-up away, and the rate it set with it.
 *
 * Leaving the rate behind would leave a figure whose derivation had just been deleted — the
 * untraceable number §1.3.1 calls worse than a gap, arrived at by tidying up. So the override goes
 * too and the agent's own proposal comes back, which is what the row said before anybody built
 * anything up. A rate a QS wants to keep is one they type, and then it is theirs.
 */
export async function removeBuildUp(
  projectId: string,
  runId: string,
  itemId: string,
): Promise<BillAction> {
  const session = await requireSession();

  const { run, reason } = await openBill(projectId, runId);
  if (!run) return { ok: false, reason };

  const [item] = await db
    .select({ id: runItems.id, runId: runItems.runId })
    .from(runItems)
    .where(eq(runItems.id, itemId))
    .limit(1);

  if (!item || item.runId !== runId) {
    return { ok: false, reason: "That row is not part of this bill." };
  }

  const removed = await db
    .delete(rateBuildUps)
    .where(eq(rateBuildUps.runItemId, itemId))
    .returning({ id: rateBuildUps.id });

  if (removed.length === 0) return { ok: false, reason: "There is no build-up on that row." };

  await writeOverrides(
    itemId,
    { overrideRate: null, overrideRatePrecision: null },
    session.email,
    "build_up",
  );

  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true };
}

/**
 * Price a bill from the firm's rate library — §4.8's "apply a rate set".
 *
 * ── Only what was offered, and only what is still unpriced ─────────────────────────────────
 *
 * The client sends row ids, not rates. The match is recomputed here against the library as it
 * stands, so a proposal a reader has been looking at for ten minutes cannot write a figure the
 * library no longer holds — and a row somebody priced by hand in the meantime is skipped by name
 * rather than overwritten. `matchRates` already excludes a priced row; this re-runs it rather than
 * trusting a list assembled in a browser, for the same reason the importer re-reads its file.
 *
 * `rate_source` is `library`, which `0011_pricing.sql` has accepted since it was written and
 * nothing has ever produced. A reader looking at the row can now tell a rate the practice published
 * from one somebody typed.
 */
export async function applyLibraryRates(
  projectId: string,
  runId: string,
  itemIds: readonly string[],
  options: { region?: string | null; asAt?: string } = {},
): Promise<BulkOutcome> {
  const session = await requireSession();

  const { run, reason } = await openBill(projectId, runId);
  if (!run) return { ok: false, reason };

  const [library, rows] = await Promise.all([listRates(), loadBillRows(runId)]);

  const wanted = new Set(itemIds);
  const matches = matchRates(rows, library, options).filter((m) => wanted.has(m.rowId));

  if (matches.length === 0) {
    return {
      ok: false,
      // §7.7 — say what happened, not that nothing did. These two are different facts.
      reason:
        itemIds.length === 0
          ? "Nothing was selected to price."
          : "The library no longer offers a rate for any of those rows — it may have been repriced, or they may have been priced by hand since.",
    };
  }

  let written = 0;
  for (const match of matches) {
    const done = await writeOverrides(
      match.rowId,
      { overrideRate: match.rate.rate, overrideRatePrecision: match.rate.ratePrecision },
      session.email,
      "library",
    );
    if (done) written += 1;
  }

  revalidatePath(`/projects/${projectId}`, "layout");

  /*
    Named, with a reason each — the shape `BulkOutcome` already requires, and it requires it for a
    good reason: "3 of 7 priced" tells a reader nothing about the four, and the four are the work.
  */
  const skipped = rows
    .filter((row) => wanted.has(row.id) && !matches.some((m) => m.rowId === row.id))
    .map((row) => ({
      description: workingRow(row).description ?? "Untitled row",
      reason:
        workingRow(row).rate !== null
          ? "Already priced — the library never replaces a rate somebody has already put on a row."
          : "The library has no rate for this item in the same unit.",
    }));

  return { ok: true, written, skipped };
}

/**
 * The whole bill, in the shape the matcher reads.
 *
 * Every row, not the selection: `matchRates` scores a row against the library and needs the row
 * itself, and `run_items` has no soft delete — a struck-out row carries `omittedAt` and the matcher
 * skips it by reading `omitted`.
 */
async function loadBillRows(runId: string) {
  const rows = await db
    .select()
    .from(runItems)
    .where(eq(runItems.runId, runId))
    .orderBy(asc(runItems.seq));

  return rows.map((row) => asBillRow(row));
}

/** A proposed build-up, and what the library could and could not price in it. */
export type MethodOutcome =
  | { ok: false; reason: string }
  | {
      ok: true;
      draft: BuildUpDraft;
      /** Where each priced line's figure came from, so the reader can see it before saving. */
      sources: (string | null)[];
      /** Components the library has no rate for. Named, never quietly left at nought. */
      unpriced: string[];
      note: string | null;
      cost: number | null;
    };

/**
 * Propose how a rate is built up — §4.8, and the ASAQS finding turned into a design.
 *
 * ── The model is asked for the method, never for the money ─────────────────────────────────
 *
 * ASAQS asked ChatGPT what a one-brick wall costs. It answered about R215/m² from essentially one
 * website and practising quantity surveyors assessed the result inaccurate. The mistake is in the
 * question: asking a language model what something costs is asking it to remember a number, and it
 * will produce a plausible one with nothing behind it.
 *
 * So `proposeMethod` returns **quantities only** — 104 bricks and 1,2 hours of a bricklayer in a
 * square metre of walling. Those are measurement facts, and a QS spots a wrong one instantly. Every
 * price then comes from this practice's own rate library, from a row somebody curated carrying its
 * source and its effective date.
 *
 * Nothing is saved. It returns a draft into the same editor a QS would have typed by hand, and the
 * existing `saveBuildUp` is what writes — so a proposed rate reaches the row by exactly the route a
 * hand-built one does, and lands as `rate_source = 'build_up'` either way.
 */
export async function proposeBuildUp(
  projectId: string,
  runId: string,
  itemId: string,
  options: { region?: string | null } = {},
): Promise<MethodOutcome> {
  await requireSession();

  const { run, reason } = await openBill(projectId, runId);
  if (!run) return { ok: false, reason };

  const [item] = await db
    .select()
    .from(runItems)
    .where(and(eq(runItems.id, itemId), eq(runItems.runId, runId)))
    .limit(1);

  if (!item || item.rowType !== "item") {
    return { ok: false, reason: "That row is not an item on this bill." };
  }

  const working = workingRow(asBillRow(item));
  const description = working.description?.trim() ?? "";
  const unit = working.unit?.trim() ?? "";

  if (description === "" || unit === "") {
    // A row with no unit cannot be built up: the whole method is "per one of these".
    return { ok: false, reason: "This row needs a description and a unit before it can be built up." };
  }

  let method;
  try {
    method = await forProject(projectId, () => proposeMethod(description, unit));
  } catch (error) {
    // §1.3 — an outage is a result, never an empty answer dressed as one.
    return {
      ok: false,
      reason:
        error instanceof ModelUnavailable
          ? error.message
          : `The method could not be proposed: ${error instanceof Error ? error.message : "unknown error"}.`,
    };
  }

  if (method.components.length === 0) {
    return {
      ok: false,
      reason: method.note ?? "Nothing in this item could be decomposed into resources.",
    };
  }

  const library = await listRates();
  const priced = priceResources(method.components, library, options);

  return {
    ok: true,
    note: method.note,
    cost: costOf(method.usage),
    unpriced: priced.filter((p) => p.rate === null).map((p) => p.component.description),
    sources: priced.map((p) =>
      p.rate ? `${p.rate.source}${p.rate.region ? ` · ${p.rate.region}` : ""}` : null,
    ),
    draft: {
      waste: String(method.wastePercent),
      // The model is not asked for a markup. What a practice adds to cost is a commercial decision
      // and not a measurement fact, so it stays where the QS sets it.
      markup: "",
      plug: "",
      components: priced.map((p) => ({
        kind: p.component.kind,
        description: p.component.description,
        quantity: p.component.quantity,
        /*
          Empty where the library has no rate. Not nought — `computeBuildUp` counts an incomplete
          line out loud and contributes nothing for it, which is the honest arithmetic; a zero would
          silently make the rate too low and still look complete.
        */
        rate: p.rate ? formatRate(makeRate(p.rate.rate, p.rate.ratePrecision)) : "",
      })),
    },
  };
}
