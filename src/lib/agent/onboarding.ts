/**
 * The onboarding agent — how to get started, answered from what the platform actually requires.
 *
 * ── Why this is not the project advisor with a different prompt ────────────────────────────
 *
 * The project advisor answers about one job, out of that job's documents. Somebody meeting this
 * platform has no job and no documents, so every channel it relies on is empty. Handing that
 * reader the same agent produces the worst possible first impression: a grounded assistant with
 * nothing to ground on, answering from what a model happens to know about quantity surveying.
 *
 * What this one answers from is the platform's own definition of the work — the entry criteria.
 * "What do I need for a feasibility?" has an exact answer in `entry-criteria.ts`: eight named
 * requirements, each with what counts as evidence for it. That is a better answer than any model
 * could compose, and it is the same list the readiness checklist shows, so the agent cannot
 * promise something the checklist then contradicts.
 *
 * ── Three channels, not four ───────────────────────────────────────────────────────────────
 *
 * No corpus, because there may be no project. What remains is the model's words (figure-free, the
 * same guard), what the platform requires (computed from the criteria), and the firm's standards —
 * which apply from the first minute, and are arguably most useful to somebody who has not yet
 * learned them.
 */

import { ModelUnavailable, askForJson, type Usage } from "@/lib/agent/deepseek";
import { fence } from "@/lib/egress/fence";
import { statesFigure } from "@/lib/agent/advisor";
import { policyText, searchPolicies, type PolicyCitation } from "@/lib/agent/policy";
import {
  ATTACHED_CHARS,
  ATTACHMENT_MODE,
  chooseAttached,
  figuresAllowed,
  numbersIn,
  type AttachmentCoverage,
  GENERAL_INSTRUCTIONS,
  TAKE_OFF_INSTRUCTIONS,
  readFollowUps,
  readGeneral,
  searchTerms,
  type General,
  type TakeOffRates,
  type Turn,
} from "@/lib/agent/ask";
import { readTakeOffQuestion, readTakeOffRequest, resourceTakeOff } from "@/lib/agent/resource-take-off";
import { rateLookup, readRateQuestion } from "@/lib/agent/rate-lookup";
import { toolText, type ToolResult } from "@/lib/agent/tools";
import type { Passage } from "@/lib/ingest/retrieve";
import { criteriaForModule, modulesWithCriteria } from "@/lib/entry-criteria";
import { PROJECT_NAV } from "@/lib/navigation";
import type { GuidedStep } from "@/lib/guided-path";

const LABELS = new Map(PROJECT_NAV.flatMap((g) => g.items).map((i) => [i.href, i.label] as const));

/** One requirement, as somebody who has not filed it needs to hear it. */
export interface Requirement {
  label: string;
  /** Why the step needs it — the criterion's own words. */
  detail: string;
  mandatory: boolean;
  /** Any one of these satisfies it. Naming them is what turns "file documents" into an action. */
  accepts: readonly string[];
}

export interface Needs {
  module: string;
  moduleLabel: string;
  requirements: Requirement[];
}

/**
 * What a step needs before it can run.
 *
 * Straight off the criteria — the same source the readiness checklist reads, so the agent and the
 * checklist cannot disagree. `null` for a module with no criteria, which the caller reports as a
 * step that needs nothing rather than as a step that does not exist.
 */
export function needsFor(module: string): Needs | null {
  const criteria = criteriaForModule(module);
  if (criteria.length === 0) return null;

  return {
    module,
    moduleLabel: LABELS.get(module) ?? module,
    requirements: criteria.map((criterion) => ({
      label: criterion.label,
      detail: criterion.detail,
      mandatory: criterion.weight === "mandatory",
      accepts: criterion.acceptedEvidence,
    })),
  };
}

/** Every step that has requirements, for the model to choose between. */
export function stepsWithNeeds(): { module: string; label: string }[] {
  return modulesWithCriteria().map((module) => ({
    module,
    label: LABELS.get(module) ?? module,
  }));
}

