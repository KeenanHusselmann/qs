/**
 * What the advisor is told a reviewing QS would point at (`checks.ts`), and the rule that lets it
 * cite a standard without stating a figure (`statesFigure` in `advisor.ts`).
 */

import { describe, expect, it } from "vitest";

import { billChecks, tenderChecks } from "./checks";
import { HAS_FIGURE, statesFigure } from "./advisor";
import type { BillRow } from "./bill";
import type { EvaluationItem, EvaluationReturn } from "@/domain/tender-evaluation";

const row = (over: Partial<BillRow> & { id: string }): BillRow => ({
  seq: 100,
  parentId: null,
  rowType: "item",
  itemRef: null,
  proposed: { description: "Item", unit: "m2", quantity: "10", rate: { value: "10000", precision: 2 }, quantityText: null, rateText: null, confidence: 1, note: null },
  citation: null,
  override: null,
  quantitySource: "ai_derived",
  rateSource: "ai_derived",
  amount: "100000",
  output: null,
  omitted: null,
  ...over,
});

describe("billChecks", () => {
  it("says nothing about a measured, priced bill", () => {
    expect(billChecks([row({ id: "a" }), row({ id: "b" })])).toEqual([]);
  });

  it("names unmeasured and unpriced items, without a figure", () => {
    const rows = [
      row({ id: "a", proposed: { ...row({ id: "x" }).proposed, quantity: null }, amount: null }),
      row({ id: "b", proposed: { ...row({ id: "x" }).proposed, rate: null }, amount: null }),
    ];
    const found = billChecks(rows);
    expect(found).toHaveLength(2);
    expect(found[0]).toMatch(/no quantity/);
    expect(found[1]).toMatch(/no rate/);
    for (const f of found) expect(HAS_FIGURE.test(f)).toBe(false);
  });

  it("ignores struck-out items", () => {
    const struck = row({ id: "a", proposed: { ...row({ id: "x" }).proposed, rate: null }, omitted: { by: "qs", at: "2026-11-16" } });
    expect(billChecks([struck, row({ id: "b" })])).toEqual([]);
  });

  it("flags a bill whose fixed sums are more than a seventh of it", () => {
    const measured = row({ id: "a", amount: "500000" });
    const ps = row({ id: "p", rowType: "provisional_sum", amount: "50000" });
    expect(billChecks([measured, ps])).toEqual([]); // 50 000 of 550 000: under a seventh
    const heavy = row({ id: "q", rowType: "prime_cost", amount: "200000" });
    expect(billChecks([measured, ps, heavy]).some((f) => /seventh/.test(f))).toBe(true);
  });
});

describe("tenderChecks", () => {
  const items: EvaluationItem[] = [
    { id: "a", ref: "1", description: "Brickwork", unit: "m2", quantity: 100, estimateRate: 500 },
    { id: "b", ref: "2", description: "Plaster", unit: "m2", quantity: 100, estimateRate: 100 },
  ];
  const tender = (id: string, tenderer: string, a: number | null, b: number | null): EvaluationReturn => ({ id, tenderer, rates: new Map([["a", a], ["b", b]]) });

  it("says nothing with no returns, or with returns close to the estimate", () => {
    expect(tenderChecks(items, [])).toEqual([]);
    expect(tenderChecks(items, [tender("t1", "Acme", 520, 105)])).toEqual([]);
  });

  it("names a tenderer far below the estimate, and one that left items unpriced", () => {
    const found = tenderChecks(items, [tender("t1", "Acme", 350, 70), tender("t2", "Bravo", 500, null)]);
    expect(found.some((f) => f.startsWith("Acme is far below"))).toBe(true);
    expect(found.some((f) => f.startsWith("Bravo left items unpriced"))).toBe(true);
  });

  it("says when the lowest headline is not lowest on the same scope", () => {
    // Acme leaves plaster out; Bravo and Delta priced it, so Acme's gap is filled at their median.
    const found = tenderChecks(items, [tender("t1", "Acme", 480, null), tender("t2", "Bravo", 500, 80), tender("t3", "Delta", 520, 400)]);
    expect(found.some((f) => f.startsWith("Acme is lowest on its own prices but not") && f.includes("Bravo is lowest on the same scope"))).toBe(true);
    for (const f of found) expect(HAS_FIGURE.test(f)).toBe(false);
  });

  it("names a tenderer with a digit in its name by role, so the advice is not dropped", () => {
    const [finding] = tenderChecks(items, [tender("t1", "Phase 2 Builders", 350, 70)]);
    expect(finding).toMatch(/^a tenderer is far below/);
    expect(HAS_FIGURE.test(finding!)).toBe(false);
  });
});

describe("statesFigure – a citation is not a figure", () => {
  it.each([
    "Value it under JBCC PBA clause 31.",
    "Check the energy calculation against SANS 10400-XA.",
    "NEC4 ECC compensation events apply here.",
    "Read regulation 5(1)(b) of the Construction Regulations.",
    "The JBCC Edition 6.2 particulars govern retention.",
    "Clauses 17 and 18 deal with variations.",
  ])("lets through: %s", (text) => expect(statesFigure(text)).toBe(false));

  it.each([
    "Price brickwork at R 450 per square metre.",
    "Section 3 comes to R 1 200 000.",
    "Allow 10% for contingencies under clause 14.",
    "Complete it within 30 days.",
  ])("still drops: %s", (text) => expect(statesFigure(text)).toBe(true));
});
