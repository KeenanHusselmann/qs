/**
 * The rate library — what a rate *is*, and which one applies. The half with no database in it.
 *
 * ── Why this is a separate file ────────────────────────────────────────────────────────────
 *
 * The screen is a client component: it filters, searches and switches tabs without a round trip.
 * Anything it imports from a module that imports `db` drags the database client into the browser
 * bundle and the whole app returns 500 — that has happened three times here and typecheck catches
 * none of it, because it is a module-graph error rather than a type error. `lib/people.ts` exists
 * for exactly this reason and this follows it.
 *
 * So the shape, the vocabulary and the rules live here, importing only `domain/money`, and both
 * halves read them.
 */

import { formatRate, rate as makeRate, type Rate } from "@/domain/money";

/** A rate as every surface reads it. `rate`/`precision` is §5.1's pair, never a float. */
export interface LibraryRate {
  id: string;
  trade: string | null;
  description: string;
  unit: string;
  rate: bigint;
  ratePrecision: number;
  region: string | null;
  source: string;
  /** ISO `yyyy-mm-dd`. A price is a fact about a date (§6.3). */
  effectiveDate: string;
  createdBy: string;
}

/**
 * The nine provinces, because that is what "Regions 9" on the reference screen counts.
 *
 * Declared rather than derived, and it is the one list here that has to be: the provinces are a
 * fact about South Africa and not about this platform's data. Deriving them from the rates on file
 * would make the count shrink when a practice happens not to have priced work in the Northern Cape,
 * which reads as coverage the library has lost rather than work it has not done.
 */
export const REGIONS = [
  "Eastern Cape",
  "Free State",
  "Gauteng",
  "KwaZulu-Natal",
  "Limpopo",
  "Mpumalanga",
  "North West",
  "Northern Cape",
  "Western Cape",
] as const;

export type Region = (typeof REGIONS)[number];

/**
 * The trades a rate can be filed under.
 *
 * These are the elemental groups the cost plan already works in — `domain/cost-stack.ts` builds
 * B1–B7 from the same vocabulary, and a rate library that invented its own trade names would price
 * a bill in words the cost plan could not read back.
 *
 * A rate may carry none. §6.9 makes a classification a dimension rather than a gate: a supplier
 * quote for something nobody has classified is still a rate, and refusing it would push the work
 * into a spreadsheet.
 */
export const TRADES = [
  "Preliminaries",
  "Earthworks",
  "Concrete Work",
  "Masonry",
  "Structural Steel",
  "Roofing",
  "Carpentry & Joinery",
  "Finishes",
  "Plumbing & Drainage",
  "Electrical",
  "Mechanical",
  "External Works",
] as const;

export type Trade = (typeof TRADES)[number];

/** Formatted for a grid cell — §7.4's money cell, tabular and right-aligned by the component. */
export const displayRate = (r: Pick<LibraryRate, "rate" | "ratePrecision">): string =>
  `R ${formatRate(asRate(r))}`;

/** The `Rate` the money module works in, so nothing here does arithmetic of its own. */
export const asRate = (r: Pick<LibraryRate, "rate" | "ratePrecision">): Rate =>
  makeRate(r.rate, r.ratePrecision);

/**
 * What identifies "the same item" across repricings.
 *
 * Rows are appended, never updated, so the library holds several prices for one item and something
 * has to say which rows are the same item. It is the description, the unit and the region together:
 * the same description in a different unit is a different item, and the same item in Gauteng and
 * the Western Cape genuinely has two prices.
 *
 * The trade is deliberately **not** part of it. It is a dimension a rate may not carry, so folding
 * it in would make classifying an existing rate look like a brand-new item and quietly double it.
 */
/**
 * The separator inside a key, and it is not a space.
 *
 * A space collides: `["ab", "c d"]` and `["ab c", "d"]` both join to `"ab c d"`, so two different
 * items would share a key and one of their prices would silently win. U+0000 cannot occur in a
 * description, a unit or a province, which is the whole requirement.
 *
 * Written as an escape rather than as the byte itself. A literal NUL in the source makes git
 * classify the file as **binary** — no diff, no review, and a change to this module would land
 * as "Bin 11323 bytes" in every pull request. It got in here by accident and was right by accident.
 */
const SEPARATOR = "\u0000";

export const itemKey = (r: Pick<LibraryRate, "description" | "unit" | "region">): string =>
  [r.description.trim().toLowerCase(), r.unit.trim().toLowerCase(), r.region ?? ""].join(SEPARATOR);

/**
 * The rates in force on a date — one row per item, newest on or before `asAt`.
 *
 * ── Why this is a function and not a `distinct on` in SQL ──────────────────────────────────
 *
 * It is both, in the end: the query orders and the caller narrows. But the *rule* lives here so the
 * screen, the import preview and any future "price this bill from the library" read the same one.
 * `loadSignedFigures` taking the latest signature per step is the same shape, and the same reason.
 *
 * **A future-dated rate is not in force.** A practice loading next quarter's SAFCEC in advance is a
 * good thing to be able to do, and a bill priced today must not silently pick it up.
 */
export function ratesInForce(
  rows: readonly LibraryRate[],
  asAt: string = new Date().toISOString().slice(0, 10),
): LibraryRate[] {
  const newest = new Map<string, LibraryRate>();

  for (const row of rows) {
    if (row.effectiveDate > asAt) continue;

    const key = itemKey(row);
    const held = newest.get(key);

    // Ties go to the row entered last, which is the only tie-break with an answer: two prices
    // effective the same day means somebody corrected the first one.
    if (!held || row.effectiveDate > held.effectiveDate) newest.set(key, row);
  }

  return [...newest.values()];
}

