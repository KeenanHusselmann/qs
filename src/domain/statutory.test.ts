import { describe, expect, it } from "vitest";

import { money, type Money } from "./money";
import {
  acquisitionTax,
  nhbrcEnrolmentFee,
  NHBRC_TABLE_DATE,
  transferDuty,
  TRANSFER_DUTY_TABLE_DATE,
} from "./statutory";

const R = (rand: number): Money => money(BigInt(Math.round(rand * 100)));
const asRand = (amount: Money) => Number(amount) / 100;

/**
 * Parity with v3.
 *
 * `statutory_tables.py` was run directly to produce these. A port checked against the porter's own
 * recomputation is checking the wrong thing — and a bracket transcribed one digit out would agree
 * with itself perfectly.
 */
describe("transfer duty — parity with v3", () => {
  it.each([
    [12_000_000, 1_113_236],
    [1_500_000, 8_700],
    [30_000_000, 3_453_236],
  ])("on R%s is R%s", (value, duty) => {
    expect(asRand(transferDuty(R(value)))).toBe(duty);
  });

  it("is nought inside the nil-rate band", () => {
    // Not a missing figure. A great many affordable-housing sites fall inside this band.
    expect(transferDuty(R(1_200_000))).toBe(0n);
    expect(transferDuty(R(1_210_000))).toBe(0n);
  });

  it("starts charging one rand above the band", () => {
    expect(asRand(transferDuty(R(1_210_100)))).toBe(3);
  });

  it("rises with value across the lower boundaries", () => {
    for (const boundary of [1_210_000, 1_663_800, 2_329_300, 3_109_500]) {
      expect(transferDuty(R(boundary + 1_000))).toBeGreaterThan(transferDuty(R(boundary)));
    }
  });

  it("is continuous across the two boundaries that are", () => {
    // A scale that jumped at a bracket would make a property worth R100 more cost thousands more
    // to transfer. These two brackets meet exactly; the two below do not — see the next test.
    for (const boundary of [1_663_800, 2_329_300]) {
      const step = asRand(transferDuty(R(boundary + 100))) - asRand(transferDuty(R(boundary)));
      expect(step).toBeGreaterThanOrEqual(0);
      expect(step).toBeLessThan(50);
    }
  });

  /**
   * ── Two real discontinuities, pinned rather than fixed ───────────────────────────────
   *
   * Duty *falls* at two boundaries. At R3 109 500 the 8% bracket reaches R115 960 and the next
   * bracket's tabled base is R115 948. At R11 000 000 the 11% bracket reaches R983 903 and the
   * top bracket's base is R983 236 — a fall of R667. One figure in each pair is wrong.
   *
   * v3 has it identically — it is a faithful port of the same table, not something introduced
   * here — so this is asserted as it stands rather than corrected. Guessing at a SARS bracket to
   * make a curve smooth would be inventing tax law, and the figure it produces would look
   * authoritative on a development cost build-up.
   *
   * It wants checking against the published table. Until then this test is the record that it is
   * known, and it will fail the moment somebody changes the brackets — which is exactly when the
   * question should be asked again.
   */
  it("steps DOWN at R3,1m and again at R11m, exactly as v3 does", () => {
    // R3 109 500: the 8% bracket reaches R115 960, the 11% bracket's base is R115 948. −R1 net.
    expect(asRand(transferDuty(R(3_109_500)))).toBe(115_960);
    expect(asRand(transferDuty(R(3_109_600)))).toBe(115_959);

    // R11 000 000: the 11% bracket reaches R983 903, the 13% bracket's base is R983 236. −R667.
    expect(asRand(transferDuty(R(11_000_000)))).toBe(983_903);
    expect(asRand(transferDuty(R(11_000_100)))).toBe(983_249);
  });

  it("refuses to invent a duty on a negative value", () => {
    expect(transferDuty(money(-100n))).toBe(0n);
  });
});

describe("the acquisition fork", () => {
  it("charges a non-vendor the duty, and says which table", () => {
    const tax = acquisitionTax(R(12_000_000), false);
    expect(asRand(tax.amount)).toBe(1_113_236);
    expect(tax.basis).toContain(TRANSFER_DUTY_TABLE_DATE);
  });

  it("charges a VAT vendor nothing, and says why", () => {
    // "R 0" with no explanation on a development cost build-up reads as an omission.
    const tax = acquisitionTax(R(12_000_000), true);
    expect(tax.amount).toBe(0n);
    expect(tax.basis).toMatch(/VAT-input recoverable/);
  });
});

describe("NHBRC enrolment — parity with v3", () => {
  it.each([
    [480_000, 5_940],
    [625_000, 8_190],
    [737_558, 10_216.04],
    [799_000, 11_322],
    [995_000, 14_280],
    [1_600_000, 21_140],
  ])("on a home worth R%s is R%s", (value, fee) => {
    expect(asRand(nhbrcEnrolmentFee(R(value)))).toBeCloseTo(fee, 2);
  });

  it("is flat below the first band", () => {
    expect(nhbrcEnrolmentFee(R(100_000))).toBe(nhbrcEnrolmentFee(R(500_000)));
  });

  it("never falls as the home gets dearer", () => {
    let previous = 0n;
    for (const value of [400_000, 500_000, 700_000, 900_000, 1_200_000, 1_500_000, 2_500_000]) {
      const fee = nhbrcEnrolmentFee(R(value));
      expect(fee).toBeGreaterThanOrEqual(previous);
      previous = fee;
    }
  });

  it("matters at scale, which is why it is not a flat per-unit fudge", () => {
    // Ridgeview: 1 046 homes at the scheme's average selling price.
    const total = nhbrcEnrolmentFee(R(737_558)) * 1_046n;
    expect(asRand(money(total))).toBeCloseTo(10_685_977.84, 2);
  });

  it("is dated, so a report can be regenerated on its own assumptions", () => {
    expect(NHBRC_TABLE_DATE).toBe("2024-04-01");
  });
});
