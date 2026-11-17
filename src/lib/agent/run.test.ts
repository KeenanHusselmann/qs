/**
 * The rules that decide what a run says — PLATFORM.md §1.3.1.
 *
 * These three functions are small enough to look correct and consequential enough that "looks
 * correct" is not the bar. `workingValue` decides which of two figures a QS signs their name to;
 * `blockingFields` decides whether a gap can be frozen into an output that everything downstream
 * reads as approved; `runState` decides whether a screen tells someone their run is alive.
 *
 * They are pure and have no database, which is why they are here rather than in a browser suite.
 * That the *route* writes what these read is `checks/run-live.mjs`, and that the screen renders it is
 * `checks/signoff.mjs`.
 */

import { describe, expect, it } from "vitest";

import {
  COST_PLAN_FIELDS,
  FEASIBILITY_FIELDS,
  blockingFields,
  reconciliationGap,
  runState,
  workingValue,
  type PersistedRun,
  type RunField,
} from "./run";

const field = (over: Partial<RunField> & { fieldId: string }): RunField => ({
  label: "A field",
  seq: 0,
  proposed: { state: "found", value: null, confidence: 0.9, note: null },
  citation: null,
  carriedVia: null,
  override: null,
  output: null,
  ...over,
});

const proposed = (fieldId: string, value: string | null) =>
  field({ fieldId, proposed: { state: "found", value, confidence: 0.9, note: null } });

const corrected = (fieldId: string, agent: string | null, human: string) =>
  field({
    fieldId,
    proposed: { state: "found", value: agent, confidence: 0.9, note: null },
    override: { value: human, reason: null, by: "qs@example.com", at: new Date().toISOString() },
  });

const run = (over: Partial<PersistedRun> = {}): PersistedRun => ({
  id: "r1",
  module: "/feasibility",
  status: "review",
  error: null,
  startedAt: new Date().toISOString(),
  lastWriteAt: new Date().toISOString(),
  signedBy: null,
  signedAt: null,
  spend: null,
  fields: [],
  ...over,
});

describe("working — proposed plus overrides, human wins", () => {
  it("is the agent's value when nobody has corrected it", () => {
    expect(workingValue(proposed("units", "1 046"))).toBe("1 046");
  });

  it("is the human's value when they have", () => {
    expect(workingValue(corrected("units", "1 046", "1 040"))).toBe("1 040");
  });

  /**
   * The case the two maps exist for: the agent found nothing and the QS knows the figure. A run
   * that could not be corrected past a gap would be a run nobody could sign.
   */
  it("is the human's value even where the agent had none", () => {
    expect(workingValue(corrected("units", null, "1 046"))).toBe("1 046");
  });

  it("never falls back to the agent once a correction exists", () => {
    // Not "" — an empty correction is refused before it is stored, so what is here is a real value.
    expect(workingValue(corrected("units", "1 046", "0"))).toBe("0");
  });
});

describe("blocking — what stops a signature", () => {
  const required = FEASIBILITY_FIELDS.filter((f) => f.required).map((f) => f.id);
  const optional = FEASIBILITY_FIELDS.find((f) => !f.required)!;

  it("blocks a required field the agent could not find", () => {
    const fields = required.map((id) => proposed(id, id === "units" ? null : "x"));
    expect(blockingFields(fields).map((b) => b.fieldId)).toEqual(["units"]);
  });

  it("will not sign a feasibility without any of the four inputs the cash flow cannot invent", () => {
    // The programme was optional, so a feasibility signed without one left the viability report's
    // financial sections unevaluated with nothing on the step saying why.
    for (const id of ["units", "selling-price", "absorption", "programme"]) {
      expect(required, id).toContain(id);
    }
  });

  it("stops blocking once a human fills it", () => {
    const fields = required.map((id) =>
      id === "units" ? corrected(id, null, "1 046") : proposed(id, "x"),
    );
    expect(blockingFields(fields)).toEqual([]);
  });

  /**
   * A run that stopped early has no row at all for the fields it never asked about. Walking the
   * rows would find nothing wrong with it and freeze an output missing half its required figures.
   */
  it("blocks a required field the run never reached", () => {
    const fields = [proposed("erf", "Erf 180")];
    const blocked = blockingFields(fields).map((b) => b.fieldId);
    expect(blocked).toContain("units");
    expect(blocked).not.toContain("erf");
  });

  it("does not block on an optional field — §1.3.3 says label it, not stop", () => {
    const fields = [...required.map((id) => proposed(id, "x")), proposed(optional.id, null)];
    expect(blockingFields(fields)).toEqual([]);
  });

  it("treats whitespace as no value", () => {
    const fields = required.map((id) => proposed(id, id === "erf" ? "   " : "x"));
    expect(blockingFields(fields).map((b) => b.fieldId)).toEqual(["erf"]);
  });

  it("names the fields, because a count sends a reader hunting", () => {
    expect(blockingFields([]).map((b) => b.label)).toContain("Total unit count");
  });
});

