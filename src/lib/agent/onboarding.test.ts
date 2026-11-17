import { describe, expect, it } from "vitest";

import { needsFor, onboardingBrief, readOnboarding, stepsWithNeeds } from "./onboarding";
import type { GuidedStep } from "@/lib/guided-path";

const usage = { input: 0, output: 0 };

const steps: GuidedStep[] = [
  {
    no: 1,
    title: "Open a project",
    produces: "A place for the documents and the figures read out of them.",
    state: "done",
    achieved: "1 project open",
    action: null,
  },
  {
    no: 2,
    title: "File the documents you have",
    produces: "The corpus every figure is read from and traced back to.",
    state: "current",
    achieved: null,
    action: { label: "File documents", href: "/projects/p1/corpus" },
  },
];

describe("what the platform requires of a step", () => {
  it("answers exactly, from the criteria", () => {
    /*
      The whole reason this is a lookup and not a prompt. An invented requirement sends somebody
      hunting for a document nobody needs; a missing one sends them into a run that cannot start.
    */
    const needs = needsFor("/feasibility")!;

    expect(needs.moduleLabel).toBe("Feasibility Estimate");
    expect(needs.requirements.length).toBeGreaterThan(2);
  });

  it("names what satisfies each one", () => {
    // "File your documents" is not an action. "Any one of: Market study, Comparable sales" is.
    const needs = needsFor("/feasibility")!;

    for (const requirement of needs.requirements) {
      expect(requirement.accepts.length).toBeGreaterThan(0);
    }
  });

  it("separates what blocks a run from what merely improves it", () => {
    const needs = needsFor("/feasibility")!;

    expect(needs.requirements.some((r) => r.mandatory)).toBe(true);
    expect(needs.requirements.some((r) => !r.mandatory)).toBe(true);
  });

  it("is nothing for a step with no criteria, rather than an empty promise", () => {
    expect(needsFor("/does-not-exist")).toBeNull();
  });

  it("offers the model only steps it can actually look up", () => {
    // A menu containing a step with no criteria would invite a request that returns nothing.
    for (const step of stepsWithNeeds()) {
      expect(needsFor(step.module)).not.toBeNull();
    }
  });
});

describe("the brief a beginner's question is answered against", () => {
  const brief = onboardingBrief({
    projects: 1,
    documents: 15,
    signedSteps: 2,
    hasRates: true,
    steps,
  });

  it("carries the counts, so the model never has to work them out", () => {
    expect(brief).toContain("Projects open: 1");
    expect(brief).toContain("Documents filed: 15");
  });

  it("names where they actually are", () => {
    expect(brief).toContain("THEY ARE AT: 2. File the documents you have");
  });

  it("says so when there is nothing left, rather than pointing at a step", () => {
    const done = steps.map((step) => ({ ...step, state: "done" as const }));
    expect(
      onboardingBrief({
        projects: 1,
        documents: 15,
        signedSteps: 2,
        hasRates: true,
        steps: done,
      }),
    ).toContain("COMPLETED EVERY MOVE");
  });

  /*
    The rate library is firm-level, so it is not one of the five moves and nothing else in the
    platform will mention it to somebody who has not reached a bill. A beginner asking how to price
    would otherwise be sent into a project to fix something that is not a project's to fix.
  */
  it("says the rate library is missing, and that it is firm-wide", () => {
    const empty = onboardingBrief({
      projects: 1,
      documents: 15,
      signedSteps: 2,
      hasRates: false,
      steps,
    });
    expect(empty).toContain("NOT built its rate library");
    expect(empty).toContain("Rate Library");
    expect(empty).toContain("do not send them to a project");
  });

  it("and never as a count, so the guide has no number to repeat", () => {
    // Both wordings, because the figure rule is enforced on the answer and this is the input.
    for (const hasRates of [true, false]) {
      const line = onboardingBrief({ projects: 0, documents: 0, signedSteps: 0, hasRates, steps })
        .split("\n")
        .find((l) => /rate library/i.test(l));
      expect(line).toBeDefined();
      expect(line).not.toMatch(/\d/);
    }
  });
});

describe("the guide is held to the same figure rule", () => {
  it("keeps a sentence that says what to do", () => {
    const out = readOnboarding({ answer: "File the project brief first." }, null, [], usage);
    expect(out.answer).toBe("File the project brief first.");
  });

  it("drops one that restates a count", () => {
    /*
      The position summary carries the counts and the page shows them. A guide repeating "you have
      15 documents" is the one place it could state a figure that traces to nothing — and the
      figure would be right, which is what makes the habit dangerous rather than obvious.
    */
    const out = readOnboarding(
      { answer: "You have 15 documents filed. File the market study next." },
      null,
      [],
      usage,
    );

    expect(out.answer).toBe("File the market study next.");
  });

  it("carries the requirements through untouched", () => {
    // They are the platform's own words and are not subject to the figure rule — a criterion
    // saying "Step 2" is a reference, not an assertion.
    const needs = needsFor("/feasibility");
    const out = readOnboarding({ answer: "Here is what it needs." }, needs, [], usage);

    expect(out.needs?.requirements.length).toBe(needs?.requirements.length);
  });

  it("survives a reply that is not shaped like a reply", () => {
    for (const junk of [null, undefined, {}, { answer: 7 }]) {
      expect(() => readOnboarding(junk, null, [], usage)).not.toThrow();
    }
  });
});
