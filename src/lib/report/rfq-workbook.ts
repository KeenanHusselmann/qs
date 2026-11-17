/**
 * The comparative evaluation as a workbook – D1.3 Quotations.
 *
 * ── Why a workbook and not another PDF ─────────────────────────────────────────────────────
 *
 * The evaluation report says what the platform found. This is the sheet a quantity surveyor works
 * in afterwards: every price line beside its recomputation, every total live, and the figures a
 * comparison turns on – the cost of works, the budget – left as input cells, so the QS can put the
 * practice's own estimate in and watch each firm's fee move. Nothing here is a picture of a number:
 * the arithmetic the platform did is written as Excel formulas over the transcribed figures, so a
 * reader can see it work and a reviewer can disagree with it in the cell.
 *
 * ── It follows the evaluation, not a fixed shape ───────────────────────────────────────────
 *
 * The sheets are the ones the responses support. A fee proposal priced on a cost of works brings
 * the cost-of-works and sensitivity sheets; one built from hours brings resources and rates; a
 * response with no stage apportionment brings no stage sheet. An RFQ for materials would bring
 * neither, and the workbook would be the four sheets that always apply – the comparison, the
 * recalculation, the register of gaps, and the clarifications.
 */

import ExcelJS from "exceljs";

import type { CheckedLine, CheckedResponse, QuoteExtraction } from "@/domain/quote-check";
import type { RfqView } from "@/lib/rfq";

export interface WorkbookSubject {
  practice: string;
  projectName: string;
  code: string | null;
  client: string | null;
  issuedBy: string;
  issuedOn: string;
  /** What the client has to spend, where the practice knows it. An input cell where not. */
  budget?: number | null;
}

/** One response, with the reading behind it – the quantities, rates and formulas as printed. */
export interface WorkbookResponse {
  name: string;
  documentName: string;
  evaluatedAt: string | null;
  result: CheckedResponse;
  extraction: QuoteExtraction | null;
}

const NAVY = "FF1F3A5F";
const LIGHT = "FFEEF2F7";
const INPUT = "FFFFF3D1";
const BAD = "FFF6E3E3";
const OK = "FFE8F3DC";
const MONEY = '#,##0.00;[Red]-#,##0.00';
const PERCENT = "0.00%";
const rands = (cents: number | null) => (cents === null ? null : cents / 100);

/** A1-style reference to a cell on another sheet. */
const ref = (sheet: string, cell: string) => `'${sheet.replace(/'/g, "''")}'!${cell}`;

export function rfqWorkbook(rfq: RfqView, responses: readonly WorkbookResponse[], s: WorkbookSubject): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = s.practice;
  wb.created = new Date();
  wb.title = `${s.projectName} – Comparative evaluation of quotations`;

  const rows = responses.map((r) => r.result);
  const has = {
    costOfWorks: rows.some((r) => r.basis?.value != null || r.scopePrices.some((p) => p.basis != null)),
    stages: rows.some((r) => stageLines(r).length >= 3),
    counts: rows.some((r) => r.tallies.length > 0),
    rates: responses.some((r) => (r.extraction?.lines ?? []).some((l) => l.rate)),
  };

  // The sheets are built in reading order, but the summary refers to figures the later sheets
  // settle, so it is laid out first and filled from what those sheets return.
  const summary = wb.addWorksheet("Summary", { views: [{ state: "frozen", ySplit: 5, xSplit: 1 }] });
  const recalc = sheetRecalculation(wb, responses);
  const likeForLike = sheetLikeForLike(wb, rfq, responses, recalc, s);
  const costOfWorks = has.costOfWorks ? sheetCostOfWorks(wb, responses) : null;
  const stages = has.stages ? sheetStages(wb, responses, recalc) : null;
  const resources = has.counts || has.rates ? sheetResources(wb, responses) : null;
  const compliance = sheetCompliance(wb, rfq, responses);
  const gaps = sheetGaps(wb, responses);
  sheetClarifications(wb, rfq, responses);
  sheetNotes(wb, rfq, responses, s);

  fillSummary(summary, rfq, responses, s, { likeForLike, compliance, gaps }, {
    "Fee Recalculation": "Every price line of each response recomputed from its own inputs, with the variance and the check.",
    "Like for Like": "The offers as submitted, the scope every response prices, and each firm's own fee formula on a common cost of works.",
    ...(costOfWorks ? { "Cost of Works": "The construction estimates each fee rests on, side by side." } : {}),
    ...(stages ? { "Stage Apportionment": "What each response puts in each stage, in rand and as a share of its own price." } : {}),
    ...(resources ? { "Resources and Rates": "Hours and rates as each response discloses them, with every total checked." } : {}),
    "Scope and Compliance": "The RFQ's scope items and requirements against each response, with the words that show it.",
    "Gaps and Anomalies": "A numbered register: what was found, what it is worth, how serious, and what to do.",
    Clarifications: "The questions to put to each firm before appointment, with room for the answers.",
    "Basis and Notes": "What each evaluation rests on, what was read from images, the ranking rule, and the limitations.",
  });

  return wb.xlsx.writeBuffer().then((b) => Buffer.from(b));
}

// ── Shared furniture ────────────────────────────────────────────────────────────────────────

function title(ws: ExcelJS.Worksheet, heading: string, strap: string, width: number) {
  ws.mergeCells(1, 1, 1, width);
  const a = ws.getCell("A1");
  a.value = heading;
  a.font = { bold: true, size: 14, color: { argb: NAVY } };
  ws.mergeCells(2, 1, 2, width);
  const b = ws.getCell("A2");
  b.value = strap;
  b.font = { size: 9, color: { argb: "FF56606E" } };
  b.alignment = { wrapText: true };
  ws.getRow(2).height = 26;
}

function headerRow(ws: ExcelJS.Worksheet, values: (string | number | null)[], at?: number) {
  const row = at ? ws.getRow(at) : ws.addRow([]);
  values.forEach((v, i) => {
    const cell = row.getCell(i + 1);
    cell.value = v;
    cell.font = { bold: true, size: 9 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } };
    cell.border = { bottom: { style: "medium", color: { argb: NAVY } } };
    cell.alignment = { wrapText: true, vertical: "bottom" };
  });
  row.commit?.();
  return row;
}

