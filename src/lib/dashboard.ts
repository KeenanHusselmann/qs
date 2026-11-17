/**
 * The portfolio, as signed figures — PLATFORM.md §1.3.1, §4.3, §5, §14.
 *
 * ── Why this file is mostly about what it refuses to say ───────────────────────────────────
 *
 * `/home` was an honest empty page for months, and the note left on it named the reason: §14 lists
 * **demo-driven development** as one of the specific ways this project fails, and a dashboard of
 * invented KPIs is precisely that. Nothing has changed about that judgement. What has changed is
 * that the chain now freezes figures a person put their name to, so there is something real to
 * count.
 *
 * The rule this file exists to enforce is therefore narrow and absolute: **every figure returned
 * here comes from `output_*` on a run whose `signed_at is not null`, and every figure that cannot
 * be produced comes back as a stated absence with the reason and the step that would supply it.**
 * There is no third case. A tile that renders a plausible number from unsigned data would be the
 * untraceable figure §1.3.1 calls worse than a gap — it survives review looking checked.
 *
 * ── Money is read, never parsed by eye ─────────────────────────────────────────────────────
 *
 * Every amount crosses `readAmount` and every count crosses `readQuantity`, which **refuse** rather
 * than guess: `"R186 420 000,00 excluding VAT"` is a qualified figure, `"48 m2 and 62 m2"` is two
 * figures, `"1,234"` is a thousand-fold ambiguity nothing in the text settles. A refusal travels to
 * the screen with its reason attached, because a QS who is shown a blank goes looking for a document
 * they have already filed.
 *
 * ── Four queries, whatever the size of the portfolio ───────────────────────────────────────
 *
 * The projects, then their runs, then the fields of the runs that matter, then the rows of the bills
 * that matter. `loadSignedFigures` makes the same trade for one project and says why: a page that
 * issued a query per project per step would be invisible on three projects and obvious on fifty,
 * and §6.8 says design for the second. The reduction to "the signature in force per step" happens
 * here in TypeScript for the reason recorded there — `distinct on` is Postgres-only and §13.1's
 * portability rule is why nothing else in this codebase uses it.
 */

import { and, asc, desc, inArray, isNull } from "drizzle-orm";

import { db } from "@/db/client";
import { runFields, runItems, runs } from "@/db/schema";
import { blockingRows, billTotal, ITEM_SETS, pricedRows } from "@/lib/agent/bill";
import { asBillRow } from "@/lib/agent/persist-bill";
import { blockingFields, specFor, type FieldSpec, type RunField } from "@/lib/agent/run";
import { fieldsFor, labelOf, producesRuns, upstreamPending } from "@/lib/chain";
import { PROJECT_NAV } from "@/lib/navigation";
import { readAmount, readQuantity, reconcile } from "@/domain/amount";
import {
  formatMoney,
  formatQuantity,
  multiplyQuantities,
  perUnit,
  sum,
  sumQuantities,
  ZERO_MONEY,
  ZERO_QUANTITY,
  type Money,
  type Quantity,
} from "@/domain/money";
import { listProjects } from "@/app/(app)/projects/actions";
import { nameIn, signerNames } from "@/lib/signers";
import type { ProjectStatus } from "@/lib/project-status";

// ── What a figure on this page is, and what an absence is ─────────────────────────────────

/** The signed run a figure came from, and the page a reader reaches by clicking it. */
export interface Source {
  projectId: string;
  projectName: string;
  module: string;
  /** The step's name as the menu spells it — one list owns these (`navigation.ts`). */
  label: string;
  runId: string;
  by: string;
  at: string;
  href: string;
}

/** A step this project has not spoken for yet, named so the absence has somewhere to go. */
export interface Step {
  module: string;
  label: string;
  href: string;
}

/**
 * A figure, or the reason there is not one.
 *
 * The absence carries a **reason** and a **step**, never merely a null. Those are the two things a
 * reader needs: what stopped the platform reading it, and where they would go to fix it. `text` on
 * the figure is the document's own words — "R186 420 000,00" — kept beside the parsed value so the
 * screen can show what was read rather than only what it was read as.
 *
 * `kind` separates the two absences, and they are not the same news. **Unsigned** means nobody has
 * approved a figure here yet. **Unreadable** means somebody did, and the reader refused it — "R42
 * 000 000,00 excluding VAT" is qualified, "1,234" is a thousand-fold ambiguity — so there is an
 * approved figure the platform will not turn into a number. Calling the second one "not signed off"
 * would send a reader to sign something that is already signed.
 */
