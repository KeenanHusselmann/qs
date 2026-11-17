import { describe, expect, it } from "vitest";

import { evaluateGates, type GateInputs } from "./gates";
import { runScenarios } from "./cashflow";
import { money, type Money } from "./money";

const R = (rand: number): Money => money(BigInt(Math.round(rand * 100)));

/** Ridgeview: a ceiling of R952 108,73 and a development cost of about R550 000 a unit. */
const ridgeview: GateInputs = {
  affordabilityCeiling: R(952_108.73),
  costPerUnit: R(549_552),
  bulk: R(42_300_000),
  units: 1_046,
  incomeBandMax: R(30_000),
};

/**
 * Whitespace folded before comparing.
 *
 * Money groups with U+00A0 (§7.7), and an assertion typed with an ordinary space never matches —
 * failing in a way that looks like a wrong figure rather than a wrong space.
 */
const flat = (text: string | null) => (text ?? "").replace(/\s+/g, " ");

const at = (verdict: ReturnType<typeof evaluateGates>, no: number) =>
  verdict.gates.find((gate) => gate.no === no)!;

describe("Ridgeview through the gates", () => {
  const verdict = evaluateGates(ridgeview);

  it("confirms it is an affordable-housing scheme", () => {
    expect(at(verdict, 0).state).toBe("pass");
  });

  it("finds it builds under what its buyers can finance", () => {
    expect(at(verdict, 1).state).toBe("pass");
    expect(at(verdict, 1).finding).toMatch(/headroom/);
  });

  it("finds the bulk contribution within the band", () => {
    // R42 300 000 over 1 046 units is about R40 440 — well inside R120 000.
    expect(at(verdict, 2).state).toBe("pass");
    expect(flat(at(verdict, 2).metric)).toMatch(/40 4/);
  });

  it("reaches no verdict, because three gates are untested", () => {
    // The point of the whole module. "Go" on a scheme nobody has tested for fundability is the
    // most expensive sentence this platform could print.
    expect(verdict.overall).toBeNull();
    expect(verdict.evaluated).toBe(3);
    expect(verdict.total).toBe(6);
  });
});

describe("the QS gate — the one the scheme lives or dies on", () => {
  it("fails when the build costs more than the market can finance", () => {
    const dear = evaluateGates({ ...ridgeview, costPerUnit: R(1_100_000) });

    expect(at(dear, 1).state).toBe("fail");
    expect(at(dear, 1).finding).toMatch(/more per unit than the top of its own target market/);
  });

  it("names the gap, so the intervention is sized", () => {
    const dear = evaluateGates({ ...ridgeview, costPerUnit: R(1_100_000) });
    // R1 100 000 − R952 108,73.
    expect(flat(at(dear, 1).finding)).toMatch(/147 89/);
  });

  it("tells the reader what to do about it", () => {
    const dear = evaluateGates({ ...ridgeview, costPerUnit: R(1_100_000) });
    expect(at(dear, 1).recommendation).toMatch(/specification or the typology mix/);
  });

  it("passes exactly at the ceiling — the buyer can finance it", () => {
    const exact = evaluateGates({ ...ridgeview, costPerUnit: R(952_108.73) });
    expect(at(exact, 1).state).toBe("pass");
  });

  it("is not evaluated where the ceiling is unknown, never passed", () => {
    // A gate with nothing to measure against has not been cleared.
    const noBand = evaluateGates({ ...ridgeview, affordabilityCeiling: null });
    expect(at(noBand, 1).state).toBe("not-evaluated");
    expect(at(noBand, 1).finding).toMatch(/target income band signed/);
  });
});

describe("the scope rule", () => {
  it("fails a band below the floor this platform assesses", () => {
    const below = evaluateGates({ ...ridgeview, incomeBandMax: R(6_000) });
    expect(at(below, 0).state).toBe("fail");
  });

  it("states it as a fact about our scope, not a judgement about their scheme", () => {
    // A client decision, and the better message: "below the affordable band" is ours to say;
    // "this is social housing" is a judgement about their development we have no standing to record.
    const below = evaluateGates({ ...ridgeview, incomeBandMax: R(6_000) });
    expect(below.gates[0].finding).toMatch(/about our scope, not a judgement/);
    expect(below.gates[0].finding).not.toMatch(/social|RDP|BNG/i);
  });

  it("is not evaluated with no band signed", () => {
    const none = evaluateGates({ ...ridgeview, incomeBandMax: null });
    expect(at(none, 0).state).toBe("not-evaluated");
  });
});

describe("the bulk gate", () => {
  it("fails a scheme carrying more bulk per unit than the band", () => {
    const heavy = evaluateGates({ ...ridgeview, bulk: R(200_000_000) });
    expect(at(heavy, 2).state).toBe("fail");
  });

  it("is not evaluated without both a contribution and a unit count", () => {
    expect(at(evaluateGates({ ...ridgeview, bulk: null }), 2).state).toBe("not-evaluated");
    expect(at(evaluateGates({ ...ridgeview, units: null }), 2).state).toBe("not-evaluated");
    expect(at(evaluateGates({ ...ridgeview, units: 0 }), 2).state).toBe("not-evaluated");
  });
});