function sectionRow(ws: ExcelJS.Worksheet, text: string) {
  const row = ws.addRow([text]);
  row.getCell(1).font = { bold: true, size: 10, color: { argb: NAVY } };
  return row;
}

function money(cell: ExcelJS.Cell, value: number | null | { formula: string }) {
  if (value !== null) cell.value = typeof value === "object" ? value : value;
  cell.numFmt = MONEY;
}

function note(cell: ExcelJS.Cell, text: string | null) {
  cell.value = text;
  cell.font = { size: 8, color: { argb: "FF56606E" } };
  cell.alignment = { wrapText: true, vertical: "top" };
}

/** Lines that read as a stage apportionment – "Stage 3", "Inception", "Close-out". */
function stageLines(r: CheckedResponse): CheckedLine[] {
  return r.lines.filter((l) => /\bstage\s*\d|inception|concept|design development|documentation|close[- ]?out|contract administration/i.test(l.label));
}

// ── Fee recalculation: every line, recomputed where the response shows its working ──────────

interface RecalcRefs {
  sheet: string;
  /** Per response index: the row of each line id, the corrected-total row, and the fee block. */
  lineRow: Map<string, number>[];
  totalRow: number[];
  feeOnBasis: (string | null)[];
}

function sheetRecalculation(wb: ExcelJS.Workbook, responses: readonly WorkbookResponse[]): RecalcRefs {
  const ws = wb.addWorksheet("Fee Recalculation", { views: [{ state: "frozen", ySplit: 3 }] });
  ws.columns = [
    { width: 52 }, { width: 14 }, { width: 9 }, { width: 13 }, { width: 17 }, { width: 17 }, { width: 13 }, { width: 13 }, { width: 15 }, { width: 46 },
  ];
  title(
    ws,
    "Price lines recomputed",
    "Column E is the figure the response prints, transcribed. Column F recomputes it from the response's own quantities, rates and workings – as a live formula wherever the response shows one. Column I is the platform's verdict, which also carries forward every correction above the line.",
    10,
  );
  ws.addRow([]);

  const refs: RecalcRefs = { sheet: ws.name, lineRow: [], totalRow: [], feeOnBasis: [] };

  responses.forEach((response, index) => {
    const r = response.result;
    const extraction = response.extraction;
    const byId = new Map((extraction?.lines ?? []).map((l) => [l.id, l]));
    const map = new Map<string, number>();
    refs.lineRow.push(map);

    ws.addRow([]);
    sectionRow(ws, `${String.fromCharCode(65 + index)}. ${r.supplier}${r.reference ? ` – ${r.reference}` : ""}${r.date ? `, ${r.date}` : ""}`);
    headerRow(ws, ["Line", "Quantity / basis", "Unit", "Rate / factor", "As stated (R)", "Recomputed (R)", "Variance (R)", "Check", "Platform verdict", "Note"]);

    for (const line of r.lines) {
      const source = byId.get(line.id);
      const row = ws.addRow([]);
      map.set(line.id, row.number);
      row.getCell(1).value = line.label;
      row.getCell(1).alignment = { wrapText: true };

      // Quantity, unit and rate as printed – the inputs a reader would check the line against.
      const quantity = source?.quantity ?? null;
      const rate = source?.rate ?? null;
      // The number the figure starts with, and nothing after it: "76 375 m²" is 76 375, not 763 752,
      // and "R 1 315.00/m²" is 1 315,00. Thousands may be spaced or comma'd, decimals dotted or comma'd.
      const number = (text: string | null) => {
        const digits = /-?\d[\d\s ,.]*/.exec((text ?? "").replace(/^[^\d-]*/, ""))?.[0] ?? "";
        if (!digits) return null;
        let t = digits.replace(/[\s ]/g, "");
        if (/,\d{1,2}$/.test(t) && !/\.\d/.test(t)) t = t.replace(/,/g, ".");
        t = t.replace(/,/g, "");
        const n = Number(t);
        return Number.isFinite(n) ? n : null;
      };
      const q = number(quantity);
      const rt = number(rate);
      if (q !== null) row.getCell(2).value = q;
      else if (quantity) row.getCell(2).value = quantity;
      row.getCell(3).value = quantity ? (/[a-z²³%]+\.?$/i.exec(quantity.trim())?.[0] ?? null) : null;
      if (rt !== null) {
        row.getCell(4).value = rt;
        row.getCell(4).numFmt = MONEY;
      } else if (rate) row.getCell(4).value = rate;

      money(row.getCell(5), rands(line.stated));
      // The working, as a formula over this block's own rows where every line it reads is here.
      const formula = excelWorking(line, source?.expression ?? null, map, q !== null && rt !== null ? row.number : null);
      if (formula) row.getCell(6).value = { formula, date1904: false };
      else money(row.getCell(6), rands(line.computed ?? line.stated));
      row.getCell(6).numFmt = MONEY;
      row.getCell(7).value = { formula: `IF(OR(E${row.number}="",F${row.number}=""),"",F${row.number}-E${row.number})`, date1904: false };
      row.getCell(7).numFmt = MONEY;
      row.getCell(8).value = {
        formula: `IF(OR(E${row.number}="",F${row.number}=""),"",IF(ABS(F${row.number}-E${row.number})<0.01,"agrees",IF(ABS(F${row.number}-E${row.number})<=1,"rounding","error")))`,
        date1904: false,
      };
      row.getCell(9).value = line.verdict;
      if (line.verdict === "error") row.getCell(9).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAD } };
      if (line.verdict === "agrees") row.getCell(9).fill = { type: "pattern", pattern: "solid", fgColor: { argb: OK } };
      note(row.getCell(10), line.note);
    }

    // What the response comes to, as it stands and with every correction carried forward.
    const totals = ws.addRow([]);
    totals.getCell(1).value = "Price excluding VAT";
    totals.getCell(1).font = { bold: true };
    money(totals.getCell(5), rands(r.statedTotal));
    money(totals.getCell(6), rands(r.correctedTotal));
    totals.getCell(6).font = { bold: true };
    totals.getCell(7).value = { formula: `F${totals.number}-E${totals.number}`, date1904: false };
    totals.getCell(7).numFmt = MONEY;
    note(totals.getCell(10), r.errors.length ? `${r.errors.length} error${r.errors.length === 1 ? "" : "s"} corrected` : "Its arithmetic checks");
    refs.totalRow.push(totals.number);

    // The fee formula, where the response works its fee from a cost of works: live, so the QS can
    // put another estimate in the basis cell and read the fee off.
    const fee = extraction?.fee?.formula ?? null;
    const basisRow = fee && extraction?.fee?.basisLine ? map.get(extraction.fee.basisLine!) : undefined;
    if (fee && basisRow) {
      ws.addRow([]);
      sectionRow(ws, "The fee on another cost of works (its own formula, live)");
      const basis = ws.addRow([]);
      basis.getCell(1).value = "Cost of works to price on (input)";
      money(basis.getCell(5), rands(r.basisMismatch?.used ?? r.basis?.value ?? null));
      basis.getCell(5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: INPUT } };
      note(basis.getCell(10), "Yellow: replace with the quantity surveyor's estimate to reprice the fee.");
      const feeRow = ws.addRow([]);
      feeRow.getCell(1).value = `Fee on that cost of works – ${fee.replace(/BASIS/g, "the cost of works")}`;
      feeRow.getCell(1).alignment = { wrapText: true };
      const discount = fractionOf(extraction?.discount ?? null);
      feeRow.getCell(6).value = { formula: excelFormula(fee, `E${basis.number}`), date1904: false };
      feeRow.getCell(6).numFmt = MONEY;
      refs.feeOnBasis.push(ref(ws.name, `F${feeRow.number}`));
      if (discount !== null) {
        const net = ws.addRow([]);
        net.getCell(1).value = `Less the discount the response offers (${extraction!.discount})`;
        net.getCell(6).value = { formula: `F${feeRow.number}*${1 - discount}`, date1904: false };
        net.getCell(6).numFmt = MONEY;
        refs.feeOnBasis[refs.feeOnBasis.length - 1] = ref(ws.name, `F${net.number}`);
      }
    } else refs.feeOnBasis.push(null);
    ws.addRow([]);
  });

  return refs;
}

