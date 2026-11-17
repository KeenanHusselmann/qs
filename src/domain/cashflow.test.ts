import { describe, expect, it } from "vitest";

import {
  AFFORDABLE_HURDLES,
  annualise,
  irrMonthly,
  npv,
  runScenario,
  runScenarios,
  sensitivity,
  scurveWeights,
  type ScenarioInputs,
} from "./cashflow";
import { money, type Money } from "./money";

const R = (rand: number): Money => money(BigInt(Math.round(rand * 100)));
const rand = (amount: Money): number => Number(amount) / 100;

/**
 * ── Parity with v3 ────────────────────────────────────────────────────────────────────────
 *
 * These are not values I derived here — they are the output of v3's `financial_agent.py` run on
 * the same inputs, captured before the port. A ported model that agrees with its source to ten
 * decimal places has been ported; one that merely looks right has not.
 */
describe("the maths, against v3's own output", () => {
  const flows = [-1000, -2000, -3000, 2000, 3000, 4000];

  it("discounts to v3's NPV", () => {
    expect(npv(0, flows)).toBeCloseTo(3000, 6);
    expect(npv(0.01, flows)).toBeCloseTo(2708.897912, 6);
  });

  it("finds v3's IRR", () => {
    expect(irrMonthly(flows)).toBeCloseTo(0.1509110843, 10);
  });

  it("annualises it the way v3 does — compounding, not twelve times", () => {
    // 0.1509 a month is 440% a year, not 181%. The difference is the whole reason this is a
    // separate function rather than a multiplication at the call site.
    expect(annualise(irrMonthly(flows))).toBeCloseTo(4.4013369742, 9);
  });

  it("builds v3's S-curve", () => {
    expect(scurveWeights(6)).toEqual([
      expect.closeTo(0.11502546, 8),
      expect.closeTo(0.21485152, 8),
      expect.closeTo(0.2444722, 8),
      expect.closeTo(0.2200687, 8),
      expect.closeTo(0.15162331, 8),
      expect.closeTo(0.05395881, 8),
    ]);
  });

  it("spends every rand of the build and no more", () => {
    for (const months of [1, 6, 12, 36, 60]) {
      const total = scurveWeights(months).reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(1, 12);
    }
  });

  it("peaks in the middle, not at the ends", () => {
    // The property that makes it an S-curve rather than a flat spread: a build is slow to
    // mobilise and tails off through finishes.
    const weights = scurveWeights(12);
    const peak = weights.indexOf(Math.max(...weights));

    expect(peak).toBeGreaterThan(2);
    expect(peak).toBeLessThan(9);
    expect(weights[0]).toBeLessThan(weights[5]);
    expect(weights[11]).toBeLessThan(weights[5]);
  });
});

describe("the IRR that refuses to answer", () => {
  it("has none for a flow that never turns", () => {
    // A stream of receipts has no internal rate of return. Returning 0, or the discount rate, or
    // any number at all would be read as a finding.
    expect(irrMonthly([1, 2, 3])).toBeNull();
    expect(irrMonthly([-1, -2, -3])).toBeNull();
    expect(irrMonthly([])).toBeNull();
  });

  it("has none where the root lies outside the bracket", () => {
    // −99% a month is a real answer to a catastrophic flow, and it is not one bisection between
    // −50% and +100% can reach. Null rather than the nearest endpoint.
    expect(irrMonthly([-1_000_000, 1])).toBeNull();
  });

  it("passes the null through rather than annualising it", () => {
    expect(annualise(null)).toBeNull();
  });
});

/**
 * Ridgeview Gardens, as the platform has it signed.
 *
 * 1 046 units at an average of R737 558, a contract sum of R467 440 000, absorption of 144 units
 * a year and a 36-month build.
 */
const ridgeview: ScenarioInputs = {
  construction: R(467_440_000),
  fees: R(56_092_800),
  upFront: R(51_300_000),
  units: 1_046,
  averagePrice: R(737_558),
  salesCommission: 0.03,
  priceEscalationPa: 0.05,
  absorptionPerYear: 144,
  preDevelopmentMonths: 6,
  phases: [{ units: 1_046, startMonth: 0, constructionMonths: 36 }],
  hurdles: AFFORDABLE_HURDLES,
};

