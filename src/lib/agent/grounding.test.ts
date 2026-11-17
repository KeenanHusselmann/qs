/**
 * The grounding check is the one thing standing between a fluent invention and a cost model, so it
 * is tested on both sides: it must accept a real quote that a model has tidied, and reject one the
 * corpus does not contain.
 */

import { describe, expect, it } from "vitest";

import { locateQuote, normalise } from "./grounding";

const passage = (body: string, documentId = "doc-1", page: number | null = 4) => ({
  documentId,
  page,
  body,
});

const MARKET = passage(
  "6.9 PRICING\nThe achievable selling price for the two-bedroom\r\n  units is R749 000, against an\n" +
    "absorption of 71–136 units per annum over the first phase.",
);

describe("normalise", () => {
  it("maps every character back to where it came from", () => {
    const { text, origin } = normalise("  A  B\nC  ");
    expect(text).toBe("a b c");
    expect(origin).toHaveLength(text.length);

    // Never runs backwards. Not *strictly* increasing, because one source character can expand to
    // several — "…" becomes "...", and all three point at the ellipsis.
    for (let i = 1; i < origin.length; i++) {
      expect(origin[i]!).toBeGreaterThanOrEqual(origin[i - 1]!);
    }

    // The folded space stands for the run that produced it, not for the character after it.
    expect(origin).toEqual([2, 3, 5, 6, 7]);
  });

  it("expands one source character into several, all pointing back at it", () => {
    const { text, origin } = normalise("a…b");
    expect(text).toBe("a...b");
    expect(origin).toEqual([0, 1, 1, 1, 2]);
  });

  it("folds the punctuation a model silently retypes", () => {
    expect(normalise("“R749 000”").text).toBe('"r749 000"');
    expect(normalise("71–136").text).toBe("71-136");
  });

  it("drops invisible characters that survive PDF extraction", () => {
    expect(normalise("R749 000​").text).toBe("r749 000");
  });
});

describe("locateQuote", () => {
  it("finds a quote the model has reflowed and re-punctuated", () => {
    const found = locateQuote(
      "The achievable selling price for the two-bedroom units is R749 000",
      [MARKET],
    );

    expect(found).not.toBeNull();
    expect(found!.passage.documentId).toBe("doc-1");
  });

  it("returns the document's own characters, not the model's tidied ones", () => {
    const found = locateQuote("the two-bedroom units is R749 000", [MARKET]);

    // The line break and double space the PDF really had are preserved — this is the text a
    // reviewer will compare against the page they open.
    expect(found!.quote).toContain("two-bedroom\r\n  units");
  });

  it("rejects a quote the corpus does not contain, however plausible", () => {
    expect(
      locateQuote("The achievable selling price is R1 250 000 per unit", [MARKET]),
    ).toBeNull();
  });

  it("rejects a quote that changes a figure", () => {
    // One digit different. This is the failure the whole module exists to catch.
    expect(locateQuote("the two-bedroom units is R748 000", [MARKET])).toBeNull();
  });

  it("rejects a quote too short to be evidence of anything", () => {
    // Present in the passage, and proves nothing about where the figure came from.
    expect(locateQuote("units", [MARKET])).toBeNull();
  });

  it("attributes the quote to the passage it is actually in", () => {
    const other = passage("Zoning permits 60 units per hectare.", "doc-2", 11);
    const found = locateQuote("Zoning permits 60 units per hectare", [MARKET, other]);

    expect(found!.passage.documentId).toBe("doc-2");
    expect(found!.passage.page).toBe(11);
  });

  it("finds nothing when there are no passages", () => {
    expect(locateQuote("anything at all, at length", [])).toBeNull();
  });
});
