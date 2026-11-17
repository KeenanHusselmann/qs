/**
 * What the document said the unit was, against what the field records it in.
 *
 * ── The 12× error ──────────────────────────────────────────────────────────────────────────
 *
 * `absorption` is recorded in **units/yr**. A market study is as likely to say "12 units per
 * month". Nothing in the platform noticed: the value went in as the agent read it, the row
 * appended the field's own unit beside it, and the screen read
 *
 *     12 units per month   units/yr
 *
 * — which is two different rates printed side by side as though they were one figure. Everything
 * downstream then divides a scheme by 12 a year instead of 144, and the absorption rate is what
 * the sales programme and the cash flow are built on. Nothing crashed, nothing was blank, and the
 * confidence badge said 100%.
 *
 * This is the class of defect §5 exists for — a misread that is *silent*, survives review, and
 * lands in a figure nobody can reproduce. The same shape appears wherever a document may state a
 * unit the field does not use: an erf in hectares against a field in m², a programme in years
 * against a field in months, a cost plan in dollars against a field in rand.
 *
 * ── It proposes, it does not block ─────────────────────────────────────────────────────────
 *
 * Deterministic, no model call, and it never rewrites the figure. Converting "12 per month" to
 * "144 per year" behind the reader's back would put a number in the data model that no document
 * states, which is the one thing this platform does not do. So it says what it found, states the
 * arithmetic where the conversion is exact, and leaves the correction to the person — who has the
 * override box on the same row.
 *
 * ── Why it also fixes the duplicated suffix ────────────────────────────────────────────────
 *
 * A value that already says "48 m²" does not need "m²" appended to it, and "R 737 558 R" was on
 * every money row on the screen. Telling the reader the unit is the row's job; saying it twice is
 * how a reader learns to stop reading it. Once the agreement is known, the suffix is only added
 * when the value is silent about its own unit.
 */

import { readQuantity } from "@/domain/amount";
import { QUANTITY_SCALE } from "@/domain/money";

/** Whether the value said anything about its unit, and whether it was the field's. */
export type UnitAgreement = "silent" | "agrees" | "differs";

export interface UnitReading {
  agreement: UnitAgreement;
  /** How the value stated its unit, in the document's own terms — "per month", "in hectares". */
  stated: string | null;
  /** What the field records in. */
  expected: string | null;
  /** Plain words for the row. Only ever set when they differ. */
  note: string | null;
}

/** One way a document might write a unit, and what it is worth in the field's unit. */
interface UnitForm {
  match: RegExp;
  /**
   * The phrase to say it back with, preposition included.
   *
   * "in hectares" and "per month" are both right and neither is a noun, so the form carries the
   * whole phrase rather than a name the sentence has to guess a preposition for. "states this in
   * a month" was what guessing produced.
   */
  phrase: string;
  /**
   * Multiply the stated figure by this to express it in the field's unit.
   *
   * `1` means the document already used the field's unit. `null` means there is no exact
   * conversion, so the reading says what it found and offers no arithmetic — a rate per week
   * against a rate per year is not a factor of 52, and pretending otherwise would be the same
   * silent misread one layer up.
   */
  factor: number | null;
}

/**
 * The dimensions the field sets actually use.
 *
 * Keyed by the spec's own unit string, so a field set that introduces a new unit gets `silent`
 * rather than a wrong reading — an unknown unit is a thing nobody has taught this to check, and
 * guessing at it is exactly the behaviour the module exists to prevent.
 */
