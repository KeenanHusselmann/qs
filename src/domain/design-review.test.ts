import { describe, expect, it } from "vitest";

import { formatRand } from "@/domain/money";

import {
  citedRefs,
  DEFAULT_ASSUMPTIONS,
  estimate,
  optionComparison,
  queryCounts,
  readStatus,
  reviewFindings,
  statusCounts,
  type Review,
  type ReviewItem,
} from "./design-review";

const item = (over: Partial<ReviewItem> & Pick<ReviewItem, "ref" | "bill">): ReviewItem => ({
  position: 1,
  itemNumbers: {},
  description: over.ref,
  unit: "m2",
  quantities: { a: "10", b: "10" },
  designSource: null,
  requirement: null,
  status: "Aligned",
  finding: null,
  action: null,
  rates: { a: "100", b: "100" },
  rateBasis: null,
  ...over,
});

const review = (over: Partial<Review> = {}): Review => ({
  title: "Boundary wall",
  subject: null,
  options: [
    { key: "a", label: "Option A" },
    { key: "b", label: "Option B" },
  ],
  baseOption: "b",
  recommendation: null,
  limitations: null,
  parameterColumns: [],
  assumptions: { ...DEFAULT_ASSUMPTIONS, mainQuantity: "100", contingency: "0.10", vat: "0.15", profitAndAttendance: "0.075" },
  sources: [],
  parameters: [],
  items: [],
  queries: [],
  adjustments: [],
  ...over,
});

describe("the estimate", () => {
  it("prices each option in the workbook's order: bills, adjustments, contingency, VAT", () => {
    const [a, b] = estimate(
      review({
        items: [
          item({ ref: "P1", bill: "Preliminaries", unit: "Item", quantities: { a: "1", b: "1" }, rates: { a: "50000", b: "50000" } }),
          item({ ref: "M3", bill: "Masonry", quantities: { a: "1153.97", b: "1153.97" }, rates: { a: "1180", b: "720" } }),
          item({ ref: "PS1", bill: "Provisional sums", unit: "Item", quantities: { a: "1", b: "1" }, rates: { a: "85000", b: "85000" } }),
        ],
        adjustments: [{ position: 1, ref: "ADJ1", queryNumber: 5, description: "Fourth bar", unit: "kg", quantities: { a: "1074.43", b: "1074.43" }, rates: { a: "27.50", b: "27.50" }, basis: null }],
      }),
    );

    // 1153.97 × 720 = 830 858.40; P&A 7.5% on 85 000 = 6 375; ADJ 1074.43 × 27.50 = 29 546.825 → 29 546.83.
    // In cents – exact, and nothing in the assertion depends on how a figure is printed.
    expect(b.bills.find((x) => x.bill === "Masonry")!.amount).toBe(83085840n);
    expect(b.bills.find((x) => x.bill === "Provisional sums")!.amount).toBe(9137500n);
    expect(b.billed).toBe(97223340n);
    expect(b.adjustments).toBe(2954683n);
    expect(b.contingency).toBe(10017802n);
    expect(b.totalExVat).toBe(110195825n);
    expect(b.totalIncVat).toBe(126725199n);
    expect(b.perMainUnit).toBe(1101958n);
    expect(formatRand(b.totalExVat).replace(/\s/g, " ")).toBe("R 1 101 958,25");
    expect(b.measured).toBe(83085840n);
    expect(b.preliminariesShare).toBeCloseTo(50000 / 830858.4, 6);
    // Option A only differs in the masonry rate.
    expect(a.totalExVat > b.totalExVat).toBe(true);
  });

  it("leaves an option's n/a items out, and lists a quantity with no rate as unpriced", () => {
    const [a, b] = estimate(
      review({
        items: [
          item({ ref: "M6", bill: "Masonry", quantities: { a: "2307.93", b: null }, rates: { a: "18", b: null } }),
          item({ ref: "PT3", bill: "Paintwork", quantities: { a: "844.65", b: "844.65" }, rates: { a: "40", b: null } }),
        ],
      }),
    );
    expect(a.unpriced).toEqual([]);
    expect(b.unpriced).toEqual(["PT3"]);
    expect(b.billed).toBe(0n);
  });

  it("keeps a four-place rate to four places", () => {
    const [a] = estimate(review({ items: [item({ ref: "B1", bill: "Masonry", unit: "no.", quantities: { a: "12.3456", b: "1" }, rates: { a: "0.4567", b: "1" } })] }));
    expect(a.billed).toBe(564n);
  });

  it("says nothing per unit where the main quantity is not set", () => {
    const [a] = estimate(review({ assumptions: { ...DEFAULT_ASSUMPTIONS, mainQuantity: null }, items: [item({ ref: "X", bill: "Masonry" })] }));
    expect(a.perMainUnit).toBeNull();
  });
});

