/**
 * The Bill of Quantities as an issued document — PLATFORM.md §7.1 #6, §7.6, §4.7.
 *
 * ── The printout is the product ────────────────────────────────────────────────────────────
 *
 * §7.1 #6 says so in four words, and §7.6 adds that this "gets as much design attention as the
 * grid" and is "not just a PDF export". Until now the platform could draft a bill, price it from
 * the rate library, build up a rate and sign it off — and then not produce the document a QS sends
 * to tenderers. The primary deliverable had no printed form.
 *
 * ── What makes a printed bill a bill ───────────────────────────────────────────────────────
 *
 * **Carried forward and brought forward.** §7.6 names it, and it is what lets a QS add a page by
 * hand and reach the figure at its foot. The next page opens with that figure; the last page's
 * carried total is what the bill comes to. `bill-pages.ts` decides those, as a pure function over
 * a list, because it is arithmetic that has to reconcile rather than layout that has to look right.
 *
 * **Repeating column headings**, so page nineteen is readable without page one.
 *
 * **A collection page** — each section and what it came to, adding to the bill total. It is the
 * page a reader turns to first and the one an adjudicator checks the tender sum against.
 *
 * **Item references that survive pagination**, because a query about item 4.2.1 has to find it.
 *
 * ── An unpriced item prints ────────────────────────────────────────────────────────────────
 *
 * With its amount column blank, and the page it sits on says how many such rows it holds. §5 and
 * §1.3: an item nobody priced contributes nothing and is not nought, and a bill that silently
 * dropped it would total correctly while describing less work than the job contains. A draft is
 * marked as a draft on every page for the same reason.
 */

import { createPdf } from "@/lib/pdf/writer";
import { formatMoney, formatQuantity, formatRate, quantity, type Money } from "@/domain/money";
import { billLines, paginate, type BillLine } from "@/lib/report/bill-pages";
import type { BillRow } from "@/lib/agent/bill";

export interface BillSubject {
  practice: string;
  projectName: string;
  code: string | null;
  /** The bill's own title — the module's label, so the document calls itself what the nav does. */
  title: string;
  /** Who signed it and when, where it is issued. A draft says so instead. */
  signedBy: string | null;
  signedAt: string | null;
}

/** Column geometry, in points from the left margin. One statement, used by every row. */
const COLUMNS = {
  ref: { x: 0, width: 34 },
  description: { x: 38, width: 214 },
  unit: { x: 256, width: 26 },
  quantity: { x: 284, width: 60 },
  rate: { x: 348, width: 58 },
  amount: { x: 410, width: 73 },
} as const;

/**
 * Where one column ends and the next begins, for the vertical rules.
 *
 * Between the cells rather than on them: each boundary sits in the gutter COLUMNS already leaves,
 * so a rule never crosses a digit. The left edge of the description is left open - a bill's
 * narrative and its headings run across that boundary, and boxing them would cut the sentences
 * the preliminaries are made of.
 */
const BOUNDARIES = [36, 254, 282, 346, 408] as const;

const money = (value: Money) => formatMoney(value, { symbol: "" });

/** The heading row, drawn at the top of every page so page nineteen reads without page one. */
function columnHeadings(doc: ReturnType<typeof createPdf>) {
  doc.row(
    [
      { text: "Item", ...COLUMNS.ref, bold: true },
      { text: "Description", ...COLUMNS.description, bold: true },
      { text: "Unit", ...COLUMNS.unit, bold: true },
      { text: "Quantity", ...COLUMNS.quantity, align: "right", bold: true },
      { text: "Rate (R)", ...COLUMNS.rate, align: "right", bold: true },
      { text: "Amount (R)", ...COLUMNS.amount, align: "right", bold: true },
    ],
    { size: 8.5 },
  );
  doc.rule({ thickness: 0.8, gap: 4 });
}

/**
 * Render a bill.
 *
 * `rows` is the bill as the grid holds it; `signed` decides whether the frozen output or the
 * working draft is printed. Those are the same two readings every other surface takes, so a printed
 * bill cannot show a figure the screen does not.
 */
