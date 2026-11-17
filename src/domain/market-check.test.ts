import { describe, expect, it } from "vitest";

import { comparable, marketCheck, type CheckedItem, type PastTenderRate } from "./market-check";

const item = (id: string, description: string, unit: string, rate: number | null): CheckedItem => ({ id, ref: id, description, unit, rate });
const past = (description: string, unit: string, rate: number, project = "Ridgeview"): PastTenderRate => ({ description, unit, rate, project });

describe("comparable – the same item, strictly", () => {
  it("matches the same work worded a little differently", () => {
    expect(comparable({ description: "One-brick wall in 14 MPa bricks", unit: "m2" }, { description: "One brick walls, 14 MPa bricks", unit: "m²" })).toBe(true);
  });

  it("refuses a different unit", () => {
    expect(comparable({ description: "Concrete in footings", unit: "m3" }, { description: "Concrete in footings", unit: "m2" })).toBe(false);
  });

  it("refuses a different specification number, either way", () => {
    expect(comparable({ description: "25 MPa concrete in footings", unit: "m3" }, { description: "30 MPa concrete in footings", unit: "m3" })).toBe(false);
    expect(comparable({ description: "Concrete in footings", unit: "m3" }, { description: "25 MPa concrete in footings", unit: "m3" })).toBe(false);
  });

  it("refuses work that merely shares a word", () => {
    expect(comparable({ description: "Plaster to brick walls", unit: "m2" }, { description: "One-brick wall in 14 MPa bricks", unit: "m2" })).toBe(false);
  });
});

describe("marketCheck", () => {
  const tenders = [
    past("One-brick wall in 14 MPa bricks", "m2", 400, "Ridgeview"),
    past("One brick wall, 14 MPa bricks", "m2", 420, "Kings Estate"),
    past("One-brick wall in 14 MPa bricks", "m2", 440, "Kings Estate"),
  ];

  it("flags a rate more than a quarter off the median of past tenders", () => {
    const [finding] = marketCheck([item("1.1", "One-brick wall in 14 MPa bricks", "m2", 600)], tenders);
    expect(finding).toMatchObject({ ref: "1.1", ours: 600, low: 400, median: 420, high: 440, rates: 3, projects: 2 });
    expect(finding!.variance).toBeCloseTo(180 / 420, 9);
  });

  it("flags a rate far below too", () => {
    expect(marketCheck([item("1.1", "One-brick wall in 14 MPa bricks", "m2", 250)], tenders)).toHaveLength(1);
  });

  it("leaves a rate within a quarter of the median alone", () => {
    expect(marketCheck([item("1.1", "One-brick wall in 14 MPa bricks", "m2", 500)], tenders)).toEqual([]);
  });

  it("needs at least two tender rates, and checks only priced items", () => {
    expect(marketCheck([item("1.1", "One-brick wall in 14 MPa bricks", "m2", 900)], tenders.slice(0, 1))).toEqual([]);
    expect(marketCheck([item("1.1", "One-brick wall in 14 MPa bricks", "m2", null)], tenders)).toEqual([]);
  });

  it("puts the furthest out first", () => {
    const found = marketCheck(
      [item("1.1", "One-brick wall in 14 MPa bricks", "m2", 600), item("1.2", "One-brick wall in 14 MPa bricks", "m2", 1_000)],
      tenders,
    );
    expect(found.map((f) => f.ref)).toEqual(["1.2", "1.1"]);
  });
});
