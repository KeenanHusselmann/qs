/**
 * How a criterion stands for one project — PLATFORM.md §1.3.3.
 *
 * Defined once, here, so that a summary and the list it opens cannot disagree about what
 * "blocked" means. v3 learned this: two definitions of "waiting" is the kind of drift where a tile
 * says 3, the view it opens shows 2, and the reader has no way to tell which one lied.
 */

import { criteriaFor, criteriaForModule, type Criterion } from "@/lib/entry-criteria";

/**
 * `satisfied` and `declared` are deliberately distinct.
 *
 * One is evidence found in the corpus; the other is a named person's word. Collapsing them would
 * lose exactly the distinction that matters when someone reviews the run months later.
 */
export type CriterionState = "satisfied" | "declared" | "uncertain" | "missing";

/** Where a satisfied criterion's evidence came from (§1.3.2). The proof, not a label. */
export interface Evidence {
  /** The filed document's id, so the row that cites it can also withdraw it. */
  documentId?: string;
  document: string;
  page?: number;
  quote: string;
  /** How sure the agent is. Below its threshold the state is `uncertain`, never `satisfied`. */
  confidence: number;
}

export interface CriterionOutcome {
  criterion: Criterion;
  state: CriterionState;
  evidence?: Evidence;
  /** Who declared it, and why. Present only when `state` is `declared`. */
  declaredBy?: string;
  declaredReason?: string;
}

/**
 * Whether a process may start, and if not, what is stopping it.
 *
 * Two kinds of blocker, kept apart because **only one of them can be cleared by uploading a
 * document**:
 *
 *  - `missingInputs` — a mandatory criterion with no evidence. Fixed by filing the document, or by
 *    a human declaring it where the criterion allows.
 *  - `upstreamPending` — an unsigned upstream step. **Nothing a person uploads clears this**, and
 *    it is never declarable: a step must not read figures nobody approved.
 *
 * v3 found the reason this distinction has to reach the UI. Gating a run button on `startable`
 * printed "needs a cost plan" directly beneath "Filed and indexed: the cost plan", because the
 * upload had landed but the server had not re-read the chain yet. Gate on the blocker an upload
 * cannot clear and there is nothing to race.
 */
/**
 * A missing input, and the means of clearing it.
 *
 * ── Why this is not a list of labels ───────────────────────────────────────────────────────
 *
 * It was, and the panel that received it could only *name* the documents it was waiting for. A
 * reader who has just been told "File Project brief and concept parameters first" is a reader
 * holding that document, and the answer was to scroll past the run panel, find the matching row in
 * the readiness list and use the button there. That is the same failure v3 recorded about the
 * documents page — "a reader who discovers they need a document must be able to file it *there*" —
 * arrived at one screen further in.
 *
 * So a blocker carries the kind it files under as well as the name it is known by, and the refusal
 * can offer the upload rather than describe it.
 *
 * ── Not the same control twice (§2.5) ──────────────────────────────────────────────────────
 *
 * §2.5 forbids two *ways* to do a thing, and the reason the project-wide documents panel was
 * removed is that it asked the reader to choose a kind from a select — a genuinely different act
 * with a different chance of being got wrong. This is the same `CriterionUpload`, bound to the same
 * criterion, filing under the same kind, from the place the reader was told about it. One act, at
 * the point of need.
 */
export interface BlockingInput {
  /** The requirement in the QS's words. Never a filename. */
  label: string;
  /**
   * The kind a document dropped here is filed as — the criterion's **primary** accepted evidence.
   *
   * The first of `acceptedEvidence`, which is the rule the readiness row and `criterion-upload.tsx`
   * already use, rather than a second one invented here. Null where a criterion accepts nothing,
   * which no criterion does today; the refusal still names it and simply offers nothing to press.
   */
  kind: string | null;
}

/**
 * The missing inputs of a readiness, as something a refusal can act on.
 *
 * Derived here rather than in each panel, so the two panels and anything after them cannot come to
 * disagree about which kind a document filed from a blocked step lands under.
 */
