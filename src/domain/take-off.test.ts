/**
 * Resource take-off — the arithmetic a QS will check on a calculator.
 *
 * Every expected figure below is worked by hand in the comment beside it. A test that only asserts
 * the code agrees with itself would pass just as happily on a wrong factor.
 */

import { describe, expect, it } from "vitest";

import {
  isCountable,
  normaliseUnit,
  takeOff,
  type Factor,
} from "@/domain/take-off";
import {
  formatQuantity,
  formatRand,
  parseQuantity,
  percentFromRate,
  rate,
  type Rate,
} from "@/domain/money";

const factor = (over: Partial<Factor> & Pick<Factor, "description" | "unit" | "perUnit">): Factor => ({
  kind: "material",
  ...over,
});

/*
  The formatters group thousands with a non-breaking space and put one after the R. Comparing
  against a literal would mean pasting invisible characters into every expectation below and
  hoping an editor never normalised one — so the separator is flattened to an ordinary space and
  the figures stay readable. What is being asserted is the arithmetic, not the typography;
  `money.test.ts` is where the spacing itself is held.
*/
const flat = (s: string) => s.replace(/\s/gu, " ");
const qty = (q: Parameters<typeof formatQuantity>[0], decimals: number) =>
  flat(formatQuantity(q, decimals));
const rand = (m: Parameters<typeof formatRand>[0]) => flat(formatRand(m));

/** One square metre of one-brick walling, as a method would state it. */
const ONE_BRICK_WALL: Factor[] = [
  factor({ description: "Stock brick", unit: "no", perUnit: parseQuantity("104") }),
  factor({ description: "Mortar", unit: "m3", perUnit: parseQuantity("0.045") }),
  factor({
    kind: "labour",
    description: "Bricklayer",
    unit: "hour",
    perUnit: parseQuantity("1.2"),
  }),
];

describe("scaling a method by what was measured", () => {
  it("multiplies each factor by the work", () => {
    const result = takeOff(ONE_BRICK_WALL, parseQuantity("240"), "m2", percentFromRate(0));

    // 104 × 240 = 24 960 bricks.
    expect(qty(result.resources[0]!.net, 0)).toBe("24 960");
    // 0,045 × 240 = 10,8 m³ of mortar.
    expect(qty(result.resources[1]!.net, 1)).toBe("10,8");
    // 1,2 × 240 = 288 hours.
    expect(qty(result.resources[2]!.net, 0)).toBe("288");
  });

  it("keeps the quantity exact rather than passing it through a number", () => {
    // 0,0125 m³ of mortar per m² over 1 234,5678 m² — the kind of figure a float loses.
    const result = takeOff(
      [factor({ description: "Mortar", unit: "m3", perUnit: parseQuantity("0.0125") })],
      parseQuantity("1234.5678"),
      "m2",
      percentFromRate(0),
    );

    // 1 234,5678 × 0,0125 = 15,4320975 → 15,4321 at four places.
    expect(qty(result.resources[0]!.net, 4)).toBe("15,4321");
  });
});

describe("waste reaches the materials and stops there", () => {
  const result = takeOff(ONE_BRICK_WALL, parseQuantity("240"), "m2", percentFromRate(5));

  it("adds the allowance to a material", () => {
    // 24 960 × 1,05 = 26 208 bricks.
    expect(qty(result.resources[0]!.gross, 0)).toBe("26 208");
    // 10,8 × 1,05 = 11,34 m³.
    expect(qty(result.resources[1]!.gross, 2)).toBe("11,34");
  });

  it("and leaves labour alone, because nobody orders five per cent more bricklayer", () => {
    /*
      The deliberate divergence from `buildUpRate`, which spreads waste across the whole net.
      That one produces a cost and this one produces an order: waste is cutting and breakage, and
      inflating the hours would overstate the programme in a way that looks right.
    */
    expect(result.resources[2]!.gross).toBe(result.resources[2]!.net);
    expect(qty(result.resources[2]!.gross, 0)).toBe("288");
  });
});

