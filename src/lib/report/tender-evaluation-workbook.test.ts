// ExcelJS types `load` against an older Buffer than Node's; the cast is the one rfq-workbook.test.ts uses.
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import type { EvaluationItem, EvaluationReturn } from "@/domain/tender-evaluation";
import { col, tenderEvaluationWorkbook } from "./tender-evaluation-workbook";

const subject = { practice: "Test QS", projectName: "Boundary wall", code: null, exportedOn: "12 Nov 2026", exportedBy: "Raymond" };
const items: EvaluationItem[] = Array.from({ length: 6 }, (_, i) => ({ id: `i${i}`, ref: `${i + 1}`, description: `Item ${i + 1}`, unit: "m2", quantity: 10, estimateRate: 100 + i * 10 }));
const base = new Map(items.map((it) => [it.id, it.estimateRate! * 0.95] as const));
const tenders: EvaluationReturn[] = [
  { id: "a", tenderer: "Source", rates: base },
  { id: "b", tenderer: "Copier", rates: new Map([...base].map(([k, v]) => [k, Math.round(v * 112) / 100])) },
];

async function open() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await tenderEvaluationWorkbook(items, tenders, subject)) as unknown as ArrayBuffer);
  return wb;
}

describe("col", () => {
  it("letters columns as Excel does", () => {
    expect([col(1), col(26), col(27), col(52)]).toEqual(["A", "Z", "AA", "AZ"]);
  });
});

describe("tenderEvaluationWorkbook", () => {
  it("writes each variance as a formula over the rates beside it", async () => {
    const ws = (await open()).getWorksheet("Against estimate")!;
    // Source's columns are G (rate), H (amount), I (vs est.).
    expect(ws.getCell("G6").value).toBeCloseTo(95, 9);
    expect(ws.getCell("H6").formula).toBe('IF(OR(D6="",G6=""),"",D6*G6)');
    expect(ws.getCell("I6").formula).toBe('IF(OR(E6="",E6=0,G6=""),"",(G6-E6)/E6)');
  });

  it("puts the copier on the collusion sheet, with the ratios to check it by", async () => {
    const ws = (await open()).getWorksheet("Collusion indicators")!;
    const cells: string[] = [];
    ws.eachRow((row) => row.eachCell((c) => cells.push(String(c.value))));
    expect(cells).toContain("Uniform uplift");
    expect(cells.some((c) => /Copier's rates are Source's plus 12\.0%/.test(c))).toBe(true);
    expect(cells.some((c) => /Priced from one source/.test(c))).toBe(true);
  });

  it("scores price under the PPPFA from the tender totals, against the lowest", async () => {
    const ws = (await open()).getWorksheet("Scoring")!;
    expect(ws.getCell("B6").value).toBe(80);
    expect(String(ws.getCell("C6").formula)).toMatch(/^MAX\(0,\$B\$6\*\(1-\('Against estimate'!H\d+-MIN\(/);
  });
});
