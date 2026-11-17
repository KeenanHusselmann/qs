import { describe, expect, it } from "vitest";

import { dimensionsFor, lineQuantity, measure, times } from "./dimensions";
import { parseQuantity } from "./money";

const q = (s: string) => parseQuantity(s);

describe("a dimension line", () => {
  it("is the timesing factor times its dimensions", () => {
    expect(lineQuantity({ timesing: q("3"), dimensions: [q("4.20"), q("2.70")], deduct: false })).toBe(q("34.02"));
  });

  it("is taken away when it is a deduction", () => {
    expect(lineQuantity({ timesing: q("1"), dimensions: [q("0.90"), q("2.10")], deduct: true })).toBe(q("-1.89"));
  });

  it("rescales once per multiplication, half away from zero", () => {
    // 0,3333 × 0,3333 = 0,11108889 → 0,1111
    expect(times(q("0.3333"), q("0.3333"))).toBe(q("0.1111"));
  });
});

describe("an item's sheet", () => {
  it("sums its lines – the worked example on the sheet", () => {
    const sheet = measure("m2", [
      { timesing: q("3"), dimensions: [q("4.20"), q("2.70")], deduct: false },
      { timesing: q("1"), dimensions: [q("0.90"), q("2.10")], deduct: true },
    ]);
    expect(sheet.total).toBe(q("32.13"));
    expect(sheet.mismatched).toEqual([]);
    expect(sheet.negative).toBe(false);
  });

  it("reports a line with the wrong number of dimensions for the unit", () => {
    const sheet = measure("m2", [
      { timesing: q("1"), dimensions: [q("4.20"), q("2.70")], deduct: false },
      { timesing: q("1"), dimensions: [q("6.00")], deduct: false },
    ]);
    expect(sheet.mismatched).toEqual([{ index: 1, reason: "Line 2 has 1 dimension; an item in m2 is measured in two dimensions." }]);
  });

  it("flags more deducted than measured", () => {
    expect(measure("m", [{ timesing: q("1"), dimensions: [q("1")], deduct: true }]).negative).toBe(true);
  });

  it("measures a volume and a count", () => {
    expect(measure("m3", [{ timesing: q("2"), dimensions: [q("10"), q("0.6"), q("0.3")], deduct: false }]).total).toBe(q("3.6"));
    expect(measure("no", [{ timesing: q("14"), dimensions: [], deduct: false }]).total).toBe(q("14"));
  });
});

describe("dimensions by unit", () => {
  it("reads the units a bill uses", () => {
    expect([dimensionsFor("m"), dimensionsFor("m²"), dimensionsFor("m3"), dimensionsFor("nr"), dimensionsFor("sum")]).toEqual([1, 2, 3, 0, null]);
  });
});
