import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { againstEstimate, collusionIndicators, pricePoints, sameScopeTotals, type EvaluationItem, type EvaluationReturn } from "./tender-evaluation";

/** A deterministic pseudo-random sequence, so the "independent" tenderer is the same every run. */
function lcg(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
}
const cents = (x: number) => Math.round(x * 100) / 100;

const ITEMS: EvaluationItem[] = Array.from({ length: 20 }, (_, i) => ({
  id: `i${i}`,
  ref: `${i + 1}`,
  description: `Item ${i + 1}`,
  unit: "m2",
  quantity: 10 + i * 3,
  estimateRate: 100 + i * 37.5,
}));
// Two provisional sums the bill fixes – everybody prices them the same.
const PS: EvaluationItem[] = [
  { id: "ps1", ref: "PS1", description: "Provisional sum: electrical", unit: "sum", quantity: 1, estimateRate: 250_000 },
  { id: "ps2", ref: "PS2", description: "Provisional sum: landscaping", unit: "sum", quantity: 1, estimateRate: 80_000 },
];
const ALL = [...ITEMS, ...PS];

function tender(id: string, rate: (item: EvaluationItem, i: number) => number | null): EvaluationReturn {
  return { id, tenderer: id, rates: new Map(ALL.map((item, i) => [item.id, item.id.startsWith("ps") ? item.estimateRate : rate(item, i)])) };
}

const rnd = lcg(42);
const SOURCE = tender("Source", (item) => cents(item.estimateRate! * (0.9 + rnd() * 0.2)));
const at = (factor: number) => (item: EvaluationItem) => cents(SOURCE.rates.get(item.id)! * factor);
const B = tender("B", at(1.12));
const C = tender("C", at(1.1));
const D = tender("D", at(1.15));
const rnd2 = lcg(7);
const HONEST = tender("Honest", (item) => cents(item.estimateRate! * (0.85 + rnd2() * 0.3)));

describe("collusionIndicators – the boundary wall pattern", () => {
  const { indicators, groups } = collusionIndicators(ALL, [SOURCE, B, C, D, HONEST]);

  it("finds each tenderer built on the source's prices, at its factor", () => {
    const fromSource = indicators.filter((i) => i.base.id === "Source");
    expect(fromSource.map((i) => i.other.id).sort()).toEqual(["B", "C", "D"]);
    expect(fromSource.find((i) => i.other.id === "B")!.factor).toBeCloseTo(1.12, 3);
    expect(fromSource.every((i) => i.kind === "uniform-uplift" && i.matching === i.compared)).toBe(true);
  });

  it("does not compare the provisional sums every tenderer was given", () => {
    expect(indicators.every((i) => i.compared === ITEMS.length)).toBe(true);
  });

  it("puts the four in one group, and leaves the independent tenderer out", () => {
    expect(groups).toHaveLength(1);
    expect([...groups[0]!].sort()).toEqual(["B", "C", "D", "Source"]);
    expect(indicators.some((i) => i.base.id === "Honest" || i.other.id === "Honest")).toBe(false);
  });

  it("reports an uplift once, not again as its reciprocal", () => {
    expect(indicators.filter((i) => i.factor < 1)).toHaveLength(0);
  });
});

describe("collusionIndicators – what it must not accuse", () => {
  it("honest tenderers whose prices track the estimate are not flagged", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10_000 }), fc.integer({ min: 1, max: 10_000 }), (s1, s2) => {
        const r1 = lcg(s1);
        const r2 = lcg(s2 + 99_991);
        const one = tender("one", (item) => cents(item.estimateRate! * (0.85 + r1() * 0.3)));
        const two = tender("two", (item) => cents(item.estimateRate! * (0.85 + r2() * 0.3)));
        expect(collusionIndicators(ALL, [one, two]).indicators).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  it("too few items in common is not enough to say anything", () => {
    const few = (id: string, f: number) => ({ id, tenderer: id, rates: new Map(ITEMS.slice(0, 4).map((i) => [i.id, cents(i.estimateRate! * f)])) });
    expect(collusionIndicators(ITEMS, [few("x", 1), few("y", 1.12)]).indicators).toEqual([]);
  });

  it("identical rates are reported once, as identical", () => {
    const copy = tender("Copy", (item) => SOURCE.rates.get(item.id)!);
    const { indicators } = collusionIndicators(ALL, [SOURCE, copy]);
    expect(indicators).toHaveLength(1);
    expect(indicators[0]!.kind).toBe("identical");
    // Two copies agree on every item; only the sums the bill fixed are left out (regression).
    expect(indicators[0]!.compared).toBe(ITEMS.length);
  });
});

