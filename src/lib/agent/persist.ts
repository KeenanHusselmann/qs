/**
 * A run, written down — PLATFORM.md §1.3.1.
 *
 * ── Why this exists at all ─────────────────────────────────────────────────────────────────
 *
 * The run panel held its results in React state, which meant a reload lost them, a second tab could
 * not see them, and a laptop that slept threw away a minute of paid model calls. That was the right
 * thing to ship at the time — a results table with no column saying whether a figure had been signed
 * would have been half a service chain, and the missing half is the one that matters. This is the
 * other half.
 *
 * ── Proposed is written as each field settles, not at the end ──────────────────────────────
 *
 * A field is finished the moment it is answered, even though the run is not, and §1.3.1 asks that a
 * run in flight survive everything. Writing at the end would mean a run killed on the ninth field
 * left nothing behind — including the eight answers somebody had already paid for and could have
 * been checking. So each row lands as it settles, and the run's own status closes the file
 * afterwards.
 *
 * Nothing here ever rewrites a proposal. A correction is an override, and the database refuses the
 * alternative with a trigger rather than trusting every future writer to remember.
 */

import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import { db } from "@/db/client";
import { runFields, runs } from "@/db/schema";
import { costOf, type Usage } from "@/lib/agent/deepseek";
import { nameIn, nameOf, signerNames } from "@/lib/signers";
import type {
  Citation,
  FieldResult,
  PersistedRun,
  RunField,
  RunStatus,
} from "@/lib/agent/run";

/** Open a run and return its id. Status `running` until something closes it. */
export async function openRun(
  projectId: string,
  module: string,
  by: string,
): Promise<string> {
  const [row] = await db
    .insert(runs)
    .values({ projectId, module, status: "running", createdBy: by })
    .returning({ id: runs.id });

  return row.id;
}

/**
 * Write what the agent proposed for one field.
 *
 * The citation is stored as both the document id and the document's name. The id is what makes the
 * quote openable; the name is what keeps the citation readable after the document is gone, since
 * the foreign key is `on delete set null` and a citation that cannot say which document it was is
 * not provenance.
 */
export async function recordField(
  runId: string,
  seq: number,
  result: FieldResult,
  /** Where it was carried from, for a figure taken from an upstream service rather than read. */
  carried?: { via: string; fromRunId: string },
): Promise<void> {
  await db.insert(runFields).values(fieldRow(runId, seq, result, carried));
}

/**
 * The `run_fields` row for one result – what `recordField` writes, as a value, so a caller writing
 * inside its own transaction (hand entry opens a run and all its fields at once) maps the columns
 * the same way rather than keeping a second copy of this list.
 */
export function fieldRow(
  runId: string,
  seq: number,
  result: FieldResult,
  carried?: { via: string; fromRunId: string },
): typeof runFields.$inferInsert {
  return {
    runId,
    fieldId: result.field.id,
    seq,
    label: result.field.label,
    proposedState: result.state,
    proposedValue: result.value,
    proposedConfidence: result.confidence,
    proposedNote: result.note ?? null,
    sourceDocumentId: result.citation?.documentId ?? null,
    sourceDocument: result.citation?.document ?? null,
    sourcePage: result.citation?.page ?? null,
    sourceExcerpt: result.citation?.quote ?? null,
    carriedVia: carried?.via ?? null,
    carriedFromRunId: carried?.fromRunId ?? null,
  };
}

/**
 * Close the run — `review` when every field was asked, `failed` when it stopped.
 *
 * The distinction is the one §1.3 refuses to blur: a failed run's unanswered fields are absent from
 * the run, not absent from the documents, and a reader has to be able to tell which.
 */
export async function closeRun(
  runId: string,
  status: Exclude<RunStatus, "running">,
  spend: Usage,
  error?: string,
): Promise<void> {
  await db
    .update(runs)
    .set({
      status,
      error: error ?? null,
      inputTokens: spend.input,
      outputTokens: spend.output,
    })
    .where(eq(runs.id, runId));
}

/** What a project's steps have to show for themselves — §1.3.1's `upstream_ready`, as facts. */
export interface StepRuns {
  /** Any run at all, signed or not. It is what separates `draft` from `ready`. */
  hasRun: boolean;
  /** The signature in force, from the most recently signed run of that step. */
  signature: { by: string; at: string } | null;
}