/** Every price this item has carried, newest first — what the History action opens. */
export const historyOf = (rows: readonly LibraryRate[], of: LibraryRate): LibraryRate[] =>
  rows
    .filter((r) => itemKey(r) === itemKey(of))
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));

/**
 * Year-on-year movement across the library, as a percentage — or null.
 *
 * ── What it measures, and why it is annualised ─────────────────────────────────────────────
 *
 * The reference screen prints this as "Avg Escalation · YoY increase", and escalation in this
 * trade is always quoted per annum — a contract price adjustment, a cost plan's escalation
 * allowance and a BER index are all annual figures. So each item's movement is annualised over the
 * span between its first and last price, and the tile reports the mean of those.
 *
 * ── The bug this replaced, because it is an easy one to write again ────────────────────────
 *
 * The first version took "the newest price at least a year old" using a cutoff measured from
 * **today**. On a library whose prices are all older than a year that selects the latest row as
 * its own predecessor, every item is skipped, and the tile reads "Not measurable yet" over data
 * that plainly shows movement. The comparison is between two prices of the same item, so the only
 * date that can anchor it is one of theirs.
 *
 * `null`, not zero, when nothing qualifies. A library loaded once has no escalation to report and
 * 0% would claim prices held steady — a measurement nobody has taken.
 */
export function escalation(rows: readonly LibraryRate[]): number | null {
  const byItem = new Map<string, LibraryRate[]>();
  for (const row of rows) {
    const key = itemKey(row);
    byItem.set(key, [...(byItem.get(key) ?? []), row]);
  }

  const moves: number[] = [];

  for (const priced of byItem.values()) {
    if (priced.length < 2) continue;

    const sorted = [...priced].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
    const was = sorted[0]!;
    const now = sorted.at(-1)!;

    const days = (Date.parse(now.effectiveDate) - Date.parse(was.effectiveDate)) / 86_400_000;

    /*
      Too short a span to annualise. A 2% move over three weeks annualises to 40%, which is an
      arithmetic fact and a useless statement about a rate library. Half a year is the shortest
      span where the extrapolation says more than it invents.
    */
    if (days < MIN_SPAN_DAYS) continue;

    /*
      Float here, deliberately and only here. This is a ratio behind a headline percentage, not a
      figure anything is priced from — §5's rule is that money is exact where it is *money*, and a
      percentage nobody signs is a summary. Both sides are normalised to the same scale first, so
      two rates held at different precisions do not produce a nonsense ratio.
    */
    const scale = (r: LibraryRate) => Number(r.rate) / 10 ** r.ratePrecision;
    const from = scale(was);
    if (from <= 0) continue;

    moves.push(((scale(now) / from) ** (365 / days) - 1) * 100);
  }

  if (moves.length === 0) return null;
  return moves.reduce((sum, m) => sum + m, 0) / moves.length;
}

/** Below this the annualisation invents more than it reports. See `escalation`. */
const MIN_SPAN_DAYS = 180;

/**
 * What a row must have before it can be filed.
 *
 * Returns the problems, in the order a reader would fix them. Empty means acceptable — §7.7 asks
 * that a refusal say what to do next, so each of these is written as an instruction rather than as
 * a field name and the word "invalid".
 */
export function problemsWith(draft: {
  description: string;
  unit: string;
  rate: string;
  source: string;
  effectiveDate: string;
}): string[] {
  const problems: string[] = [];

  if (draft.description.trim() === "") problems.push("Describe the item as it would read in a bill.");
  if (draft.unit.trim() === "") problems.push("State the unit the rate is per.");

  if (parseRate(draft.rate) === null) {
    problems.push("Enter the rate as a number — 1 850, or 1 850,25.");
  }

  // Required, and this is the column that makes the library defensible (§6.3).
  if (draft.source.trim() === "") {
    problems.push("Name where the rate came from — a published guide, a quote, or a survey.");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.effectiveDate)) {
    problems.push("Give the date the price applies from.");
  }

  return problems;
}

/**
 * Read a typed rate into minor units and the scale it was written at.
 *
 * The **typed precision is kept**, rather than everything being forced to cents. Somebody entering
 * `32,5000` for conduit per metre is saying something about how the figure was derived, and
 * rounding it to `32,50` on the way in loses that before it is ever used. §5.1 holds the scale per
 * rate for this reason.
 *
 * Accepts what a South African QS types (§7.7): a comma decimal, spaces or U+00A0 grouping, and an
 * optional `R`. Returns null for anything else rather than a guess.
 */
export function parseRate(typed: string): { value: bigint; precision: number } | null {
  const cleaned = typed
    .trim()
    .replace(/^R\s*/i, "")
    .replace(/[\s ]/g, "")
    .replace(",", ".");

  if (!/^\d+(\.\d{1,6})?$/.test(cleaned)) return null;

  const [whole = "0", fraction = ""] = cleaned.split(".");
  // At least cents, so a rate typed as "1850" is stored as 185000 at precision 2 rather than as
  // 1850 at precision 0 — which would extend correctly and print as "R 1 850" in a bill of cents.
  const precision = Math.max(fraction.length, 2);

  return { value: BigInt(whole + fraction.padEnd(precision, "0")), precision };
}