/** "L1+L2", "L6*0.10" over this block's rows; or quantity × rate; else null. */
function excelWorking(line: CheckedLine, expression: string | null, map: Map<string, number>, extensionRow: number | null): string | null {
  if (expression) {
    const ids = [...expression.matchAll(/[A-Za-z][A-Za-z0-9_]*/g)].map((m) => m[0]);
    if (ids.length && ids.every((id) => map.has(id))) {
      return ids.reduce((out, id) => out.replace(new RegExp(`\\b${id}\\b`, "g"), `F${map.get(id)}`), expression);
    }
    if (ids.length === 0) return expression;
    return null;
  }
  return extensionRow ? `B${extensionRow}*D${extensionRow}` : null;
}

/** A fee formula over BASIS as an Excel formula over a cell. */
function excelFormula(formula: string, cell: string): string {
  return formula.replace(/BASIS/g, cell);
}

/** "15%" → 0.15. */
function fractionOf(text: string | null): number | null {
  if (!text) return null;
  const n = Number(text.replace(/[%\s]/g, "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return null;
  return n > 1 ? n / 100 : n;
}

// ── Like for like ───────────────────────────────────────────────────────────────────────────

interface LikeRefs {
  sheet: string;
  correctedTotal: string[];
  inclVat: string[];
  budgetVariance: string[];
  rate: (string | null)[];
}

function sheetLikeForLike(wb: ExcelJS.Workbook, rfq: RfqView, responses: readonly WorkbookResponse[], recalc: RecalcRefs, s: WorkbookSubject): LikeRefs {
  const ws = wb.addWorksheet("Like for Like", { views: [{ state: "frozen", ySplit: 5, xSplit: 1 }] });
  ws.columns = [{ width: 46 }, ...responses.map(() => ({ width: 22 })), { width: 46 }];
  title(ws, "Like for like", "Section A is what each response offers, with its arithmetic corrected. Section B is the scope every response prices. Section C puts each firm's own fee formula on one cost of works, so the comparison does not turn on whose estimate is highest.", responses.length + 2);
  ws.addRow([]);

  const refs: LikeRefs = { sheet: ws.name, correctedTotal: [], inclVat: [], budgetVariance: [], rate: [] };
  const last = responses.length + 2;
  const col = (i: number) => String.fromCharCode(66 + i);

  sectionRow(ws, "A. The offers as submitted");
  headerRow(ws, ["Item", ...responses.map((r) => r.name), "Comment"]);

  const line = (label: string, values: (string | number | null | { formula: string })[], comment?: string, fmt?: string, bold = false) => {
    const row = ws.addRow([]);
    row.getCell(1).value = label;
    values.forEach((v, i) => {
      const cell = row.getCell(2 + i);
      if (v !== null) cell.value = typeof v === "object" ? { ...v, date1904: false } : v;
      if (fmt) cell.numFmt = fmt;
      if (bold) cell.font = { bold: true };
    });
    if (comment) note(row.getCell(last), comment);
    return row;
  };

  line("Reference and date", responses.map((r) => [r.result.reference, r.result.date].filter(Boolean).join(", ") || "not stated"));
  line("Signed by", responses.map((r) => r.result.signatory ?? "not stated"));
  line("Scope priced", responses.map((r) => r.result.scope.filter((x) => x.status === "included").map((x) => x.item).join("; ") || "none of the RFQ's items"));
  line(`RFQ scope items covered (of ${rfq.scope.length})`, responses.map((r) => r.result.scope.filter((x) => x.status === "included").length));
  line("Priced beyond the RFQ", responses.map((r) => r.result.extraScope.join("; ") || "–"));
  const stated = line("Price excl. VAT, as stated", responses.map((_, i) => ({ formula: ref(recalc.sheet, `E${recalc.totalRow[i]}`) })), undefined, MONEY);
  const corrected = line("Price excl. VAT, arithmetic corrected", responses.map((_, i) => ({ formula: ref(recalc.sheet, `F${recalc.totalRow[i]}`) })), "The platform's corrected figure, carried from the recalculation", MONEY, true);
  const vat = line("VAT at 15%", responses.map((_, i) => ({ formula: `${col(i)}${corrected.number}*0.15` })), undefined, MONEY);
  const incl = line("Price incl. VAT", responses.map((_, i) => ({ formula: `${col(i)}${corrected.number}+${col(i)}${vat.number}` })), undefined, MONEY);
  const budget = line("Client budget excl. VAT (input)", responses.map(() => (s.budget != null ? s.budget / 100 : null)), "Yellow: enter what the client has to spend, and the row below reads over or under it.", MONEY);
  responses.forEach((_, i) => (budget.getCell(2 + i).fill = { type: "pattern", pattern: "solid", fgColor: { argb: INPUT } }));
  const variance = line("Over / (under) the budget", responses.map((_, i) => ({ formula: `IF(${col(i)}${budget.number}="","",${col(i)}${corrected.number}-${col(i)}${budget.number})` })), undefined, MONEY);
  line("Errors found in its arithmetic", responses.map((r) => r.result.errors.length));
  void stated;

  refs.correctedTotal = responses.map((_, i) => ref(ws.name, `${col(i)}${corrected.number}`));
  refs.inclVat = responses.map((_, i) => ref(ws.name, `${col(i)}${incl.number}`));
  refs.budgetVariance = responses.map((_, i) => ref(ws.name, `${col(i)}${variance.number}`));

  // ── B. The scope they all price ──────────────────────────────────────────────────────────
  const shared = (rfq.recommendation?.likeForLike ?? []).filter((l) => l.prices.some((p) => p.net !== null));
  for (const item of shared) {
    ws.addRow([]);
    sectionRow(ws, `B. ${item.item} – the scope every response prices`);
    headerRow(ws, ["Item", ...responses.map((r) => r.name), "Comment"]);
    const price = line("Price for this item, net of any discount", responses.map((r) => {
      const p = item.prices.find((x) => x.supplier === r.result.supplier);
      return p?.net != null ? p.net / 100 : null;
    }), item.prices.some((p) => p.derived) ? "Derived from the response's own breakdown where it prices no separate figure – indicative, not a price offered" : undefined, MONEY);
    const basis = line("The cost of works it is calculated on", responses.map((r) => {
      const p = item.prices.find((x) => x.supplier === r.result.supplier);
      return p?.basis != null ? p.basis / 100 : null;
    }), undefined, MONEY);
    const rate = line("As a percentage of that cost of works", responses.map((_, i) => ({ formula: `IF(OR(${col(i)}${basis.number}="",${col(i)}${basis.number}=0),"",${col(i)}${price.number}/${col(i)}${basis.number})` })), undefined, PERCENT);
    line("Rank on this item (1 = lowest)", responses.map((_, i) => ({ formula: `IF(${col(i)}${price.number}="","",RANK(${col(i)}${price.number},$B$${price.number}:$${col(responses.length - 1)}$${price.number},1))` })), "On price alone – read it with the cost-of-works row above, which the fee is a percentage of");
    if (refs.rate.length === 0) refs.rate = responses.map((_, i) => ref(ws.name, `${col(i)}${rate.number}`));
  }

  // ── C. One cost of works, each firm's own formula ────────────────────────────────────────
  const withFormula = responses.map((r, i) => ({ r, i })).filter(({ r }) => r.extraction?.fee?.formula);
  if (withFormula.length >= 1) {
    ws.addRow([]);
    sectionRow(ws, "C. One cost of works, each firm's own formula");
    note(ws.addRow([]).getCell(1), "Each firm's fee formula, as printed in its own response, applied to the same cost of works – its own, the others', the average, and the practice's estimate. This is the comparison a fee tariff allows: the formulas differ, the basis does not.");
    const head = headerRow(ws, ["Basis", "Cost of works (R)", ...withFormula.map(({ r }) => r.name), ...(withFormula.length > 1 ? ["Lowest"] : [])]);
    const bases: { label: string; value: number | null; input?: boolean }[] = [
      ...responses.map((r) => ({ label: `${r.name}'s own cost of works`, value: rands(r.result.basisMismatch?.used ?? r.result.basis?.value ?? null), input: false })),
      { label: "The practice's estimate (input)", value: null, input: true },
    ].filter((b) => b.value !== null || b.input === true);
    const firstFirm = cellName(3);
    const lastFirm = cellName(2 + withFormula.length);
    for (const b of bases) {
      const row = ws.addRow([]);
      row.getCell(1).value = b.label;
      money(row.getCell(2), b.value);
      if (b.input) row.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: INPUT } };
      withFormula.forEach(({ r }, k) => {
        const formula = r.extraction!.fee!.formula;
        const discount = fractionOf(r.extraction?.discount ?? null) ?? 0;
        const cell = row.getCell(3 + k);
        cell.value = { formula: `IF($B${row.number}="","",(${excelFormula(formula, `$B${row.number}`)})*${1 - discount})`, date1904: false };
        cell.numFmt = MONEY;
      });
      if (withFormula.length > 1) {
        const lowest = row.getCell(3 + withFormula.length);
        lowest.value = {
          formula: `IF($B${row.number}="","",INDEX($${firstFirm}$${head.number}:$${lastFirm}$${head.number},MATCH(MIN(${firstFirm}${row.number}:${lastFirm}${row.number}),${firstFirm}${row.number}:${lastFirm}${row.number},0)))`,
          date1904: false,
        };
      }
    }
    note(ws.addRow([]).getCell(1), "Each fee is shown net of the discount that response offers. A fee tariff is a percentage of the cost of works, so on one basis the ranking is the firms' formulas and discounts, nothing else.");
  }

  return refs;
}

