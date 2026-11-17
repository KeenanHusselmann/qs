/**
 * The tender comparison — §1.4 (D1.3), §5.2, §6.5.
 *
 * What is worth asserting here is not that addition works. It is the two judgements the comparison
 * makes on a QS's behalf, both of which change who is recommended for an award:
 *
 *   · the **arithmetic correction** — the sum on the form against the sum the rates produce;
 *   · **who counts as lowest** — by extended total, and only among tenders that priced everything.
 *
 * Both were chosen rather than fallen into, and a future change to either should have to come and
 * delete a test that says why.
 */

import { describe, expect, it } from "vitest";

import { money } from "@/domain/money";
import { compareTenders, type TenderReturn } from "@/lib/agent/tender";

const ITEMS = ["a", "b", "c"];
const BILL = money(300_00n);

/** A return that priced every item, at `each` per item, claiming `stated`. */
const priced = (
  id: string,
  each: bigint,
  stated: bigint | null,
  only: readonly string[] = ITEMS,
): TenderReturn => ({
  id,
  tenderer: id,
  statedSum: stated === null ? null : String(stated),
  receivedAt: null,
  prices: only.map((itemId) => ({
    itemId,
    rate: { value: String(each), precision: 2 },
    amount: String(each),
  })),
});

describe("what each tender comes to", () => {
  it("sums the rows a tenderer priced", () => {
    const { columns } = compareTenders([priced("t1", 100_00n, null)], ITEMS, BILL);
    expect(columns[0].extended).toBe(money(300_00n));
  });

  it("reads a tender against the bill, so over and under are visible", () => {
    const { columns } = compareTenders(
      [priced("over", 110_00n, null), priced("under", 90_00n, null)],
      ITEMS,
      BILL,
    );
    expect(columns[0].againstBill).toBe(money(30_00n));
    expect(columns[1].againstBill).toBe(money(-30_00n));
  });

  /** An item nobody priced is not an item priced at nought — the bill's own distinction. */
  it("counts what a tenderer left unpriced", () => {
    const { columns } = compareTenders([priced("part", 100_00n, null, ["a", "b"])], ITEMS, BILL);
    expect(columns[0].unpriced).toBe(1);
    expect(columns[0].extended).toBe(money(200_00n));
  });
});

/**
 * The reason this module exists. A contractor writes a sum on the front of a tender; their own
 * rates against our quantities produce another. Reconciling the two is a named QS task, and it is
 * arithmetic no summary of a tender can carry.
 */
describe("the arithmetic correction", () => {
  it("shows where a stated sum does not match the rates", () => {
    // Priced at 300,00 across three items; the form says 295,00.
    const { columns } = compareTenders([priced("t1", 100_00n, 295_00n)], ITEMS, BILL);
    expect(columns[0].stated).toBe(money(295_00n));
    expect(columns[0].difference).toBe(money(5_00n));
  });

  it("and is signed, so an overstatement and an understatement read differently", () => {
    const { columns } = compareTenders([priced("t1", 100_00n, 305_00n)], ITEMS, BILL);
    expect(columns[0].difference).toBe(money(-5_00n));
  });

  it("is nothing rather than nought where no sum was stated", () => {
    const { columns } = compareTenders([priced("t1", 100_00n, null)], ITEMS, BILL);
    expect(columns[0].difference).toBeNull();
  });

  it("is exactly nought where the tenderer's own arithmetic is right", () => {
    const { columns } = compareTenders([priced("t1", 100_00n, 300_00n)], ITEMS, BILL);
    expect(columns[0].difference).toBe(money(0n));
  });
});

describe("which tender is lowest", () => {
  it("is the lowest extended total", () => {
    const { lowest } = compareTenders(
      [priced("dear", 120_00n, null), priced("cheap", 90_00n, null)],
      ITEMS,
      BILL,
    );
    expect(lowest).toBe("cheap");
  });

  /**
   * By what the rates produce, not by what the form claims. Awarding on an unchecked figure is the
   * mistake the arithmetic column exists to prevent, so ranking on it would be perverse.
   */
  it("ignores a stated sum that flatters the tender", () => {
    const { lowest } = compareTenders(
      [
        priced("honest", 90_00n, 270_00n), // extends to 270,00
        priced("flatterer", 120_00n, 100_00n), // claims 100,00, extends to 360,00
      ],
      ITEMS,
      BILL,
    );
    expect(lowest).toBe("honest");
  });

  /**
   * The one that would embarrass somebody in a meeting: a tenderer who priced two of three items
   * is always cheapest and never cheapest. An incomplete tender is unfinished, not low.
   */
  it("does not crown a tender that left items unpriced", () => {
    const { lowest, columns } = compareTenders(
      [priced("complete", 100_00n, null), priced("partial", 10_00n, null, ["a"])],
      ITEMS,
      BILL,
    );
    expect(columns[1].extended).toBe(money(10_00n));
    expect(lowest).toBe("complete");
  });

  it("names nobody while every tender is still incomplete", () => {
    const { lowest } = compareTenders([priced("partial", 10_00n, null, ["a"])], ITEMS, BILL);
    expect(lowest).toBeNull();
  });

  it("and nobody at all before any tender is in", () => {
    expect(compareTenders([], ITEMS, BILL).lowest).toBeNull();
  });
});

/**
 * A price against a row that is not in this bill does not count.
 *
 * It is reachable: a tender is invited on one issue of the bill and the bill can be revised, so a
 * price can outlive the row it was quoted against. Counting it would put a figure in a total whose
 * quantity is no longer in the schedule.
 */
describe("prices for rows that are not in the bill", () => {
  it("are left out of the total", () => {
    const stale: TenderReturn = {
      ...priced("t1", 100_00n, null),
      prices: [
        { itemId: "a", rate: { value: "10000", precision: 2 }, amount: "10000" },
        { itemId: "gone", rate: { value: "99999", precision: 2 }, amount: "99999" },
      ],
    };
    expect(compareTenders([stale], ITEMS, BILL).columns[0].extended).toBe(money(100_00n));
  });
});
