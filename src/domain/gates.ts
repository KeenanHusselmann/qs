/**
 * The feasibility gates — the validation layer. Ported from v3's `gates.py`.
 *
 * ── A gate is a rule, not a score ──────────────────────────────────────────────────────────
 *
 * Each one measures a figure against a threshold and passes or fails. There is no weighting and no
 * total: a scheme that fails the affordability gate is not seventy per cent feasible, it is a
 * scheme whose buyers cannot finance it. v3 reports the **first** failing gate for the same reason
 * — it identifies the single most valuable intervention, where a list of five findings identifies
 * none.
 *
 * ── Six, where the model can run; three where it cannot ────────────────────────────────────
 *
 * Gates 3, 4 and 5 — funding, return, resilience — need the month-by-month cash flow, because
 * none of peak funding, IRR or a downside exists without one. Where `scenarios` is supplied they
 * evaluate; where it is not they report as **not evaluated**, never as passed.
 *
 * That distinction is the whole point. A verdict computed from half the gates and presented as a
 * verdict is worse than no verdict: it would read as "feasible" on a scheme nobody has tested for
 * fundability. So `overall` is only ever reached when every gate has been evaluated, and until then
 * the result says what it could not test.
 *
 * ── Cost and time fail differently ─────────────────────────────────────────────────────────
 *
 * Gates 0–2 test cost against thresholds. Gates 3–5 test *timing*, and they are the ones that
 * catch the scheme which is cheap to build and still destroys value because the money is out for
 * a decade. Ridgeview earns 42% on cost and fails gate 4 — a finding no cost plan can reach,
 * which is why the recommendation there points at the programme and not the specification.
 *
 * ── Money, not floats ──────────────────────────────────────────────────────────────────────
 *
 * v3 computes in Python floats. Every threshold here is in minor units and every comparison is
 * between bigints, so a gate cannot pass or fail on a rounding artefact.
 */

import {
  AFFORDABLE_HURDLES,
  DEFAULT_FUNDING,
  type FundingStructure,
  type Hurdles,
  type Scenarios,
} from "@/domain/cashflow";
import { formatRand, money, type Money } from "@/domain/money";

export type GateState = "pass" | "fail" | "not-evaluated";

export interface Gate {
  no: number;
  name: string;
  state: GateState;
  /** What was measured. */
  metric: string;
  /** What it was measured against. */
  threshold: string;
  /** What it means, in the reader's terms. */
  finding: string;
  /** What to do about it. Only where it failed. */
  recommendation: string | null;
}

export interface Verdict {
  gates: Gate[];
  /** The first gate that failed — the most valuable intervention. */
  firstFailing: number | null;
  /** What is actually binding, named. */
  bindingConstraint: string | null;
  /**
   * Go / Conditional / No-Go, or null.
   *
   * Null until every gate has been evaluated. A verdict from half the gates would read as a verdict.
   */
  overall: "go" | "conditional" | "no-go" | null;
  evaluated: number;
  total: number;
}

export interface GateInputs {
  /** The top of the affordability band — the price ceiling per unit. */
  affordabilityCeiling: Money | null;
  /** Total development cost divided by the unit count. */
  costPerUnit: Money | null;
  /** The signed bulk services contribution. */
  bulk: Money | null;
  units: number | null;
  /** The band's ceiling, for the scope rule. */
  incomeBandMax: Money | null;
  /**
   * The cash-flow model, where it could be run.
   *
   * Gates 3, 4 and 5 test timing, return and resilience, and none of those exist without a
   * month-by-month projection. Absent, they report as not evaluated rather than as passed.
   */
  scenarios?: Scenarios | null;
  hurdles?: Hurdles;
  funding?: FundingStructure;
}

/** Rand to minor units, for declaring a threshold readably. */
const R = (rand: number): Money => money(BigInt(Math.round(rand * 100)));

