/**
 * A project's stages — PLATFORM.md §1.3.1, and L0 in `process-model.ts`.
 *
 * What is worth asserting here is not the list, which is derived, but the **derivation**: that every
 * module a project can work on resolves to a stage, and that the reading of a project which never
 * said anything is "all of them". Get the first wrong and a stage quietly hides a step; get the
 * second wrong and every project created before the column existed appears to cover nothing.
 */

import { describe, expect, it } from "vitest";

import {
  ALL_PHASES,
  DEFAULT_STAGES,
  STAGES,
  modulesWithoutAPhase,
  phaseOfModule,
  readStages,
  stagesOf,
  withinStages,
} from "./stages";

describe("the stages come from L0, not from a new list", () => {
  it("offers only phases this platform has built work for", () => {
    // Seven phases exist; Asset & Warranty carries no module, and a box that ticks to no effect is
    // the control §7.5 warns about.
    expect(ALL_PHASES).toHaveLength(7);
    expect(STAGES.length).toBeGreaterThan(0);
    expect(STAGES.length).toBeLessThan(ALL_PHASES.length);
    expect(STAGES.every((stage) => stage.covers.length > 0)).toBe(true);
  });

  it("names each stage by what it carries, in the menu's own spelling", () => {
    const inception = STAGES.find((stage) => stage.number === 1);
    expect(inception?.name).toBe("Feasibility & Inception");
    expect(inception?.covers).toContain("Feasibility Estimate");
    expect(inception?.covers).toContain("Cost Plan");
  });

  it("resolves a module to its phase through its process area", () => {
    expect(phaseOfModule("/feasibility")).toBe(1);
    expect(phaseOfModule("/bill")).toBe(2);
    expect(phaseOfModule("/final-account")).toBe(6);
  });

  /**
   * The guard that matters. A module with entry criteria is a step somebody files documents against;
   * if it resolved to no phase, no stage would carry it and it could be hidden by every selection at
   * once. Adding a process area with no phase, or a criterion pointing at a code that does not
   * exist, turns this red.
   */
  it("leaves no step of the work outside every stage", () => {
    expect(modulesWithoutAPhase()).toEqual([]);
  });

  it("gives no phase to the places a project merely has", () => {
    // Project Corpus, Project Data and Pricing carry no criteria and run no step of the chain.
    expect(phaseOfModule("/corpus")).toBeUndefined();
    expect(phaseOfModule("/pricing")).toBeUndefined();
  });
});

describe("what a project that said nothing covers", () => {
  it("reads null as every stage", () => {
    expect(stagesOf(null)).toEqual(DEFAULT_STAGES);
    expect(stagesOf(undefined)).toEqual(DEFAULT_STAGES);
  });

  it("reads an empty selection the same way, rather than as nothing at all", () => {
    expect(stagesOf([])).toEqual(DEFAULT_STAGES);
  });

  it("reads a real selection as itself", () => {
    expect(stagesOf([1, 2])).toEqual([1, 2]);
  });
});

describe("reading the form", () => {
  it("takes the checked phases, in order, without duplicates", () => {
    expect(readStages(["2", "1", "2", "4"])).toEqual([1, 2, 4]);
  });

  it("ignores anything that is not a phase this platform offers", () => {
    expect(readStages(["1", "7", "99", "banana", ""])).toEqual([1]);
  });

  it("falls back to every stage rather than storing a project that covers nothing", () => {
    expect(readStages([])).toEqual([...DEFAULT_STAGES]);
    expect(readStages(["nonsense"])).toEqual([...DEFAULT_STAGES]);
  });
});

describe("whether a module falls inside a project's stages", () => {
  it("keeps a step whose phase is selected and drops one whose phase is not", () => {
    expect(withinStages("/feasibility", [1])).toBe(true);
    expect(withinStages("/bill", [1])).toBe(false);
    expect(withinStages("/bill", [1, 2])).toBe(true);
  });

  it("never gates a place the project merely has", () => {
    // These have no phase, so no selection can hide them — a corpus is not a stage of the work.
    expect(withinStages("/corpus", [1])).toBe(true);
    expect(withinStages("/data", [6])).toBe(true);
  });

  it("keeps everything for a project that said nothing", () => {
    expect(withinStages("/final-account", null)).toBe(true);
  });
});