export type Reading<T> =
  | { readonly ok: true; readonly value: T; readonly text: string; readonly source: Source }
  | {
      readonly ok: false;
      readonly kind: "unsigned" | "unreadable";
      readonly reason: string;
      /**
       * What the signed run actually said, kept apart from the reason rather than folded into it.
       * The table has room to show both — the document's words and why they were refused — and a
       * tile has room for one. Null where nothing is signed, because then there are no words.
       */
      readonly text: string | null;
      readonly step: Step;
    };

/** Where a project's total came from. Named on screen, because the two are different documents. */
export type Basis = "cost-plan" | "bill";

export type FlagKind = "reconciliation" | "signature" | "fields" | "rows";

/** Something on this project that needs a person — §1.3.1's integrity boundaries, as a list. */
export interface Flag {
  kind: FlagKind;
  projectId: string;
  projectName: string;
  label: string;
  href: string;
  /** One sentence: what is wrong, and what would settle it. §7.7 — errors say what to do next. */
  says: string;
}

export interface Signature {
  projectId: string;
  projectName: string;
  label: string;
  href: string;
  by: string;
  at: string;
}

/** One project, with every figure it has signed and every one it has not. */
export interface ProjectRow {
  id: string;
  name: string;
  client: string | null;
  status: ProjectStatus;
  href: string;
  /** The approved construction cost — the cost plan's signed total, or a signed bill's. */
  total: Reading<Money>;
  basis: Basis | null;
  units: Reading<Quantity>;
  area: Reading<Quantity>;
  /** Unit count × average unit area. Null unless both were signed and readable. */
  gfa: Quantity | null;
  costPerUnit: Money | null;
  costPerM2: Money | null;
  signedSteps: number;
  /**
   * Which steps are signed, not just how many — so progress can be shown by the stage a step
   * belongs to rather than as one number out of eleven. The stages are L0's, the same list a
   * project's own stages are picked from (`stages.ts`), so there is one vocabulary and not two.
   */
  signedModules: string[];
  flags: Flag[];
}

/** A tile's figure and the runs it is made of — the trace, kept beside the number. */
export interface Aggregate {
  /** Null when nothing signed supports it. Never a nought standing in for "unknown". */
  amount: Money | null;
  /** The projects whose signed figures make it up, in list order. */
  from: ProjectRow[];
  /** The signed figures that were read and refused, with the reader's own reason. */
  refused: {
    projectId: string;
    projectName: string;
    /** What the signed run said, so the reader can see the figure that was turned down. */
    text: string | null;
    reason: string;
    href: string;
  }[];
}

export interface Portfolio {
  projects: ProjectRow[];
  /** How many steps of a project can carry a signature at all — the denominator of progress. */
  signableSteps: number;
  /** Every module that produces a run, so a stage's denominator is the work it contains. */
  signableModules: readonly string[];
  value: Aggregate;
  /** Cost per unit, over the projects that signed both a total and a unit count. */
  perUnit: Aggregate & { units: Quantity };
  /** Cost per m² GFA, over the projects that also signed an average unit area. */
  perM2: Aggregate & { gfa: Quantity };
  flags: Flag[];
  recent: Signature[];
}

// ── The steps that can be signed ──────────────────────────────────────────────────────────

/**
 * Built steps whose run produces an output a signature could freeze.
 *
 * Derived from the nav and from what each module declares, never from a list kept here: a module is
 * run-producing because it declares a field set or an item set, and `chain.ts` is where that is
 * decided. A second list would go stale the first time a module was added.
 */
const SIGNABLE = PROJECT_NAV.flatMap((group) => group.items)
  .filter((item) => item.built && producesRuns(item.href))
  .map((item) => item.href);

const FIELD_MODULES = new Set(SIGNABLE.filter((module) => !(module in ITEM_SETS)));
const ITEM_MODULES = new Set(SIGNABLE.filter((module) => module in ITEM_SETS));

