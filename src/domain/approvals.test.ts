import { describe, expect, it } from "vitest";

import { APPROVAL_REGISTER, approvalProgramme } from "./approvals";
import { money, type Money } from "./money";

const R = (rand: number): Money => money(BigInt(Math.round(rand * 100)));

/** Ridgeview: land, bulk and statutory committed before a spade goes in. */
const ridgeview = {
  committedUpFront: R(51_300_000),
  holdingRatePa: 0.1175,
  modelledPreDevelopmentMonths: 6,
};

describe("the critical path", () => {
  const programme = approvalProgramme(ridgeview);

  it("is the longest chain, not the sum of the lead times", () => {
    /*
      The whole reason this is a graph and not a list. Adding every lead time gives 42 months;
      the environmental authorisation and the water licence run alongside the SPLUMA application
      rather than after it, and a programme that sequenced them would overstate the delay by half
      a scheme's worth of holding cost.
    */
    expect(programme.criticalPathMonths).toBe(19);

    const summed = APPROVAL_REGISTER.reduce((total, step) => total + step.leadMonths, 0);
    expect(summed).toBeGreaterThan(programme.criticalPathMonths);
  });

  it("follows the dependency chain to the end", () => {
    // SPLUMA 12 → SDP 3 → building plans 3 → NHBRC 1.
    const nhbrc = programme.steps.find((s) => s.approval === "NHBRC enrolment")!;
    expect(nhbrc.finishMonth).toBe(19);
  });

  it("starts the parallel approvals at month zero", () => {
    const environmental = programme.steps.find((s) => s.approval.startsWith("Environmental"))!;
    expect(environmental.finishMonth).toBe(environmental.leadMonths);
  });
});

describe("the holding cost — the one most often left out", () => {
  it("carries the committed money over the whole approval period", () => {
    // R51,3m at 11,75% for 19 months.
    const { holdingCost } = approvalProgramme(ridgeview);
    expect(Number(holdingCost) / 100).toBeCloseTo(51_300_000 * 0.1175 * (19 / 12), 0);
  });

  it("is nothing where nothing has been signed as committed", () => {
    // Not nought. A scheme whose land nobody has costed does not hold nothing; it is unknown.
    expect(approvalProgramme({ ...ridgeview, committedUpFront: null }).holdingCost).toBeNull();
    expect(approvalProgramme({ ...ridgeview, committedUpFront: money(0n) }).holdingCost).toBeNull();
  });
});

describe("the divergence, which is the finding", () => {
  it("says how much longer the approvals run than the model assumes", () => {
    /*
      An optimistic programme understates holding cost, which flatters the return, which is the
      direction that gets schemes built. So the gap is stated rather than corrected silently.
    */
    const { divergence } = approvalProgramme(ridgeview);

    expect(divergence).toMatch(/about 19 months/);
    expect(divergence).toMatch(/13 months longer than modelled/);
  });

  it("prices the gap, so it can be argued with", () => {
    /*
      13 of the 19 months of holding cost: R51,3m at 11,75% over 19 months is R9 542 437, and
      thirteen nineteenths of that is about R6,53m.

      `\s` rather than a space — money groups with U+00A0 (§7.7) and a literal space never matches.
    */
    const { divergence, holdingCost } = approvalProgramme(ridgeview);

    expect(divergence).toMatch(/R\s6\s5\d\d\s\d\d\d/);
    expect(Number(holdingCost) * (13 / 19)).toBeCloseTo(653_006_250, -2);
  });

  it("says nothing when the model already allows enough", () => {
    const generous = approvalProgramme({ ...ridgeview, modelledPreDevelopmentMonths: 19 });
    expect(generous.divergence).toBeNull();
  });

  it("does not quibble over a month either way", () => {
    // A one-month difference on a nineteen-month path is not a finding, it is noise.
    expect(approvalProgramme({ ...ridgeview, modelledPreDevelopmentMonths: 18 }).divergence).toBeNull();
    expect(approvalProgramme({ ...ridgeview, modelledPreDevelopmentMonths: 20 }).divergence).toBeNull();
  });

  it("flags a modelled period that is longer, without calling it an error", () => {
    // Longer is not understated. It may be deliberate, and the platform has no standing to say.
    const slow = approvalProgramme({ ...ridgeview, modelledPreDevelopmentMonths: 30 });
    expect(slow.divergence).toMatch(/Holding cost is not understated/);
  });
});

describe("what the register refuses to claim", () => {
  it("states a lead time for every approval and a note for every one", () => {
    // A step with no note is a line of jargon on a client's report.
    for (const step of APPROVAL_REGISTER) {
      expect(step.leadMonths).toBeGreaterThan(0);
      expect(step.note.length).toBeGreaterThan(20);
    }
  });

  it("takes an overriding register, because these are norms and not law", () => {
    const own = approvalProgramme({
      ...ridgeview,
      register: [{ approval: "Rezoning", leadMonths: 4, after: "", note: "A shorter path." }],
    });

    expect(own.criticalPathMonths).toBe(4);
  });
});
