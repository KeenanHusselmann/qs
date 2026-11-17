/**
 * Choosing which of the practice's factors apply.
 *
 * The consequential decision here is *silent*: a reader asks for a brick count and sees a result,
 * not the choice behind it. So the two failures worth guarding are a factor applied to work it does
 * not describe, and a factor the practice holds that never gets used because the phrasing differed.
 */

import { describe, expect, it } from "vitest";

import {
  asFactor,
  factorsFor,
  resourceKey,
  wastePercent,
  WORK_FLOOR,
  type ResourceFactor,
} from "@/lib/factors";
import { formatQuantity, formatPercent, percentFromRate } from "@/domain/money";

const factor = (over: Partial<ResourceFactor> = {}): ResourceFactor => ({
  id: crypto.randomUUID(),
  work: "One-brick wall in stock brick",
  workUnit: "m2",
  kind: "material",
  resource: "Stock brick",
  resourceUnit: "no",
  quantity: "104.0000",
  wasteRate: "0.0500",
  region: null,
  source: "Our own output records 2024-2026",
  effectiveDate: "2026-01-01",
  ...over,
});

const AS_AT = { asAt: "2026-06-01" };

describe("getting the practice's own numbers back", () => {
  it("matches work described in different words", () => {
    // Held one way, asked another. Requiring a character-for-character match would mean a firm
    // never sees its own factors again.
    const held = [factor({ work: "One-brick wall, stock brick, in superstructure" })];
    expect(factorsFor("one-brick wall in stock brick", "m2", held, AS_AT)).toHaveLength(1);
  });

  it("returns every resource the work consumes, not just the first", () => {
    const held = [
      factor(),
      factor({ resource: "Mortar", resourceUnit: "m3", quantity: "0.0450" }),
      factor({ kind: "labour", resource: "Bricklayer", resourceUnit: "hour", quantity: "1.2000" }),
    ];
    expect(factorsFor("One-brick wall in stock brick", "m2", held, AS_AT)).toHaveLength(3);
  });

  it("keeps the same resource held in two units apart", () => {
    /*
      "Cement" in kilograms and "Cement" in pockets are two ways of stating one input and a
      practice may hold both. Collapsing on description alone would drop one at random.
    */
    const held = [
      factor({ resource: "Cement", resourceUnit: "kg", quantity: "12.5000" }),
      factor({ resource: "Cement", resourceUnit: "pocket", quantity: "0.2500" }),
    ];
    expect(factorsFor("One-brick wall in stock brick", "m2", held, AS_AT)).toHaveLength(2);
  });
});

describe("what it refuses to apply", () => {
  it("will not answer for work measured in another unit", () => {
    const held = [factor({ workUnit: "m3" })];
    expect(factorsFor("One-brick wall in stock brick", "m2", held, AS_AT)).toEqual([]);
  });

  it("will not let a 220mm factor answer about 110mm", () => {
    /*
      `specificationHolds` as a gate rather than a score. Without it a factor for 220mm brickwork
      scores well against a 110mm question on word overlap alone and is applied silently — the
      ASAQS failure exactly: a plausible figure for the wrong thing.
    */
    const held = [factor({ work: "Brick wall 220mm thick in stock brick" })];
    expect(factorsFor("Brick wall 110mm thick in stock brick", "m2", held, AS_AT)).toEqual([]);
  });

  it("holds out for a closer description than the rate library would", () => {
    // A rate is offered on a row a QS can reject; a factor is applied inside an answer, unseen.
    expect(WORK_FLOOR).toBeGreaterThan(0.6);

    const held = [factor({ work: "Concrete in strip footings" })];
    expect(factorsFor("One-brick wall in stock brick", "m2", held, AS_AT)).toEqual([]);
  });

  it("will not use a factor from another province", () => {
    const held = [factor({ region: "Western Cape" })];
    expect(factorsFor("One-brick wall in stock brick", "m2", held, { ...AS_AT, region: "Gauteng" }))
      .toEqual([]);
  });

  it("but uses one that states no province, which applies everywhere", () => {
    // The same rule `matchRates` follows, so the two cannot disagree about eligibility.
    const held = [factor({ region: null })];
    expect(factorsFor("One-brick wall in stock brick", "m2", held, { ...AS_AT, region: "Gauteng" }))
      .toHaveLength(1);
  });

  it("returns nothing at all when it holds nothing, rather than a partial set", () => {
    // The caller falls back to the model and says so. A set covering the bricks and missing the
    // mortar would produce a take-off that looked complete and was not.
    expect(factorsFor("Two coats emulsion on plaster", "m2", [factor()], AS_AT)).toEqual([]);
  });
});

