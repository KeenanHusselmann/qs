/**
 * The affordability envelope — the price ceiling every cost on an affordable scheme is tested
 * against. Ported from v3's `affordability.py`.
 *
 * ── Why this is the first thing computed, and not the last ─────────────────────────────────
 *
 * Affordable housing is **constraint-led**. The selling price is not what the developer would like
 * to charge and then justify; it is capped by what the target household can actually finance. So
 * the envelope is derived from the buyer's income first, and the cost stack is then tested against
 * it — which is why v3's report opens with it and calls it "the binding input".
 *
 * A scheme that costs more per unit than its buyers can borrow is not a scheme with a marketing
 * problem. It is not viable, and the arithmetic that says so is this.
 *
 *     qualifying instalment = gross monthly income × instalment-to-income ratio
 *     supportable bond      = present value of that instalment over the term, at the lending rate
 *     ceiling               = supportable bond + deposit + subsidy
 *
 * ── Money, not floats ──────────────────────────────────────────────────────────────────────
 *
 * v3 computes in Python floats throughout. This platform holds money as `bigint` minor units
 * (§5.1) precisely because `0.1 + 0.2 !== 0.3` in a certificate is one of §14's named ways this
 * project fails, so the port does not carry the float arithmetic across with the formula.
 *
 * The annuity factor is the one genuinely transcendental step — it involves a power — so it is
 * computed in floating point and then applied to a bigint amount **once**, with a single rounding
 * at the end. §5.2's rule is "round once", not "never touch a float": what matters is that no
 * intermediate money value is held as a float and no sum is re-rounded.
 *
 * ── There is no default lending rate ───────────────────────────────────────────────────────
 *
 * v3 defaults `prime_rate_pa` to 0.1175. This port requires it. A rate baked into the engine is
 * still correct on the day it is written and silently wrong every day after; §1.3.1 asks that a
 * figure trace to something, and "the prime rate as at a stated date" is a thing that can be
 * traced where "whatever was hard-coded in 2026" is not. The caller supplies it with its source.
 */

import { divideRounded, money, type Money } from "@/domain/money";

/** What the envelope is computed from. Every one of these is somebody's stated assumption. */
export interface AffordabilityInputs {
  /** Gross household income per month — the floor of the target band. */
  incomeBandMin: Money;
  /** Gross household income per month — the ceiling of the target band. */
  incomeBandMax: Money;
  /** SARB prime, as a fraction: 11,75% is `0.1175`. Required — see the note above. */
  primeRatePa: number;
  /** The lender's margin over prime, as a fraction. */
  lendingMarginPa: number;
  /** Bond term in years. */
  bondTermYears: number;
  /** The most of gross income a lender will let go to the bond, as a whole percentage. */
  instalmentToIncomePct: number;
  /** Cash the purchaser puts in. */
  deposit: Money;
  /** Capital subsidy — FLISP or another grant — per qualifying household. */
  subsidyQuantum: Money;
}

export interface AffordabilityEnvelope {
  /** Prime plus the margin, as a fraction. */
  bondRatePa: number;
  /** What the band's floor income can borrow. */
  supportableBondMin: Money;
  /** What the band's ceiling income can borrow. */
  supportableBondMax: Money;
  ceilingMin: Money;
  ceilingMax: Money;
  /**
   * The hard cap a unit cost is tested against.
   *
   * The **top** of the band, deliberately: a scheme priced above this cannot be financed by anyone
   * in its own target market, which is the failure the gate exists to catch. Testing against the
   * floor instead would fail every scheme that sells to more than one income.
   */
  ceilingPerUnit: Money;
}

/**
 * Nine decimal places of a ratio, which is far more than the inputs justify.
 *
 * The factor is a pure ratio — a number around 90 for a twenty-year bond — not a currency, so it
 * has no minor unit of its own. Scaling it to an integer lets the multiplication happen in bigint
 * so that only the final division rounds.
 */
const FACTOR_SCALE = 1_000_000_000;

/**
 * Present value of a level monthly instalment of 1 — the annuity factor.
 *
 * `(1 - (1 + i)^-n) / i`, the standard ordinary-annuity present value. At a rate of nought the
 * limit is simply `n`, and taking it explicitly avoids dividing by zero for a subsidised or
 * interest-free facility, which is a real instrument rather than a defensive branch.
 */
export function annuityFactor(ratePa: number, termYears: number): number {
  const months = Math.max(Math.trunc(termYears), 1) * 12;
  const monthly = ratePa / 12;

  if (monthly <= 0) return months;
  return (1 - (1 + monthly) ** -months) / monthly;
}

/**
 * Apply a plain ratio to an amount of money, rounding once.
 *
 * The factor is checked rather than trusted: `Infinity` or `NaN` reaching `BigInt()` throws a
 * `RangeError` whose message says nothing about affordability, and a silently vast factor would
 * produce a ceiling that looks like a number and is not one.
 */
function timesFactor(amount: Money, factor: number): Money {
  if (!Number.isFinite(factor)) {
    throw new RangeError(`Affordability factor is not a finite number: ${factor}`);
  }

  return money(divideRounded(amount * BigInt(Math.round(factor * FACTOR_SCALE)), BigInt(FACTOR_SCALE)));
}

/**
 * The envelope.
 *
 * Note where the rounding is. The bond is rounded once, from the income and the combined
 * ratio-times-factor; the ceiling then adds two amounts that are already exact minor units. v3
 * computes the ceiling from the *unrounded* bond and rounds afterwards, so the two agree to the
 * cent rather than differing by a rounding of a rounding — which is §5.2's rule stated the other
 * way round.
 */
export function affordabilityEnvelope(inputs: AffordabilityInputs): AffordabilityEnvelope {
  const {
    incomeBandMin,
    incomeBandMax,
    primeRatePa,
    lendingMarginPa,
    bondTermYears,
    instalmentToIncomePct,
    deposit,
    subsidyQuantum,
  } = inputs;

  if (incomeBandMax < incomeBandMin) {
    throw new RangeError("The income band's ceiling is below its floor");
  }

  const bondRatePa = primeRatePa + lendingMarginPa;

  // One factor, applied once: the share of income that may service a bond, multiplied by what a
  // unit of monthly instalment is worth today. Combining them before touching the money is what
  // keeps a single rounding.
  const factor = (instalmentToIncomePct / 100) * annuityFactor(bondRatePa, bondTermYears);

  const supportableBondMin = timesFactor(incomeBandMin, factor);
  const supportableBondMax = timesFactor(incomeBandMax, factor);

  const ceilingMin = money(supportableBondMin + deposit + subsidyQuantum);
  const ceilingMax = money(supportableBondMax + deposit + subsidyQuantum);

  return {
    bondRatePa,
    supportableBondMin,
    supportableBondMax,
    ceilingMin,
    ceilingMax,
    ceilingPerUnit: ceilingMax,
  };
}
