/**
 * The cash-flow and scenario model — ported from v3's `financial_agent.py` (C2–C7).
 *
 * ── Why a scheme that is profitable on paper still fails ───────────────────────────────────
 *
 * A feasibility study that compares total revenue with total cost answers the wrong question.
 * Affordable housing sells on an **absorption curve** — a market takes up so many units a year and
 * no more — so a thousand-unit scheme built in three years may take eight to sell. Every one of
 * those months carries interest on the money still in the ground.
 *
 * That is the whole reason this module exists, and it is v3's central design decision (meeting
 * 2026-06-11): units sell on the absorption curve, **not** at occupation date. Modelling it the
 * lazy way is the difference between an honest feasibility and an overstated one — and it is
 * overstated in the direction that gets schemes built.
 *
 * ── Subsidies are not income ───────────────────────────────────────────────────────────────
 *
 * FLISP assists the *buyer's* financing. It never appears as revenue here. Its effect is a faster
 * absorption rate, which is why it shows up in the upside scenario as a lever on absorption and
 * nowhere else. Booking it as income would flatter every gate downstream.
 *
 * ── Floats, deliberately, and rounded once ─────────────────────────────────────────────────
 *
 * §5 holds money as `bigint` minor units because a ledger must not drift. A discounted cash flow
 * is not a ledger: NPV and IRR are transcendental in the rate, and there is no exact rational
 * answer to round to. So money enters as `Money`, the arithmetic runs in floats over cents, and
 * the result converts back **once** at the boundary. Rates stay floats throughout, because a rate
 * is not money.
 *
 * Cents keep the floats honest: a R500m scheme is 5e10 cents, comfortably inside 2^53, so the
 * model has no representable-integer problem.
 *
 * ── What is not ported ─────────────────────────────────────────────────────────────────────
 *
 * v3 also models a rental split with a terminal value at a capitalisation rate. Nothing in this
 * platform signs a rental holding yet, so modelling one would mean inventing its inputs. This is
 * a **sale-path** model and says so, rather than quietly treating "no rentals" as the same thing
 * as having asked.
 */

import { money, type Money } from "@/domain/money";

/** Cents as a float, for the discounting maths. */
const cents = (amount: Money): number => Number(amount);

/** Back to money, rounding once — the only rounding in the module. */
const toMoney = (value: number): Money => money(BigInt(Math.round(value)));

// ── The pure maths ────────────────────────────────────────────────────────────────────────

/**
 * Net present value of monthly flows at a monthly rate.
 *
 * The discount factor is clamped at 1e12. At a deeply negative rate it compounds toward infinity
 * and the sum stops meaning anything long before it becomes `Infinity` — v3 clamps for the same
 * reason, and the bisection below explores rates down to −50%.
 */
export function npv(ratePerMonth: number, flows: readonly number[]): number {
  let total = 0;
  let factor = 1;
  const base = 1 + ratePerMonth;

  for (const flow of flows) {
    total += flow * factor;
    factor /= base;
    if (factor > 1e12) factor = 1e12;
  }

  return total;
}

/**
 * Internal rate of return per month, by bisection.
 *
 * Bisection rather than Newton because a development cash flow is not well behaved: it can change
 * sign more than once, and Newton wanders off a flat region and returns a confident wrong answer.
 * Bisection either brackets a root or reports that it could not — which is the honest outcome and
 * the one the gates need.
 *
 * Null where no IRR exists: an all-positive or all-negative flow has none, and neither does one
 * whose NPV never crosses zero between −50% and +100% a month.
 */
export function irrMonthly(flows: readonly number[]): number | null {
  if (flows.length === 0) return null;
  if (flows.every((f) => f >= 0) || flows.every((f) => f <= 0)) return null;

  let lo = -0.5;
  let hi = 1;
  let fLo = npv(lo, flows);
  const fHi = npv(hi, flows);

  if (fLo * fHi > 0) return null;

  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid, flows);

    if (Math.abs(fMid) < 1e-6) return mid;

    if (fLo * fMid < 0) {
      hi = mid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }

  return (lo + hi) / 2;
}