describe("a factor is a fact about a date", () => {
  it("ignores one that does not apply yet", () => {
    const held = [factor({ effectiveDate: "2026-09-01" })];
    expect(factorsFor("One-brick wall in stock brick", "m2", held, { asAt: "2026-06-01" })).toEqual([]);
  });

  it("takes the newest in force, so revising a factor supersedes it", () => {
    const held = [
      factor({ quantity: "104.0000", effectiveDate: "2026-01-01" }),
      factor({ quantity: "108.0000", effectiveDate: "2026-05-01" }),
    ];
    const [found] = factorsFor("One-brick wall in stock brick", "m2", held, AS_AT);
    expect(found?.quantity).toBe("108.0000");
  });

  it("and reads as at a past date, so a bill can be reproduced on the assumptions it used", () => {
    const held = [
      factor({ quantity: "104.0000", effectiveDate: "2026-01-01" }),
      factor({ quantity: "108.0000", effectiveDate: "2026-05-01" }),
    ];
    const [found] = factorsFor("One-brick wall in stock brick", "m2", held, { asAt: "2026-03-01" });
    expect(found?.quantity).toBe("104.0000");
  });
});

describe("turning a row into arithmetic", () => {
  it("carries the quantity across without passing it through a float", () => {
    expect(formatQuantity(asFactor(factor({ quantity: "104.0000" })).perUnit, 0)).toBe("104");
  });

  it("reads the stored fraction as the percentage somebody typed", () => {
    // The column holds 0,0500 for five per cent. Passing that to `percentFromRate` unmultiplied
    // would have applied five thousandths of one per cent and quietly lost the allowance.
    expect(formatPercent(wastePercent("0.0500"))).toBe(formatPercent(percentFromRate(5)));
    expect(formatPercent(wastePercent("0.1000"))).toBe(formatPercent(percentFromRate(10)));
  });

  it("leaves waste undefined where none was stated, so the method's own still applies", () => {
    // Absent is not nought — the distinction §1.3 keeps everywhere else.
    expect(asFactor(factor({ wasteRate: null })).waste).toBeUndefined();
  });

  it("and keeps a stated nought, because that is a decision somebody made", () => {
    expect(asFactor(factor({ wasteRate: "0.0000" })).waste).toBeDefined();
  });
});

describe("one resource, described two ways", () => {
  /*
    The fault this key exists to stop, found by running a take-off rather than by reading the code.
    The model proposes "Stock bricks" and a factor says "Stock brick"; on an exact comparison the
    override did not fire, both lines survived, and the wall was given its bricks twice with the
    total counting both. A double-counted order is worse than a missing one — nothing about it
    looks wrong.
  */
  it("folds a trailing plural, so a proposal and a factor are one resource", () => {
    expect(resourceKey("Stock bricks", "no")).toBe(resourceKey("Stock brick", "no"));
    expect(resourceKey("Bricklayer hours", "hour")).toBe(resourceKey("Bricklayer hour", "hour"));
  });

  it("folds case and punctuation", () => {
    expect(resourceKey("STOCK BRICK", "No.")).toBe(resourceKey("stock brick", "no"));
    expect(resourceKey("Cement, 42.5N", "kg")).toBe(resourceKey("cement 42 5n", "kg"));
  });

  it("leaves a word that merely ends in s alone", () => {
    // Conservative on purpose: it is not a stemmer, and anything cleverer starts folding words
    // that mean different things.
    expect(resourceKey("Glass", "m2")).toContain("glass");
    expect(resourceKey("Sand", "m3")).toContain("sand");
  });

  it("still keeps one resource held in two units apart", () => {
    // "Cement" in kilograms and in pockets are two inputs, and folding must not merge them.
    expect(resourceKey("Cement", "kg")).not.toBe(resourceKey("Cement", "pocket"));
  });
});
