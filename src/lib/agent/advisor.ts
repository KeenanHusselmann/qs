/**
 * The project advisor — what to do next on this job, and why.
 *
 * ── The facts are computed; only the counsel is asked for ──────────────────────────────────
 *
 * Where a project stands is not a question for a language model. The chain knows which steps are
 * signed and which are waiting on an upstream (`chain.ts`); the criteria know which documents are
 * filed and which requirement each one answers (`criteria-status.ts`); the stages know which of
 * the seven phases this project is engaged for (`stages.ts`). Asking a model to work that out from
 * prose would be asking it to re-derive, with a chance of error, something the database can answer
 * exactly — and §14 names building the plausible-looking version as a way this project fails.
 *
 * So `brief()` assembles the position deterministically, and that brief is the *only* thing the
 * model is given. It is told which step is next, what is blocking it and what it feeds; what it
 * adds is the part a database cannot hold — how a South African QS would ordinarily proceed from
 * there, in what order, and what practice standard governs it.
 *
 * ── What it is not allowed to do ───────────────────────────────────────────────────────────
 *
 * It may not name a figure. Not a rate, not a total, not a percentage. Every number in this
 * platform traces to a document and a signature (§1.3.1), and a number that appeared first in a
 * chat panel has neither — it would be the confident wrong figure this whole product is arranged
 * against, wearing the platform's own voice. The prompt forbids it and `readAdvice` drops any
 * step that contains one.
 *
 * It may not invent a step. The next step is decided here, from the chain, and passed in; the model
 * is told to advise *on* it, not to choose it.
 *
 * ── An outage is a refusal, not a silence ──────────────────────────────────────────────────
 *
 * `ModelUnavailable` propagates. The panel says the advisor could not be reached and still shows
 * the brief, because the brief is the useful half and it was computed without asking anybody.
 */

import { ModelUnavailable, askForJson, type Usage } from "@/lib/agent/deepseek";
import { STEP_STATE_LABEL, byProcessOrder, labelOf, nextStep, type StepState } from "@/lib/chain";
import { planStepLabel, STEPS } from "@/lib/agent/plan-steps";
import { STAGES, phaseOfModule } from "@/lib/stages";

/** One step, as the advisor sees it. */
export interface StepPosition {
  module: string;
  label: string;
  state: StepState;
  /** Steps that must be signed before this one may start. */
  waitingOn: readonly string[];
  /** Requirements with no document against them, in the QS's words. */
  missing: readonly string[];
  /** Requirements that would improve the run but do not block it. */
  optional: readonly string[];
  filed: number;
  of: number;
}

/**
 * Where a project stands, computed — never asked for.
 *
 * This is what the panel shows even when the model cannot be reached, and it is what the model is
 * given when it can. One derivation, two uses, so the counsel can never describe a position the
 * screen is not showing.
 */
export interface Brief {
  /**
   * `request` is set only on an ad hoc request (migration 0039): what was asked, in the asker's
   * words. It is the brief there – there is no service chain to stand on.
   */
  project: { name: string; client: string | null; request?: string | null };
  /**
   * The province the work is in, where somebody said.
   *
   * Advice about pricing is provincial — labour and material rates are not national — and a
   * region is not a figure, so the advisor may reason with it and say it.
   */
  region: string | null;
  /**
   * The stages this project runs, by name.
   *
   * The route already filters the *steps* by this, so the advisor never advises on a step outside
   * the engagement. This is the other half: it must not advise the reader to look forward to one
   * either. A practice engaged for a feasibility should not be told what to expect at tender.
   */
  stages: readonly string[];
  /** The stage the work is actually in — the earliest with an unsigned step. */
  currentStage: string | null;
  documents: number;
  signed: readonly string[];
  /**
   * Whether the firm's rate library holds anything that could price this project.
   *
   * A fact, not a figure — deliberately a boolean and not a count, because handing the model a
   * number is how a number ends up in the answer. Without it the advisor cannot give the action a
   * QS actually needs at the bill: an empty library is why pricing produces nothing, and "import a
   * rate schedule" is advice no amount of prompting would have produced.
   */
  canPrice: boolean;
  /** Whether anything has been issued on this job. Also a boolean, for the same reason. */
  hasIssued: boolean;
  /**
   * What a QS reviewing this job would point at – unpriced or unmeasured items, a bill heavy with
   * fixed sums, a tender far below the estimate (`checks.ts`). Computed, and worded without figures,
   * so the advisor can suggest the specific thing to do rather than the generic one.
   */
  checks: readonly string[];
  /** The step to do next: the earliest that is startable, or the earliest that is blocked. */
  next: StepPosition | null;
  /** Every step in scope, in chain order. */
  steps: readonly StepPosition[];
}