export interface OnboardingAnswer {
  answer: string;
  /** What the platform requires, where the question was about a step. */
  needs: Needs | null;
  policies: PolicyCitation[];
  /**
   * General professional guidance — what a construction term means, how it is worked out, where the
   * data comes from. The same channel, and the same guard, as the project advisor's (`ask.ts`): a
   * reader on the overview who pastes a term they do not know should get it explained, not be told
   * the checklist has no entry for it.
   */
  general: General | null;
  /**
   * A material take-off the platform computed — "how many bricks for 240 m² of one-brick wall".
   * The same engine and factors as the project advisor, priced from the firm's rate library.
   */
  tool: ToolResult | null;
  /** Questions the reader is likely to ask next. */
  followUps: string[];
  /** How much of each attached file the answer read. Absent where nothing was attached. */
  attached?: AttachmentCoverage[];
  usage: Usage;
}

const SYSTEM = (steps: readonly { module: string; label: string }[]) =>
  `You are the assistant on a South African quantity surveying platform, and a senior quantity surveyor and construction professional. The reader may be new to the platform or to construction. They can ask ANYTHING: how to start, what to file, what happens next — or a construction term they copied off the screen, how something is calculated, what a document is, who prepares it, or where to get the data.

A question that is only a term or a short phrase means: what does this mean, and where do I get the data for it.

You are given where they are — how many projects, documents and signed steps exist — and the five moves the platform is built around. Any file they attached is given as numbered passages.

Answer in TWO PARTS.

PART 1 — "answer": about this platform and what to do in it, in two or three sentences.
NEVER write a figure in "answer" — not a number, count, percentage or date. The platform shows the counts; your job is to say what to do.

${GENERAL_INSTRUCTIONS}
- Never state a figure from an attached file as if it were general knowledge.

Earlier turns of the conversation may be given; use them to understand a follow-up, but answer the latest question.

Other rules:
- Be brief and concrete. Two or three sentences. Say the next action, not the whole journey.
- Never invent a requirement. If they ask what a step needs, ask for that step's requirements with
  "needs" and the platform will list them exactly.
- Do not promise the platform does something you were not told it does.
- Where a firm standard is given, it binds your answer and you say so.

STEPS you may ask the requirements of, by module path:
${steps.map((s) => `- "${s.module}": ${s.label}`).join("\n")}

When you name a step in "answer" or "inPlatform", use its name ("the Feasibility Estimate"), never its path ("/feasibility"). Paths are only for "needs".

${TAKE_OFF_INSTRUCTIONS}

Reply as JSON: {"answer": "...", "needs": "/feasibility" or null, "general": {"summary": "...", "keyPoints": ["..."], "explanation": "...", "whereToGet": ["..."], "inPlatform": "..." or null, "steps": ["/feasibility"], "term": "..." or null, "process": ["D1.1-SP-001"]} or null, "followUps": ["..."], "takeOff": null}`;

/** The position, computed — never asked for. Same principle as the project advisor's brief. */
export function onboardingBrief(state: {
  projects: number;
  documents: number;
  signedSteps: number;
  /**
   * Whether the practice has built its rate library yet.
   *
   * The one setup act that is not a step in any job and that nothing else will tell a beginner
   * about. It is firm-level — a rate copied into every project is a rate that has to be corrected
   * in every project — so it is not one of the five moves, and somebody who never asks would only
   * discover it at the bill, where pricing quietly produces nothing.
   *
   * A yes or no, not a count, for the same reason the advisor's is: a number handed to the model
   * is a number that can come back out of it.
   */
  hasRates: boolean;
  steps: readonly GuidedStep[];
}): string {
  const current = state.steps.find((step) => step.state === "current");

  return [
    "WHERE THIS PERSON IS",
    `Projects open: ${state.projects}`,
    `Documents filed: ${state.documents}`,
    `Steps signed off: ${state.signedSteps}`,
    state.hasRates
      ? "The practice has a rate library, so a bill can be priced from it."
      : "The practice has NOT built its rate library yet. It is firm-wide, under Rate Library, and " +
        "a schedule is imported from a spreadsheet. Nothing can be priced until it exists — say so " +
        "if they ask about pricing or bills, and do not send them to a project to fix it.",
    "",
    "THE FIVE MOVES:",
    ...state.steps.map(
      (step) =>
        `${step.no}. ${step.title} — ${step.produces} [${step.state}${step.achieved ? `: ${step.achieved}` : ""}]`,
    ),
    "",
    current
      ? `THEY ARE AT: ${current.no}. ${current.title}`
      : "THEY HAVE COMPLETED EVERY MOVE THE PLATFORM TRACKS.",
  ].join("\n");
}

