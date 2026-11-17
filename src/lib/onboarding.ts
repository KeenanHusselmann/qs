/**
 * Setting a project up — what to ask, in what order, and what to say about the answers.
 *
 * ── Nothing new is declared here ───────────────────────────────────────────────────────────
 *
 * A stage is an L0 phase (`stages.ts`). Every module resolves to a phase. Every entry criterion
 * names the module it gates and the document kinds that would satisfy it (`entry-criteria.ts`).
 * So **stage → modules → criteria → document kinds** already resolves, and "which documents does
 * the Procurement stage need?" has an exact answer sitting in the repository.
 *
 * That is the whole reason this file is arithmetic and not a prompt. An LLM asked that question
 * would produce a plausible list, and a plausible list is the failure §14 names: it would look
 * right, it would not be the checklist the run actually gates on, and the two would diverge the
 * first time somebody edited the criteria. The guidance below is *derived from the same rows the
 * gate reads*, so a step can never ask for something setup did not mention.
 *
 * Where a genuine guess is needed — what a dropped file *is* — there is already a classifier
 * (`infer-kind.ts`), it names the folder or filename it matched on, and the human confirms it.
 * Guessing is for the thing nobody wrote down; it is not for the thing we wrote down.
 *
 * ── Why "which stage are you at" and not "tick everything" ─────────────────────────────────
 *
 * Creation used to show six stages all ticked and one flat form. That assumes every project is
 * opened at its beginning with its whole document set in hand, and almost none are: a practice
 * takes work on at tender, or at valuation, with one document and a phone call. Asking the stage
 * first is what makes a smaller ask possible — everything after it narrows to that stage, so the
 * checklist is five rows rather than forty.
 *
 * ── An answer of "not yet" is a real answer ────────────────────────────────────────────────
 *
 * §1.3's integrity rule: never a silent gap. A criterion nobody can satisfy today is recorded as
 * outstanding and its consequence is stated from the criterion's own `fallback` — not hidden, and
 * not treated as a reason to refuse to open the project. A project may be created with nothing
 * filed at all. It will simply say what it is short of.
 */

import { DEFAULT_CRITERIA, type Criterion } from "@/lib/entry-criteria";
import { STAGES, phaseOfModule, type Stage } from "@/lib/stages";

/** What a reader answers about one requirement. Three states, because "not mine" is not "not yet". */
export type Answer = "have" | "not-yet" | "n/a";

export const ANSWER_LABEL: Record<Answer, string> = {
  have: "I have this",
  "not-yet": "Not yet",
  "n/a": "Not applicable",
};

/**
 * The requirements that belong to a stage, mandatory first.
 *
 * Two criteria can gate the same module; both appear. Sorting mandatory to the top is the one
 * ordering decision made here, and it is made because a reader scanning a list of nine wants the
 * blocking ones in the first three rows, not scattered through.
 */
export function criteriaForStage(phase: number): readonly Criterion[] {
  return DEFAULT_CRITERIA.filter((c) => phaseOfModule(c.module) === phase).sort((a, b) =>
    a.weight === b.weight ? 0 : a.weight === "mandatory" ? -1 : 1,
  );
}

/** A stage as the setup question offers it: the phase, plus how much it will ask for. */
export interface StageOption extends Stage {
  /** Every requirement in this stage. */
  wants: number;
  /** The ones that block a run rather than flag a gap. */
  mandatory: number;
}

export const STAGE_OPTIONS: readonly StageOption[] = STAGES.map((stage) => {
  const criteria = criteriaForStage(stage.number);
  return {
    ...stage,
    wants: criteria.length,
    mandatory: criteria.filter((c) => c.weight === "mandatory").length,
  };
});

/**
 * The stages a project covers, given the one it is at now.
 *
 * Forward, not all: a project taken on at tender has its feasibility behind it — done by somebody,
 * somewhere, and not work this practice is about to do. Recording the earlier phases would put six
 * steps on the board that nobody intends to run, which is the crowded board this was meant to fix.
 *
 * The earlier stages stay tickable in the form. This is the default, not a rule.
 */
export function stagesFrom(phase: number): number[] {
  return STAGE_OPTIONS.filter((stage) => stage.number >= phase).map((stage) => stage.number);
}