// ── Cost of works ───────────────────────────────────────────────────────────────────────────

function sheetCostOfWorks(wb: ExcelJS.Workbook, responses: readonly WorkbookResponse[]) {
  const ws = wb.addWorksheet("Cost of Works", { views: [{ state: "frozen", ySplit: 5, xSplit: 1 }] });
  ws.columns = [{ width: 46 }, ...responses.map(() => ({ width: 22 })), { width: 46 }];
  title(ws, "The cost of works each fee rests on", "A fee worked as a percentage of a construction estimate moves with that estimate, so a comparison in rand mostly compares the estimating. These are the estimates as each response states them, and the figure each fee is actually calculated on.", responses.length + 2);
  ws.addRow([]);
  headerRow(ws, ["Item", ...responses.map((r) => r.name), "Comment"]);
  const last = responses.length + 2;

  const line = (label: string, values: (string | number | null | { formula: string })[], comment?: string, fmt?: string) => {
    const row = ws.addRow([]);
    row.getCell(1).value = label;
    values.forEach((v, i) => {
      const cell = row.getCell(2 + i);
      if (v !== null) cell.value = typeof v === "object" ? { ...v, date1904: false } : v;
      if (fmt) cell.numFmt = fmt;
    });
    if (comment) note(row.getCell(last), comment);
    return row;
  };

  const stated = line("Estimate as the response states it", responses.map((r) => rands(r.result.basis?.value ?? null)), undefined, MONEY);
  line("The figure the fee is actually worked on", responses.map((r) => rands(r.result.basisMismatch?.used ?? r.result.basis?.value ?? null)), "Where these differ, the response prices on a figure other than its own estimate", MONEY);
  line("With the platform's corrections", responses.map((r) => rands(r.result.feeImpact?.basisCorrected ?? r.result.basis?.value ?? null)), "The estimate once every arithmetic error in it is put right", MONEY);
  line("Index: each estimate against the lowest", responses.map((_, i) => ({ formula: `IF(MIN($B$${stated.number}:$${String.fromCharCode(65 + responses.length)}$${stated.number})=0,"",${String.fromCharCode(66 + i)}${stated.number}/MIN($B$${stated.number}:$${String.fromCharCode(65 + responses.length)}$${stated.number}))` })), undefined, "0.00");

  // The facts every response was asked for – the site, the estimate, the guideline – side by side.
  const facts = [...new Set(responses.flatMap((r) => r.result.facts.map((f) => f.fact)))];
  if (facts.length) {
    ws.addRow([]);
    sectionRow(ws, "What each response says it priced");
    headerRow(ws, ["Fact", ...responses.map((r) => r.name), "Comment"]);
    for (const fact of facts) {
      const values = responses.map((r) => r.result.facts.find((f) => f.fact === fact)?.value ?? "not stated");
      const differ = new Set(values.map((v) => v.replace(/\s+/g, "").toLowerCase())).size > 1;
      const row = line(fact, values, differ ? "The responses do not agree – put it to all of them" : undefined);
      if (differ) row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: INPUT } };
    }
  }
  return ws;
}