export function brief({
  project,
  region = null,
  stages = [],
  documents,
  canPrice = false,
  hasIssued = false,
  checks = [],
  steps,
}: {
  project: { name: string; client: string | null; request?: string | null };
  region?: string | null;
  stages?: readonly string[];
  documents: number;
  canPrice?: boolean;
  hasIssued?: boolean;
  checks?: readonly string[];
  steps: readonly StepPosition[];
}): Brief {
  /*
    In process order — phase, then the order the menu lists them — which is the order the reader
    walks. Criteria declaration order put the final account ahead of tender analysis, so "the step
    after this one" meant nothing on the panel.
  */
  const ordered = [...steps].sort(byProcessOrder);
  const signed = ordered.filter((s) => s.state === "signed_off").map((s) => s.label);

  /*
    The next step, decided by the chain rather than by the model — and by the SAME rule the
    project overview uses (`nextStep` in chain.ts).

    It had its own rule: the first "ready" step, else the earliest outstanding one. A reader working
    on a later step (a draft) was told to go back to an earlier step that merely had nothing
    blocking it, while the overview said to carry on with the draft. Two surfaces computing "next"
    two ways is the disagreement the brief exists to prevent.
  */
  const chosen = nextStep(
    ordered.map((s) => ({
      ...s,
      blocked: s.missing.length,
      upstreamPending: s.waitingOn,
    })),
  );
  const next = chosen ? (ordered.find((s) => s.module === chosen.step.module) ?? null) : null;

  const currentStage = (() => {
    if (!next) return null;
    const phase = phaseOfModule(next.module);
    return STAGES.find((s) => s.number === phase)?.name ?? null;
  })();

  return {
    project,
    region,
    stages,
    currentStage,
    documents,
    signed,
    canPrice,
    hasIssued,
    checks,
    next,
    steps: ordered,
  };
}

/** One thing to do, in order. */
export interface Action {
  do: string;
  /** What it is for — the reason a QS would not skip it. */
  because: string;
  /**
   * What kind of item it becomes on the project board. A question to another party is an RFI;
   * everything else is a task. The kinds that need facts a plan cannot know are never suggested.
   */
  type: "task" | "rfi";
  /** The platform step it is done on, as a path from the menu, or null when it is done elsewhere. */
  module: string | null;
  /** Who would ordinarily do it – a role, never a person: "QS", "Architect", "Client". */
  owner: string | null;
  /** How soon, as working days from today. A schedule suggestion, not a project figure. */
  dueInDays: number | null;
  priority: "low" | "medium" | "high" | "urgent";
}


const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

export interface Advice {
  /** One sentence on where the job is. */
  position: string;
  actions: readonly Action[];
  /** The practice standard or contract that governs this step, where one does. */
  standard: string | null;
  /** What goes wrong if the step is taken out of order, or nothing. */
  caution: string | null;
  usage: Usage;
}

const SYSTEM = `You advise a South African quantity surveyor working inside a QS platform.

You are given the project's position, computed from its records. Treat it as fact: it is what the
screen in front of the reader says, and contradicting it makes the platform look broken.

Advise on the next step NAMED IN THE BRIEF. Do not choose a different one.

Rules, in order of importance:
1. NEVER state a figure. No rate, no amount, no percentage, no quantity, no duration in weeks. Every
   number in this platform traces to a document somebody signed. A number from you traces to
   nothing and would be read as though it did. A reference to a standard is not a figure: cite the
   clause or part exactly where you know it ("JBCC PBA clause 31", "SANS 10400-XA", "NEC4 ECC").
2. Advise only on what the brief supports. If it says a document is missing, the advice is to
   obtain that document — do not speculate about what it might contain.
3. Name the governing standard where one genuinely applies to the step: ASAQS for measurement and
   cost planning, JBCC or NEC for contract administration and payment certificates, SANS where
   construction standards bear on it, SACQSP for professional conduct. If none clearly applies, use
   null rather than reaching for one.
4. Two to four actions, in the order a QS would take them. Each one a thing to do, not a principle.
   Be specific to THIS job: where the brief lists what a reviewing QS would point at, the first
   actions deal with those, each on the step where it is done. "Review the bill" is not an action;
   "price the unrated items from the rate library on the Pricing page" is.
5. Plain South African professional English. No exclamation marks, no encouragement, no "great
   question". Say the thing.
6. An action must be something the reader can do IN THIS PLATFORM. It can do these things, and you
   may name them: file documents on the project's Documents page; run a step and review what the agent
   proposed; correct a figure with a reason; sign a step off, which freezes it for everything
   downstream; draft a bill of quantities; match a bill against the firm's rate library and take a
   rate from it; ask what an item is built up from, when no rate exists for it; issue a report or a
   bill, which keeps a copy of exactly what was sent. Do not invent a feature. If the useful next
   move is outside the platform — obtaining a document, meeting the client, a site visit — say that
   plainly instead.

7. Each action also says where and by whom, as data rather than prose: "module" is the step it is
   done on, as one of the paths below (null if it is done outside the platform); "owner" is the ROLE
   that ordinarily does it – "QS", "Architect", "Engineer", "Contractor", "Client", "Principal
   agent" – never a person's name; "type" is "rfi" when the action is a question another party must
   answer, otherwise "task"; "priority" is one of low, medium, high, urgent; "dueInDays" is how many
   working days from today it should be done in, as a JSON NUMBER in that field only – never write
   a duration in the text.

STEPS (path: name):
${[...STEPS].map(([module, label]) => `- "${module}": ${label}`).join("\n")}

Reply as json:
{
  "position": "one sentence on where this job is",
  "actions": [{ "do": "the action", "because": "what it is for", "type": "task", "module": "/feasibility", "owner": "QS", "dueInDays": 5, "priority": "high" }],
  "standard": "the standard, or null",
  "caution": "what goes wrong if this is taken out of order, or null"
}`;

