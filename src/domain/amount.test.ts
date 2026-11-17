/**
 * Reading a money figure out of a document's own words — PLATFORM.md §5.
 *
 * §5 is the one place to be paranoid, and the failure this guards against is silent: a misread
 * thousands separator produces a number that is wrong by a factor of a thousand, looks entirely
 * ordinary, and survives review. So the tests below are as interested in what is **refused** as in
 * what is read — a refusal is a figure a person reads for themselves, and a wrong number is a figure
 * nobody knows to check.
 *
 * The property tests round-trip through `formatMoney`, which is the only honest way to assert a
 * parser: anything the formatter writes, the reader must read back exactly.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { decimalMarkOf, readAmount, readPercent, readQuantity, readRate, reconcile } from "./amount";
import {
  formatMoney,
  formatPercent,
  formatQuantity,
  formatRate,
  money,
  percent,
  parseMoney,
  parseQuantity,
  quantity,
  rate,
} from "./money";

const read = (text: string) => readAmount(text);
const amountOf = (text: string) => {
  const r = read(text);
  if (!r.ok) throw new Error(`refused: ${r.reason}`);
  return r.amount;
};

describe("figures a document states plainly", () => {
  it("reads the South African convention — space groups, comma decimates", () => {
    expect(amountOf("R186 420 000,00")).toBe(parseMoney("186420000.00"));
  });

  it("reads the other convention — comma groups, dot decimates", () => {
    expect(amountOf("R186,420,000.00")).toBe(parseMoney("186420000.00"));
  });

  it("reads a bare number", () => {
    expect(amountOf("9321000")).toBe(parseMoney("9321000"));
  });

  it("takes the currency mark off the front, in any of its spellings", () => {
    for (const text of ["R1 000,00", "ZAR 1 000,00", "r1 000,00", "Rand 1 000,00"]) {
      expect(amountOf(text)).toBe(parseMoney("1000.00"));
    }
  });

  /** Both marks present means the last one decimates. True of both conventions, so no locale is
   *  being assumed — which is the point, because this corpus contains both. */
  it("decides mixed separators by position, not by locale", () => {
    expect(amountOf("1.234.567,89")).toBe(parseMoney("1234567.89"));
    expect(amountOf("1,234,567.89")).toBe(parseMoney("1234567.89"));
  });

  it("reads repeated grouping marks as grouping", () => {
    expect(amountOf("1,234,567")).toBe(parseMoney("1234567"));
    expect(amountOf("1.234.567")).toBe(parseMoney("1234567"));
  });

  it("reads a decimal that cannot be grouping", () => {
    // Two digits after the mark is never a thousands group.
    expect(amountOf("1234,56")).toBe(parseMoney("1234.56"));
    expect(amountOf("0,50")).toBe(parseMoney("0.50"));
  });
});

describe("the ambiguity that has to be refused", () => {
  /**
   * `1,234` is one thousand two hundred and thirty-four to one reader and one point two three four
   * to another. A factor of a thousand, and nothing in the string decides it. Guessing is how a
   * costing platform produces a total nobody can reproduce.
   */
  it("refuses a lone mark followed by exactly three digits", () => {
    for (const text of ["1,234", "1.234", "R123,456", "12,345"]) {
      const r = read(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/factor of a thousand/);
    }
  });

  /** The refusal is narrow on purpose: everything outside it is decidable and must be read. */
  it("does not refuse where the shape settles it", () => {
    expect(amountOf("1234,567")).toBe(parseMoney("1234.56")); // too many digits before to group
    expect(amountOf("1 234,567")).toBe(parseMoney("1234.56")); // a space already grouped it
    expect(amountOf("1,23")).toBe(parseMoney("1.23"));
  });
});

describe("figures that are not amounts", () => {
  it("refuses a percentage", () => {
    for (const text of ["10%", "10 per cent", "5,9%"]) {
      const r = read(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/percentage/i);
    }
  });

  /**
   * The JBCC penalty is `R42 000,00 per calendar day`. Summed into a total of elements it adds
   * forty-two thousand rand of nothing — the number is real and it is not money this project owes.
   */
  it("refuses a rate, because a rate must never be summed with amounts", () => {
    for (const text of ["R42 000,00 per calendar day", "R1 850,00 per cubic metre", "R312,50/m²"]) {
      const r = read(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/rate/i);
    }
  });

  it("refuses a value holding more than one figure", () => {
    for (const text of ["48 m2 and 62 m2", "between R540 000 and R680 000", "Min 71 Max 136"]) {
      const r = read(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/figures/);
    }
  });

  it("refuses a figure carrying a qualifier that changes what it means", () => {
    const r = read("R186 420 000,00 excluding VAT");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/qualifies/);
  });

  it("refuses nothing at all rather than calling it zero", () => {
    for (const text of ["", "   ", "nil", "not stated"]) {
      expect(read(text).ok).toBe(false);
    }
  });

  /** Every refusal keeps the text it refused, so a screen can show what it was looking at. */
  it("keeps the text it could not read", () => {
    const r = read("48 m2 and 62 m2");
    expect(r.text).toBe("48 m2 and 62 m2");
  });
});