/**
 * The floor of the band this platform assesses.
 *
 * v3's `_AFFORDABLE_BAND_FLOOR`. A run whose band tops out below it has drifted out of scope —
 * and the finding says so as a fact about *our* scope rather than classifying somebody's
 * development as a segment we do not assess. That wording is deliberate and was a client decision:
 * "below the affordable band" is ours to say; "this is social housing" is a judgement about their
 * project we have no standing to record.
 */
const AFFORDABLE_BAND_FLOOR = R(7_500);

/** v3's bulk gate band — the most a scheme may spend per unit on bulk before it is a finding. */
const MAX_BULK_PER_UNIT = R(120_000);

/**
 * A threshold as a reader sees it — whole rand, grouped the platform's way.
 *
 * `formatMoney` rather than `toLocaleString`: §7.7's separator is U+00A0 and a locale's own
 * grouping is not guaranteed to be it. Two money formatters in one codebase is how a figure comes
 * to read one way on a gate and another on the report it appears in.
 */
const format = (amount: Money) => {
  // Whole rand: a threshold reads better without cents, and the sign is `formatRand`'s problem.
  const shown = formatRand(amount);
  return shown.split(",")[0];
};
/**
 * A rate as a reader sees it.
 *
 * Null prints as "none", never as 0% \u2014 a scheme whose cash flow never crosses zero has no IRR,
 * and "0%" is a measurement where "none" is the truth. On a gate that decides whether a
 * development is funded, the difference is not cosmetic.
 */
const pct = (value: number | null) =>
  // Comma decimal separator — §7.7, and the same document prints "1,9% margin" three lines away.
  value === null ? "none" : `${(value * 100).toFixed(1).replace(".", ",")}%`;

const notEvaluated = (no: number, name: string, needs: string): Gate => ({
  no,
  name,
  state: "not-evaluated",
  metric: "—",
  threshold: "—",
  finding: `Not evaluated. ${needs}`,
  recommendation: null,
});