export function billPdf(
  rows: readonly BillRow[],
  subject: BillSubject,
  signed: boolean,
  /**
   * The bill sent out for pricing: rates and amounts are already blank on the rows; this leaves
   * every total as a line for the tenderer to fill, rather than a nought that reads as a price.
   */
  forPricing = false,
): Buffer {
  const total$ = (m: Money) => (forPricing ? "................" : money(m));
  const doc = createPdf({ title: `${subject.projectName} – ${subject.title}` });

  // En dashes, not em dashes: the practice's convention for anything it sends out. (The writer
  // transliterates an em dash to a hyphen, so these used to print as "-".)
  doc.footerOnEveryPage(
    (page, total) =>
      `${subject.practice} · ${subject.projectName}${subject.code ? ` · ${subject.code}` : ""}` +
      `${subject.signedAt ? "" : "   –   DRAFT"}   –   Page ${page} of ${total}`,
  );

  const lines = billLines(rows, signed);

  /*
    Measured with the renderer's own arithmetic rather than guessed.

    A pagination that estimated heights would put the carried line a row early on a bill whose
    descriptions wrap, and the figure printed there would not match the rows above it — which is
    precisely the thing the convention exists to make checkable.
  */
  const heightOf = (line: BillLine): number => {
    if (line.kind === "heading") return doc.rowHeight([{ text: line.label, ...COLUMNS.description }], { size: 10 }) + 10;
    if (line.kind === "subtotal") return doc.rowHeight([{ text: line.label, ...COLUMNS.description }]) + 10;
    return doc.rowHeight([
      { text: line.ref, ...COLUMNS.ref },
      { text: line.description, ...COLUMNS.description },
      { text: line.unit, ...COLUMNS.unit },
    ]) + 2;
  };

  /*
    The usable height of a page, once everything that is *not* a bill line is taken off it.

    Measured rather than guessed, because guessing it low is not a cosmetic error. `row()` breaks
    the page by itself when it runs out of room, so a capacity larger than the truth produces a
    physical page the pagination never planned — and that page gets no brought-forward at its head
    and no carried-forward at its foot. Seen at 90: a five-page bill had a page 3 with neither, and
    page 4 brought forward page 2's figure. The document still totalled correctly and could not be
    added up by hand, which is the one thing the convention exists to make possible.

    Every item is per page: the title, the project line, the column headings and their rule, the
    brought-forward row and its rule, the carried-forward rule and row, and the note about unpriced
    items. `CHROME` is their sum with a line's slack on top.
  */
  const CHROME =
    13 * 1.3 + 2 + // title
    9 * 1.3 + 6 + // project line
    8.5 * 1.3 + 6 + // column headings and rule
    9.5 * 1.3 + 6 + // brought forward and rule
    9.5 * 1.3 + 6 + // carried forward and rule
    8 * 1.3 + 6 + // the unpriced note
    14; // slack, so a wrapped description cannot tip a page over

  const capacity = doc.remaining() - CHROME;
  const pages = paginate(lines, heightOf, capacity);

  // ── The bill ──────────────────────────────────────────────────────────────────────────────
  pages.forEach((page, index) => {
    if (index > 0) doc.page();

    doc.text(subject.title, { size: 13, bold: true, gap: 2 });
    doc.text(
      `${subject.projectName}${subject.code ? ` · ${subject.code}` : ""}`,
      { size: 9, grey: 0.35, gap: 6 },
    );

    columnHeadings(doc);
    // The table's top, remembered so its columns can be ruled once its height is known.
    const tableTop = doc.at();

    // Brought forward, before anything else on the page. Nought is not printed on page one: there
    // is nothing to bring, and a "0,00" there invites the reader to look for what came before it.
    if (index > 0) {
      doc.row(
        [
          { text: "Brought forward", ...COLUMNS.description, bold: true },
          { text: "R", ...COLUMNS.rate, align: "right", bold: true },
          { text: total$(page.brought), ...COLUMNS.amount, align: "right", bold: true },
        ],
        { size: 9.5 },
      );
      doc.rule({ gap: 4 });
    }

    for (const line of page.lines) {
      if (line.kind === "heading") {
        doc.space(6);
        doc.row([{ text: line.label.toUpperCase(), ...COLUMNS.description, bold: true }], { size: 10 });
        doc.rule({ gap: 3 });
        continue;
      }

      if (line.kind === "subtotal") {
        doc.rule({ gap: 3 });
        doc.row(
          [
            { text: `${line.label} – section total`, ...COLUMNS.description, bold: true },
            { text: total$(line.total), ...COLUMNS.amount, align: "right", bold: true },
          ],
          { size: 9.5 },
        );
        doc.space(4);
        continue;
      }

      doc.row([
        { text: line.ref, ...COLUMNS.ref, grey: 0.4 },
        { text: line.description, ...COLUMNS.description },
        { text: line.unit, ...COLUMNS.unit },
        {
          text: line.quantity ? formatQuantity(quantity(BigInt(line.quantity.replace(".", "")))) : "",
          ...COLUMNS.quantity,
          align: "right",
        },
        // Blank, not nought. See the note at the top of this file.
        { text: line.rate ? formatRate({ value: BigInt(line.rate.value), precision: line.rate.precision }) : "", ...COLUMNS.rate, align: "right" },
        /*
          An unpriced amount is stated, not left empty.

          It was blank, with a note at the foot of the page counting how many such rows it held -
          which is true, and asks the reader to hold a number in their head while they hunt for
          which rows it refers to. A bill says "Not Priced" in the amount column on the row itself,
          which is the same fact where the reader already is. On a bill issued FOR pricing the cell
          stays empty: that is where the tenderer writes.
        */
        {
          text: line.amount === null ? (forPricing ? "" : "Not Priced") : money(line.amount),
          ...COLUMNS.amount,
          align: "right",
          ...(line.amount === null ? { grey: 0.45 } : {}),
        },
      ]);
    }

    // Carried forward at the foot, on every page but the last — the last one's figure is the total
    // and it is stated as one on the collection page rather than as something still being carried.
    if (index < pages.length - 1) {
      doc.rule({ thickness: 0.8, gap: 4 });
      doc.row(
        [
          { text: "Carried forward", ...COLUMNS.description, bold: true },
          // The rand mark in its own column, as a bill prints it - the figure beside it is money
          // and nothing else in the column is.
          { text: "R", ...COLUMNS.rate, align: "right", bold: true },
          { text: total$(page.carried), ...COLUMNS.amount, align: "right", bold: true },
        ],
        { size: 9.5 },
      );
      /*
        The double rule under a carried figure.

        It is how a bill says "this one is closed": a single rule separates, two underline a
        figure that is not going to change on this page. A quantity surveyor adding the page by
        hand stops there.
      */
      doc.rule({ thickness: 0.6, gap: 1.6 });
      doc.rule({ thickness: 0.6, gap: 4 });
    }

    /*
      The columns, ruled now that the table's height is settled.

      Drawn here rather than at the end of the page: everything above this line is the table, and
      the note below it is a remark about the table, not a row of it. Ruling to the bottom of the
      page carried the column lines straight through that sentence.
    */
    doc.verticals(BOUNDARIES, tableTop);

    /*
      Still said once per page, now that each row says it too.

      The count is what tells a reader whether the page they are holding is nearly complete or
      barely started, which no single row can. What it no longer has to do is send them looking
      for which rows it meant.
    */
    if (page.unpriced > 0 && !forPricing) {
      doc.space(4);
      doc.text(
        `${page.unpriced} ${page.unpriced === 1 ? "item" : "items"} on this page ${
          page.unpriced === 1 ? "is" : "are"
        } marked Not Priced, and ${page.unpriced === 1 ? "is" : "are"} excluded from the amounts above.`,
        { size: 8, grey: 0.4 },
      );
    }

  });

  // ── The collection ────────────────────────────────────────────────────────────────────────
  //
  // Each section and what it came to, adding to the bill total. The page a reader turns to first,
  // and the one a tender sum is checked against.
  const sections = lines.filter((l) => l.kind === "subtotal");
  const total = pages.at(-1)?.carried ?? (0n as Money);
  const unpriced = pages.reduce((n, p) => n + p.unpriced, 0);

  doc.page();
  doc.text("Collection", { size: 13, bold: true, gap: 2 });
  doc.text(
    `${subject.projectName}${subject.code ? ` · ${subject.code}` : ""}`,
    { size: 9, grey: 0.35, gap: 8 },
  );

  doc.row(
    [
      { text: "Section", ...COLUMNS.description, bold: true },
      { text: "Amount (R)", ...COLUMNS.amount, align: "right", bold: true },
    ],
    { size: 8.5 },
  );
  doc.rule({ thickness: 0.8, gap: 4 });

  for (const section of sections) {
    if (section.kind !== "subtotal") continue;
    doc.row([
      { text: section.label, ...COLUMNS.description },
      { text: total$(section.total), ...COLUMNS.amount, align: "right" },
    ]);
  }

  doc.rule({ thickness: 1.4, gap: 6, grey: 0.2 });
  doc.row(
    [
      { text: "Total", ...COLUMNS.description, bold: true },
      { text: total$(total), ...COLUMNS.amount, align: "right", bold: true },
    ],
    { size: 11 },
  );

  /*
    What the total is not.

    A bill with unpriced items totals correctly and describes less work than the job contains, so
    the document says which it is. §1.3 — a gap is stated, never quietly summed past — and this is
    the sentence a reader needs before they treat the figure as a tender sum.
  */
  if (unpriced > 0 && !forPricing) {
    doc.space(8);
    doc.text(
      `${unpriced} ${unpriced === 1 ? "item is" : "items are"} not priced and ${
        unpriced === 1 ? "is" : "are"
      } excluded from this total. It is the total of the work that has been priced, not of the bill.`,
      { size: 8.5, grey: 0.35 },
    );
  }

  doc.space(14);
  doc.rule({ thickness: 0.6, gap: 8 });

  if (subject.signedAt && subject.signedBy) {
    doc.text(
      `Signed off by ${subject.signedBy} on ${subject.signedAt}. These figures are frozen; a change means running the step again.`,
      { size: 8.5, grey: 0.35 },
    );
  } else {
    // Said on the collection page as well as in every footer: this is the page that gets
    // photographed and sent, and a draft total loose in an inbox is how one gets tendered against.
    // Worded for whoever receives it, not for the platform: the September review (§7) flagged the
    // old "nothing downstream reads them", which described this app's pipeline to a reader who
    // has never seen it. A bill for pricing is always signed, so this never contradicts one.
    doc.text(
      "DRAFT – this bill has not been signed off. Its quantities and figures may still change, so it is not to be priced or tendered against.",
      { size: 8.5, bold: true, grey: 0.2 },
    );
  }

  return doc.build();
}
