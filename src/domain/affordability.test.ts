import { describe, expect, it } from "vitest";

import { affordabilityEnvelope, annuityFactor } from "./affordability";
import { money, type Money } from "./money";

/** Rand to minor units, for readable cases. */
const R = (rand: number): Money => money(BigInt(Math.round(rand * 100)));

/** Minor units back to whole rand, for comparing against v3, which computes in whole rand. */
const asRand = (amount: Money) => Math.round(Number(amount) / 100);

const RIDGEVIEW = {
  incomeBandMin: R(8_000),
  incomeBandMax: R(30_000),
  primeRatePa: 0.1175,
  lendingMarginPa: 0,
  bondTermYears: 20,
  instalmentToIncomePct: 30,
  deposit: R(0),
  subsidyQuantum: R(121_626),
};

describe("annuityFactor", () => {
  it("is the present value of a monthly instalment of 1", () => {
    // (1 - 1.0097916…^-240) / 0.0097916…
    expect(annuityFactor(0.1175, 20)).toBeCloseTo(92.2758589, 6);
  });

  it("is simply the number of months at a rate of nought", () => {
    // The limit as i → 0, taken explicitly. An interest-free facility is a real instrument, not a
    // division by zero to be defended against.
    expect(annuityFactor(0, 10)).toBe(120);
  });

  it("falls as the rate rises — a dearer bond buys less", () => {
    expect(annuityFactor(0.15, 20)).toBeLessThan(annuityFactor(0.1175, 20));
  });

  it("rises with the term", () => {
    expect(annuityFactor(0.1175, 30)).toBeGreaterThan(annuityFactor(0.1175, 20));
  });

  it("treats a term under a year as one year rather than as nothing", () => {
    expect(annuityFactor(0.1175, 0)).toBe(annuityFactor(0.1175, 1));
  });
});

/**
 * Parity with the engine this was ported from.
 *
 * v3's `affordability.py` was run directly to produce these figures, rather than recomputed by
 * hand here — a port checked against its author's arithmetic instead of against the original is
 * checking the wrong thing. v3 rounds to whole rand and this platform holds cents, so the
 * comparison is at rand and the cent figures are locked separately below.
 */
describe("parity with v3", () => {
  it("matches v3 on the Ridgeview band", () => {
    const e = affordabilityEnvelope(RIDGEVIEW);

    expect(asRand(e.supportableBondMin)).toBe(221_462);
    expect(asRand(e.supportableBondMax)).toBe(830_483);
    expect(asRand(e.ceilingMin)).toBe(343_088);
    expect(asRand(e.ceilingMax)).toBe(952_109);
  });

  it("matches v3 with a lender's margin, a longer term and a deposit", () => {
    const e = affordabilityEnvelope({
      incomeBandMin: R(12_000),
      incomeBandMax: R(22_000),
      primeRatePa: 0.1075,
      lendingMarginPa: 0.02,
      bondTermYears: 25,
      instalmentToIncomePct: 28,
      deposit: R(50_000),
      subsidyQuantum: R(0),
    });

    expect(e.bondRatePa).toBeCloseTo(0.1275, 10);
    expect(asRand(e.supportableBondMin)).toBe(302_961);
    expect(asRand(e.supportableBondMax)).toBe(555_429);
    expect(asRand(e.ceilingMax)).toBe(605_429);
  });

  /**
   * ── Deliberately NOT matching v3 ──────────────────────────────────────────────────────
   *
   * v3 reads its inputs as `float(prime_rate_pa or 0.1175)`, and `0.0 or 0.1175` is `0.1175` in
   * Python — nought is falsy. So asking v3 for a genuine interest-free facility silently gets an
   * 11,75% one: R10 000 a month over ten years came back as R211 224 rather than R360 000, with
   * nothing said. `bond_term_years or 20` and `installment_to_income_pct or 30.0` have the same
   * defect.
   *
   * A port that reproduced this would be carrying a bug across on purpose. The rate is used as
   * given, so nought means nought.
   */
  it("gives a genuine interest-free bond its real value, where v3 substitutes prime", () => {
    const e = affordabilityEnvelope({
      incomeBandMin: R(10_000),
      incomeBandMax: R(10_000),
      primeRatePa: 0,
      lendingMarginPa: 0,
      bondTermYears: 10,
      instalmentToIncomePct: 30,
      deposit: R(0),
      subsidyQuantum: R(0),
    });

    // R10 000 × 30% × 120 months, with no interest to discount.
    expect(asRand(e.supportableBondMax)).toBe(360_000);
    expect(asRand(e.supportableBondMax)).not.toBe(211_224); // what v3 returns
  });
});

