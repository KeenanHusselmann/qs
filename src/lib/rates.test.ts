/**
 * The rate library's rules — PLATFORM.md §5.1, §5.4, §6.3.
 *
 * Two of these decide what a bill gets priced at, so they are asserted rather than eyeballed: which
 * row is in force on a date, and what a typed rate becomes in minor units. A wrong answer from
 * either is a wrong figure in a document somebody signs, and it would look entirely normal.
 */

import { describe, expect, it } from "vitest";

import {
  escalation,
  historyOf,
  itemKey,
  parseRate,
  problemsWith,
  ratesInForce,
  type LibraryRate,
} from "./rates";

const row = (over: Partial<LibraryRate> = {}): LibraryRate => ({
  id: crypto.randomUUID(),
  trade: "Concrete Work",
  description: "25 MPa concrete in strip footings",
  unit: "m³",
  rate: 185_000n,
  ratePrecision: 2,
  region: "Gauteng",
  source: "SAFCEC Q4 2023",
  effectiveDate: "2024-01-01",
  createdBy: "qs@mzilikazi.co.za",
  ...over,
});

describe("what counts as the same item", () => {
  it("is the description, the unit and the region together", () => {
    expect(itemKey(row())).toBe(itemKey(row({ id: "other" })));
  });

  /** The same words priced per m³ and per m² are two items, and one of them is a mistake. */
  it("separates the same description in a different unit", () => {
    expect(itemKey(row())).not.toBe(itemKey(row({ unit: "m²" })));
  });

  it("separates the same item in a different region", () => {
    expect(itemKey(row())).not.toBe(itemKey(row({ region: "Western Cape" })));
  });

  /**
   * The trade is a dimension a rate may not carry (§6.9). Folding it into identity would make
   * classifying an existing rate look like a new item and quietly double it in the library.
   */
  it("ignores the trade, so classifying a rate does not duplicate it", () => {
    expect(itemKey(row({ trade: null }))).toBe(itemKey(row({ trade: "Concrete Work" })));
  });

  it("is not fooled by case or surrounding space", () => {
    expect(itemKey(row({ description: "  25 MPa Concrete In Strip Footings " }))).toBe(
      itemKey(row()),
    );
  });
});

describe("which rate is in force", () => {
  it("takes the newest row on or before the date", () => {
    const rows = [
      row({ id: "old", rate: 170_000n, effectiveDate: "2023-01-01" }),
      row({ id: "current", rate: 185_000n, effectiveDate: "2024-01-01" }),
    ];

    const [inForce] = ratesInForce(rows, "2024-06-01");
    expect(inForce?.id).toBe("current");
  });

  /**
   * The assertion this function exists for. Loading next quarter's guide in advance is a thing a
   * practice should be able to do; a bill priced today must not silently pick it up.
   */
  it("refuses a rate that has not taken effect yet", () => {
    const rows = [
      row({ id: "current", rate: 185_000n, effectiveDate: "2024-01-01" }),
      row({ id: "future", rate: 205_000n, effectiveDate: "2025-01-01" }),
    ];

    const [inForce] = ratesInForce(rows, "2024-06-01");
    expect(inForce?.id).toBe("current");
    expect(inForce?.rate).toBe(185_000n);
  });

  it("returns one row per item, not one per price", () => {
    const rows = [
      row({ effectiveDate: "2023-01-01" }),
      row({ effectiveDate: "2024-01-01" }),
      row({ description: "Common brick walling 220mm thick", unit: "m²", effectiveDate: "2024-01-01" }),
    ];

    expect(ratesInForce(rows, "2024-06-01")).toHaveLength(2);
  });

  it("prices the same item in two regions separately", () => {
    const rows = [
      row({ region: "Gauteng", rate: 185_000n }),
      row({ region: "Western Cape", rate: 192_000n }),
    ];

    const inForce = ratesInForce(rows, "2024-06-01");
    expect(inForce).toHaveLength(2);
    expect(inForce.map((r) => r.rate).sort()).toEqual([185_000n, 192_000n]);
  });

  it("has nothing in force before the first price applies", () => {
    expect(ratesInForce([row({ effectiveDate: "2024-01-01" })], "2023-06-01")).toEqual([]);
  });
});

describe("the history behind a rate", () => {
  it("lists every price for that item, newest first", () => {
    const rows = [
      row({ id: "a", effectiveDate: "2023-01-01" }),
      row({ id: "c", effectiveDate: "2025-01-01" }),
      row({ id: "b", effectiveDate: "2024-01-01" }),
      row({ id: "elsewhere", region: "Limpopo" }),
    ];

    expect(historyOf(rows, row()).map((r) => r.id)).toEqual(["c", "b", "a"]);
  });
});

