/**
 * The printed bill — PLATFORM.md §7.6, §5.4.
 *
 * The pagination arithmetic is asserted in `bill-pages.test.ts` without a PDF. What is asserted
 * here is the thing that broke: **the rendered pages and the planned pages have to be the same
 * pages.** `row()` breaks a page by itself when it runs out of room, so a capacity larger than the
 * truth produces a physical page the pagination never planned — one with no brought-forward at its
 * head and no carried-forward at its foot. The totals still reconcile and the document cannot be
 * added up by hand, which is the only thing the convention is for.
 *
 * That is not visible in a unit test over pure functions and it is not visible in a screenshot of
 * page one. It is visible here.
 */

import { describe, expect, it } from "vitest";
import { extractText, getDocumentProxy } from "unpdf";

import { billPdf } from "./bill-pdf";
import type { BillRow } from "@/lib/agent/bill";

const subject = {
  practice: "Mzilikazi Quantity Surveyors",
  projectName: "Ridgeview Gardens",
  code: "RVG-001",
  title: "Bill of Quantities",
  signedBy: null,
  signedAt: null,
};

const heading = (id: string, label: string): BillRow =>
  ({
    id,
    seq: 0,
    parentId: null,
    rowType: "heading",
    itemRef: null,
    proposed: { description: label, unit: null, quantity: null, rate: null, confidence: 1, note: null, state: "found", quantityText: null, rateText: null },
    citation: null,
    override: null,
    quantitySource: "manual",
    rateSource: "manual",
    amount: null,
    output: null,
    omitted: null,
  }) as unknown as BillRow;

const item = (n: number, parentId: string, amount: string | null): BillRow =>
  ({
    id: `item-${n}`,
    seq: n,
    parentId,
    rowType: "item",
    itemRef: `1.${n}`,
    proposed: {
      description: `Item number ${n}, described at the length a bill item is usually described at`,
      unit: "m2",
      quantity: "10.0000",
      rate: null,
      confidence: 1,
      note: null,
      state: "found",
      quantityText: null,
      rateText: null,
    },
    citation: null,
    override: null,
    quantitySource: "manual",
    rateSource: "manual",
    amount,
    output: null,
    omitted: null,
  }) as unknown as BillRow;

/** Enough items to run to several pages. */
const longBill = (count: number): BillRow[] => {
  const rows: BillRow[] = [heading("s1", "Concrete work")];
  for (let n = 1; n <= count; n++) rows.push(item(n, "s1", "100000"));
  return rows;
};

const pagesOf = async (pdf: Buffer): Promise<string[]> => {
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const { text } = await extractText(doc, { mergePages: false });
  return (Array.isArray(text) ? text : [text]).map((t) => String(t).replace(/\s+/g, " "));
};

describe("a printed bill", () => {
  it("ends with a collection that totals the sections", async () => {
    const pages = await pagesOf(billPdf(longBill(4), subject, false));
    const collection = pages.at(-1)!;

    expect(collection).toContain("Collection");
    // 4 items at R1 000,00 each.
    expect(collection).toMatch(/Total\s+4 000,00/);
  });

  /**
   * The regression this file exists for. Every page but the last bill page carries forward, and
   * every page after the first brings the same figure in. A physical page that the pagination did
   * not plan has neither, and that is exactly how it failed.
   */
  it("carries forward on every page, and brings in what was carried", async () => {
    const pages = await pagesOf(billPdf(longBill(90), subject, false));

    // The last page is the collection; the ones before it are bill pages.
    const bill = pages.slice(0, -1);
    expect(bill.length).toBeGreaterThan(2);

    /* Literal patterns, non-greedy, ending on the cents.
       A greedy class swallows the next item's reference — it captured "21 000,00 1", where the 1
       opens "1.34" — and the assertion then fails on a document that is correct. Money groups with
       U+00A0 here (§7.7), which `\s` covers. */
    // R sits between the words and the figure, in its own column, as a bill prints it.
    const carried = bill.map((p) => /Carried forward R ?([\d\s,]+?,\d{2})/.exec(p)?.[1]?.trim() ?? null);
    const brought = bill.map((p) => /Brought forward R ?([\d\s,]+?,\d{2})/.exec(p)?.[1]?.trim() ?? null);

    // Page one brings nothing in; every later page brings in the page before's carried figure.
    expect(brought[0]).toBeNull();
    for (let i = 1; i < bill.length; i++) {
      expect(brought[i], `page ${i + 1} brought forward`).toBe(carried[i - 1]);
    }

    // Every page but the last bill page carries forward.
    for (let i = 0; i < bill.length - 1; i++) {
      expect(carried[i], `page ${i + 1} carried forward`).not.toBeNull();
    }
  });

  it("repeats the column headings on every page", async () => {
    const pages = await pagesOf(billPdf(longBill(90), subject, false));
    for (const [i, page] of pages.slice(0, -1).entries()) {
      expect(page, `page ${i + 1}`).toContain("Description");
    }
  });

  it("numbers every page of the whole document", async () => {
    const pages = await pagesOf(billPdf(longBill(40), subject, false));
    pages.forEach((page, i) => {
      expect(page).toContain(`Page ${i + 1} of ${pages.length}`);
    });
  });

  /** §1.3 — a gap is stated. A total short of unpriced work must say so on the page it is on. */
  it("says an unpriced item is excluded rather than totalling it as nought", async () => {
    const rows = [heading("s1", "Concrete work"), item(1, "s1", "100000"), item(2, "s1", null)];
    const pages = await pagesOf(billPdf(rows, subject, false));

    // On the row itself, where the reader already is - and counted once per page, which is what
    // tells them whether the page is nearly complete or barely started.
    expect(pages[0]).toMatch(/Not Priced/);
    expect(pages[0]).toMatch(/1 item on this page is marked Not Priced/);
    expect(pages.at(-1)).toMatch(/not priced and .* excluded from this total/);
    // And the total is of what was priced — R1 000,00, not R1 000,00 plus a nought.
    expect(pages.at(-1)).toMatch(/Total\s+1 000,00/);
  });

  /** A draft loose in an inbox is how one gets tendered against. */
  it("marks a draft on every page and on the collection", async () => {
    const pages = await pagesOf(billPdf(longBill(3), subject, false));
    for (const page of pages) expect(page).toContain("DRAFT");
  });

  /**
   * September review §7: the draft line went out reading "nothing downstream reads them" – this
   * app's pipeline, described to a reader who has never seen it – and the practice sends nothing
   * with an em dash in it. (The writer turns an em dash into "-", so the absence of both is checked.)
   */
  it("words the draft notice for the reader, with en dashes", async () => {
    const pages = await pagesOf(billPdf(longBill(3), subject, false));
    const all = pages.join("\n");

    expect(pages.at(-1)).toMatch(/DRAFT – this bill has not been signed off\..*not to be priced or tendered against/s);
    expect(all).not.toMatch(/nothing downstream/i);
    expect(all).not.toContain("—");
    expect(all).not.toMatch(/ - DRAFT|DRAFT - /);
    expect(all).toContain("Concrete work – section total");
    for (const page of pages) expect(page).toMatch(/–\s+DRAFT\s+–\s+Page \d+ of \d+/);
  });

  it("names the signer instead, once it is signed off", async () => {
    const pages = await pagesOf(
      billPdf(longBill(3), { ...subject, signedBy: "qs@mzilikazi.co.za", signedAt: "2026-09-03" }, false),
    );

    expect(pages.at(-1)).toContain("Signed off by qs@mzilikazi.co.za");
    for (const page of pages) expect(page).not.toContain("DRAFT");
  });
});