describe("anything the formatter writes, the reader reads back", () => {
  it("round-trips grouped money", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 15n }), (minor) => {
        const amount = money(minor);
        const written = formatMoney(amount, { symbol: "R" });
        const back = read(written);
        expect(back.ok).toBe(true);
        if (back.ok) expect(back.amount).toBe(amount);
      }),
      { numRuns: 400 },
    );
  });

  /**
   * Negatives are written `(1 234,56)` by §7.4's money cell. They round-trip too — an omission that
   * failed to read back would silently drop out of a total rather than reduce it.
   */
  it("round-trips accounting negatives", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 10n ** 12n }), (minor) => {
        const written = formatMoney(money(-minor), { accounting: true });
        const back = read(written);
        expect(back.ok).toBe(true);
        if (back.ok) expect(back.amount).toBe(money(-minor));
      }),
      { numRuns: 200 },
    );
  });
});

describe("reconciling a step against the total it states", () => {
  const field = (label: string, value: string | null, role?: "element" | "total") => ({
    label,
    value,
    money: role,
  });

  it("sums the elements and compares them with the stated total", () => {
    const result = reconcile([
      field("Substructure", "R10 000 000,00", "element"),
      field("Superstructure", "R20 000 000,00", "element"),
      field("Total construction cost", "R30 000 000,00", "total"),
    ]);

    expect(result.elements).toBe(parseMoney("30000000.00"));
    expect(result.stated).toBe(parseMoney("30000000.00"));
    expect(result.difference).toBe(money(0n));
    expect(result.counted).toBe(2);
  });

  /** The difference is reported; nothing is corrected. Which figure is wrong is the QS's call. */
  it("reports a difference rather than resolving it", () => {
    const result = reconcile([
      field("Substructure", "R10 000 000,00", "element"),
      field("Total construction cost", "R12 500 000,00", "total"),
    ]);

    expect(result.difference).toBe(parseMoney("2500000.00"));
  });

  it("carries the refusals rather than silently dropping them from the sum", () => {
    const result = reconcile([
      field("Substructure", "R10 000 000,00", "element"),
      field("Preliminaries", "12,345", "element"),
      field("Total construction cost", "R10 000 000,00", "total"),
    ]);

    expect(result.counted).toBe(1);
    expect(result.refused).toHaveLength(1);
    expect(result.refused[0].label).toBe("Preliminaries");
    // The sum is of what could be read, and the refusal is what says the sum is incomplete.
    expect(result.elements).toBe(parseMoney("10000000.00"));
  });

  it("has no difference to report when the step states no total", () => {
    const result = reconcile([field("Substructure", "R10 000 000,00", "element")]);
    expect(result.stated).toBeNull();
    expect(result.difference).toBeNull();
  });

  it("ignores fields that are not money at all", () => {
    const result = reconcile([
      field("Contractor", "Ndlovu Construction (Pty) Ltd"),
      field("Substructure", "R10 000 000,00", "element"),
    ]);
    expect(result.counted).toBe(1);
    expect(result.refused).toHaveLength(0);
  });
});

/**
 * ── The two other figures a bill row carries ─────────────────────────────────────────────
 *
 * A quantity and a rate go through the same paranoia as an amount, and the differences are the
 * point: a quantity **expects** a trailing unit, because the unit is a column of its own on a bill
 * row; and a rate **expects** a per-phrase, because that is what makes it a rate rather than the
 * amount `readAmount` refuses for exactly that reason.
 */
