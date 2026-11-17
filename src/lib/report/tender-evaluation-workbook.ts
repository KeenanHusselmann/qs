/**
 * The tender evaluation, as a workbook – November meeting.
 *
 * The shape Raymond's own evaluation took: the bids against the estimate line by line, a separate
 * collusion indicators sheet, and the scoring. A workbook rather than a PDF because an evaluation is
 * worked in (`bill-workbook.ts`): every variance is a formula over the rates beside it, the ratios
 * behind each indicator are on the sheet so anybody can check them, and the scoring sheet's weights
 * and quality scores are inputs whose points and totals calculate.
 *
 * Pure: inputs in, bytes out.
 */

import ExcelJS from "exceljs";

import { collusionIndicators, VARIANCE_FLAG, type EvaluationItem, type EvaluationReturn } from "@/domain/tender-evaluation";

export interface EvaluationSubject {
  practice: string;
  projectName: string;
  code: string | null;
  exportedOn: string;
  exportedBy: string;
}

const NAVY = "FF1F3A5F";
const LIGHT = "FFEEF2F7";
const INPUT = "FFFFF3D1";
const GREY = "FF56606E";
const MONEY = "#,##0.00;[Red]-#,##0.00";
const PCT = "+0.0%;[Red]-0.0%;0.0%";

/** Excel column letter for a 1-based index. */
export const col = (n: number): string => (n <= 26 ? String.fromCharCode(64 + n) : col(Math.floor((n - 1) / 26)) + col(((n - 1) % 26) + 1));

function heading(ws: ExcelJS.Worksheet, span: number, title: string, s: EvaluationSubject, note: string) {
  ws.mergeCells(1, 1, 1, span);
  Object.assign(ws.getCell("A1"), { value: title, font: { bold: true, size: 14, color: { argb: NAVY } } });
  ws.mergeCells(2, 1, 2, span);
  Object.assign(ws.getCell("A2"), { value: `${s.projectName}${s.code ? ` · ${s.code}` : ""} · ${s.exportedOn} · ${s.exportedBy} · ${s.practice}`, font: { size: 9, color: { argb: GREY } } });
  ws.mergeCells(3, 1, 3, span);
  Object.assign(ws.getCell("A3"), { value: note, font: { size: 9, color: { argb: GREY } }, alignment: { wrapText: true } });
  ws.getRow(3).height = 28;
}

function headerRow(ws: ExcelJS.Worksheet, row: number, labels: readonly string[]) {
  const r = ws.getRow(row);
  labels.forEach((label, i) => {
    const cell = r.getCell(i + 1);
    cell.value = label;
    cell.font = { bold: true, size: 9 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } };
    cell.border = { bottom: { style: "medium", color: { argb: NAVY } } };
    cell.alignment = { wrapText: true, vertical: "bottom" };
  });
}

