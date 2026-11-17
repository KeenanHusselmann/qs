/**
 * Paginating a bill — PLATFORM.md §7.6, §5.4.
 *
 * The carried-forward convention exists so a QS can add a printed page by hand and reach the figure
 * at its foot. That makes these assertions arithmetic rather than layout: the last page's carried
 * figure must be the bill's total, every page's brought-forward must be the previous page's
 * carried, and an unpriced item must contribute nothing rather than nought.
 */

import { describe, expect, it } from "vitest";

import { billLines, paginate, type BillLine } from "./bill-pages";
import type { BillRow } from "@/lib/agent/bill";

const row = (over: Partial<BillRow> = {}): BillRow =>
  ({
    id: crypto.randomUUID(),
    seq: 1,
    parentId: null,
    rowType: "item",
    itemRef: "1.1",
    proposed: { description: "An item", unit: "m2", quantity: "10.0000", rate: null, confidence: 1, note: null, state: "found" },
    citation: null,
    override: null,
    quantitySource: "manual",
    rateSource: "manual",
    amount: "10000",
    output: null,
    omitted: null,
    ...over,
  }) as unknown as BillRow;

/** One unit of height per line, so capacity reads as "lines per page". */
const oneEach = () => 1;

const item = (amount: string | null, ref = "1.1"): BillLine => ({
  kind: "item",
  row: row(),
  ref,
  description: "An item",
  unit: "m2",
  quantity: "10.0000",
  rate: null,
  amount: amount === null ? null : (BigInt(amount) as never),
});

describe("what carries across a page break", () => {
  it("carries the bill's running total, and brings it in on the next page", () => {
    const pages = paginate([item("100"), item("200"), item("300"), item("400")], oneEach, 2);

    expect(pages).toHaveLength(2);
    expect(pages[0]?.brought).toBe(0n);
    expect(pages[0]?.carried).toBe(300n);
    expect(pages[1]?.brought).toBe(300n);
    expect(pages[1]?.carried).toBe(1000n);
  });

  /** The assertion the whole convention exists for. */
  it("ends on the bill's own total", () => {
    const lines = [item("100"), item("250"), item("75")];
    const pages = paginate(lines, oneEach, 1);

    expect(pages.at(-1)?.carried).toBe(425n);
  });

  it("brings forward exactly what the page before carried, on every page", () => {
    const pages = paginate([item("10"), item("20"), item("30"), item("40"), item("50")], oneEach, 2);

    for (let i = 1; i < pages.length; i++) {
      expect(pages[i]!.brought).toBe(pages[i - 1]!.carried);
    }
  });

  /**
   * §5 and §1.3 — an item nobody priced contributes nothing and is not nought. It still prints, and
   * the page says how many it holds so a reader can see the carried figure is short of them.
   */
  it("carries nothing for an unpriced item, and counts it", () => {
    const pages = paginate([item("100"), item(null), item("200")], oneEach, 5);

    expect(pages[0]?.carried).toBe(300n);
    expect(pages[0]?.priced).toBe(2);
    expect(pages[0]?.unpriced).toBe(1);
  });

  it("puts everything on one page when it fits", () => {
    expect(paginate([item("100"), item("200")], oneEach, 10)).toHaveLength(1);
  });

  it("has nothing to paginate on an empty bill", () => {
    expect(paginate([], oneEach, 10)).toEqual([]);
  });

  /**
   * A heading alone at the foot of a page prints a trade name with nothing under it and its first
   * item overleaf, which reads as an empty section.
   */
  it("does not leave a heading stranded at the foot of a page", () => {
    const heading: BillLine = { kind: "heading", row: row({ rowType: "heading" }), label: "Concrete" };
    const pages = paginate([item("100"), item("200"), heading, item("300")], oneEach, 3);

    // The heading moves to page two rather than closing page one.
    expect(pages[0]?.lines.at(-1)?.kind).toBe("item");
    expect(pages[1]?.lines[0]?.kind).toBe("heading");
  });
});

describe("what a bill prints", () => {
  const heading = (id: string, label: string) =>
    row({
      id,
      rowType: "heading",
      proposed: {
        description: label,
        unit: null,
        quantity: null,
        rate: null,
        confidence: 1,
        note: null,
        state: "found",
        quantityText: null,
        rateText: null,
      },
    } as unknown as Partial<BillRow>);

  it("closes each section with its own subtotal", () => {
    const a = heading("a", "Concrete");
    const lines = billLines(
      [a, row({ parentId: "a", amount: "1000" }), row({ parentId: "a", amount: "2000" })],
      false,
    );

    const subtotal = lines.find((l) => l.kind === "subtotal");
    expect(subtotal).toMatchObject({ label: "Concrete", total: 3000n });
  });

  /**
   * A section subtotal and the carried figure are different numbers with different jobs — the first
   * says what a trade came to, the second what the bill has reached. Printing one where the other
   * belongs is the error the convention exists to catch.
   */
  it("keeps a section subtotal apart from the running total", () => {
    const a = heading("a", "Concrete");
    const b = heading("b", "Masonry");
    const lines = billLines(
      [a, row({ parentId: "a", amount: "1000" }), b, row({ parentId: "b", amount: "4000" })],
      false,
    );

    const subtotals = lines.filter((l) => l.kind === "subtotal");
    expect(subtotals.map((s) => (s.kind === "subtotal" ? s.total : 0n))).toEqual([1000n, 4000n]);

    // Whereas the bill's running total reaches 5000.
    expect(paginate(lines, oneEach, 99).at(-1)?.carried).toBe(5000n);
  });

  /** An issued bill does not carry work nobody is pricing — a tenderer could not read it. */
  it("leaves struck-out rows out entirely", () => {
    const lines = billLines(
      [row({ amount: "1000" }), row({ amount: "9999", omitted: { by: "qs", at: "2026-01-01" } })],
      false,
    );

    expect(lines.filter((l) => l.kind === "item")).toHaveLength(1);
  });

  it("prints an unpriced item with no amount rather than dropping it", () => {
    const lines = billLines([row({ amount: null })], false);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: "item", amount: null });
  });
});
