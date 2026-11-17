/**
 * The advisor — PLATFORM.md §1.3, §1.3.1, §14.
 *
 * Two properties are worth asserting here and neither is visible on screen.
 *
 *  - **The next step is chosen by the chain, not by the model.** Getting that wrong sends a QS to
 *    do work that cannot start, or to skip a step the one they are on depends on.
 *  - **No figure ever reaches the panel.** Every number in this platform traces to a document and
 *    a signature; a number that first appeared in a chat panel traces to nothing and would be read
 *    as though it did. That is the confident wrong figure the whole product is arranged against,
 *    and the prompt asking nicely is not a guarantee — this is.
 */

import { describe, expect, it } from "vitest";

import { brief, briefText, readAdvice, type StepPosition } from "./advisor";
import { STAGES } from "@/lib/stages";

const usage = { input: 0, output: 0 };

const step = (over: Partial<StepPosition> & Pick<StepPosition, "module" | "label">): StepPosition => ({
  state: "waiting",
  waitingOn: [],
  missing: [],
  optional: [],
  filed: 0,
  of: 2,
  ...over,
});

const project = { name: "Erf 180", client: "Clever Development Trust" };

describe("the next step comes from the chain", () => {
  it("follows the overview's rule: the earliest step short of a document comes first", () => {
    const b = brief({
      project,
      documents: 3,
      steps: [
        step({ module: "/site", label: "Site & Zoning", state: "ready" }),
        step({ module: "/inputs", label: "Project Inputs", state: "waiting", missing: ["A mandate"] }),
      ],
    });

    /*
      This used to prefer any "ready" step over a blocked one, which disagreed with the project
      overview (`nextStep` in chain.ts): the overview sent the reader to file the mandate while the
      advisor sent them onwards. One rule now, and it is the overview's.
    */
    expect(b.next?.label).toBe("Project Inputs");
  });

  it("puts the steps in process order, whatever order they arrive in", () => {
    const b = brief({
      project,
      documents: 3,
      steps: [
        step({ module: "/cost-plan", label: "Cost Plan" }),
        step({ module: "/inputs", label: "Project Inputs" }),
        step({ module: "/feasibility", label: "Feasibility Estimate" }),
      ],
    });

    expect(b.steps.map((s) => s.label)).toEqual(["Project Inputs", "Feasibility Estimate", "Cost Plan"]);
  });

  it("falls back to the earliest blocked step when nothing is startable", () => {
    const b = brief({
      project,
      documents: 0,
      steps: [
        step({ module: "/inputs", label: "Project Inputs", missing: ["A mandate"] }),
        step({ module: "/site", label: "Site & Zoning", missing: ["A title deed"] }),
      ],
    });

    // "Nothing to do" is never true — the documents are the thing to do.
    expect(b.next?.label).toBe("Project Inputs");
  });

  it("skips what is already signed off", () => {
    const b = brief({
      project,
      documents: 9,
      steps: [
        step({ module: "/inputs", label: "Project Inputs", state: "signed_off" }),
        step({ module: "/feasibility", label: "Feasibility Estimate", state: "ready" }),
      ],
    });

    expect(b.signed).toEqual(["Project Inputs"]);
    expect(b.next?.label).toBe("Feasibility Estimate");
  });

  it("says to carry on with a draft rather than sending the reader back to a finished step", () => {
    const b = brief({
      project,
      documents: 6,
      steps: [
        step({ module: "/inputs", label: "Project Inputs", state: "signed_off" }),
        step({ module: "/feasibility", label: "Feasibility Estimate", state: "draft" }),
      ],
    });

    expect(b.next?.label).toBe("Feasibility Estimate");
  });

  it("has no next step once everything in scope is signed", () => {
    const b = brief({
      project,
      documents: 12,
      steps: [step({ module: "/inputs", label: "Project Inputs", state: "signed_off" })],
    });

    expect(b.next).toBeNull();
    expect(b.currentStage).toBeNull();
  });
});

