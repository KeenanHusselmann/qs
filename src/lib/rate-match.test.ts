/**
 * Pricing a bill from the library — PLATFORM.md §4.8, §5.4.
 *
 * This decides what a bill gets priced at, so it is asserted rather than eyeballed. The two that
 * matter most: a differing unit is never a candidate, and nothing already priced is ever offered
 * a replacement.
 */

import { describe, expect, it } from "vitest";

import {
  FLOOR,
  matchRates,
  sameItem,
  sameUnit,
  significantWords,
  similarity,
  specificationHolds,
  tallyMatches,
} from "./rate-match";
import type { LibraryRate } from "./rates";
import type { BillRow } from "./agent/bill";

const rate = (over: Partial<LibraryRate> = {}): LibraryRate => ({
  id: crypto.randomUUID(),
  trade: "Concrete Work",
  description: "25 MPa concrete in strip footings",
  unit: "m3",
  rate: 185_000n,
  ratePrecision: 2,
  region: "Gauteng",
  source: "SAFCEC Q4 2025",
  effectiveDate: "2024-01-01",
  createdBy: "qs@mzilikazi.co.za",
  ...over,
});

/** A bill item, priced or not. Only the fields the matcher reads are meaningful. */
const row = (over: Partial<BillRow> = {}): BillRow =>
  ({
    id: crypto.randomUUID(),
    parentId: null,
    rowType: "item",
    itemRef: "4.1.1",
    proposed: {
      description: "25 MPa concrete in strip footings",
      unit: "m3",
      quantity: "1245.0000",
      rate: null,
      confidence: 0.9,
      note: null,
      state: "found",
    },
    citation: null,
    override: null,
    quantitySource: "ai_derived",
    rateSource: "ai_derived",
    amount: null,
    output: null,
    omitted: null,
    ...over,
  }) as unknown as BillRow;

describe("the words a match is made on", () => {
  /**
   * The single most expensive mistake available here: dropping the digits makes "25 MPa" and
   * "30 MPa" the same item, and they are worded identically otherwise.
   */
  it("keeps the numbers, because they are what separates two items", () => {
    expect(significantWords("25 MPa concrete")).toContain("25");
    expect(similarity("25 MPa concrete in slabs", "30 MPa concrete in slabs")).toBeLessThan(1);
  });

  it("drops the words every second bill item contains", () => {
    expect(significantWords("Concrete in the strip footings")).toEqual([
      "concrete",
      "strip",
      "footing",
    ]);
  });

  it("reads a plural as its singular, and leaves \"class\" alone", () => {
    expect(significantWords("Excavate trenches for piers, class II")).toEqual(["excavate", "trench", "pier", "class", "ii"]);
  });

  it("takes m² and m2 as one unit", () => {
    expect(sameUnit("m²", "m2")).toBe(true);
    expect(sameUnit("m³", "m3")).toBe(true);
    expect(sameUnit("m²", "m3")).toBe(false);
  });

  /** A bill is more specific than a schedule on purpose; it must not be punished for it. */
  it("scores against the shorter description, not the union", () => {
    expect(
      similarity(
        "25 MPa concrete in strip footings, in trenches not exceeding 1,5m deep",
        "Concrete, 25 MPa, in strip footings",
      ),
    ).toBe(1);
  });

  it("is 0 where nothing significant is shared", () => {
    expect(similarity("Brick walling", "Structural steelwork")).toBe(0);
  });
});

