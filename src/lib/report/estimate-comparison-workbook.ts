/**
 * An estimate comparison, as a workbook – the memo's tables, worked rather than typed.
 *
 *  - Summary: elements by estimate (SUMIFs over each estimate's sheet), direct works, P&G and
 *    contingency as formulas on percentage cells, total, the alternative contingency, per unit on
 *    each estimate's own count and on the common one
 *  - one sheet per estimate: its lines, amount = quantity × rate + lump sum, and its corrections
 *  - Gap: where the difference between the first two estimates sits
 *  - Clarifications
 *
 * Formulas carry the platform's computed figure as their cached result; Excel recalculates on open.
 * Pure: a comparison in, bytes out.
 */

import ExcelJS from "exceljs";

import {
  elementOrder,
  gapBetween,
  priceAll,
  type Comparison,
} from "@/domain/estimate-comparison";
import { col } from "@/lib/report/tender-evaluation-workbook";

export interface ComparisonSubject {
  practice: string;
  projectName: string;
  exportedOn: string;
  exportedBy: string;
}

const NAVY = "FF1F3A5F";
const LIGHT = "FFEEF2F7";
const INPUT = "FFFFF3D1";
const GREY = "FF56606E";
const MONEY = "#,##0.00;[Red]-#,##0.00";
const PCT = "0.0%";

const cents = (m: bigint) => Number(m) / 100;
const num = (s: string | null) => (s === null || s === "" ? null : Number(s));

function header(ws: ExcelJS.Worksheet, row: number, labels: readonly string[]) {
  const r = ws.getRow(row);
  labels.forEach((label, i) => {
    const c = r.getCell(i + 1);
    c.value = label;
    c.font = { bold: true, size: 9 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } };
    c.border = { bottom: { style: "medium", color: { argb: NAVY } } };
    c.alignment = { wrapText: true, vertical: "bottom" };
  });
}

