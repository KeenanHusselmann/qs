import { describe, expect, it } from "vitest";

import type { Money } from "@/domain/money";
import {
  reconcile,
  reviewRegister,
  weakestBasis,
  type SavingBasis,
  type ValueOption,
  type ValueOptionStatus,
} from "@/domain/value-engineering";

const R = (rands: number) => (BigInt(Math.round(rands * 100)) as Money);

let next = 1;
const option = (
  saving: number,
  status: ValueOptionStatus = "proposed",
  basis: SavingBasis = "measured",
  extra: Partial<ValueOption> = {},
): ValueOption => ({
  id: `o${next}`,
  number: next++,
  element: "superstructure",
  description: "Option",
  saving: R(saving),
  basis,
  effect: "One storey of glazing becomes a painted panel.",
  status,
  raisedBy: "Architect",
  decisionReason: "Agreed at the cost meeting of 12 September.",
  ...extra,
});

describe("what the register comes to", () => {
  it("adds accepted and proposed savings separately", () => {
    const r = reconcile([option(100_000, "accepted"), option(50_000, "proposed"), option(999_999, "rejected")], R(5_000_000), R(4_800_000));
    expect(r.accepted).toBe(R(100_000));
    expect(r.proposed).toBe(R(50_000));
  });

  it("a gap is the target less the current cost, and is negative when over budget", () => {
    const r = reconcile([], R(5_000_000), R(4_800_000));
    expect(r.gap).toBe(R(-200_000));
  });

  it("the accepted savings take the gap down", () => {
    const r = reconcile([option(150_000, "accepted")], R(5_000_000), R(4_800_000));
    expect(r.remaining).toBe(R(-50_000));
    expect(r.closed).toBe(false);
  });

  it("and close it when they are enough", () => {
    const r = reconcile([option(200_000, "accepted")], R(5_000_000), R(4_800_000));
    expect(r.remaining).toBe(R(0));
    expect(r.closed).toBe(true);
  });

  it("says null rather than nought where there is no target", () => {
    // A register with no budget still adds up its own savings. What it cannot say is whether they
    // are enough, and nought would be an answer to a question nobody asked.
    const r = reconcile([option(100_000, "accepted")], R(5_000_000), null);
    expect(r.gap).toBeNull();
    expect(r.remaining).toBeNull();
    expect(r.closed).toBeNull();
    expect(r.accepted).toBe(R(100_000));
  });

  it("an option that costs more is carried as a negative saving", () => {
    // Value engineering is not only cutting: paying more for something that buys programme or
    // quality is an option, and it belongs on the same register as the ones that save.
    const r = reconcile([option(200_000, "accepted"), option(-50_000, "accepted")], R(5_000_000), R(4_800_000));
    expect(r.accepted).toBe(R(150_000));
    expect(r.closed).toBe(false);
  });
});

describe("what a quantity surveyor would ask of it", () => {
  it("says when a closed budget rests on estimates", () => {
    const r = [option(200_000, "accepted", "estimate")];
    const findings = reviewRegister(r, reconcile(r, R(5_000_000), R(4_800_000)));
    const found = findings.find((f) => f.id === "closed-on-estimates");
    expect(found).toBeDefined();
    expect(found?.severity).toBe("high");
  });

  it("and stays quiet when the accepted options were measured", () => {
    const r = [option(200_000, "accepted", "measured")];
    const findings = reviewRegister(r, reconcile(r, R(5_000_000), R(4_800_000)));
    expect(findings.find((f) => f.id === "closed-on-estimates")).toBeUndefined();
  });

  it("ranks it lower where the estimates are the minority of the saving", () => {
    const r = [option(800_000, "accepted", "measured"), option(100_000, "accepted", "estimate")];
    const findings = reviewRegister(r, reconcile(r, R(5_000_000), R(4_800_000)));
    expect(findings.find((f) => f.id === "closed-on-estimates")?.severity).toBe("medium");
  });

  it("asks what an option costs besides money", () => {
    const r = [option(100_000, "proposed", "measured", { effect: null })];
    const findings = reviewRegister(r, reconcile(r, R(5_000_000), R(4_800_000)));
    expect(findings.find((f) => f.id === "no-effect-stated")).toBeDefined();
  });

  it("but not of an option that was rejected", () => {
    const r = [option(100_000, "rejected", "measured", { effect: null })];
    const findings = reviewRegister(r, reconcile(r, R(5_000_000), R(4_800_000)));
    expect(findings.find((f) => f.id === "no-effect-stated")).toBeUndefined();
  });

  it("says when the whole register cannot close the gap", () => {
    const r = [option(50_000, "proposed"), option(20_000, "accepted")];
    const findings = reviewRegister(r, reconcile(r, R(5_000_000), R(4_000_000)));
    const found = findings.find((f) => f.id === "not-enough-on-the-table");
    expect(found).toBeDefined();
    expect(found?.severity).toBe("high");
  });

  it("and not when everything on the table would be enough", () => {
    const r = [option(900_000, "proposed"), option(200_000, "accepted")];
    const findings = reviewRegister(r, reconcile(r, R(5_000_000), R(4_000_000)));
    expect(findings.find((f) => f.id === "not-enough-on-the-table")).toBeUndefined();
  });

  it("flags two accepted savings on one element, which is the shape double-counting takes", () => {
    const r = [option(100_000, "accepted", "measured"), option(80_000, "accepted", "measured")];
    const findings = reviewRegister(r, reconcile(r, R(5_000_000), R(4_800_000)));
    expect(findings.find((f) => f.id === "same-element-twice")).toBeDefined();
  });

  it("asks for a reason against an accepted option that has none", () => {
    const r = [option(100_000, "accepted", "measured", { decisionReason: "" })];
    const findings = reviewRegister(r, reconcile(r, R(5_000_000), R(4_800_000)));
    expect(findings.find((f) => f.id === "no-reason-recorded")).toBeDefined();
  });

  it("puts what changes the answer first", () => {
    const r = [option(200_000, "accepted", "estimate", { effect: null })];
    const findings = reviewRegister(r, reconcile(r, R(5_000_000), R(4_800_000)));
    expect(findings[0]?.severity).toBe("high");
  });

  it("every finding says what it is, why it matters and what to do", () => {
    const r = [option(200_000, "accepted", "estimate", { effect: null, decisionReason: "" })];
    for (const f of reviewRegister(r, reconcile(r, R(5_000_000), R(4_800_000)))) {
      expect(f.finding.length).toBeGreaterThan(20);
      expect(f.matters.length).toBeGreaterThan(20);
      expect(f.action.length).toBeGreaterThan(20);
    }
  });
});

describe("what the reconciliation rests on", () => {
  it("is the weakest basis any accepted option carries", () => {
    expect(weakestBasis([option(1, "accepted", "measured"), option(1, "accepted", "estimate")])).toBe("estimate");
    expect(weakestBasis([option(1, "accepted", "measured"), option(1, "accepted", "rate")])).toBe("rate");
  });

  it("ignores what has only been proposed", () => {
    expect(weakestBasis([option(1, "accepted", "measured"), option(1, "proposed", "estimate")])).toBe("measured");
  });

  it("is null where nothing has been accepted", () => {
    expect(weakestBasis([option(1, "proposed", "estimate")])).toBeNull();
  });
});