describe("reading a typed rate", () => {
  /** A rate typed as whole rands is still held in cents, or a bill of cents would misprint it. */
  it("holds whole rands at cents", () => {
    expect(parseRate("1850")).toEqual({ value: 185_000n, precision: 2 });
  });

  it("reads the comma decimal a South African QS types (§7.7)", () => {
    expect(parseRate("1850,25")).toEqual({ value: 185_025n, precision: 2 });
  });

  /**
   * §5.1 — the scale travels with the value. Somebody typing four places for conduit per metre is
   * saying something about how the figure was derived, and rounding it to cents on the way in
   * loses that before it is ever used.
   */
  it("keeps a finer precision rather than rounding it to cents", () => {
    expect(parseRate("32,5000")).toEqual({ value: 325_000n, precision: 4 });
  });

  it("accepts the grouping and the symbol as they appear on screen", () => {
    expect(parseRate("R 1 850,25")).toEqual({ value: 185_025n, precision: 2 });
    // U+00A0, which is what §7.7 groups with and what a copy-paste from this app carries.
    expect(parseRate("R 1 850,25")).toEqual({ value: 185_025n, precision: 2 });
  });

  it("refuses anything it would have to guess at", () => {
    for (const bad of ["", "abc", "1,2,3", "-450", "1.850,25", "1e5"]) {
      expect(parseRate(bad), bad).toBeNull();
    }
  });
});

describe("what a rate must have before it is filed", () => {
  const draft = {
    description: "25 MPa concrete in strip footings",
    unit: "m³",
    rate: "1850",
    source: "SAFCEC Q4 2023",
    effectiveDate: "2024-01-01",
  };

  it("accepts a complete one", () => {
    expect(problemsWith(draft)).toEqual([]);
  });

  /** §6.3 — the column that makes the library defensible. A rate nobody can attribute is not one. */
  it("refuses a rate with no stated source", () => {
    expect(problemsWith({ ...draft, source: "  " })).toEqual([
      "Name where the rate came from — a published guide, a quote, or a survey.",
    ]);
  });

  it("refuses a rate it cannot read as a number", () => {
    expect(problemsWith({ ...draft, rate: "about 1850" })).toEqual([
      "Enter the rate as a number — 1 850, or 1 850,25.",
    ]);
  });

  /** §7.7 — a refusal says what to do next, so none of these is a field name and "invalid". */
  it("says what to do rather than what is wrong", () => {
    for (const problem of problemsWith({ description: "", unit: "", rate: "", source: "", effectiveDate: "" })) {
      expect(problem).toMatch(/[.]$/);
      expect(problem).not.toMatch(/invalid|required field/i);
    }
  });
});

describe("escalation across the library", () => {
  /**
   * A library loaded once has no escalation to report. Printing 0% would say prices held steady,
   * which is a measurement nobody has taken.
   */
  it("is null when nothing has been priced twice", () => {
    expect(escalation([row(), row({ description: "Something else" })])).toBeNull();
  });

  /**
   * The regression this function was rewritten for.
   *
   * The first version chose the earlier price with a cutoff measured from **today**, so on a
   * library whose prices are all more than a year old every item selected itself as its own
   * predecessor and the tile read "Not measurable yet" over data that plainly moved. Seen on
   * screen, not in a test — which is why this one exists.
   */
  it("measures movement in prices that are all long past", () => {
    const rows = [
      row({ id: "a1", rate: 170_000n, effectiveDate: "2023-01-01" }),
      row({ id: "a2", rate: 185_000n, effectiveDate: "2024-01-01" }),
    ];

    expect(escalation(rows)).toBeCloseTo(8.82, 1);
  });

  /** Escalation is quoted per annum in this trade, so a six-month move is annualised. */
  it("annualises a movement measured over less than a year", () => {
    const rows = [
      row({ id: "b1", rate: 100_000n, effectiveDate: "2024-01-01" }),
      row({ id: "b2", rate: 110_000n, effectiveDate: "2024-12-31" }),
    ];

    // 10% over 365 days is 10% a year.
    expect(escalation(rows)).toBeCloseTo(10, 1);
  });

  /**
   * A 2% move over three weeks annualises to something absurd. That is arithmetic, not a fact
   * about a rate library, so a span that short is not counted at all.
   */
  it("ignores a span too short to annualise", () => {
    const rows = [
      row({ id: "c1", rate: 100_000n, effectiveDate: "2024-01-01" }),
      row({ id: "c2", rate: 102_000n, effectiveDate: "2024-01-21" }),
    ];

    expect(escalation(rows)).toBeNull();
  });

  /** Two rates held at different precisions must not produce a nonsense ratio. */
  it("compares across precisions on the same scale", () => {
    const rows = [
      row({ id: "d1", rate: 100_000n, ratePrecision: 2, effectiveDate: "2024-01-01" }),
      row({ id: "d2", rate: 11_000_000n, ratePrecision: 4, effectiveDate: "2024-12-31" }),
    ];

    // R1 000,00 -> R1 100,0000 is 10%, not 10 900%.
    expect(escalation(rows)).toBeCloseTo(10, 1);
  });
});
