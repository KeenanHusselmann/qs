/**
 * Money layer tests.
 *
 * PLATFORM.md §5.4: "Write property-based tests for the money layer. This is the one place to be
 * paranoid." §13.3 puts money arithmetic first on the short list of things that get tested
 * thoroughly regardless of coverage targets.
 *
 * The properties below are the ones that, if violated, produce a bill that does not add up — which
 * §5 says costs trust permanently. Worked examples sit alongside them because a QS should be able
 * to check a test by hand, the same way they check a column.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  adjustRate,
  applyPercent,
  buildUpRate,
  extend,
  formatPercent,
  displayUnit,
  formatRate,
  formatUnitRate,
  formatMoney,
  formatRand,
  formatQuantity,
  money,
  multiplyQuantities,
  parseMoney,
  parsePercent,
  parseQuantity,
  parseRate,
  percent,
  percentToNumeric,
  percentFromRate,
  perUnit,
  quantity,
  rate,
  retention,
  sum,
  sumQuantities,
} from "./money";

/**
 * Rewrites ordinary spaces to the non-breaking space the formatter groups thousands with.
 *
 * Written as a helper rather than pasting U+00A0 into every expectation, so the difference is
 * visible in the test source instead of being an invisible character nobody can see in a diff.
 * The separator is non-breaking on purpose: an ordinary space lets a figure wrap mid-number
 * inside a 32px grid cell (§7.4).
 */
const nb = (s: string) => s.replace(/ /g, " ");

// Realistic ranges: quantities to 4dp up to ~100 000 units, rates up to ~R100 000.
const arbQuantity = fc.bigInt({ min: 0n, max: 1_000_000_000n }).map(quantity);
const arbSignedQuantity = fc.bigInt({ min: -1_000_000_000n, max: 1_000_000_000n }).map(quantity);
const arbMoney = fc.bigInt({ min: -1_000_000_000_000n, max: 1_000_000_000_000n }).map(money);
const arbRate = fc
  .tuple(fc.bigInt({ min: 0n, max: 100_000_000n }), fc.constantFrom(2, 3, 4))
  .map(([v, p]) => rate(v, p));

describe("extend — the single rounding point (§5.2)", () => {
  it("matches the worked example in the source: 12,3456 @ R0,4567 = R5,64", () => {
    expect(extend(parseQuantity("12.3456"), parseRate("0.4567", 4))).toBe(5_64n);
  });

  it("handles the ordinary case: 250 m² @ R185,50 = R46 375,00", () => {
    expect(extend(parseQuantity("250"), parseRate("185.50"))).toBe(46_375_00n);
  });

  it("rounds a half up, as a hand calculation would: 3 @ R1,005 = R3,02", () => {
    // 3 × 1.005 = 3.015 exactly. Commercial rounding takes this away from zero.
    expect(extend(parseQuantity("3"), parseRate("1.005", 3))).toBe(3_02n);
  });

  it("never differs from the exact product by more than half a minor unit", () => {
    fc.assert(
      fc.property(arbSignedQuantity, arbRate, (qty, unitRate) => {
        const amount = extend(qty, unitRate);

        // The exact product as a rational, scaled to minor units without rounding.
        const scale = 10n ** BigInt(unitRate.precision + 4 - 2);
        const exactNumerator = qty * unitRate.value;

        // |amount × scale − exact| ≤ scale/2, i.e. the error never exceeds half a cent.
        const error = amount * scale - exactNumerator;
        const absError = error < 0n ? -error : error;
        return absError * 2n <= scale;
      }),
      { numRuns: 2000 },
    );
  });

  it("is symmetric across zero, so a variation's additions and omissions cancel", () => {
    fc.assert(
      fc.property(arbSignedQuantity, arbRate, (qty, unitRate) => {
        const negated = quantity(-qty);
        return extend(negated, unitRate) === money(-extend(qty, unitRate));
      }),
      { numRuns: 1000 },
    );
  });

  it("is zero when either side is zero", () => {
    fc.assert(
      fc.property(arbRate, (unitRate) => extend(quantity(0n), unitRate) === 0n),
    );
    fc.assert(
      fc.property(arbQuantity, (qty) => extend(qty, rate(0n, 2)) === 0n),
    );
  });
});

