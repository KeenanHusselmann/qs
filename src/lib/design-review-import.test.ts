import { describe, expect, it } from "vitest";

import { DEFAULT_ASSUMPTIONS, estimate, type Review } from "@/domain/design-review";
import { readWorkbookGrids } from "@/lib/ingest/xlsx";
import { designReviewWorkbook } from "@/lib/report/design-review-workbook";

import { decimal, importReview, optionKey } from "./design-review-import";

/** The shape of the practice's own workbook, abridged: a mapping, a query list and an estimate. */
const sheets = [
  {
    name: "Read Me",
    grid: [
      ["Boundary Wall - QS BOQ vs Design Mapping"],
      ["Practice | Prepared 27 Sep 2026"],
      ["Recommended base", "Recommended base", "Option B follows the architect and engineer intent most closely."],
      ["Limitations", "Limitations", "DWG files were not opened."],
    ],
  },
  {
    name: "Sources",
    grid: [
      ["Ref", "Discipline", "Document", "Date", "Status / revision", "Relevance / notes", "Location"],
      ["E1", "Structural Engineer", "Design report", "14 Jul 2026", "For construction", "NW wall only", "Drive"],
      ["A3", "Architect", "Rev 6", "9 Sep 2026", "Superseded concept", "", ""],
    ],
  },
  {
    name: "QS Item Mapping",
    grid: [
      ["Ref", "Bill", "Item (B / Max)", "Item (A)", "QS description (abridged)", "Unit", "Qty Option A", "Qty Option B", "Qty Max Brick", "Design source", "Design requirement", "Status", "Finding", "Recommended action"],
      ["P1", "Preliminaries", "1", "1", "Contract data", "Item", "1", "1", "1", "n/a", "-", "Standard", "Contract item.", "None"],
      ["M4", "Masonry", "4", "4", "Superstructure piers", "m3", "86.37", "86.37", "73.51", "E1 6.2", "460 x 690", "Aligned", "-", "None"],
      ["M5", "Masonry", "n/a", "5", "Option A only: reveals", "no.", "82", "n/a", "n/a", "n/a", "-", "QS addition", "Only if A.", "-"],
      ["PT1", "Paintwork", "1, 3, 5", "1, 3, 5", "Primer + two coats", "m2 (each coat)", "216.94", "2271.48", "2271.48", "A1 note 8", "Light grey", "aligned", "", ""],
      ["PS1", "Provisional sums", "1, 2", "1, 2", "Geotech, R ?? + P&A", "Item", "1", "1", "1", "G1", "", "Aligned", "", "Insert amount."],
      ["Quantities are values read from the QS workbooks."],
    ],
  },
  {
    name: "Queries Tracker",
    grid: [
      ["No", "Topic", "Query", "Raised to", "Affects", "Priority", "Source reference", "Response", "Status"],
      ["Q1", "Scope", "Does the NW design apply to all walls?", "Engineer", "All options", "High", "E1 3", "", "Open"],
      ["Q5", "Rebar", "Four bars or three?", "Engineer / QS", "All options", "Medium", "E1 7.1", "Four.", ""],
    ],
  },
  {
    name: "Cost Estimate",
    grid: [
      ["Cost Estimate"],
      ["KEY ASSUMPTIONS"],
      ["Wall length (m)", "", "", "", "491.05", "491.05"],
      ["Contingency", "", "", "", "0.10000000000000001"],
      ["VAT", "", "", "", "0.15"],
      ["Profit and attendance on provisional sums", "", "", "", "0.075"],
      ["Contract period assumed (weeks)", "", "", "", "16"],
      ["Internal cost plan total excl. VAT (for comparison)", "", "", "", "2661749.99"],
      ["SUMMARY (R, excl. VAT)", "", "", "", "", "Option A"],
      ["VAT", "", "", "", "", "815930.66"],
      ["Ref", "Bill", "QS item", "Description", "Unit", "Qty A", "Qty B", "Qty Max", "Rate A", "Rate B", "Rate Max", "Amount A", "Amount B", "Amount Max", "Rate basis / notes"],
      ["P1", "Preliminaries", "1", "Contract data", "Item", "1", "1", "1", "35000", "35000", "35000", "35000", "35000", "35000", "Guarantee"],
      ["M4", "Masonry", "4", "Piers", "m3", "86.37", "86.37", "73.51", "5360", "3270", "2930", "", "", "", "m2 rate / thickness"],
      ["M5", "Masonry", "5 (A)", "Reveals", "no.", "82", "n/a", "n/a", "95", "95", "95", "", "", "", ""],
      ["PT1", "Paintwork", "1", "Primer", "m2", "216.94", "2271.48", "2271.48", "24", "24", "24", "", "", "", "Primer"],
      ["PT1", "Paintwork", "3", "First coat", "m2", "216.94", "2271.48", "2271.48", "30", "30", "30", "", "", "", "Acrylic"],
      ["PT1", "Paintwork", "5", "Final coat", "m2", "216.94", "2271.48", "2271.48", "32", "32", "32", "", "", "", "Acrylic"],
      ["PS1", "Provisional sums", "1", "Provisional sum: geotech", "Item", "1", "1", "1", "85000", "85000", "85000", "", "", "", ""],
      ["PS1", "Provisional sums", "2", "Profit and attendance on the above", "Item", "1", "1", "1", "6375", "6375", "6375", "", "", "", ""],
      ["RECOMMENDED ADJUSTMENTS"],
      ["ADJ1", "Adjustments", "Q5", "Additional Y12", "kg", "1074.43", "1074.43", "1074.43", "27.5", "27.5", "27.5", "", "", "", "Four bars"],
    ],
  },
];