const DIMENSIONS: Readonly<Record<string, readonly UnitForm[]>> = {
  R: [
    { match: /(?:^|[\s(])(?:R|ZAR|rand)\b/i, phrase: "in rand", factor: 1 },
    { match: /(?:^|[\s(])(?:US\$|USD|\$)/i, phrase: "in US dollars", factor: null },
    { match: /(?:^|[\s(])(?:EUR|€)/i, phrase: "in euro", factor: null },
    { match: /(?:^|[\s(])(?:GBP|£)/i, phrase: "in pounds", factor: null },
  ],

  // `\b` cannot follow `²`: a word boundary needs a word character on one side, and `²` is not
  // one — so `/\bm²\b/` never matches "48 m²", which is the single commonest value in the corpus.
  // The superscript forms are matched without a trailing boundary; the ASCII ones keep theirs.
  "m²": [
    { match: /(?:\bm2\b|m²|\bsqm\b|\bsquare\s+met(?:re|er)s?\b)/i, phrase: "in square metres", factor: 1 },
    { match: /\b(?:ha|hectares?)\b/i, phrase: "in hectares", factor: 10_000 },
    { match: /(?:\bft2\b|ft²|\bsqft\b|\bsquare\s+f(?:ee|oo)t\b)/i, phrase: "in square feet", factor: null },
  ],

  months: [
    { match: /\bmonths?\b/i, phrase: "in months", factor: 1 },
    { match: /\b(?:years?|annum)\b/i, phrase: "in years", factor: 12 },
    { match: /\bweeks?\b/i, phrase: "in weeks", factor: null },
    { match: /\bdays?\b/i, phrase: "in days", factor: null },
  ],

  "units/yr": [
    { match: /\b(?:per\s+annum|p\.?a\.?|per\s+year|yearly|annually|a\s+year|\/\s*(?:yr|year|a))\b/i, phrase: "per year", factor: 1 },
    { match: /\b(?:per\s+month|monthly|a\s+month|\/\s*(?:mo|month))\b/i, phrase: "per month", factor: 12 },
    { match: /\b(?:per\s+quarter|quarterly|a\s+quarter)\b/i, phrase: "per quarter", factor: 4 },
    { match: /\b(?:per\s+week|weekly|a\s+week|\/\s*(?:wk|week))\b/i, phrase: "per week", factor: null },
  ],
};

/**
 * How to say the field's own unit inside a sentence.
 *
 * A spec's `unit` is a column suffix — "R", "units/yr" — which is right beside a figure and wrong
 * in prose. "This field records R" is not a sentence a QS would write.
 */
const FIELD_PHRASE: Readonly<Record<string, string>> = {
  R: "rand",
  "m²": "square metres",
  months: "months",
  "units/yr": "units per year",
};

/** Group thousands the way §7.7 writes them, and drop a decimal part that is all noughts. */
function grouped(value: number): string {
  const fixed = value.toFixed(QUANTITY_SCALE).replace(/\.?0+$/, "");
  const [whole, fraction] = fixed.split(".");

  let out = "";
  for (let i = 0; i < whole.length; i++) {
    const fromEnd = whole.length - i;
    out += whole[i];
    if (fromEnd > 1 && (fromEnd - 1) % 3 === 0) out += " ";
  }

  return fraction ? `${out},${fraction}` : out;
}

/**
 * The figure the value leads with, expressed in the field's unit.
 *
 * `readQuantity` refuses a ratio outright — "something per something is not a quantity on its own"
 * — which is right, and means a rate has to be cut at its "per" before the number can be read.
 * Returns `null` whenever the number cannot be read with certainty, and the reading then states
 * the mismatch without arithmetic. A conversion nobody can check is worth less than none.
 */
function convert(value: string, factor: number): string | null {
  const leading = value.split(/\bper\b|\//i)[0] ?? value;
  const reading = readQuantity(leading);
  if (!reading.ok) return null;

  const scaled = Number(reading.quantity) / 10 ** QUANTITY_SCALE;
  if (!Number.isFinite(scaled)) return null;

  return grouped(scaled * factor);
}

/**
 * Read a value's own unit against the one its field records in.
 *
 * A value that says nothing about its unit is `silent`, not wrong — most figures are written bare
 * and the field supplies the unit. Only a value that names a *different* unit is a finding.
 */
export function readUnit(
  value: string | null | undefined,
  expected: string | null | undefined,
): UnitReading {
  const silent: UnitReading = { agreement: "silent", stated: null, expected: expected ?? null, note: null };

  if (!value || !expected) return silent;

  const forms = DIMENSIONS[expected];
  if (!forms) return silent;

  const found = forms.find((form) => form.match.test(value));
  if (!found) return silent;

  if (found.factor === 1) {
    return { agreement: "agrees", stated: found.phrase, expected, note: null };
  }

  // §7.7 — an error says what to do next, and names both figures rather than only the complaint.
  const equivalent = found.factor === null ? null : convert(value, found.factor);

  const note =
    equivalent === null
      ? `The document states this ${found.phrase}. This field records ${FIELD_PHRASE[expected] ?? expected}, and there is no exact conversion — read it and correct the figure by hand.`
      : `The document states this ${found.phrase}. This field records ${FIELD_PHRASE[expected] ?? expected}: that is ${equivalent}. Correct it if the figure is not already in the field's unit.`;

  return { agreement: "differs", stated: found.phrase, expected, note };
}
