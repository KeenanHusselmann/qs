/**
 * The practice's own resource factors — reading them, and choosing which apply.
 *
 * ── What this is for ───────────────────────────────────────────────────────────────────────
 *
 * A take-off needs to know how much of a resource one unit of work consumes. Two places can answer:
 * the model, which proposes a method, and **this**, which is what the practice has written down.
 *
 * Where the practice has written it down, that wins — not because a firm's number is always better
 * than a general one, but because it is *theirs*: it can be defended, it can be corrected once and
 * stay corrected, and it does not change between two identical questions. The model gave 0,10 and
 * then 0,15 hours of mixer per m² on the same day, which is why this table exists.
 *
 * ── Matched on words, not on an exact string ───────────────────────────────────────────────
 *
 * A reader types "one-brick wall in stock brick"; the library holds "One-brick wall, stock brick,
 * in superstructure". Requiring them to match character for character would mean a practice never
 * gets its own numbers back, so the same significant-word comparison the rate library uses to match
 * a bill row is used here — including `specificationHolds`, which is the gate that stops a factor
 * for 220mm brickwork answering a question about 110mm.
 *
 * ── In force as at a date, exactly like a rate ─────────────────────────────────────────────
 *
 * Append-only (§6.3): revising a factor inserts a row with a later `effective_date`. So "the
 * factor" is the newest row not later than the date being read at, per resource — never "the last
 * row inserted". A cost plan priced last March was priced on last March's assumptions.
 */

import { percentFromRate, parseQuantity, type Percent } from "@/domain/money";
import type { Factor } from "@/domain/take-off";
import { significantWords, similarity, specificationHolds } from "@/lib/rate-match";
import type { ComponentKind } from "@/lib/pricing";

/** A factor as the application reads it. Mirrors the row; `numeric` arrives as a string. */
export interface ResourceFactor {
  id: string;
  work: string;
  workUnit: string;
  kind: ComponentKind;
  resource: string;
  resourceUnit: string;
  /** Per one unit of the work. `numeric(18,4)` as text — never a float. */
  quantity: string;
  /** Decimal fraction. Null where none was stated, which is not the same as nought. */
  wasteRate: string | null;
  region: string | null;
  source: string;
  effectiveDate: string;
}

/**
 * How alike two descriptions of *work* must be before the practice's factor is used for it.
 *
 * Higher than `rate-match`'s 0,6. A rate offered against a bill row is a suggestion a QS sees on
 * the row and can reject; a factor is applied silently inside an answer, and the reader sees the
 * result rather than the choice. Being wrong here is worse, so it asks for more agreement.
 */
export const WORK_FLOOR = 0.75;

/** The words a work description shares with a factor's, both ways — the strict half of the match. */
const bothWays = (a: string, b: string): number => {
  const left = new Set(significantWords(a));
  const right = new Set(significantWords(b));
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.max(left.size, right.size);
};

/**
 * The factors in force for one piece of work.
 *
 * Empty where the practice holds nothing that matches, which is the ordinary case for work it has
 * not costed before — the caller then falls back to the model and says so. **Never a partial
 * guess:** a set of factors that covered the bricks and missed the mortar would produce a take-off
 * that looked complete and was not.
 *
 * `asAt` defaults to today. Passing it is what lets a bill be taken off on the assumptions that
 * applied when it was drafted rather than the ones in force now.
 */
export function factorsFor(
  work: string,
  workUnit: string,
  library: readonly ResourceFactor[],
  options: { region?: string | null; asAt?: string } = {},
): ResourceFactor[] {
  const { region = null, asAt = new Date().toISOString().slice(0, 10) } = options;
  const unit = workUnit.trim().toLowerCase();

  const eligible = library.filter(
    (factor) =>
      factor.workUnit.trim().toLowerCase() === unit &&
      factor.effectiveDate <= asAt &&
      // A factor stating no region applies everywhere; one stating another province does not.
      // The same rule `matchRates` follows, so the two cannot disagree about eligibility.
      (region === null || factor.region === region || factor.region === null) &&
      // The gate before the score: a factor for 220mm brickwork must not answer for 110mm.
      specificationHolds(work, factor.work) &&
      similarity(work, factor.work) >= WORK_FLOOR &&
      bothWays(work, factor.work) >= WORK_FLOOR,
  );

  if (eligible.length === 0) return [];

  /*
    One row per resource: the newest in force.

    Keyed on the resource and its unit together, because "Cement" in kilograms and "Cement" in
    pockets are two ways of stating the same input and a practice may hold both — collapsing them
    on description alone would drop one at random.

    Ties go to the row entered last, the same tie-break `ratesInForce` uses and for the same
    reason: two factors effective the same day means somebody corrected the first.
  */
  const newest = new Map<string, ResourceFactor>();
  for (const factor of eligible) {
    const key = resourceKey(factor.resource, factor.resourceUnit);
    const held = newest.get(key);
    if (!held || factor.effectiveDate >= held.effectiveDate) newest.set(key, factor);
  }

  return [...newest.values()];
}

/**
 * The key two descriptions of one resource must share for one to override the other.
 *
 * Exact string comparison was not enough and the failure was expensive: the model proposes "Stock
 * bricks" and a factor says "Stock brick", so the override did not fire, both survived into the
 * take-off, and the wall was given its bricks **twice** — with the total counting both. A
 * double-counted order is worse than a missing one, because nothing about it looks wrong.
 *
 * So: case, punctuation and a trailing plural are all noise. The plural rule is deliberately
 * conservative — a trailing `s` is dropped only from a word of more than three letters that does
 * not already end in `ss`, so "bricks" and "hours" fold while "glass" and "sand" are untouched.
 * It is not a stemmer and should not become one; anything cleverer would start folding words that
 * mean different things.
 */
export const resourceKey = (resource: string, unit: string): string => {
  const fold = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word))
      .join(" ");

  return `${fold(resource)} ${fold(unit)}`;
};

/** A held factor, in the shape the arithmetic takes. */
export function asFactor(row: ResourceFactor): Factor {
  return {
    kind: row.kind,
    description: row.resource,
    unit: row.resourceUnit,
    perUnit: parseQuantity(row.quantity),
    // Undefined rather than nought where none was stated, so `takeOff` falls back to the method's
    // allowance instead of silently applying none.
    waste: row.wasteRate === null ? undefined : wastePercent(row.wasteRate),
  };
}

/**
 * A stored decimal fraction as a `Percent`.
 *
 * The column holds 0,0500 for five per cent (§5.1's convention for a rate, not a whole number), and
 * `percentFromRate` takes the whole number — so the fraction is multiplied out rather than passed
 * straight through, which would have applied a five per cent allowance as five thousandths of one.
 */
export function wastePercent(fraction: string): Percent {
  return percentFromRate(Number(fraction) * 100);
}
