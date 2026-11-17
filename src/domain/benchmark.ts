/**
 * A figure against what the market publishes — D1.1.
 *
 * ── The question this answers ──────────────────────────────────────────────────────────────
 *
 * The practice's own mapping of the QS scope says it twice: an order-of-magnitude estimate and an
 * elemental cost plan are both things "the QS will create and we will compare to market/industry
 * standard". The platform held the market figures — 108 rates out of the AECOM guide, with the
 * BER and CPAP tender escalation beside them — and had nothing that compared anything to them.
 * A reader could look the band up and do the arithmetic in their head.
 *
 * ── Three rules it will not break ──────────────────────────────────────────────────────────
 *
 * **A range stays a range.** The guide prints R11 300 to R13 900 per m² because that is what the
 * data supports. The midpoint of that is a number nobody published, and comparing against one
 * would manufacture a precision the source does not have. So a figure is inside the band or
 * outside it, and "outside" is measured from the edge it passed, never from a middle.
 *
 * **A rate is a fact about a date.** The guide's rates are at 1 July 2025. Comparing a 2027
 * estimate against them without saying so is the same error as a bill with no base date — it reads
 * as a verdict when it is an anachronism. The band is escalated to the year being compared, on the
 * guide's own published index, and the comparison carries both the year and the factor it used.
 *
 * **It is an observation, never a correction.** Nothing here adjusts an estimate or refuses one. A
 * scheme genuinely below the band may be a cheap specification, a tight site, or a mistake, and
 * which of those it is cannot be read off a number. The comparison says where the figure sits and
 * what the band is; a quantity surveyor says what it means.
 */

import { escalationFor, type PublishedRate } from "@/lib/published-cost-data";

export type Standing = "below" | "within" | "above";

export interface Comparison {
  /** Where the figure sits against the escalated band. */
  standing: Standing;
  /** The band as compared against, escalated — cents. */
  low: number;
  high: number;
  /** Cents past the edge it crossed. Nought where it sits inside. */
  outside: number;
  /** That distance as a share of the edge it crossed, in basis points. Null where inside. */
  share: number | null;
  /** The year the band was escalated to, and the factor used — thousandths, 1 000 = no change. */
  escalatedTo: number;
  factor: number;
  /** Whether the escalation rests on the guide's forecast rather than a published index. */
  forecast: boolean;
}

/**
 * The guide's rates are at this date, and every comparison is escalated from it.
 *
 * Read from the data rather than restated, so the two cannot drift apart: a new edition moves the
 * date, and every comparison moves with it.
 */
export const BASE_YEAR = 2025;

/**
 * Escalate a band from the guide's base year to `year`, on the published BER index.
 *
 * BER rather than CPAP, because BER is a *tender price* index — what the market is charging — and
 * that is what a published building rate is. CPAP tracks input costs, which is the right index for
 * a contract's escalation clause and the wrong one for this.
 *
 * Returns a factor in thousandths. 1 000 where the year is the base year or the index has nothing
 * to say about it, which leaves the band exactly as the guide printed it.
 */
export function escalationFactor(year: number): { factor: number; forecast: boolean } {
  const base = escalationFor(BASE_YEAR);
  const target = escalationFor(year);
  if (!base || !target || base.berIndex === 0) return { factor: 1_000, forecast: false };
  return {
    factor: Math.round((target.berIndex / base.berIndex) * 1_000),
    // A comparison resting on a forecast says so; the guide marks which years those are.
    forecast: target.forecast,
  };
}

/**
 * Where a rate sits against a published band, escalated to the year being compared.
 *
 * `rate` and the band are cents per the band's own unit — per m² for a building rate, per key for
 * a hotel. Comparing a per-m² figure against a per-key band is the caller's error to avoid; this
 * carries the unit through so the page can print it and a reader can see they match.
 */
export function compare(rate: number, band: Pick<PublishedRate, "low" | "high">, year: number): Comparison {
  const { factor, forecast } = escalationFactor(year);
  const low = Math.round((band.low * factor) / 1_000);
  const high = Math.round((band.high * factor) / 1_000);

  if (rate < low) {
    return {
      standing: "below",
      low,
      high,
      outside: low - rate,
      // Of the edge it crossed, not of the rate: "12% under the bottom of the band" is a statement
      // about the band, and the band is the thing the reader is being asked to judge against.
      share: low === 0 ? null : Math.round(((low - rate) / low) * 10_000),
      escalatedTo: year,
      factor,
      forecast,
    };
  }
  if (rate > high) {
    return {
      standing: "above",
      low,
      high,
      outside: rate - high,
      share: high === 0 ? null : Math.round(((rate - high) / high) * 10_000),
      escalatedTo: year,
      factor,
      forecast,
    };
  }
  return { standing: "within", low, high, outside: 0, share: null, escalatedTo: year, factor, forecast };
}

/**
 * The bands worth offering for a figure, nearest first — never a single "best match".
 *
 * A guess at *which* building type a scheme is would be the platform having an opinion about the
 * design, and it would be wrong exactly where it mattered: a residential estate with a clubhouse
 * and retail is three of these lines at once. So the categories are offered and a quantity
 * surveyor picks. `within` is listed first only so the reader can see at a glance whether any
 * published band contains their figure at all.
 */
export function bandsFor(
  rate: number,
  rates: readonly PublishedRate[],
  year: number,
  unit: PublishedRate["unit"],
): { rate: PublishedRate; comparison: Comparison }[] {
  return rates
    .filter((r) => r.unit === unit)
    .map((r) => ({ rate: r, comparison: compare(rate, r, year) }))
    .sort((a, b) => {
      if (a.comparison.standing === "within" && b.comparison.standing !== "within") return -1;
      if (b.comparison.standing === "within" && a.comparison.standing !== "within") return 1;
      return a.comparison.outside - b.comparison.outside;
    });
}
