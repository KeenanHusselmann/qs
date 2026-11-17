/**
 * Paginating a Bill of Quantities — PLATFORM.md §7.6, §5.2.
 *
 * ── Why a bill cannot just be a long table ─────────────────────────────────────────────────
 *
 * §7.6 names the requirement in one line — **"Carried forward / Brought forward subtotals across
 * page breaks"** — and it is the convention that makes a printed bill checkable. A QS adding a
 * page by hand must reach the figure printed at its foot; the next page opens with that same
 * figure, and the last page's total is what the whole bill comes to. Without it a fifty-page bill
 * is fifty pages of numbers nobody can reconcile without adding all of them.
 *
 * This module decides **only where the breaks fall and what carries across them**. It draws
 * nothing. That separation is the point: the arithmetic that has to reconcile is a pure function
 * over a list, testable without a PDF, and the renderer's job is reduced to putting the lines where
 * this says.
 *
 * ── The running total is over *this bill*, not this section ────────────────────────────────
 *
 * Carried forward accumulates every priced item from the start of the bill, across sections. A
 * section subtotal is a different figure with a different job — it says what a trade came to — and
 * printing one where the other belongs is the error the convention exists to catch. Both appear;
 * they are never the same number by accident.
 *
 * ── An unpriced item carries nothing ───────────────────────────────────────────────────────
 *
 * §1.3 and §5: an item nobody has priced contributes nothing and is **not** treated as nought. It
 * still prints — a bill with a row missing is a worse document than one with a gap in it — and the
 * page it is on says how many such rows it holds, so a reader can see that the carried figure is
 * short of them rather than inferring it.
 */

import { billTotal, itemReferences, workingRow, type BillRow, type WireRate } from "@/lib/agent/bill";
import { type Money, displayUnit, money } from "@/domain/money";

/** One printed line of the bill, already decided. */
export type BillLine =
  | { kind: "heading"; row: BillRow; label: string }
  | { kind: "item"; row: BillRow; ref: string; description: string; unit: string; quantity: string | null; rate: WireRate | null; amount: Money | null }
  | { kind: "subtotal"; label: string; total: Money };

export interface BillPage {
  lines: BillLine[];
  /** The bill's running total at the foot of this page. */
  carried: Money;
  /** The same figure at the head — nought on the first page. */
  brought: Money;
  /** Priced items on this page, and items on it carrying no amount. */
  priced: number;
  unpriced: number;
}

/**
 * Lay a bill out into pages.
 *
 * `heightOf` is supplied by the caller so the measurement is the renderer's own — a pagination that
 * guessed at heights would put the carried line a row early on a bill whose descriptions wrap, and
 * the printed figure would then not match the rows above it. `capacity` is the usable height of a
 * page once the header, the column headings and the two carried lines are taken off it.
 */
export function paginate(
  lines: readonly BillLine[],
  heightOf: (line: BillLine) => number,
  capacity: number,
): BillPage[] {
  const pages: BillPage[] = [];

  let current: BillLine[] = [];
  let used = 0;
  let running = 0n;
  let broughtIn = 0n;

  const close = () => {
    const priced = current.filter((l) => l.kind === "item" && l.amount !== null).length;
    const unpriced = current.filter((l) => l.kind === "item" && l.amount === null).length;

    pages.push({
      lines: current,
      carried: money(running),
      brought: money(broughtIn),
      priced,
      unpriced,
    });

    broughtIn = running;
    current = [];
    used = 0;
  };

  for (const line of lines) {
    const height = heightOf(line);

    /*
      A heading is never the last thing on a page.

      It would print a trade name with nothing under it and the first of its items overleaf, which
      reads as an empty section. The report writer's `reserve` exists for the same reason; a bill
      needs it per line rather than per block.
    */
    const orphanHeading = line.kind === "heading" && used + height > capacity * 0.92;

    if (current.length > 0 && (used + height > capacity || orphanHeading)) close();

    current.push(line);
    used += height;

    // The running total is the *bill's*, so it grows on every priced item wherever it sits.
    if (line.kind === "item" && line.amount !== null) running += line.amount;
  }

  if (current.length > 0) close();
  return pages;
}

/**
 * The bill as printable lines — headings, items, and a subtotal wherever a section ends.
 *
 * Struck-out rows are left out entirely. They are struck through on screen because the draft is
 * reviewable there; an issued bill does not carry work nobody is pricing, and a tenderer reading a
 * struck line would not know whether to price it.
 */
export function billLines(rows: readonly BillRow[], signed: boolean): BillLine[] {
  const lines: BillLine[] = [];
  const live = rows.filter((row) => !row.omitted);
  // The same numbering the grid shows, for rows that were never given a reference of their own.
  const refs = itemReferences(rows);

  let section: { id: string; label: string; items: BillRow[] } | null = null;

  const closeSection = () => {
    if (!section || section.items.length === 0) return;
    lines.push({
      kind: "subtotal",
      label: section.label,
      total: billTotal(section.items, signed),
    });
  };

  for (const row of live) {
    const working = workingRow(row);

    if (row.rowType === "heading") {
      closeSection();
      section = { id: row.id, label: working.description ?? "Section", items: [] };
      lines.push({ kind: "heading", row, label: section.label });
      continue;
    }

    if (row.rowType !== "item") continue;

    // A row whose section changed without a heading between them still closes the old one.
    if (section && row.parentId !== section.id) {
      closeSection();
      section = null;
    }
    if (section) section.items.push(row);

    const amount = signed ? row.output?.amount : row.amount;

    lines.push({
      kind: "item",
      row,
      ref: row.itemRef ?? refs.get(row.id) ?? "",
      description: working.description ?? "",
      unit: displayUnit(working.unit ?? ""),
      quantity: working.quantity,
      rate: signed ? (row.output?.rate ?? null) : working.rate,
      // Null, never nought. An item nobody priced is not an item priced at nothing (§5).
      amount: amount == null ? null : money(BigInt(amount)),
    });
  }

  closeSection();
  return lines;
}
