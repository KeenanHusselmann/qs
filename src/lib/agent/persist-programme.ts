/**
 * The programme's rows in the database – written as they are read, loaded with their progress.
 *
 * Mirrors `persist-bill.ts`. The one addition is progress: every row carries the latest progress
 * record against it, and the run carries the list of dates progress was recorded as at, so the
 * panel can walk the months without a query per activity.
 */

import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import { db } from "@/db/client";
import { programmeActivities, programmeProgress, runs } from "@/db/schema";
import { costOf } from "@/lib/agent/deepseek";
import type { ActivityResult, ActivityRow, PersistedProgramme, ProgressRow } from "@/lib/agent/programme";
import { nameIn, signerNames } from "@/lib/signers";

export const SEQ_STEP = 100;

/** Write a batch of read activities, in order, from `startSeq`. Returns the next free seq. */
export async function recordActivities(runId: string, rows: readonly ActivityResult[], startSeq: number): Promise<number> {
  let seq = startSeq;
  for (const row of rows) {
    await db.insert(programmeActivities).values({
      runId,
      seq,
      ref: row.ref,
      proposedName: row.name,
      proposedStart: row.start,
      proposedFinish: row.finish,
      proposedStartText: row.startText,
      proposedFinishText: row.finishText,
      proposedMilestone: row.milestone,
      proposedConfidence: row.confidence,
      proposedNote: row.note,
      sourceDocumentId: row.citation?.documentId || null,
      sourceDocument: row.citation?.document ?? null,
      sourcePage: row.citation?.page ?? null,
      sourceExcerpt: row.citation?.quote ?? null,
    });
    seq += SEQ_STEP;
  }
  return seq;
}

export function asActivityRow(
  row: typeof programmeActivities.$inferSelect,
  names: ReadonlyMap<string, string>,
  progress: ProgressRow | null,
): ActivityRow {
  return {
    id: row.id,
    seq: row.seq,
    ref: row.ref,
    proposed: {
      name: row.proposedName,
      start: row.proposedStart,
      finish: row.proposedFinish,
      startText: row.proposedStartText,
      finishText: row.proposedFinishText,
      milestone: row.proposedMilestone,
      confidence: row.proposedConfidence,
      note: row.proposedNote,
    },
    citation: row.sourceExcerpt
      ? {
          documentId: row.sourceDocumentId ?? "",
          document: row.sourceDocument ?? "A document no longer filed",
          page: row.sourcePage ?? undefined,
          quote: row.sourceExcerpt,
        }
      : null,
    override:
      row.overrideBy && row.overrideAt
        ? {
            name: row.overrideName,
            start: row.overrideStart,
            finish: row.overrideFinish,
            milestone: row.overrideMilestone,
            by: nameIn(names, row.overrideBy),
            at: row.overrideAt.toISOString(),
          }
        : null,
    value: row.value === null ? null : row.value.toString(),
    output:
      row.outputStart === null && row.outputFinish === null && row.outputName === null
        ? null
        : { name: row.outputName, start: row.outputStart, finish: row.outputFinish, milestone: row.outputMilestone ?? false },
    omitted: row.omittedBy && row.omittedAt ? { by: nameIn(names, row.omittedBy), at: row.omittedAt.toISOString() } : null,
    progress,
  };
}

/** The latest progress record per activity, and every date any was recorded as at. */
async function latestProgress(activityIds: readonly string[], names: ReadonlyMap<string, string>) {
  const latest = new Map<string, ProgressRow>();
  const dates = new Set<string>();
  if (activityIds.length === 0) return { latest, dates: [] as string[] };

  const rows = await db
    .select()
    .from(programmeProgress)
    .where(inArray(programmeProgress.activityId, [...activityIds]))
    .orderBy(desc(programmeProgress.asAt), desc(programmeProgress.recordedAt));

  for (const row of rows) {
    dates.add(row.asAt);
    if (latest.has(row.activityId)) continue;
    latest.set(row.activityId, {
      id: row.id,
      asAt: row.asAt,
      start: row.start,
      finish: row.finish,
      percent: row.percent,
      note: row.note,
      by: nameIn(names, row.recordedBy),
      at: row.recordedAt.toISOString(),
    });
  }
  return { latest, dates: [...dates].sort().reverse() };
}

export async function loadLatestProgramme(projectId: string, module: string): Promise<PersistedProgramme | null> {
  const [run] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.projectId, projectId), eq(runs.module, module), isNull(runs.deletedAt)))
    .orderBy(desc(runs.createdAt))
    .limit(1);
  if (!run) return null;

  const names = await signerNames();
  const rows = await db.select().from(programmeActivities).where(eq(programmeActivities.runId, run.id)).orderBy(asc(programmeActivities.seq));
  const { latest, dates } = await latestProgress(rows.map((r) => r.id), names);

  const lastWrite = rows.reduce((at, row) => (row.createdAt > at ? row.createdAt : at), run.createdAt);

  return {
    id: run.id,
    module: run.module,
    status: run.status,
    error: run.error,
    startedAt: run.createdAt.toISOString(),
    lastWriteAt: lastWrite.toISOString(),
    signedBy: nameIn(names, run.signedBy),
    signedAt: run.signedAt?.toISOString() ?? null,
    spend:
      run.inputTokens === null || run.outputTokens === null
        ? null
        : { input: run.inputTokens, output: run.outputTokens, rand: costOf({ input: run.inputTokens, output: run.outputTokens }) },
    rows: rows.map((row) => asActivityRow(row, names, latest.get(row.id) ?? null)),
    progressDates: dates,
  };
}

export interface SignedProgramme {
  runId: string;
  by: string;
  at: string;
  rows: ActivityRow[];
  progressDates: string[];
}

/** The signed baseline and its progress – what the cash flow, the cost report and a claim read. */
export async function loadSignedProgramme(projectId: string, module = "/programme"): Promise<SignedProgramme | null> {
  const [run] = await db
    .select({ id: runs.id, signedBy: runs.signedBy, signedAt: runs.signedAt })
    .from(runs)
    .where(and(eq(runs.projectId, projectId), eq(runs.module, module), isNotNull(runs.signedAt), isNull(runs.deletedAt)))
    .orderBy(desc(runs.signedAt))
    .limit(1);
  if (!run?.signedBy || !run.signedAt) return null;

  const names = await signerNames();
  const rows = await db
    .select()
    .from(programmeActivities)
    .where(and(eq(programmeActivities.runId, run.id), isNull(programmeActivities.omittedAt)))
    .orderBy(asc(programmeActivities.seq));
  const { latest, dates } = await latestProgress(rows.map((r) => r.id), names);

  return {
    runId: run.id,
    by: nameIn(names, run.signedBy),
    at: run.signedAt.toISOString(),
    rows: rows.map((row) => asActivityRow(row, names, latest.get(row.id) ?? null)),
    progressDates: dates,
  };
}

export async function nextActivitySeq(runId: string): Promise<number> {
  const [last] = await db
    .select({ seq: programmeActivities.seq })
    .from(programmeActivities)
    .where(eq(programmeActivities.runId, runId))
    .orderBy(desc(programmeActivities.seq))
    .limit(1);
  return (last?.seq ?? 0) + SEQ_STEP;
}