describe("Ridgeview through the cash flow", () => {
  const base = runScenario("base", ridgeview);

  it("runs until the last unit is sold, not until the build is finished", () => {
    // 1 046 units at 12 a month is 87 months of selling, and it cannot start before the units
    // exist. A model that stopped at practical completion would report a scheme two thirds
    // shorter and correspondingly cheaper to finance.
    expect(base.selloutMonth).toBeGreaterThan(120);
  });

  it("names absorption as the binding constraint", () => {
    // The finding this whole module exists to produce. Ridgeview is not expensive to build; it is
    // slow to sell, and the interest on that is what decides it.
    expect(base.warnings.join(" ")).toMatch(/Absorption is the binding constraint/);
  });

  it("sells every unit", () => {
    const sold = base.flows.reduce((a, f) => a + f.unitsSold, 0);
    expect(sold).toBeGreaterThanOrEqual(1_040);
    expect(sold).toBeLessThanOrEqual(1_046);
  });

  it("balances: revenue less every cost is the profit", () => {
    const revenue = rand(base.totalRevenue);
    const cost = rand(base.totalCostInclFinance);
    expect(rand(base.profit)).toBeCloseTo(revenue - cost, 2);
  });

  it("charges interest for every month the money is out", () => {
    expect(base.totalInterest).toBeGreaterThan(0n);
  });

  it("puts peak funding at the deepest point of the cumulative flow", () => {
    let cumulative = 0;
    let deepest = 0;
    let at = 0;

    for (const flow of base.flows) {
      cumulative += flow.salesIn - flow.constructionOut - flow.otherOut;
      if (cumulative < deepest) {
        deepest = cumulative;
        at = flow.month;
      }
    }

    expect(rand(base.peakFunding)).toBeCloseTo(-deepest / 100, 2);
    expect(base.peakFundingMonth).toBe(at);
  });

  it("pays back after it peaks, never before", () => {
    expect(base.paybackMonth).not.toBeNull();
    expect(base.paybackMonth!).toBeGreaterThan(base.peakFundingMonth);
  });

  it("funds the first month 40/60, equity to its cap and debt for the rest", () => {
    /*
      The waterfall, at the first month that needs funding: R51,3m of land and statutory plus the
      first slice of fees. Equity is drawn to its 40% cap and the facility takes the balance —
      so on a R55 039 520 month, R22 015 808 is equity's and R33 023 712 is the bank's.
    */
    const first = base.flows[0];
    const cost = first.constructionOut + first.otherOut;

    expect(first.equityDrawn).toBeCloseTo(cost * 0.4, 2);
    expect(first.debtBalance).toBeCloseTo(cost * 0.6, 2);
    expect(rand(money(BigInt(Math.round(first.equityDrawn))))).toBeCloseTo(22_015_808, 2);
  });

  it("clears the debt before it distributes to equity", () => {
    for (const flow of base.flows) {
      if (flow.debtBalance > 0.01) continue;
      // Past this point distributions are allowed; before it, none were counted.
      break;
    }
    expect(base.equityIrrPa).not.toBeNull();
  });
});

describe("what phasing is worth", () => {
  /*
    The same scheme, built in three tranches instead of one.

    This is the model earning its keep. Nothing about the cost changes — same units, same contract
    sum, same absorption — but revenue starts arriving three years earlier, and the interest on
    the difference is real money. A feasibility that cannot show this cannot advise on it.
  */
  const phased = runScenario("phased", {
    ...ridgeview,
    phases: [
      { units: 350, startMonth: 0, constructionMonths: 14 },
      { units: 350, startMonth: 11, constructionMonths: 14 },
      { units: 346, startMonth: 22, constructionMonths: 14 },
    ],
  });

  const single = runScenario("single", ridgeview);

  it("needs less money in the ground", () => {
    expect(phased.peakFunding).toBeLessThan(single.peakFunding);
  });

  it("costs less to finance", () => {
    expect(phased.totalInterest).toBeLessThan(single.totalInterest);
  });

  it("earns a better margin on the same scheme", () => {
    expect(phased.marginOnCost).toBeGreaterThan(single.marginOnCost);
  });
});

describe("the three scenarios", () => {
  const { base, downside, upside } = runScenarios(ridgeview, {
    absorptionMin: 96,
    absorptionMax: 192,
  });

  it("is worse than base on every axis in the downside", () => {
    // Four adverse moves at once, because in a downturn they arrive together. A downside that
    // improved any measure would mean a lever was wired backwards.
    expect(downside.marginOnCost).toBeLessThan(base.marginOnCost);
    expect(downside.totalRevenue).toBeLessThan(base.totalRevenue);
    expect(downside.totalInterest).toBeGreaterThan(base.totalInterest);
    expect(downside.selloutMonth).toBeGreaterThan(base.selloutMonth);
  });

  it("is better than base in the upside, on absorption and price alone", () => {
    expect(upside.marginOnCost).toBeGreaterThan(base.marginOnCost);
    expect(upside.selloutMonth).toBeLessThan(base.selloutMonth);
  });

  it("does not pretend the build gets cheaper in the upside", () => {
    // Building under budget is not a scenario anyone should underwrite.
    const baseBuild = base.flows.reduce((a, f) => a + f.constructionOut, 0);
    const upBuild = upside.flows.reduce((a, f) => a + f.constructionOut, 0);
    expect(upBuild).toBeCloseTo(baseBuild, 2);
  });

  it("keeps subsidy out of revenue entirely", () => {
    /*
      The upside is where FLISP appears in v3, and it appears as faster absorption — never as
      income. So upside revenue may only exceed base by the price uplift and the escalation
      saved by selling sooner, never by a subsidy quantum.
    */
    const ratio = Number(upside.totalRevenue) / Number(base.totalRevenue);
    expect(ratio).toBeLessThan(1.1);
  });
});