describe("what the library offers a bill", () => {
  it("offers a rate for an unpriced item it can match", () => {
    const matches = matchRates([row()], [rate()]);

    expect(matches).toHaveLength(1);
    expect(matches[0]?.exact).toBe(true);
    expect(matches[0]?.rate.rate).toBe(185_000n);
  });

  /**
   * The assertion this function exists to get right. A rate per m² against a quantity in m³
   * extends to a figure wrong by a factor nobody can see on the page.
   */
  it("never offers a rate whose unit differs", () => {
    expect(matchRates([row()], [rate({ unit: "m2" })])).toEqual([]);
  });

  /** A QS's own figure is not a candidate for replacement. This offers work; it does not audit. */
  it("leaves a row that already has a rate alone", () => {
    const priced = row({
      override: { description: null, unit: null, quantity: null, rate: { value: "200000", precision: 2 } },
    } as Partial<BillRow>);

    expect(matchRates([priced], [rate()])).toEqual([]);
  });

  it("ignores headings, notes and struck-out rows", () => {
    expect(matchRates([row({ rowType: "heading" })], [rate()])).toEqual([]);
    expect(matchRates([row({ omitted: { by: "qs", at: "2026-01-01" } })], [rate()])).toEqual([]);
  });

  it("says nothing where the description shares too little", () => {
    expect(matchRates([row()], [rate({ description: "Structural steelwork in columns" })])).toEqual([]);
  });

  /** "Concrete in slabs" against "Concrete in footings" is the case FLOOR exists to exclude. */
  it("excludes a match that shares only the trade word", () => {
    expect(similarity("Concrete in footings", "Concrete in slabs")).toBeLessThan(FLOOR);
  });

  describe("regions", () => {
    it("prices from the region asked for", () => {
      const matches = matchRates([row()], [rate({ region: "Gauteng", rate: 185_000n })], {
        region: "Gauteng",
      });
      expect(matches[0]?.rate.rate).toBe(185_000n);
    });

    it("refuses a rate stated for a different province", () => {
      expect(
        matchRates([row()], [rate({ region: "Western Cape" })], { region: "Gauteng" }),
      ).toEqual([]);
    });

    /** A rate stating no region is national, and eligible wherever the job is. */
    it("accepts a rate that states no region at all", () => {
      const matches = matchRates([row()], [rate({ region: null })], { region: "Gauteng" });
      expect(matches).toHaveLength(1);
    });
  });

  /**
   * Priced as at a date, not as at "now". A bill re-priced next quarter should move because the
   * rates moved — not because the function was run again.
   */
  it("prices from the rates in force on the date given", () => {
    const library = [
      rate({ id: "old", rate: 170_000n, effectiveDate: "2023-01-01" }),
      rate({ id: "new", rate: 185_000n, effectiveDate: "2025-01-01" }),
    ];

    expect(matchRates([row()], library, { asAt: "2024-06-01" })[0]?.rate.rate).toBe(170_000n);
    expect(matchRates([row()], library, { asAt: "2025-06-01" })[0]?.rate.rate).toBe(185_000n);
  });

  /**
   * The gate in front of the score, and the ASAQS failure in miniature: four of five words agree
   * between a 30 MPa rate and a 25 MPa item, which scores 0,8 and would have been offered as a
   * good match. A plausible figure for the wrong thing is the thing this platform must not do.
   */
  it("never offers a rate whose stated specification differs", () => {
    expect(matchRates([row()], [rate({ description: "30 MPa concrete in strip footings" })])).toEqual([]);
    expect(specificationHolds("25 MPa concrete in strip footings", "30 MPa concrete in strip footings")).toBe(false);
  });

  /** A bill is more specific than a schedule; extra numbers of its own must not disqualify it. */
  it("allows the bill to carry numbers the library entry does not", () => {
    expect(
      specificationHolds(
        "25 MPa concrete in strip footings, in trenches not exceeding 1,5m deep",
        "Concrete, 25 MPa, in strip footings",
      ),
    ).toBe(true);
  });

  /**
   * A generic entry is a plausible rate, not a certain one — and only certainties are offered in
   * bulk. `score === 1` is not the same question as "the same item", which is the distinction that
   * made a generic entry beat a specific one when they tied.
   */
  it("offers a less specific entry, but never as exact", () => {
    const matches = matchRates([row()], [rate({ description: "Concrete in strip footings" })]);

    expect(matches).toHaveLength(1);
    expect(matches[0]?.score).toBe(1);
    expect(matches[0]?.exact).toBe(false);
    expect(sameItem("25 MPa concrete in strip footings", "Concrete in strip footings")).toBe(false);
  });

  it("takes the better match where two could serve", () => {
    const library = [
      rate({ id: "loose", description: "Concrete in strip footings" }),
      rate({ id: "exact", description: "25 MPa concrete in strip footings" }),
    ];

    expect(matchRates([row()], library)[0]?.rate.id).toBe("exact");
  });
});

describe("what the offer comes to", () => {
  it("counts what can be priced, what is certain, and what is left", () => {
    const rows = [
      row({ id: "a" }),
      row({ id: "b", proposed: { ...row().proposed, description: "Face brick walling" , unit: "m2" } } as Partial<BillRow>),
    ];
    const matches = matchRates(rows, [rate()]);

    expect(tallyMatches(rows, matches)).toEqual({ offered: 1, exact: 1, unmatched: 1 });
  });

  /** The unmatched count is what a build-up would answer, so it must not quietly include priced rows. */
  it("does not count an already-priced row as unmatched", () => {
    const priced = row({
      override: { description: null, unit: null, quantity: null, rate: { value: "200000", precision: 2 } },
    } as Partial<BillRow>);

    expect(tallyMatches([priced], [])).toEqual({ offered: 0, exact: 0, unmatched: 0 });
  });
});