/**
 * Answer a beginner's question.
 *
 * One optional lookup, like the project advisor's tools: the model may ask for a step's
 * requirements and is then asked again with them. It cannot compose a requirement itself — that is
 * the whole point, because an invented requirement sends somebody looking for a document nobody
 * needs, and a missing one sends them into a run that cannot start.
 */
export interface OnboardingContext {
  history?: readonly Turn[];
  /** Passages from files attached to this question. Read for the answer, never stored. */
  attachments?: readonly Passage[];
  /** Attachment ids to file names, for labelling the passages. */
  names?: ReadonlyMap<string, string>;
  /** The firm's rates and factors, for a take-off. Absent means the take-off is not offered. */
  takeOffRates?: TakeOffRates;
}

export async function askOnboarding(
  question: string,
  brief: string,
  signal?: AbortSignal,
  context: OnboardingContext = {},
): Promise<OnboardingAnswer> {
  const steps = stepsWithNeeds();
  const standards = await searchPolicies(searchTerms(question), 2);
  const history = (context.history ?? []).slice(-8);
  // Read whole where it fits, by the parts bearing on the question where it does not (`ask.ts`).
  const chosen = chooseAttached(context.attachments ?? [], searchTerms(question), ATTACHED_CHARS, context.names);
  const attached = chosen.passages;
  const document = attached.length > 0 ? { figures: numbersIn(context.attachments ?? []), coverage: chosen.coverage } : undefined;

  const attachedText =
    attached.length > 0
      ? `ATTACHED BY THE READER:\n${attached
          .map((p, i) =>
            fence(`[${i + 1}] ${context.names?.get(p.documentId) ?? "attachment"}${p.page ? `, page ${p.page}` : ""}`, p.body),
          )
          .join("\n\n")}`
      : "";

  const conversation =
    history.length > 0
      ? `EARLIER IN THIS CONVERSATION (for context only):\n${history
          .map((turn) => `${turn.role === "user" ? "Reader" : "You"}: ${turn.text.slice(0, 1_200)}`)
          .join("\n")}`
      : "";

  const base = [brief, "", policyText(standards), "", attachedText, "", document ? `${ATTACHMENT_MODE}\n- This overrides the rule against figures for the attached document: state what it says directly, names and figures included, each figure exactly as written.` : "", chosen.note, "", conversation, "", `QUESTION: ${question}`]
    .filter(Boolean)
    .join("\n");

  const first = await askForJson({ purpose: "onboarding.ask",
    system: SYSTEM(steps),
    user: base,
    maxTokens: document ? 2_000 : 1_100,
    signal,
  });

  const wanted = (first.json ?? {}) as Record<string, unknown>;

  /*
    A take-off first, as in the project advisor: the model reads the work and the quantity out of the
    question, and the platform does the arithmetic from its factors and the firm's rates. The model is
    then asked again with the result, and may not restate its figures.
  */
  // The model's reading, or the question's own shape when the model answered in prose (N10).
  const takeOffRequest = context.takeOffRates ? (readTakeOffRequest(wanted.takeOff) ?? readTakeOffQuestion(question)) : null;
  if (takeOffRequest && context.takeOffRates) {
    const taken = await resourceTakeOff(
      takeOffRequest,
      context.takeOffRates.library,
      context.takeOffRates.options,
      signal,
      context.takeOffRates.factors ?? [],
    );
    const second = await askForJson({ purpose: "onboarding.ask",
      system: SYSTEM(steps),
      user: [base, "", toolText(taken.result), "", "Now answer. Do not write any figure in \"answer\" — the platform shows the take-off underneath it."].join("\n"),
      maxTokens: 700,
      signal,
    });
    return readOnboarding(
      second.json,
      null,
      standards,
      {
        input: first.usage.input + taken.usage.input + second.usage.input,
        output: first.usage.output + taken.usage.output + second.usage.output,
      },
      attached,
      taken.result,
    );
  }

  /*
    A price question, from the firm's Rate Library – the same lookup the project advisor uses. With
    no project there is no province, so every rate on file is eligible.
  */
  const priceTerms = context.takeOffRates ? readRateQuestion(question) : null;
  if (priceTerms && context.takeOffRates) {
    const looked = rateLookup(priceTerms, context.takeOffRates.library, { region: context.takeOffRates.options.region ?? null });
    const second = await askForJson({ purpose: "onboarding.ask",
      system: SYSTEM(steps),
      user: [base, "", toolText(looked), "", "Now answer. Do not write any figure in \"answer\" — the platform shows the rates underneath it. Say what they cover and how to use them."].join("\n"),
      maxTokens: 700,
      signal,
    });
    return readOnboarding(
      second.json,
      null,
      standards,
      { input: first.usage.input + second.usage.input, output: first.usage.output + second.usage.output },
      attached,
      looked,
    );
  }

  const needs = typeof wanted.needs === "string" ? needsFor(wanted.needs) : null;

  if (!needs) {
    return readOnboarding(first.json, null, standards, first.usage, attached, null, document);
  }

  const listed = [
    `REQUIREMENTS FOR ${needs.moduleLabel}:`,
    ...needs.requirements.map(
      (r) => `- ${r.label} (${r.mandatory ? "required" : "optional"}): ${r.detail}`,
    ),
  ].join("\n");

  const second = await askForJson({ purpose: "onboarding.ask",
    system: SYSTEM(steps),
    user: [base, "", listed, "", "Now answer. The platform lists these underneath you — do not repeat them, say what they are for and what to do."].join("\n"),
    maxTokens: 1_100,
    signal,
  });

  return readOnboarding(
    second.json,
    needs,
    standards,
    {
      input: first.usage.input + second.usage.input,
      output: first.usage.output + second.usage.output,
    },
    attached,
  );
}

