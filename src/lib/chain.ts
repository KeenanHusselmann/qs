/**
 * The service chain — PLATFORM.md §1.3.1, the half that decides whether a step may start.
 *
 * ── The server owns this, and the client never recomputes it ───────────────────────────────
 *
 * "A client that decided its own prerequisites could start a downstream step from nothing and call
 * it approved." That was not hypothetical here: the run button was disabled when required documents
 * were missing and the route behind it checked only whether the corpus was empty, so a POST from a
 * console ran the step anyway. The button is a courtesy; `startable` is the rule, and it is answered
 * where the session and the database are.
 *
 * ── What gates a step ──────────────────────────────────────────────────────────────────────
 *
 * Two different blockers, and §1.3.3 keeps them apart because **only one of them can be cleared by
 * uploading a document**:
 *
 *   its own inputs      mandatory criteria with no evidence      file the document, or declare it
 *   its upstream        a step above it whose output is unsigned  nothing you upload here helps
 *
 * ── An upstream with nothing to sign is not a gate ─────────────────────────────────────────
 *
 * §1.3.1 says startability depends on "which upstream runs are **signed**". Project Inputs and Site
 * & Zoning feed the Feasibility Estimate in the process model, and neither produces a run — they
 * carry entry criteria and nothing else, so there is no output, no signature, and nothing a
 * signature could be withheld from. Gating on them would mean waiting for a document to approve
 * itself.
 *
 * So an upstream area gates only when it **produces a signed output**, and today exactly one module
 * does. `upstreamPending` is therefore empty in practice and the mechanism is not: the moment the
 * cost plan gets a field set, it is a step that cannot start until the feasibility estimate is
 * signed, and nothing here changes to make that true.
 *
 * ── This file is the shape; the database supplies the facts ────────────────────────────────
 *
 * Everything here is pure. Which of a project's runs are actually signed is a query, and it is
 * passed in — `process-model.ts` says the same thing about itself and it is worth repeating: nothing
 * static should ever decide whether a particular project's step can start.
 */

import { carriesRowsFrom, ITEM_SETS, producesItems } from "@/lib/agent/bill";
import { ACTIVITY_SETS, producesActivities } from "@/lib/agent/programme";
import { FIELD_SETS_BY_MODULE, type FieldSpec } from "@/lib/agent/run";
import { DEFAULT_CRITERIA } from "@/lib/entry-criteria";
import { PROCESS_AREAS } from "@/lib/process-model";
import { PROJECT_NAV } from "@/lib/navigation";
import { phaseOfModule } from "@/lib/stages";

/**
 * The modules that run an agent and produce a signed output.
 *
 * A module is run-producing because it **declares what a run of it establishes**, not because a
 * boolean somewhere says so. Adding a module is adding that declaration, and every question here —
 * what gates what, what may be signed, what a downstream step can read — answers itself from it. It
 * is why the cost plan became a step that waits for a signature without a line of this file changing.
 *
 * There are two kinds of declaration now. A `FieldSpec[]` in `FIELD_SETS` is a fixed set of named
 * scalars; an `ItemSpec` in `ITEM_SETS` is a bill, whose rows are discovered from the documents and
 * whose count is not known in advance (§1.3.3). They differ in what a run returns and in nothing
 * else — same `runs` row, same signature, same freeze — so everything downstream of this line treats
 * them alike.
 */
export const FIELD_SETS = FIELD_SETS_BY_MODULE;

/** Whether this module produces an output a signature could freeze. */
export const producesRuns = (module: string): boolean =>
  module in FIELD_SETS || producesItems(module) || producesActivities(module);

/** The fields a module's run must establish. */
export const fieldsFor = (module: string): readonly FieldSpec[] => FIELD_SETS[module] ?? [];