const stepOf = (module: string, projectId: string): Step => ({
  module,
  label: labelOf(module),
  href: `/projects/${projectId}${module}`,
});

// ── Rows out of the database, in the shapes the domain rules read ─────────────────────────

/**
 * A stored field row as `blockingFields` and `workingValue` read it.
 *
 * `loadLatestRun` builds the same shape and is not used here for one reason: it is a query per
 * module per project, and this page asks the question of every module of every project. The mapping
 * is deliberately partial to what the rules below actually read — the citation and the spend belong
 * to the step's own screen, which is one click away and is where a reader goes to act on any of this.
 */
const asRunField = (row: typeof runFields.$inferSelect): RunField => ({
  fieldId: row.fieldId,
  label: row.label,
  seq: row.seq,
  proposed: {
    state: row.proposedState,
    value: row.proposedValue,
    confidence: row.proposedConfidence,
    note: row.proposedNote,
  },
  citation: null,
  carriedVia: row.carriedVia,
  override:
    row.overrideValue !== null && row.overrideBy && row.overrideAt
      ? {
          value: row.overrideValue,
          reason: row.overrideReason,
          by: row.overrideBy,
          at: row.overrideAt.toISOString(),
        }
      : null,
  output: row.outputValue,
});


// ── The load ──────────────────────────────────────────────────────────────────────────────

/** The run of a step that a signature is in force on, and the run a reader is currently looking at. */
interface StepState {
  signed?: typeof runs.$inferSelect;
  latest: typeof runs.$inferSelect;
}

/**
 * Everything a dashboard reads, for one project or for all of them.
 *
 * ── Why a scope rather than a second loader ──────────────────────────────────────────────
 *
 * A project's dashboard asks exactly the questions the firm's does — what is this worth, what
 * does it cost per unit, what needs attention, what was signed — over a smaller set of runs.
 * The arithmetic is identical, and two implementations of "cost per unit" would eventually give
 * two answers to a question a QS asks on both screens.
 *
 * So the scope narrows the input and everything downstream follows. Passing a project id gives
 * that project's figures; passing nothing gives the practice's.
 */
