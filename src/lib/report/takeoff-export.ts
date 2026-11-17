/**
 * The take-off, exported — a workbook to compare offline, and a printed dimension sheet.
 *
 * Asked for in the November meeting: the measuring agent's take-off had to be checked against the
 * real tender and the engineer's quantities, and that comparison happens in a spreadsheet beside
 * the other documents, not on a screen in the platform.
 *
 * ── The workbook does the arithmetic, the same way the platform does ───────────────────────
 *
 * The practice's rule (`bill-workbook.ts`): a spreadsheet where numbers are worked, a PDF where the
 * thing is read. So every dimension line is a formula over its own timesing and dimensions, every
 * item total is a SUM of its lines, and the summary links to those totals. The formula rounds to
 * four places after each multiplication, exactly as `domain/dimensions.ts` does (half away from
 * zero, which is also what Excel's ROUND does) – so a figure a reader corrects in Excel comes out
 * as the platform would have computed it, not a few ten-thousandths different.
 *
 * The summary has a shaded "compare with" column for the figure being checked against, and the
 * difference and percentage work themselves out. Nothing in it is a picture of a number.
 *
 * Pure: items in, bytes out. `listTakeoff` and `listParameters` read the database; this does not.
 */

import ExcelJS from "exceljs";

import { displayUnit, formatQuantity, parseQuantity } from "@/domain/money";
import { createPdf, PAGE } from "@/lib/pdf/writer";
import type { ParameterView, TakeoffItemView } from "@/lib/takeoff";

export interface TakeoffSubject {
  practice: string;
  projectName: string;
  code: string | null;
  /** When it was exported – a take-off is a working document and changes as it is measured. */
  exportedOn: string;
  exportedBy: string;
}

const NAVY = "FF1F3A5F";
const LIGHT = "FFEEF2F7";
const INPUT = "FFFFF3D1";
const GREY = "FF56606E";
const QTY = "#,##0.0000;[Red]-#,##0.0000";
const QTY2 = "#,##0.00;[Red]-#,##0.00";

/** A stored four-place figure ("12.3456") as a number for a cell, or null. */
const num = (stored: string | null): number | null => {
  if (stored === null || stored.trim() === "") return null;
  const value = Number(stored);
  return Number.isFinite(value) ? value : null;
};

/**
 * The line's quantity as a formula: timesing, times each dimension present, rounded to four places
 * after every multiplication – `lineQuantity` in `domain/dimensions.ts`, written for Excel.
 */
export function lineFormula(row: number, dims: readonly ("D" | "E" | "F")[], deduct: boolean): string {
  const product = dims.reduce((acc, col) => `ROUND(${acc}*${col}${row},4)`, `C${row}`);
  return deduct ? `-(${product})` : product;
}