describe("the envelope", () => {
  it("holds money as minor units, never as a float", () => {
    const e = affordabilityEnvelope(RIDGEVIEW);

    for (const amount of [e.supportableBondMin, e.supportableBondMax, e.ceilingMin, e.ceilingMax]) {
      expect(typeof amount).toBe("bigint");
    }
  });

  it("locks the cent-level figures, so a refactor that changes the rounding is visible", () => {
    const e = affordabilityEnvelope(RIDGEVIEW);
    expect(e.supportableBondMin).toBe(22_146_206n);
    expect(e.ceilingMax).toBe(95_210_873n);
  });

  it("adds the deposit and the subsidy to the bond exactly", () => {
    const e = affordabilityEnvelope(RIDGEVIEW);
    expect(e.ceilingMin).toBe(e.supportableBondMin + R(121_626));
    expect(e.ceilingMax).toBe(e.supportableBondMax + R(121_626));
  });

  it("tests a unit cost against the top of the band, not the floor", () => {
    // The floor would fail every scheme that sells to more than one income, which is every scheme.
    const e = affordabilityEnvelope(RIDGEVIEW);
    expect(e.ceilingPerUnit).toBe(e.ceilingMax);
  });

  it("rises with income", () => {
    const poorer = affordabilityEnvelope({ ...RIDGEVIEW, incomeBandMax: R(20_000) });
    const richer = affordabilityEnvelope({ ...RIDGEVIEW, incomeBandMax: R(40_000) });
    expect(richer.ceilingMax).toBeGreaterThan(poorer.ceilingMax);
  });

  it("falls as borrowing gets dearer", () => {
    const cheap = affordabilityEnvelope({ ...RIDGEVIEW, primeRatePa: 0.09 });
    const dear = affordabilityEnvelope({ ...RIDGEVIEW, primeRatePa: 0.15 });
    expect(dear.ceilingMax).toBeLessThan(cheap.ceilingMax);
  });

  it("counts the lender's margin as part of the rate", () => {
    const flat = affordabilityEnvelope({ ...RIDGEVIEW, primeRatePa: 0.1375, lendingMarginPa: 0 });
    const split = affordabilityEnvelope({ ...RIDGEVIEW, primeRatePa: 0.1175, lendingMarginPa: 0.02 });
    expect(split.ceilingMax).toBe(flat.ceilingMax);
  });

  it("refuses a band whose ceiling is below its floor", () => {
    expect(() =>
      affordabilityEnvelope({ ...RIDGEVIEW, incomeBandMin: R(30_000), incomeBandMax: R(8_000) }),
    ).toThrow(/ceiling is below its floor/);
  });

  it("a band with no width is a single income, not an error", () => {
    const e = affordabilityEnvelope({ ...RIDGEVIEW, incomeBandMin: R(15_000), incomeBandMax: R(15_000) });
    expect(e.ceilingMin).toBe(e.ceilingMax);
  });

  it("an income of nought supports nothing but still carries the subsidy", () => {
    const e = affordabilityEnvelope({ ...RIDGEVIEW, incomeBandMin: R(0), incomeBandMax: R(0) });
    expect(e.supportableBondMax).toBe(0n);
    expect(e.ceilingMax).toBe(R(121_626));
  });
});

/**
 * What the envelope is *for*, on the corpus the platform demonstrates against.
 *
 * Ridgeview's three-bedroom duplex is priced at R995 000 and the band's ceiling is R952 109. That
 * is the finding the whole module exists to produce: the top typology cannot be financed by the
 * top of its own target market. Asserted here so the demonstration keeps saying it.
 */
describe("Ridgeview, as the report will read it", () => {
  const e = affordabilityEnvelope(RIDGEVIEW);

  it("supports the one- and two-bedroom prices", () => {
    expect(R(625_000)).toBeLessThan(e.ceilingPerUnit);
    expect(R(799_000)).toBeLessThan(e.ceilingPerUnit);
  });

  it("does not support the three-bedroom price", () => {
    expect(R(995_000)).toBeGreaterThan(e.ceilingPerUnit);
  });
});