export async function loadPortfolio(
  only?: string,
  /**
   * Test projects are left out of the practice's figures (audit C5): one at R0,24/m² was feeding
   * the firm's cost per unit. The project list asks for them, because they are still projects; a
   * single project's own dashboard always includes itself.
   */
  { includeTest = false }: { includeTest?: boolean } = {},
): Promise<Portfolio> {
  // Requires the session itself, so this cannot be reached by a page that forgot to.
  const all = await listProjects();
  const projects = only
    ? all.filter((project) => project.id === only)
    : all.filter((project) => includeTest || !project.isTest);

  const empty: Portfolio = {
    projects: [],
    signableSteps: SIGNABLE.length,
    signableModules: SIGNABLE,
    value: { amount: null, from: [], refused: [] },
    perUnit: { amount: null, from: [], refused: [], units: ZERO_QUANTITY },
    perM2: { amount: null, from: [], refused: [], gfa: ZERO_QUANTITY },
    flags: [],
    recent: [],
  };

  if (projects.length === 0) return empty;

  const runRows = await db
    .select()
    .from(runs)
    .where(
      and(
        inArray(
          runs.projectId,
          projects.map((project) => project.id),
        ),
        isNull(runs.deletedAt),
      ),
    )
    .orderBy(desc(runs.createdAt));

  /**
   * Per project and step: the signature in force, and the newest run.
   *
   * Newest-first, so the first signed run seen for a step is the one in force — signing a step twice
   * is legitimate and only the latest is approved. The newest run of all is what a reader has on
   * screen, and is the one whose unanswered required fields are worth naming.
   */
  const state = new Map<string, StepState>();
  const key = (projectId: string, module: string) => `${projectId}${module}`;

  for (const run of [...runRows].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )) {
    const at = key(run.projectId, run.module);
    const held = state.get(at);
    if (!held) state.set(at, { latest: run });
  }

  for (const run of [...runRows]
    .filter((run) => run.signedAt !== null)
    .sort((a, b) => b.signedAt!.getTime() - a.signedAt!.getTime())) {
    const held = state.get(key(run.projectId, run.module));
    if (held && !held.signed) held.signed = run;
  }

  /**
   * The runs worth loading rows for: the ones a signature is in force on, and the ones a reader is
   * looking at that are finished and unsigned.
   *
   * A `running` run is excluded from the second set deliberately. Its required fields are not
   * missing, they are unasked — reporting a run still in flight as short of three figures would put
   * a flag on the screen that clears itself, which is the definition of noise.
   */
  const wanted = (modules: ReadonlySet<string>) => [
    ...new Set(
      [...state.values()]
        .flatMap((step) => [
          step.signed,
          ...(!step.latest.signedAt && step.latest.status === "review" ? [step.latest] : []),
        ])
        .filter((run): run is typeof runs.$inferSelect => Boolean(run))
        .filter((run) => modules.has(run.module))
        .map((run) => run.id),
    ),
  ];

  const fieldRunIds = wanted(FIELD_MODULES);
  const itemRunIds = wanted(ITEM_MODULES);

  const [fieldRows, itemRows] = await Promise.all([
    fieldRunIds.length === 0
      ? Promise.resolve([])
      : db
          .select()
          .from(runFields)
          .where(inArray(runFields.runId, fieldRunIds))
          .orderBy(asc(runFields.seq)),
    itemRunIds.length === 0
      ? Promise.resolve([])
      : db
          .select()
          .from(runItems)
          .where(inArray(runItems.runId, itemRunIds))
          .orderBy(asc(runItems.seq)),
  ]);

  const fieldsByRun = new Map<string, (typeof runFields.$inferSelect)[]>();
  for (const row of fieldRows) fieldsByRun.set(row.runId, [...(fieldsByRun.get(row.runId) ?? []), row]);

  const itemsByRun = new Map<string, (typeof runItems.$inferSelect)[]>();
  for (const row of itemRows) itemsByRun.set(row.runId, [...(itemsByRun.get(row.runId) ?? []), row]);

  // Signers by name (`signers.ts`); the runs still record the email.
  const signers = await signerNames();

  const rows = projects.map((project) =>
    buildRow(project, state, fieldsByRun, itemsByRun, signers),
  );

  return {
    projects: rows,
    signableSteps: SIGNABLE.length,
    signableModules: SIGNABLE,
    ...aggregate(rows),
    flags: rows.flatMap((row) => row.flags),
    // Signers by name (`signers.ts`); the runs still record the email.
    recent: recentSignatures(runRows, projects, signers),
  };
}

// ── One project ───────────────────────────────────────────────────────────────────────────