/** A monthly rate as an annual one. Compounding, not twelve times. */
export const annualise = (ratePerMonth: number | null): number | null =>
  ratePerMonth === null ? null : (1 + ratePerMonth) ** 12 - 1;

/**
 * How a construction spend actually falls across a build — slow, fast, slow.
 *
 * A flat spread would put as much money in month one as in the middle of the build, which nobody
 * has seen on a site, and it understates peak funding by shifting spend later. The shape is a
 * sine ogive raised to 0.8, which skews the peak slightly early: a build front-loads once it is
 * mobilised and tails off through finishes and snagging.
 *
 * The weights always sum to 1, so the caller multiplies by the total and nothing leaks.
 */
export function scurveWeights(months: number): number[] {
  if (months <= 0) return [];

  const raw: number[] = [];
  let previous = 0;

  for (let m = 1; m <= months; m += 1) {
    const x = m / months;
    const cumulative = ((Math.sin((x - 0.5) * Math.PI) + 1) / 2) ** 0.8;
    raw.push(cumulative - previous);
    previous = cumulative;
  }

  const total = raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => w / total);
}

// ── The scenario ──────────────────────────────────────────────────────────────────────────

export interface FundingStructure {
  /** Share of cost funded by debt, as a percentage. */
  debtPct: number;
  equityPct: number;
  interestRatePa: number;
  /** Raising fee on the facility, as a percentage. */
  raisingFeePct: number;
}

export interface Hurdles {
  minEquityIrrPa: number;
  minMarginOnCost: number;
  discountRatePa: number;
  downsideMinMargin: number;
  downsideMinIrrPa: number;
}

/**
 * Development-finance defaults. v3's `FundingStructure` — 60/40 at prime-plus.
 *
 * Not project figures: a funding structure is a market condition, and the moment a real term
 * sheet is signed these are replaced by it.
 */
export const DEFAULT_FUNDING: FundingStructure = {
  debtPct: 60,
  equityPct: 40,
  interestRatePa: 0.1175,
  raisingFeePct: 0.75,
};

/**
 * The hurdle band for affordable housing, not the commercial one.
 *
 * v3 carries both and selects this for gap-market schemes, because they run thinner margins **by
 * design** — demand is subsidy-supported and selling prices are capped, so the return is stable
 * rather than large. Judging one against a 20% commercial equity hurdle would fail every
 * affordable scheme ever built and call it a finding.
 */
export const AFFORDABLE_HURDLES: Hurdles = {
  minEquityIrrPa: 0.12,
  minMarginOnCost: 0.1,
  discountRatePa: 0.14,
  downsideMinMargin: 0.02,
  downsideMinIrrPa: 0.06,
};

export interface Phase {
  units: number;
  /** Months after pre-development ends that this phase starts on site. */
  startMonth: number;
  constructionMonths: number;
}

export interface ScenarioInputs {
  /** B2–B4: the escalated construction cost. */
  construction: Money;
  /** B5: professional fees. */
  fees: Money;
  /** Land, statutory and contingency — committed up front. */
  upFront: Money;
  units: number;
  averagePrice: Money;
  /** Agents' commission, as a fraction of the selling price. */
  salesCommission: number;
  priceEscalationPa: number;
  absorptionPerYear: number;
  preDevelopmentMonths: number;
  phases: readonly Phase[];
  funding?: FundingStructure;
  hurdles?: Hurdles;
  /** Scenario levers. */
  priceFactor?: number;
  buildFactor?: number;
  interestDelta?: number;
}

export interface MonthlyFlow {
  month: number;
  constructionOut: number;
  otherOut: number;
  unitsCompleted: number;
  unitsSold: number;
  salesIn: number;
  net: number;
  debtBalance: number;
  equityDrawn: number;
}