// ── Stage apportionment ─────────────────────────────────────────────────────────────────────

function sheetStages(wb: ExcelJS.Workbook, responses: readonly WorkbookResponse[], recalc: RecalcRefs) {
  const ws = wb.addWorksheet("Stage Apportionment", { views: [{ state: "frozen", ySplit: 3 }] });
  ws.columns = [{ width: 50 }, { width: 18 }, { width: 13 }, { width: 18 }, { width: 44 }];
  title(
    ws,
    "What each response puts in each stage",
    "The apportionment as each response prints it: in rand, and as a share of its own corrected price. Firms name their stages differently and split them by discipline, so each is set out on its own rather than forced into one grid.",
    5,
  );
  ws.addRow([]);

  responses.forEach((response, index) => {
    const lines = stageLines(response.result);
    if (lines.length < 3) return;
    ws.addRow([]);
    sectionRow(ws, response.result.supplier);
    headerRow(ws, ["Stage", "Amount (R)", "% of its price", "Check", "Note"]);
    const total = ref(recalc.sheet, `F${recalc.totalRow[index]}`);
    const first = ws.rowCount + 1;
    for (const line of lines) {
      const row = ws.addRow([]);
      row.getCell(1).value = line.label;
      row.getCell(1).alignment = { wrapText: true };
      const at = recalc.lineRow[index]?.get(line.id);
      row.getCell(2).value = at ? { formula: ref(recalc.sheet, `F${at}`), date1904: false } : rands(line.corrected ?? line.stated);
      row.getCell(2).numFmt = MONEY;
      row.getCell(3).value = { formula: `IF(OR(B${row.number}="",${total}=0),"",B${row.number}/${total})`, date1904: false };
      row.getCell(3).numFmt = PERCENT;
      row.getCell(4).value = line.verdict;
      if (line.verdict === "error") row.getCell(4).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAD } };
      note(row.getCell(5), line.note);
    }
    const sum = ws.addRow([]);
    sum.getCell(1).value = "Apportioned in total";
    sum.getCell(1).font = { bold: true };
    sum.getCell(2).value = { formula: `SUM(B${first}:B${sum.number - 1})`, date1904: false };
    sum.getCell(2).numFmt = MONEY;
    sum.getCell(3).value = { formula: `IF(${total}=0,"",B${sum.number}/${total})`, date1904: false };
    sum.getCell(3).numFmt = PERCENT;
    note(sum.getCell(5), "Where the stages carry more than one discipline, this sums every line above and will exceed the price – read the lines, not this total.");
  });
  note(
    ws.addRow([]).getCell(1),
    "An apportionment that does not come to the whole price is not an error in itself – reimbursables and time-based work often sit outside it – but it is worth asking what the difference is.",
  );
  return ws;
}

const cellName = (n: number) => String.fromCharCode(64 + n);

// ── Resources and rates ─────────────────────────────────────────────────────────────────────

