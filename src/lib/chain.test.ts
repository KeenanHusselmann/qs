/**
 * The chain — PLATFORM.md §1.3.1.
 *
 * These functions decide whether a step may start and what a step *is*. Both are answered on the
 * server precisely so a client cannot answer them, which makes their correctness worth asserting
 * rather than eyeballing: a wrong `startable` either blocks work that should proceed or, far worse,
 * lets a step run on figures nobody signed.
 *
 * They are pure and read three static tables — the criteria, the process model and the nav. That
 * they are wired into the route and the overview is `checks/run.mjs` and `checks/signoff.mjs`.
 */

import { describe, expect, it } from "vitest";

import {
  fieldsFor,
  feedsFrom,
  feedsInto,
  labelOf,
  moduleOf,
  nextStep,
  processOf,
  producesRuns,
  stepState,
  stepSummary,
  upstreamPending,
} from "./chain";

describe("modules and the process areas they execute", () => {
  it("maps each module with criteria to exactly one process area", () => {
    expect(processOf("/feasibility")).toBe("D1.1");
    expect(processOf("/inputs")).toBe("D2.1");
    expect(processOf("/site")).toBe("D3.1");
  });

  it("resolves back the other way", () => {
    expect(moduleOf("D1.1")).toBe("/feasibility");
    expect(moduleOf("D3.1")).toBe("/site");
  });

  /**
   * The nav's `process` is a display string — Site & Zoning reads "D3.1 · D7.1" and Project Corpus
   * also claims D3.1 — which is why the map is built from the criteria instead. A chain resolved
   * from a label with a middot in it is a chain that breaks when somebody tidies the label.
   */
  it("does not resolve a process from the nav's display string", () => {
    expect(processOf("/corpus")).toBeUndefined();
  });

  it("has no module for a process area this platform does not implement", () => {
    // D3.2 is Concept & Scheme Design — an architect's process area the platform models and does
    // not run. Naming a specific one here is deliberate: it fails the day somebody builds it, which
    // is the right moment to be asked whether this test still means anything.
    expect(moduleOf("D3.2")).toBeUndefined();
  });
});

/**
 * The construction chain — contract → valuations → cost report → final account.
 *
 * The first chain that crosses process areas rather than sitting inside one, and the first with a
 * step that has two upstreams.
 */
describe("the construction chain", () => {
  it("puts the contract in front of everything it governs", () => {
    for (const step of ["/valuations", "/variations", "/cost-report", "/final-account"]) {
      expect(feedsFrom(step).map((l) => l.module)).toContain("/contract");
    }
  });

  it("gates a certificate on a signed contract", () => {
    expect(upstreamPending("/valuations", new Set())).toEqual([labelOf("/contract")]);
    expect(upstreamPending("/valuations", new Set(["/contract"]))).toEqual([]);
  });

  /**
   * The reason `upstreamPending` is derived from *required* carried fields rather than from the
   * chain edges alone. Variations feed valuations — an approved variation belongs in the next
   * certificate — but the first certificate on a well-run job has no variations at all, and gating
   * on one would make a normal month's work impossible until somebody ran a step over an empty
   * register and signed it.
   */
  it("does not gate a certificate on variations that may not exist", () => {
    expect(feedsFrom("/valuations").map((l) => l.module)).toContain("/variations");
    expect(upstreamPending("/valuations", new Set(["/contract"]))).not.toContain(
      labelOf("/variations"),
    );
  });

  /** A variation can be recorded before the contract has been captured; the percentage waits. */
  it("does not gate a variation on the contract", () => {
    expect(upstreamPending("/variations", new Set())).toEqual([]);
  });

  it("gates the cost report and the final account on the contract sum they measure against", () => {
    expect(upstreamPending("/cost-report", new Set())).toEqual([labelOf("/contract")]);
    expect(upstreamPending("/final-account", new Set())).toEqual([labelOf("/contract")]);
  });

  /** The certificate feeds the cost report, and only as an optional carry — it does not block it. */
  it("lets a cost report be produced before the first certificate", () => {
    expect(feedsFrom("/cost-report").map((l) => l.module)).toContain("/valuations");
    expect(upstreamPending("/cost-report", new Set(["/contract"]))).toEqual([]);
  });
});

