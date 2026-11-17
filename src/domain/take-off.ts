/**
 * Resource take-off — how much of each material a measured quantity of work consumes.
 *
 * ── The question this answers, and why it is not a pricing question ────────────────────────
 *
 * "How many bricks do I need for 240 m² of one-brick wall?" A QS answers it from a factor — about
 * 104 bricks in a square metre of one-brick walling — times the measured area, plus an allowance
 * for cutting and breakage. It is arithmetic over a measurement fact, and it is the calculation a
 * QS does most often and least enjoys doing by hand.
 *
 * The factor comes from `build-up-method.ts`, which asks the model what a unit of work is *made of*
 * and takes back quantities only. That is the ASAQS discipline this platform is built on: asking a
 * language model what something **costs** is asking it to remember a number and it will produce a
 * plausible one with nothing behind it, while asking what a square metre of walling **contains** is
 * asking for a measurement fact — stable across decades, published in every measurement standard,
 * and wrong in a way a QS spots instantly.
 *
 * So the model supplies the factor, **this file does the arithmetic**, and the rate library supplies
 * the money. No figure here was remembered by anything.
 *
 * ── Waste applies to materials and to nothing else ─────────────────────────────────────────
 *
 * This is a deliberate divergence from `buildUpRate`, which applies waste to the whole net
 * including labour. The two are answering different questions and the difference is not an
 * inconsistency:
 *
 * - `buildUpRate` produces a **cost**. A waste percentage there is a cost allowance on delivered
 *   cost, and spreading it across the net is the ordinary convention on a rate build-up sheet.
 * - This produces an **order**. Waste is cutting and breakage (`MethodComponent.wastePercent` says
 *   so in as many words), and you do not order five per cent more bricklayer. Adding it to labour
 *   hours would overstate the programme, which is worse than useless because it looks right.
 *
 * ── What to order is a separate figure from what is consumed ───────────────────────────────
 *
 * 4 487,3 bricks is the honest consumption figure and nobody can buy it. So a countable resource
 * carries `order` as well — the whole units, rounded **up**, because rounding a purchase down
 * leaves a wall unfinished.
 *
 * Where the unit is not one this file recognises as countable, `order` is null rather than guessed.
 * §1.3: a gap is stated, never filled with something plausible. A QS reading "order 4 488 m³ of
 * concrete" would lose confidence in every other figure on the page.
 */

import type { ComponentKind } from "@/lib/pricing";
import {
  PERCENT_SCALE,
  QUANTITY_SCALE,
  ZERO_MONEY,
  divideRounded,
  extend,
  multiplyQuantities,
  quantity,
  sum,
  type Money,
  type Percent,
  type Quantity,
  type Rate,
} from "@/domain/money";

/**
 * Units bought as whole things.
 *
 * Deliberately short and deliberately explicit. The alternative — treating anything that is not a
 * recognised measure as countable — would round cubic metres of concrete up to whole numbers the
 * first time somebody wrote "cu.m" instead of "m3".
 *
 * Compared case-insensitively with full stops and spaces stripped, because a rate library filled
 * from half a dozen suppliers' spreadsheets carries "No", "no.", "No .", and "each" for one idea.
 */
const COUNTABLE = new Set([
  "no",
  "nr",
  "num",
  "number",
  "each",
  "ea",
  "unit",
  "units",
  "item",
  "items",
  "bag",
  "bags",
  "pocket",
  "pockets",
  "sheet",
  "sheets",
  "roll",
  "rolls",
  "length",
  "lengths",
  "brick",
  "bricks",
  "block",
  "blocks",
]);

/** `No.` and `no` and `NO .` are one unit. */
export const normaliseUnit = (unit: string): string =>
  unit.toLowerCase().replace(/[.\s]/g, "");

export const isCountable = (unit: string): boolean => COUNTABLE.has(normaliseUnit(unit));