export interface ScenarioResult {
  name: string;
  months: number;
  /** The month the last unit sells — the figure that decides whether this scheme works. */
  selloutMonth: number;
  /** Deepest cumulative outflow, ungeared. What the scheme has to find. */
  peakFunding: Money;
  peakFundingMonth: number;
  peakDebt: Money;
  totalInterest: Money;
  totalRevenue: Money;
  totalCostInclFinance: Money;
  profit: Money;
  marginOnCost: number;
  marginOnRevenue: number;
  projectIrrPa: number | null;
  equityIrrPa: number | null;
  npvAtHurdle: Money;
  /**
   * NPV of the *equity* cash flows — the levered measure.
   *
   * `npvAtHurdle` discounts the project flows, which by construction exclude interest, so it
   * cannot see a financing decision at all. This one discounts what equity actually puts in and
   * takes out, so it responds both to time and to the cost of debt. It is the measure the
   * sensitivity analysis is built on, and the one a developer decides on.
   */
  npvEquityAtHurdle: Money;
  paybackMonth: number | null;
  equityRequired: Money;
  debtFacility: Money;
  flows: MonthlyFlow[];
  /** Findings the model raises about itself, in the reader's terms. */
  warnings: string[];
}

/** Long enough for a slow absorption to finish. v3's `max_months`. */
const HORIZON = 240;

