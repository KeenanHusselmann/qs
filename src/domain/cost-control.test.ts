import { describe, expect, it } from "vitest";

import { costCheck, decisionRefusal, revisionInForce, shareText, TOLERANCE_BP, type CostCheck } from "@/domain/cost-control";
import { elementalPlan, type PlanRow } from "@/domain/elemental-plan";
import { money, percent } from "@/domain/money";

/*
  A small bill, worked by hand.

  Measured work R3 500 000: substructure R1 000 000, superstructure R2 000 000, finishes R300 000
  and fittings R200 000. Preliminaries 10% of it is R350 000; contingency 5% of R3 850 000 is
  R192 500; no escalation. Total excluding VAT R4 042 500.
*/
const R = (rands: number) => money(BigInt(rands) * 100n);
const row = (id: string, element: PlanRow["element"], rands: number | null): PlanRow => ({
  id,
  description: id,
  element,
  amount: rands === null ? null : R(rands),
});
const bill = (extra: PlanRow[] = []) =>
  elementalPlan(
    [row("footings", "substructure", 1_000_000), row("walls", "superstructure", 2_000_000), row("plaster", "finishes", 300_000), row("joinery", "fittings", 200_000), ...extra],
    { preliminaries: percent(1000n), contingency: percent(500n), escalation: percent(0n), vat: percent(1500n) },
  );

const plan = (overrides: Record<string, string | undefined> = {}) =>
  new Map(
    Object.entries({
      "cp-total": "R 4 400 000",
      "cp-substructure": "R 900 000",
      "cp-superstructure": "R 2 000 000",
      "cp-finishes": "R 520 000",
      "cp-services": "R 400 000",
      "cp-preliminaries": "R 350 000",
      "cp-contingency": "R 200 000",
      ...overrides,
    }).filter((e): e is [string, string] => e[1] !== undefined),
  );

const line = (check: CostCheck, id: string) => check.lines.find((l) => l.id === id)!;
// formatMoney groups thousands with a non-breaking space; the sentences are matched as read.
const said = (check: CostCheck) => check.findings.map((f) => f.replace(/ /g, " "));