describe("state — what a run is", () => {
  const now = Date.UTC(2026, 7, 14, 12, 0, 0);
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("is signed whenever there is a signature, whatever the status says", () => {
    expect(runState(run({ status: "review", signedAt: ago(0), signedBy: "qs@x" }), now)).toBe("signed");
  });

  it("is running while something is still being written", () => {
    expect(runState(run({ status: "running", lastWriteAt: ago(5_000) }), now)).toBe("running");
  });

  /**
   * A killed function writes nothing on its way out, so the row says `running` forever. §1.3.1:
   * say that, rather than show a spinner that lies.
   */
  it("is stalled once nothing has been written for long enough", () => {
    expect(runState(run({ status: "running", lastWriteAt: ago(10 * 60_000) }), now)).toBe("stalled");
  });

  it("is not stalled merely because it started a while ago", () => {
    expect(
      runState(run({ status: "running", startedAt: ago(10 * 60_000), lastWriteAt: ago(1_000) }), now),
    ).toBe("running");
  });

  it("keeps a failed run failed", () => {
    expect(runState(run({ status: "failed", lastWriteAt: ago(10 * 60_000) }), now)).toBe("failed");
  });
});

describe("reconciliationGap – audit C3", () => {
  // Money is grouped with a non-breaking space (§7.7); read it as a person would.
  const gapOf = (...args: Parameters<typeof reconciliationGap>) => reconciliationGap(...args)?.replace(/\u00a0/g, " ") ?? null;
  // A cost plan whose nine elements are given, and a stated total.
  const plan = (total: string, elements: Record<string, string | null>) => [
    proposed("cp-total", total),
    ...Object.entries(elements).map(([id, value]) => proposed(id, value)),
  ];
  const nine = {
    "cp-substructure": "R10 000 000,00",
    "cp-superstructure": "R30 000 000,00",
    "cp-finishes": "R20 000 000,00",
    "cp-services": "R15 000 000,00",
    "cp-external-works": "R5 000 000,00",
    "cp-preliminaries": "R8 000 000,00",
    "cp-contingency": "R4 000 000,00",
    "cp-escalation": "R3 000 000,00",
  };

  it("is silent when the elements make the total", () => {
    expect(reconciliationGap(plan("R95 000 000,00", nine), COST_PLAN_FIELDS)).toBeNull();
  });

  it("names the difference when they do not – the R392 800 the audit found", () => {
    const gap = gapOf(plan("R95 392 800,00", nine), COST_PLAN_FIELDS);
    expect(gap).toMatch(/392 800,00/);
    expect(gap).toMatch(/95 000 000,00/);
  });

  it("counts a missing element as short, not as unreadable", () => {
    const gap = gapOf(plan("R95 000 000,00", { ...nine, "cp-escalation": null }), COST_PLAN_FIELDS);
    expect(gap).toMatch(/3 000 000,00/);
  });

  it("refuses to call it reconciled when a figure cannot be read", () => {
    const gap = gapOf(plan("R95 000 000,00 excluding VAT", nine), COST_PLAN_FIELDS);
    expect(gap).toMatch(/cannot be read/);
  });

  it("reads the human's figure over the agent's", () => {
    const fields = [...plan("R95 392 800,00", nine).filter((f) => f.fieldId !== "cp-total"), corrected("cp-total", "R95 392 800,00", "R95 000 000,00")];
    expect(reconciliationGap(fields, COST_PLAN_FIELDS)).toBeNull();
  });

  it("never applies to a step that states no total", () => {
    expect(reconciliationGap([proposed("units", "1 046")], FEASIBILITY_FIELDS)).toBeNull();
  });
});