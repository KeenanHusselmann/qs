/**
 * The rules a bill is judged by — PLATFORM.md §1.3.1, §4.7, §5.2, §6.5.
 *
 * `checks/bill.mjs` drives the screen and the database. These are the derivations underneath it:
 * which cell wins, what may be signed, and what a total is a sum of. They are pure, so they are
 * tested here where a failure names the rule rather than a selector.
 *
 * The one thing deliberately **not** tested here is the extension. `amount` is written by a database
 * trigger, so asserting `extendRow` against `extend` in this file would be two names for one
 * function agreeing with itself. What matters is that the trigger and `extend()` agree, and that is
 * `checks/bill.mjs`, against a real Postgres.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  billTotal,
  blockingRows,
  pricedRows,
  sectionTotal,
  workingRow,
  type BillRow,
} from "./bill";
import { formatMoney, money } from "@/domain/money";

/** A row as the database hands it over, with only what a test cares about spelled out. */
const row = (over: Partial<BillRow> & { id: string }): BillRow => ({
  seq: 100,
  parentId: null,
  rowType: "item",
  itemRef: null,
  proposed: {
    description: null,
    unit: null,
    quantity: null,
    rate: null,
    quantityText: null,
    rateText: null,
    confidence: 0,
    note: null,
  },
  citation: null,
  override: null,
  quantitySource: "ai_derived",
  rateSource: "ai_derived",
  amount: null,
  output: null,
  omitted: null,
  ...over,
});

const proposed = (over: Partial<BillRow["proposed"]>): BillRow["proposed"] => ({
  description: "Strip footings",
  unit: "m3",
  quantity: "1250.0000",
  rate: { value: "185000", precision: 2 },
  quantityText: null,
  rateText: null,
  confidence: 0.9,
  note: null,
  ...over,
});

const overridden = (over: Partial<NonNullable<BillRow["override"]>>): BillRow["override"] => ({
  description: null,
  unit: null,
  quantity: null,
  rate: null,
  reason: null,
  by: "qs@example.com",
  at: new Date().toISOString(),
  ...over,
});

describe("working — human wins, cell by cell", () => {
  it("takes the agent's figure where nobody has corrected it", () => {
    const working = workingRow(row({ id: "a", proposed: proposed({}) }));
    expect(working.quantity).toBe("1250.0000");
    expect(working.rate?.value).toBe("185000");
  });

  /**
   * The whole reason `proposed` and `overrides` are two maps. A correction to one cell must not
   * disturb the other three: a QS who fixes a rate has not said anything about the quantity, and a
   * row that quietly dropped the agent's unit when its rate was corrected would be a row nobody
   * could review.
   */
  it("replaces only the cell that was corrected", () => {
    const working = workingRow(
      row({
        id: "a",
        proposed: proposed({}),
        override: overridden({ rate: { value: "190000", precision: 2 } }),
      }),
    );

    expect(working.rate?.value).toBe("190000");
    expect(working.quantity).toBe("1250.0000");
    expect(working.description).toBe("Strip footings");
    expect(working.unit).toBe("m3");
  });

  it("carries a hand-entered row that has no proposal at all", () => {
    const working = workingRow(
      row({ id: "a", override: overridden({ description: "Measured by hand", quantity: "12.0000" }) }),
    );

    expect(working.description).toBe("Measured by hand");
    expect(working.quantity).toBe("12.0000");
    expect(working.rate).toBeNull();
  });
});

