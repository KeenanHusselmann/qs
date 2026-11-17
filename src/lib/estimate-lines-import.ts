/**
 * An estimate's lines, read out of the workbook it arrived in.
 *
 * Engineers' cost models are spreadsheets, and no two are laid out alike: one has an Element
 * column, another heads each section with a bold row; one writes "Qty", another "Quantity". So the
 * lines are found the way a reader finds them – by the headings – and three kinds of row that are
 * not lines are recognised and left out, each said in a note:
 *
 *  - totals and subtotals, which the comparison computes again from the lines
 *  - markups – P&G, contingency, VAT, escalation – which are the estimate's percentages, set on it,
 *    not lines in it; a contingency imported as a line would be counted twice
 *  - section headings, which become the element of the lines under them
 *
 * A line with a quantity and a rate is measured; one with only an amount is a lump sum. Where it
 * has all three, the amount is the workbook's own extension and is not read – the platform extends
 * quantity × rate itself, once, so the two cannot disagree silently.
 *
 * Pure: sheets in, lines out.
 */

import type { EstimateLine } from "@/domain/estimate-comparison";
import { decimal, type Sheet } from "@/lib/design-review-import";

export type LinesResult =
  | { ok: true; lines: EstimateLine[]; notes: string[] }
  | { ok: false; reason: string };

const norm = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const low = (s: string | undefined) => norm(s).toLowerCase();

const TOTAL =
  /\b(sub-?total|total|carried (to|forward)|brought forward|summary)\b/i;
const MARKUP =
  /\b(p\s*&\s*g|preliminar(y|ies) and general|contingenc|vat\b|escalation|profit and attendance)/i;

function findColumn(head: string[], ...prefixes: string[]) {
  for (const p of prefixes) {
    const i = head.findIndex(
      (h) =>
        h === p ||
        h.startsWith(`${p} `) ||
        h.startsWith(`${p}(`) ||
        h.startsWith(`${p}.`),
    );
    if (i >= 0) return i;
  }
  return -1;
}

function readSheet(sheet: Sheet, notes: string[]): EstimateLine[] {
  const grid = sheet.grid;
  let h = -1;
  for (let r = 0; r < Math.min(grid.length, 30); r++) {
    const cells = grid[r].map(low);
    if (
      cells.some(
        (c) => c.startsWith("description") || c === "item description",
      ) &&
      cells.some((c) => /^(rate|amount|total|qty|quantity)/.test(c))
    ) {
      h = r;
      break;
    }
  }
  if (h < 0) return [];
  const head = grid[h].map(low);
  const c = {
    element: findColumn(
      head,
      "element",
      "section",
      "category",
      "trade",
      "bill",
    ),
    description: head.findIndex(
      (x) => x.startsWith("description") || x === "item description",
    ),
    quantity: findColumn(head, "qty", "quantity", "quant"),
    unit: findColumn(head, "unit", "units", "uom"),
    rate: findColumn(head, "rate", "unit rate", "rate (r)"),
    amount: findColumn(head, "amount", "total", "lump sum", "sum", "cost"),
  };

  const lines: EstimateLine[] = [];
  let section: string | null = null;
  let skippedTotals = 0;
  const markups: string[] = [];

  for (const row of grid.slice(h + 1)) {
    const description = norm(row[c.description]);
    if (!description) continue;
    const qty = c.quantity >= 0 ? decimal(row[c.quantity], 4) : null;
    const rate = c.rate >= 0 ? decimal(row[c.rate], 2) : null;
    const amount = c.amount >= 0 ? decimal(row[c.amount], 2) : null;
    const element = c.element >= 0 ? norm(row[c.element]) : "";

    // Totals first: "TOTAL excl. VAT" is a total that happens to name VAT, not a VAT line.
    if (TOTAL.test(description) && (amount !== null || qty === null)) {
      skippedTotals++;
      continue;
    }
    if (MARKUP.test(description)) {
      markups.push(description);
      continue;
    }
    // A row with words and no figures is a heading: the element of the lines below it.
    if (qty === null && rate === null && amount === null) {
      if (c.element < 0) section = description;
      continue;
    }
    const measured = qty !== null && rate !== null;
    if (!measured && amount === null) continue;

    lines.push({
      position: 0,
      element: element || section || sheet.name,
      description,
      quantity: measured ? qty : null,
      unit: norm(row[c.unit]) || null,
      rate: measured ? rate : null,
      lumpSum: measured ? null : amount,
    });
  }

  if (skippedTotals)
    notes.push(
      `${sheet.name}: ${skippedTotals} total row${skippedTotals === 1 ? " was" : "s were"} left out – totals are computed from the lines.`,
    );
  if (markups.length)
    notes.push(
      `${sheet.name}: ${markups.join("; ")} – markups are the estimate's percentages, set on it, so ${markups.length === 1 ? "it was" : "they were"} not read as lines. Check the P&G and contingency on the estimate.`,
    );
  return lines;
}

/** Read every sheet that has an estimate's columns. */
export function importLines(sheets: readonly Sheet[]): LinesResult {
  const notes: string[] = [];
  const lines = sheets
    .flatMap((s) => readSheet(s, notes))
    .map((l, i) => ({ ...l, position: i + 1 }));
  if (lines.length === 0) {
    return {
      ok: false,
      reason:
        "No estimate lines were found. A sheet needs a Description column and a Rate or Amount column, with a Qty column for measured lines.",
    };
  }
  return { ok: true, lines, notes };
}