describe("againstEstimate", () => {
  it("flags lines more than 25% over or under, and unpriced ones", () => {
    const t: EvaluationReturn = { id: "t", tenderer: "T", rates: new Map([["i0", 130], ["i1", 100], ["i2", null]]) };
    const { lines } = againstEstimate(ITEMS.slice(0, 3), [t]);
    expect(lines.map((l) => l.cells[0]!.flag)).toEqual(["high", "low", "unpriced"]);
    expect(lines[0]!.cells[0]!.variance).toBeCloseTo(0.3, 6);
  });

  it("compares totals like for like – only items both sides priced", () => {
    const t: EvaluationReturn = { id: "t", tenderer: "T", rates: new Map([["i0", 110], ["i1", null]]) };
    const [row] = againstEstimate(ITEMS.slice(0, 2), [t]).tenderers;
    expect(row!.estimate).toBe(100 * 10);
    expect(row!.extended).toBe(110 * 10);
    expect(row!.variance).toBeCloseTo(0.1, 9);
    expect(row!.unpriced).toBe(1);
  });
});

describe("pricePoints (PPPFA)", () => {
  it("gives the lowest tender full points and scales the rest", () => {
    expect(pricePoints(100, 100, 80)).toBe(80);
    expect(pricePoints(110, 100, 80)).toBeCloseTo(72, 9);
    expect(pricePoints(110, 100, 90)).toBeCloseTo(81, 9);
  });
  it("never goes below nought", () => expect(pricePoints(300, 100, 80)).toBe(0));
});

describe("sameScopeTotals – every tender on the same scope", () => {
  const items: EvaluationItem[] = [
    { id: "a", ref: "1", description: "Brickwork", unit: "m2", quantity: 100, estimateRate: 500 },
    { id: "b", ref: "2", description: "Plaster", unit: "m2", quantity: 100, estimateRate: 100 },
    { id: "c", ref: "3", description: "Waterproofing", unit: "m2", quantity: 10, estimateRate: 300 },
    { id: "d", ref: "4", description: "Not measured", unit: "m2", quantity: null, estimateRate: 50 },
  ];
  const t = (id: string, rates: Record<string, number | null>): EvaluationReturn => ({ id, tenderer: id, rates: new Map(Object.entries(rates)) });

  it("fills a gap at the median of the others, and re-ranks when the headline misleads", () => {
    // Cheap leaves plaster out; the others priced it at 90 and 110, so it is filled at 100.
    const cheap = t("Cheap", { a: 480, b: null, c: 300 });
    const fair = t("Fair", { a: 470, b: 90, c: 300 });
    const dear = t("Dear", { a: 530, b: 110, c: 300 });
    const [first, second] = sameScopeTotals(items, [cheap, fair, dear]);
    expect(first).toMatchObject({ tenderer: "Fair", headline: 47_000 + 9_000 + 3_000, filled: 0, rank: 1, headlineRank: 2 });
    expect(second).toMatchObject({ tenderer: "Cheap", headline: 48_000 + 3_000, filled: 10_000, filledItems: 1, total: 61_000, rank: 2, headlineRank: 1 });
  });

  it("falls back to our estimate when nobody priced the item, and counts what cannot be filled", () => {
    const one = t("One", { a: 500, b: 100, c: null });
    const two = t("Two", { a: 500, b: 100, c: null });
    const [row] = sameScopeTotals(items, [one, two]);
    expect(row).toMatchObject({ filled: 3_000, filledItems: 1, unfillable: 0 });
    const noEstimate = items.map((i) => (i.id === "c" ? { ...i, estimateRate: null } : i));
    expect(sameScopeTotals(noEstimate, [one, two])[0]).toMatchObject({ filled: 0, unfillable: 1 });
  });
});
