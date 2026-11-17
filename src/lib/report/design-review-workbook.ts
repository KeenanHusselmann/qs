/**
 * A design review, as the workbook the practice already keeps.
 *
 * The same seven sheets as the Marshall Dam boundary wall review, in the same order and under the
 * same headings, so a reviewer who opens it finds their own working paper – and so it can be edited
 * in Excel and imported again (`design-review-import.ts` reads exactly these headings).
 *
 * Formulas where the original has formulas: the Read Me counts are COUNTIFs over the mapping, the
 * estimate's quantities link to the mapping sheet, amounts are quantity × rate, and the summary is
 * SUMIF by bill. Each formula carries the value the platform computed as its cached result, so a
 * viewer that does not recalculate still shows the figures, and Excel recalculates on open.
 *
 * Pure: a review in, bytes out.
 */

import ExcelJS from "exceljs";

import {
  estimate,
  ITEM_STATUSES,
  optionComparison,
  STATUS_MEANS,
  type Review,
} from "@/domain/design-review";
import { col } from "@/lib/report/tender-evaluation-workbook";

export interface ReviewSubject {
  practice: string;
  projectName: string;
  exportedOn: string;
  exportedBy: string;
}

const NAVY = "FF1F3A5F";
const LIGHT = "FFEEF2F7";
const INPUT = "FFFFF3D1";
const BLUE = "FF1F4E9A";
const GREY = "FF56606E";
const MONEY = "#,##0.00;[Red]-#,##0.00";
const QTY = "#,##0.00";
const PCT = "0.0%";

const cents = (m: bigint) => Number(m) / 100;
const num = (s: string | null | undefined) => (s === null || s === undefined || s === "" ? null : Number(s));

function header(ws: ExcelJS.Worksheet, row: number, labels: readonly string[]) {
  const r = ws.getRow(row);
  labels.forEach((label, i) => {
    const cell = r.getCell(i + 1);
    cell.value = label;
    cell.font = { bold: true, size: 9 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } };
    cell.border = { bottom: { style: "medium", color: { argb: NAVY } } };
    cell.alignment = { wrapText: true, vertical: "bottom" };
  });
  r.height = 30;
}

const wrap = (ws: ExcelJS.Worksheet) =>
  ws.eachRow((row) => row.eachCell((cell) => (cell.alignment = { ...cell.alignment, wrapText: true, vertical: "top" })));

const input = (cell: ExcelJS.Cell) => {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INPUT } };
};