/**
 * Which process area a module executes.
 *
 * Taken from the **criteria**, not from the nav item's `process` label. The nav's is a display
 * string — Site & Zoning reads "D3.1 · D7.1" and Project Corpus also claims D3.1 — while the
 * criteria carry exactly one code per module and are what `check-modules.mjs` already asserts is
 * consistent. A chain resolved from a label with a middot in it would be a chain that broke when
 * somebody tidied the label.
 */
const PROCESS_OF = new Map(DEFAULT_CRITERIA.map((c) => [c.module, c.process]));

/**
 * Process area back to a module — **first declared wins**, which is a decision and not an accident.
 *
 * One area can hold several modules: D1.1's sub-processes are "Feasibility Cost Estimate",
 * "Elemental Cost Plan" and "Cost Plan Revision", and the first two are separate pages. When another
 * area says it feeds D1.1, it feeds the *entry* to D1.1 — the estimate, not the plan built on top of
 * it — so the first module declared for an area is the one a chain edge lands on. `chain.test.ts`
 * pins that, because it is the kind of thing that would otherwise change the day somebody reorders
 * a list.
 */
const MODULE_OF = new Map<string, string>();
for (const [module, process] of PROCESS_OF) {
  if (!MODULE_OF.has(process)) MODULE_OF.set(process, module);
}

export const processOf = (module: string) => PROCESS_OF.get(module);
export const moduleOf = (process: string) => MODULE_OF.get(process);

/**
 * **Every** module in an area, not just the one a chain edge lands on.
 *
 * `moduleOf` answers "where does an edge into D1.1 arrive", and first-declared-wins is the right
 * answer to that. It is the wrong answer to "what has this platform built for D1.1", where naming
 * the estimate and silently omitting the cost plan understates the platform to somebody reading its
 * process model. Two questions, two functions.
 */
export const modulesOf = (process: string): string[] =>
  [...PROCESS_OF].filter(([, area]) => area === process).map(([module]) => module);


/**
 * The modules a step takes figures from — **its dependencies, derived from what it needs.**
 *
 * ── Why this is not read out of the process model alone ────────────────────────────────────
 *
 * `process-model.ts` is **L2**, and its chain is between process *areas*. That is too coarse in two
 * directions at once, and both showed up as soon as there was a real chain:
 *
 *  - **Too coarse.** The cost plan reads the feasibility estimate and both are D1.1, so an
 *    area-level edge cannot express the order of an area's own parts. The alternative was inventing
 *    D1.1a and D1.1b in a record of the firm's documented BPMN, which is not ours to renumber.
 *  - **Incomplete.** D1.8 records that the final account is built from certificates and variations,
 *    and says nothing about the contract — yet a final account is meaningless except as a movement
 *    from the contract sum, which it carries.
 *
 * A step's real dependency is **the figures it cannot produce its output without**, and those are
 * written down in its field set. So the edges come from there, unioned with the area model, which
 * still contributes the neighbours a step relates to without carrying a figure from.
 */
const carriedFrom = (module: string): string[] => [
  ...new Set([
    ...fieldsFor(module).flatMap((field) => (field.carriedFrom ? [field.carriedFrom.module] : [])),
    // A row carry is the same edge in the other shape — see `ROW_CARRIES`. Reading both here is
    // what lets the gate, the chain and the menu keep falling out of one declaration each.
    ...(carriesRowsFrom(module) ? [carriesRowsFrom(module)!] : []),
  ]),
];

/**
 * Every module that runs, for finding which of them read a given one.
 *
 * Both shapes. It was the field sets alone, so `feedsInto("/bill")` searched a list the bill's only
 * reader could never be in — and the most consequential output the platform produces looked, on the
 * chain, like something nothing consumed.
 */
const RUN_MODULES = [...new Set([...Object.keys(FIELD_SETS), ...Object.keys(ITEM_SETS), ...Object.keys(ACTIVITY_SETS)])];

const LABELS = new Map(PROJECT_NAV.flatMap((g) => g.items).map((i) => [i.href, i.label]));

