/**
 * Project setup — PLATFORM.md §1.3.3, §14.
 *
 * What is worth asserting is the **derivation**, not the lists, which come from the criteria. Two
 * failures matter and neither is visible on screen:
 *
 *  - Setup asks for something the run does not gate on, or gates on something setup never
 *    mentioned. Either way the checklist stops being the checklist, which is exactly the
 *    plausible-looking-but-wrong artefact §14 warns about.
 *  - An unanswered mandatory requirement is not reported as outstanding, so a project opens
 *    looking ready when it is not.
 */

import { describe, expect, it } from "vitest";

import { DEFAULT_CRITERIA, type Criterion } from "./entry-criteria";
import { STAGES, phaseOfModule } from "./stages";
import {
  STAGE_OPTIONS,
  adviceFor,
  criteriaForStage,
  stagesFrom,
  type Standing,
} from "./onboarding";

const criterion = (id: string): Criterion => {
  const found = DEFAULT_CRITERIA.find((c) => c.id === id);
  if (!found) throw new Error(`no criterion ${id}`);
  return found;
};

const standing = (id: string, answer: Standing["answer"], filename?: string): Standing => ({
  criterion: criterion(id),
  answer,
  filename,
});

describe("what a stage asks for is what its steps gate on", () => {
  it("offers exactly the stages a project can run", () => {
    expect(STAGE_OPTIONS.map((s) => s.number)).toEqual(STAGES.map((s) => s.number));
  });

  it("accounts for every criterion exactly once across the stages", () => {
    const allocated = STAGE_OPTIONS.flatMap((stage) => criteriaForStage(stage.number)).map(
      (c) => c.id,
    );

    // No duplicates: a requirement asked for twice is a reader answering the same question twice.
    expect(new Set(allocated).size).toBe(allocated.length);

    // Nothing dropped. A criterion whose module has a phase must appear under that phase, or setup
    // would stay silent about a requirement that later blocks a run.
    const gated = DEFAULT_CRITERIA.filter((c) => phaseOfModule(c.module) !== undefined).map(
      (c) => c.id,
    );
    expect(allocated.sort()).toEqual(gated.sort());
  });

  it("puts what blocks a run above what flags a gap", () => {
    for (const stage of STAGE_OPTIONS) {
      const weights = criteriaForStage(stage.number).map((c) => c.weight);
      const firstAdvisory = weights.indexOf("advisory");
      if (firstAdvisory === -1) continue;
      expect(weights.slice(firstAdvisory)).not.toContain("mandatory");
    }
  });

  it("counts what it will ask for, so the stage choice is informed", () => {
    for (const stage of STAGE_OPTIONS) {
      const criteria = criteriaForStage(stage.number);
      expect(stage.wants).toBe(criteria.length);
      expect(stage.mandatory).toBe(criteria.filter((c) => c.weight === "mandatory").length);
      // A stage that asked for nothing would be an option with no second step behind it.
      expect(stage.wants).toBeGreaterThan(0);
    }
  });
});

describe("picking a stage sets the work ahead, not the work behind", () => {
  it("covers that stage and everything after it", () => {
    expect(stagesFrom(1)).toEqual(STAGE_OPTIONS.map((s) => s.number));
    expect(stagesFrom(4)).toEqual(
      STAGE_OPTIONS.filter((s) => s.number >= 4).map((s) => s.number),
    );
  });

  it("never returns an empty set for a stage that exists", () => {
    for (const stage of STAGE_OPTIONS) {
      expect(stagesFrom(stage.number)).toContain(stage.number);
    }
  });
});

describe("the guidance says what is outstanding and what it costs", () => {
  const tender = STAGE_OPTIONS.find((s) => s.number === 3)!;
  const feasibility = STAGE_OPTIONS.find((s) => s.number === 1)!;

  it("opens by saying how much it is about to ask for", () => {
    const advice = adviceFor(
      tender,
      criteriaForStage(3).map((c) => ({ criterion: c, answer: null })),
    );

    expect(advice.tone).toBe("info");
    expect(advice.headline).toContain(tender.name);
    expect(advice.headline).toContain(String(tender.wants));
    expect(advice.blocking).toHaveLength(0);
    expect(advice.consequences).toHaveLength(0);
  });

  it("names an outstanding mandatory requirement, and says once what they share", () => {
    const advice = adviceFor(tender, [
      standing("d1.3-returns", "not-yet"),
      standing("d1.3-report", "n/a"),
    ]);

    expect(advice.tone).toBe("warn");
    expect(advice.blocking).toEqual([criterion("d1.3-returns").label]);
    // The shared consequence is stated once rather than copied onto every name.
    expect(advice.next).toMatch(/blocks its step/i);
  });

  it("treats unanswered and answered-not-yet alike for what is missing", () => {
    // Both mean the document is not to hand. Only the second is somebody saying so, and that
    // difference belongs to the consequences, not to what is blocking.
    const unanswered = adviceFor(tender, [
      standing("d1.3-returns", null),
      standing("d1.3-report", "have"),
    ]);

    expect(unanswered.blocking).toEqual([criterion("d1.3-returns").label]);
  });

  it("does not treat an advisory absence as blocking", () => {
    const advice = adviceFor(tender, [
      standing("d1.3-returns", "have"),
      standing("d1.3-report", "not-yet"),
    ]);

    expect(advice.tone).toBe("ok");
    expect(advice.blocking).toHaveLength(0);
  });

  it("quotes an advisory absence's own fallback, once somebody has said they lack it", () => {
    // The one worth the panel's space: without a QS cost plan the run still goes, and the verdict
    // it may reach changes. That must come from the criterion, never from wording composed here.
    const told = adviceFor(feasibility, [standing("d1.1-cost-plan", "not-yet")]);

    expect(told.consequences).toHaveLength(1);
    expect(told.consequences[0].label).toBe(criterion("d1.1-cost-plan").label);
    expect(told.consequences[0].effect).toBe(criterion("d1.1-cost-plan").fallback);
  });

  it("stays silent about a consequence nobody has been asked about yet", () => {
    // Every advisory row starts absent. Reading that default as an answer would print twenty
    // consequences before a single click, which is the panel lecturing rather than responding.
    const untouched = adviceFor(feasibility, [
      standing("d1.1-cost-plan", null),
      standing("d1.1-brief", "have"),
    ]);

    expect(untouched.consequences).toHaveLength(0);
  });

  it("counts what is to hand apart from what is attached", () => {
    // Having the document and having uploaded it are different positions, and a QS who has the
    // tender returns on their desk has not got nothing.
    const advice = adviceFor(tender, [
      standing("d1.3-returns", "have"),
      standing("d1.3-report", "have", "adjudication.pdf"),
    ]);

    expect(advice.headline).toContain("2 of 2");
    expect(advice.headline).toContain("1 ready to file");
  });

  it("never refuses to open the project", () => {
    for (const stage of STAGE_OPTIONS) {
      const nothing = criteriaForStage(stage.number).map((c) => ({
        criterion: c,
        answer: null,
      }));
      // §1.3 states the gap; it does not withhold the project. Every tone must still describe a
      // next step rather than a refusal.
      expect(adviceFor(stage, nothing).next.length).toBeGreaterThan(0);
    }
  });
});