export function runScenario(name: string, inputs: ScenarioInputs): ScenarioResult {
  const funding = inputs.funding ?? DEFAULT_FUNDING;
  const hurdles = inputs.hurdles ?? AFFORDABLE_HURDLES;

  const priceFactor = inputs.priceFactor ?? 1;
  const buildFactor = inputs.buildFactor ?? 1;
  const interestDelta = inputs.interestDelta ?? 0;

  const warnings: string[] = [];

  const empty = (): ScenarioResult => ({
    name,
    months: 0,
    selloutMonth: 0,
    peakFunding: money(0n),
    peakFundingMonth: 0,
    peakDebt: money(0n),
    totalInterest: money(0n),
    totalRevenue: money(0n),
    totalCostInclFinance: money(0n),
    profit: money(0n),
    marginOnCost: 0,
    marginOnRevenue: 0,
    projectIrrPa: null,
    equityIrrPa: null,
    npvAtHurdle: money(0n),
    npvEquityAtHurdle: money(0n),
    paybackMonth: null,
    equityRequired: money(0n),
    debtFacility: money(0n),
    flows: [],
    warnings,
  });

  if (inputs.units <= 0 || inputs.phases.length === 0) {
    warnings.push("No units or no programme — there is no scheme to model.");
    return empty();
  }

  if (inputs.absorptionPerYear <= 0) {
    warnings.push("Absorption is zero, so nothing ever sells. The scenario cannot be run.");
    return empty();
  }

  const absorptionPm = inputs.absorptionPerYear / 12;
  const escalationPm = (1 + inputs.priceEscalationPa) ** (1 / 12) - 1;
  const ratePm = (funding.interestRatePa + interestDelta) / 12;

  const preDev = inputs.preDevelopmentMonths;
  const constructionTotal = cents(inputs.construction) * buildFactor;
  const feesTotal = cents(inputs.fees) * buildFactor;
  const upFront = cents(inputs.upFront);

  // ── The cost timeline ───────────────────────────────────────────────────────────────
  const phaseUnits = inputs.phases.reduce((a, p) => a + p.units, 0) || 1;

  const constructionOut = new Array<number>(HORIZON).fill(0);
  const completions = new Array<number>(HORIZON).fill(0);
  let lastCompletion = 0;

  for (const phase of inputs.phases) {
    const share = constructionTotal * (phase.units / phaseUnits);
    const weights = scurveWeights(phase.constructionMonths);

    weights.forEach((weight, i) => {
      const m = preDev + phase.startMonth + i;
      if (m < HORIZON) constructionOut[m] += share * weight;
    });

    const done = Math.min(preDev + phase.startMonth + phase.constructionMonths, HORIZON - 1);
    completions[done] += phase.units;
    lastCompletion = Math.max(lastCompletion, done);
  }

  /*
    Fees: 40% through pre-development, 60% across the build.

    Design and approvals are most of the fee and they are earned before a spade goes in the ground.
    Spreading fees evenly across the whole programme would move that money later and understate the
    early funding requirement — which is exactly the part a developer funds from equity.
  */
  const otherOut = new Array<number>(HORIZON).fill(0);
  const buildWindow = Math.max(lastCompletion - preDev, 1);

  for (let m = 0; m < preDev && m < HORIZON; m += 1) {
    otherOut[m] += (feesTotal * 0.4) / Math.max(preDev, 1);
  }
  for (let m = preDev; m < preDev + buildWindow && m < HORIZON; m += 1) {
    otherOut[m] += (feesTotal * 0.6) / buildWindow;
  }
  otherOut[0] += upFront;

  // ── The month-by-month run ──────────────────────────────────────────────────────────
  const price0 = cents(inputs.averagePrice) * priceFactor;
  const flows: MonthlyFlow[] = [];

  let stock = 0;
  let sold = 0;
  let carry = 0;
  let debt = 0;
  let equityDrawn = 0;
  let debtFacility = 0;
  let totalInterest = 0;
  let selloutMonth: number | null = null;
  let baseCost = 0;

  for (let m = 0; m < HORIZON; m += 1) {
    stock += completions[m];

    /*
      Absorption is a rate, not a queue. Where completed stock runs out, unmet demand carries
      forward — but only three months of it. A market does not save up buyers indefinitely, and an
      uncapped carry would let a late phase sell its whole stock the month it completes, which is
      the overstatement this model exists to prevent.
    */
    const wanted = absorptionPm + carry;
    const canSell = Math.min(stock, wanted);
    carry = Math.min(Math.max(wanted - stock, 0), absorptionPm * 3);

    const priceThisMonth = price0 * (1 + escalationPm) ** m;
    const salesIn = canSell * priceThisMonth * (1 - inputs.salesCommission);

    stock -= canSell;
    sold += canSell;

    const outflow = constructionOut[m] + otherOut[m];
    baseCost += outflow;

    // ── The funding waterfall: equity to its cap, then debt ──────────────────────────
    const interest = debt * ratePm;
    totalInterest += interest;

    const need = outflow + interest - salesIn;

    if (need > 0) {
      const equityCap = ((baseCost + totalInterest) * funding.equityPct) / 100;
      const draw = Math.min(Math.max(equityCap - equityDrawn, 0), need);
      equityDrawn += draw;
      debt += need - draw;
    } else {
      debt -= Math.min(debt, -need);
    }

    debtFacility = Math.max(debtFacility, debt);

    flows.push({
      month: m,
      constructionOut: constructionOut[m],
      otherOut: otherOut[m],
      unitsCompleted: completions[m],
      unitsSold: Math.round(canSell),
      salesIn,
      net: salesIn - outflow,
      debtBalance: debt,
      equityDrawn,
    });

    if (selloutMonth === null && sold >= inputs.units - 0.5) selloutMonth = m;
    if (selloutMonth !== null && debt <= 0 && m >= lastCompletion) break;
  }

  // ── What it all came to ─────────────────────────────────────────────────────────────
  const raisingFee = (debtFacility * funding.raisingFeePct) / 100;
  const totalRevenue = flows.reduce((a, f) => a + f.salesIn, 0);
  const totalCost = baseCost + totalInterest + raisingFee;
  const profit = totalRevenue - totalCost;

  /*
    Peak funding is ungeared on purpose: the deepest the cumulative cash flow goes before revenue
    turns it round. It is what the scheme has to find, whoever finds it — the split between debt
    and equity is a funding decision taken against this number, not an input to it.
  */
  const projectFlows: number[] = [];
  let cumulative = 0;
  let peak = 0;
  let peakMonth = 0;
  let paybackMonth: number | null = null;

  for (const flow of flows) {
    const net = flow.salesIn - flow.constructionOut - flow.otherOut;
    projectFlows.push(net);
    cumulative += net;

    if (cumulative < peak) {
      peak = cumulative;
      peakMonth = flow.month;
    }
    if (paybackMonth === null && cumulative > 0) paybackMonth = flow.month;
  }

  /*
    Equity's own flows: what it put in, and what came back once the debt was clear.

    Distributions start only after the debt balance reaches zero, because that is the actual
    priority — a lender is repaid before a shareholder sees a rand. Paying equity earlier would
    flatter the equity IRR, which is the single number a developer decides on.
  */
  const equityFlows: number[] = [];
  let previousEquity = 0;

  for (const flow of flows) {
    const draw = flow.equityDrawn - previousEquity;
    previousEquity = flow.equityDrawn;
    const distribution = flow.debtBalance <= 0 ? Math.max(flow.net, 0) : 0;
    equityFlows.push(distribution - draw);
  }

  const discountPm = (1 + hurdles.discountRatePa) ** (1 / 12) - 1;
  const sellout = selloutMonth ?? flows.length;
  const yearsToSell = sellout / 12;

  if (yearsToSell > 8) {
    warnings.push(
      `Sell-out takes ${yearsToSell.toFixed(1)} years at ${Math.round(inputs.absorptionPerYear)} ` +
        "units a year. Absorption is the binding constraint, not cost — consider phasing the " +
        "capital, or an institutional exit for the later stock.",
    );
  }

  if (selloutMonth === null) {
    warnings.push(
      `Not every unit sells inside ${HORIZON / 12} years at this absorption rate. The returns ` +
        "below are for what does sell, and so are better than the scheme as drawn.",
    );
  }

  return {
    name,
    months: flows.length,
    selloutMonth: sellout,
    peakFunding: toMoney(-peak),
    peakFundingMonth: peakMonth,
    peakDebt: toMoney(debtFacility),
    totalInterest: toMoney(totalInterest),
    totalRevenue: toMoney(totalRevenue),
    totalCostInclFinance: toMoney(totalCost),
    profit: toMoney(profit),
    marginOnCost: totalCost ? profit / totalCost : 0,
    marginOnRevenue: totalRevenue ? profit / totalRevenue : 0,
    projectIrrPa: annualise(irrMonthly(projectFlows)),
    equityIrrPa: annualise(irrMonthly(equityFlows)),
    npvAtHurdle: toMoney(npv(discountPm, projectFlows)),
    npvEquityAtHurdle: toMoney(npv(discountPm, equityFlows)),
    paybackMonth,
    equityRequired: toMoney(equityDrawn),
    debtFacility: toMoney(debtFacility),
    flows,
    warnings,
  };
}