/** The module's name as the menu spells it. One list owns these (`navigation.ts`). */
export const labelOf = (module: string) => LABELS.get(module) ?? module;

/**
 * A neighbouring step in the chain.
 *
 * ── Why this is a process area and not always a module ─────────────────────────────────────
 *
 * The chain is declared between **process areas** (`feedsFrom` / `feedsInto` in `process-model.ts`),
 * and only some of them have a module in this platform. The two do not line up one-to-one and
 * forcing them to would mean inventing a mapping: D1.2 (*BoQ Production*) is four nav items —
 * Take-off, Repetition Designer, Bill of Quantities, Pricing — so "which module is D1.2" has no
 * answer, and picking the first would put a name on the screen that nothing chose.
 *
 * So a link carries the area, and the module only where one genuinely exists. It reads as the
 * module's own menu label when there is one and as the process area's name when there is not,
 * which is the honest version of both: *Feeds Site & Zoning* against *Feeds BoQ Production (not
 * built)*. Dropping the unbuilt ones instead would say the platform's model of the work stops here.
 */
export interface Link {
  /** The process area — "D1.2". */
  code: string;
  /** What to call it: the module's menu label where there is a module, else the area's own name. */
  label: string;
  /** The module, where this platform has exactly one for the area. */
  module?: string;
  built: boolean;
}

const BUILT = new Set(
  PROJECT_NAV.flatMap((g) => g.items).filter((i) => i.built).map((i) => i.href),
);
/** Whether this platform has a page for a module — the nav is the authority, not a second list. */
export const isBuilt = (module: string): boolean => BUILT.has(module);

const asLink = (module: string): Link => ({
  code: processOf(module) ?? module,
  label: labelOf(module),
  module,
  built: BUILT.has(module),
});

/** The area model's own neighbours, resolved to modules where this platform has one. */
function areaLinks(module: string, direction: "feedsFrom" | "feedsInto"): Link[] {
  const area = PROCESS_AREAS.find((a) => a.code === processOf(module));
  if (!area) return [];

  return area[direction].flatMap((code) => {
    const neighbour = PROCESS_AREAS.find((a) => a.code === code);
    if (!neighbour) return [];

    const asModule = moduleOf(code);
    return [
      {
        code,
        label: asModule ? labelOf(asModule) : neighbour.name,
        module: asModule,
        built: asModule ? BUILT.has(asModule) : false,
      },
    ];
  });
}