function buildRow(
  project: { id: string; name: string; client: string | null; status: ProjectStatus },
  state: Map<string, StepState>,
  fieldsByRun: Map<string, (typeof runFields.$inferSelect)[]>,
  itemsByRun: Map<string, (typeof runItems.$inferSelect)[]>,
  signers: ReadonlyMap<string, string>,
): ProjectRow {
  const step = (module: string) => state.get(`${project.id}${module}`);

  const sourceOf = (module: string, run: typeof runs.$inferSelect): Source => ({
    projectId: project.id,
    projectName: project.name,
    module,
    label: labelOf(module),
    runId: run.id,
    by: nameIn(signers, run.signedBy) ?? "",
    at: run.signedAt!.toISOString(),
    href: `/projects/${project.id}${module}`,
  });

  /** A signed field's frozen value, or nothing. `output_value`, never `working` (§1.3.1). */
  const signedField = (module: string, fieldId: string) => {
    const signed = step(module)?.signed;
    if (!signed) return null;

    const row = (fieldsByRun.get(signed.id) ?? []).find(
      (field) => field.fieldId === fieldId && field.outputValue !== null,
    );

    return row ? { text: row.outputValue!, source: sourceOf(module, signed) } : null;
  };

  // ── The total ───────────────────────────────────────────────────────────────────────────
  //
  // The elemental cost plan's signed total first, a signed bill second. That order is the safer of
  // the two errors: a bill drafted from a specification is as long as the documents happened to
  // describe, and reading a partial one as the project's value would understate it badly and
  // quietly. The cost plan states a whole. Whichever answered is named on the screen, because they
  // are different documents making different claims.
  const costPlanTotal = signedField("/cost-plan", "cp-total");
  const signedBill = (() => {
    const signed = step("/bill")?.signed;
    if (!signed) return null;

    const rows = (itemsByRun.get(signed.id) ?? [])
      .filter((row) => row.omittedAt === null)
      .map((row) => asBillRow(row));

    return pricedRows(rows).length === 0
      ? null
      : { amount: billTotal(rows, true), rows, source: sourceOf("/bill", signed) };
  })();

  let total: Reading<Money>;
  let basis: Basis | null = null;

  if (costPlanTotal) {
    const reading = readAmount(costPlanTotal.text);
    basis = "cost-plan";
    total = reading.ok
      ? { ok: true, value: reading.amount, text: costPlanTotal.text, source: costPlanTotal.source }
      : {
          ok: false,
          kind: "unreadable",
          reason: reading.reason,
          text: costPlanTotal.text,
          step: stepOf("/cost-plan", project.id),
        };
  } else if (signedBill) {
    basis = "bill";
    total = {
      ok: true,
      value: signedBill.amount,
      text: formatMoney(signedBill.amount),
      source: signedBill.source,
    };
  } else {
    total = {
      ok: false,
      kind: "unsigned",
      reason: unsignedBecause("/cost-plan", step("/cost-plan")),
      text: null,
      step: stepOf("/cost-plan", project.id),
    };
  }

  // ── The two divisors, both from the feasibility estimate ─────────────────────────────────
  //
  // The unit count and the average unit area are established, reviewed and signed there, and the
  // cost plan carries them rather than reading them again (§1.3.1). Reading the carried copy here
  // would put a second answer to a settled question on the screen, so the origin is what is read.
  const units = signedQuantity(project.id, signedField("/feasibility", "units"), "/feasibility", step("/feasibility"));
  const area = signedQuantity(project.id, signedField("/feasibility", "unit-area"), "/feasibility", step("/feasibility"));

  const gfa =
    units.ok && area.ok && units.value > 0n && area.value > 0n
      ? multiplyQuantities(units.value, area.value)
      : null;

  const signedModules = SIGNABLE.filter((module) => step(module)?.signed);

  return {
    id: project.id,
    name: project.name,
    client: project.client,
    status: project.status,
    href: `/projects/${project.id}`,
    total,
    basis,
    units,
    area,
    gfa,
    costPerUnit: total.ok && units.ok && units.value > 0n ? perUnit(total.value, units.value) : null,
    costPerM2: total.ok && gfa !== null && gfa > 0n ? perUnit(total.value, gfa) : null,
    signedSteps: signedModules.length,
    signedModules,
    flags: flagsFor(project, state, fieldsByRun, itemsByRun),
  };
}

/** Why a step has nothing signed — run and awaiting a signature, or not run at all. */
const unsignedBecause = (module: string, step: StepState | undefined): string =>
  step?.latest
    ? `${labelOf(module)} has been run and not signed off, so nothing here reads it yet.`
    : `${labelOf(module)} has not been run.`;

function signedQuantity(
  projectId: string,
  signed: { text: string; source: Source } | null,
  module: string,
  step: StepState | undefined,
): Reading<Quantity> {
  if (!signed) {
    return {
      ok: false,
      kind: "unsigned",
      reason: unsignedBecause(module, step),
      text: null,
      step: stepOf(module, projectId),
    };
  }

  const reading = readQuantity(signed.text);
  return reading.ok
    ? { ok: true, value: reading.quantity, text: signed.text, source: signed.source }
    : {
        ok: false,
        kind: "unreadable",
        reason: reading.reason,
        text: signed.text,
        step: stepOf(module, projectId),
      };
}

// ── What needs a person ───────────────────────────────────────────────────────────────────

/**
 * The four things that are wrong in a way a reader can act on.
 *
 * Each maps onto a rule that already exists rather than onto a new judgement invented for a tile:
 * `reconcile` for a step whose parts do not make its whole, `upstreamPending` for a step held up by
 * a signature, `blockingFields` and `blockingRows` for a finished run that cannot be signed. A
 * dashboard that counted something of its own would be a second definition of "wrong", and §1.3.1's
 * warning about a tile and the board it opens disagreeing is exactly that.
 */
