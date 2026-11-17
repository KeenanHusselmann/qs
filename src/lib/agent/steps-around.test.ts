/**
 * Next goes forward from the page the reader is on — the tester's report, as a test.
 */

import { describe, expect, it } from "vitest";

import type { StepPosition } from "./advisor";
import { moduleOf, stepsAround } from "./steps-around";

const step = (module: string, state: StepPosition["state"] = "waiting"): StepPosition => ({
  module,
  label: module.slice(1),
  state,
  waitingOn: [],
  missing: [],
  optional: [],
  filed: 0,
  of: 1,
});

// Steps one to four. Step two is still open (ready, nothing blocked); the reader works on four.
const steps = [step("/inputs", "signed_off"), step("/site", "ready"), step("/feasibility", "waiting"), step("/cost-plan", "draft")];
const brief = { steps, next: steps[1]! };

describe("Next, from a step page", () => {
  it("walks forward one step at a time, rather than back to the chain's recommendation", () => {
    expect(stepsAround(brief, "/inputs").next?.module).toBe("/site");
    expect(stepsAround(brief, "/site").next?.module).toBe("/feasibility");
    expect(stepsAround(brief, "/feasibility").next?.module).toBe("/cost-plan");
  });

  it("lists what is still open behind the reader separately, and never a signed step", () => {
    const around = stepsAround(brief, "/cost-plan");
    expect(around.openBehind.map((s) => s.module)).toEqual(["/site", "/feasibility"]);
    expect(around.next).toBeNull();
  });

  it("skips a signed step ahead", () => {
    const signedAhead = [step("/inputs"), step("/site", "signed_off"), step("/feasibility")];
    expect(stepsAround({ steps: signedAhead, next: null }, "/inputs").next?.module).toBe("/feasibility");
  });
});

describe("Next, off a step page", () => {
  it("is the chain's recommendation", () => {
    const around = stepsAround(brief, null);
    expect(around).toMatchObject({ onStep: false, openBehind: [] });
    expect(around.next?.module).toBe("/site");
    expect(stepsAround(brief, "/corpus").next?.module).toBe("/site");
  });
});

describe("moduleOf", () => {
  it("reads the step out of the path", () => {
    expect(moduleOf("/projects/p1/feasibility", "p1")).toBe("/feasibility");
    expect(moduleOf("/projects/p1/report/print", "p1")).toBe("/report");
    expect(moduleOf("/projects/p1", "p1")).toBeNull();
    // Another project whose id starts the same way is not this one.
    expect(moduleOf("/projects/p12/feasibility", "p1")).toBeNull();
  });
});
