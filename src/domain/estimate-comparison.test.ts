import { describe, expect, it } from "vitest";

import { comparisonFindings, elementOrder, gapBetween, lineAmount, priceAll, type Comparison, type Estimate } from "./estimate-comparison";

const estimate = (over: Partial<Estimate> & Pick<Estimate, "name" | "position">): Estimate => ({
  preparedBy: null,
  dated: null,
  basis: null,
  units: "100",
  preliminaries: "0.1000",
  contingency: "0.1000",
  derivedFrom: null,
  lines: [],
  corrections: [],
  ...over,
});

const line = (element: string, description: string, quantity: string | null, unit: string | null, rate: string | null, lumpSum: string | null = null) => ({
  position: 0,
  element,
  description,
  quantity,
  unit,
  rate,
  lumpSum,
});

/** Two estimates for the same small estate: one of allowances, one measured. */
const comparison = (): Comparison => ({
  title: "Internal civils",
  subject: null,
  elements: ["Earthworks", "Roads", "Sewer"],
  commonUnits: "110",
  unitLabel: "units",
  alternativeContingency: "0.2000",
  clarifications: [{ number: 1, estimate: "Measured", observation: "One connection per block", evidence: null, consequence: null, response: null, status: "Open" }],
  estimates: [
    estimate({
      name: "Allowances",
      position: 1,
      units: "100",
      preliminaries: "0.1000",
      contingency: "0.1200",
      lines: [
        line("Earthworks", "Bulk earthworks", "12000", "m3", "220"),
        line("Roads", "Roads", "3500", "m2", "1350"),
        line("Roads", "Kerbs, sidewalks and furniture", null, null, null, "1000000"),
        line("Sewer", "Sewer reticulation", "300", "m", "3800"),
        line("Sewer", "Connections", null, null, null, "500000"),
      ],
    }),
    estimate({
      name: "Measured",
      position: 2,
      units: "110",
      preliminaries: "0.1200",
      contingency: "0.1500",
      lines: [
        line("Earthworks", "Platforms and road formation", "4407.4", "m3", "95"),
        line("Roads", "Carriageway", "3095.4", "m2", "1150"),
        line("Roads", "Parking", "2307.5", "m2", "720"),
        line("Sewer", "160 mm pipe", "193.1", "m", "2500"),
        line("Sewer", "Manholes", "43", "no.", "3000"),
      ],
    }),
  ],
});

describe("a line", () => {
  it("extends quantity × rate once and keeps a lump sum apart", () => {
    expect(lineAmount({ quantity: "12000", rate: "220", lumpSum: null })).toEqual({ measured: 264000000n, lump: 0n });
    expect(lineAmount({ quantity: null, rate: null, lumpSum: "1000000" })).toEqual({ measured: 0n, lump: 100000000n });
    expect(lineAmount({ quantity: "1", rate: null, lumpSum: null })).toBeNull();
  });
});

describe("pricing", () => {
  const [a, b] = priceAll(comparison());

  it("totals by element, then P&G on direct works and contingency on both", () => {
    // Earthworks 2 640 000; roads 4 725 000 + 1 000 000; sewer 1 140 000 + 500 000.
    expect(a.direct).toBe(1000500000n);
    expect(a.preliminaries).toBe(100050000n);
    // 12% of 11 005 500,00 = 1 320 660,00.
    expect(a.contingency).toBe(132066000n);
    expect(a.total).toBe(1232616000n);
    expect(a.alternativeTotal).toBe(1320660000n);
  });

  it("puts every estimate on the common unit count as well as its own", () => {
    expect(a.perUnitOwn).toBe(12326160n);
    expect(a.perUnitCommon).toBe(11205600n);
  });

  it("says how much of an estimate is lump sums, and each element's all-in rate per its main unit", () => {
    expect(a.lumpSums).toBe(150000000n);
    expect(a.lumpShare).toBeCloseTo(0.1499, 3);
    // Sewer: (1 140 000 + 500 000) / 300 m = 5 466,67 per metre, all in.
    expect(a.elements.find((e) => e.element === "Sewer")!.allIn).toEqual({ unit: "m", quantity: "300.0000", rate: 546667n });
    // The measured estimate's sewer main unit is its first measured line's – metres, not manholes.
    expect(b.elements.find((e) => e.element === "Sewer")!.allIn?.unit).toBe("m");
  });

  it("applies a derived estimate's corrections to their elements", () => {
    const c = comparison();
    c.estimates.push({
      ...c.estimates[1],
      name: "Measured, stress-tested",
      position: 3,
      derivedFrom: "x",
      corrections: [{ position: 1, ref: "A", element: "Earthworks", description: "Volume doubled", amount: "952000", basis: "Platforms reconciled with road levels" }],
    });
    const [, measured, tested] = priceAll(c);
    expect(tested.elements[0].amount - measured.elements[0].amount).toBe(95200000n);
    expect(tested.elements[0].corrections).toBe(95200000n);
  });
});

describe("the gap", () => {
  it("is taken apart by element and markups, adding exactly to the difference in totals, largest first", () => {
    const [a, b] = priceAll(comparison());
    const gap = gapBetween(a, b);
    expect(gap.parts.reduce((s, p) => s + p.difference, 0n)).toBe(gap.total);
    expect(gap.parts[0].label).toBe("Earthworks");
    expect(gap.parts.map((p) => p.label)).toContain("Contingency");
  });
});

describe("findings", () => {
  it("name lump-sum estimates, missing elements, differing unit counts and markups, unexplained corrections and open clarifications", () => {
    const c = comparison();
    c.estimates[0].lines.push(line("Water", "Water allowance", null, null, null, "3000000"));
    c.estimates[1].corrections.push({ position: 1, ref: "B", element: "Roads", description: "More parking", amount: "100000", basis: null });
    const ids = comparisonFindings(c).map((f) => f.id);
    expect(ids[0]).toBe("missing-Water");
    expect(ids).toEqual(expect.arrayContaining(["lumps-1", "basis-2", "units", "markups", "clarifications"]));
  });

  it("order elements as the comparison names them, then as they appear", () => {
    const c = comparison();
    c.estimates[1].lines.push(line("Electrical", "Reticulation", null, null, null, "1"));
    expect(elementOrder(c)).toEqual(["Earthworks", "Roads", "Sewer", "Electrical"]);
  });
});