describe("what to order is not what is consumed", () => {
  it("rounds a countable material up, because a purchase rounded down leaves a wall short", () => {
    const result = takeOff(
      [factor({ description: "Stock brick", unit: "no", perUnit: parseQuantity("104") })],
      parseQuantity("43.1"),
      "m2",
      percentFromRate(0),
    );

    // 104 × 43,1 = 4 482,4 bricks consumed; you buy 4 483.
    expect(qty(result.resources[0]!.net, 1)).toBe("4 482,4");
    expect(result.resources[0]!.order).toBe(4483n);
  });

  it("leaves a whole figure whole rather than adding a spare one", () => {
    const result = takeOff(
      [factor({ description: "Stock brick", unit: "no", perUnit: parseQuantity("100") })],
      parseQuantity("10"),
      "m2",
      percentFromRate(0),
    );
    expect(result.resources[0]!.order).toBe(1000n);
  });

  it("offers no order figure for a measured unit", () => {
    // "Order 11 m³ of mortar" is a different claim from "11 m³ of mortar is consumed", and only
    // one of them is arithmetic.
    const result = takeOff(ONE_BRICK_WALL, parseQuantity("240"), "m2", percentFromRate(5));
    expect(result.resources[1]!.order).toBeNull();
    expect(result.resources[2]!.order).toBeNull();
  });

  it("and none for a unit it does not recognise, rather than guessing one", () => {
    const result = takeOff(
      [factor({ description: "Something", unit: "furlong", perUnit: parseQuantity("2") })],
      parseQuantity("3"),
      "m2",
      percentFromRate(0),
    );
    expect(result.resources[0]!.order).toBeNull();
  });

  it("reads a unit however the supplier's spreadsheet spelled it", () => {
    for (const unit of ["no", "No", "NO.", "no .", " No. "]) {
      expect(isCountable(unit)).toBe(true);
    }
    expect(normaliseUnit("No .")).toBe("no");
    expect(isCountable("m3")).toBe(false);
    expect(isCountable("hour")).toBe(false);
  });
});

describe("the money, where the library can supply it", () => {
  const prices: Readonly<Record<string, Rate>> = {
    // R1,8500 a brick, carried to four places — §5.1's low-value high-volume case exactly.
    "Stock brick": rate(18500n, 4),
    Mortar: rate(185000n, 2),
    Bricklayer: rate(8500n, 2),
  };
  const priceOf = (f: Factor) => prices[f.description] ?? null;

  it("costs each resource from its gross, rounded once", () => {
    const result = takeOff(ONE_BRICK_WALL, parseQuantity("240"), "m2", percentFromRate(5), priceOf);

    // 26 208 bricks × R1,8500 = R48 484,80.
    expect(rand(result.resources[0]!.cost!)).toBe("R 48 484,80");
    // 11,34 m³ × R1 850,00 = R20 979,00.
    expect(rand(result.resources[1]!.cost!)).toBe("R 20 979,00");
    // 288 hours × R85,00 = R24 480,00 — no waste on the hours.
    expect(rand(result.resources[2]!.cost!)).toBe("R 24 480,00");

    // 48 484,80 + 20 979,00 + 24 480,00 = R93 943,80.
    expect(rand(result.cost)).toBe("R 93 943,80");
    expect(result.unpriced).toBe(0);
  });

  it("counts what it could not price rather than treating it as free", () => {
    /*
      The difference between a total that is incomplete and a total that is wrong. A nought for an
      unpriced resource would make the answer too low and still look finished — §1.3, a gap is
      stated.
    */
    const result = takeOff(
      ONE_BRICK_WALL,
      parseQuantity("240"),
      "m2",
      percentFromRate(5),
      (f) => (f.description === "Mortar" ? null : priceOf(f)),
    );

    expect(result.unpriced).toBe(1);
    expect(result.resources[1]!.cost).toBeNull();
    // 48 484,80 + 24 480,00, with nothing at all standing in for the mortar.
    expect(rand(result.cost)).toBe("R 72 964,80");
  });

  it("prices nothing when nothing was passed a library", () => {
    const result = takeOff(ONE_BRICK_WALL, parseQuantity("240"), "m2", percentFromRate(5));
    expect(result.unpriced).toBe(3);
    expect(rand(result.cost)).toBe("R 0,00");
  });
});

describe("edges", () => {
  it("takes nothing off nothing", () => {
    const result = takeOff([], parseQuantity("240"), "m2", percentFromRate(5));
    expect(result.resources).toEqual([]);
    expect(result.unpriced).toBe(0);
  });

  it("handles a work quantity of nought without inventing an order", () => {
    const result = takeOff(ONE_BRICK_WALL, parseQuantity("0"), "m2", percentFromRate(5));
    expect(qty(result.resources[0]!.gross, 0)).toBe("0");
    // Nought bricks is nought bricks — `wholeUnits` must not round a nought up to one.
    expect(result.resources[0]!.order).toBe(0n);
  });
});
