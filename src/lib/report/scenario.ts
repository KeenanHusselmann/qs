/**
 * The cash flow, built from what a project has signed.
 *
 * ── Where the model meets the signatures ───────────────────────────────────────────────────
 *
 * `domain/cashflow.ts` is pure arithmetic and knows nothing about this platform. This is the seam
 * that feeds it: it reads the signed figures, refuses to run where any of the four inputs it
 * cannot invent is missing, and returns null rather than a scenario built on defaults.
 *
 * That refusal is the point. Gates 3, 4 and 5 then report as *not evaluated*, which is the honest
 * outcome — funding, return and resilience are all functions of when money moves, and there is no
 * defensible default for a selling price, an absorption rate or a programme. A cash flow assembled
 * from plausible placeholders would produce a fundable-looking scheme out of a project nobody has
 * costed, which is precisely the failure §1.3.1 exists to prevent.
 *
 * ── Assumptions are declared, and labelled where they surface ──────────────────────────────
 *
 * Escalation, commission, the approvals period and the sensitivity band are not in anybody's
 * documents. They are market conditions and modelling choices, so they live in `MARKET` with a
 * reason each, and every surface that shows a figure derived from them says so. The difference
 * between "the QS signed 144 units a year" and "we assumed the market could be a third slower" is
 * exactly the difference a reviewer needs to see.
 */

import { readAmount, readQuantity } from "@/domain/amount";
import {
  AFFORDABLE_HURDLES,
  DEFAULT_FUNDING,
  runScenarios,
  sensitivity,
  type ScenarioInputs,
  type Scenarios,
  type Swing,
} from "@/domain/cashflow";
import { costStack } from "@/domain/cost-stack";
import { DEFAULT_ASSUMPTIONS, type Assumptions } from "@/lib/assumption-set";
import { money } from "@/domain/money";
import { readUnit } from "@/domain/units";
import type { SignedStep } from "@/lib/agent/persist";

/**
 * The market assumptions the cash flow runs on.
 *
 * A sensitivity analysis is by definition the perturbation of an assumption. Stating the
 * perturbation is what makes it one, rather than a second forecast dressed as a finding.
 */
export const MARKET = {
  priceEscalationPa: 0.05,
  salesCommission: 0.03,
  /** Approvals, before a spade goes in the ground. */
  preDevelopmentMonths: 6,
  /** How far each lever is moved in the tornado. */
  sensitivitySwing: 0.1,
} as const;

/** A signed figure, by field id. */
function figure(signed: readonly SignedStep[], fieldId: string): string | null {
  for (const step of signed) {
    const found = step.fields.find((f) => f.fieldId === fieldId);
    if (found) return found.value;
  }
  return null;
}

/** A signed figure read as a plain count — units, months, units a year. */
function count(signed: readonly SignedStep[], fieldId: string): number | null {
  const raw = figure(signed, fieldId);
  if (raw === null) return null;
  const reading = readQuantity(raw);
  return reading.ok ? Number(reading.quantity) / 10_000 : null;
}

/**
 * An absorption rate — units a year — from prose.
 *
 * `readQuantity` refuses "144 units per annum", and it is right to: that is a *rate*, something
 * per something, and reading it as a bare quantity is how "144 a month" and "144 a year" become
 * the same number. Both are plausible on a scheme this size and they differ by a factor of
 * twelve, which is the difference between a two-year sell-out and a twenty-year one.
 *
 * So this reads the period explicitly and **refuses a figure that does not state one**. A bare
 * "144" is not an absorption rate, and guessing which period was meant would put a decade of
 * finance cost on a coin toss.
 */