/** One resource that goes into a unit of the work — the factor, before it meets a quantity. */
export interface Factor {
  kind: ComponentKind;
  description: string;
  /** The unit the factor is counted in — "no" for bricks, "m3" for mortar, "hour" for labour. */
  unit: string;
  /** How much of it goes into **one** unit of the work. 104 bricks in a m² of one-brick walling. */
  perUnit: Quantity;
  /**
   * This resource's own cutting-and-breakage allowance, where the practice states one.
   *
   * Brickwork runs at about five per cent and tiling at ten, so a single allowance across a whole
   * build-up either overstates the bricks or understates the tiles. Undefined falls back to the
   * method's own — **absent is not nought**, which is the distinction §1.3 keeps everywhere else.
   */
  waste?: Percent;
}

/** One resource, scaled to the work actually measured. */
export interface TakenOff {
  factor: Factor;
  /** `perUnit × work`. What the work consumes, before any allowance. */
  net: Quantity;
  /** `net × (1 + waste)` for a material; `net` for everything else. What is actually needed. */
  gross: Quantity;
  /**
   * `gross` rounded **up** to whole units, where the unit is one you buy whole.
   *
   * Null for a measured unit, and for anything this file does not recognise — a guessed order
   * figure is worse than none, because it reads exactly like a computed one.
   */
  order: bigint | null;
  /** From the practice's own library. Null where nothing in it prices this resource. */
  rate: Rate | null;
  /** `gross × rate`, rounded once. Null wherever the rate is. */
  cost: Money | null;
}

export interface TakeOff {
  /** What was measured — the quantity the factors were scaled by. */
  work: Quantity;
  unit: string;
  resources: TakenOff[];
  /**
   * The priced resources, added up.
   *
   * §5.2 — a sum of already-rounded amounts, never a re-rounding. Unpriced resources contribute
   * nothing and are counted separately rather than being treated as free, which is the difference
   * between a total that is incomplete and a total that is wrong.
   */
  cost: Money;
  /** How many resources the library could not price. A total with these is a partial total. */
  unpriced: number;
}

/** Percent applied to a quantity. `applyPercent` is the money version of exactly this. */
const growBy = (qty: Quantity, pct: Percent): Quantity =>
  quantity(qty + divideRounded(qty * pct, 10n ** BigInt(PERCENT_SCALE)));

/** Whole units, rounded up. A purchase rounded down leaves the work unfinished. */
const wholeUnits = (qty: Quantity): bigint => {
  const scale = 10n ** BigInt(QUANTITY_SCALE);
  const whole = qty / scale;
  // Truncation goes toward zero, so a positive remainder is the only one that needs a unit adding.
  return qty > 0n && qty % scale !== 0n ? whole + 1n : whole;
};

/**
 * Scale a method's factors by the work measured.
 *
 * `waste` is the method's own allowance, and reaches only the materials — see the note above.
 * `priceOf` is passed in rather than looked up here so this file stays arithmetic: the rate library
 * is a database read, and a domain function that queried one could not be tested against a table of
 * known answers.
 */
export function takeOff(
  factors: readonly Factor[],
  work: Quantity,
  unit: string,
  waste: Percent,
  priceOf: (factor: Factor) => Rate | null = () => null,
): TakeOff {
  const resources = factors.map((factor): TakenOff => {
    const net = multiplyQuantities(factor.perUnit, work);
    // The factor's own allowance where the practice states one, the method's otherwise. `??`, not
    // `||`: a stated nought is a decision — "this material has no waste" — and must survive.
    const allowance = factor.waste ?? waste;
    const gross = factor.kind === "material" ? growBy(net, allowance) : net;
    const rate = priceOf(factor);

    return {
      factor,
      net,
      gross,
      order: isCountable(factor.unit) ? wholeUnits(gross) : null,
      rate,
      /*
        Rounded once, here, from the gross.

        §5.2's single rounding point, in the shape it takes for a resource: the cost of a resource
        is what the work will actually consume of it at the rate the practice holds, and a total is
        the sum of those already-rounded figures.
      */
      cost: rate ? extend(gross, rate) : null,
    };
  });

  const priced = resources.filter((r) => r.cost !== null).map((r) => r.cost!);

  return {
    work,
    unit,
    resources,
    cost: priced.length > 0 ? sum(priced) : ZERO_MONEY,
    unpriced: resources.length - priced.length,
  };
}