describe("what may be signed", () => {
  it("refuses an item with no quantity, and names it", () => {
    const blocked = blockingRows([
      row({ id: "a", proposed: proposed({ quantity: null, description: "Surface beds" }) }),
    ]);

    expect(blocked.rows).toHaveLength(1);
    expect(blocked.rows[0].description).toBe("Surface beds");
    expect(blocked.rows[0].missing).toBe("a quantity");
  });

  it("says both when both are absent", () => {
    const blocked = blockingRows([
      row({ id: "a", proposed: proposed({ quantity: null, rate: null }) }),
    ]);
    expect(blocked.rows[0].missing).toBe("a quantity and a rate");
  });

  /** §4.7 — a heading is a grouping. Blocking on one would be asking for a measure of a word. */
  it("exempts headings and notes by construction", () => {
    const blocked = blockingRows([
      row({ id: "h", rowType: "heading", proposed: proposed({ quantity: null, rate: null }) }),
      row({ id: "n", rowType: "note", proposed: proposed({ quantity: null, rate: null }) }),
      row({ id: "i", proposed: proposed({}) }),
    ]);
    expect(blocked.rows).toEqual([]);
    expect(blocked.empty).toBe(false);
  });

  /** A struck row is not in the bill, so it cannot hold up a signature. */
  it("exempts a row that was struck out", () => {
    const blocked = blockingRows([
      row({
        id: "a",
        proposed: proposed({ quantity: null }),
        omitted: { by: "qs@example.com", at: new Date().toISOString() },
      }),
      row({ id: "b", proposed: proposed({}) }),
    ]);
    expect(blocked.rows).toEqual([]);
  });

  /**
   * Signing an empty bill would freeze an approved total of nought over a job nobody has measured,
   * which is worse than a step left unsigned — the figure is wrong and it looks agreed.
   */
  it("refuses a bill with no items in it", () => {
    expect(blockingRows([]).empty).toBe(true);
    expect(blockingRows([row({ id: "h", rowType: "heading" })]).empty).toBe(true);
  });

  it("is satisfied by a hand-entered row with both figures", () => {
    const blocked = blockingRows([
      row({
        id: "a",
        quantitySource: "manual",
        override: overridden({
          description: "Measured on site",
          quantity: "12.0000",
          rate: { value: "50000", precision: 2 },
        }),
      }),
    ]);
    expect(blocked.rows).toEqual([]);
    expect(blocked.empty).toBe(false);
  });
});

describe("totals — derived, and never re-rounded", () => {
  const bill = [
    row({ id: "h", rowType: "heading", parentId: null }),
    row({ id: "a", parentId: "h", amount: "231250000" }),
    row({ id: "b", parentId: "h", amount: "27000000" }),
    row({
      id: "c",
      parentId: "h",
      amount: "99900",
      omitted: { by: "qs@example.com", at: new Date().toISOString() },
    }),
  ];

  it("sums the live items and nothing else", () => {
    expect(formatMoney(billTotal(bill))).toBe(formatMoney(money(258_250_000n)));
  });

  it("leaves a struck row out of the total", () => {
    expect(pricedRows(bill).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("gives a section the sum of its own rows", () => {
    expect(sectionTotal(bill, "h")).toBe(258_250_000n);
  });

  /** A row with no amount contributes nothing, and is not treated as nought — the gate refuses it. */
  it("skips a row whose figures are not both there", () => {
    expect(billTotal([row({ id: "a", amount: null }), row({ id: "b", amount: "100" })])).toBe(100n);
  });

  /** A signed bill reads `output`, not `working`: the record of what was signed, not a rerun of it. */
  it("reads the frozen amount once the bill is signed", () => {
    const signed = [
      row({
        id: "a",
        amount: "999",
        output: { description: null, unit: null, quantity: null, rate: null, amount: "231250000" },
      }),
    ];
    expect(billTotal(signed, true)).toBe(231_250_000n);
    expect(billTotal(signed, false)).toBe(999n);
  });

  /**
   * §5.2's arithmetic rule, as a property: a total is the sum of already-rounded amounts, so it is
   * exactly what a QS gets adding the column by hand. Nothing here rounds, and the assertion is
   * against plain integer addition rather than against a second implementation of the same idea.
   */
  it("is exact addition, whatever the amounts are", () => {
    fc.assert(
      fc.property(
        fc.array(fc.bigInt({ min: -1_000_000_000n, max: 1_000_000_000n }), { maxLength: 60 }),
        (amounts) => {
          const rows = amounts.map((amount, i) => row({ id: `r${i}`, amount: amount.toString() }));
          const byHand = amounts.reduce((total, amount) => total + amount, 0n);
          return billTotal(rows) === byHand;
        },
      ),
    );
  });
});