describe("what feeds what", () => {
  it("knows the feasibility estimate reads from the brief and the site analysis", () => {
    expect(feedsFrom("/feasibility").map((l) => l.code)).toEqual(["D2.1", "D3.1"]);
  });

  it("names a neighbour by its menu label where a module exists", () => {
    const [inputs, site] = feedsFrom("/feasibility");
    expect(inputs.label).toBe(labelOf("/inputs"));
    expect(site.built).toBe(true);
  });

  /**
   * An area this platform has no page for is still named — by the area's own name, marked unbuilt.
   * Dropping it would say the model of the work stops at whatever has been built.
   *
   * D1.9 is Funder Reporting & Drawdowns, and nothing here owns it.
   */
  it("names a neighbour by its process area where no module owns it", () => {
    const funder = feedsInto("/cost-plan").find((l) => l.code === "D1.9");
    expect(funder).toBeDefined();
    expect(funder!.module).toBeUndefined();
    expect(funder!.label).toBe("Funder Reporting & Drawdowns");
    expect(funder!.built).toBe(false);
  });

  /**
   * D1.2 is four nav items — Take-off, Repetition Designer, Bill of Quantities, Pricing — so which
   * of them *is* D1.2 has no answer in the process model, and `moduleOf` resolves an incoming edge
   * to the **first module declared** for the area. That is now the bill, which is the entry to D1.2
   * and the one of the four that is built, so the cost plan names a page a reader can open.
   *
   * This assertion used to say the opposite, and it was right at the time: nothing owned D1.2 and
   * the link read "BoQ Production (not built)". What changed is the platform, not the rule.
   */
  it("resolves an area with several modules to the first one declared for it", () => {
    const boq = feedsInto("/cost-plan").find((l) => l.code === "D1.2");
    expect(boq).toBeDefined();
    expect(boq!.module).toBe("/bill");
    expect(boq!.label).toBe(labelOf("/bill"));
    expect(boq!.built).toBe(true);
  });

  it("is empty for a module the process model does not carry", () => {
    expect(feedsFrom("/corpus")).toEqual([]);
  });
});

/**
 * Two steps inside one process area — PLATFORM.md §1.4's L3 list, which `process-model.ts` cannot
 * express because both ends carry the code D1.1.
 */
describe("steps that share a process area", () => {
  it("puts the cost plan behind the feasibility estimate", () => {
    expect(feedsFrom("/cost-plan").map((l) => l.module)).toEqual(["/feasibility"]);
    expect(feedsInto("/feasibility").map((l) => l.module)).toEqual(["/cost-plan"]);
  });

  /**
   * The cost plan's upstream is the estimate, and the estimate's upstream is the brief and the site
   * analysis. Inheriting those as well would say the cost plan waits on them directly — untrue, and
   * unhelpful, since clearing them is the estimate's job.
   */
  it("does not make it wait on the area's own upstream as well", () => {
    expect(feedsFrom("/cost-plan").map((l) => l.code)).not.toContain("D3.1");
  });

  /** The area's downstream is fed by the last step in the queue, not the first. */
  it("hands the area's downstream to the last step in it", () => {
    expect(feedsInto("/cost-plan").map((l) => l.code)).toContain("D1.2");
    expect(feedsInto("/feasibility").map((l) => l.code)).not.toContain("D1.2");
  });

  /**
   * When another area says it feeds D1.1 it feeds the *entry* to D1.1. First declared wins, pinned
   * here because it would otherwise change the day somebody reordered a list.
   */
  it("lands an incoming area edge on the entry step, not the one built on it", () => {
    expect(moduleOf("D1.1")).toBe("/feasibility");
  });
});