export interface Scenarios {
  base: ScenarioResult;
  downside: ScenarioResult;
  upside: ScenarioResult;
}

/**
 * Base, downside, upside — v3's C7.
 *
 * The downside moves four things at once (price −10%, build +10%, absorption to the market
 * minimum, rate +2 points) because in a downturn they move together. Testing them one at a time
 * is a sensitivity analysis and has its own value, but it is not a downside: a scheme can survive
 * every single-variable shock and still fail the combination, and the combination is what happens.
 *
 * The upside is deliberately meeker — price +5% and faster absorption, nothing on cost. Building
 * cheaper than planned is not a scenario anyone should underwrite.
 */
export function runScenarios(
  inputs: ScenarioInputs,
  market: { absorptionMin: number; absorptionMax: number },
): Scenarios {
  return {
    base: runScenario("base", inputs),
    downside: runScenario("downside", {
      ...inputs,
      priceFactor: 0.9,
      buildFactor: 1.1,
      absorptionPerYear: market.absorptionMin,
      interestDelta: 0.02,
    }),
    upside: runScenario("upside", {
      ...inputs,
      priceFactor: 1.05,
      absorptionPerYear: market.absorptionMax,
    }),
  };
}

// ── Sensitivity ───────────────────────────────────────────────────────────────────────────