function flagsFor(
  project: { id: string; name: string },
  state: Map<string, StepState>,
  fieldsByRun: Map<string, (typeof runFields.$inferSelect)[]>,
  itemsByRun: Map<string, (typeof runItems.$inferSelect)[]>,
): Flag[] {
  const flags: Flag[] = [];
  const step = (module: string) => state.get(`${project.id}${module}`);

  const at = (module: string) => ({
    projectId: project.id,
    projectName: project.name,
    label: labelOf(module),
    href: `/projects/${project.id}${module}`,
  });

  const signedModules = new Set(SIGNABLE.filter((module) => step(module)?.signed));

  // Named `stepModule` rather than `module`, which Next refuses to let anything declare: a binding
  // called `module` shadows the CommonJS one and breaks the bundler's own module detection.
  for (const stepModule of SIGNABLE) {
    const held = step(stepModule);
    const specs: readonly FieldSpec[] = fieldsFor(stepModule);

    // ── A step whose elements do not add up to the total it states ────────────────────────
    if (held?.signed) {
      const signedRows = (fieldsByRun.get(held.signed.id) ?? []).filter(
        (row) => row.outputValue !== null,
      );

      const result = reconcile(
        signedRows.map((row) => ({
          label: row.label,
          value: row.outputValue,
          money: specFor(row.fieldId, specs)?.money,
        })),
      );

      if (result.difference !== null && result.difference !== ZERO_MONEY) {
        flags.push({
          kind: "reconciliation",
          ...at(stepModule),
          says: `The ${result.counted} elements sum to R ${formatMoney(
            result.elements,
          )} against a stated total of R ${formatMoney(
            result.stated!,
          )} — a difference of R ${formatMoney(result.difference, {
            accounting: true,
          })}. Correcting either is a correction on the step, signed for.`,
        });
      }
    }

    /**
     * ── A step held up by a signature somebody owes ────────────────────────────────────────
     *
     * `upstreamPending` answers "which upstreams are unsigned", and on a project nobody has started
     * that is every step with a required carry — four of them, on every new project, which is not a
     * finding but the ordinary state of work not yet begun. What is a finding is an upstream that
     * **has been run and is sitting unsigned**: the work is done, the figures are on a screen, and
     * one signature would release the step below it.
     */
    for (const waiting of upstreamPending(stepModule, signedModules)) {
      const upstream = SIGNABLE.find((candidate) => labelOf(candidate) === waiting);
      const upstreamStep = upstream ? step(upstream) : undefined;
      if (!upstream || !upstreamStep || upstreamStep.signed) continue;

      flags.push({
        kind: "signature",
        ...at(upstream),
        says: `${waiting} has been run and not signed off, and ${labelOf(
          stepModule,
        )} cannot start until it is.`,
      });
    }

    // ── A finished run that cannot be signed ──────────────────────────────────────────────
    if (held && !held.signed && held.latest.status === "review") {
      if (stepModule in ITEM_SETS) {
        const rows = (itemsByRun.get(held.latest.id) ?? []).map((row) => asBillRow(row));
        const blocked = blockingRows(rows);

        if (!blocked.empty && blocked.rows.length > 0) {
          flags.push({
            kind: "rows",
            ...at(stepModule),
            says: `${blocked.rows.length} ${
              blocked.rows.length === 1 ? "row has" : "rows have"
            } no measure — ${blocked.rows[0].description} needs ${
              blocked.rows[0].missing
            }. Enter the figures or strike the rows out; a signed bill with a hole in it reads downstream as an approved total.`,
          });
        }
      } else if (specs.length > 0) {
        const blocked = blockingFields(
          (fieldsByRun.get(held.latest.id) ?? []).map(asRunField),
          specs,
        );

        if (blocked.length > 0) {
          flags.push({
            kind: "fields",
            ...at(stepModule),
            says: `${blocked.length} required ${
              blocked.length === 1 ? "figure has" : "figures have"
            } no value — ${blocked
              .slice(0, 2)
              .map((field) => field.label)
              .join(", ")}${
              blocked.length > 2 ? ` and ${blocked.length - 2} more` : ""
            }. The run cannot be signed off until they are answered.`,
          });
        }
      }
    }
  }

  // One flag per upstream, however many steps below it are waiting: the reader signs it once.
  return flags.filter(
    (flag, index) =>
      flags.findIndex((other) => other.kind === flag.kind && other.href === flag.href) === index,
  );
}