/**
 * Every step of a project and what it has run, in **one** query.
 *
 * The overview asks this of every module and the chain asks it of every upstream, so what matters is
 * one round trip for the page rather than one per row — a loop of queries that grows with the nav is
 * invisible on a project with three modules and obvious on one with nineteen.
 *
 * The rows are reduced here rather than by the database. A project has a handful of runs, `distinct
 * on` is Postgres-only and §13.1's portability rule is the reason nothing else here uses it, and the
 * alternative is a window function nobody will be able to read in a year.
 */
export async function stepRuns(projectId: string): Promise<Map<string, StepRuns>> {
  const rows = await db
    .select({ module: runs.module, signedBy: runs.signedBy, signedAt: runs.signedAt })
    .from(runs)
    .where(and(eq(runs.projectId, projectId), isNull(runs.deletedAt)))
    .orderBy(desc(runs.createdAt));

  const steps = new Map<string, StepRuns>();
  const names = await signerNames();

  for (const row of rows) {
    const step = steps.get(row.module) ?? { hasRun: false, signature: null };
    step.hasRun = true;

    // Newest first, so the first signature seen is the one in force.
    if (!step.signature && row.signedAt && row.signedBy) {
      step.signature = { by: nameIn(names, row.signedBy), at: row.signedAt.toISOString() };
    }

    steps.set(row.module, step);
  }

  return steps;
}

/** The steps a project has signed — what `upstreamPending` compares against. */
export const signedModules = async (projectId: string): Promise<Set<string>> =>
  new Set(
    [...(await stepRuns(projectId))].filter(([, step]) => step.signature).map(([module]) => module),
  );

/**
 * The signature that is currently in force on a step, if any.
 *
 * Not the same question as "is the run on screen signed". Signing a run and then running the step
 * again leaves the screen showing a fresh draft while the *signed* run — the one a downstream step
 * would read — is the earlier one. Without this the panel would say "nothing is signed off yet"
 * over a project that has a signed output, which is the kind of quietly wrong sentence a QS makes
 * decisions on.
 *
 * The fields are not loaded. What the screen needs is who signed and when; the figures belong to
 * the run that carries them.
 */
export async function loadSignature(
  projectId: string,
  module: string,
): Promise<{ runId: string; by: string; at: string } | null> {
  const [row] = await db
    .select({ id: runs.id, signedBy: runs.signedBy, signedAt: runs.signedAt })
    .from(runs)
    .where(
      and(
        eq(runs.projectId, projectId),
        eq(runs.module, module),
        isNotNull(runs.signedAt),
        isNull(runs.deletedAt),
      ),
    )
    .orderBy(desc(runs.signedAt))
    .limit(1);

  return row?.signedAt && row.signedBy
    ? { runId: row.id, by: await nameOf(row.signedBy), at: row.signedAt.toISOString() }
    : null;
}

/** A figure a downstream step may read, with everything needed to say where it came from. */
export interface SignedFigure {
  value: string;
  citation: Citation | null;
  /** The run that froze it — recorded on whatever carries it onward. */
  runId: string;
  signedBy: string;
}

/**
 * **The downstream read** — PLATFORM.md §1.3.1, and the reason `output` exists at all.
 *
 * ── Why this cannot leak an unapproved figure ──────────────────────────────────────────────
 *
 * `signed_at is not null` is in the `where` clause. A draft run is not filtered out by an `if` that
 * a future writer might forget or invert — it is **not in the result set**. §1.3.1: "Not a status
 * check in application code that someone can forget — the downstream query finds nothing to read.
 * That single decision is why the chain cannot leak unreviewed numbers into a bill or a
 * certificate."
 *
 * It reads `output_value` rather than `working`. They are equal at the moment of signing, and only
 * one of them is frozen: `working` is a live derivation over columns that a correction could still
 * move on a *draft*, and reading it here would mean a downstream step's figures depended on which
 * run happened to be latest. The frozen column is the promise.
 *
 * A field signed with no figure — legitimate for an optional one — is absent from the map rather
 * than present and empty, so a caller asking for it gets "not established" instead of a blank that
 * reads like nought.
 */
