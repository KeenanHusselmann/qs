/**
 * The programme's arithmetic, worked by hand.
 *
 * The property that matters most is the one a cost report depends on: however the contract sum is
 * shared and phased, **the months sum to the contract sum exactly**. §5.2 allows one rounding
 * point, and the remainder-carrying in `shareValues` and `phaseByMonth` is where it is.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { money, sum } from "./money";
import {
  durationDays,
  overallPercent,
  phaseByMonth,
  plannedPercent,
  shareValues,
  slippageDays,
  span,
  type Activity,
  type Progress,
} from "./programme";

const activity = (id: string, start: string, finish: string, value: bigint | null = null, milestone = false): Activity => ({
  id,
  name: id,
  start,
  finish,
  milestone,
  value: value === null ? null : money(value),
});

describe("durations and the span", () => {
  it("counts calendar days inclusively, and a milestone as one", () => {
    expect(durationDays(activity("a", "2026-08-01", "2026-08-31"))).toBe(31);
    expect(durationDays(activity("m", "2026-08-12", "2026-08-12", null, true))).toBe(1);
  });

  it("spans the earliest start to the latest finish", () => {
    expect(span([activity("a", "2026-08-10", "2026-09-05"), activity("b", "2026-08-01", "2026-08-20")])).toEqual({
      start: "2026-08-01",
      finish: "2026-09-05",
    });
    expect(span([])).toBeNull();
  });
});

describe("baseline against current", () => {
  const a = activity("a", "2026-08-01", "2026-08-31");

  it("reports slippage as days the current finish is later than the baseline", () => {
    const late: Progress = { activityId: "a", asAt: "2026-08-20", start: null, finish: "2026-09-14", percent: 40 };
    expect(slippageDays(a, late)).toBe(14);
    expect(slippageDays(a, null)).toBe(0);
    const early: Progress = { ...late, finish: "2026-08-28" };
    expect(slippageDays(a, early)).toBe(-3);
  });

  it("says where an activity should stand on the baseline as at a date", () => {
    expect(plannedPercent(a, "2026-07-31")).toBe(0);
    expect(plannedPercent(a, "2026-08-16")).toBe(52); // 16 of 31 days
    expect(plannedPercent(a, "2026-08-31")).toBe(100);
    expect(plannedPercent(a, "2026-12-01")).toBe(100);
  });
});

describe("sharing the contract sum", () => {
  it("keeps given values and shares the remainder by duration, to the cent", () => {
    const { values, over } = shareValues(
      [
        activity("a", "2026-08-01", "2026-08-10", 100_000n), // given: R 1 000,00
        activity("b", "2026-08-11", "2026-08-20"), // 10 days
        activity("c", "2026-08-21", "2026-09-19"), // 30 days
        activity("m", "2026-09-19", "2026-09-19", null, true),
      ],
      money(500_001n),
    );
    expect(values.get("a")).toBe(100_000n);
    // 400 001 left, over 40 days: b gets 10/40, c the rest with the remainder.
    expect(values.get("b")).toBe(100_000n);
    expect(values.get("c")).toBe(300_001n);
    expect(values.get("m")).toBe(0n);
    expect(over).toBe(0n);
    expect(sum([...values.values()])).toBe(500_001n);
  });

  it("says when the given values exceed the contract sum rather than absorbing it", () => {
    const { values, over } = shareValues(
      [activity("a", "2026-08-01", "2026-08-10", 600_000n), activity("b", "2026-08-11", "2026-08-20")],
      money(500_000n),
    );
    expect(values.get("b")).toBe(0n);
    expect(over).toBe(100_000n);
  });
});

describe("phasing over months", () => {
  it("spreads an activity evenly over its days and assigns each day to its month", () => {
    // 1 Aug – 30 Sep: 61 days, R 610,00 → R 10,00 a day: 31 days in August, 30 in September.
    const phased = phaseByMonth([{ id: "a", start: "2026-08-01", finish: "2026-09-30", value: money(61_000n) }]);
    expect(phased.map((m) => [m.month, m.amount])).toEqual([
      ["2026-08-01", 31_000n],
      ["2026-09-01", 30_000n],
    ]);
    expect(phased.at(-1)?.cumulative).toBe(61_000n);
  });

  it("carries the remainder to the activity's last month", () => {
    // 3 days over a month end, R 1,00: 33 cents a day, 34 on the last.
    const phased = phaseByMonth([{ id: "a", start: "2026-08-31", finish: "2026-09-02", value: money(100n) }]);
    expect(phased.map((m) => m.amount)).toEqual([33n, 67n]);
  });

  it("sums to the contract sum whatever the programme looks like", () => {
    const day = fc.integer({ min: 0, max: 700 });
    fc.assert(
      fc.property(
        fc.array(fc.tuple(day, fc.integer({ min: 0, max: 200 }), fc.bigInt({ min: 0n, max: 10n ** 12n })), { minLength: 1, maxLength: 12 }),
        (rows) => {
          const base = Date.UTC(2026, 0, 1);
          const iso = (d: number) => new Date(base + d * 86_400_000).toISOString().slice(0, 10);
          const activities = rows.map(([from, length, value], i) => ({ id: `a${i}`, start: iso(from), finish: iso(from + length), value: money(value) }));
          const phased = phaseByMonth(activities);
          expect(sum(phased.map((m) => m.amount))).toBe(sum(activities.map((a) => a.value)));
          // Months come out in order, and cumulative is a running total.
          for (let i = 1; i < phased.length; i++) {
            expect(phased[i].month > phased[i - 1].month).toBe(true);
            expect(phased[i].cumulative).toBe(phased[i - 1].cumulative + phased[i].amount);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("overall progress", () => {
  const a = activity("a", "2026-08-01", "2026-08-10");
  const b = activity("b", "2026-08-11", "2026-09-09");
  const progress = new Map<string, Progress>([
    ["a", { activityId: "a", asAt: "2026-08-20", start: null, finish: null, percent: 100 }],
    ["b", { activityId: "b", asAt: "2026-08-20", start: null, finish: null, percent: 50 }],
  ]);
  const of = (id: string) => progress.get(id) ?? null;

  it("weights by value where there is value", () => {
    const values = new Map([["a", money(100n)], ["b", money(300n)]]);
    expect(overallPercent([a, b], of, values)).toBe(63); // (100 + 150) / 400
  });

  it("weights by duration where nothing carries value", () => {
    expect(overallPercent([a, b], of, new Map())).toBe(63); // (10×100 + 30×50) / 40 = 62.5
  });

  it("is null with nothing to weigh", () => {
    expect(overallPercent([], of, new Map())).toBeNull();
  });
});