describe("the detailed estimate against the cost plan", () => {
  it("builds the detailed side from the bill's own plan", () => {
    expect(bill().excludingVat).toBe(R(4_042_500));
  });

  it("reports an element over its target, by how much and by what share", () => {
    const sub = line(costCheck(plan(), bill()), "substructure");
    expect(sub.status).toBe("over");
    expect(sub.movement).toBe(R(100_000));
    // R100 000 over R900 000 is 11,1%.
    expect(sub.movementBp).toBe(1111);
  });

  it("treats a move inside the tolerance as the estimate getting sharper, not as a movement", () => {
    const check = costCheck(plan(), bill());
    // Finishes and fittings: R500 000 against R520 000, 3,8% under.
    expect(line(check, "finishes").detailed).toBe(R(500_000));
    expect(Math.abs(line(check, "finishes").movementBp!)).toBeLessThanOrEqual(TOLERANCE_BP);
    expect(line(check, "finishes").status).toBe("within");
    // Contingency: R192 500 against R200 000, 3,75% under.
    expect(line(check, "contingency").status).toBe("within");
    expect(line(check, "preliminaries").status).toBe("within");
  });

  it("does not call a target with nothing in the bill a saving", () => {
    const services = line(costCheck(plan(), bill()), "services");
    expect(services.status).toBe("not-measured");
    expect(services.movement).toBeNull();
  });

  it("will not say within budget while an element is unmeasured", () => {
    const check = costCheck(plan(), bill());
    // R4 042 500 against R4 400 000 is under – but services are not in the bill at all.
    expect(check.verdict).toBe("incomplete");
    expect(said(check)[0]).toMatch(/not complete, so that is not yet a saving/);
    expect(said(check).some((f) => /Engineering services has a target of R 400 000,00 and nothing in the bill/.test(f))).toBe(true);
  });

  it("says over budget when it is over, gaps or not – they only add to it", () => {
    const check = costCheck(plan({ "cp-total": "R 3 900 000" }), bill());
    expect(check.verdict).toBe("over-budget");
    expect(check.movement).toBe(R(142_500));
    expect(check.movementBp).toBe(365);
    expect(said(check)[0]).toMatch(/R 142 500,00 \(3,7%\) over the cost plan's total/);
  });

  it("says within budget once everything the plan carries is measured and priced", () => {
    const check = costCheck(plan({ "cp-services": undefined, "cp-total": "R 4 100 000" }), bill());
    expect(check.verdict).toBe("within-budget");
    expect(said(check)[0]).toMatch(/within the cost plan's total, R 57 500,00 under it/);
  });

  it("will not say within budget while a bill item is unpriced", () => {
    const check = costCheck(plan({ "cp-services": undefined, "cp-total": "R 4 100 000" }), bill([row("gate", "superstructure", null)]));
    expect(check.verdict).toBe("incomplete");
    expect(said(check).some((f) => /1 bill item is not priced/.test(f))).toBe(true);
  });

  it("lists the largest overrun first", () => {
    const check = costCheck(plan({ "cp-superstructure": "R 1 500 000" }), bill());
    const overs = said(check).filter((f) => / over its target/.test(f));
    expect(overs[0]).toMatch(/^Superstructure is R 500 000,00/);
    expect(overs[1]).toMatch(/^Substructure is R 100 000,00/);
  });

  it("shows bill money the plan has no line for, without a target", () => {
    const check = costCheck(plan(), bill([row("PC sum", "provisional", 80_000)]));
    expect(line(check, "provisional").status).toBe("no-target");
    expect(said(check).some((f) => /Provisional and prime cost sums of R 80 000,00 in the bill have no target/.test(f))).toBe(true);
  });

  it("refuses to read a target that is not one amount, and quotes it", () => {
    const check = costCheck(plan({ "cp-superstructure": "R 2 000 000 or R 2 100 000" }), bill());
    expect(line(check, "superstructure").status).toBe("unreadable");
    expect(line(check, "superstructure").target).toBeNull();
    expect(said(check).some((f) => f.includes('"R 2 000 000 or R 2 100 000"'))).toBe(true);
  });

  it("finds money the cost plan carries in no element", () => {
    // 900 000 + 2 000 000 + 520 000 + 400 000 + 350 000 + 200 000 = 4 370 000, against 4 400 000.
    const check = costCheck(plan(), bill());
    expect(said(check).some((f) => /R 30 000,00 sits in no element/.test(f))).toBe(true);
  });

  it("says a plan whose elements add to more than its total does not reconcile – not that money is missing", () => {
    // The same elements, 4 370 000, against a total of 3 900 000. Found rendering the report:
    // it printed "−R 470 000,00 sits in no element".
    const found = said(costCheck(plan({ "cp-total": "R 3 900 000" }), bill()));
    expect(found.some((f) => /add to R 4 370 000,00, R 470 000,00 more than its total of R 3 900 000,00\. The plan does not reconcile/.test(f))).toBe(true);
    expect(found.some((f) => /sits in no element/.test(f))).toBe(false);
  });

  it("leaves off a line neither the plan nor the bill carries", () => {
    // No escalation target, and nought escalation in the bill.
    expect(costCheck(plan(), bill()).lines.some((l) => l.id === "escalation")).toBe(false);
  });

  it("holds the estimate to a revised budget where the client approved one, not the plan's total", () => {
    const check = costCheck(plan({ "cp-services": undefined, "cp-total": "R 3 900 000" }), bill(), R(4_100_000));
    expect(check.budgetSource).toBe("revised");
    expect(check.budget).toBe(R(4_100_000));
    expect(check.verdict).toBe("within-budget");
    expect(said(check)[0]).toMatch(/within the revised budget/);
    // The element targets stay the plan's.
    expect(line(check, "substructure").target).toBe(R(900_000));
  });

  it("has nothing to hold the estimate to without a total", () => {
    const check = costCheck(plan({ "cp-total": undefined }), bill());
    expect(check.verdict).toBe("no-budget");
    expect(check.movement).toBeNull();
  });
});

describe("a movement as a share of its target", () => {
  it("is worked from the cents in one rounding", () => {
    // 35,747%: rounding to basis points first (3 575) and then to tenths gave 35,8%. Found by the
    // browser suite on the CI database.
    expect(shareText(money(5_362_065n), R(150_000))).toBe("35,7%");
    // 3,654%: `(365 / 100).toFixed(1)` gave 3,6%.
    expect(shareText(R(142_500), R(3_900_000))).toBe("3,7%");
    expect(shareText(R(100_000), R(900_000))).toBe("11,1%");
  });

  it("rounds half away from zero, and signs on request", () => {
    // 0,05% exactly – 1 over 2 000.
    expect(shareText(R(1), R(2_000))).toBe("0,1%");
    expect(shareText(money(-R(20_000)), R(520_000), true)).toBe("−3,8%");
    expect(shareText(R(8_000), R(350_000), true)).toBe("+2,3%");
  });

  it("has no share of nothing", () => {
    expect(shareText(R(1), null)).toBeNull();
    expect(shareText(R(1), R(0))).toBeNull();
  });
});

describe("which revised budget stands", () => {
  const d = (decision: "proceed" | "redesign" | "revise-budget", plan: string, rands: number | null) => ({
    decision,
    costPlanRunId: plan,
    revisedBudget: rands === null ? null : R(rands),
  });

  it("is the latest revision for this cost plan, through later decisions taken on it", () => {
    // Newest first: a redesign after the R4,2m revision, which replaced a R4,1m one.
    const decisions = [d("redesign", "plan-1", null), d("revise-budget", "plan-1", 4_200_000), d("revise-budget", "plan-1", 4_100_000)];
    expect(revisionInForce(decisions, "plan-1")?.revisedBudget).toBe(R(4_200_000));
  });

  it("does not carry over to a cost plan signed again", () => {
    expect(revisionInForce([d("revise-budget", "plan-1", 4_200_000)], "plan-2")).toBeNull();
    expect(revisionInForce([d("revise-budget", "plan-1", 4_200_000)], null)).toBeNull();
  });
});

describe("recording the client's decision", () => {
  const over = costCheck(plan({ "cp-total": "R 3 900 000" }), bill());
  const within = costCheck(plan({ "cp-services": undefined, "cp-total": "R 4 100 000" }), bill());
  const incomplete = costCheck(plan(), bill());

  it("allows proceeding only on an estimate within budget", () => {
    expect(decisionRefusal(within, "proceed", "", null)).toBeNull();
    expect(decisionRefusal(over, "proceed", "", null)).toMatch(/approve a revised budget instead/);
    expect(decisionRefusal(incomplete, "proceed", "", null)).toMatch(/not complete/);
  });

  it("needs a redesign to say what is redesigned", () => {
    expect(decisionRefusal(over, "redesign", "fix", null)).toMatch(/Say what is to be redesigned/);
    expect(decisionRefusal(over, "redesign", "Substructure back to R900 000: revisit the footing size", null)).toBeNull();
  });

  it("needs a revised budget to carry its amount and its reason", () => {
    expect(decisionRefusal(over, "revise-budget", "Client accepts the larger footing", null)).toMatch(/needs its amount/);
    expect(decisionRefusal(over, "revise-budget", "ok", R(4_100_000))).toMatch(/Say why/);
    expect(decisionRefusal(over, "revise-budget", "Client accepts the larger footing", R(4_100_000))).toBeNull();
  });

  it("has nothing to decide without a budget", () => {
    expect(decisionRefusal(costCheck(plan({ "cp-total": undefined }), bill()), "redesign", "Substructure back to target", null)).toMatch(/no budget/);
  });
});