/** A sheet name Excel accepts: 31 characters, none of []:*?/\, unique in the book. */
function sheetName(name: string, taken: Set<string>): string {
  const base =
    name
      .replace(/[[\]:*?/\\]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 28) || "Estimate";
  let candidate = base;
  for (let i = 2; taken.has(candidate.toLowerCase()); i++)
    candidate = `${base.slice(0, 26)} ${i}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

export async function estimateComparisonWorkbook(
  c: Comparison,
  s: ComparisonSubject,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = s.practice;
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;

  const priced = priceAll(c);
  const order = elementOrder(c);
  const taken = new Set(["summary", "gap", "clarifications"]);
  const summary = wb.addWorksheet("Summary");

  // ── One sheet per estimate ──
  const refs = c.estimates.map((e, k) => {
    const name = sheetName(e.name, taken);
    const ws = wb.addWorksheet(name, {
      views: [{ state: "frozen", ySplit: 4 }],
    });
    ws.columns = [
      { width: 26 },
      { width: 46 },
      { width: 12 },
      { width: 8 },
      { width: 13 },
      { width: 15 },
      { width: 16 },
    ];
    ws.getCell("A1").value = e.name;
    ws.getCell("A1").font = { bold: true, size: 13, color: { argb: NAVY } };
    ws.getCell("A2").value = [e.preparedBy, e.dated, e.basis]
      .filter(Boolean)
      .join(" · ");
    ws.getCell("A2").font = { size: 9, color: { argb: GREY } };
    header(ws, 4, [
      "Element",
      "Description",
      "Qty",
      "Unit",
      "Rate",
      "Lump sum",
      "Amount",
    ]);
    let r = 5;
    for (const l of e.lines) {
      const row = ws.getRow(r);
      row.values = [
        l.element,
        l.description,
        num(l.quantity),
        l.unit ?? "",
        num(l.rate),
        num(l.lumpSum),
      ];
      row.getCell(7).value = {
        formula: `IF(AND(ISNUMBER(C${r}),ISNUMBER(E${r})),C${r}*E${r},0)+IF(ISNUMBER(F${r}),F${r},0)`,
      };
      [5, 6, 7].forEach((i) => (row.getCell(i).numFmt = MONEY));
      r++;
    }
    const lineLast = Math.max(5, r - 1);
    r++;
    let corrFirst = r + 1;
    let corrLast = r + 1;
    if (e.derivedFrom || e.corrections.length) {
      ws.getCell(r, 1).value = "CORRECTIONS";
      ws.getCell(r, 1).font = { bold: true };
      r++;
      header(ws, r, [
        "Element",
        "Correction",
        "Ref",
        "",
        "",
        "Basis",
        "Amount",
      ]);
      r++;
      corrFirst = r;
      for (const x of e.corrections) {
        ws.getRow(r).values = [
          x.element,
          x.description,
          x.ref,
          "",
          "",
          x.basis ?? "",
          num(x.amount),
        ];
        ws.getCell(r, 7).numFmt = MONEY;
        r++;
      }
      corrLast = Math.max(corrFirst, r - 1);
    }
    return { name, lineLast, corrFirst, corrLast, column: col(2 + k) };
  });

  // ── Summary ──
  const n = c.estimates.length;
  summary.columns = [
    { width: 34 },
    ...Array.from({ length: n }, () => ({ width: 18 })),
  ];
  summary.getCell("A1").value = c.title;
  summary.getCell("A1").font = { bold: true, size: 14, color: { argb: NAVY } };
  summary.getCell("A2").value =
    `${s.projectName} · ${c.subject ?? ""} · exported ${s.exportedOn} by ${s.exportedBy} · R, excl. VAT`;
  summary.getCell("A2").font = { size: 9, color: { argb: GREY } };
  header(summary, 4, ["Element", ...c.estimates.map((e) => e.name)]);
  let r = 5;
  const q = (name: string) => `'${name.replace(/'/g, "''")}'`;
  for (const element of order) {
    summary.getCell(r, 1).value = element;
    refs.forEach((ref, k) => {
      const sh = q(ref.name);
      const crit = `"${element.replace(/"/g, '""')}"`;
      const cell = summary.getCell(r, 2 + k);
      cell.value = {
        formula: `SUMIF(${sh}!$A$5:$A$${ref.lineLast},${crit},${sh}!$G$5:$G$${ref.lineLast})+SUMIF(${sh}!$A$${ref.corrFirst}:$A$${ref.corrLast},${crit},${sh}!$G$${ref.corrFirst}:$G$${ref.corrLast})`,
        result: cents(
          priced[k].elements.find((x) => x.element === element)!.amount,
        ),
      };
      cell.numFmt = MONEY;
    });
    r++;
  }
  const lastElement = r - 1;
  const line = (
    label: string,
    formula: (c: string) => string,
    result: (k: number) => number | string | null,
    fmt = MONEY,
    bold = false,
  ) => {
    summary.getCell(r, 1).value = label;
    if (bold) summary.getCell(r, 1).font = { bold: true };
    refs.forEach((ref, k) => {
      const cell = summary.getCell(r, 2 + k);
      cell.value = { formula: formula(ref.column), result: result(k) ?? "" };
      cell.numFmt = fmt;
      if (bold) cell.font = { bold: true };
    });
    return r++;
  };
  const inputRow = (
    label: string,
    values: (k: number) => number | null,
    fmt: string,
  ) => {
    summary.getCell(r, 1).value = label;
    c.estimates.forEach((_, k) => {
      const cell = summary.getCell(r, 2 + k);
      cell.value = values(k);
      cell.numFmt = fmt;
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: INPUT },
      };
    });
    return r++;
  };
  const direct = line(
    "Direct works",
    (x) => `SUM(${x}5:${x}${lastElement})`,
    (k) => cents(priced[k].direct),
    MONEY,
    true,
  );
  const pgPct = inputRow(
    "P&G %",
    (k) => num(c.estimates[k].preliminaries),
    PCT,
  );
  const pg = line(
    "Preliminary and general",
    (x) => `${x}${direct}*${x}${pgPct}`,
    (k) => cents(priced[k].preliminaries),
  );
  const contPct = inputRow(
    "Contingency %",
    (k) => num(c.estimates[k].contingency),
    PCT,
  );
  const cont = line(
    "Contingency",
    (x) => `(${x}${direct}+${x}${pg})*${x}${contPct}`,
    (k) => cents(priced[k].contingency),
  );
  const total = line(
    "Total excl. VAT",
    (x) => `${x}${direct}+${x}${pg}+${x}${cont}`,
    (k) => cents(priced[k].total),
    MONEY,
    true,
  );
  if (c.alternativeContingency) {
    summary.getCell(r, 1).value = "Alternative contingency";
    summary.getCell(r, 2).value = num(c.alternativeContingency);
    summary.getCell(r, 2).numFmt = PCT;
    summary.getCell(r, 2).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: INPUT },
    };
    const alt = r++;
    line(
      "Total at alternative contingency",
      (x) => `(${x}${direct}+${x}${pg})*(1+$B$${alt})`,
      (k) =>
        priced[k].alternativeTotal === null
          ? null
          : cents(priced[k].alternativeTotal!),
    );
  }
  const units = inputRow(
    `${c.unitLabel} assumed`,
    (k) => num(c.estimates[k].units),
    "#,##0",
  );
  line(
    `Per ${c.unitLabel.replace(/s$/, "")}, own count`,
    (x) => `IF(${x}${units}>0,${x}${total}/${x}${units},"-")`,
    (k) => (priced[k].perUnitOwn === null ? "-" : cents(priced[k].perUnitOwn!)),
  );
  if (c.commonUnits) {
    summary.getCell(r, 1).value = `Common ${c.unitLabel} count`;
    summary.getCell(r, 2).value = num(c.commonUnits);
    summary.getCell(r, 2).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: INPUT },
    };
    const common = r++;
    line(
      `Per ${c.unitLabel.replace(/s$/, "")} at the common count`,
      (x) => `${x}${total}/$B$${common}`,
      (k) =>
        priced[k].perUnitCommon === null
          ? null
          : cents(priced[k].perUnitCommon!),
      MONEY,
      true,
    );
  }

  // ── Gap ──
  if (priced.length >= 2) {
    const gap = gapBetween(priced[1], priced[0]);
    const g = wb.addWorksheet("Gap");
    g.columns = [{ width: 34 }, { width: 18 }];
    g.getCell("A1").value = `${gap.to} less ${gap.from}`;
    g.getCell("A1").font = { bold: true, size: 13, color: { argb: NAVY } };
    header(g, 3, ["Where the gap sits", "R"]);
    gap.parts.forEach((p, i) => {
      g.getRow(4 + i).values = [p.label, cents(p.difference)];
      g.getCell(4 + i, 2).numFmt = MONEY;
    });
    const end = 4 + gap.parts.length;
    g.getCell(end, 1).value = "Total";
    g.getCell(end, 1).font = { bold: true };
    g.getCell(end, 2).value = {
      formula: `SUM(B4:B${end - 1})`,
      result: cents(gap.total),
    };
    g.getCell(end, 2).numFmt = MONEY;
  }

  // ── Clarifications ──
  const cl = wb.addWorksheet("Clarifications");
  cl.columns = [
    { width: 6 },
    { width: 18 },
    { width: 48 },
    { width: 40 },
    { width: 40 },
    { width: 40 },
    { width: 10 },
  ];
  header(cl, 1, [
    "No",
    "To",
    "Observation",
    "Evidence",
    "Consequence",
    "Response",
    "Status",
  ]);
  c.clarifications.forEach(
    (x, i) =>
      (cl.getRow(i + 2).values = [
        `C${x.number}`,
        x.estimate ?? "",
        x.observation,
        x.evidence ?? "",
        x.consequence ?? "",
        x.response ?? "",
        x.status,
      ]),
  );
  cl.eachRow((row) =>
    row.eachCell(
      (cell) => (cell.alignment = { wrapText: true, vertical: "top" }),
    ),
  );

  return Buffer.from(await wb.xlsx.writeBuffer());
}