export const blockingInputs = (readiness: Readiness): BlockingInput[] =>
  readiness.missingInputs.map((outcome) => ({
    label: outcome.criterion.label,
    kind: outcome.criterion.acceptedEvidence[0] ?? null,
  }));

export interface Readiness {
  process: string;
  outcomes: readonly CriterionOutcome[];
  missingInputs: readonly CriterionOutcome[];
  upstreamPending: readonly string[];
  /** Non-blocking gaps. The run proceeds; each carries a stated fallback. */
  gaps: readonly CriterionOutcome[];
  startable: boolean;
}

const isResolved = (state: CriterionState) => state === "satisfied" || state === "declared";

/**
 * Whether one named criterion has been met — for a refusal that would otherwise offer a reader a
 * document they have already filed.
 *
 * The bill's sign-off gate needs exactly this. "File the priced source the rates come from" is the
 * right advice on a project with no cost plan, and actively misleading on one where the cost plan
 * *is* filed and the draft simply found no rate on those rows: it sends a QS off to do a thing that
 * is already done and will not help. Two different facts, two different sentences, and the panel
 * can only tell them apart if something tells it.
 */
export const isSatisfied = (readiness: Readiness, criterionId: string): boolean =>
  readiness.outcomes.some((o) => o.criterion.id === criterionId && isResolved(o.state));

/**
 * Work out where a process stands.
 *
 * `known` maps criterion id to its outcome. Anything absent from it is genuinely missing — which is
 * the correct reading for a project with no documents filed, and is not the same as inventing a
 * status for it.
 */
export function readinessOf(
  process: string,
  known: ReadonlyMap<string, CriterionOutcome>,
  upstreamPending: readonly string[] = [],
): Readiness {
  return readinessOver(process, criteriaFor(process), known, upstreamPending);
}

/**
 * Readiness for one module's slice of a process.
 *
 * A process area can span several nav items — D3.1 covers data import, documents and site — so
 * resolving by process code would show a module every criterion of its process, including the ones
 * filed somewhere else. That is the page this rework exists to get rid of. The caller passes the
 * criteria it actually owns.
 */
export function readinessOfModule(
  module: string,
  known: ReadonlyMap<string, CriterionOutcome>,
  upstreamPending: readonly string[] = [],
): Readiness {
  const criteria = criteriaForModule(module);
  return readinessOver(criteria[0]?.process ?? module, criteria, known, upstreamPending);
}

function readinessOver(
  process: string,
  criteria: readonly Criterion[],
  known: ReadonlyMap<string, CriterionOutcome>,
  upstreamPending: readonly string[],
): Readiness {
  const outcomes = criteria.map<CriterionOutcome>(
    (criterion) => known.get(criterion.id) ?? { criterion, state: "missing" },
  );

  const unresolved = outcomes.filter((o) => !isResolved(o.state));

  return {
    process,
    outcomes,
    missingInputs: unresolved.filter((o) => o.criterion.weight === "mandatory"),
    upstreamPending,
    gaps: unresolved.filter((o) => o.criterion.weight === "advisory"),
    startable: unresolved.every((o) => o.criterion.weight !== "mandatory") && upstreamPending.length === 0,
  };
}

/**
 * The one sentence at the top of the screen.
 *
 * Written here rather than in the component so every surface that summarises readiness says the
 * same thing in the same words.
 */
export function readinessSummary(readiness: Readiness): string {
  const { missingInputs, upstreamPending, gaps } = readiness;

  if (upstreamPending.length > 0) {
    const list = upstreamPending.join(", ");
    return `Waiting on ${list} to be signed off. Filing documents will not clear this.`;
  }

  if (missingInputs.length > 0) {
    const n = missingInputs.length;
    return `Blocked — ${n} required ${n === 1 ? "input is" : "inputs are"} missing.`;
  }

  if (gaps.length > 0) {
    const n = gaps.length;
    return `Ready to start. ${n} optional ${n === 1 ? "input is" : "inputs are"} absent; the run will proceed and say what it assumed.`;
  }

  return "Ready to start. Everything this process needs is filed.";
}
