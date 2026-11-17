import { describe, expect, it } from "vitest";

import { formatDate } from "./dates";

describe("formatDate", () => {
  it("writes §7.7's format", () => {
    expect(formatDate("2026-08-12T09:30:00.000Z")).toBe("12 Aug 2026");
  });

  it("never writes the ambiguous numeric form the spec forbids", () => {
    // `08/12/26` is 8 December here and 12 August in the United States, and the string does not
    // say which. On a completion date or a variation instruction that is the ambiguity a dispute
    // turns on, which is why §7.7 names this shape specifically.
    expect(formatDate("2026-12-08T00:00:00.000Z")).toBe("8 Dec 2026");
    expect(formatDate("2026-12-08T00:00:00.000Z")).not.toMatch(/\d{2}\/\d{2}\/\d{2}/);
  });

  it("takes a Date as readily as a string, because the database hands over both", () => {
    expect(formatDate(new Date("2026-01-31T12:00:00.000Z"))).toBe("31 Jan 2026");
  });

  it("reads an absent date as absent rather than as the words 'Invalid Date'", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("not a date")).toBe("—");
  });
});

describe("the month is a table, not a locale's opinion", () => {
  it("writes September as three letters like every other month", () => {
    /*
      The bug this table exists for. `Intl` with `en-GB` and `month: "short"` returns "Sept" —
      four letters where all eleven others are three — so every date on the platform silently
      changed shape on the first of September and a suite that had been green for months went red
      on a product nobody had touched.
    */
    expect(formatDate(new Date(2026, 8, 1))).toBe("1 Sep 2026");
  });

  it("writes all twelve the same way", () => {
    const written = Array.from({ length: 12 }, (_, m) => formatDate(new Date(2026, m, 15)));
    for (const date of written) {
      expect(date).toMatch(/^15 [A-Z][a-z]{2} 2026$/);
    }
  });

  it("still writes the spec's own example", () => {
    // §7.7: `12 Aug 2026`.
    expect(formatDate(new Date(2026, 7, 12))).toBe("12 Aug 2026");
  });
});
