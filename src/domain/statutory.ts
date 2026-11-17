/**
 * South African statutory schedules, ported from v3's `statutory_tables.py`.
 *
 * ── Dated, deliberately ────────────────────────────────────────────────────────────────────
 *
 * Every table here carries the date it took effect, and every figure derived from one carries
 * that date with it. A transfer duty table changes each February in the Budget, and a report
 * regenerated in 2027 that quietly re-costed a 2026 acquisition on the new scale would be a
 * different report with the same reference on it. §5.3 makes the same point about VAT: a 2026
 * certificate must still reproduce exactly if the rate changes in 2027.
 *
 * This is why these are schedules with dates rather than constants: the answer to "why is this
 * figure what it is" has to survive the table moving underneath it.
 *
 * ── Money, not floats ──────────────────────────────────────────────────────────────────────
 *
 * v3 computes in Python floats. §5.1 holds money as bigint minor units, so the brackets are
 * expressed in cents and the marginal rate is applied once, with a single rounding.
 */

import { divideRounded, money, type Money } from "@/domain/money";

/** Rand to minor units, for declaring a bracket readably. */
const R = (rand: number): Money => money(BigInt(Math.round(rand * 100)));

/** When SARS's residential transfer-duty scale below took effect. */
export const TRANSFER_DUTY_TABLE_DATE = "2025-03-01";

/** When the NHBRC enrolment schedule below took effect. */
export const NHBRC_TABLE_DATE = "2024-04-01";

/**
 * SARS residential transfer duty — the 2025/26 sliding scale.
 *
 * Each bracket carries the cumulative duty at its lower bound, so duty is the base plus the
 * marginal rate on the excess. Expressed as basis points to keep the arithmetic in integers:
 * 3% is 300, and the multiply-then-divide rounds once.
 */
/*
  ── Known: two brackets do not meet the one below them ─────────────────────────────────

  At R3 109 500 the 8% bracket reaches R115 960 and the 11% bracket's tabled base is R115 948.
  At R11 000 000 the 11% bracket reaches R983 903 and the 13% bracket's base is R983 236. Duty
  therefore falls by R1 and by R667 as value crosses those two boundaries. v3 carries the same
  figures, so this is the table as transcribed rather than an error introduced in the port.

  Left as it stands on purpose. Guessing at a bracket to smooth the curve would be inventing tax
  law, and the figure it produced would look authoritative on a cost build-up. `statutory.test.ts`
  pins the behaviour so it cannot change unnoticed, and it wants checking against the published
  SARS table.
*/
const TRANSFER_DUTY = [
  { upTo: R(1_210_000), basisPoints: 0n, base: R(0) },
  { upTo: R(1_663_800), basisPoints: 300n, base: R(0) },
  { upTo: R(2_329_300), basisPoints: 600n, base: R(13_614) },
  { upTo: R(3_109_500), basisPoints: 800n, base: R(53_544) },
  { upTo: R(11_000_000), basisPoints: 1_100n, base: R(115_948) },
  { upTo: null, basisPoints: 1_300n, base: R(983_236) },
] as const;

/** The lower bound of each bracket, which is the previous bracket's ceiling. */
const LOWER_BOUNDS: readonly Money[] = TRANSFER_DUTY.map((_, i) =>
  i === 0 ? money(0n) : (TRANSFER_DUTY[i - 1].upTo as Money),
);

/**
 * Transfer duty on a residential property.
 *
 * Nought below the nil-rate band, which is a real outcome rather than a missing figure — a great
 * many affordable-housing sites fall inside it.
 */
export function transferDuty(value: Money): Money {
  if (value <= 0n) return money(0n);

  for (const [i, bracket] of TRANSFER_DUTY.entries()) {
    if (bracket.upTo === null || value <= bracket.upTo) {
      const excess = value - LOWER_BOUNDS[i];
      return money(bracket.base + divideRounded(excess * bracket.basisPoints, 10_000n));
    }
  }

  return money(0n);
}

export interface AcquisitionTax {
  amount: Money;
  /** Why it is what it is, for the line's basis on the report. */
  basis: string;
}

/**
 * The land-acquisition tax fork.
 *
 * A VAT vendor recovers input VAT and pays no transfer duty, so the answer is nought *for a
 * reason* — not an absent figure. The basis says which, because "R 0" with no explanation on a
 * development cost build-up reads as an omission.
 */
export function acquisitionTax(landValue: Money, vatVendor: boolean): AcquisitionTax {
  if (vatVendor) {
    return { amount: money(0n), basis: "VAT-input recoverable — no transfer duty" };
  }

  return {
    amount: transferDuty(landValue),
    basis: `SARS transfer duty, table of ${TRANSFER_DUTY_TABLE_DATE}`,
  };
}

/**
 * NHBRC enrolment fee for one home, scaled to its value.
 *
 * The NHBRC publishes a banded schedule that rises with the home's value; this is v3's
 * value-scaled approximation of it, kept identical so the two engines agree. Enrolment is
 * compulsory for a home sold with a warranty, which every unit in an affordable scheme is, so on
 * a thousand-unit scheme this is a seven-figure line and not a rounding.
 */
export function nhbrcEnrolmentFee(homeValue: Money): Money {
  const v = homeValue > 0n ? homeValue : money(0n);

  // Bands in cents, with the marginal rate as basis points of the excess.
  if (v <= R(500_000)) return R(5_940);
  if (v <= R(900_000)) return money(R(5_940) + divideRounded((v - R(500_000)) * 180n, 10_000n));
  if (v <= R(1_500_000)) return money(R(13_140) + divideRounded((v - R(900_000)) * 120n, 10_000n));
  return money(R(20_340) + divideRounded((v - R(1_500_000)) * 80n, 10_000n));
}
