/**
 * The Bill of Quantities as a workbook — D1.2.
 *
 * ── Which documents are spreadsheets, and which are paper ──────────────────────────────────
 *
 * The practice's rule, and it is the right one: **a spreadsheet where numbers and amounts have to
 * be calculated, a PDF where the thing is a report or a summary.** A cost report is read; an
 * elemental plan is read; a payment certificate is signed. A bill is *worked in* — a tenderer puts
 * a rate against every item and the amounts have to come out, and a quantity surveyor checking a
 * returned bill wants to see the arithmetic, not a picture of it.
 *
 * The printed bill stays, because a bill is also issued, signed and filed. This is the other half
 * of the same document, and the two are generated from one list of rows so they cannot disagree.
 *
 * ── Nothing here is a picture of a number ──────────────────────────────────────────────────
 *
 * Every amount is `=quantity*rate`, every section total is a `SUM` over its own rows, and the bill
 * total is a `SUM` of the section totals. Open it, type a rate, and the bill adds itself up. That
 * is not a convenience: a bill issued for pricing whose amounts were baked in as constants is a
 * bill that lies the moment a tenderer changes anything, and the three draft bills this practice
 * was sent by a contractor all work exactly this way.
 *
 * ── The rate column is an input cell, and says so ──────────────────────────────────────────
 *
 * Shaded, like the input cells in the comparative workbook, because a reader has to be able to see
 * at a glance which figures are theirs to set and which the sheet works out. An item nobody has
 * priced is left empty rather than noughted — §1.3 again: a rate of nought is a priced item that
 * costs nothing, which is a different claim from an item nobody has priced.
 */

import ExcelJS from "exceljs";

import { formatQuantity, quantity as asQuantity } from "@/domain/money";
import { billLines } from "@/lib/report/bill-pages";
import type { BillRow } from "@/lib/agent/bill";

export interface BillWorkbookSubject {
  practice: string;
  projectName: string;
  code: string | null;
  title: string;
  signedBy: string | null;
  signedAt: string | null;
}

const NAVY = "FF1F3A5F";
const LIGHT = "FFEEF2F7";
const INPUT = "FFFFF3D1";
const MONEY = '#,##0.00;[Red]-#,##0.00';
const QTY = "#,##0.00";

/**
 * A quantity as a number, from the fixed-point string the bill stores it as.
 *
 * Through `formatQuantity` and back rather than `Number(text)`: the stored form is scaled integers
 * and the formatter is the one place that knows the scale. A quantity that arrived here an
 * order of magnitude out would be invisible — it would simply be a plausible bill.
 */