describe("the option comparison", () => {
  it("lists only items whose quantities differ, against the base option", () => {
    const rows = optionComparison(
      [item({ ref: "M3", bill: "Masonry" }), item({ ref: "M7", bill: "Masonry", quantities: { a: "4420.4", b: "5893.55" } }), item({ ref: "M6", bill: "Masonry", quantities: { a: "2307.93", b: null } })],
      review().options,
      "b",
    );
    expect(rows.map((r) => r.ref)).toEqual(["M7", "M6"]);
    expect(rows[0].against.a.difference).toBe("-1473.15");
    expect(rows[0].against.a.fraction).toBeCloseTo(-0.24996, 4);
    expect(rows[1].against.a).toEqual({ difference: null, fraction: null });
  });
});

describe("counts", () => {
  it("count by the key, and say what is unmarked", () => {
    const { counts, unmarked, total } = statusCounts([{ status: "Aligned" }, { status: "Gap" }, { status: null }]);
    expect(counts.find((c) => c.status === "Gap")?.count).toBe(1);
    expect(unmarked).toBe(1);
    expect(total).toBe(3);
  });

  it("count open high-priority queries", () => {
    expect(queryCounts([{ status: "Open", priority: "High" }, { status: "Answered", priority: "High" }, { status: "Open", priority: "Low" }])).toEqual({ open: 2, answered: 1, closed: 0, highOpen: 1 });
  });

  it("read statuses as people type them", () => {
    expect(readStatus(" qs  ADDITION ", ["Aligned", "QS addition"] as const)).toBe("QS addition");
    expect(readStatus("Fine", ["Aligned"] as const)).toBeNull();
  });
});

describe("findings", () => {
  it("cite references as whole tokens", () => {
    expect(citedRefs("E1 7.1 and 7.3, G1 4.3", ["E1", "E12", "G1", "A3"])).toEqual(["E1", "G1"]);
    expect(citedRefs("A31", ["A3"])).toEqual([]);
  });

  it("flag items resting on a superseded drawing, unknown references, silent discrepancies and open high queries", () => {
    const found = reviewFindings(
      review({
        sources: [
          { ref: "A1", discipline: "Architect", document: "Plans", dated: null, status: "Construction drawing", notes: null, location: null },
          { ref: "A3", discipline: "Architect", document: "Rev 6", dated: null, status: "Superseded concept", notes: null, location: null },
        ],
        items: [
          item({ ref: "P9", bill: "Preliminaries", designSource: "A3" }),
          item({ ref: "C5", bill: "Concrete", designSource: "E1 7.1", status: "Discrepancy", finding: "-" }),
        ],
        queries: [{ number: 1, topic: null, query: "Scope?", raisedTo: "Engineer", affects: null, priority: "High", sourceRef: null, response: null, status: "Open" }],
      }),
    );
    expect(found.map((f) => f.id)).toEqual(["high-queries", "superseded-source", "no-finding", "unknown-source"]);
    expect(found[1].finding).toContain("P9");
    expect(found[3].finding).toContain("E1");
  });
});