/** The brief, as the model reads it. Plain text, because a QS's position is prose, not a schema. */
export function briefText(b: Brief): string {
  const lines: string[] = [
    b.project.request
      ? `This is an ad hoc request, not a project: "${b.project.name}". It runs no stages and signs nothing. What was asked for: ${b.project.request}`
      : `Project: ${b.project.name}${b.project.client ? ` for ${b.project.client}` : ""}.`,
    b.region ? `The work is in ${b.region}.` : "Nobody has said which province the work is in.",
    `Documents filed: ${b.documents}.`,
    b.signed.length > 0
      ? `Signed off so far: ${b.signed.join(", ")}.`
      : "No step has been signed off yet.",
    b.currentStage ? `The work is in the ${b.currentStage} stage.` : "",
    /*
      The engagement, stated as a limit rather than as a list of things to look forward to. A
      practice engaged for a feasibility is not going to tender, and advice that assumes otherwise
      is advice for a different job.
    */
    b.stages.length > 0
      ? `This project is engaged for these stages only: ${b.stages.join(", ")}. Do not advise on work outside them.`
      : "",
    // Said in words, never as a count — the model is not given a number it could repeat.
    b.canPrice
      ? "The firm's rate library holds rates that can price this project."
      : "The firm's rate library holds no rate that can price this project. Nothing can be priced from it until a rate schedule is imported under Rate Library.",
    b.hasIssued
      ? "A document has already been issued to the client on this job, and the copy of what was sent is kept on the project's Report page."
      : "Nothing has been issued to the client on this job yet.",
  ];

  if (b.checks.length > 0) {
    lines.push(
      "",
      "WHAT A REVIEWING QS WOULD POINT AT (computed by the platform from the bill and the tenders):",
      ...b.checks.map((check) => `- ${check}`),
    );
  }

  if (b.next) {
    const n = b.next;
    lines.push(
      "",
      `NEXT STEP: ${n.label} — currently ${STEP_STATE_LABEL[n.state].toLowerCase()}.`,
      `${n.filed} of ${n.of} of its requirements have a document filed.`,
    );
    if (n.waitingOn.length > 0) {
      lines.push(
        `It cannot start until these are signed off: ${n.waitingOn.join(", ")}.`,
        "No document will clear that — a signature will.",
      );
    }
    if (n.missing.length > 0) {
      lines.push(`Required documents not yet filed: ${n.missing.join("; ")}.`);
    }
    if (n.optional.length > 0) {
      lines.push(`Optional inputs that would improve it: ${n.optional.join("; ")}.`);
    }
  } else if (b.steps.every((s) => s.state === "signed_off")) {
    lines.push("", "Every step in scope has been signed off.");
  } else {
    // No step to start, finish or file for — but not everything is signed. Saying "all signed"
    // here would be false, and the reader would believe it.
    lines.push("", "No step is waiting on the reader: the remaining steps have their documents and run no agent.");
  }

  return lines.filter(Boolean).join("\n");
}

