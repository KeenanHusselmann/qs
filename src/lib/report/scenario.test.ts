import { describe, expect, it } from "vitest";

import { readAbsorption, readProgramme } from "./scenario";

/**
 * The absorption reader.
 *
 * `readQuantity` refuses "144 units per annum" — correctly, because that is a rate and not a
 * quantity — which is how this was found: the whole cash-flow model was silently unavailable on a
 * project that had signed everything it needed.
 *
 * Everything here guards a factor-of-twelve error. A scheme selling 144 units a year takes seven
 * years; at 144 a month it takes seven months. Both are plausible sentences and they are different
 * developments.
 */
describe("reading an absorption rate", () => {
  it("reads the phrasing the platform actually signs", () => {
    expect(readAbsorption("144 units per annum")).toBe(144);
  });

  it("reads the other ways a QS writes a year", () => {
    for (const text of [
      "144 units per year",
      "144 per yr",
      "144 units p.a.",
      "144 units pa",
      "144 units/year",
      "144 units sold annually",
    ]) {
      expect(readAbsorption(text)).toBe(144);
    }
  });

  it("converts a monthly rate rather than reading it as annual", () => {
    expect(readAbsorption("12 units per month")).toBe(144);
    expect(readAbsorption("12 units monthly")).toBe(144);
    expect(readAbsorption("12 units/month")).toBe(144);
  });

  it("converts a quarterly rate", () => {
    expect(readAbsorption("36 units per quarter")).toBe(144);
  });

  it("refuses a figure with no period at all", () => {
    // "144" is not an absorption rate. Guessing the period would put a decade of finance cost
    // on a coin toss, so the model goes unavailable and the gates say they were not evaluated.
    expect(readAbsorption("144")).toBeNull();
    expect(readAbsorption("144 units")).toBeNull();
  });

  it("does not read a period out of a word that merely contains one", () => {
    /*
      The bug this file exists to prevent. Without word boundaries `per\s*a` matches "per
      apartment" and a bare `pa` matches inside almost anything — either returns a confident
      annual rate from a sentence that never named a period.
    */
    expect(readAbsorption("144 units per apartment")).toBeNull();
    expect(readAbsorption("2 parking bays per apartment")).toBeNull();
  });

  it("reads grouped figures, however they are spaced", () => {
    expect(readAbsorption("1 200 units per annum")).toBe(1200);
    expect(readAbsorption("1 200 units per annum")).toBe(1200);
  });

  it("refuses nothing, an empty string and a nonsense figure", () => {
    expect(readAbsorption(null)).toBeNull();
    expect(readAbsorption("")).toBeNull();
    expect(readAbsorption("no units per annum")).toBeNull();
    expect(readAbsorption("0 units per annum")).toBeNull();
  });
});

describe("reading a programme duration", () => {
  it("reads months, stated or bare – the field's own unit", () => {
    expect(readProgramme("36 months")).toBe(36);
    expect(readProgramme("36")).toBe(36);
  });

  it("refuses a programme in years rather than reading 3 years as 3 months", () => {
    // readQuantity strips the unit, so "3 years" read as 3 – a three-month build for a three-year
    // one, with the finance cost on it twelve times too small.
    expect(readProgramme("3 years")).toBeNull();
    expect(readProgramme("156 weeks")).toBeNull();
  });

  it("refuses a range, nothing and nought", () => {
    expect(readProgramme("18 to 24 months")).toBeNull();
    expect(readProgramme(null)).toBeNull();
    expect(readProgramme("")).toBeNull();
    expect(readProgramme("0 months")).toBeNull();
  });
});