export function readAbsorption(text: string | null): number | null {
  if (!text) return null;

  const number = text.replace(/[ \s]/g, "").match(/(\d+(?:[.,]\d+)?)/);
  if (!number) return null;

  const value = Number(number[1].replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return null;

  const period = text.toLowerCase();

  /*
    The word boundaries are load-bearing on every one of these.

    Without them `per\s*a` matches "per apartment", and a bare `pa` matches inside any word
    containing it — either would return a per-annum rate from a phrase that never said annum.
    The entire reason this function exists is that mistaking the period is a factor-of-twelve
    error, so a loose pattern here is worse than having no reader at all.
  */
  if (/\bper\s+(annum|year|yr)\b|\/\s*(year|yr|annum)\b|\bp\.?\s?a\.?\b|\bannually\b/.test(period)) {
    return value;
  }
  if (/\bper\s+month\b|\/\s*month\b|\bmonthly\b/.test(period)) return value * 12;
  if (/\bper\s+quarter\b|\bquarterly\b/.test(period)) return value * 4;

  // No period stated. Not a rate, and not something to assume one for.
  return null;
}

/**
 * A programme duration, in months, from prose.
 *
 * `readQuantity` strips a trailing unit and reads the figure, so "3 years" came back as 3 – and the
 * cash flow then built a three-month programme out of a three-year one. The same factor of twelve
 * `readAbsorption` exists to stop, on the other input that sets when money moves.
 *
 * It does not convert, for the reason `domain/units.ts` gives: a figure the platform rewrote is a
 * figure no document states. A programme stated in another unit is refused, and the report says
 * so; the run panel already offers the conversion on the row where the QS can correct it. A bare
 * figure is read as months, because months is the field's unit and the screen prints it beside one.
 */
export function readProgramme(text: string | null): number | null {
  if (!text) return null;
  if (readUnit(text, "months").agreement === "differs") return null;
  const reading = readQuantity(text);
  if (!reading.ok) return null;
  const months = Number(reading.quantity) / 10_000;
  return Number.isFinite(months) && months > 0 ? months : null;
}

function amount(signed: readonly SignedStep[], fieldId: string) {
  const raw = figure(signed, fieldId);
  if (raw === null) return null;
  const reading = readAmount(raw);
  return reading.ok ? reading.amount : null;
}

/** The four inputs the cash flow will not invent, and the cost it runs on – or what stops it. */
interface Readings {
  units: number | null;
  price: ReturnType<typeof amount>;
  absorption: number | null;
  months: number | null;
  /** Each input that is missing or cannot be read, as a sentence the report prints. */
  gaps: string[];
}

/**
 * Read every input once, and say exactly which ones stop the model.
 *
 * The report used to say "needs a signed selling price, absorption rate, programme and unit count"
 * whatever was actually missing – on a project where all four were signed and one was unreadable,
 * it named four inputs that were there. A QS told which figure, and what is wrong with it, can fix
 * it; one told a list cannot tell which item on it is the problem.
 *
 * Built from the same readers `projectScenario` runs on, so the gaps and the refusal cannot disagree.
 */
function readInputs(signed: readonly SignedStep[]): Readings {
  const gaps: string[] = [];
  const said = (fieldId: string) => figure(signed, fieldId);
  const quoted = (value: string) => `“${value.length > 40 ? `${value.slice(0, 40)}…` : value}”`;

  const units = count(signed, "cp-units") ?? count(signed, "units");
  if (units === null || units <= 0) {
    const raw = said("cp-units") ?? said("units");
    gaps.push(raw === null ? "a signed unit count (Feasibility Estimate)" : `the unit count, signed as ${quoted(raw)}, which is not a single count`);
  }

  const price = amount(signed, "selling-price");
  if (price === null) {
    const raw = said("selling-price");
    gaps.push(raw === null ? "a signed achievable selling price (Feasibility Estimate)" : `the selling price, signed as ${quoted(raw)}, which is not a single amount in rand`);
  }

  const absorption = readAbsorption(said("absorption"));
  if (absorption === null) {
    const raw = said("absorption");
    gaps.push(
      raw === null
        ? "a signed absorption rate (Feasibility Estimate)"
        : `the absorption rate, signed as ${quoted(raw)} with no period – per year or per month is a factor of twelve, so it is not assumed`,
    );
  }

  const months = readProgramme(said("programme"));
  if (months === null) {
    const raw = said("programme");
    gaps.push(
      raw === null
        ? "a signed programme duration in months (Feasibility Estimate)"
        : readUnit(raw, "months").agreement === "differs"
          ? `the programme, signed as ${quoted(raw)} where the field records months – it is not converted behind your back`
          : `the programme, signed as ${quoted(raw)}, which is not a single duration`,
    );
  }

  if (amount(signed, "cp-total") === null) {
    gaps.push(said("cp-total") === null ? "a signed Cost Plan total" : `the Cost Plan total, signed as ${quoted(said("cp-total")!)}, which is not a single amount in rand`);
  }

  return { units, price, absorption, months, gaps };
}

/**
 * What stops the cash flow running on this project, one sentence per input. Empty when it runs.
 *
 * Re-run the step to change a signed figure: a signed run is frozen, so the fix is a new run with
 * the figure corrected before it is signed.
 */
export function scenarioGaps(signed: readonly SignedStep[]): string[] {
  return readInputs(signed).gaps;
}

export interface ProjectScenario {
  inputs: ScenarioInputs;
  scenarios: Scenarios;
  levers: Swing[];
}

/**
 * Build the scenario, or say it cannot be built.
 *
 * The four it will not invent: a unit count, an achievable selling price, an absorption rate and
 * a programme. Every one of them is a signable field on the feasibility step.
 */
export function projectScenario(
  signed: readonly SignedStep[],
  /*
    The practice's figures, where it has set any.

    Defaulted rather than required: every caller that does not care about settings — the tests,
    the tools — gets the platform's own figures without threading a set through, and the ones that
    do pass the practice's. A required parameter would have made ten call sites read the database
    to ask a question none of them was asking.
  */
  assumed: Assumptions = DEFAULT_ASSUMPTIONS,
): ProjectScenario | null {
  const { units, price, absorption, months, gaps } = readInputs(signed);
  if (gaps.length > 0 || units === null || price === null || absorption === null || months === null) return null;

  const stack = costStack({
    construction: amount(signed, "cp-total"),
    constructionCarriesContingency:
      figure(signed, "cp-contingency") !== null || figure(signed, "cp-escalation") !== null,
    landValue: null,
    vatVendor: false,
    bulkContribution: amount(signed, "bulk"),
    units: Math.round(units),
    averageHomeValue: price,
    statedFeePercent: null,
  });

  if (stack.construction <= 0n) return null;

  const inputs: ScenarioInputs = {
    construction: stack.construction,
    fees: stack.professionalFees,
    // Land, statutory and the bulk contribution are all committed before revenue starts.
    upFront: money(stack.land + stack.statutory + stack.bulk),
    units: Math.round(units),
    averagePrice: price,
    salesCommission: assumed.salesCommission,
    priceEscalationPa: assumed.priceEscalationPa,
    absorptionPerYear: absorption,
    preDevelopmentMonths: assumed.preDevelopmentMonths,
    /*
      One phase, because phasing is not something this project has signed.

      It is also the pessimistic reading, which is the right way round: a single-phase programme
      delays every rand of revenue to practical completion, and where the model then fails the
      return gate it recommends the phasing that would fix it. Assuming a phased programme nobody
      committed to would hide that finding behind an invented input.
    */
    phases: [{ units: Math.round(units), startMonth: 0, constructionMonths: Math.round(months) }],
    funding: { ...DEFAULT_FUNDING, interestRatePa: assumed.financeRatePa, debtPct: assumed.debtPct, equityPct: 100 - assumed.debtPct },
    hurdles: { ...AFFORDABLE_HURDLES, discountRatePa: assumed.discountRatePa },
  };

  return {
    inputs,
    scenarios: runScenarios(inputs, {
      // The band around the signed rate, not a second forecast. Named as an assumption wherever
      // a figure derived from it is shown.
      absorptionMin: absorption * (1 - MARKET.sensitivitySwing * 3),
      absorptionMax: absorption * (1 + MARKET.sensitivitySwing * 3),
    }),
    levers: sensitivity(inputs, MARKET.sensitivitySwing),
  };
}

/**
 * The two cumulative curves the S-curve draws.
 *
 * Cumulative rather than monthly: the question is "how much is in the ground", which is a running
 * total, and a monthly bar chart of the same data hides the crossing point entirely.
 */
export function cumulativeCurves(scenario: ProjectScenario) {
  const cost: number[] = [];
  const revenue: number[] = [];
  let outflow = 0;
  let inflow = 0;

  for (const flow of scenario.scenarios.base.flows) {
    outflow += flow.constructionOut + flow.otherOut;
    inflow += flow.salesIn;
    cost.push(Math.round(outflow));
    revenue.push(Math.round(inflow));
  }

  return { cost, revenue };
}