// ── The portfolio roll-up ─────────────────────────────────────────────────────────────────

/**
 * The three money tiles, each over **its own** set of projects.
 *
 * A cost per unit summed over projects that signed a total and divided by units from a different
 * set of projects would be a ratio of two unrelated things. So each aggregate keeps only the
 * projects that signed every figure it needs, and the screen says how many that was. The alternative
 * — averaging the per-project ratios — would weight a 30-unit infill scheme equally with a
 * 1 046-unit estate, which is not what anybody reading "cost per unit" means by it.
 */
function aggregate(rows: readonly ProjectRow[]): Pick<Portfolio, "value" | "perUnit" | "perM2"> {
  /**
   * A figure that was signed and could not be read. Distinct from one nobody has signed: the first
   * is a number sitting in an approved run that the reader refused, and dropping it silently would
   * leave a total that is quietly short by one project.
   */
  const refusals = rows.flatMap((row) =>
    row.total.ok || row.basis === null
      ? []
      : [
          {
            projectId: row.id,
            projectName: row.name,
            text: row.total.text,
            reason: row.total.reason,
            href: row.total.step.href,
          },
        ],
  );

  const valued = rows.filter((row) => row.total.ok);
  const counted = valued.filter((row) => row.units.ok && row.units.value > 0n);
  const measured = counted.filter((row) => row.gfa !== null && row.gfa > 0n);

  const totalOf = (of: readonly ProjectRow[]): Money =>
    sum(of.map((row) => (row.total.ok ? row.total.value : ZERO_MONEY)));

  const units = sumQuantities(
    counted.flatMap((row) => (row.units.ok ? [row.units.value] : [])),
  );
  const gfa = sumQuantities(measured.flatMap((row) => (row.gfa === null ? [] : [row.gfa])));

  return {
    value: {
      amount: valued.length === 0 ? null : totalOf(valued),
      from: valued,
      refused: refusals,
    },
    perUnit: {
      amount: units > 0n ? perUnit(totalOf(counted), units) : null,
      from: counted,
      refused: refusals,
      units,
    },
    perM2: {
      amount: gfa > 0n ? perUnit(totalOf(measured), gfa) : null,
      from: measured,
      refused: refusals,
      gfa,
    },
  };
}

/** The last signatures across the portfolio — what "recent activity" is, when nothing is invented. */
function recentSignatures(
  runRows: readonly (typeof runs.$inferSelect)[],
  projects: readonly { id: string; name: string }[],
  signers: ReadonlyMap<string, string>,
  limit = 8,
): Signature[] {
  const names = new Map(projects.map((project) => [project.id, project.name]));

  return runRows
    .filter((run) => run.signedAt !== null && run.signedBy !== null)
    .sort((a, b) => b.signedAt!.getTime() - a.signedAt!.getTime())
    .slice(0, limit)
    .map((run) => ({
      projectId: run.projectId,
      projectName: names.get(run.projectId) ?? "A project no longer listed",
      label: labelOf(run.module),
      href: `/projects/${run.projectId}${run.module}`,
      by: nameIn(signers, run.signedBy!),
      at: run.signedAt!.toISOString(),
    }));
}

/** A quantity as a reader sees it, with the unit the field is measured in. */
export const showQuantity = (value: Quantity, unit?: string): string =>
  `${formatQuantity(value, 0)}${unit ? ` ${unit}` : ""}`;

/**
 * Money as this platform writes it — §7.7, `R 1 234 567,89`.
 *
 * The space after the symbol is non-breaking, like the ones `formatMoney` groups thousands with and
 * for the same reason: in a quarter-width KPI tile an ordinary space lets the R sit alone on the
 * first line with the figure underneath it, which reads as two things rather than one.
 *
 * Written as an escape rather than pasted in, so it is visible in a diff, which is the same
 * argument `money.test.ts` makes about the separator in its own expectations.
 */
export const showMoney = (amount: Money): string => `R\u00a0${formatMoney(amount)}`;