function sheetResources(wb: ExcelJS.Workbook, responses: readonly WorkbookResponse[]) {
  const ws = wb.addWorksheet("Resources and Rates", { views: [{ state: "frozen", ySplit: 3 }] });
  ws.columns = [{ width: 50 }, { width: 14 }, { width: 14 }, { width: 13 }, { width: 44 }];
  title(ws, "Resources and rates", "What each response discloses about who does the work, for how long and at what rate. Counts are checked exactly – an hour out is an hour out, even where it moves no price.", 5);
  ws.addRow([]);

  for (const response of responses) {
    const r = response.result;
    const tallies = r.tallies.filter((t) => t.stated !== null);
    const rated = (response.extraction?.lines ?? []).filter((l) => l.rate);
    if (!tallies.length && !rated.length) continue;
    ws.addRow([]);
    sectionRow(ws, r.supplier);

    if (rated.length) {
      headerRow(ws, ["Line", "Quantity", "Rate", "", "Note"]);
      for (const l of rated) {
        const checked = r.lines.find((x) => x.id === l.id);
        const row = ws.addRow([l.label, l.quantity ?? "", l.rate ?? "", "", checked?.note ?? ""]);
        row.getCell(1).alignment = { wrapText: true };
        note(row.getCell(5), checked?.note ?? null);
      }
    }
    if (tallies.length) {
      headerRow(ws, ["Count", "As stated", "By its figures", "Check", "Note"]);
      for (const t of tallies) {
        const row = ws.addRow([t.label, t.stated, t.computed, t.verdict, t.working ?? ""]);
        row.getCell(1).alignment = { wrapText: true };
        if (t.verdict === "error") row.getCell(4).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAD } };
        note(row.getCell(5), t.working);
      }
    }
  }
  return ws;
}

// ── Scope and compliance ────────────────────────────────────────────────────────────────────

function sheetCompliance(wb: ExcelJS.Workbook, rfq: RfqView, responses: readonly WorkbookResponse[]) {
  const ws = wb.addWorksheet("Scope and Compliance", { views: [{ state: "frozen", ySplit: 5, xSplit: 1 }] });
  ws.columns = [{ width: 46 }, ...responses.map(() => ({ width: 26 })), { width: 30 }];
  title(ws, "Scope and compliance", "The RFQ's own scope items and requirements against each response, with the words in the response that show it. A requirement is met only where the response does what it asks, not where it mentions it.", responses.length + 2);
  ws.addRow([]);

  sectionRow(ws, "Scope");
  headerRow(ws, ["Scope item", ...responses.map((r) => r.name), "Comment"]);
  rfq.scope.forEach((item, i) => {
    const row = ws.addRow([]);
    row.getCell(1).value = item;
    row.getCell(1).alignment = { wrapText: true };
    responses.forEach((r, k) => {
      const x = r.result.scope[i];
      const cell = row.getCell(2 + k);
      cell.value = x?.status ?? "not stated";
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: x?.status === "included" ? OK : BAD } };
      if (x?.quote) cell.note = x.quote.slice(0, 500);
    });
  });
  const covered = ws.addRow([]);
  covered.getCell(1).value = `Scope items covered (of ${rfq.scope.length})`;
  covered.getCell(1).font = { bold: true };
  responses.forEach((_, k) => {
    const c = cellName(2 + k);
    covered.getCell(2 + k).value = { formula: `COUNTIF(${c}${covered.number - rfq.scope.length}:${c}${covered.number - 1},"included")`, date1904: false };
    covered.getCell(2 + k).font = { bold: true };
  });

  ws.addRow([]);
  sectionRow(ws, "Requirements");
  headerRow(ws, ["Requirement", ...responses.map((r) => r.name), "Comment"]);
  rfq.requirements.forEach((req, i) => {
    const row = ws.addRow([]);
    row.getCell(1).value = req;
    row.getCell(1).alignment = { wrapText: true };
    responses.forEach((r, k) => {
      const x = r.result.requirements[i];
      const cell = row.getCell(2 + k);
      cell.value = x?.status ?? "not stated";
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: x?.status === "met" ? OK : BAD } };
      if (x?.evidence) cell.note = x.evidence.slice(0, 500);
    });
  });
  const met = ws.addRow([]);
  met.getCell(1).value = `Requirements met (of ${rfq.requirements.length})`;
  met.getCell(1).font = { bold: true };
  responses.forEach((_, k) => {
    const c = cellName(2 + k);
    met.getCell(2 + k).value = { formula: `COUNTIF(${c}${met.number - rfq.requirements.length}:${c}${met.number - 1},"met")`, date1904: false };
    met.getCell(2 + k).font = { bold: true };
  });

  ws.addRow([]);
  sectionRow(ws, "What each response excludes, assumes and adds");
  headerRow(ws, ["Item", ...responses.map((r) => r.name), "Comment"]);
  for (const [label, pick] of [
    ["Priced beyond the RFQ", (r: CheckedResponse) => r.extraScope],
    ["Exclusions", (r: CheckedResponse) => r.exclusions],
    ["Assumptions", (r: CheckedResponse) => r.assumptions],
  ] as const) {
    const row = ws.addRow([]);
    row.getCell(1).value = label;
    responses.forEach((r, k) => {
      const cell = row.getCell(2 + k);
      cell.value = pick(r.result).join("; ") || "–";
      cell.alignment = { wrapText: true, vertical: "top" };
      cell.font = { size: 8 };
    });
  }
  return { sheet: ws.name, coveredRow: covered.number, metRow: met.number };
}

// ── Gaps and anomalies ──────────────────────────────────────────────────────────────────────