describe("sum — totals are of already-rounded amounts (§5.2)", () => {
  it("is order-independent, so a re-sorted bill totals identically", () => {
    fc.assert(
      fc.property(fc.array(arbMoney, { maxLength: 200 }), (amounts) => {
        const reversed = [...amounts].reverse();
        return sum(amounts) === sum(reversed);
      }),
      { numRuns: 500 },
    );
  });

  it("groups the same way a bill's section subtotals do", () => {
    // A total built from subtotals must equal the total built from every line at once —
    // otherwise a collapsed group and an expanded one would disagree on screen.
    fc.assert(
      fc.property(
        fc.array(fc.array(arbMoney, { maxLength: 50 }), { maxLength: 20 }),
        (groups) => {
          const viaSubtotals = sum(groups.map((g) => sum(g)));
          const viaFlat = sum(groups.flat());
          return viaSubtotals === viaFlat;
        },
      ),
      { numRuns: 500 },
    );
  });

  it("does NOT equal rounding the exact total — this is the whole point of §5.2", () => {
    // Three items of 1/3 unit at R1,00. Each extends to R0,33; the bill total is R0,99.
    // Rounding the exact sum (R1,00) instead would produce a bill whose column does not add up.
    const third = parseQuantity("0.3333");
    const oneRand = parseRate("1.00");

    const amounts = [extend(third, oneRand), extend(third, oneRand), extend(third, oneRand)];

    expect(amounts).toEqual([33n, 33n, 33n]);
    expect(sum(amounts)).toBe(99n);
    expect(formatMoney(sum(amounts))).toBe("0,99");
  });

  it("of an empty bill is zero, not an error", () => {
    expect(sum([])).toBe(0n);
    expect(sumQuantities([])).toBe(0n);
  });
});

describe("retention (§6.4 invariant 6)", () => {
  const tenPercent = percentFromRate(10);
  const fivePercent = percentFromRate(5);

  it("never exceeds the contractual limit", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10_000_000_000n }).map(money),
        fc.bigInt({ min: 0n, max: 10_000_000_000n }).map(money),
        (gross, contractValue) => {
          const held = retention(gross, tenPercent, fivePercent, contractValue);
          const cap = applyPercent(contractValue, fivePercent);
          return held <= cap;
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("takes the calculated figure while below the cap", () => {
    // R100 000 gross on a R10m contract: 10% = R10 000, cap is 5% of R10m = R500 000.
    const held = retention(money(100_000_00n), tenPercent, fivePercent, money(10_000_000_00n));
    expect(held).toBe(10_000_00n);
  });

  it("caps once the limit is reached, rather than failing", () => {
    // R9m gross on a R10m contract: 10% would be R900 000, but the cap is R500 000.
    const held = retention(money(9_000_000_00n), tenPercent, fivePercent, money(10_000_000_00n));
    expect(held).toBe(500_000_00n);
  });
});

describe("percentages", () => {
  it("applying 100% returns the amount unchanged", () => {
    fc.assert(
      fc.property(arbMoney, (amount) => applyPercent(amount, percentFromRate(100)) === amount),
      { numRuns: 500 },
    );
  });

  it("applying 0% returns zero", () => {
    fc.assert(fc.property(arbMoney, (a) => applyPercent(a, percentFromRate(0)) === 0n));
  });

  it("computes SA VAT at 15% correctly", () => {
    // R1 000 000,00 + 15% VAT = R150 000,00
    expect(applyPercent(money(1_000_000_00n), percentFromRate(15))).toBe(150_000_00n);
  });

  it("rounds VAT on an awkward figure the way a calculator does", () => {
    // R333,33 × 15% = R49,99950 → R50,00
    expect(applyPercent(money(333_33n), percentFromRate(15))).toBe(50_00n);
  });
});

