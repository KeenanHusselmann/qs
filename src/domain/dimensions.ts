/**
 * Dimension sheets – the arithmetic of measurement (D1.2, the Standard System of Measuring).
 *
 * ── A dimension line is a product, and the item is the sum of its lines ─────────────────────
 *
 * A QS measures on "dim paper": each line is a timesing factor and up to three dimensions –
 * length, width, depth – whose product is the line's contribution; a deduction (an opening in a
 * wall, a void in a slab) is the same product taken away. The item's quantity is the sum of its
 * lines, and it is what goes to the bill.
 *
 *     3 / 4,20 × 2,70           = 34,02 m²   three walls
 *       / 0,90 × 2,10  (ddt)    = −1,89 m²   one door
 *                                 32,13 m²
 *
 * ── Exact, at the scale the bill holds ─────────────────────────────────────────────────────
 *
 * Every figure is a `Quantity` – `bigint` at four decimal places – and a product of scaled
 * figures is rescaled once per multiplication, rounded half away from zero. That is the same
 * number of places the bill column holds, so a quantity sent from a take-off lands in the bill
 * as it was measured, not as a float approximated it.
 *
 * ── How many dimensions follows from the unit, and is checked ──────────────────────────────
 *
 * A linear item takes one dimension, an area two, a volume three, a count none. A line with the
 * wrong number of dimensions for its item's unit is the commonest measurement slip – a wall's
 * height left off, so its area was booked as metres – and it is reported, not silently summed.
 */

import { QUANTITY_SCALE, quantity, type Quantity } from "@/domain/money";

const ONE = 10n ** BigInt(QUANTITY_SCALE);

const roundDiv = (n: bigint, d: bigint): bigint => {
  const negative = n < 0n !== d < 0n;
  const a = n < 0n ? -n : n;
  const b = d < 0n ? -d : d;
  const q = (a * 2n + b) / (b * 2n);
  return negative ? -q : q;
};

/** Two scaled quantities multiplied, rescaled once. */
export const times = (a: Quantity, b: Quantity): Quantity => quantity(roundDiv(a * b, ONE));

export interface DimensionLine {
  /** The timesing factor – "3 /" for three identical walls. One where none is written. */
  timesing: Quantity;
  dimensions: readonly Quantity[];
  deduct: boolean;
}

/** How many dimensions a unit is measured in – null where the unit says nothing (a sum, an item). */
export function dimensionsFor(unit: string | null): number | null {
  const u = (unit ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (["m", "lm", "m1"].includes(u)) return 1;
  if (["m2", "m²", "sqm"].includes(u)) return 2;
  if (["m3", "m³", "cum"].includes(u)) return 3;
  if (["no", "nr", "each", "ea", "item", "pc", "pcs", "set"].includes(u)) return 0;
  return null;
}

/** One line's signed contribution. */
export function lineQuantity(line: DimensionLine): Quantity {
  const product = line.dimensions.reduce<Quantity>((acc, d) => times(acc, d), line.timesing);
  return quantity(line.deduct ? -product : product);
}

export interface SheetResult {
  total: Quantity;
  lines: Quantity[];
  /** Lines whose dimension count does not match the unit – by position, with a sentence. */
  mismatched: { index: number; reason: string }[];
  /** A total below nought is a measurement error: more deducted than measured. */
  negative: boolean;
}

export function measure(unit: string | null, lines: readonly DimensionLine[]): SheetResult {
  const wanted = dimensionsFor(unit);
  const mismatched: SheetResult["mismatched"] = [];
  const quantities = lines.map((line, index) => {
    if (wanted !== null && line.dimensions.length !== wanted) {
      const name = ["a count", "one dimension", "two dimensions", "three dimensions"][wanted];
      mismatched.push({
        index,
        reason: `Line ${index + 1} has ${line.dimensions.length} ${line.dimensions.length === 1 ? "dimension" : "dimensions"}; an item in ${unit} is measured in ${name}.`,
      });
    }
    return lineQuantity(line);
  });
  const total = quantity(quantities.reduce((sum, q) => sum + q, 0n));
  return { total, lines: quantities, mismatched, negative: total < 0n };
}