const dedupe = (links: Link[]): Link[] => {
  const seen = new Set<string>();
  return links.filter((link) => {
    const key = link.module ?? link.code;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * The steps whose signed output this one consumes.
 *
 * A carry from **inside this step's own process area** replaces the area's upstream rather than
 * adding to it. Such a step sits behind another in a queue: the cost plan's upstream is the
 * feasibility estimate, and the estimate's upstream is D1.1's — the brief and the site analysis.
 * Inheriting those as well would say the cost plan waits on them directly, which is untrue and
 * unhelpful, because clearing them is the estimate's job.
 */
export function feedsFrom(module: string): Link[] {
  const carried = carriedFrom(module);
  const withinArea = carried.some((up) => processOf(up) === processOf(module));

  return dedupe([...(withinArea ? [] : areaLinks(module, "feedsFrom")), ...carried.map(asLink)]);
}

/** The steps that consume this one's signed output — the same relation, read backwards. */
export function feedsInto(module: string): Link[] {
  const readers = RUN_MODULES.filter((reader) => carriedFrom(reader).includes(module));
  const readByOwnArea = readers.some((reader) => processOf(reader) === processOf(module));

  // The area's downstream belongs to the *last* step in the area's queue, not the first.
  return dedupe([...(readByOwnArea ? [] : areaLinks(module, "feedsInto")), ...readers.map(asLink)]);
}

/**
 * The upstream modules this step **cannot proceed without** — derived, not declared.
 *
 * ── Why "feeds into" is not the same as "must precede" ─────────────────────────────────────
 *
 * The process model records that variations feed valuations, and they do: an approved variation
 * belongs in the next certificate. It does not follow that a certificate needs a signed variations
 * run — the first certificate on a well-run job has no variations at all, and gating on one would
 * make a normal month's work impossible until somebody ran a step over an empty register and signed
 * it. `feedsFrom` conflates "provides data to" with "must come first", and only the second is a gate.
 *
 * ── The rule, and why it needs no configuration ────────────────────────────────────────────
 *
 * **An upstream gates when this step carries a *required* field from it.** That is the precise
 * statement of dependence: the run cannot produce its output without a figure that only the signed
 * upstream can supply, so starting it would mean starting something that must fail. An upstream this
 * step merely *may* draw on — an optional carried field, or none at all — informs it without
 * blocking it, and the run reports "nothing to carry" honestly if it is absent.
 *
 * Nothing declares this. It falls out of the field sets, the same way `producesRuns` does, so a
 * module's dependencies cannot drift from the figures it actually needs.
 */
const requiredCarriesFrom = (module: string, upstream: string): boolean =>
  // A row carry is always required, and `ROW_CARRIES` says why: tender documentation *is* the bill
  // sent out to be priced. There is no optional version of it to weigh, so there is no flag here.
  carriesRowsFrom(module) === upstream ||
  fieldsFor(module).some((field) => field.required && field.carriedFrom?.module === upstream);

/**
 * Upstream steps that are holding this one up — §1.3.1's `upstream_ready`, inverted.
 *
 * `signed` says which modules of this project have a signed run. Returns labels, because the only
 * thing anybody does with this is read it in a sentence.
 */
export function upstreamPending(module: string, signed: ReadonlySet<string>): string[] {
  return feedsFrom(module)
    .filter((link) => link.module !== undefined)
    .filter(
      (link) =>
        producesRuns(link.module!) &&
        requiredCarriesFrom(module, link.module!) &&
        !signed.has(link.module!),
    )
    .map((link) => link.label);
}

/**
 * What a step *is* — §1.3.1's five states, defined once.
 *
 * "Defined once, so a dashboard tile and the board it opens cannot disagree about what 'waiting'
 * means." v3 learned that the expensive way, and `criteria-status.ts` says the same thing about
 * readiness for the same reason.
 */
export type StepState = "not_built" | "waiting" | "ready" | "draft" | "signed_off";

export function stepState({
  module,
  startable,
  hasRun,
  isSigned,
}: {
  module: string;
  /** From `Readiness.startable` — its own inputs and its upstream, together. */
  startable: boolean;
  hasRun: boolean;
  isSigned: boolean;
}): StepState {
  if (!BUILT.has(module)) return "not_built";
  if (isSigned) return "signed_off";
  if (hasRun) return "draft";
  return startable ? "ready" : "waiting";
}

/** How each state reads on screen. One list, so no surface invents its own word for a state. */
export const STEP_STATE_LABEL: Readonly<Record<StepState, string>> = {
  not_built: "Not built",
  waiting: "Waiting",
  ready: "Ready",
  draft: "Draft",
  signed_off: "Signed off",
};

/**
 * The same five states said in a sentence — §7.7, "errors say what to do next".
 *
 * The badge gives a reader one word and the sentence gives them their next move, and the two must
 * agree. This was written inline on the project overview's step rows, which was the only surface
 * that stated a step's position; a step's **own page** said nothing at all, so clicking a row
 * reading "Waiting on Feasibility Estimate to be signed off" landed on a screen that had forgotten
 * it. Writing it a second time there would have been two derivations of one fact, which is the
 * drift `stepState` exists to prevent — so it lives beside the states it describes.
 *
 * The order is the reader's, not the enum's: an unsigned upstream is named first because it is the
 * blocker no upload clears, and somebody told to file documents for a step that is waiting on
 * another would do work that changes nothing.
 */
export function stepSummary({
  state,
  upstreamPending,
  signedBy,
  blocked,
  gaps,
}: {
  state: StepState;
  /** Labels of upstream steps not yet signed, from `upstreamPending`. */
  upstreamPending: readonly string[];
  /** Who signed it, where it is signed. Null otherwise. */
  signedBy: string | null;
  /** Required inputs still missing. */
  blocked: number;
  /** Optional inputs still missing. */
  gaps: number;
}): string {
  if (upstreamPending.length > 0) {
    return `Waiting on ${upstreamPending.join(", ")} to be signed off`;
  }
  if (signedBy) return `Signed off by ${signedBy} — the next step can read these figures`;
  if (state === "draft") return "Run in progress — not signed off, so nothing downstream reads it yet";
  if (blocked > 0) return `${blocked} required ${blocked === 1 ? "input" : "inputs"} still missing`;
  if (gaps > 0) {
    return `Ready to start — ${gaps} optional ${gaps === 1 ? "input" : "inputs"} would improve it`;
  }
  return "Ready to start";
}

/** What a step needs to be ranked as the next move — the facts the board already has per row. */
export interface StepPosition {
  module: string;
  state: StepState;
  /** Required inputs still missing. */
  blocked: number;
  /** Labels of unsigned upstream steps, from `upstreamPending`. */
  upstreamPending: readonly string[];
}

/**
 * Why a step was chosen, which decides the words: carry on with a draft, start a step that is ready,
 * file what a step is missing — or, where nothing can move, say what everything is waiting on.
 */
export type NextMove = "continue" | "start" | "file" | "wait";

const NAV_ORDER = new Map(PROJECT_NAV.flatMap((g) => g.items).map((item, index) => [item.href, index]));

/**
 * The one step a reader should open next, in the order the work actually happens.
 *
 * ── Why this is not "the first step missing a document" ────────────────────────────────────
 *
 * That was the rule, and on a project with its early stages filed it answered **Final Account** —
 * the closing document of the contract — and told the reader one upload would unblock it, while the
 * page it linked to said nothing filed there would. Two faults compounded: it ignored the upstream
 * blocker `stepSummary` names first, and its "process order" was the declaration order of the
 * criteria, where the final account happens to sit ahead of tender analysis and handover.
 *
 * So: phase first (L0, the same ordering the board groups by), nav order within a phase, and only a
 * step the reader can move from where they stand — a draft to finish, a step ready to run, a step
 * short of a document. A step waiting on an upstream is skipped, because its upstream is earlier and
 * is the thing to open. A step that runs no agent is done once its documents are in; offering it as
 * "ready" for ever would pin the tile to Project Inputs.
 *
 * Only where nothing can move does it return a waiting step, so the tile can say what the job is
 * held up by rather than falling silent.
 */
/** Phase first (L0), then the order the menu lists steps — the order the work is walked in. */
export const byProcessOrder = (a: { module: string }, b: { module: string }): number =>
  (phaseOfModule(a.module) ?? Infinity) - (phaseOfModule(b.module) ?? Infinity) ||
  (NAV_ORDER.get(a.module) ?? Infinity) - (NAV_ORDER.get(b.module) ?? Infinity);

export function nextStep<T extends StepPosition>(steps: readonly T[]): { step: T; move: NextMove } | null {
  const ordered = [...steps].sort(byProcessOrder);

  let waiting: T | null = null;

  for (const step of ordered) {
    if (step.state === "signed_off" || step.state === "not_built") continue;
    if (step.state === "draft") return { step, move: "continue" };

    if (step.upstreamPending.length > 0) {
      waiting ??= step;
      continue;
    }

    if (step.blocked > 0) return { step, move: "file" };
    if (step.state === "ready" && producesRuns(step.module)) return { step, move: "start" };
  }

  return waiting ? { step: waiting, move: "wait" } : null;
}