describe("upstream — what holds a step up", () => {
  /**
   * The decision behind this: §1.3.1 gates on "which upstream **runs** are signed". Project Inputs
   * and Site & Zoning carry entry criteria and no field set, so they produce no output, and waiting
   * for one would be waiting for a document to approve itself.
   */
  it("an upstream that produces no run is not a gate", () => {
    expect(producesRuns("/inputs")).toBe(false);
    expect(producesRuns("/site")).toBe(false);
    expect(upstreamPending("/feasibility", new Set())).toEqual([]);
  });

  it("the feasibility estimate does produce one, so it can gate what it feeds", () => {
    expect(producesRuns("/feasibility")).toBe(true);
  });

  /**
   * The mechanism, now that there is a chain to hang it on. When the cost plan was added, this
   * became true without a line of `chain.ts` changing — only `FIELD_SETS` did, which was the test
   * of whether the shape was right.
   */
  it("gates the cost plan on an unsigned feasibility estimate", () => {
    expect(upstreamPending("/cost-plan", new Set())).toEqual([labelOf("/feasibility")]);
  });

  it("stops gating once it is signed", () => {
    expect(upstreamPending("/cost-plan", new Set(["/feasibility"]))).toEqual([]);
  });

  /** A signature on some other step is not this step's signature. */
  it("is not cleared by an unrelated signature", () => {
    expect(upstreamPending("/cost-plan", new Set(["/site"]))).toEqual([labelOf("/feasibility")]);
  });

  it("the feasibility estimate itself waits on nothing that can sign", () => {
    expect(upstreamPending("/feasibility", new Set())).toEqual([]);
  });
});

/**
 * A carried **bill** — the same edge in the other shape.
 *
 * `carriedFrom` names one figure in an upstream run, and a bill has none: it has four hundred rows.
 * So the platform's most consequential output could not be declared as an input to anything, and
 * Tender Analysis was startable on a project with no bill at all. The BPMN is unambiguous about
 * this — D1.2's flow ends `QA Check --> |Pass| D1.3 Tender Documentation`, its outputs list "Input
 * to tender documentation (→ D1.3)", and D1.3 reads "Bill of Quantities".
 *
 * These are the assertions that the declaration in `ROW_CARRIES` reaches all three things that
 * should fall out of it: the gate, and both directions of the chain.
 */
describe("carried rows — the bill as an input to the next step", () => {
  it("the bill produces a run, so it is a step that can gate", () => {
    expect(producesRuns("/bill")).toBe(true);
  });

  it("gates tender analysis on an unsigned bill", () => {
    expect(upstreamPending("/tender-analysis", new Set())).toEqual([labelOf("/bill")]);
  });

  it("stops gating once the bill is signed", () => {
    expect(upstreamPending("/tender-analysis", new Set(["/bill"]))).toEqual([]);
  });

  it("is not cleared by a signature on some other step", () => {
    expect(upstreamPending("/tender-analysis", new Set(["/contract"]))).toEqual([labelOf("/bill")]);
  });

  /**
   * Both directions, because they are read by different surfaces and a one-way edge is how a menu
   * and a gate start disagreeing. `feedsInto` searched the field sets alone, so the bill's only
   * reader could never appear in it.
   */
  it("names the bill as what tender analysis feeds from", () => {
    expect(feedsFrom("/tender-analysis").map((l) => l.module)).toContain("/bill");
  });

  it("and names tender analysis as what the bill feeds into", () => {
    expect(feedsInto("/bill").map((l) => l.module)).toContain("/tender-analysis");
  });

  /** The gate is real, not merely an edge: an unsigned bill makes the step unstartable. */
  it("a step with no row carry is unaffected", () => {
    expect(upstreamPending("/valuations", new Set(["/contract"]))).toEqual([]);
  });
});

/**
 * A carried figure — §1.3.1. The cost plan does not ask the corpus for the unit count a second
 * time; it takes the one a person reviewed and signed.
 */
