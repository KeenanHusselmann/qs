import { describe, expect, it } from "vitest";

import { readUnit } from "./units";

/**
 * Whitespace folded before comparing.
 *
 * The note groups thousands with U+00A0, as everything else in the platform does (§7.7) — an
 * ordinary space lets a figure wrap mid-number, and "127 000" broken across two lines is a
 * different number. An assertion typed with ordinary spaces would never match, and would look like
 * a conversion bug rather than a test bug. `separatorIsNonBreaking` below asserts the convention
 * itself, so folding it here cannot hide a regression.
 */
const flat = (text: string | null) => (text ?? "").replace(/\s+/g, " ");

/** U+00A0, named rather than typed, because the two spaces are indistinguishable in a diff. */
const NBSP = String.fromCharCode(160);

/**
 * The defect this exists for.
 *
 * A market study saying "12 units per month" in a field recorded as units/yr is a 12× error that
 * nothing else in the platform can see: it does not crash, it is not blank, and the confidence
 * badge says 100%. Absorption is what the sales programme and the cash flow are built on.
 */
describe("the absorption rate — the case this was written for", () => {
  it("accepts a rate the document already states per year", () => {
    const r = readUnit("144 units per annum", "units/yr");
    expect(r.agreement).toBe("agrees");
    expect(r.note).toBeNull();
  });

  it("catches a rate the document states per month", () => {
    const r = readUnit("12 units per month", "units/yr");
    expect(r.agreement).toBe("differs");
    expect(r.stated).toBe("per month");
  });

  it("does the arithmetic for the reader rather than leaving them to it", () => {
    expect(flat(readUnit("12 units per month", "units/yr").note)).toContain("that is 144");
  });

  it("does not rewrite the figure — the note is the whole of what it does", () => {
    // Converting behind the reader's back would put a number in the data model that no document
    // states. The reading carries words; the override box on the row carries the correction.
    const r = readUnit("12 units per month", "units/yr");
    expect(r.note).toMatch(/Correct it/);
    expect(r).not.toHaveProperty("value");
  });

  it("refuses arithmetic it cannot do exactly", () => {
    // A year is not 52 weeks, and rounding it here would be the same silent misread one layer up.
    const r = readUnit("3 units per week", "units/yr");
    expect(r.agreement).toBe("differs");
    expect(r.note).toMatch(/no exact conversion/);
    expect(r.note).not.toMatch(/that is/);
  });

  it("converts a quarterly rate, which is exact", () => {
    expect(flat(readUnit("36 units per quarter", "units/yr").note)).toContain("that is 144");
  });

  it("leaves a bare figure alone — the field supplies the unit", () => {
    expect(readUnit("144", "units/yr").agreement).toBe("silent");
  });
});

describe("area", () => {
  it("agrees with a value that already says m²", () => {
    // `\b` cannot follow `²` — a word boundary needs a word character on one side — so the obvious
    // `/\bm²\b/` never matched the commonest value in the corpus and every area read as silent.
    expect(readUnit("48 m²", "m²").agreement).toBe("agrees");
    expect(readUnit("48 m2", "m²").agreement).toBe("agrees");
    expect(readUnit("48 sqm", "m²").agreement).toBe("agrees");
    expect(readUnit("48 square metres", "m²").agreement).toBe("agrees");
  });

  it("catches an extent stated in hectares and converts it", () => {
    const r = readUnit("12,7 ha", "m²");
    expect(r.agreement).toBe("differs");
    expect(flat(r.note)).toContain("127 000");
  });

  it("reads a decimal point as readily as a comma, because documents use both", () => {
    expect(flat(readUnit("12.7 hectares", "m²").note)).toContain("127 000");
  });

  it("flags square feet without inventing a conversion", () => {
    expect(readUnit("516 ft²", "m²").note).toMatch(/no exact conversion/);
  });
});

describe("currency", () => {
  it("agrees with a value carrying the rand sign", () => {
    expect(readUnit("R 737 558", "R").agreement).toBe("agrees");
    expect(readUnit("ZAR 737 558", "R").agreement).toBe("agrees");
  });

  it("catches a figure in another currency, which is the expensive one to miss", () => {
    const r = readUnit("USD 4 200 000", "R");
    expect(r.agreement).toBe("differs");
    expect(r.note).toMatch(/US dollars/);
    // No exchange rate is applied. A rate would be a figure with a date on it that nobody signed.
    expect(r.note).toMatch(/no exact conversion/);
  });

  it("does not mistake a word beginning with R for the rand sign", () => {
    // "Residential 3, 90 units per hectare" is a real value on the zoning field.
    expect(readUnit("Residential 3", "R").agreement).toBe("silent");
  });
});

describe("duration", () => {
  it("agrees with a programme already stated in months", () => {
    expect(readUnit("36 months", "months").agreement).toBe("agrees");
  });

  it("converts a programme stated in years", () => {
    const r = readUnit("3 years", "months");
    expect(r.agreement).toBe("differs");
    expect(flat(r.note)).toContain("that is 36");
  });

  it("flags weeks and days without converting them", () => {
    expect(readUnit("18 weeks", "months").note).toMatch(/no exact conversion/);
    expect(readUnit("90 days", "months").note).toMatch(/no exact conversion/);
  });
});

describe("what it refuses to guess at", () => {
  it("says nothing about a field with no unit", () => {
    expect(readUnit("Residential 3, 90 units per hectare", undefined).agreement).toBe("silent");
  });

  it("says nothing about a unit nobody has taught it", () => {
    // An unknown unit is a thing this has not been taught to check. Guessing at it is exactly the
    // behaviour the module exists to prevent, so it stays quiet rather than inventing an opinion.
    expect(readUnit("400 kg", "kg").agreement).toBe("silent");
  });

  it("says nothing about an absent value", () => {
    expect(readUnit(null, "R").agreement).toBe("silent");
    expect(readUnit("", "R").agreement).toBe("silent");
  });

  it("states the mismatch even where the number cannot be read", () => {
    // The unit is the finding. A figure too qualified to parse still deserves the flag.
    const r = readUnit("about a dozen units per month, say", "units/yr");
    expect(r.agreement).toBe("differs");
    expect(r.note).toMatch(/no exact conversion|read it and correct/);
  });
});

describe("the phrasing", () => {
  it("says 'per month' and not 'in a month'", () => {
    expect(readUnit("12 units per month", "units/yr").note).toMatch(/states this per month/);
  });

  it("names the field's unit in words rather than as a column suffix", () => {
    // "This field records R" is not a sentence a QS would write.
    expect(readUnit("USD 1 000", "R").note).toMatch(/records rand/);
    expect(readUnit("12 units per month", "units/yr").note).toMatch(/records units per year/);
  });
});

describe("the separator", () => {
  it("groups thousands with a non-breaking space, as §7.7 asks", () => {
    // Not decoration. A contract sum broken across two lines is a different number, and this note
    // is read on a narrow column beside a table.
    expect(readUnit("12,7 ha", "m²").note).toContain(`127${NBSP}000`);
  });
});