export async function designReviewWorkbook(review: Review, s: ReviewSubject): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = s.practice;
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;

  const opts = review.options;
  const n = opts.length;
  const priced = estimate(review);
  const itemCount = review.items.length;

  // Mapping sheet layout, needed by the Read Me and the estimate's links.
  const mapCols = {
    ref: 1,
    bill: 2,
    itemFirst: 3,
    description: 3 + n,
    unit: 4 + n,
    qtyFirst: 5 + n,
    source: 5 + 2 * n,
    requirement: 6 + 2 * n,
    status: 7 + 2 * n,
    finding: 8 + 2 * n,
    action: 9 + 2 * n,
  };
  const mapLast = itemCount + 1;
  const statusRange = `'QS Item Mapping'!$${col(mapCols.status)}$2:$${col(mapCols.status)}$${Math.max(2, mapLast)}`;
  const queriesLast = review.queries.length + 1;

  // ── Read Me ──
  const me = wb.addWorksheet("Read Me");
  me.columns = [{ width: 26 }, { width: 14 }, { width: 90 }];
  me.getCell("A1").value = review.title;
  me.getCell("A1").font = { bold: true, size: 14, color: { argb: NAVY } };
  me.getCell("A2").value = review.subject ?? `${s.practice} | ${s.projectName}`;
  me.getCell("A2").font = { size: 9, color: { argb: GREY } };
  me.getCell("A3").value = `Exported ${s.exportedOn} by ${s.exportedBy} from the QS Platform`;
  me.getCell("A3").font = { size: 9, color: { argb: GREY } };
  let r = 5;
  const line = (label: string, text: string | null) => {
    if (!text) return;
    me.getCell(r, 1).value = label;
    me.getCell(r, 1).font = { bold: true };
    me.getCell(r, 3).value = text;
    r++;
  };
  line("How to use", "Start with Design Parameters for the headline position, then QS Item Mapping line by line. Queries Tracker is the list to send out: complete the yellow Response and Status cells as answers arrive.");
  line("Recommended base", review.recommendation);
  line("Limitations", review.limitations);
  r++;
  me.getCell(r, 1).value = "Status key";
  me.getCell(r, 2).value = "Items (count)";
  me.getRow(r).font = { bold: true };
  r++;
  const firstKey = r;
  for (const status of ITEM_STATUSES) {
    me.getCell(r, 1).value = status;
    me.getCell(r, 2).value = { formula: `COUNTIF(${statusRange},A${r})`, result: review.items.filter((i) => i.status === status).length };
    me.getCell(r, 3).value = STATUS_MEANS[status];
    r++;
  }
  me.getCell(r, 1).value = "Total QS items mapped";
  me.getCell(r, 2).value = { formula: `SUM(B${firstKey}:B${r - 1})`, result: review.items.filter((i) => i.status).length };
  me.getRow(r).font = { bold: true };
  r += 2;
  me.getCell(r, 1).value = "Open queries";
  me.getCell(r, 2).value = { formula: `COUNTIF('Queries Tracker'!$I$2:$I$${Math.max(2, queriesLast)},"Open")`, result: review.queries.filter((q) => q.status === "Open").length };
  r++;
  me.getCell(r, 1).value = "High priority queries";
  me.getCell(r, 2).value = { formula: `COUNTIF('Queries Tracker'!$F$2:$F$${Math.max(2, queriesLast)},"High")`, result: review.queries.filter((q) => q.priority === "High").length };
  wrap(me);

  // ── Sources ──
  const src = wb.addWorksheet("Sources", { views: [{ state: "frozen", ySplit: 1 }] });
  src.columns = [{ width: 7 }, { width: 18 }, { width: 50 }, { width: 16 }, { width: 20 }, { width: 50 }, { width: 36 }];
  header(src, 1, ["Ref", "Discipline", "Document", "Date", "Status / revision", "Relevance / notes", "Location"]);
  review.sources.forEach((x, i) => (src.getRow(i + 2).values = [x.ref, x.discipline ?? "", x.document, x.dated ?? "", x.status ?? "", x.notes ?? "", x.location ?? ""]));
  wrap(src);

  // ── Design Parameters ──
  const par = wb.addWorksheet("Design Parameters", { views: [{ state: "frozen", xSplit: 2, ySplit: 1 }] });
  const pcols = review.parameterColumns;
  par.columns = [{ width: 5 }, { width: 24 }, ...pcols.map(() => ({ width: 28 })), { width: 13 }, { width: 50 }];
  header(par, 1, ["No", "Parameter", ...pcols, "Status", "Comment / consequence"]);
  review.parameters.forEach((p, i) => (par.getRow(i + 2).values = [p.position, p.parameter, ...pcols.map((c) => p.values[c] ?? ""), p.status ?? "", p.consequence ?? ""]));
  wrap(par);

  // ── QS Item Mapping ──
  const map = wb.addWorksheet("QS Item Mapping", { views: [{ state: "frozen", xSplit: 2, ySplit: 1 }] });
  map.columns = [
    { width: 6 },
    { width: 15 },
    ...opts.map(() => ({ width: 8 })),
    { width: 44 },
    { width: 8 },
    ...opts.map(() => ({ width: 11 })),
    { width: 18 },
    { width: 36 },
    { width: 12 },
    { width: 40 },
    { width: 36 },
  ];
  header(map, 1, ["Ref", "Bill", ...opts.map((o) => `Item (${o.label})`), "QS description (abridged)", "Unit", ...opts.map((o) => `Qty ${o.label}`), "Design source", "Design requirement", "Status", "Finding", "Recommended action"]);
  review.items.forEach((it, i) => {
    const row = map.getRow(i + 2);
    row.values = [
      it.ref,
      it.bill,
      ...opts.map((o) => it.itemNumbers[o.key] ?? "n/a"),
      it.description,
      it.unit ?? "",
      ...opts.map((o) => num(it.quantities[o.key]) ?? "n/a"),
      it.designSource ?? "",
      it.requirement ?? "",
      it.status ?? "",
      it.finding ?? "",
      it.action ?? "",
    ];
    opts.forEach((_, k) => {
      const c = row.getCell(mapCols.qtyFirst + k);
      c.numFmt = QTY;
      c.font = { color: { argb: BLUE } };
    });
  });
  wrap(map);

  // ── Option Comparison ──
  const cmp = wb.addWorksheet("Option Comparison", { views: [{ state: "frozen", ySplit: 1 }] });
  const base = opts.find((o) => o.key === review.baseOption) ?? opts[0];
  const others = opts.filter((o) => o.key !== base?.key);
  cmp.columns = [{ width: 8 }, { width: 44 }, { width: 8 }, ...opts.map(() => ({ width: 12 })), ...others.flatMap(() => [{ width: 13 }, { width: 10 }])];
  header(cmp, 1, ["Ref", "Item", "Unit", ...opts.map((o) => o.label), ...others.flatMap((o) => [`${o.label} less ${base?.label ?? ""}`, `${o.label} vs ${base?.label ?? ""} %`])]);
  optionComparison(review.items, opts, review.baseOption).forEach((c, i) => {
    const rr = i + 2;
    const row = cmp.getRow(rr);
    row.values = [c.ref, c.description, c.unit ?? "", ...opts.map((o) => num(c.quantities[o.key]) ?? 0)];
    const baseCol = col(4 + opts.findIndex((o) => o.key === base?.key));
    others.forEach((o, k) => {
      const oc = col(4 + opts.findIndex((x) => x.key === o.key));
      const diff = row.getCell(4 + n + k * 2);
      const share = row.getCell(5 + n + k * 2);
      diff.value = { formula: `${oc}${rr}-${baseCol}${rr}`, result: (num(c.quantities[o.key]) ?? 0) - (num(c.quantities[base!.key]) ?? 0) };
      diff.numFmt = QTY;
      share.value = { formula: `IF(${baseCol}${rr}=0,"-",${oc}${rr}/${baseCol}${rr}-1)`, result: c.against[o.key]?.fraction ?? "-" };
      share.numFmt = PCT;
    });
    opts.forEach((_, k) => (row.getCell(4 + k).numFmt = QTY));
  });
  wrap(cmp);

  // ── Queries Tracker ──
  const qt = wb.addWorksheet("Queries Tracker", { views: [{ state: "frozen", ySplit: 1 }] });
  qt.columns = [{ width: 6 }, { width: 18 }, { width: 60 }, { width: 16 }, { width: 12 }, { width: 9 }, { width: 20 }, { width: 40 }, { width: 10 }];
  header(qt, 1, ["No", "Topic", "Query", "Raised to", "Affects", "Priority", "Source reference", "Response", "Status"]);
  review.queries.forEach((q, i) => {
    const row = qt.getRow(i + 2);
    row.values = [`Q${q.number}`, q.topic ?? "", q.query, q.raisedTo ?? "", q.affects ?? "", q.priority ?? "", q.sourceRef ?? "", q.response ?? "", q.status];
    input(row.getCell(8));
    input(row.getCell(9));
  });
  wrap(qt);

  // ── Cost Estimate ──
  const ce = wb.addWorksheet("Cost Estimate");
  const a = review.assumptions;
  const width = 6 + 3 * n;
  ce.columns = [{ width: 7 }, { width: 15 }, { width: 8 }, { width: 44 }, { width: 8 }, ...Array.from({ length: 3 * n }, () => ({ width: 13 })), { width: 40 }];
  ce.mergeCells(1, 1, 1, width);
  ce.getCell("A1").value = "Cost Estimate - QS BOQ items priced at estimated rates";
  ce.getCell("A1").font = { bold: true, size: 13, color: { argb: NAVY } };
  ce.mergeCells(2, 1, 2, width);
  ce.getCell("A2").value = "Pre-tender estimate for budgeting and tender evaluation only, not a substitute for priced tenders. Amounts excl. VAT. Blue = rate inputs; yellow = key assumptions; black = formulas.";
  ce.getCell("A2").font = { size: 9, color: { argb: GREY } };
  ce.getCell("A2").alignment = { wrapText: true };
  ce.getRow(2).height = 28;

  ce.getCell("A4").value = "KEY ASSUMPTIONS";
  ce.getCell("A4").font = { bold: true };
  const assumption = (row: number, label: string, value: number | null, fmt?: string) => {
    ce.getCell(row, 1).value = label;
    const c = ce.getCell(row, 5);
    c.value = value;
    if (fmt) c.numFmt = fmt;
    input(c);
    return `$E$${row}`;
  };
  const mainCell = assumption(5, `Main quantity (${a.mainUnit ?? "unit"})`, num(a.mainQuantity), QTY);
  const contCell = assumption(6, "Contingency", num(a.contingency), PCT);
  const vatCell = assumption(7, "VAT", num(a.vat), PCT);
  const paCell = assumption(8, "Profit and attendance on provisional sums", num(a.profitAndAttendance), PCT);
  const lowCell = assumption(9, "Estimate range, low", num(a.rangeLow), PCT);
  const highCell = assumption(10, "Estimate range, high", num(a.rangeHigh), PCT);
  assumption(11, "Contract period assumed (weeks)", a.contractWeeks);
  const cmpCell = assumption(12, `${a.comparisonLabel ?? "Comparison figure"} (for comparison)`, num(a.comparisonAmount), MONEY);

  // The detail first in memory, because the summary refers to its range.
  const bills = [...new Set(review.items.map((i) => i.bill))];
  const summaryTop = 14;
  // Bills, measured, billed, adjustments, adjusted, contingency, excl, VAT, incl, per unit, prelims %, low, high, vs comparison.
  const summaryRows = bills.length + 13;
  const detailHead = summaryTop + summaryRows + 3;
  const qtyCol = (k: number) => 6 + k;
  const rateCol = (k: number) => 6 + n + k;
  const amtCol = (k: number) => 6 + 2 * n + k;
  const basisCol = 6 + 3 * n;

  ce.getCell(detailHead - 1, 1).value = "DETAIL";
  ce.getCell(detailHead - 1, 1).font = { bold: true };
  header(ce, detailHead, ["Ref", "Bill", "QS item", "Description", "Unit", ...opts.map((o) => `Qty ${o.label}`), ...opts.map((o) => `Rate ${o.label}`), ...opts.map((o) => `Amount ${o.label}`), "Rate basis / notes"]);

  let d = detailHead + 1;
  const amountFormula = (row: number, k: number) => `IF(ISNUMBER(${col(qtyCol(k))}${row}),${col(qtyCol(k))}${row}*${col(rateCol(k))}${row},0)`;
  const PROVISIONAL = /^provisional/i;
  review.items.forEach((it, idx) => {
    const row = ce.getRow(d);
    row.getCell(1).value = it.ref;
    row.getCell(2).value = it.bill;
    row.getCell(3).value = it.itemNumbers[opts[0]?.key] ?? "";
    row.getCell(4).value = it.description;
    row.getCell(5).value = it.unit ?? "";
    opts.forEach((o, k) => {
      const q = num(it.quantities[o.key]);
      const link = `'QS Item Mapping'!${col(mapCols.qtyFirst + k)}${idx + 2}`;
      row.getCell(qtyCol(k)).value = { formula: link, result: q ?? "n/a" };
      row.getCell(qtyCol(k)).numFmt = QTY;
      const rate = row.getCell(rateCol(k));
      rate.value = num(it.rates[o.key]);
      rate.numFmt = MONEY;
      rate.font = { color: { argb: BLUE } };
      row.getCell(amtCol(k)).value = { formula: amountFormula(d, k), result: q !== null && it.rates[o.key] ? q * Number(it.rates[o.key]) : 0 };
      row.getCell(amtCol(k)).numFmt = MONEY;
    });
    row.getCell(basisCol).value = it.rateBasis ?? "";
    d++;
    // Profit and attendance on a provisional sum, as the bills carry it: its own line, a formula.
    if (PROVISIONAL.test(it.bill)) {
      const pa = ce.getRow(d);
      pa.getCell(1).value = it.ref;
      pa.getCell(2).value = it.bill;
      pa.getCell(4).value = "Profit and attendance on the above";
      pa.getCell(5).value = "Item";
      opts.forEach((o, k) => {
        pa.getCell(qtyCol(k)).value = num(it.quantities[o.key]) === null ? "n/a" : 1;
        pa.getCell(rateCol(k)).value = { formula: `${col(rateCol(k))}${d - 1}*${paCell}` };
        pa.getCell(rateCol(k)).numFmt = MONEY;
        pa.getCell(amtCol(k)).value = { formula: amountFormula(d, k) };
        pa.getCell(amtCol(k)).numFmt = MONEY;
      });
      pa.getCell(basisCol).value = "Percentage in key assumptions";
      d++;
    }
  });
  const detailLast = d - 1;

  d++;
  ce.getCell(d, 1).value = "RECOMMENDED ADJUSTMENTS (items the design needs that the bills do not carry; see Queries Tracker)";
  ce.getCell(d, 1).font = { bold: true };
  d++;
  const adjFirst = d;
  for (const adj of review.adjustments) {
    const row = ce.getRow(d);
    row.getCell(1).value = adj.ref;
    row.getCell(2).value = "Adjustments";
    row.getCell(3).value = adj.queryNumber ? `Q${adj.queryNumber}` : "";
    row.getCell(4).value = adj.description;
    row.getCell(5).value = adj.unit ?? "";
    opts.forEach((o, k) => {
      row.getCell(qtyCol(k)).value = num(adj.quantities[o.key]);
      row.getCell(qtyCol(k)).numFmt = QTY;
      row.getCell(rateCol(k)).value = num(adj.rates[o.key]);
      row.getCell(rateCol(k)).numFmt = MONEY;
      row.getCell(amtCol(k)).value = { formula: amountFormula(d, k) };
      row.getCell(amtCol(k)).numFmt = MONEY;
    });
    row.getCell(basisCol).value = adj.basis ?? "";
    d++;
  }
  const adjLast = Math.max(adjFirst, d - 1);

  // ── Summary ──
  ce.getCell(summaryTop, 1).value = "SUMMARY (R, excl. VAT)";
  ce.getCell(summaryTop, 1).font = { bold: true };
  opts.forEach((o, k) => {
    const c = ce.getCell(summaryTop, 6 + k);
    c.value = o.label;
    c.font = { bold: true };
  });
  let sr = summaryTop + 1;
  const sumRow = (label: string, formula: (k: number, c: string) => string, result: (k: number) => number | string | null, fmt = MONEY, bold = false) => {
    ce.getCell(sr, 1).value = label;
    if (bold) ce.getCell(sr, 1).font = { bold: true };
    opts.forEach((_, k) => {
      const c = ce.getCell(sr, 6 + k);
      c.value = { formula: formula(k, col(6 + k)), result: result(k) ?? "" };
      c.numFmt = fmt;
      if (bold) c.font = { bold: true };
    });
    return sr++;
  };
  const billRows = bills.map((bill) =>
    sumRow(
      bill,
      (k) => `SUMIF($B$${detailHead + 1}:$B$${detailLast},"${bill.replace(/"/g, '""')}",${col(amtCol(k))}$${detailHead + 1}:${col(amtCol(k))}$${detailLast})`,
      (k) => cents(priced[k].bills.find((b) => b.bill === bill)?.amount ?? 0n),
    ),
  );
  const isPrelim = (b: string) => /^prelim/i.test(b);
  const measuredRows = billRows.filter((_, i) => !isPrelim(bills[i]) && !PROVISIONAL.test(bills[i]));
  const measured = sumRow("Measured work", (_, c) => (measuredRows.length ? measuredRows.map((x) => `${c}${x}`).join("+") : "0"), (k) => cents(priced[k].measured));
  const billed = sumRow("Total as billed", (_, c) => `SUM(${c}${billRows[0] ?? sr}:${c}${billRows[billRows.length - 1] ?? sr})`, (k) => cents(priced[k].billed), MONEY, true);
  const adjRow = sumRow("Recommended adjustments", (k) => `SUM(${col(amtCol(k))}${adjFirst}:${col(amtCol(k))}${adjLast})`, (k) => cents(priced[k].adjustments));
  const adjusted = sumRow("Adjusted total before contingency", (_, c) => `${c}${billed}+${c}${adjRow}`, (k) => cents(priced[k].adjusted));
  const cont = sumRow("Contingency", (_, c) => `${c}${adjusted}*${contCell}`, (k) => cents(priced[k].contingency));
  const excl = sumRow("Total excl. VAT", (_, c) => `${c}${adjusted}+${c}${cont}`, (k) => cents(priced[k].totalExVat), MONEY, true);
  const vat = sumRow("VAT", (_, c) => `${c}${excl}*${vatCell}`, (k) => cents(priced[k].vat));
  sumRow("Total incl. VAT", (_, c) => `${c}${excl}+${c}${vat}`, (k) => cents(priced[k].totalIncVat), MONEY, true);
  sumRow(`Cost per ${a.mainUnit ?? "unit"}, excl. VAT`, (_, c) => `IF(${mainCell}>0,${c}${excl}/${mainCell},"-")`, (k) => (priced[k].perMainUnit === null ? "-" : cents(priced[k].perMainUnit!)));
  const prelimRows = billRows.filter((_, i) => isPrelim(bills[i]));
  sumRow(
    "Preliminaries as % of measured work",
    (_, c) => `IF(${c}${measured}=0,0,(${prelimRows.length ? prelimRows.map((x) => `${c}${x}`).join("+") : "0"})/${c}${measured})`,
    (k) => priced[k].preliminariesShare,
    PCT,
  );
  sumRow("Range excl. VAT, low", (_, c) => `${c}${excl}*(1+${lowCell})`, (k) => cents(priced[k].rangeLow));
  sumRow("Range excl. VAT, high", (_, c) => `${c}${excl}*(1+${highCell})`, (k) => cents(priced[k].rangeHigh));
  sumRow(`Difference vs ${a.comparisonLabel ?? "comparison figure"}`, (_, c) => `IF(ISNUMBER(${cmpCell}),${c}${excl}-${cmpCell},"-")`, (k) => (priced[k].againstComparison === null ? "-" : cents(priced[k].againstComparison!)));

  ce.views = [{ state: "frozen", ySplit: 0 }];
  ce.getColumn(4).alignment = { wrapText: true, vertical: "top" };
  ce.getColumn(basisCol).alignment = { wrapText: true, vertical: "top" };

  return Buffer.from(await wb.xlsx.writeBuffer());
}