function sheetGaps(wb: ExcelJS.Workbook, responses: readonly WorkbookResponse[]) {
  const ws = wb.addWorksheet("Gaps and Anomalies", { views: [{ state: "frozen", ySplit: 4 }] });
  ws.columns = [{ width: 5 }, { width: 22 }, { width: 46 }, { width: 17 }, { width: 17 }, { width: 15 }, { width: 11 }, { width: 40 }];
  title(ws, "Gaps and anomalies", "Every finding, what it is worth in rand where it moves money, how serious it is, and what to do about it. High: it changes the price or the comparison. Medium: it must be answered before appointment. Low: it does not move the price.", 8);
  ws.addRow([]);
  headerRow(ws, ["#", "Respondent", "Finding", "As stated (R)", "By its figures (R)", "Effect (R)", "Severity", "Action"]);

  let n = 0;
  const add = (supplier: string, finding: string, stated: number | null, computed: number | null, severity: "High" | "Medium" | "Low", action: string) => {
    const row = ws.addRow([]);
    row.getCell(1).value = ++n;
    row.getCell(2).value = supplier;
    row.getCell(3).value = finding;
    row.getCell(3).alignment = { wrapText: true };
    money(row.getCell(4), rands(stated));
    money(row.getCell(5), rands(computed));
    if (stated !== null && computed !== null) {
      row.getCell(6).value = { formula: `E${row.number}-D${row.number}`, date1904: false };
      row.getCell(6).numFmt = MONEY;
    }
    row.getCell(7).value = severity;
    row.getCell(7).fill = { type: "pattern", pattern: "solid", fgColor: { argb: severity === "High" ? BAD : severity === "Medium" ? INPUT : LIGHT } };
    row.getCell(8).value = action;
    row.getCell(8).alignment = { wrapText: true };
    row.getCell(8).font = { size: 8 };
  };

  for (const { result: r } of responses) {
    for (const e of r.errors) add(r.supplier, `${e.label} does not add up`, e.stated, e.computed, "High", "Put the correction to the firm and ask it to confirm its price.");
    for (const l of r.lines.filter((l) => l.verdict === "check by eye")) add(r.supplier, `${l.label} – read from an image, does not reconcile as read`, l.stated, l.computed, "Medium", "Read the image by eye, or ask for the table as text.");
    if (r.basisMismatch) add(r.supplier, "The fee is worked on a figure other than the response's own estimate", r.basisMismatch.stated, r.basisMismatch.used, "High", "Ask which cost of works the fee rests on.");
    if (r.feeImpact) add(r.supplier, "The fee on the corrected cost of works", r.correctedTotal, r.feeImpact.netOnCorrected, "High", "Ask whether the price holds once its own estimate is corrected.");
    for (const t of r.tallies.filter((t) => t.verdict === "error")) add(r.supplier, `${t.label}: ${t.stated} stated, ${t.computed} by the figures it totals`, null, null, "Low", "A count, not a price – ask the firm to correct the table.");
    for (const q of r.requirements.filter((q) => q.status !== "met")) add(r.supplier, `${q.requirement}: ${q.status}`, null, null, "Medium", "Ask for it before appointment.");
    for (const x of r.scope.filter((x) => x.status !== "included")) add(r.supplier, `Scope – ${x.item}: ${x.status}`, null, null, "High", x.status === "excluded" ? "Price it, or let this part separately." : "Confirm whether the price includes it.");
    for (const o of r.observations) add(r.supplier, o.text, null, null, "Medium", "Ask the firm to correct or confirm it.");
    for (const u of r.unseen) add(r.supplier, `Not checked: ${u}`, null, null, "Medium", "Ask for it as text, or check it by eye.");
    if (!r.named) add(r.supplier, "The firm's name is not in the response's text", null, null, "Medium", "Confirm who submitted it.");
  }
  if (n === 0) note(ws.addRow([]).getCell(1), "Nothing found.");
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + n, column: 8 } };
  return { sheet: ws.name, rows: n };
}

// ── Clarifications ──────────────────────────────────────────────────────────────────────────

function sheetClarifications(wb: ExcelJS.Workbook, rfq: RfqView, responses: readonly WorkbookResponse[]) {
  const ws = wb.addWorksheet("Clarifications", { views: [{ state: "frozen", ySplit: 4 }] });
  ws.columns = [{ width: 5 }, { width: 22 }, { width: 86 }, { width: 40 }, { width: 14 }];
  title(ws, "Clarifications before appointment", "The questions to put to each firm, with room for what they answer. A provisional preference stands or falls on these.", 5);
  ws.addRow([]);
  headerRow(ws, ["#", "Respondent", "Question", "Answer received", "Date"]);
  const names = responses.map((r) => r.result.supplier);
  (rfq.recommendation?.clarifications ?? []).forEach((c, i) => {
    const supplier = names.find((n) => c.startsWith(`${n}:`)) ?? "All respondents";
    const row = ws.addRow([i + 1, supplier, c.replace(/^[^:]+:\s*/, ""), "", ""]);
    row.getCell(3).alignment = { wrapText: true };
    row.getCell(4).fill = { type: "pattern", pattern: "solid", fgColor: { argb: INPUT } };
    row.getCell(5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: INPUT } };
  });
  return ws;
}

// ── Basis and notes ─────────────────────────────────────────────────────────────────────────

function sheetNotes(wb: ExcelJS.Workbook, rfq: RfqView, responses: readonly WorkbookResponse[], s: WorkbookSubject) {
  const ws = wb.addWorksheet("Basis and Notes");
  ws.columns = [{ width: 32 }, { width: 110 }];
  title(ws, "Basis and notes", "What this workbook rests on, and what it does not do.", 2);
  ws.addRow([]);
  const pair = (a: string, b: string) => {
    const row = ws.addRow([a, b]);
    row.getCell(2).alignment = { wrapText: true };
    return row;
  };
  pair("Project", `${s.projectName}${s.code ? ` (${s.code})` : ""}${s.client ? ` for ${s.client}` : ""}`);
  pair("RFQ", rfq.title);
  pair("Issued", `${s.issuedOn} by ${s.issuedBy}`);
  pair("Scope required", rfq.scope.join("; "));
  pair("Requirements", rfq.requirements.join("; "));
  ws.addRow([]);
  sectionRow(ws, "The responses");
  for (const r of responses) {
    pair(r.name, `${r.documentName}${r.evaluatedAt ? ` – read ${r.evaluatedAt.slice(0, 10)}` : ""}. ${r.result.named ? "Named in its own text." : "The firm's name is not in its text; named by the quantity surveyor."}${r.result.unseen.length ? ` Not read: ${r.result.unseen.join("; ")}.` : ""}`);
  }
  ws.addRow([]);
  sectionRow(ws, "How it was done");
  for (const [a, b] of [
    ["The figures", "Every figure was read from the response and found in its own text; where a response shows a table only as a picture, it was read by OCR and the lines that came from it are marked to be confirmed by eye."],
    ["The arithmetic", "Every sum, percentage, discount and fee formula was recomputed from the response's own figures. A line right on the figure it was given but wrong once an error above it is corrected is marked consequential, not a second error."],
    ["The ranking", "Responses covering more of the required scope rank first, then those meeting more of the requirements, then the lowest price with its arithmetic corrected. Where the responses price different scopes the preference is provisional."],
    ["The live cells", "Yellow cells are inputs – the budget, the practice's own cost of works. Every white figure in column F of the recalculation is a formula over the response's own transcribed figures; change an input and the sheet follows."],
    ["What it does not do", "It makes no finding on any firm's technical capability, and it does not verify the construction estimates – those are the firms' own until the practice prices the work itself."],
  ]) {
    pair(a, b);
  }
  return ws;
}