describe("the three gates the cash flow decides", () => {
  const scheme = {
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
  };

  const market = { absorptionMin: 96, absorptionMax: 192 };
  const asBuilt = evaluateGates({ ...ridgeview, scenarios: runScenarios(scheme, market) });

  const phased = evaluateGates({
    ...ridgeview,
    scenarios: runScenarios(
      {
        ...scheme,
        phases: [
          { units: 350, startMonth: 0, constructionMonths: 14 },
          { units: 350, startMonth: 11, constructionMonths: 14 },
          { units: 346, startMonth: 22, constructionMonths: 14 },
        ],
      },
      market,
    ),
  });

  it("evaluates all six once the model has run", () => {
    expect(asBuilt.evaluated).toBe(6);
    expect(asBuilt.gates.every((gate) => gate.state !== "not-evaluated")).toBe(true);
  });

  it("finds Ridgeview fundable as drawn", () => {
    expect(at(asBuilt, 3).state).toBe("pass");
  });

  it("fails it on return, despite a margin that looks handsome", () => {
    /*
      The finding this whole engine exists to produce, and the one a margin-only feasibility
      cannot reach: 42% on cost, and it still destroys value, because the money is out for a
      decade waiting for 1 046 units to sell at 144 a year.
    */
    expect(at(asBuilt, 4).state).toBe("fail");
    expect(flat(at(asBuilt, 4).finding)).toMatch(/margin but does not clear/);
    expect(at(asBuilt, 4).finding).toMatch(/is not the same return as/);
  });

  it("names the sell-out, so the reader knows what is doing the damage", () => {
    expect(at(asBuilt, 4).finding).toMatch(/10,5-year sell-out/);
  });

  it("points at the programme rather than the specification", () => {
    // A cost saving cannot fix a timing problem, and sending a QS to shave the finishes on a
    // scheme whose fault is its sell-out wastes the one intervention that would have worked.
    expect(at(asBuilt, 4).recommendation).toMatch(/Shorten the sell-out before touching the cost/);
  });

  it("fails it in the downside too", () => {
    expect(at(asBuilt, 5).state).toBe("fail");
  });

  it("reaches No-Go on the scheme as drawn", () => {
    expect(asBuilt.overall).toBe("no-go");
    expect(asBuilt.firstFailing).toBe(4);
  });

  it("clears the return gate once the scheme is phased", () => {
    /*
      Same units, same contract sum, same market. Only the programme changes — and the return
      gate goes from fail to pass. No cost plan on its own could have found that, because
      nothing about the cost moved.
    */
    expect(at(asBuilt, 4).state).toBe("fail");
    expect(at(phased, 4).state).toBe("pass");
  });

  it("still refuses it, because phasing is necessary and not sufficient", () => {
    /*
      The honest answer, and the one worth having. Phasing fixes the return but the downside is
      still a 12-year hold at the market's slowest absorption, and 5% to equity over twelve years
      does not clear a 6% hurdle. A platform that declared Go here would have congratulated the
      developer for solving the wrong half of the problem.
    */
    expect(at(phased, 5).state).toBe("fail");
    expect(phased.overall).toBe("no-go");
  });

  it("moves the binding constraint, which is the next thing to fix", () => {
    // Fixing gate 4 promotes gate 5 to first-failing. That progression is the advice.
    expect(asBuilt.firstFailing).toBe(4);
    expect(phased.firstFailing).toBe(5);
    expect(phased.bindingConstraint).toBe("Resilience");
  });

  it("needs less money in the ground when phased, and says so", () => {
    expect(flat(at(phased, 3).finding)).toMatch(/deepest the scheme goes/);
    expect(at(phased, 3).state).toBe("pass");
  });
});

describe("the verdict", () => {
  it("names the first failing gate — the most valuable intervention", () => {
    // A list of five findings identifies none of them as the one to act on.
    const failing = evaluateGates({ ...ridgeview, incomeBandMax: R(6_000), costPerUnit: R(2_000_000) });

    expect(failing.firstFailing).toBe(0);
    expect(failing.bindingConstraint).toBe("Affordable-housing context");
  });

  it("is No-Go the moment any gate fails, whatever else passes", () => {
    // A gate is a rule. A scheme that fails one is not eighty per cent feasible.
    const failing = evaluateGates({ ...ridgeview, costPerUnit: R(2_000_000) });
    expect(failing.overall).toBe("no-go");
  });

  it("never reaches Go while a gate is untested", () => {
    expect(evaluateGates(ridgeview).overall).toBeNull();
  });

  it("counts what it could not test rather than hiding it", () => {
    const verdict = evaluateGates(ridgeview);
    const untested = verdict.gates.filter((gate) => gate.state === "not-evaluated");

    expect(untested.map((gate) => gate.no)).toEqual([3, 4, 5]);
    for (const gate of untested) expect(gate.finding).toMatch(/^Not evaluated\./);
  });

  it("says what each untested gate is waiting for", () => {
    const verdict = evaluateGates(ridgeview);
    expect(at(verdict, 3).finding).toMatch(/peak funding/);
    expect(at(verdict, 4).finding).toMatch(/IRR, NPV and margin/);
    expect(at(verdict, 5).finding).toMatch(/downside scenario/);
  });
});