describe("derived indicators — cost per unit, cost per m² (§5.2)", () => {
  it("matches the worked example in the source: R186 420 000,00 over 1 046 units", () => {
    expect(perUnit(money(186_420_000_00n), parseQuantity("1046"))).toBe(178_221_80n);
  });

  it("divides a whole figure exactly: R1 000 000,00 over 4 units", () => {
    expect(perUnit(money(1_000_000_00n), parseQuantity("4"))).toBe(250_000_00n);
  });

  it("rounds a half away from zero, as a hand calculation would", () => {
    // R1,00 over 8 units = R0,125 → R0,13, not R0,12.
    expect(perUnit(money(1_00n), parseQuantity("8"))).toBe(13n);
  });

  it("refuses a quantity of nought rather than returning a figure", () => {
    // Nought units is not a scheme with an infinite cost per unit — it is a figure nobody has
    // established, and the screen has to say so rather than print something.
    expect(() => perUnit(money(1_000_00n), parseQuantity("0"))).toThrow(RangeError);
    expect(() => perUnit(money(1_000_00n), parseQuantity("-3"))).toThrow(RangeError);
  });

  it("never differs from the exact quotient by more than half a minor unit", () => {
    fc.assert(
      fc.property(arbMoney, fc.bigInt({ min: 1n, max: 1_000_000_000n }).map(quantity), (a, q) => {
        const scaled = a * 10_000n;
        const exactTimes2 = scaled * 2n;
        const resultTimes2 = perUnit(a, q) * q * 2n;
        const drift = exactTimes2 - resultTimes2;
        return (drift < 0n ? -drift : drift) <= q;
      }),
      { numRuns: 500 },
    );
  });

  it("multiplies a whole unit count by an average area exactly — 1 046 × 48 m² GFA", () => {
    const gfa = multiplyQuantities(parseQuantity("1046"), parseQuantity("48"));
    expect(formatQuantity(gfa)).toBe(nb("50 208,00"));
  });

  it("keeps four decimal places on an average area that has them", () => {
    // 100 units averaging 47,5525 m² is 4 755,25 m², not 4 755.
    const gfa = multiplyQuantities(parseQuantity("100"), parseQuantity("47.5525"));
    expect(gfa).toBe(4_755_2500n);
  });

  it("gives a cost per m² a QS can reproduce from the two figures on screen", () => {
    const gfa = multiplyQuantities(parseQuantity("1046"), parseQuantity("48"));
    // R186 420 000,00 over 50 208 m² = R3 712,9541… → R3 712,95
    expect(formatMoney(perUnit(money(186_420_000_00n), gfa))).toBe(nb("3 712,95"));
  });

  it("is exact for any whole unit count, whatever the average area", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 100_000n }),
        fc.bigInt({ min: 1n, max: 10_000_000n }),
        (units, areaScaled) =>
          multiplyQuantities(quantity(units * 10_000n), quantity(areaScaled)) ===
          units * areaScaled,
      ),
      { numRuns: 500 },
    );
  });
});