/** Read the reply, holding it to the same figure rule as everything else the advisor says. */
export function readOnboarding(
  json: unknown,
  needs: Needs | null,
  policies: readonly PolicyCitation[],
  usage: Usage,
  /** Attached passages, so general guidance cannot repeat their figures. */
  passages: readonly Pick<Passage, "body">[] = [],
  tool: ToolResult | null = null,
  /** Where documents were attached: the figures they state, which an answer may repeat, and how much was read. */
  document?: { figures: ReadonlySet<string>; coverage: AttachmentCoverage[] },
): OnboardingAnswer {
  const o = (json ?? {}) as Record<string, unknown>;
  const raw = typeof o.answer === "string" ? o.answer.trim() : "";

  const kept = raw
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && (!statesFigure(s) || (document !== undefined && figuresAllowed(s, document.figures))));

  return {
    answer: kept.join(" "),
    ...(document ? { attached: document.coverage } : {}),
    needs,
    policies: [...policies],
    // No general guidance beside a take-off: a typical figure would compete with the computed one.
    general: tool ? null : readGeneral(o.general, passages),
    followUps: readFollowUps(o.followUps, passages),
    tool,
    usage,
  };
}

/** Ask, and refuse to come back with nothing to show. */
export async function askOnboardingOrExplain(
  question: string,
  brief: string,
  signal?: AbortSignal,
  context: OnboardingContext = {},
): Promise<OnboardingAnswer> {
  const result = await askOnboarding(question, brief, signal, context);

  if (result.answer.length === 0 && !result.needs && !result.general && !result.tool) {
    throw new ModelUnavailable(
      "The guide answered, but nothing in the reply could be shown. Ask again, or open the " +
        "checklist on a step — it lists exactly what that step needs.",
    );
  }

  return result;
}