// ── Summary ─────────────────────────────────────────────────────────────────────────────────

function fillSummary(
  ws: ExcelJS.Worksheet,
  rfq: RfqView,
  responses: readonly WorkbookResponse[],
  s: WorkbookSubject,
  refs: { likeForLike: LikeRefs; compliance: { sheet: string; coveredRow: number; metRow: number }; gaps: { sheet: string; rows: number } },
  guide: Record<string, string>,
) {
  ws.columns = [{ width: 46 }, ...responses.map(() => ({ width: 24 })), { width: 52 }];
  title(ws, `${s.projectName}: comparative evaluation of quotations`, `${s.practice}. ${rfq.title}. Issued ${s.issuedOn} by ${s.issuedBy}. All amounts exclude VAT unless stated.`, responses.length + 2);
  ws.addRow([]);

  sectionRow(ws, "1. The responses at a glance");
  headerRow(ws, ["Item", ...responses.map((r) => r.name), "Comment"]);
  const last = responses.length + 2;
  const line = (label: string, values: (string | number | null | { formula: string })[], comment?: string, fmt?: string, bold = false) => {
    const row = ws.addRow([]);
    row.getCell(1).value = label;
    values.forEach((v, i) => {
      const cell = row.getCell(2 + i);
      if (v !== null) cell.value = typeof v === "object" ? { ...v, date1904: false } : v;
      if (fmt) cell.numFmt = fmt;
      if (bold) cell.font = { bold: true };
    });
    if (comment) note(row.getCell(last), comment);
    return row;
  };

  const preferred = rfq.recommendation?.preferred ?? null;
  line("Preferred", responses.map((_, i) => (i === preferred ? (rfq.recommendation?.comparable ? "recommended" : "provisionally preferred") : "")), rfq.recommendation?.comparable === false ? "Provisional: the responses price different scopes" : undefined, undefined, true);
  line("Reference and date", responses.map((r) => [r.result.reference, r.result.date].filter(Boolean).join(", ") || "not stated"));
  line(`Scope items covered (of ${rfq.scope.length})`, responses.map((_, i) => ({ formula: ref(refs.compliance.sheet, `${cellName(2 + i)}${refs.compliance.coveredRow}`) })));
  line(`Requirements met (of ${rfq.requirements.length})`, responses.map((_, i) => ({ formula: ref(refs.compliance.sheet, `${cellName(2 + i)}${refs.compliance.metRow}`) })));
  line("Price excl. VAT, corrected", responses.map((_, i) => ({ formula: refs.likeForLike.correctedTotal[i]! })), undefined, MONEY, true);
  line("Price incl. VAT", responses.map((_, i) => ({ formula: refs.likeForLike.inclVat[i]! })), undefined, MONEY);
  line("Over / (under) the budget", responses.map((_, i) => ({ formula: refs.likeForLike.budgetVariance[i]! })), "Enter the budget on the Like for Like sheet", MONEY);
  if (refs.likeForLike.rate.length) line("Fee as a percentage of its cost of works", responses.map((_, i) => ({ formula: refs.likeForLike.rate[i]! })), "On the scope every response prices", PERCENT);
  for (const severity of ["High", "Medium", "Low"] as const) {
    line(`Findings – ${severity.toLowerCase()}`, responses.map((r) => ({
      formula: `COUNTIFS(${ref(refs.gaps.sheet, "$B:$B")},"${r.result.supplier.replace(/"/g, '""')}",${ref(refs.gaps.sheet, "$G:$G")},"${severity}")`,
    })), severity === "High" ? "See the Gaps and Anomalies sheet" : undefined);
  }

  // ── The recommendation, in the platform's own words ──────────────────────────────────────
  if (rfq.recommendation) {
    ws.addRow([]);
    sectionRow(ws, "2. Recommendation");
    const head = ws.addRow([rfq.recommendation.headline]);
    head.getCell(1).font = { bold: true };
    ws.mergeCells(head.number, 1, head.number, last);
    head.getCell(1).alignment = { wrapText: true };
    head.height = 30;
    for (const reason of rfq.recommendation.reasons) {
      const row = ws.addRow([reason]);
      ws.mergeCells(row.number, 1, row.number, last);
      row.getCell(1).alignment = { wrapText: true };
    }
    if (rfq.decision) {
      const row = ws.addRow([`Decided: ${rfq.decision.name}, by ${rfq.decision.by} – ${rfq.decision.followsRecommendation ? "as recommended" : "against the recommendation"}${rfq.decision.reason ? `: ${rfq.decision.reason}` : "."}`]);
      ws.mergeCells(row.number, 1, row.number, last);
      row.getCell(1).font = { bold: true };
    }
  }

  ws.addRow([]);
  sectionRow(ws, "3. What is in this workbook");
  headerRow(ws, ["Sheet", "What it holds"]);
  for (const [sheet, what] of Object.entries(guide)) {
    const row = ws.addRow([sheet, what]);
    ws.mergeCells(row.number, 2, row.number, last);
    row.getCell(2).alignment = { wrapText: true };
    row.getCell(2).font = { size: 9 };
  }
}