describe("parsing", () => {
  it("round-trips money through formatting", () => {
    fc.assert(
      fc.property(arbMoney, (amount) => parseMoney(formatMoney(amount)) === amount),
      { numRuns: 1000 },
    );
  });

  it("round-trips accounting-formatted negatives, which is how omissions print", () => {
    fc.assert(
      fc.property(arbMoney, (amount) => {
        const formatted = formatMoney(amount, { accounting: true });
        return parseMoney(formatted) === amount;
      }),
      { numRuns: 1000 },
    );
  });

  it("accepts both decimal marks, because pasted data carries either", () => {
    expect(parseMoney("1234,56")).toBe(parseMoney("1234.56"));
  });

  it("accepts thousands separators and bracketed negatives from a paste", () => {
    expect(parseMoney("1 234 567,89")).toBe(1_234_567_89n);
    expect(parseMoney("(1 234,56)")).toBe(-1_234_56n);
    expect(parseMoney("-1234.56")).toBe(-1_234_56n);
  });

  it("truncates excess precision rather than silently rounding it", () => {
    // 5 places arriving into a 4-place column. Truncating keeps the input visible as wrong;
    // rounding would hide it from whoever pasted it.
    expect(parseQuantity("1.23456")).toBe(parseQuantity("1.2345"));
  });

  it("rejects input that is not a number, rather than coercing to zero", () => {
    for (const bad of ["", "  ", "abc", "1.2.3", "1,2,3", "R100"]) {
      expect(() => parseMoney(bad)).toThrow();
    }
  });

  it("never goes through a JS number — precision survives beyond 2^53", () => {
    // 90 071 992 547 409,91 in cents exceeds Number.MAX_SAFE_INTEGER. A float-based
    // implementation loses the last digits here; this must not.
    const huge = "90071992547409.91";
    expect(formatMoney(parseMoney(huge))).toBe(nb("90 071 992 547 409,91"));
  });
});

describe("formatting (§7.4, §7.7)", () => {
  it("groups thousands and uses a comma decimal mark", () => {
    expect(formatMoney(money(1_234_567_89n))).toBe(nb("1 234 567,89"));
  });

  it("renders negatives in brackets for the grid's money cell", () => {
    expect(formatMoney(money(-1_234_56n), { accounting: true })).toBe(nb("(1 234,56)"));
  });

  it("places the currency symbol before the figure", () => {
    expect(formatMoney(money(1_234_56n), { symbol: "R" })).toBe(nb("R 1 234,56"));
  });

  it("trims trailing zeros on quantities without losing stored precision", () => {
    expect(formatQuantity(parseQuantity("12.3500"))).toBe("12,35");
    expect(formatQuantity(parseQuantity("4"))).toBe("4,00");
    expect(formatQuantity(parseQuantity("4"), 0)).toBe("4");
    expect(formatQuantity(parseQuantity("0.0001"))).toBe("0,0001");
  });

  it("always shows two decimals on money, even when whole", () => {
    expect(formatMoney(money(100_00n))).toBe("100,00");
    expect(formatMoney(money(0n))).toBe("0,00");
  });
});

describe("a bill that a QS could check by hand", () => {
  it("totals a small bill exactly as the printed column would", () => {
    const lines = [
      { qty: "125.50", rate: "185.00" }, // 23 217,50
      { qty: "48.75", rate: "1250.00" }, //  60 937,50
      { qty: "1", rate: "45000.00" }, //     45 000,00
      { qty: "2340", rate: "12.45" }, //     29 133,00
    ];

    const amounts = lines.map((l) => extend(parseQuantity(l.qty), parseRate(l.rate)));

    expect(amounts.map((a) => formatMoney(a))).toEqual(
      ["23 217,50", "60 937,50", "45 000,00", "29 133,00"].map(nb),
    );

    const net = sum(amounts);
    expect(formatMoney(net)).toBe(nb("158 288,00"));

    const vat = applyPercent(net, percentFromRate(15));
    expect(formatMoney(vat)).toBe(nb("23 743,20"));

    expect(formatMoney(sum([net, vat]))).toBe(nb("182 031,20"));
  });
});

/**
 * The rate build-up — §4.8, and the arithmetic that produces a rate rather than an amount.
 *
 * These sit here rather than beside the screen for the reason §5.4 gives: this is the paranoid
 * layer, and a build-up feeds every extension on every row it is applied to. A rate a cent out is
 * a bill thousands of rand out.
 */