/**
 * A stored row's citation — the one piece of this that is worth testing on its own.
 *
 * ── Why it is a function ───────────────────────────────────────────────────────────────────
 *
 * It carried a bug that only appeared once a source document had been deleted, which is a state
 * no unit test reached and no browser check produced: `documentId` was coerced from null to `""`
 * to satisfy a `string` type, and the empty string travelled all the way to a `uuid` column and
 * failed the insert. The run that carried the figure died with a page of SQL on it.
 *
 * The mapping is now separable from the query, so the deleted-document case is a test rather than
 * a thing somebody has to remember.
 */
export function citationOf(row: {
  sourceExcerpt: string | null;
  sourceDocumentId: string | null;
  sourceDocument: string | null;
  sourcePage: number | null;
}): Citation | null {
  // No quote, no citation. A document name on its own does not say where in it the figure was.
  if (!row.sourceExcerpt) return null;

  return {
    documentId: row.sourceDocumentId,
    /*
      The name outlives the id on purpose. `on delete set null` clears the foreign key when a
      document is removed, and a citation that can no longer say *which* document it was is not
      provenance — so the name is stored beside the id and this is where it earns that.
    */
    document: row.sourceDocument ?? "A document no longer filed",
    page: row.sourcePage ?? undefined,
    quote: row.sourceExcerpt,
  };
}

export async function loadSignedOutput(
  projectId: string,
  module: string,
): Promise<Map<string, SignedFigure>> {
  const [run] = await db
    .select({ id: runs.id, signedBy: runs.signedBy })
    .from(runs)
    .where(
      and(
        eq(runs.projectId, projectId),
        eq(runs.module, module),
        isNotNull(runs.signedAt),
        isNull(runs.deletedAt),
      ),
    )
    .orderBy(desc(runs.signedAt))
    .limit(1);

  if (!run?.signedBy) return new Map();
  const signedBy = await nameOf(run.signedBy);

  const rows = await db
    .select()
    .from(runFields)
    .where(and(eq(runFields.runId, run.id), isNotNull(runFields.outputValue)));

  return new Map(
    rows.map((row) => [
      row.fieldId,
      {
        value: row.outputValue!,
        // The **original** document, carried across with the figure. A cost report that could only
        // say "this came from the feasibility estimate" would stop one step short of the brief the
        // number was actually read from, which is the step a reader wants.
        citation: citationOf(row),
        runId: run.id,
        signedBy,
      },
    ]),
  );
}

/** One step's approved figures, in the order the run established them. */
export interface SignedStep {
  module: string;
  runId: string;
  by: string;
  at: string;
  /** Why it was signed although its money did not reconcile (audit C3). Absent or null: none. */
  note?: string | null;
  fields: {
    fieldId: string;
    label: string;
    value: string;
    citation: Citation | null;
    carriedVia: string | null;
  }[];
}

/**
 * Everything this project has approved — PLATFORM.md §1.3.1, read back.
 *
 * ── Why this exists ────────────────────────────────────────────────────────────────────────
 *
 * The chain writes signed outputs and, until now, only the next step ever read one. A QS could see
 * ten figures on the feasibility estimate and eleven on the contract and had nowhere to see the
 * project's *approved data* as one thing — which is the question they ask before anything is
 * issued, and the question a report answers.
 *
 * ── Signed only, and that is the point ─────────────────────────────────────────────────────
 *
 * `signed_at is not null` in the `where` clause, and `output_value` rather than `working`. A draft
 * figure is not approved data; showing it here beside approved ones would recreate exactly the
 * ambiguity `output` exists to remove. A step still in draft is reported as *absent from this page*,
 * with its state, rather than as a row somebody might read as agreed.
 *
 * Two queries whatever the number of steps: the runs, then their fields. A page that issued one per
 * module would issue twelve today and twenty later.
 */