describe("carried fields", () => {
  const carried = fieldsFor("/cost-plan").filter((f) => f.carriedFrom);

  it("declares which upstream field each one comes from", () => {
    expect(carried.length).toBeGreaterThan(0);
    expect(carried.every((f) => f.carriedFrom!.module === "/feasibility")).toBe(true);
  });

  /** A field carried from a spec that no longer exists would be silently absent on every run. */
  it("names fields the upstream field set actually has", () => {
    const upstream = new Set(fieldsFor("/feasibility").map((f) => f.id));
    for (const field of carried) expect(upstream).toContain(field.carriedFrom!.fieldId);
  });

  /** Retrieval terms on a carried field would be dead configuration: it is never searched for. */
  it("does not carry retrieval terms it will never use", () => {
    expect(carried.every((f) => f.terms.length === 0)).toBe(true);
  });

  it("leaves the fields this step reads itself to be retrieved", () => {
    const read = fieldsFor("/cost-plan").filter((f) => !f.carriedFrom);
    expect(read.length).toBeGreaterThan(0);
    expect(read.every((f) => f.terms.length > 0)).toBe(true);
  });
});

describe("step state — the five words, decided once", () => {
  const state = (over: Partial<Parameters<typeof stepState>[0]> = {}) =>
    stepState({ module: "/feasibility", startable: true, hasRun: false, isSigned: false, ...over });

  it("is signed off whenever there is a signature", () => {
    expect(state({ hasRun: true, isSigned: true })).toBe("signed_off");
  });

  it("is a draft while a run exists that nobody has signed", () => {
    expect(state({ hasRun: true })).toBe("draft");
  });

  it("is ready when it could start and has not", () => {
    expect(state()).toBe("ready");
  });

  it("is waiting when it could not start", () => {
    expect(state({ startable: false })).toBe("waiting");
  });

  /**
   * A module with no page cannot be any of the others, whatever its criteria say.
   *
   * `/take-off` stands in for what `/bill` used to: the next of D1.2's four items to be built, and
   * the one waiting on geometry (§10).
   */
  it("is not_built for a module that has no page", () => {
    expect(state({ module: "/repetition", startable: true })).toBe("not_built");
  });

  /**
   * A signed run outranks a blocked checklist. Withdrawing a document after signing must not make
   * the signature disappear from the screen — it happened, it is recorded, and hiding it would be
   * the platform quietly disowning something somebody put their name to.
   */
  it("keeps saying signed off even if the inputs later go missing", () => {
    expect(state({ startable: false, hasRun: true, isSigned: true })).toBe("signed_off");
  });
});

/**
 * The sentence beside the badge.
 *
 * It was written inline on the project overview, and the module pages needed the same words — a
 * step that says "Waiting on Feasibility Estimate" on the board must not open on a page that has
 * forgotten it. Two copies of a six-branch ladder is how those two surfaces would come to disagree,
 * so the branches are asserted here rather than left to a screenshot.
 */
describe("step summary — the same position, said in a sentence", () => {
  const summary = (over: Partial<Parameters<typeof stepSummary>[0]> = {}) =>
    stepSummary({
      state: "ready",
      upstreamPending: [],
      signedBy: null,
      blocked: 0,
      gaps: 0,
      ...over,
    });

  /**
   * The order is the reader's, not the enum's. Somebody sent to file documents for a step that is
   * waiting on another would do work that changes nothing, so the upstream is named first — even
   * where documents are missing too, and even where the step has already been run.
   */
  it("names an unsigned upstream ahead of anything a document would fix", () => {
    expect(summary({ state: "waiting", upstreamPending: ["Contract"], blocked: 3 })).toBe(
      "Waiting on Contract to be signed off",
    );
  });

  it("lists every upstream it is waiting on", () => {
    expect(summary({ state: "waiting", upstreamPending: ["Contract", "Cost Plan"] })).toContain(
      "Contract, Cost Plan",
    );
  });

  it("names the signer, and what the signature releases", () => {
    expect(summary({ state: "signed_off", signedBy: "qs@mzilikazi.co.za" })).toBe(
      "Signed off by qs@mzilikazi.co.za — the next step can read these figures",
    );
  });

  /** A run that exists and is unsigned reads nothing downstream — §1.3.1, said on the page. */
  it("says a draft releases nothing", () => {
    expect(summary({ state: "draft" })).toBe(
      "Run in progress — not signed off, so nothing downstream reads it yet",
    );
  });

  it("counts missing required inputs, and agrees with itself about the plural", () => {
    expect(summary({ state: "waiting", blocked: 1 })).toBe("1 required input still missing");
    expect(summary({ state: "waiting", blocked: 2 })).toBe("2 required inputs still missing");
  });

  /**
   * A gap is not a blocker. The step can start; the sentence says what would make it better rather
   * than what is stopping it, because §1.3.3's fallback rule is that an optional input is a
   * degraded run and never a refusal.
   */
  it("offers the optional inputs without claiming they block anything", () => {
    expect(summary({ gaps: 1 })).toBe("Ready to start — 1 optional input would improve it");
    expect(summary({ gaps: 4 })).toBe("Ready to start — 4 optional inputs would improve it");
  });

  it("says nothing more when there is nothing outstanding", () => {
    expect(summary()).toBe("Ready to start");
  });

  /** Every branch returns something. A blank line beside a badge would read as a broken page. */
  it("never returns an empty sentence, in any state", () => {
    for (const state of ["not_built", "waiting", "ready", "draft", "signed_off"] as const) {
      expect(summary({ state }).length).toBeGreaterThan(0);
    }
  });
});

