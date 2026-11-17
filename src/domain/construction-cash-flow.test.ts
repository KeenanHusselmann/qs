/**
 * The construction cash flow, worked by hand: three lines from three signed facts, each summing
 * exactly to what it is a phasing of.
 */

import { describe, expect, it } from "vitest";

import { constructionCashFlow, expectedFinish } from "./construction-cash-flow";
import { money, sum } from "./money";
import type { Activity, Progress } from "./programme";

const R = (rand: number) => money(BigInt(rand) * 100n);

const activities: Activity[] = [
  { id: "a", name: "Earthworks", start: "2026-09-01", finish: "2026-09-30", milestone: false, value: R(300_000) },
  { id: "b", name: "Structure", start: "2026-10-01", finish: "2026-11-30", milestone: false, value: null },
  { id: "c", name: "Finishes", start: "2026-12-01", finish: "2026-12-31", milestone: false, value: null },
];
const none = () => null;

describe("the forecast from a signed programme", () => {
  const flow = constructionCashFlow({ contractSum: R(1_200_000), activities, progressOf: none, certificates: [] })!;

  it("phases the contract sum over the baseline, to the cent", () => {
    expect(flow.basis).toBe("programme");
    // b and c share the remaining R 900 000 by duration, 61 days to 31: b = 59 673 913 cents (integer
    // division), c the remainder. b then spreads over its 61 days at 978 260 cents a day, remainder
    // to November. Worked by hand; the cents are the point.
    expect(flow.months.map((m) => [m.month, m.forecast])).toEqual([
      ["2026-09-01", 30_000_000n],
      ["2026-10-01", 30_326_060n],
      ["2026-11-01", 29_347_853n],
      ["2026-12-01", 30_326_087n],
    ]);
    expect(sum(flow.months.map((m) => m.forecast))).toBe(R(1_200_000));
    expect(flow.months.at(-1)?.forecastCumulative).toBe(R(1_200_000));
  });

  it("with nothing certified, the expected line is the forecast and nothing is actual", () => {
    expect(flow.certified).toBe(0n);
    expect(flow.months.every((m) => m.actual === null && m.variance === null)).toBe(true);
    expect(sum(flow.months.map((m) => m.expected))).toBe(R(1_200_000));
  });
});

describe("actuals from certificates", () => {
  const certificates = [
    { number: "1", period: "2026-09-30", gross: R(250_000) },
    { number: "2", period: "2026-10-31", gross: R(420_000) },
  ];
  const flow = constructionCashFlow({ contractSum: R(1_200_000), activities, progressOf: none, certificates })!;

  it("turns cumulative certificates into monthly draws and a cumulative variance", () => {
    const sep = flow.months.find((m) => m.month === "2026-09-01")!;
    const oct = flow.months.find((m) => m.month === "2026-10-01")!;
    expect(sep.actual).toBe(R(250_000));
    expect(oct.actual).toBe(R(170_000));
    expect(oct.actualCumulative).toBe(R(420_000));
    expect(sep.variance).toBe(R(250_000 - 300_000));
    expect(oct.certificate).toBe("2");
    expect(flow.certified).toBe(R(420_000));
    expect(flow.remaining).toBe(R(780_000));
    expect(flow.lastCertified).toBe("2026-10-01");
  });

  it("re-forecasts the remainder over what is left of the programme, and sums to the contract sum", () => {
    // Behind October the expected line is the actual; ahead it phases 780 000 over Nov–Dec.
    expect(flow.months.slice(0, 2).map((m) => m.expected)).toEqual([R(250_000), R(170_000)]);
    const ahead = flow.months.filter((m) => m.month > "2026-10-01");
    expect(sum(ahead.map((m) => m.expected))).toBe(R(780_000));
    expect(flow.months.at(-1)?.expectedCumulative).toBe(R(1_200_000));
  });
});

describe("slippage moves the expected line", () => {
  const late = new Map<string, Progress>([
    ["c", { activityId: "c", asAt: "2026-10-31", start: "2027-01-01", finish: "2027-01-31", percent: 0 }],
  ]);
  const flow = constructionCashFlow({
    contractSum: R(1_200_000),
    activities,
    progressOf: (id) => late.get(id) ?? null,
    certificates: [{ number: "2", period: "2026-10-31", gross: R(420_000) }],
  })!;

  it("phases the remainder into the month the finishes now expect", () => {
    expect(flow.months.at(-1)?.month).toBe("2027-01-01");
    expect(flow.months.at(-1)?.forecast).toBe(0n); // the baseline never reached January
    expect(flow.months.at(-1)?.expected).toBeGreaterThan(0n);
    expect(expectedFinish(flow)).toBe("2027-01-31");
    expect(sum(flow.months.map((m) => m.expected))).toBe(R(1_200_000));
  });
});

describe("without a programme", () => {
  it("falls back to an S-curve over the contract's span, and says so", () => {
    const flow = constructionCashFlow({
      contractSum: R(1_000_000),
      activities: [],
      progressOf: none,
      certificates: [],
      contractSpan: { start: "2026-09-01", finish: "2027-02-28" },
    })!;
    expect(flow.basis).toBe("s-curve");
    expect(flow.months).toHaveLength(6);
    expect(sum(flow.months.map((m) => m.forecast))).toBe(R(1_000_000));
    // An S-curve peaks in the middle, not at the ends.
    const draws = flow.months.map((m) => Number(m.forecast));
    expect(Math.max(...draws)).not.toBe(draws[0]);
    expect(Math.max(...draws)).not.toBe(draws.at(-1));
  });

  it("phases nothing at all where there is neither a programme nor a contract span", () => {
    expect(constructionCashFlow({ contractSum: R(1), activities: [], progressOf: none, certificates: [] })).toBeNull();
  });
});