describe("rate build-up (§4.8)", () => {
  it("works one cubic metre of concrete exactly as the paper would", () => {
    const worked = buildUpRate(
      [
        { quantity: parseQuantity("0.35"), rate: parseRate("2400.00") }, // cement
        { quantity: parseQuantity("0.7"), rate: parseRate("180.00") }, //  sand
        { quantity: parseQuantity("2.5"), rate: parseRate("85.00") }, //   labour
      ],
      percent(500n), //  waste 5%
      percent(1200n), // markup 12%
    );

    expect(worked.lines.map((line) => formatMoney(line))).toEqual(["840,00", "126,00", "212,50"]);
    expect(formatMoney(worked.net)).toBe(nb("1 178,50"));

    // 1 178,50 × 0,05 = 58,925 — a half, and it rounds away from zero the way a calculator does.
    expect(formatMoney(worked.waste)).toBe("58,93");

    // The markup is on delivered cost, so it is taken on net + waste: 1 237,43 × 0,12 = 148,4916.
    expect(formatMoney(worked.markup)).toBe("148,49");

    expect(formatRate(worked.rate)).toBe(nb("1 385,92"));
  });

  it("adds up: the rate is always net plus waste plus markup, exactly", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            q: fc.bigInt({ min: 0n, max: 1_000_0000n }),
            r: fc.bigInt({ min: 0n, max: 10_000_00n }),
          }),
          { maxLength: 8 },
        ),
        fc.bigInt({ min: 0n, max: 10000n }),
        fc.bigInt({ min: 0n, max: 10000n }),
        (lines, waste, markup) => {
          const worked = buildUpRate(
            lines.map((line) => ({ quantity: quantity(line.q), rate: rate(line.r) })),
            percent(waste),
            percent(markup),
          );

          // No fourth figure appears from anywhere, and nothing re-rounds the sum.
          expect(worked.rate.value).toBe(worked.net + worked.waste + worked.markup);
          expect(worked.net).toBe(sum([...worked.lines]));
          expect(worked.rate.precision).toBe(2);
        },
      ),
    );
  });

  it("a build-up of nothing is nought, and says so at the money scale", () => {
    const worked = buildUpRate([], percent(1500n), percent(1500n));
    expect(worked.rate.value).toBe(0n);
    expect(formatRate(worked.rate)).toBe("0,00");
  });

  it("keeps a component's own precision — 55 bricks at R1,8500 is exact", () => {
    const worked = buildUpRate(
      [{ quantity: parseQuantity("55"), rate: parseRate("1.8500", 4) }],
      percent(0n),
      percent(0n),
    );
    expect(formatMoney(worked.net)).toBe("101,75");
  });

  it("rounds each component the way the printed column does, then adds", () => {
    // Two lines of 0,005 each. Rounded per line they are 0,01 + 0,01 = 0,02; carried at full
    // precision to the end they would be 0,01. The paper says 0,02, so this must too.
    const worked = buildUpRate(
      [
        { quantity: parseQuantity("0.5"), rate: parseRate("0.01") },
        { quantity: parseQuantity("0.5"), rate: parseRate("0.01") },
      ],
      percent(0n),
      percent(0n),
    );
    expect(formatMoney(worked.net)).toBe("0,02");
  });
});

describe("adjusting a rate by a percentage (§4.8)", () => {
  it("moves a rate up and down by the figure a QS typed", () => {
    expect(formatRate(adjustRate(parseRate("1850.00"), percent(800n)))).toBe(nb("1 998,00"));
    expect(formatRate(adjustRate(parseRate("1850.00"), percent(-800n)))).toBe(nb("1 702,00"));
  });

  it("keeps the rate's own precision, which is the point of §5.1's four places", () => {
    const adjusted = adjustRate(parseRate("1.8500", 4), percent(1000n));
    expect(adjusted.precision).toBe(4);
    expect(formatRate(adjusted)).toBe("2,0350");

    // Flattened to two places this would be R2,04 — a fifth of a cent per brick, across a bill of
    // a million bricks.
    expect(formatRate(rate(adjusted.value, 4))).not.toBe("2,04");
  });

  it("a nought adjustment changes nothing at all", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -10_000_00n, max: 10_000_00n }), (value) => {
        expect(adjustRate(rate(value), percent(0n)).value).toBe(value);
      }),
    );
  });

  it("-100% takes a rate to nought and never past it", () => {
    expect(adjustRate(parseRate("1850.00"), percent(-10000n)).value).toBe(0n);
  });
});