describe("importing a review workbook", () => {
  const result = importReview(sheets, "review.xlsx");
  if (!result.ok) throw new Error(result.reason);
  const r = result.review;

  it("finds the options from the quantity columns and the base from the recommendation", () => {
    expect(r.options.map((o) => o.label)).toEqual(["Option A", "Option B", "Max Brick"]);
    expect(r.baseOption).toBe("option-b");
    expect(r.title).toBe("Boundary Wall - QS BOQ vs Design Mapping");
    expect(r.limitations).toBe("DWG files were not opened.");
  });

  it("reads items, leaving n/a as null and footnotes out", () => {
    expect(r.items.map((i) => i.ref)).toEqual(["P1", "M4", "M5", "PT1", "PS1"]);
    const m5 = r.items.find((i) => i.ref === "M5")!;
    expect(m5.quantities).toEqual({ "option-a": "82.0000", "option-b": null, "max-brick": null });
    expect(m5.itemNumbers).toEqual({ "option-a": "5" });
    expect(r.items.find((i) => i.ref === "PT1")!.status).toBe("Aligned");
    expect(r.items.find((i) => i.ref === "M4")!.finding).toBeNull();
  });

  it("adds rates priced over several lines of one item, and skips profit and attendance", () => {
    const pt1 = r.items.find((i) => i.ref === "PT1")!;
    expect(pt1.rates["option-b"]).toBe("86.00");
    expect(pt1.rateBasis).toBe("Primer; Acrylic");
    expect(r.items.find((i) => i.ref === "PS1")!.rates["max-brick"]).toBe("85000.00");
  });

  it("reads the assumptions above the summary and not the summary's totals", () => {
    expect(r.assumptions).toMatchObject({ mainQuantity: "491.0500", mainUnit: "m", contingency: "0.1000", vat: "0.1500", profitAndAttendance: "0.0750", contractWeeks: 16, comparisonAmount: "2661749.99" });
    expect(r.assumptions.comparisonLabel).toBe("Internal cost plan total");
  });

  it("reads queries, inferring answered where a response is written", () => {
    expect(r.queries.map((q) => [q.number, q.priority, q.status])).toEqual([
      [1, "High", "Open"],
      [5, "Medium", "Answered"],
    ]);
  });

  it("reads adjustments with the query behind them", () => {
    expect(r.adjustments).toHaveLength(1);
    expect(r.adjustments[0]).toMatchObject({ ref: "ADJ1", queryNumber: 5, rates: { "option-b": "27.50" } });
  });

  it("refuses a workbook with no item mapping, and says what it looks for", () => {
    const refused = importReview([{ name: "Sheet1", grid: [["a", "b"]] }], "x.xlsx");
    expect(refused.ok).toBe(false);
  });
});

describe("cells", () => {
  it("round a stored float to the column's places once", () => {
    expect(decimal("0.10000000000000001", 4)).toBe("0.1000");
    expect(decimal("1,234.5", 2)).toBe("1234.50");
    expect(decimal("n/a", 4)).toBeNull();
    expect(decimal("R ??", 2)).toBeNull();
  });

  it("key options by their names", () => expect(optionKey("Max Brick")).toBe("max-brick"));
});

describe("the exported workbook", () => {
  it("imports back to the same review and the same totals", async () => {
    const first = importReview(sheets, "review.xlsx");
    if (!first.ok) throw new Error(first.reason);
    const original: Review = first.review;

    const bytes = await designReviewWorkbook(original, { practice: "P", projectName: "Marshall Dam", exportedOn: "12 Nov 2026", exportedBy: "R" });
    const grids = readWorkbookGrids(new Uint8Array(bytes));
    expect(grids.sheets.map((s) => s.name)).toEqual(["Read Me", "Sources", "Design Parameters", "QS Item Mapping", "Option Comparison", "Queries Tracker", "Cost Estimate"]);

    const again = importReview(grids.sheets, "export.xlsx");
    if (!again.ok) throw new Error(again.reason);
    const back = again.review;

    expect(back.options).toEqual(original.options);
    expect(back.baseOption).toBe(original.baseOption);
    expect(back.items.map(({ ref, bill, quantities, status, rates, itemNumbers }) => ({ ref, bill, quantities, status, rates, itemNumbers }))).toEqual(
      original.items.map(({ ref, bill, quantities, status, rates, itemNumbers }) => ({ ref, bill, quantities, status, rates, itemNumbers })),
    );
    expect(back.queries).toEqual(original.queries);
    expect(back.sources).toEqual(original.sources);
    expect(back.adjustments.map((a) => [a.ref, a.queryNumber, a.quantities, a.rates])).toEqual(original.adjustments.map((a) => [a.ref, a.queryNumber, a.quantities, a.rates]));
    expect({ ...back.assumptions }).toEqual({ ...DEFAULT_ASSUMPTIONS, ...original.assumptions });
    expect(estimate(back).map((e) => e.totalExVat)).toEqual(estimate(original).map((e) => e.totalExVat));
  });
});