export async function takeoffWorkbook(items: readonly TakeoffItemView[], parameters: readonly ParameterView[], s: TakeoffSubject): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = s.practice;
  wb.created = new Date();

  const summary = wb.addWorksheet("Summary", { views: [{ state: "frozen", ySplit: 5 }] });
  const sheet = wb.addWorksheet("Take-off", { views: [{ state: "frozen", ySplit: 5 }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const assumptions = wb.addWorksheet("Assumptions");

  const title = (ws: ExcelJS.Worksheet, text: string, span: number, note: string) => {
    ws.mergeCells(1, 1, 1, span);
    Object.assign(ws.getCell("A1"), { value: text, font: { bold: true, size: 14, color: { argb: NAVY } } });
    ws.mergeCells(2, 1, 2, span);
    Object.assign(ws.getCell("A2"), {
      value: `${s.projectName}${s.code ? ` · ${s.code}` : ""} · exported ${s.exportedOn} by ${s.exportedBy} · ${s.practice}`,
      font: { size: 9, color: { argb: GREY } },
    });
    ws.mergeCells(3, 1, 3, span);
    Object.assign(ws.getCell("A3"), { value: note, font: { size: 9, color: { argb: GREY } }, alignment: { wrapText: true } });
    ws.getRow(3).height = 26;
  };
  const header = (ws: ExcelJS.Worksheet, labels: readonly string[]) => {
    const row = ws.getRow(5);
    labels.forEach((label, i) => {
      const cell = row.getCell(i + 1);
      cell.value = label;
      cell.font = { bold: true, size: 9 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } };
      cell.border = { bottom: { style: "medium", color: { argb: NAVY } } };
    });
  };

  // ── The dimension sheet ────────────────────────────────────────────────────────────────────
  sheet.columns = [{ width: 7 }, { width: 46 }, { width: 9 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 14 }, { width: 44 }];
  title(sheet, "Take-off – dimension sheets", 8, "Each quantity is its timesing × its dimensions, rounded to four places after each multiplication, as the platform measures it. Deductions are negative. Change a dimension and the item and the summary follow.");
  header(sheet, ["Item", "Location / description", "Times", "Length", "Width", "Depth", "Quantity", "Working / note"]);

  const totalCell = new Map<string, string>();
  let section: string | null | undefined;

  for (const item of items) {
    if (item.section !== section) {
      section = item.section;
      if (section) {
        sheet.addRow([]);
        const h = sheet.addRow([null, section.toUpperCase()]);
        h.getCell(2).font = { bold: true, size: 10, color: { argb: NAVY } };
      }
    }

    sheet.addRow([]);
    const head = sheet.addRow([item.number, item.description, null, null, null, null, displayUnit(item.unit), item.origin === "drawings" ? "Measured from drawings by the agent" : null]);
    head.font = { bold: true, size: 10 };
    head.getCell(2).alignment = { wrapText: true, vertical: "top" };
    head.getCell(7).alignment = { horizontal: "right" };
    head.getCell(8).font = { italic: true, size: 8.5, color: { argb: GREY } };
    if (item.note) {
      const n = sheet.addRow([null, item.note]);
      n.getCell(2).font = { italic: true, size: 8.5, color: { argb: GREY } };
      n.getCell(2).alignment = { wrapText: true };
    }

    const first = sheet.rowCount + 1;
    item.lines.forEach((line, index) => {
      const r = sheet.addRow([null, line.location ?? "", num(line.timesing), num(line.length), num(line.width), num(line.depth)]);
      const dims = (["D", "E", "F"] as const).filter((_, i) => [line.length, line.width, line.depth][i] !== null);
      const mismatch = item.mismatched.find((m) => m.index === index);
      r.getCell(7).value = { formula: lineFormula(r.number, dims, line.deduct), result: num(line.quantity) ?? 0 };
      r.getCell(8).value = [line.deduct ? "Deduct" : null, line.working, mismatch?.reason].filter(Boolean).join(" · ") || null;
      for (const c of [3, 4, 5, 6]) r.getCell(c).numFmt = QTY;
      r.getCell(7).numFmt = QTY;
      r.getCell(8).font = { size: 8.5, color: { argb: mismatch ? "FFB42318" : GREY } };
      r.getCell(8).alignment = { wrapText: true };
    });
    const last = sheet.rowCount;

    const total = sheet.addRow([null, "Total", null, null, null, null]);
    total.getCell(7).value =
      last >= first ? { formula: `SUM(G${first}:G${last})`, result: num(item.total) ?? 0 } : 0;
    total.getCell(7).numFmt = QTY;
    total.font = { bold: true };
    total.getCell(7).border = { top: { style: "thin" }, bottom: { style: "double" } };
    if (item.negative) total.getCell(8).value = "More deducted than measured – check the sheet.";
    totalCell.set(item.id, `'Take-off'!G${total.number}`);
  }

  // ── The summary, for the comparison ────────────────────────────────────────────────────────
  summary.columns = [{ width: 7 }, { width: 50 }, { width: 7 }, { width: 14 }, { width: 10 }, { width: 14 }, { width: 16 }, { width: 14 }, { width: 11 }];
  title(summary, "Take-off – summary for comparison", 9, "Measured quantities come from the dimension sheets. Enter the figure you are comparing with – a tenderer's or the engineer's quantity – in the shaded column; the difference is measured minus that figure.");
  header(summary, ["Item", "Description", "Unit", "Measured", "Bill item", "On the bill", "Compare with", "Difference", "Diff %"]);

  for (const item of items) {
    const r = summary.addRow([
      item.number,
      item.description,
      displayUnit(item.unit),
      null,
      item.bill?.ref ?? null,
      item.bill?.quantity !== undefined && item.bill?.quantity !== null ? num(item.bill.quantity) : null,
      null,
    ]);
    r.getCell(4).value = { formula: totalCell.get(item.id)!, result: num(item.total) ?? 0 };
    const n = r.number;
    r.getCell(8).value = { formula: `IF(G${n}="","",D${n}-G${n})` };
    r.getCell(9).value = { formula: `IF(OR(G${n}="",G${n}=0),"",(D${n}-G${n})/G${n})` };
    r.getCell(7).fill = { type: "pattern", pattern: "solid", fgColor: { argb: INPUT } };
    for (const c of [4, 6, 7, 8]) r.getCell(c).numFmt = QTY2;
    r.getCell(9).numFmt = "0.0%;[Red]-0.0%";
    r.getCell(2).alignment = { wrapText: true };
  }

  // ── What the measurement rests on ──────────────────────────────────────────────────────────
  assumptions.columns = [{ width: 10 }, { width: 34 }, { width: 14 }, { width: 8 }, { width: 22 }, { width: 60 }, { width: 34 }];
  title(assumptions, "What the measurement from drawings rests on", 7, "Read: printed on a drawing, with the words it was read from. Derived: worked out from figures that were read. Assumed: not on any drawing – a person must confirm it before the quantities are relied on.");
  header(assumptions, ["Status", "Figure", "Value", "Unit", "Worked as", "Quote or assumption", "Source"]);
  for (const p of parameters) {
    const r = assumptions.addRow([
      p.status,
      p.label,
      num(p.value),
      displayUnit(p.unit),
      p.expression ?? p.figure ?? null,
      p.status === "assumed" ? (p.assumption ?? "") : (p.quote ?? ""),
      p.source ? `${p.source.name}${p.source.page ? `, page ${p.source.page}` : ""}` : null,
    ]);
    if (p.status === "assumed") r.getCell(1).font = { bold: true, color: { argb: "FFB54708" } };
    r.getCell(6).alignment = { wrapText: true };
  }
  if (parameters.length === 0) assumptions.addRow([null, "No measurement from drawings has been run on this project."]);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** The printed dimension sheet – to file, mark up and read beside the drawings. */
export function takeoffPdf(items: readonly TakeoffItemView[], parameters: readonly ParameterView[], s: TakeoffSubject): Buffer {
  const W = PAGE.textWidth;
  const COL = {
    location: { x: 0, width: W - 330 },
    times: { x: W - 326, width: 44 },
    length: { x: W - 278, width: 62 },
    width: { x: W - 212, width: 62 },
    depth: { x: W - 146, width: 62 },
    quantity: { x: W - 80, width: 80 },
  };
  const q = (stored: string | null) => (stored === null ? "" : formatQuantity(parseQuantity(stored), 2));

  const doc = createPdf({ title: `${s.projectName} – Take-off` });
  doc.footerOnEveryPage((page, total) => `${s.practice} · ${s.projectName}${s.code ? ` · ${s.code}` : ""}   –   Take-off   –   Page ${page} of ${total}`);

  doc.text(s.practice, { size: 9, grey: 0.35, gap: 2 });
  doc.text("Take-off – dimension sheets", { size: 16, bold: true, gap: 2 });
  doc.text(`${s.projectName}${s.code ? ` · ${s.code}` : ""}`, { size: 11, gap: 4 });
  doc.text(`Exported ${s.exportedOn} by ${s.exportedBy}. A working document: quantities change as the take-off is measured.`, { size: 8.5, grey: 0.4, gap: 8 });
  doc.rule({ gap: 8 });

  if (items.length === 0) doc.text("Nothing has been measured on this project yet.", { size: 10 });

  let section: string | null | undefined;
  for (const item of items) {
    if (item.section !== section) {
      section = item.section;
      if (section) doc.heading(section, { size: 11 });
    }
    doc.reserve(60);
    doc.row(
      [
        { text: `${item.number}. ${item.description}`, x: 0, width: W - 90, bold: true },
        { text: displayUnit(item.unit), x: W - 80, width: 80, align: "right", bold: true },
      ],
      { size: 9.5, gap: 2 },
    );
    if (item.note) doc.text(item.note, { size: 7.5, grey: 0.45, gap: 2 });
    doc.row(
      [
        { text: "Location", ...COL.location, grey: 0.45 },
        { text: "Times", ...COL.times, align: "right", grey: 0.45 },
        { text: "Length", ...COL.length, align: "right", grey: 0.45 },
        { text: "Width", ...COL.width, align: "right", grey: 0.45 },
        { text: "Depth", ...COL.depth, align: "right", grey: 0.45 },
        { text: "Quantity", ...COL.quantity, align: "right", grey: 0.45 },
      ],
      { size: 7.5, gap: 1 },
    );
    for (const line of item.lines) {
      doc.row([
        { text: `${line.deduct ? "Ddt " : ""}${line.location ?? ""}`, ...COL.location },
        { text: q(line.timesing), ...COL.times, align: "right" },
        { text: q(line.length), ...COL.length, align: "right" },
        { text: q(line.width), ...COL.width, align: "right" },
        { text: q(line.depth), ...COL.depth, align: "right" },
        { text: q(line.quantity), ...COL.quantity, align: "right" },
      ], { size: 8.5, gap: 1 });
      if (line.working) doc.row([{ text: line.working, ...COL.location, grey: 0.5 }], { size: 7, gap: 1 });
    }
    for (const m of item.mismatched) doc.text(m.reason, { size: 7.5, grey: 0.3, gap: 1 });
    doc.rule({ gap: 2, thickness: 0.4 });
    doc.row(
      [
        { text: item.bill ? `To bill item ${item.bill.ref}` : "Not yet on the bill", ...COL.location, grey: 0.45 },
        { text: `${q(item.total)} ${displayUnit(item.unit)}`, x: W - 160, width: 160, align: "right", bold: true },
      ],
      { size: 9, gap: 8 },
    );
  }

  const assumed = parameters.filter((p) => p.status === "assumed");
  if (assumed.length > 0) {
    doc.space(6);
    doc.heading("Assumed – not on any drawing", { size: 11 });
    for (const p of assumed) {
      doc.text(`${p.label}: ${p.value} ${displayUnit(p.unit)}${p.assumption ? ` – ${p.assumption}` : ""}`, { size: 8.5, gap: 2 });
    }
  }

  return doc.build();
}
