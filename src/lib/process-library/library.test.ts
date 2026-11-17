/**
 * The library is hand-written data, so its integrity is tested rather than trusted: a mistyped code
 * or a gateway pointing at a task that does not exist would render as a broken drill-down.
 */

import { describe, expect, it } from "vitest";

import { AREAS, DOMAINS, PHASES, ROLES, countsOf, searchLibrary, subProcessOf } from "./index";

describe("the generic process library", () => {
  it("covers all seven phases and all eight domains", () => {
    expect(PHASES.map((p) => p.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(DOMAINS.map((d) => d.code)).toEqual(["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8"]);
    for (const phase of PHASES) expect(AREAS.some((a) => a.phase === phase.number), `phase ${phase.number}`).toBe(true);
    for (const domain of DOMAINS) expect(AREAS.some((a) => a.domain === domain.code), domain.code).toBe(true);
  });

  it("gives every code once", () => {
    const codes = AREAS.flatMap((a) => [a.code, ...a.subProcesses.flatMap((s) => [s.code, ...s.tasks.map((t) => `${s.code}-${t.code}`)])]);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("nests codes under their parents", () => {
    for (const area of AREAS) {
      expect(area.code.startsWith(`${area.domain}.`), area.code).toBe(true);
      for (const subProcess of area.subProcesses) {
        expect(subProcess.code.startsWith(`${area.code}-SP-`), subProcess.code).toBe(true);
        subProcess.tasks.forEach((task, i) => expect(task.code, `${subProcess.code} task ${i + 1}`).toBe(`T${String(i + 1).padStart(2, "0")}`));
      }
    }
  });

  it("points every gateway at a task in its own sub-process", () => {
    for (const { subProcesses } of AREAS) {
      for (const s of subProcesses) {
        if (s.gateway) expect(s.tasks.some((t) => t.code === s.gateway!.after), `${s.code} gateway`).toBe(true);
      }
    }
  });

  it("gives every node the detail the page shows", () => {
    for (const area of AREAS) {
      expect(area.purpose.length, area.code).toBeGreaterThan(20);
      expect(area.subProcesses.length, area.code).toBeGreaterThan(0);
      for (const s of area.subProcesses) {
        expect(s.trigger && s.outcome && s.purpose, s.code).toBeTruthy();
        expect(s.tasks.length, s.code).toBeGreaterThanOrEqual(3);
        for (const t of s.tasks) {
          expect(ROLES[t.performer], `${s.code}-${t.code} performer`).toBeTruthy();
          expect(t.inputs.length + t.outputs.length, `${s.code}-${t.code}`).toBeGreaterThan(1);
        }
      }
    }
  });

  it("is deep enough to be the model, not a sketch", () => {
    const counts = countsOf(AREAS);
    expect(counts.areas).toBeGreaterThanOrEqual(50);
    expect(counts.subProcesses).toBeGreaterThanOrEqual(70);
    expect(counts.tasks).toBeGreaterThanOrEqual(300);
  });

  it("keeps the documented D1.1-SP-001 eight steps and its QS gate", () => {
    const found = subProcessOf("D1.1-SP-001");
    expect(found?.subProcess.tasks).toHaveLength(8);
    expect(found?.subProcess.gateway?.question).toMatch(/affordability/i);
  });

  it("finds a node by the words of its name, at any level", () => {
    const hits = searchLibrary("final account agree");
    expect(hits.some((h) => h.code === "D1.8-SP-002")).toBe(true);
    expect(searchLibrary("occupancy").some((h) => h.level === "L4")).toBe(true);
    expect(searchLibrary(" ")).toEqual([]);
  });
});