describe("reading a quantity", () => {
  const quantityOf = (text: string) => {
    const reading = readQuantity(text);
    if (!reading.ok) throw new Error(`refused: ${reading.reason}`);
    return reading.quantity;
  };

  it("reads a bare figure", () => {
    expect(quantityOf("1250")).toBe(parseQuantity("1250"));
  });

  it("reads one that arrives carrying its unit, which is the normal case", () => {
    expect(quantityOf("1 250 m³")).toBe(parseQuantity("1250"));
    expect(quantityOf("864 m2")).toBe(parseQuantity("864"));
  });

  it("keeps the four decimal places the column holds", () => {
    expect(quantityOf("12,3456")).toBe(parseQuantity("12.3456"));
  });

  it("rounds a fifth decimal place and says so, rather than refusing the figure", () => {
    /*
      This refused, once, so that a digit was never dropped behind a reader's back. The rule was
      right about "behind their back" and wrong about refusing: a drafted bill came back with
      dozens of ordinary computed quantities unread, and the fifth decimal place of a cubic metre
      is five hundredths of a millimetre. So it rounds, and the row carries a note saying what the
      document said — which is what the original rule was actually asking for.
    */
    const reading = readQuantity("12,34567");
    expect(reading.ok).toBe(true);
    if (reading.ok) {
      expect(reading.quantity).toBe(parseQuantity("12.3457"));
      expect(reading.rounded).toMatch(/12,3457/);
      expect(reading.rounded).toMatch(/12,34567|12\.34567/);
    }
  });

  it("reads a spreadsheet's floating-point noise as the figure it plainly is, and says nothing", () => {
    // 0,45 stored as a binary float. Seventeen decimal places of nothing: calling that precision
    // and refusing it was the platform misreading its own input.
    const reading = readQuantity("0.44999999999999996", { decimalMark: "." });
    expect(reading.ok).toBe(true);
    if (reading.ok) {
      expect(reading.quantity).toBe(parseQuantity("0.45"));
      expect(reading.rounded).toBeNull();
    }
  });

  it("still refuses what makes the number itself uncertain", () => {
    // Rounding settles how precise a figure is. It settles nothing about which figure it is.
    expect(readQuantity("15%").ok).toBe(false);
    expect(readQuantity("0,8 bays per unit").ok).toBe(false);
  });

  it("refuses a ratio, which is not a quantity of anything", () => {
    const reading = readQuantity("0,8 bays per unit");
    expect(reading.ok).toBe(false);
    if (!reading.ok) expect(reading.reason).toMatch(/ratio/);
  });

  it("refuses the thousand-fold ambiguity, exactly as an amount does", () => {
    const reading = readQuantity("1,234");
    expect(reading.ok).toBe(false);
    if (!reading.ok) expect(reading.reason).toMatch(/factor of a thousand/);
  });

  it("refuses two figures, because picking one is a guess about which was meant", () => {
    expect(readQuantity("48 and 62").ok).toBe(false);
  });

  /**
   * Round-1 testing: "12,940 m²" was left blank. The string alone still settles nothing – but a unit
   * measured to whole units cannot carry three decimal places, and a document that writes its money
   * as R385,00 has told us its comma is a decimal mark.
   */
  describe("settled from outside the figure", () => {
    it("reads a whole-measure unit's comma as grouping", () => {
      expect(quantityOf("12,940 m²")).toBe(parseQuantity("12940"));
      expect(readQuantity("12,940", { unit: "m2" })).toMatchObject({ ok: true });
      expect(readQuantity("1.250 nr")).toMatchObject({ ok: true, quantity: parseQuantity("1250") });
    });

    it("still refuses where three places are ordinary", () => {
      expect(readQuantity("12,940 t").ok).toBe(false);
      expect(readQuantity("12,940", { unit: "ha" }).ok).toBe(false);
    });

    it("uses the document's own convention where the unit does not settle it", () => {
      expect(readQuantity("12,940 t", { decimalMark: "," })).toMatchObject({ quantity: parseQuantity("12.94") });
      expect(readQuantity("12,940 t", { decimalMark: "." })).toMatchObject({ quantity: parseQuantity("12940") });
      // A bill that writes R385,00 beside 12,940 m² has mixed conventions; nobody measures 12,94 m².
      expect(readQuantity("12,940 m²", { decimalMark: "," })).toMatchObject({ quantity: parseQuantity("12940") });
      expect(readRate("R1,250", { decimalMark: "." })).toMatchObject({ ok: true });
      expect(readRate("R1,250").ok).toBe(false);
    });
  });
});

describe("the decimal mark a document uses", () => {
  it("reads it from figures only one convention writes", () => {
    expect(decimalMarkOf(["Plaster 12,940 m² at R385,00"])).toBe(",");
    expect(decimalMarkOf(["R 1 234,56 per m³"])).toBe(",");
    expect(decimalMarkOf(["12,940 m² at R385.00"])).toBe(".");
    expect(decimalMarkOf(["Total 1,234,567"])).toBe(".");
  });

  it("says nothing when the figures say nothing, or say both", () => {
    expect(decimalMarkOf(["12,940 m²", "clause 3.2"])).toBeNull();
    expect(decimalMarkOf(["R385,00", "R385.00"])).toBeNull();
  });
});

