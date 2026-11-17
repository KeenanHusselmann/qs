import { describe, expect, it } from "vitest";

import { plausibleDate } from "./effective-date";

/**
 * The effective date on a standard.
 *
 * A date input hands back whatever its segments hold, and a mistyped year arrives as a
 * well-formed string. `60115-02-19` was filed and displayed as an effective date before this
 * check existed — a standard is dated so a reader can tell current from superseded, and a
 * nonsense date defeats exactly that while looking filed.
 */
describe("a date a standard could have taken effect on", () => {
  it("takes an ordinary one", () => {
    expect(plausibleDate("2026-01-15")).toBe(true);
    expect(plausibleDate("1998-07-01")).toBe(true);
  });

  it("refuses the five-digit year a date input produces when mistyped", () => {
    expect(plausibleDate("60115-02-19")).toBe(false);
  });

  it("refuses a year the firm could not have adopted a standard in", () => {
    expect(plausibleDate("1823-01-01")).toBe(false);
    expect(plausibleDate("2199-01-01")).toBe(false);
  });

  it("refuses anything not shaped like an ISO date", () => {
    for (const bad of ["", "15/01/2026", "2026-1-5", "January 2026", "2026-01-15T00:00:00Z"]) {
      expect(plausibleDate(bad)).toBe(false);
    }
  });

  it("refuses a date that does not exist", () => {
    // Well-formed and impossible. `Date.parse` catches it; the shape check alone would not.
    expect(plausibleDate("2026-02-31")).toBe(false);
    expect(plausibleDate("2026-13-01")).toBe(false);
  });

  it("does not police which year a practice adopted its own standard", () => {
    // The window is wide on purpose. It is not the platform's business which year; it is the
    // platform's business that the year is one.
    const lastCentury = `${new Date().getUTCFullYear() - 99}-06-01`;
    expect(plausibleDate(lastCentury)).toBe(true);
  });
});
