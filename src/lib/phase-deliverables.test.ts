/**
 * A phase's deliverables and what the project has for each – the rule under test is that nothing
 * the research names is left off, and nothing is shown as done that the project does not have.
 */

import { describe, expect, it } from "vitest";

import { PHASES } from "@/lib/process-library/levels";
import { phaseDeliverables, trackedDeliverables, type ProjectEvidence } from "./phase-deliverables";

const project = (over: Partial<ProjectEvidence> = {}): ProjectEvidence => ({
  signed: new Set(),
  filed: new Map(),
  labelOf: (module) => ({ "/bill": "Bill of Quantities", "/cost-plan": "Cost Plan", "/instructions": "Instructions", "/variations": "Variations" })[module] ?? module,
  missingFor: () => [],
  ...over,
});

describe("phase deliverables", () => {
  it("consider every deliverable the research names", () => {
    const named = PHASES.filter((p) => p.number <= 6).flatMap((p) => p.keyDeliverables);
    expect(named.filter((label) => !trackedDeliverables().includes(label))).toEqual([]);
  });

  it("list all of a phase's deliverables, outstanding until the project has them", () => {
    const design = phaseDeliverables(2, project());
    expect(design.map((d) => d.label)).toEqual(PHASES.find((p) => p.number === 2)!.keyDeliverables);
    expect(design.every((d) => d.state === "outstanding")).toBe(true);
    expect(design.find((d) => d.label === "Approved building plans")?.detail).toBe("Not tracked in the platform yet");
  });

  it("are signed off only when every step that produces them is signed", () => {
    const one = phaseDeliverables(4, project({ signed: new Set(["/instructions"]) }));
    const both = phaseDeliverables(4, project({ signed: new Set(["/instructions", "/variations"]) }));
    const label = "Contract instructions and priced variations";
    expect(one.find((d) => d.label === label)).toMatchObject({ state: "outstanding", step: { module: "/variations" } });
    expect(both.find((d) => d.label === label)?.state).toBe("signed");
  });

  it("say what a step still needs", () => {
    const design = phaseDeliverables(2, project({ missingFor: (m) => (m === "/bill" ? ["Specification or measured scope"] : []) }));
    expect(design.find((d) => d.step?.module === "/bill")?.detail).toBe("Bill of Quantities still needs Specification or measured scope");
  });

  it("count a filed document as filed, never as signed", () => {
    const design = phaseDeliverables(2, project({ filed: new Map([["Concept drawings", 2]]) }));
    expect(design.find((d) => d.label === "Concept design and viability report")).toMatchObject({
      state: "filed",
      detail: "2 documents on file – not produced in the platform",
    });
  });
});
