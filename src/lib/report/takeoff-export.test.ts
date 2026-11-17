// ExcelJS types `load` against an older Buffer than Node's; the cast is the one rfq-workbook.test.ts uses.
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { measure } from "@/domain/dimensions";
import { parseQuantity, quantityToNumeric } from "@/domain/money";
import type { ParameterView, TakeoffItemView } from "@/lib/takeoff";
import { lineFormula, takeoffPdf, takeoffWorkbook } from "./takeoff-export";

const subject = { practice: "Test QS", projectName: "Boundary wall", code: "BW-01", exportedOn: "12 Nov 2026", exportedBy: "Thandi Nkosi" };

function item(over: Partial<TakeoffItemView> & Pick<TakeoffItemView, "lines">): TakeoffItemView {
  return {
    id: "i1", number: 1, section: "Masonry", description: "One-brick wall", unit: "m2", drawingId: null, origin: "drawings",
    note: null, total: "0", mismatched: [], negative: false, bill: null, sent: null, ...over,
  };
}
const line = (id: string, timesing: string, length: string | null, width: string | null, deduct = false, quantity = "0") => ({
  id, seq: 1, location: `Panel ${id}`, timesing, length, width, depth: null, deduct, working: null, quantity,
});

/** Excel's ROUND (half away from zero), and the formula `lineFormula` writes, evaluated in JS. */
const round4 = (x: number) => Math.sign(x) * Math.round(Math.abs(x) * 1e4 + 1e-9) / 1e4;
function evaluate(timesing: number, dims: number[], deduct: boolean): number {
  const product = dims.reduce((acc, d) => round4(acc * d), timesing);
  return deduct ? -product : product;
}

describe("lineFormula", () => {
  it("rounds after every multiplication, as the platform measures", () => {
    expect(lineFormula(7, ["D", "E"], false)).toBe("ROUND(ROUND(C7*D7,4)*E7,4)");
    expect(lineFormula(9, [], false)).toBe("C9");
    expect(lineFormula(3, ["D"], true)).toBe("-(ROUND(C3*D3,4))");
  });

  it("gives the platform's own figure for awkward dimensions", () => {
    const cases = [
      { t: "3", d: ["12.3457", "2.8333"], deduct: false },
      { t: "1", d: ["0.3333", "0.3333", "0.3333"], deduct: false },
      { t: "2", d: ["1.0005", "1.0005"], deduct: true },
    ];
    for (const c of cases) {
      const platform = measure(null, [{ timesing: parseQuantity(c.t), dimensions: c.d.map(parseQuantity), deduct: c.deduct }]).total;
      expect(evaluate(Number(c.t), c.d.map(Number), c.deduct)).toBeCloseTo(Number(quantityToNumeric(platform)), 4);
    }
  });
});

describe("takeoffWorkbook", () => {
  const items = [
    item({ lines: [line("a", "2", "12.5000", "2.4000", false, "60.0000"), line("b", "1", "1.2000", "2.1000", true, "-2.5200")], total: "57.4800", bill: { itemId: "b1", ref: "B3", description: "Brickwork", quantity: "55.0000", source: "takeoff" } }),
    item({ id: "i2", number: 2, section: "Masonry", description: "Brick piers", unit: "no", lines: [line("c", "14", null, null, false, "14.0000")], total: "14.0000" }),
  ];
  const parameters: ParameterView[] = [
    { name: "h", label: "Wall height", status: "assumed", value: "2.4", unit: "m", figure: null, expression: null, quote: null, assumption: "Typical boundary wall", source: null },
  ];

  it("writes live formulas for every line, total and summary figure", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await takeoffWorkbook(items, parameters, subject)) as unknown as ArrayBuffer);

    const sheet = wb.getWorksheet("Take-off")!;
    const formulas: string[] = [];
    sheet.eachRow((row) => row.eachCell((cell) => { if (cell.formula) formulas.push(cell.formula); }));
    expect(formulas.some((f) => /^ROUND\(ROUND\(C\d+\*D\d+,4\)\*E\d+,4\)$/.test(f))).toBe(true);
    expect(formulas.some((f) => /^-\(ROUND\(ROUND\(C\d+\*D\d+,4\)\*E\d+,4\)\)$/.test(f))).toBe(true);
    expect(formulas.filter((f) => f.startsWith("SUM(G"))).toHaveLength(2);

    const summary = wb.getWorksheet("Summary")!;
    const first = summary.getRow(6);
    expect(first.getCell(4).formula).toMatch(/^'Take-off'!G\d+$/);
    expect(first.getCell(4).result).toBe(57.48);
    expect(first.getCell(5).value).toBe("B3");
    expect(first.getCell(6).value).toBe(55);
    expect(first.getCell(8).formula).toBe('IF(G6="","",D6-G6)');
    expect(first.getCell(9).formula).toBe('IF(OR(G6="",G6=0),"",(D6-G6)/G6)');
  });

  it("points each summary row at its own item's total", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await takeoffWorkbook(items, parameters, subject)) as unknown as ArrayBuffer);
    const sheet = wb.getWorksheet("Take-off")!;
    const summary = wb.getWorksheet("Summary")!;
    for (const r of [6, 7]) {
      const ref = Number(String(summary.getRow(r).getCell(4).formula).match(/G(\d+)$/)![1]);
      expect(sheet.getRow(ref).getCell(7).formula).toMatch(/^SUM\(G\d+:G\d+\)$/);
      expect(sheet.getRow(ref).getCell(7).result).toBe(summary.getRow(r).getCell(4).result);
    }
  });

  it("lists what the measurement rests on, assumed first", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await takeoffWorkbook(items, parameters, subject)) as unknown as ArrayBuffer);
    const row = wb.getWorksheet("Assumptions")!.getRow(6);
    expect(row.getCell(1).value).toBe("assumed");
    expect(row.getCell(6).value).toBe("Typical boundary wall");
  });

  it("still exports an empty take-off", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await takeoffWorkbook([], [], subject)) as unknown as ArrayBuffer);
    expect(wb.getWorksheet("Summary")).toBeDefined();
  });
});

describe("takeoffPdf", () => {
  it("prints a PDF", () => {
    const bytes = takeoffPdf([item({ lines: [line("a", "2", "12.5000", "2.4000", false, "60.0000")], total: "60.0000" })], [], subject);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(800);
  });
});
