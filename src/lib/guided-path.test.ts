import { describe, expect, it } from "vitest";

import { guidedPath, pathSummary, type PathState } from "./guided-path";

const nothing: PathState = {
  projects: 0,
  project: null,
  documents: 0,
  requirementsMet: 0,
  requirementsTotal: 40,
  runsStarted: 0,
  signedSteps: 0,
  reportSections: 0,
  reportTotal: 12,
};

/** Ridgeview, as the platform has it. */
const ridgeview: PathState = {
  projects: 1,
  project: { id: "p1", name: "Ridgeview Gardens" },
  documents: 15,
  requirementsMet: 18,
  requirementsTotal: 40,
  runsStarted: 2,
  signedSteps: 2,
  reportSections: 6,
  reportTotal: 12,
};

const at = (steps: ReturnType<typeof guidedPath>, no: number) => steps.find((s) => s.no === no)!;

describe("the shape of the path", () => {
  it("is five moves, not thirteen modules", () => {
    // The shape of the job, not the chain. A reader meeting the platform needs to know documents
    // go in and a defensible report comes out; the thirteen modules are what they find inside.
    expect(guidedPath(nothing)).toHaveLength(5);
  });

  it("ends at the report, because that is what the work is for", () => {
    expect(at(guidedPath(nothing), 5).title).toMatch(/report/i);
  });

  it("says what each step produces, in every state", () => {
    for (const step of guidedPath(nothing)) expect(step.produces.length).toBeGreaterThan(40);
  });
});

describe("with nothing done", () => {
  const steps = guidedPath(nothing);

  it("puts the reader at the first step", () => {
    expect(at(steps, 1).state).toBe("current");
  });

  it("leaves the rest for later, and offers them no action", () => {
    for (const no of [2, 3, 4, 5]) {
      expect(at(steps, no).state).toBe("later");
      expect(at(steps, no).action).toBeNull();
    }
  });

  it("claims nothing was achieved", () => {
    expect(steps.every((step) => step.achieved === null)).toBe(true);
  });

  it("offers the way in", () => {
    expect(at(steps, 1).action).toEqual({ label: "Add a project", href: "/projects" });
  });
});

describe("with Ridgeview as it stands", () => {
  const steps = guidedPath(ridgeview);

  it("marks the four done steps done", () => {
    for (const no of [1, 2, 3, 4]) expect(at(steps, no).state).toBe("done");
  });

  it("reports what happened in the project's own figures", () => {
    // Progress a reader can check, rather than a percentage the platform asserts.
    expect(at(steps, 2).achieved).toBe("15 documents filed · 18 of 40 requirements met");
    expect(at(steps, 4).achieved).toBe("2 steps signed off");
    expect(at(steps, 5).achieved).toBe("6 of 12 sections established");
  });

  it("points every action at the project the path is following", () => {
    expect(at(steps, 2).action?.href).toBe("/projects/p1/corpus");
    expect(at(steps, 5).action?.href).toBe("/projects/p1/report");
  });

  it("counts a signed step as having reached the report", () => {
    // The report exists the moment anything is signed — partly established, and saying so.
    expect(at(steps, 5).state).toBe("done");
  });
});

describe("the position is derived, never assumed", () => {
  it("does not argue with work already finished", () => {
    // Signing before every optional document is filed is not skipping a step. A path that
    // insisted otherwise would be arguing with work that is done.
    const skipped = guidedPath({ ...ridgeview, documents: 0, requirementsMet: 0 });

    expect(at(skipped, 2).state).toBe("current");
    expect(at(skipped, 4).state).toBe("done");
  });

  it("makes the first unfinished step the current one", () => {
    const midway = guidedPath({ ...ridgeview, signedSteps: 0, reportSections: 0 });
    expect(at(midway, 4).state).toBe("current");
    expect(at(midway, 5).state).toBe("later");
  });

  it("has no current step once everything is done", () => {
    const finished = guidedPath(ridgeview);
    expect(finished.some((step) => step.state === "current")).toBe(false);
  });

  it("falls back to the projects list when no project is being followed", () => {
    const loose = guidedPath({ ...nothing, projects: 2 });
    expect(at(loose, 2).action?.href).toBe("/projects");
  });
});

describe("the summary that offers the path", () => {
  it("sells the whole journey to somebody who has not started", () => {
    expect(pathSummary(guidedPath(nothing))).toMatch(/Five steps/);
  });

  it("says where you are and what is next once you have", () => {
    const midway = guidedPath({ ...ridgeview, signedSteps: 0, reportSections: 0 });
    expect(pathSummary(midway)).toMatch(/3 of 5 done/);
    expect(pathSummary(midway)).toMatch(/review the figures and sign/i);
  });

  it("says so when there is nothing left", () => {
    expect(pathSummary(guidedPath(ridgeview))).toMatch(/report is ready/i);
  });
});
