import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import type { Comparison } from "@/domain/estimate-comparison";

import { estimateComparisonWorkbook } from "./estimate-comparison-workbook";

const comparison: Comparison = {
  title: "Internal civils",
  subject: "Two engineers",
  elements: ["Earthworks", "Sewer"],
  commonUnits: "110",
  unitLabel: "units",
  alternativeContingency: "0.2000",
  clarifications: [{ number: 1, estimate: "Measured: rev 0", observation: "One connection per block", evidence: "Report 7.4", consequence: "Sewer short", response: null, status: "Open" }],
  estimates: [
    {
      position: 1,
      name: "Allowances",
      preparedBy: "Engineer A",
      dated: "Jul 2026",
      basis: "allowances",
      units: "100",
      preliminaries: "0.1000",
      contingency: "0.1200",
      derivedFrom: null,
      lines: [
        { position: 1, element: "Earthworks", description: "Bulk", quantity: "12000", unit: "m3", rate: "220", lumpSum: null },
        { position: 2, element: "Sewer", description: "Allowance", quantity: null, unit: null, rate: null, lumpSum: "500000" },
      ],
      corrections: [],
    },
    {
      id: "m",
      position: 2,
      // A colon and a long name: neither may reach Excel as a sheet name.
      name: "Measured: rev 0, from the concept drawings",
      preparedBy: null,
      dated: null,
      basis: null,
      units: "110",
      preliminaries: "0.1200",
      contingency: "0.1500",
      derivedFrom: "x",
      lines: [{ position: 1, element: "Sewer", description: "Pipe", quantity: "193.1", unit: "m", rate: "2500", lumpSum: null }],
      corrections: [{ position: 1, ref: "A", element: "Earthworks", description: "Platforms", amount: "952000", basis: "Reconciled levels" }],
    },
  ],
};

describe("the estimate comparison workbook", () => {
  it("has a summary, a sheet per estimate with safe names, the gap and the clarifications", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await estimateComparisonWorkbook(comparison, { practice: "P", projectName: "X", exportedOn: "13 Nov 2026", exportedBy: "R" })) as unknown as ArrayBuffer);
    const names = wb.worksheets.map((w) => w.name);
    expect(names[0]).toBe("Summary");
    expect(names).toContain("Allowances");
    expect(names.every((n) => n.length <= 31 && !/[[\]:*?/\\]/.test(n))).toBe(true);
    expect(names.slice(-2)).toEqual(["Gap", "Clarifications"]);
  });

  it("sums elements from each estimate's sheet by formula, corrections included, with the computed figure cached", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await estimateComparisonWorkbook(comparison, { practice: "P", projectName: "X", exportedOn: "13 Nov 2026", exportedBy: "R" })) as unknown as ArrayBuffer);
    const s = wb.getWorksheet("Summary")!;
    const earthworksMeasured = s.getCell("C5").value as ExcelJS.CellFormulaValue;
    expect(earthworksMeasured.formula).toMatch(/^SUMIF\(.+\)\+SUMIF\(.+\)$/);
    expect(earthworksMeasured.result).toBe(952000);
    const direct = s.getRow(7);
    expect(direct.getCell(1).value).toBe("Direct works");
    expect((direct.getCell(2).value as ExcelJS.CellFormulaValue).result).toBe(3140000);
  });
});