const quantityOf = (text: string | null): number | null => {
  if (text === null) return null;
  const formatted = formatQuantity(asQuantity(BigInt(text.replace(".", ""))));
  const value = Number(formatted.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(value) ? value : null;
};

const rateOf = (rate: { value: string; precision: number } | null): number | null =>
  rate === null ? null : Number(rate.value) / 10 ** rate.precision;

export async function billWorkbook(rows: readonly BillRow[], s: BillWorkbookSubject, forPricing: boolean): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = s.practice;
  wb.created = new Date();

  const ws = wb.addWorksheet("Bill of Quantities", {
    views: [{ state: "frozen", ySplit: 5 }],
    pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  ws.columns = [
    { width: 9 }, // item
    { width: 62 }, // description
    { width: 7 }, // unit
    { width: 12 }, // quantity
    { width: 13 }, // rate
    { width: 15 }, // amount
  ];

  ws.mergeCells(1, 1, 1, 6);
  const heading = ws.getCell("A1");
  heading.value = s.title;
  heading.font = { bold: true, size: 14, color: { argb: NAVY } };

  ws.mergeCells(2, 1, 2, 6);
  const strap = ws.getCell("A2");
  strap.value =
    `${s.projectName}${s.code ? ` · ${s.code}` : ""}` +
    (s.signedAt ? ` · issued ${s.signedAt}${s.signedBy ? ` by ${s.signedBy}` : ""}` : " · DRAFT");
  strap.font = { size: 9, color: { argb: "FF56606E" } };

  ws.mergeCells(3, 1, 3, 6);
  const note = ws.getCell("A3");
  note.value = forPricing
    ? "Rates are to be inserted in the shaded cells. Amounts, section totals and the bill total calculate themselves."
    : "Shaded cells are rates. Every amount is its quantity times its rate; the totals are live sums, so a changed rate carries through.";
  note.font = { size: 9, color: { argb: "FF56606E" } };
  note.alignment = { wrapText: true };

  const header = ws.getRow(5);
  ["Item", "Description", "Unit", "Quantity", "Rate (R)", "Amount (R)"].forEach((label, i) => {
    const cell = header.getCell(i + 1);
    cell.value = label;
    cell.font = { bold: true, size: 9 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } };
    cell.border = { bottom: { style: "medium", color: { argb: NAVY } } };
  });

  /*
    The same lines the printed bill is made of.

    `billLines` is where a bill becomes headings, items and section totals; using it here is what
    stops the two documents drifting into different bills of the same job.
  */
  const lines = billLines(rows, Boolean(s.signedAt));

  // Section totals, gathered so the collection at the foot can sum them rather than re-add items.
  const sectionTotalRows: number[] = [];
  let firstItemOfSection: number | null = null;
  let lastItemOfSection: number | null = null;

  for (const line of lines) {
    if (line.kind === "heading") {
      ws.addRow([]);
      const row = ws.addRow([null, line.label.toUpperCase()]);
      row.getCell(2).font = { bold: true, size: 10, color: { argb: NAVY } };
      firstItemOfSection = null;
      lastItemOfSection = null;
      continue;
    }

    if (line.kind === "subtotal") {
      const row = ws.addRow([null, `${line.label} – section total`]);
      row.getCell(2).font = { bold: true, size: 10 };
      const cell = row.getCell(6);
      // A sum over this section's own rows, not the stored figure. An empty section sums nothing.
      cell.value =
        firstItemOfSection === null || lastItemOfSection === null
          ? 0
          : { formula: `SUM(F${firstItemOfSection}:F${lastItemOfSection})`, date1904: false };
      cell.numFmt = MONEY;
      cell.font = { bold: true };
      cell.border = { top: { style: "thin" }, bottom: { style: "double" } };
      sectionTotalRows.push(row.number);
      continue;
    }

    const q = quantityOf(line.quantity);
    const rate = rateOf(line.rate as { value: string; precision: number } | null);
    const row = ws.addRow([line.ref, line.description, line.unit, q, forPricing ? null : rate]);

    row.getCell(2).alignment = { wrapText: true, vertical: "top" };
    row.getCell(4).numFmt = QTY;

    const rateCell = row.getCell(5);
    rateCell.numFmt = MONEY;
    // Shaded whether or not it carries a figure: the shading says "this one is yours to set".
    rateCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INPUT } };

    const amount = row.getCell(6);
    /*
      Blank until both halves are there.

      `=D*E` on an unpriced item gives nought, and a column of noughts reads as work that costs
      nothing rather than work nobody has priced. The IF keeps the distinction the printed bill
      makes with "Not Priced".
    */
    amount.value = {
      formula: `IF(OR(D${row.number}="",E${row.number}=""),"",D${row.number}*E${row.number})`,
      date1904: false,
    };
    amount.numFmt = MONEY;

    if (firstItemOfSection === null) firstItemOfSection = row.number;
    lastItemOfSection = row.number;
  }

  // ── The collection ────────────────────────────────────────────────────────────────────────
  ws.addRow([]);
  const total = ws.addRow([null, "Bill total"]);
  total.getCell(2).font = { bold: true, size: 11, color: { argb: NAVY } };
  const totalCell = total.getCell(6);
  totalCell.value = sectionTotalRows.length
    ? { formula: sectionTotalRows.map((n) => `F${n}`).join("+"), date1904: false }
    : 0;
  totalCell.numFmt = MONEY;
  totalCell.font = { bold: true, size: 11 };
  totalCell.border = { top: { style: "thin" }, bottom: { style: "double" } };

  return Buffer.from(await wb.xlsx.writeBuffer());
}