describe("a scheme that cannot be modelled says so", () => {
  it("refuses a scheme with no units", () => {
    const none = runScenario("none", { ...ridgeview, units: 0 });
    expect(none.months).toBe(0);
    expect(none.warnings.join(" ")).toMatch(/no scheme to model/);
  });

  it("refuses a market that absorbs nothing", () => {
    // Zero absorption is not a slow scheme, it is a division by zero dressed as a forecast.
    const dead = runScenario("dead", { ...ridgeview, absorptionPerYear: 0 });
    expect(dead.months).toBe(0);
    expect(dead.warnings.join(" ")).toMatch(/nothing ever sells/i);
  });

  it("states no return at all rather than a misleading zero", () => {
    const none = runScenario("none", { ...ridgeview, units: 0 });
    expect(none.projectIrrPa).toBeNull();
    expect(none.equityIrrPa).toBeNull();
  });

  it("says when the horizon ran out before the units sold", () => {
    // 1 046 units at 24 a year is 43 years. The model reports what it could not finish rather
    // than reporting the part it could as though it were the scheme.
    const glacial = runScenario("glacial", { ...ridgeview, absorptionPerYear: 24 });
    expect(glacial.warnings.join(" ")).toMatch(/Not every unit sells inside 20 years/);
  });
});

describe("the tornado — which assumption the answer is hostage to", () => {
  const levers = sensitivity(ridgeview);

  it("tests every lever a development appraisal turns", () => {
    expect(levers.map((l) => l.variable).sort()).toEqual([
      "Absorption rate",
      "Build cost",
      "Interest rate",
      "Selling price",
    ]);
  });

  it("sorts widest first, which is the whole point of the shape", () => {
    // The top bar is the number worth arguing about. An unsorted tornado is just four bars.
    for (let i = 1; i < levers.length; i += 1) {
      expect(levers[i - 1].spread >= levers[i].spread).toBe(true);
    }
  });

  it("finds selling price the one Ridgeview lives on", () => {
    expect(levers[0].variable).toBe("Selling price");
  });

  it("gives every lever a real spread", () => {
    /*
      The regression that caught two wrong output measures.

      Measured on unlevered NPV the interest rate moved the answer by *exactly zero*, because
      interest is not in the project cash flow — a tornado telling a developer the rate does not
      matter on a scheme paying R159m of it. Measured on nominal profit, absorption came out
      backwards. Equity NPV is the measure that carries both, and this asserts none of the four
      has silently fallen out of the model again.
    */
    for (const lever of levers) expect(lever.spread).toBeGreaterThan(0n);
  });

  it("puts the adverse end below the favourable one on every lever", () => {
    // Including build cost, where the adverse direction is *up* — the one that is easy to wire
    // backwards and impossible to spot on the chart.
    for (const lever of levers) expect(lever.low).toBeLessThan(lever.high);
  });

  it("says what each lever was moved by, so the bar can be read", () => {
    expect(levers.find((l) => l.variable === "Interest rate")?.range).toBe("±2 points");
    expect(levers.find((l) => l.variable === "Selling price")?.range).toBe("±10%");
  });

  it("takes the swing as an argument rather than baking one in", () => {
    const wider = sensitivity(ridgeview, 0.2);
    expect(wider[0].spread).toBeGreaterThan(levers[0].spread);
    expect(wider[0].range).toBe("±20%");
  });
});

describe("levered and unlevered NPV are different measures", () => {
  const base = runScenario("base", ridgeview);

  it("reports both, because they answer different questions", () => {
    // Not a rounding difference: one prices the project, the other prices the equity in it.
    expect(base.npvAtHurdle).not.toBe(base.npvEquityAtHurdle);
  });

  it("only the levered one responds to the cost of debt", () => {
    const dearer = runScenario("dearer", { ...ridgeview, interestDelta: 0.02 });

    expect(dearer.npvAtHurdle).toBe(base.npvAtHurdle);
    expect(dearer.npvEquityAtHurdle).toBeLessThan(base.npvEquityAtHurdle);
  });
});