describe("reading a rate", () => {
  const rateOf = (text: string) => {
    const reading = readRate(text);
    if (!reading.ok) throw new Error(`refused: ${reading.reason}`);
    return reading;
  };

  /**
   * The rule that makes `readAmount` refuse this string is the rule that defines it here. "R42 000,00
   * per calendar day" summed with amounts contributes forty-two thousand rand of nothing; read as a
   * rate it is exactly what it says.
   */
  it("reads the per-phrase rather than refusing it, and keeps what it names", () => {
    const reading = rateOf("R1 850,00 per cubic metre");
    expect(reading.rate.value).toBe(185000n);
    expect(reading.rate.precision).toBe(2);
    expect(reading.per).toBe("cubic metre");
  });

  it("reads the slash spelling of the same statement", () => {
    const reading = rateOf("R312,50/m²");
    expect(reading.rate.value).toBe(31250n);
    expect(reading.per).toBe("m²");
  });

  it("reads a bare rate with no unit stated", () => {
    expect(rateOf("845").rate.value).toBe(84500n);
  });

  /**
   * §5.1 — a rate carries its own scale. Four places for a low-value high-volume item, because
   * rounding the rate itself would compound across thousands of bill lines.
   */
  it("takes its precision from the figure the document wrote", () => {
    expect(rateOf("R0,4567").rate).toEqual({ value: 4567n, precision: 4 });
    expect(rateOf("R1 850,00").rate).toEqual({ value: 185000n, precision: 2 });
  });

  it("never holds a rate below the money scale", () => {
    // Two places is the floor: `extend()` throws below it, and a rate coarser than whole currency
    // units would scale the amount up rather than down.
    expect(rateOf("845").rate.precision).toBe(2);
    expect(rateOf("R1 850,5").rate.precision).toBe(2);
  });

  it("refuses more precision than a rate is held to", () => {
    expect(readRate("R1,85000017").ok).toBe(false);
  });

  it("refuses a percentage", () => {
    expect(readRate("10%").ok).toBe(false);
  });

  it("refuses a qualified figure, because the qualifier changes what it means", () => {
    const reading = readRate("R1 850,00 excluding VAT");
    expect(reading.ok).toBe(false);
    if (!reading.ok) expect(reading.reason).toMatch(/qualifies/);
  });

  it("refuses the thousand-fold ambiguity", () => {
    expect(readRate("1,234").ok).toBe(false);
  });

  /**
   * The only honest way to test a parser: anything the formatter writes, the reader reads back —
   * **or refuses as ambiguous, and never reads back something else.**
   *
   * That second clause is not a hedge, it is a real property of the notation. A rate carried to
   * three places writes `1,000`, and `1,000` is one thousand to a reader who groups with commas.
   * The formatter can therefore produce a string nobody can decide, and the contract this platform
   * offers is that such a figure is handed back to a person rather than guessed at. A silently wrong
   * rate is a wrong amount on every row that uses it.
   *
   * The property caught a real defect writing it: `0,001` was refused as ambiguous, though no
   * convention writes a leading-zero thousands group. `separatorsOf` now says so.
   */
  it("round-trips everything formatRate writes, or refuses it as undecidable", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 100_000_000_000n }),
        fc.constantFrom(2, 3, 4, 5, 6),
        (value, precision) => {
          const written = formatRate(rate(value, precision));
          const read = readRate(written);

          if (!read.ok) return /factor of a thousand/.test(read.reason);
          return read.rate.value === value && read.rate.precision === precision;
        },
      ),
    );
  });

  /** At the money scale — the ordinary case — it always reads back exactly. */
  it("round-trips every two-place rate exactly", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 100_000_000_000n }), (value) => {
        const read = readRate(formatRate(rate(value, 2)));
        return read.ok && read.rate.value === value && read.rate.precision === 2;
      }),
    );
  });

  it("round-trips everything formatQuantity writes", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 1_000_000_000_000n }), (scaled) => {
        const written = formatQuantity(quantity(scaled), 4);
        const read = readQuantity(written);
        return read.ok && read.quantity === scaled;
      }),
    );
  });
});

/**
 * Reading a percentage a person typed — §4.8's waste, markup and bulk adjustment.
 *
 * The band is passed in because the database has one too (`rate_build_ups_percentages_sane`), and
 * two statements of what is acceptable that can disagree is one statement too many.
 */