export async function tenderEvaluationWorkbook(items: readonly EvaluationItem[], tenders: readonly EvaluationReturn[], s: EvaluationSubject): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = s.practice;
  wb.created = new Date();

  // ── Against the estimate ─────────────────────────────────────────────────────────────────
  const est = wb.addWorksheet("Against estimate", { views: [{ state: "frozen", xSplit: 2, ySplit: 5 }] });
  const fixed = 6; // Item, Description, Unit, Quantity, Estimate rate, Estimate amount
  const span = fixed + tenders.length * 3;
  heading(est, Math.min(span, 26), "Tenders against the estimate", s, `Each tenderer's rate beside ours, its amount against our quantity, and the variance. Lines more than ${Math.round(VARIANCE_FLAG * 100)}% out are shaded. Totals cover all items; compare like for like on the screen, which leaves out items either side left unpriced.`);
  const labels = ["Item", "Description", "Unit", "Qty", "Estimate rate", "Estimate amount", ...tenders.flatMap((t) => [`${t.tenderer} rate`, `${t.tenderer} amount`, `${t.tenderer} vs est.`])];
  headerRow(est, 5, labels);
  est.getRow(5).height = 30;
  est.columns = labels.map((_, i) => ({ width: i === 1 ? 46 : i < 4 ? 8 : 13 }));

  const first = 6;
  items.forEach((item, index) => {
    const r = first + index;
    const row = est.getRow(r);
    row.values = [item.ref, item.description, item.unit ?? "", item.quantity ?? null, item.estimateRate ?? null];
    row.getCell(6).value = { formula: `IF(OR(D${r}="",E${r}=""),"",D${r}*E${r})` };
    tenders.forEach((t, i) => {
      const c = fixed + 1 + i * 3;
      const rate = col(c);
      row.getCell(c).value = t.rates.get(item.id) ?? null;
      row.getCell(c + 1).value = { formula: `IF(OR(D${r}="",${rate}${r}=""),"",D${r}*${rate}${r})` };
      row.getCell(c + 2).value = { formula: `IF(OR(E${r}="",E${r}=0,${rate}${r}=""),"",(${rate}${r}-E${r})/E${r})` };
      row.getCell(c + 2).numFmt = PCT;
      for (const k of [c, c + 1]) row.getCell(k).numFmt = MONEY;
    });
    for (const k of [5, 6]) row.getCell(k).numFmt = MONEY;
    row.getCell(2).alignment = { wrapText: true };
  });
  const last = first + items.length - 1;
  const totals = est.getRow(last + 2);
  totals.getCell(2).value = "Total";
  totals.font = { bold: true };
  if (items.length > 0) {
    totals.getCell(6).value = { formula: `SUM(F${first}:F${last})` };
    totals.getCell(6).numFmt = MONEY;
    tenders.forEach((_, i) => {
      const c = fixed + 1 + i * 3;
      totals.getCell(c + 1).value = { formula: `SUM(${col(c + 1)}${first}:${col(c + 1)}${last})` };
      totals.getCell(c + 1).numFmt = MONEY;
      totals.getCell(c + 2).value = { formula: `IF(F${last + 2}=0,"",(${col(c + 1)}${last + 2}-F${last + 2})/F${last + 2})` };
      totals.getCell(c + 2).numFmt = PCT;
      // Shade the lines more than the threshold out, so the eye goes to them.
      est.addConditionalFormatting({
        ref: `${col(c + 2)}${first}:${col(c + 2)}${last}`,
        rules: [
          { type: "cellIs", operator: "greaterThan", formulae: [String(VARIANCE_FLAG)], priority: 1, style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFDE2E1" } } } },
          { type: "cellIs", operator: "lessThan", formulae: [String(-VARIANCE_FLAG)], priority: 2, style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFFF1D6" } } } },
        ],
      });
    });
  }

  // ── Collusion indicators ─────────────────────────────────────────────────────────────────
  const col2 = wb.addWorksheet("Collusion indicators");
  const { indicators, groups } = collusionIndicators(items, tenders);
  heading(col2, 7, "Collusion indicators", s, "Pairs of tenderers whose rates are a constant multiple of each other across most of the bill. An indicator, not a finding: investigate before acting (Competition Act s4(1)(b)(iii)). Sums the bill fixed are left out. The ratio behind each indicator is listed per item below it, so it can be checked.");
  col2.columns = [{ width: 18 }, { width: 18 }, { width: 18 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 50 }];
  headerRow(col2, 5, ["Kind", "Base", "Other", "Factor", "Uplift", "Matching", "Reading"]);
  if (indicators.length === 0) {
    col2.addRow([null, `No pair of ${tenders.length} tenderers prices at a constant multiple of another, over ${items.length} items.`]);
  }
  for (const i of indicators) {
    const r = col2.addRow([
      i.kind === "identical" ? "Identical rates" : "Uniform uplift",
      i.base.tenderer,
      i.other.tenderer,
      i.factor,
      i.factor - 1,
      `${i.matching} of ${i.compared}`,
      i.kind === "identical" ? `${i.other.tenderer} quotes the same rates as ${i.base.tenderer}.` : `${i.other.tenderer}'s rates are ${i.base.tenderer}'s plus ${((i.factor - 1) * 100).toFixed(1)}%.`,
    ]);
    r.getCell(4).numFmt = "0.0000";
    r.getCell(5).numFmt = PCT;
    r.font = { bold: true, color: { argb: "FF9C2D27" } };
  }
  for (const g of groups) col2.addRow([null, `Priced from one source: ${g.join(", ")}`]).font = { bold: true };

  // The working: each indicator's ratio item by item.
  for (const i of indicators) {
    col2.addRow([]);
    col2.addRow([`${i.other.tenderer} ÷ ${i.base.tenderer}`]).font = { bold: true };
    const a = tenders.find((t) => t.id === i.base.id)!;
    const b = tenders.find((t) => t.id === i.other.id)!;
    for (const item of items) {
      const ra = a.rates.get(item.id) ?? null;
      const rb = b.rates.get(item.id) ?? null;
      if (ra === null || rb === null || ra <= 0) continue;
      const r = col2.addRow([item.ref, ra, rb]);
      r.getCell(4).value = { formula: `C${r.number}/B${r.number}` };
      r.getCell(4).numFmt = "0.0000";
      for (const k of [2, 3]) r.getCell(k).numFmt = MONEY;
    }
  }

  // ── Scoring ──────────────────────────────────────────────────────────────────────────────
  const sc = wb.addWorksheet("Scoring");
  heading(sc, 2 + tenders.length, "Scoring", s, "Price points under the PPPFA: Ps = W × (1 − (Pt − Pmin) / Pmin), with W 80 up to R50 million and 90 above – set W in the shaded cell. Enter each tenderer's points for the other criteria in the shaded cells; the totals calculate. Price is each tenderer's total from the first sheet.");
  sc.columns = [{ width: 36 }, { width: 12 }, ...tenders.map(() => ({ width: 16 }))];
  headerRow(sc, 5, ["Criterion", "Max points", ...tenders.map((t) => t.tenderer)]);
  const priceRow = 6;
  const W = sc.getCell(`B${priceRow}`);
  W.value = 80;
  W.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INPUT } };
  sc.getCell(`A${priceRow}`).value = "Price (PPPFA)";
  const priceCells = tenders.map((_, i) => `'Against estimate'!${col(fixed + 2 + i * 3)}${last + 2}`);
  tenders.forEach((_, i) => {
    const cell = sc.getCell(`${col(3 + i)}${priceRow}`);
    cell.value = items.length > 0 ? { formula: `MAX(0,$B$${priceRow}*(1-(${priceCells[i]}-MIN(${priceCells.join(",")}))/MIN(${priceCells.join(",")})))` } : null;
    cell.numFmt = "0.00";
  });
  // The other criteria – the practice's own; five rows, as on the boundary wall's evaluation.
  const criteria = ["Specific goals (B-BBEE)", "Experience on similar work", "Programme", "Methodology", "Compliance and returnables"];
  criteria.forEach((name, k) => {
    const r = sc.getRow(priceRow + 1 + k);
    r.getCell(1).value = name;
    for (let c = 2; c <= 2 + tenders.length; c++) r.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: INPUT } };
  });
  const totalRow = sc.getRow(priceRow + 1 + criteria.length + 1);
  totalRow.getCell(1).value = "Total";
  totalRow.font = { bold: true };
  totalRow.getCell(2).value = { formula: `SUM(B${priceRow}:B${priceRow + criteria.length})` };
  tenders.forEach((_, i) => {
    const c = col(3 + i);
    totalRow.getCell(3 + i).value = { formula: `SUM(${c}${priceRow}:${c}${priceRow + criteria.length})` };
    totalRow.getCell(3 + i).numFmt = "0.00";
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