/** One requirement, and what the reader said about it. */
export interface Standing {
  criterion: Criterion;
  /**
   * Null until somebody answers.
   *
   * Distinguishing "not answered" from "answered: not yet" is what lets the panel react to a
   * person rather than lecture them. Both mean the document is not to hand — but only the second
   * is somebody telling us so, and an effect worth explaining is worth explaining *then*, not on
   * a panel that listed all twenty consequences before a single click.
   */
  answer: Answer | null;
  /** The file attached to it, where one was. */
  filename?: string;
}

/**
 * What the setup says back — the "agent" half of this, and deliberately a typed structure.
 *
 * Prose assembled in a component cannot be asserted; a shape can. `tone` follows §7.2's semantic
 * roles exactly: `ok` where nothing mandatory is outstanding, `warn` where something is, `info`
 * before anybody has answered.
 */
export interface Advice {
  tone: "info" | "ok" | "warn";
  headline: string;
  /**
   * Outstanding mandatory requirements, by name.
   *
   * Names only. No mandatory criterion in the checklist declares a `fallback`, and that is not an
   * oversight — a fallback is what the platform does *instead*, and for a mandatory input there is
   * no instead. Their shared consequence is one sentence, said once in `next`, rather than the
   * same sentence copied onto eight lines.
   */
  blocking: readonly string[];
  /**
   * Advisory absences that change what the platform will produce, in the criterion's own words.
   *
   * This is the half worth the panel's space. "No QS cost plan" does not block the feasibility
   * run — it changes what the run may conclude, to a withheld verdict over a benchmark placeholder,
   * and a QS deciding whether to start today should be told that before they start rather than
   * after. Quoted from `fallback`, never composed here, so the two cannot disagree.
   */
  consequences: readonly { label: string; effect: string }[];
  /** What happens next, said before it happens. */
  next: string;
}

/** The shared consequence of a missing mandatory input, said once. What "mandatory" means. */
const BLOCKS = "Each blocks its step from starting until it is filed, or declared with a reason.";

/** How many consequences are spelled out before the panel starts counting instead. */
const SPELLED_OUT = 2;

export function adviceFor(stage: StageOption, standings: readonly Standing[]): Advice {
  const answered = standings.filter((s) => s.answer !== null);
  const held = standings.filter((s) => s.answer === "have");
  const attached = standings.filter((s) => s.filename);

  const absent = (s: Standing) => s.answer === null || s.answer === "not-yet";

  const blocking = standings
    .filter((s) => s.criterion.weight === "mandatory" && absent(s))
    .map((s) => s.criterion.label);

  // Only what somebody has actually told us they do not have. Every advisory row defaults to
  // absent, so reading the default as an answer would print the whole list before a single click.
  const consequences = standings
    .filter(
      (s) =>
        s.criterion.weight === "advisory" &&
        s.answer !== null &&
        s.answer !== "have" &&
        s.criterion.fallback,
    )
    .map((s) => ({ label: s.criterion.label, effect: s.criterion.fallback as string }));

  if (answered.length === 0) {
    return {
      tone: "info",
      headline: `${stage.name} asks for ${stage.wants} ${stage.wants === 1 ? "thing" : "things"} — ${stage.mandatory} of them before a run can start.`,
      blocking: [],
      consequences: [],
      next: "Mark what you have. Anything not to hand yet is recorded as outstanding, and does not stop the project being opened.",
    };
  }

  // The count that matters is what is *held*, not what is attached: a QS may have the title deed
  // on their desk and file it on Tuesday, and that is a different position from not having one.
  const headline =
    held.length === 0
      ? `Nothing to hand for ${stage.name} yet.`
      : `${held.length} of ${stage.wants} to hand${attached.length > 0 ? `, ${attached.length} ready to file` : ""}.`;

  if (blocking.length === 0) {
    return {
      tone: "ok",
      headline,
      blocking: [],
      consequences: consequences.slice(0, SPELLED_OUT),
      next:
        attached.length > 0
          ? `Nothing mandatory is outstanding. The ${attached.length === 1 ? "file is" : "files are"} filed against the project when it is created, under the kind shown beside ${attached.length === 1 ? "it" : "each"}.`
          : "Nothing mandatory is outstanding. File documents from the project's own pages as they arrive.",
    };
  }

  return {
    tone: "warn",
    headline,
    blocking,
    consequences: consequences.slice(0, SPELLED_OUT),
    next: `${BLOCKS} The project opens either way — ${blocking.length === 1 ? "it shows" : "they show"} as outstanding on the ${stage.name} steps.`,
  };
}