describe("readPercent (§4.8, §5.1)", () => {
  const any = { min: -100, max: 100 };
  const positive = { min: 0, max: 100 };

  const scaled = (text: string, band = any) => {
    const reading = readPercent(text, band);
    return reading.ok ? reading.percent : reading.reason;
  };

  it("reads the whole number a QS says out loud, as the fraction §5.1 stores", () => {
    expect(scaled("15")).toBe(percent(1500n));
    expect(scaled("5")).toBe(percent(500n));
    expect(scaled("12,5")).toBe(percent(1250n));
    expect(scaled("12.5")).toBe(percent(1250n));
    expect(scaled("0,5")).toBe(percent(50n));
    expect(scaled("8%")).toBe(percent(800n));
    expect(scaled("0")).toBe(percent(0n));
  });

  it("reads a negative adjustment, which is what makes it an adjustment", () => {
    expect(scaled("-8")).toBe(percent(-800n));
    expect(scaled("-2,5%")).toBe(percent(-250n));
  });

  it("refuses what it cannot decide, in words", () => {
    expect(scaled("")).toMatch(/no figure/i);
    expect(scaled("between 5 and 8")).toMatch(/figures/i);
    expect(scaled("8 per annum")).toMatch(/qualifies/i);
    // `12,555` is refused one rule earlier and more accurately: three digits after a comma is a
    // thousands group to half the world, so it never reaches the precision check at all.
    expect(scaled("12,555")).toMatch(/thousands separator/i);
    // `0,555` cannot be a thousands group — no convention writes a leading-zero one — so it is
    // decidable, and refused for the reason it should be.
    expect(scaled("0,555")).toMatch(/decimal places/i);
  });

  it("refuses outside the band it was given, and names the band", () => {
    expect(scaled("-8", positive)).toMatch(/between 0% and 100%/);
    expect(scaled("150")).toMatch(/between -100% and 100%/);
    expect(scaled("-101")).toMatch(/between -100% and 100%/);
    // The edges themselves are in.
    expect(scaled("100")).toBe(percent(10000n));
    expect(scaled("-100")).toBe(percent(-10000n));
  });

  it("round-trips everything formatPercent writes", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -10000n, max: 10000n }), (value) => {
        // The formatter writes at most two decimals on the percentage, which is what the reader
        // accepts — so anything it produces has to come back as the figure it was given.
        const written = formatPercent(percent(value));
        const reading = readPercent(written, any);
        return reading.ok && reading.percent === percent(value);
      }),
    );
  });
});

/**
 * Separators that are not a grouping — the figure that got in, and how.
 *
 * A rate cell on the pricing screen held `1 500,00`. A triple-click did not select it, because the
 * thousands separator is a non-breaking space and Chrome's line selection will not cross one, so
 * what landed when `1 900,00` was typed was the two spliced together: `11 900,00500,00`. That was
 * read as **R119 000 050 000,00** and written to the bill, because repeated marks were taken as
 * proof of grouping without anybody checking that the groups were groups.
 *
 * The interaction was one defect. Accepting the result was the dangerous one, and it is the one
 * these assert — because it protects every route in, not just the cell it was found on.
 */
describe("a grouping that is not a grouping (§5)", () => {
  const refusalOf = (text: string) => {
    const reading = readRate(text);
    return reading.ok ? `read as ${formatRate(reading.rate)}` : reading.reason;
  };

  it("refuses the figure a mis-selected cell produced, rather than reading it", () => {
    expect(refusalOf("11 900,00500,00")).toMatch(/not grouped the way any convention/i);
    expect(readAmount("11 900,00500,00").ok).toBe(false);
    expect(readQuantity("11 900,00500,00").ok).toBe(false);
  });

  it("refuses any repeated mark whose groups are not thousands", () => {
    expect(refusalOf("1,2345,678")).toMatch(/not grouped/i);
    expect(refusalOf("1234,567,890")).toMatch(/not grouped/i);
    expect(refusalOf("12.34.56")).toMatch(/not grouped/i);
  });

  it("still reads every properly grouped figure, in both conventions", () => {
    expect(readRate("1 234 567,89")).toMatchObject({ ok: true });
    expect(readAmount("1.234.567,89")).toMatchObject({ ok: true });
    expect(readAmount("1,234,567.89")).toMatchObject({ ok: true });
    expect(amountOf("1.234.567,89")).toBe(parseMoney("1234567.89"));
    expect(amountOf("1,234,567.89")).toBe(parseMoney("1234567.89"));
  });
});
