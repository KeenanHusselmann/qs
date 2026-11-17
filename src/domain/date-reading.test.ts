/**
 * Reading dates out of a programme – the counterpart to `amount.test.ts`, and as interested in what
 * is refused: a date read month-first is four months wrong and looks ordinary.
 */

import { describe, expect, it } from "vitest";

import { daysFrom, monthOf, nextMonth, plusDays, readDate } from "./date-reading";

const dateOf = (text: string) => {
  const r = readDate(text);
  if (!r.ok) throw new Error(`refused: ${r.reason}`);
  return r.date;
};

describe("dates a document states plainly", () => {
  it("reads ISO", () => {
    expect(dateOf("2026-08-12")).toBe("2026-08-12");
    expect(dateOf("2026-8-2")).toBe("2026-08-02");
  });

  it("reads a written month in every order a programme prints it", () => {
    for (const text of ["12 Aug 2026", "12 August 2026", "12-Aug-26", "12 Aug '26", "12th August, 2026", "Aug 12, 2026", "August 12 2026"]) {
      expect(dateOf(text), text).toBe("2026-08-12");
    }
  });

  it("reads numeric dates day first, as South African documents write them", () => {
    for (const text of ["12/08/2026", "12.08.2026", "12-08-2026", "12/08/26", "Mon 12/08/26"]) {
      expect(dateOf(text), text).toBe("2026-08-12");
    }
  });

  it("reads a two-digit year as this century", () => {
    expect(dateOf("01/02/31")).toBe("2031-02-01");
  });
});

describe("what is refused, and why refusing beats guessing", () => {
  it("refuses a numeric date that can only be month first, rather than swapping it", () => {
    const r = readDate("08/14/2026");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/month first/);
  });

  it("refuses a day that month does not have", () => {
    expect(readDate("31/02/2026").ok).toBe(false);
    expect(readDate("29 Feb 2027").ok).toBe(false);
    expect(readDate("29 Feb 2028").ok).toBe(true);
  });

  it("refuses a month on its own, an unknown month word, and nothing at all", () => {
    expect(readDate("Aug 2026").ok).toBe(false);
    expect(readDate("12 Agu 2026").ok).toBe(false);
    expect(readDate("").ok).toBe(false);
    expect(readDate("week 12").ok).toBe(false);
  });

  it("keeps the text it could not read", () => {
    expect(readDate("week 12").text).toBe("week 12");
  });
});

describe("date arithmetic", () => {
  it("counts whole days, either way round", () => {
    expect(daysFrom("2026-08-12", "2026-08-19")).toBe(7);
    expect(daysFrom("2026-08-19", "2026-08-12")).toBe(-7);
    expect(daysFrom("2026-12-31", "2027-01-01")).toBe(1);
  });

  it("moves a date by whole days across a month end", () => {
    expect(plusDays("2026-08-30", 3)).toBe("2026-09-02");
    expect(plusDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("finds the month a date is in and the one after", () => {
    expect(monthOf("2026-08-12")).toBe("2026-08-01");
    expect(nextMonth("2026-12-01")).toBe("2027-01-01");
    expect(nextMonth("2026-08-01")).toBe("2026-09-01");
  });
});