export interface Swing {
  /** The input that was moved. */
  variable: string;
  /** What it was moved by, in the reader's terms. */
  range: string;
  /** Equity NPV at the adverse end, and at the favourable end. */
  low: Money;
  high: Money;
  /** How far equity NPV travels across the range — what the bars are sorted by. */
  spread: Money;
}

/**
 * The tornado — which assumption actually decides this scheme.
 *
 * ── Why this is the chart a development appraisal owes its reader ──────────────────────────
 *
 * RICS is blunt that residual appraisals are "very sensitive to changes in key inputs": a few per
 * cent on selling price or build cost swings the answer disproportionately. A single NPV therefore
 * tells a reader almost nothing on its own — what they need is *which* input it is hostage to, so
 * due diligence goes where the risk actually is.
 *
 * Each variable is moved one at a time by the same proportion, and the bars are sorted by how far
 * equity NPV travels. That sorted shape is the whole point: the widest bar at the top is the number
 * worth arguing about, and the narrow ones at the bottom are the assumptions nobody need spend
 * another meeting on.
 *
 * ── Measured on equity NPV, and the two measures that were wrong ───────────────────────────
 *
 * Getting the output measure right took two attempts, and both failures are worth recording
 * because both produced a confident, readable, wrong chart.
 *
 * **Unlevered NPV** discounts the project cash flow, which by construction excludes interest, so
 * moving the rate two points changed it by *exactly* nothing. On a scheme paying R159m of
 * interest, a tornado reporting the rate as irrelevant tells a developer to stop negotiating with
 * the bank.
 *
 * **Nominal profit** fixed that and broke the other end: with prices escalating 5% a year and the
 * build finished in month 42, a slower sell-out earns *more* money, so absorption came out
 * backwards and nearly flat — on the very scheme whose return gate fails because of a 10.5-year
 * sell-out.
 *
 * Equity NPV carries both. It discounts what equity actually puts in and takes out, so time is
 * priced and interest is in the flows. Neither of the other two is a rounding difference from it;
 * they rank the levers in a different order and would send a QS to negotiate the wrong thing.
 *
 * ── One at a time, deliberately ────────────────────────────────────────────────────────────
 *
 * This is not the downside scenario, and it is not trying to be. `runScenarios` moves four things
 * together because that is what a downturn does; a tornado moves them separately because the
 * question is different — not "what if things go badly" but "which lever is this hostage to".
 * Reading either one as the other is the usual way a sensitivity analysis misleads.
 */
export function sensitivity(inputs: ScenarioInputs, swing = 0.1): Swing[] {
  const npvOf = (over: Partial<ScenarioInputs>) =>
    runScenario("sensitivity", { ...inputs, ...over }).npvEquityAtHurdle;

  const spreadOf = (low: Money, high: Money) => money(high > low ? high - low : low - high);

  const pct = Math.round(swing * 100);

  const cases: readonly { variable: string; range: string; low: Money; high: Money }[] = [
    {
      variable: "Selling price",
      range: `±${pct}%`,
      low: npvOf({ priceFactor: 1 - swing }),
      high: npvOf({ priceFactor: 1 + swing }),
    },
    {
      variable: "Build cost",
      range: `±${pct}%`,
      // Inverted on purpose: a *higher* build cost is the adverse end, so it belongs in `low`.
      low: npvOf({ buildFactor: 1 + swing }),
      high: npvOf({ buildFactor: 1 - swing }),
    },
    {
      variable: "Absorption rate",
      range: `±${pct}%`,
      low: npvOf({ absorptionPerYear: inputs.absorptionPerYear * (1 - swing) }),
      high: npvOf({ absorptionPerYear: inputs.absorptionPerYear * (1 + swing) }),
    },
    {
      variable: "Interest rate",
      range: "±2 points",
      low: npvOf({ interestDelta: 0.02 }),
      high: npvOf({ interestDelta: -0.02 }),
    },
  ];

  return cases
    .map((c) => ({ ...c, spread: spreadOf(c.low, c.high) }))
    .sort((a, b) => (b.spread > a.spread ? 1 : b.spread < a.spread ? -1 : 0));
}