describe("the brief the model reads", () => {
  it("names the step, what blocks it, and that a signature is not a document", () => {
    const text = briefText(
      brief({
        project,
        documents: 4,
        steps: [
          step({
            module: "/cost-plan",
            label: "Cost Plan",
            waitingOn: ["Feasibility Estimate"],
            missing: ["A priced cost plan"],
            optional: ["A finishes schedule"],
          }),
        ],
      }),
    );

    expect(text).toContain("NEXT STEP: Cost Plan");
    expect(text).toContain("Feasibility Estimate");
    // The distinction that decides what a reader should go and do.
    expect(text).toContain("No document will clear that");
    expect(text).toContain("A priced cost plan");
    expect(text).toContain("A finishes schedule");
  });

  it("says so plainly when a project has nothing filed", () => {
    const text = briefText(brief({ project, documents: 0, steps: [] }));
    expect(text).toContain("Documents filed: 0");
    expect(text).toContain("No step has been signed off yet");
  });

  /*
    ── The four facts the advisor cannot derive ─────────────────────────────────────────────

    Each of these changes what a QS should actually be told to do next, and none of them is in the
    chain or the criteria. Without them the counsel is about a generic job rather than this one.
  */
  it("names the province, because a rate is not national", () => {
    expect(briefText(brief({ project, region: "Western Cape", documents: 1, steps: [] }))).toContain(
      "The work is in Western Cape",
    );
  });

  it("and says when nobody has said, rather than assuming national", () => {
    expect(briefText(brief({ project, documents: 1, steps: [] }))).toContain(
      "Nobody has said which province",
    );
  });

  it("bounds the advice to the stages the practice is engaged for", () => {
    const engaged = STAGES.filter((s) => s.number <= 2).map((s) => s.name);
    const text = briefText(brief({ project, stages: engaged, documents: 1, steps: [] }));

    // A practice engaged for a feasibility is not going to tender, and should not be told to
    // look forward to it. The real stage names, so this cannot pass on a vocabulary that is
    // no longer the platform's.
    expect(engaged).toContain("Feasibility & Inception");
    expect(text).toContain("engaged for these stages only");
    expect(text).toContain("Feasibility & Inception");
    expect(text).toContain("Do not advise on work outside them");
  });

  it("says an empty rate library is why nothing can be priced, and where to fix it", () => {
    const text = briefText(brief({ project, documents: 1, canPrice: false, steps: [] }));
    expect(text).toContain("no rate that can price this project");
    // The action a QS needs and that no amount of prompting would have produced.
    expect(text).toContain("Rate Library");
  });

  it("and says when there is one", () => {
    expect(briefText(brief({ project, documents: 1, canPrice: true, steps: [] }))).toContain(
      "holds rates that can price this project",
    );
  });

  it("distinguishes a job that has sent something from one that has not", () => {
    expect(briefText(brief({ project, documents: 1, hasIssued: true, steps: [] }))).toContain(
      "already been issued to the client",
    );
    expect(briefText(brief({ project, documents: 1, hasIssued: false, steps: [] }))).toContain(
      "Nothing has been issued to the client",
    );
  });

  /*
    None of the four may arrive as a number.

    The figure rule is enforced on the model's answer, but a count in the brief is a count the model
    can legitimately believe it was given as fact — which is exactly how a figure that traces to no
    signature gets into the panel wearing the platform's own voice (§1.3.1).
  */
  it("carries none of them as a figure", () => {
    for (const canPrice of [true, false]) {
      for (const hasIssued of [true, false]) {
        const lines = briefText(
          brief({ project, region: "Gauteng", documents: 0, canPrice, hasIssued, steps: [] }),
        )
          .split("\n")
          .filter((l) => /rate library|issued to the client/i.test(l));

        expect(lines.length).toBe(2);
        for (const line of lines) expect(line).not.toMatch(/\d/);
      }
    }
  });
});

describe("no figure reaches the panel", () => {
  it("drops an action that states one", () => {
    const advice = readAdvice(
      {
        position: "The estimate is waiting on its market data.",
        actions: [
          { do: "Obtain the market study", because: "It anchors the revenue side" },
          { do: "Allow 15% for preliminaries", because: "It is the usual allowance" },
        ],
      },
      usage,
    );

    expect(advice.actions).toHaveLength(1);
    expect(advice.actions[0].do).toBe("Obtain the market study");
  });

  it("drops one whose reason states a figure, not only its instruction", () => {
    const advice = readAdvice(
      {
        position: "Ready to price.",
        actions: [
          { do: "Price the bill", because: "Rates of about R1 200 per square metre apply" },
          { do: "Obtain the specification", because: "It fixes what is being measured" },
        ],
      },
      usage,
    );

    expect(advice.actions.map((a) => a.do)).toEqual(["Obtain the specification"]);
  });

  it("empties a position that states one rather than showing it", () => {
    const advice = readAdvice(
      { position: "The scheme is 1 046 units.", actions: [{ do: "File the brief", because: "" }] },
      usage,
    );

    expect(advice.position).toBe("");
    expect(advice.actions).toHaveLength(1);
  });

  it("drops a caution that states one", () => {
    const advice = readAdvice(
      {
        actions: [{ do: "Sign the estimate", because: "" }],
        caution: "Under-measuring by 5% carries through the whole bill",
      },
      usage,
    );

    expect(advice.caution).toBeNull();
  });
});

describe("what comes back is read defensively", () => {
  it("survives a reply that is not the shape asked for", () => {
    expect(readAdvice(null, usage).actions).toEqual([]);
    expect(readAdvice({ actions: "not a list" }, usage).actions).toEqual([]);
    expect(readAdvice({ actions: [null, 7, "text"] }, usage).actions).toEqual([]);
  });

  it("treats the string 'null' as the absence the model meant", () => {
    const advice = readAdvice(
      { actions: [{ do: "File the deed", because: "" }], standard: "null", caution: "null" },
      usage,
    );

    expect(advice.standard).toBeNull();
    expect(advice.caution).toBeNull();
  });

  it("caps the list, so a runaway reply cannot fill the panel", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      do: `Do the ${["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth"][i]} thing`,
      because: "",
    }));

    // Six, since the plan became a board's worth of work rather than a paragraph's.
    expect(readAdvice({ actions: many }, usage).actions).toHaveLength(6);
  });

  it("reads each action's board fields, and drops what is not from the lists", () => {
    const [ok, odd] = readAdvice(
      {
        actions: [
          { do: "Obtain the market study", because: "", type: "rfi", module: "/feasibility", owner: "Client", dueInDays: 5, priority: "high" },
          { do: "Chase the architect", because: "", type: "snag", module: "/nowhere", owner: "thandi@x.co.za", dueInDays: 900, priority: "now" },
        ],
      },
      usage,
    ).actions;
    expect(ok).toMatchObject({ type: "rfi", module: "/feasibility", owner: "Client", dueInDays: 5, priority: "high" });
    expect(odd).toMatchObject({ type: "task", module: null, owner: null, dueInDays: null, priority: "medium" });
  });
});
