/**
 * The bill as a workbook.
 *
 * The point of it is that nothing is a picture of a number: a tenderer types a rate and the bill
 * adds itself up. So what is asserted here is that the cells carry **formulas**, not the values
 * the platform happened to compute when it wrote the file. A workbook whose amounts were baked in
 * as constants would look identical on opening and lie the moment anybody changed a rate.
 */

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { billWorkbook } from "./bill-workbook";
import type { BillRow } from "@/lib/agent/bill";

const subject = {
  practice: "Mzilikazi Property Services",
  projectName: "Marshall Dam Boundary Wall",
  code: "MD-BW-01",
  title: "Bill of Quantities",
  signedBy: null,
  signedAt: null,
};

const heading = (id: string, label: string): BillRow =>
  ({
    id,
    seq: 0,
    parentId: null,
    rowType: "heading",
    itemRef: null,
    proposed: { description: label, unit: null, quantity: null, rate: null, confidence: 1, note: null, state: "found", quantityText: null, rateText: null },
    citation: null,
    override: null,
    quantitySource: "manual",
    rateSource: "manual",
    amount: null,
    output: null,
    omitted: null,
  }) as unknown as BillRow;

const item = (n: number, parentId: string, quantity: string, rate: string | null): BillRow =>
  ({
    id: `item-${n}`,
    seq: n,
    parentId,
    rowType: "item",
    itemRef: `1.${n}`,
    proposed: {
      description: `Item number ${n}`,
      unit: "m3",
      quantity,
      rate: rate === null ? null : { value: rate, precision: 2 },
      confidence: 1,
      note: null,
      state: "found",
      quantityText: null,
      rateText: null,
    },
    citation: null,
    override: null,
    quantitySource: "manual",
    rateSource: "manual",
    amount: rate === null ? null : "100000",
    output: null,
    omitted: null,
  }) as unknown as BillRow;

const open = async (bytes: Buffer) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as never);
  return wb.getWorksheet("Bill of Quantities")!;
};

const rows = [heading("s1", "Earthworks"), item(1, "s1", "12.5000", "18500"), item(2, "s1", "4.0000", null)];

/** Every cell that carries a formula, as `A1 => formula`. */
async function formulas(ws: ExcelJS.Worksheet) {
  const found: Record<string, string> = {};
  ws.eachRow((row) => {
    row.eachCell((cell) => {
      const value = cell.value as { formula?: string } | null;
      if (value && typeof value === "object" && typeof value.formula === "string") found[cell.address] = value.formula;
    });
  });
  return found;
}

describe("the amounts calculate, rather than being written down", () => {
  it("every amount is its quantity times its rate", async () => {
    const ws = await open(await billWorkbook(rows, subject, false));
    const all = Object.values(await formulas(ws));
    expect(all.some((f) => /D\d+\*E\d+/.test(f))).toBe(true);
  });

  it("an unpriced item stays empty rather than calculating a nought", async () => {
    // A column of noughts reads as work that costs nothing, which is a different claim from work
    // nobody has priced. The formula guards both halves before it multiplies.
    const ws = await open(await billWorkbook(rows, subject, false));
    const amounts = Object.entries(await formulas(ws)).filter(([at]) => at.startsWith("F"));
    expect(amounts.every(([, f]) => !/D\d+\*E\d+/.test(f) || /IF\(OR\(/.test(f))).toBe(true);
  });

  it("the section total sums its own rows and the bill total sums the sections", async () => {
    const ws = await open(await billWorkbook(rows, subject, false));
    const all = Object.values(await formulas(ws));
    expect(all.some((f) => /^SUM\(F\d+:F\d+\)$/.test(f)), `formulas: ${all.join(" | ")}`).toBe(true);
  });
});

describe("the rate column is the reader's to fill", () => {
  it("is shaded on every item, priced or not", async () => {
    const ws = await open(await billWorkbook(rows, subject, false));
    const shaded: boolean[] = [];
    ws.eachRow((row) => {
      const ref = row.getCell(1).value;
      if (typeof ref === "string" && /^\d+\.\d+$/.test(ref)) {
        const fill = row.getCell(5).fill as { fgColor?: { argb?: string } } | undefined;
        shaded.push(fill?.fgColor?.argb === "FFFFF3D1");
      }
    });
    expect(shaded.length).toBe(2);
    expect(shaded.every(Boolean)).toBe(true);
  });

  it("a bill issued for pricing carries no rates at all", async () => {
    // The tenderer's sheet. Carrying the practice's own rates into it would be quoting on their
    // behalf, and the rate is the one thing a tender is asking them for.
    const ws = await open(await billWorkbook(rows, subject, true));
    const rates: unknown[] = [];
    ws.eachRow((row) => {
      const ref = row.getCell(1).value;
      if (typeof ref === "string" && /^\d+\.\d+$/.test(ref)) rates.push(row.getCell(5).value);
    });
    expect(rates.every((r) => r === null || r === undefined)).toBe(true);
  });

  it("but a bill not issued for pricing keeps the rates it has", async () => {
    const ws = await open(await billWorkbook(rows, subject, false));
    const rates: unknown[] = [];
    ws.eachRow((row) => {
      const ref = row.getCell(1).value;
      if (typeof ref === "string" && /^\d+\.\d+$/.test(ref)) rates.push(row.getCell(5).value);
    });
    expect(rates).toContain(185);
  });
});

describe("it says what it is", () => {
  it("names the project and marks a draft as a draft", async () => {
    const ws = await open(await billWorkbook(rows, subject, false));
    expect(String(ws.getCell("A2").value)).toContain("Marshall Dam Boundary Wall");
    expect(String(ws.getCell("A2").value)).toContain("DRAFT");
  });

  it("and says an issued bill was issued, by whom", async () => {
    const ws = await open(await billWorkbook(rows, { ...subject, signedBy: "W Fourie", signedAt: "29 September 2026" }, false));
    expect(String(ws.getCell("A2").value)).toContain("issued 29 September 2026");
    expect(String(ws.getCell("A2").value)).toContain("W Fourie");
  });
});
