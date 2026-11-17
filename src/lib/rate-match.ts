/**
 * Pricing a bill from the firm's rate library — PLATFORM.md §4.8, §6.3.
 *
 * ── The half of "apply a rate set" that was never built ────────────────────────────────────
 *
 * `HANDOFF.md` has carried this as open work for months, and `0011_pricing.sql` prepared for it:
 * `rate_source` has accepted `'library'` and `'rate_set'` since then and nothing has ever written
 * either. Without it the rate library is a reference table — a QS imports SAFCEC, looks at it, and
 * then types the rates into the bill by hand.
 *
 * ── Offered, never applied ─────────────────────────────────────────────────────────────────
 *
 * Nothing here writes anything. It proposes, and a person accepts row by row, for the reason the
 * importer refuses "KZN" as a province: a rate quietly applied to the wrong item is a wrong figure
 * in a document somebody signs, and it will not look wrong.
 *
 * The ASAQS test of an LLM pricing a one-brick wall is the same lesson from the other end — it
 * answered R215,23/m² from essentially one website, and practising QSs assessed it inaccurate. The
 * defence is not a better guess. It is that every rand comes from a row the practice curated, with
 * its source and its date attached, and that a match a machine is unsure of is shown as a proposal
 * rather than made into a figure.
 *
 * ── The unit is not negotiable ─────────────────────────────────────────────────────────────
 *
 * A description may be worded differently between a bill and a schedule and still mean the same
 * item. A *unit* may not. A rate per m² applied to a quantity in m³ extends to a number that is
 * wrong by a factor nobody can see, so a differing unit is not a weak candidate — it is not a
 * candidate at all.
 */

import { workingRow, type BillRow } from "@/lib/agent/bill";
import { ratesInForce, type LibraryRate } from "@/lib/rates";

/** Words that appear in every second bill item and therefore distinguish none of them. */
const NOISE = new Set([
  "the", "of", "in", "to", "and", "or", "a", "an", "for", "with", "on", "at", "by",
  "as", "per", "including", "incl", "excluding", "excl", "all", "any", "size", "type",
  "mm", "no", "nr", "item", "items", "work", "works",
]);

/**
 * The words worth matching on.
 *
 * Numbers and units of measure are **kept** — "25 MPa" and "30 MPa" are different items, and
 * dropping the digits makes them the same one. That is the single most expensive mistake this
 * function could make, because the two are otherwise worded identically.
 */
export function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.,]/gu, " ")
    .split(/\s+/)
    .map((word) => word.replace(/[.,]+$/, ""))
    .filter((word) => word.length > 0 && !NOISE.has(word))
    .map(singular);
}

/**
 * One word for "trench" and "trenches", "pier" and "piers".
 *
 * A bill says "Excavate trenches" and a library says "Excavate trench"; without this the same item
 * scored a half and was never offered. Deliberately crude – a plural "s" or "es" off the end, never
 * off "ss" ("class", "glass") – because a cleverer stemmer would start merging words a QS keeps apart.
 */