describe("the next step — where the overview sends a reader", () => {
  type Row = { module: string; state: "not_built" | "waiting" | "ready" | "draft" | "signed_off"; blocked: number; upstreamPending: string[] };
  const row = (module: string, state: Row["state"], blocked = 0, upstreamPending: string[] = []): Row => ({
    module,
    state,
    blocked,
    upstreamPending,
  });

  /*
    Ridgeview Gardens as it stood when this was written, in the order `modulesWithCriteria` hands it
    over — which is not process order. The old rule answered "Final Account".
  */
  const ridgeview: Row[] = [
    row("/inputs", "ready"),
    row("/site", "ready"),
    row("/feasibility", "signed_off"),
    row("/cost-plan", "signed_off"),
    row("/bill", "draft"),
    row("/contract", "ready"),
    row("/valuations", "waiting", 0, ["Contract"]),
    row("/variations", "ready"),
    row("/cost-report", "waiting", 0, ["Contract"]),
    row("/final-account", "waiting", 1, ["Contract"]),
    row("/tender-analysis", "waiting", 0, ["Bill of Quantities"]),
    row("/instructions", "ready"),
    row("/handover", "waiting", 1),
  ];

  it("sends Ridgeview to its unsigned bill, not to the final account", () => {
    expect(nextStep(ridgeview)).toMatchObject({ step: { module: "/bill" }, move: "continue" });
  });

  it("never offers a step whose blocker is an unsigned upstream while something earlier can move", () => {
    const next = nextStep(ridgeview.filter((r) => r.module !== "/bill"));
    expect(next?.step.module).toBe("/contract");
    expect(next?.move).toBe("start");
  });

  it("ranks by phase, not by the order the rows arrive in", () => {
    const shuffled = [row("/handover", "waiting", 1), row("/feasibility", "waiting", 2)];
    expect(nextStep(shuffled)?.step.module).toBe("/feasibility");
  });

  it("asks for documents where documents are the blocker", () => {
    expect(nextStep([row("/feasibility", "waiting", 3)])).toMatchObject({ move: "file" });
  });

  it("treats a step that runs no agent as done once its documents are in", () => {
    const next = nextStep([row("/inputs", "ready"), row("/site", "ready"), row("/feasibility", "ready")]);
    expect(next?.step.module).toBe("/feasibility");
  });

  it("still asks for a no-run step's missing documents", () => {
    expect(nextStep([row("/inputs", "waiting", 2), row("/feasibility", "ready")])?.step.module).toBe("/inputs");
  });

  it("says what the job is waiting on when nothing can move", () => {
    const next = nextStep([row("/valuations", "waiting", 0, ["Contract"])]);
    expect(next).toMatchObject({ step: { module: "/valuations" }, move: "wait" });
  });

  it("has nothing to say once every step is signed", () => {
    expect(nextStep([row("/feasibility", "signed_off"), row("/cost-plan", "signed_off")])).toBeNull();
  });
});