/**
 * Anything that reads as a quantity. Deliberately broad — a false positive costs one sentence.
 *
 * Exported so `ask.ts` guards its answers with the *same* rule rather than a second copy of it.
 * Two definitions of "contains a figure" is how one surface comes to allow what the other forbids.
 */
export const HAS_FIGURE = /\d/;

/**
 * A reference to a standard, which carries digits and is not a figure: "JBCC PBA clause 31.2",
 * "SANS 10400-XA", "NEC4", "regulation 5(1)(b)", "Edition 6.2".
 *
 * Stripping every digit made the advisor unable to say which clause governs a step – the one thing a
 * QS most wants from it – and its counsel read as vague for exactly that reason. Only the reference
 * itself is removed before the test: "section 3 has a rate of R 450" still states a figure.
 */
const CITATION = /\b(?:JBCC|SANS|NEC\d?|ASAQS|FIDIC|PROCSA|SACQSP|ISO|clauses?|cl\.|regulations?|sections?|edition)\s*(?:[A-Z]{1,4}\s*)?\d[\dA-Za-z.()\-/]*(?:\s*(?:and|to|or|,)\s*\d[\dA-Za-z.()\-/]*)*/gi;

/** Whether model prose states a figure, once its references to standards are set aside. */
export const statesFigure = (text: string): boolean => HAS_FIGURE.test(text.replace(CITATION, ""));

/**
 * Read the model's reply, dropping anything that broke the rules.
 *
 * Dropping rather than refusing the whole answer: three sound actions and one that slipped a figure
 * in is still worth showing, and discarding all four would send the reader away with nothing over a
 * fault they cannot see. What is never done is *rendering* the offending line — a number in this
 * panel would trace to nothing.
 */
export function readAdvice(json: unknown, usage: Usage): Advice {
  const o = (json ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => {
    const s = typeof v === "string" ? v.trim() : "";
    return s.length > 0 && s.toLowerCase() !== "null" ? s : null;
  };

  const actions = (Array.isArray(o.actions) ? o.actions : [])
    .map((raw) => {
      const a = (raw ?? {}) as Record<string, unknown>;
      return { do: str(a.do), because: str(a.because), raw: a };
    })
    .filter((a): a is { do: string; because: string | null; raw: Record<string, unknown> } => {
      if (!a.do) return false;
      // Rule 1, enforced rather than requested.
      return !statesFigure(a.do) && !statesFigure(a.because ?? "");
    })
    .slice(0, 6)
    .map(({ do: action, because, raw }): Action => {
      // Every structured field is checked against the list it came from; anything else is dropped
      // to its safe default rather than trusted.
      const step = str(raw.module);
      const owner = str(raw.owner);
      const days = typeof raw.dueInDays === "number" && Number.isFinite(raw.dueInDays) ? Math.round(raw.dueInDays) : null;
      const priority = str(raw.priority)?.toLowerCase();
      return {
        do: action,
        because: because ?? "",
        type: raw.type === "rfi" ? "rfi" : "task",
        module: step && STEPS.has(step) ? step : null,
        // A role, never a person: a name with an @ or more than three words is not a role.
        owner: owner && !owner.includes("@") && owner.split(/\s+/).length <= 3 && !HAS_FIGURE.test(owner) ? owner : null,
        dueInDays: days !== null && days > 0 && days <= 365 ? days : null,
        priority: PRIORITIES.includes(priority as Action["priority"]) ? (priority as Action["priority"]) : "medium",
      };
    });

  const position = str(o.position);

  return {
    position: position && !statesFigure(position) ? position : "",
    actions,
    standard: str(o.standard),
    caution: (() => {
      const c = str(o.caution);
      return c && !statesFigure(c) ? c : null;
    })(),
    usage,
  };
}

/**
 * Ask for advice on the brief.
 *
 * Throws `ModelUnavailable` rather than returning an empty answer — the panel needs to be able to
 * say "the advisor could not be reached" and mean it. §1.3: an outage is surfaced, never hidden.
 */
export async function advise(b: Brief, signal?: AbortSignal): Promise<Advice> {
  const { json, usage } = await askForJson({ purpose: "advisor.brief",
    system: SYSTEM,
    user: briefText(b),
    maxTokens: 1100,
    signal,
  });

  const advice = readAdvice(json, usage);

  if (advice.actions.length === 0) {
    throw new ModelUnavailable(
      "The advisor answered, but nothing in the reply could be used — every action it gave either was empty or stated a figure, and a figure from the advisor traces to no document.",
    );
  }

  return advice;
}

/** The menu label of a step a plan points at. */
export { planStepLabel };

/** Named here so the panel and the route spell a step the same way. */
export const stepLabel = labelOf;