export function evaluateGates(inputs: GateInputs): Verdict {
  const gates: Gate[] = [];

  // ── Gate 0 — the affordable-housing scope rule ────────────────────────────────────────
  if (inputs.incomeBandMax === null) {
    gates.push(
      notEvaluated(
        0,
        "Affordable-housing context",
        "No target income band has been signed, so the scope rule cannot be applied.",
      ),
    );
  } else if (inputs.incomeBandMax <= AFFORDABLE_BAND_FLOOR) {
    gates.push({
      no: 0,
      name: "Affordable-housing context",
      state: "fail",
      metric: `Income band tops out at ${format(inputs.incomeBandMax)} a month`,
      threshold: `Above ${format(AFFORDABLE_BAND_FLOOR)} a month`,
      finding:
        "This run is outside the affordable-housing band this platform assesses. It is a fact " +
        "about our scope, not a judgement about the development.",
      recommendation:
        "Confirm the affordable band was the one captured. Where a study covers several bands, a " +
        "figure from the wrong one belongs in no field.",
    });
  } else {
    gates.push({
      no: 0,
      name: "Affordable-housing context",
      state: "pass",
      metric: `Income band to ${format(inputs.incomeBandMax)} a month`,
      threshold: `Above ${format(AFFORDABLE_BAND_FLOOR)} a month`,
      finding: "Affordable-housing context confirmed.",
      recommendation: null,
    });
  }

  // ── Gate 1 — the QS gate: can the buyer finance what it costs to build? ───────────────
  if (inputs.costPerUnit === null || inputs.affordabilityCeiling === null) {
    gates.push(
      notEvaluated(
        1,
        "Cost against the affordability ceiling",
        inputs.costPerUnit === null
          ? "No development cost per unit — it needs a signed construction cost and unit count."
          : "No affordability ceiling — it needs the target income band signed.",
      ),
    );
  } else {
    const passes = inputs.costPerUnit <= inputs.affordabilityCeiling;
    const gap = money(
      inputs.costPerUnit > inputs.affordabilityCeiling
        ? inputs.costPerUnit - inputs.affordabilityCeiling
        : inputs.affordabilityCeiling - inputs.costPerUnit,
    );

    gates.push({
      no: 1,
      name: "Cost against the affordability ceiling",
      state: passes ? "pass" : "fail",
      metric: `${format(inputs.costPerUnit)} to build`,
      threshold: `${format(inputs.affordabilityCeiling)} the buyer can finance`,
      finding: passes
        ? `Builds under what the top of the band can finance, with ${format(gap)} of headroom.`
        : `Costs ${format(gap)} more per unit than the top of its own target market can finance.`,
      recommendation: passes
        ? null
        : "Adjust the specification or the typology mix, or re-test against a higher band. The " +
          "scheme cannot be sold to the market it was designed for at this cost.",
    });
  }

  // ── Gate 2 — bulk services per unit ───────────────────────────────────────────────────
  if (inputs.bulk === null || inputs.units === null || inputs.units <= 0) {
    gates.push(
      notEvaluated(
        2,
        "Bulk services per unit",
        "It needs a signed bulk services contribution and a signed unit count.",
      ),
    );
  } else {
    const perUnit = money(inputs.bulk / BigInt(inputs.units));
    const passes = perUnit <= MAX_BULK_PER_UNIT;

    gates.push({
      no: 2,
      name: "Bulk services per unit",
      state: passes ? "pass" : "fail",
      metric: `${format(perUnit)} per unit`,
      threshold: `${format(MAX_BULK_PER_UNIT)} per unit`,
      finding: passes
        ? "Bulk services are within the band for a scheme of this kind."
        : "Bulk services cost more per unit than a scheme of this kind can usually carry.",
      recommendation: passes
        ? null
        : "Check whether the municipality is providing any of it, and whether the contribution " +
          "covers work the developer would otherwise fund.",
    });
  }

  // ── Gates 3–5 — the scenario model ────────────────────────────────────────────────────
  if (!inputs.scenarios) {
    gates.push(
      notEvaluated(3, "Funding", "It needs the peak funding requirement from the cash-flow model."),
      notEvaluated(4, "Return", "It needs IRR, NPV and margin from the scenario model."),
      notEvaluated(5, "Resilience", "It needs the downside scenario."),
    );
  } else {
    const { base, downside } = inputs.scenarios;
    const hurdles = inputs.hurdles ?? AFFORDABLE_HURDLES;
    const debtPct = inputs.funding?.debtPct ?? DEFAULT_FUNDING.debtPct;

    // ── Gate 3 — can the scheme be funded at all? ───────────────────────────────────────
    const debtCap = money((base.totalCostInclFinance * BigInt(Math.round(debtPct))) / 100n);
    const fundable =
      base.peakDebt <= debtCap && base.peakFunding <= base.totalCostInclFinance;

    gates.push({
      no: 3,
      name: "Funding",
      state: fundable ? "pass" : "fail",
      metric: `Peak debt ${format(base.peakDebt)}; ${format(base.peakFunding)} in the ground at month ${base.peakFundingMonth}`,
      threshold: `Debt no more than ${debtPct}% of total cost — ${format(debtCap)}`,
      finding: fundable
        ? `Fundable on a ${debtPct}/${100 - debtPct} structure. The deepest the scheme goes is ${format(base.peakFunding)}, at month ${base.peakFundingMonth}.`
        : `The facility this needs is larger than a ${debtPct}/${100 - debtPct} structure supports. Peak debt reaches ${format(base.peakDebt)} against a ${format(debtCap)} cap.`,
      recommendation: fundable
        ? null
        : "Phase the capital so revenue from the first tranche funds the next, or raise more equity. " +
          "The peak is a timing problem before it is a cost problem.",
    });

    /*
      ── Gate 4 — does it earn enough, once time is priced? ────────────────────────────────

      On the **equity** NPV, not the project one, and deliberately the same measure section 8 of
      the report prints. v3 tests the unlevered figure; carrying that here put two numbers called
      "NPV" in one document, R13m apart, with nothing on the page telling a reader which was
      which. One definition per figure — and the levered one is the right one, because it is the
      only one that can see the cost of the debt this gate is judging.
    */
    const irr = base.equityIrrPa;
    const passesReturn =
      base.marginOnCost >= hurdles.minMarginOnCost &&
      irr !== null &&
      irr >= hurdles.minEquityIrrPa &&
      base.npvEquityAtHurdle >= 0n;

    gates.push({
      no: 4,
      name: "Return",
      state: passesReturn ? "pass" : "fail",
      metric: `${pct(base.marginOnCost)} margin · ${pct(irr)} equity IRR · ${format(base.npvEquityAtHurdle)} NPV to equity`,
      threshold: `Margin ${pct(hurdles.minMarginOnCost)} · IRR ${pct(hurdles.minEquityIrrPa)} · NPV to equity above zero at ${pct(hurdles.discountRatePa)}`,
      finding: passesReturn
        ? `Clears the affordable-housing hurdles on all three measures.`
        : /*
             The margin and the NPV routinely disagree, and that disagreement is the finding. A
             long sell-out earns a large nominal margin and still destroys value, because the
             money was out for a decade. Saying which measure failed is what makes the sentence
             actionable.
           */
          `${
            base.npvEquityAtHurdle < 0n && base.marginOnCost >= hurdles.minMarginOnCost
              ? `Earns a ${pct(base.marginOnCost)} margin but does not clear ${pct(hurdles.discountRatePa)} once the ${(base.selloutMonth / 12).toFixed(1).replace(".", ",")}-year sell-out is priced: NPV to equity is ${format(base.npvEquityAtHurdle)}. A margin earned over a decade is not the same return as the same margin over three years.`
              : `Does not clear the return hurdles for a scheme of this kind.`
          }`,
      recommendation: passesReturn
        ? null
        : "Shorten the sell-out before touching the cost. Phasing, or an institutional take-out " +
          "of the later stock, moves the return more than any specification saving available here.",
    });

    // ── Gate 5 — does it survive a bad year? ────────────────────────────────────────────
    const downIrr = downside.equityIrrPa;
    const resilient =
      downside.marginOnCost >= hurdles.downsideMinMargin &&
      downIrr !== null &&
      downIrr >= hurdles.downsideMinIrrPa;

    gates.push({
      no: 5,
      name: "Resilience",
      state: resilient ? "pass" : "fail",
      metric: `Downside: ${pct(downside.marginOnCost)} margin · ${pct(downIrr)} IRR · sells out in ${(downside.selloutMonth / 12).toFixed(1).replace(".", ",")} years`,
      threshold: `Margin ${pct(hurdles.downsideMinMargin)} · IRR ${pct(hurdles.downsideMinIrrPa)} under price −10%, build +10%, slowest absorption, rate +2 points`,
      finding: resilient
        ? "Survives the downside with margin left."
        : `Fails in the downside: ${pct(downside.marginOnCost)} margin and ${pct(downIrr)} IRR. There is not enough in it to absorb four adverse moves at once.`,
      recommendation: resilient
        ? null
        : "The scheme has no room for a bad year. Fix the base case before underwriting it — a " +
          "downside this thin means the base case was never as comfortable as its margin looked.",
    });
  }

  const failing = gates.filter((gate) => gate.state === "fail");
  const evaluated = gates.filter((gate) => gate.state !== "not-evaluated").length;
  const first = failing[0] ?? null;

  return {
    gates,
    firstFailing: first?.no ?? null,
    bindingConstraint: first ? first.name : null,
    /**
     * A verdict, only from a complete set.
     *
     * Anything failing is a No-Go whatever else passes — a gate is a rule. Everything passing is
     * only a Go once everything has actually been tested, which is why this is null while three
     * gates are unevaluated. Presenting "Go" on a scheme nobody has tested for fundability would
     * be the most expensive sentence this platform could print.
     */
    overall:
      failing.length > 0 ? "no-go" : evaluated === gates.length ? "go" : null,
    evaluated,
    total: gates.length,
  };
}