function singular(word: string): string {
  if (/\d/.test(word) || word.length <= 3) return word;
  if (/(ch|sh|ss|x)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** "m²" and "m2" are one unit – a bill writes the first and a rate schedule the second. */
export function sameUnit(a: string, b: string): boolean {
  const norm = (u: string) =>
    u.trim().toLowerCase().replace(/\.$/, "").replace("²", "2").replace("³", "3").replace(/^sqm$/, "m2").replace(/^cum$/, "m3").replace(/^(nr|each|ea)$/, "no");
  return norm(a) === norm(b);
}

/** Any token carrying a digit — `25`, `220mm`, `1,5m`. In this trade that is a specification. */
const numeric = (words: readonly string[]) => new Set(words.filter((w) => /\d/.test(w)));

/**
 * Whether a library entry's specification is satisfied by a bill item's.
 *
 * **Every number the library entry states must appear in the bill item.** The library entry is the
 * claim about what is being priced: if it says 25 MPa, the item must say 25 MPa. The bill may carry
 * extra numbers — a depth, a thickness, a range — because a bill is more specific than a schedule
 * on purpose, and that must not disqualify it.
 *
 * This is not a refinement of the word score, it is a gate in front of it. Without it a rate for
 * 30 MPa concrete scores 0,8 against a 25 MPa item — four of five words agree — and is offered as a
 * good match. That is the ASAQS failure exactly: a plausible figure for the wrong thing.
 */
export function specificationHolds(item: string, entry: string): boolean {
  const wanted = numeric(significantWords(entry));
  if (wanted.size === 0) return true;

  const has = numeric(significantWords(item));
  for (const number of wanted) if (!has.has(number)) return false;
  return true;
}

/**
 * How alike two descriptions are, from 0 to 1.
 *
 * The overlap of their significant words against the smaller of the two sets, not against the
 * union: a library entry reading "Concrete, 25 MPa, in strip footings" and a bill item reading
 * "25 MPa concrete in strip footings, in trenches not exceeding 1,5m deep" describe the same work,
 * and scoring them against the union would punish the bill for being more specific — which is what
 * a bill is *for*.
 *
 * Exactly 1 means every significant word of the shorter description is present in the longer. Note
 * that it does **not** mean the two say the same thing: a generic "Concrete in strip footings" also
 * scores 1 against a 25 MPa item, which is why `exact` below is a different question.
 */
export function similarity(a: string, b: string): number {
  const left = new Set(significantWords(a));
  const right = new Set(significantWords(b));
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;

  return shared / Math.min(left.size, right.size);
}

/**
 * Whether the two describe the same item in the same words — the same significant words, both ways.
 *
 * `score === 1` is not this, and conflating them is the bug this function exists to prevent: a
 * library entry reading "Concrete in strip footings" scores 1 against "25 MPa concrete in strip
 * footings" because every one of its own words is present. It is a plausible rate for a less
 * specific item, and it is not a certainty. Only a certainty is offered in bulk.
 */
export const sameItem = (a: string, b: string): boolean => {
  const left = new Set(significantWords(a));
  const right = new Set(significantWords(b));
  return left.size === right.size && [...left].every((word) => right.has(word));
};

/** A library rate offered for a bill row, and how confident the offer is. */
export interface RateMatch {
  rowId: string;
  /** The bill's own words, so a reader comparing the two does not have to go and find them. */
  description: string;
  unit: string;
  rate: LibraryRate;
  /** 1 where every significant word of the shorter description is present in the other. */
  score: number;
  /** True only at 1. What "apply the certain ones" means, and the only thing offered in bulk. */
  exact: boolean;
}

/**
 * Below this a match is not worth a reader's time.
 *
 * Chosen to be generous enough to survive a bill's extra qualifying words and mean enough to
 * exclude "Concrete in slabs" matching "Concrete in footings" — those share "concrete" and nothing
 * else that matters, which on a two-word library entry scores 0,5.
 */
export const FLOOR = 0.6;

/**
 * What the library could price on this bill.
 *
 * Only rows that are **items**, not struck out, and **have no rate yet** — a QS's own figure is
 * never a candidate for replacement, and neither is one already carried from elsewhere. Silence
 * about a row that is already priced is the point: this offers work, it does not audit it.
 *
 * `asAt` is passed through to `ratesInForce`, so a bill is priced from the rates that applied on a
 * date rather than from whatever the library holds now. A bill re-priced next quarter should move
 * because the rates moved, not because the function was run again.
 */
export function matchRates(
  rows: readonly BillRow[],
  library: readonly LibraryRate[],
  options: { region?: string | null; asAt?: string } = {},
): RateMatch[] {
  const { region = null, asAt } = options;

  const inForce = ratesInForce(library, asAt).filter((rate) =>
    // A region asked for is a region required. A rate stating none is national and always eligible;
    // a rate stating a different province is a different price for a reason.
    region === null ? true : rate.region === region || rate.region === null,
  );

  const matches: RateMatch[] = [];

  for (const row of rows) {
    if (row.rowType !== "item" || row.omitted) continue;

    const working = workingRow(row);
    if (working.rate !== null) continue;

    const description = working.description?.trim() ?? "";
    const unit = working.unit?.trim() ?? "";
    if (description === "" || unit === "") continue;

    let best: RateMatch | null = null;

    for (const rate of inForce) {
      // Not a weaker candidate — not a candidate. See the note at the top of this file.
      if (!sameUnit(rate.unit, unit)) continue;

      // The gate, ahead of the score: a 30 MPa rate is not a 0,8 match for a 25 MPa item.
      if (!specificationHolds(description, rate.description)) continue;

      const score = similarity(description, rate.description);
      if (score < FLOOR) continue;

      const exact = sameItem(description, rate.description);

      /*
        A certainty beats a good guess, then the better score, then the newer rate.

        The order matters and the first term is the one worth stating: a generic entry scores 1
        against a specific item, so on score alone "Concrete in strip footings" ties with
        "25 MPa concrete in strip footings" and whichever the library happened to list first would
        win. Two library entries genuinely tied means the practice priced the item twice under
        slightly different words, and the later price is the one it would use.
      */
      const better =
        !best ||
        (exact && !best.exact) ||
        (exact === best.exact &&
          (score > best.score ||
            (score === best.score && rate.effectiveDate > best.rate.effectiveDate)));

      if (better) best = { rowId: row.id, description, unit, rate, score, exact };
    }

    if (best) matches.push(best);
  }

  return matches;
}

/** What the offer comes to, for a panel that has to say whether it is worth opening. */
export interface MatchTally {
  /** Rows the library can price at all. */
  offered: number;
  /** Of those, the ones where every significant word agrees. */
  exact: number;
  /** Items with no rate that the library could not match — the ones a build-up would answer. */
  unmatched: number;
}

export function tallyMatches(
  rows: readonly BillRow[],
  matches: readonly RateMatch[],
): MatchTally {
  const unpriced = rows.filter(
    (row) => row.rowType === "item" && !row.omitted && workingRow(row).rate === null,
  ).length;

  return {
    offered: matches.length,
    exact: matches.filter((m) => m.exact).length,
    unmatched: unpriced - matches.length,
  };
}

/**
 * A resource looked up in the library — what prices a build-up's components.
 *
 * Deliberately shaped as `{ description, unit }` rather than importing the method's own type: this
 * module knows how to find a rate for a described thing in a unit, and it has no business knowing
 * that the thing came from a model. The same function would price a component a QS typed.
 */
export interface PricedResource<T> {
  component: T;
  rate: LibraryRate | null;
  score: number;
  exact: boolean;
}

/**
 * Price a list of resources from the library.
 *
 * Same rules as a bill row, and for the same reasons: the unit must agree exactly, and a stated
 * specification must hold. A component the library cannot price comes back with `rate: null` rather
 * than being dropped — a build-up quietly short of one line is the confident wrong number §5 exists
 * to prevent, and `computeBuildUp` already counts incomplete lines out loud for the same reason.
 */
export function priceResources<T extends { description: string; unit: string }>(
  components: readonly T[],
  library: readonly LibraryRate[],
  options: { region?: string | null; asAt?: string } = {},
): PricedResource<T>[] {
  const { region = null, asAt } = options;

  const inForce = ratesInForce(library, asAt).filter((rate) =>
    region === null ? true : rate.region === region || rate.region === null,
  );

  return components.map((component) => {
    let best: PricedResource<T> = { component, rate: null, score: 0, exact: false };

    for (const rate of inForce) {
      if (rate.unit.trim().toLowerCase() !== component.unit.trim().toLowerCase()) continue;
      if (!specificationHolds(component.description, rate.description)) continue;

      const score = similarity(component.description, rate.description);
      if (score < FLOOR) continue;

      const exact = sameItem(component.description, rate.description);
      const better =
        best.rate === null ||
        (exact && !best.exact) ||
        (exact === best.exact &&
          (score > best.score ||
            (score === best.score && rate.effectiveDate > best.rate.effectiveDate)));

      if (better) best = { component, rate, score, exact };
    }

    return best;
  });
}