export async function loadSignedFigures(projectId: string): Promise<SignedStep[]> {
  const signedRuns = await db
    .select({
      id: runs.id,
      module: runs.module,
      signedBy: runs.signedBy,
      signedAt: runs.signedAt,
      signoffNote: runs.signoffNote,
    })
    .from(runs)
    .where(and(eq(runs.projectId, projectId), isNotNull(runs.signedAt), isNull(runs.deletedAt)))
    .orderBy(desc(runs.signedAt));

  // The signature in force per step: newest first, so the first seen wins. Signing a step twice is
  // legitimate — running it again and signing the new figures — and only the latest is approved.
  const inForce = new Map<string, (typeof signedRuns)[number]>();
  for (const run of signedRuns) if (!inForce.has(run.module)) inForce.set(run.module, run);
  if (inForce.size === 0) return [];
  const names = await signerNames();

  const rows = await db
    .select()
    .from(runFields)
    .where(
      and(
        inArray(
          runFields.runId,
          [...inForce.values()].map((r) => r.id),
        ),
        isNotNull(runFields.outputValue),
      ),
    )
    .orderBy(asc(runFields.seq));

  const byRun = new Map<string, typeof rows>();
  for (const row of rows) byRun.set(row.runId, [...(byRun.get(row.runId) ?? []), row]);

  return [...inForce.values()].map((run) => ({
    module: run.module,
    runId: run.id,
    by: nameIn(names, run.signedBy!),
    at: run.signedAt!.toISOString(),
    note: run.signoffNote,
    fields: (byRun.get(run.id) ?? []).map((row) => ({
      fieldId: row.fieldId,
      label: row.label,
      value: row.outputValue!,
      // The original document, still attached. A figure on this page is exactly as checkable as it
      // was on the step that produced it — that is what makes the page usable for issuing anything.
      citation: row.sourceExcerpt
        ? {
            documentId: row.sourceDocumentId ?? "",
            document: row.sourceDocument ?? "A document no longer filed",
            page: row.sourcePage ?? undefined,
            quote: row.sourceExcerpt,
          }
        : null,
      carriedVia: row.carriedVia,
    })),
  }));
}

/**
 * The latest run of a step on a project, with its fields.
 *
 * Latest rather than latest-signed: this is what the screen shows, and the screen shows the work in
 * progress. What a *downstream* step reads is the latest signed one, and that query belongs with
 * the downstream read rather than here.
 */
export async function loadLatestRun(
  projectId: string,
  module: string,
): Promise<PersistedRun | null> {
  const [run] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.projectId, projectId), eq(runs.module, module), isNull(runs.deletedAt)))
    .orderBy(desc(runs.createdAt))
    .limit(1);

  if (!run) return null;

  const names = await signerNames();
  const rows = await db
    .select()
    .from(runFields)
    .where(eq(runFields.runId, run.id))
    .orderBy(asc(runFields.seq));

  const fields: RunField[] = rows.map((row) => ({
    fieldId: row.fieldId,
    label: row.label,
    seq: row.seq,
    proposed: {
      state: row.proposedState,
      value: row.proposedValue,
      confidence: row.proposedConfidence,
      note: row.proposedNote,
    },
    citation: row.sourceExcerpt
      ? {
          // A citation whose document was hard-deleted keeps its name and its quote. It can no
          // longer be opened, and saying "the document this came from is gone" is the honest
          // version of that; silently dropping the citation would make a grounded value look
          // ungrounded.
          documentId: row.sourceDocumentId ?? "",
          document: row.sourceDocument ?? "A document no longer filed",
          page: row.sourcePage ?? undefined,
          quote: row.sourceExcerpt,
        }
      : null,
    carriedVia: row.carriedVia,
    override:
      row.overrideValue !== null && row.overrideBy && row.overrideAt
        ? {
            value: row.overrideValue,
            reason: row.overrideReason,
            by: nameIn(names, row.overrideBy),
            at: row.overrideAt.toISOString(),
          }
        : null,
    output: row.outputValue,
  }));

  /**
   * The heartbeat, derived rather than stored: the newest thing written, or the start if nothing
   * has landed. An UPDATE on the run per field would be ten extra round trips to record something
   * the field rows already say.
   */
  const lastWrite = rows.reduce(
    (latest, row) => (row.createdAt > latest ? row.createdAt : latest),
    run.createdAt,
  );

  return {
    id: run.id,
    module: run.module,
    status: run.status,
    error: run.error,
    startedAt: run.createdAt.toISOString(),
    lastWriteAt: lastWrite.toISOString(),
    // Shown as the signer's name (`signers.ts`); the run still records the email.
    signedBy: nameIn(names, run.signedBy),
    signedAt: run.signedAt?.toISOString() ?? null,
    signoffNote: run.signoffNote,
    spend:
      run.inputTokens === null || run.outputTokens === null
        ? null
        : {
            input: run.inputTokens,
            output: run.outputTokens,
            rand: costOf({ input: run.inputTokens, output: run.outputTokens }),
          },
    fields,
  };
}