describe("percentages, read and written back (§5.1)", () => {
  it("round-trips the fixed-scale decimal a numeric(6,4) column holds", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -999999n, max: 999999n }), (scaled) => {
        expect(parsePercent(percentToNumeric(percent(scaled)))).toBe(percent(scaled));
      }),
    );
  });

  it("writes a percentage the way a person says it", () => {
    expect(formatPercent(percent(1500n))).toBe("15");
    expect(formatPercent(percent(500n))).toBe("5");
    expect(formatPercent(percent(1250n))).toBe("12,5");
    expect(formatPercent(percent(0n))).toBe("0");
    expect(percentToNumeric(percent(1500n))).toBe("0.1500");
  });
});

describe("money with its currency on it", () => {
  it("puts the symbol before the digits", () => {
    expect(formatRand(money(123456n))).toBe(`R\u00a01\u00a0234,56`);
  });

  it("puts the sign before the symbol, not between it and the digits", () => {
    /*
      `R -24 224 386,96` is what hand-written concatenation gives, and it is not how anybody writes
      money — the sign belongs to the amount. It was written wrong in three separate files before
      it was written once here, and this is what stops a fourth.
    */
    expect(formatRand(money(-2422438696n))).toBe(`\u2212R\u00a024\u00a0224\u00a0386,96`);
  });

  it("groups with the non-breaking space §7.7 asks for", () => {
    // Not cosmetic: an ordinary space lets a figure wrap across a line break mid-number.
    expect(formatRand(money(100000000n))).toContain("\u00a0");
    expect(formatRand(money(100000000n))).not.toMatch(/\d \d/);
  });

  it("still brackets a negative in accounting form", () => {
    expect(formatMoney(money(-123456n), { accounting: true, symbol: "R" })).toBe(
      `(R\u00a01\u00a0234,56)`,
    );
  });
});

describe("formatUnitRate — money says it is rands, and a rate says what it is per", () => {
  it("writes a rate as R, two decimals and its unit", () => {
    expect(formatUnitRate(rate(15000n, 2), "hour")).toBe("R 150,00/hour");
    expect(formatUnitRate(rate(125000n, 2), "m2")).toBe("R 1 250,00/m²");
  });

  it("keeps extra decimals only where the rate has them", () => {
    expect(formatUnitRate(rate(450n, 4), "l")).toBe("R 0,045/l");
    expect(formatUnitRate(rate(9500000n, 4), "m3")).toBe("R 950,00/m³");
  });

  it("puts the sign in front of the R", () => {
    expect(formatUnitRate(rate(-1000n, 2), "no")).toBe("−R 10,00/no");
  });

  it("writes m2 and m3 as a reader does, and leaves other units alone", () => {
    expect(displayUnit("m2")).toBe("m²");
    expect(displayUnit("M3")).toBe("m³");
    expect(displayUnit("hour")).toBe("hour");
  });

  it("writes them inside a typed phrase too, as a whole token only", () => {
    expect(displayUnit("m2 gross floor area")).toBe("m² gross floor area");
    expect(displayUnit("GFA (sqm)")).toBe("GFA (m²)");
    expect(displayUnit("R/m^2")).toBe("R/m²");
    expect(displayUnit("m3 of concrete")).toBe("m³ of concrete");
    expect(displayUnit("m of boundary wall")).toBe("m of boundary wall");
    // Not a unit: inside another word, or a reference like "Block M2A".
    expect(displayUnit("Block M2A")).toBe("Block M2A");
    expect(displayUnit("mm2")).toBe("mm2");
  });
});
