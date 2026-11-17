/**
 * The construction programme as a run – D2.5. PLATFORM.md §1.3.1, §1.3.3, §6.3.
 *
 * ── The third shape of run ─────────────────────────────────────────────────────────────────
 *
 * A field run establishes named scalars; a bill run proposes priced rows; a programme run proposes
 * **dated rows** – activities with a start and a finish, read from the contractor's programme the
 * way bill items are read from a specification. The same three steps (retrieve, ask, check), the
 * same grounding, the same one signature. What the signature freezes here is the **baseline**:
 * the dates every later progress record and every extension of time is measured against.
 *
 * ── What is read, and what is not ──────────────────────────────────────────────────────────
 *
 * Only a programme: the contractor's, or the approved one. A cost report, a valuation and a site
 * meeting's minutes all mention dates beside activities and none of them is the programme – a
 * minute that says "brickwork now expected to finish 14 Sept" is progress, and progress is
 * recorded against the baseline, never read into it.
 */

import type { Citation } from "@/lib/agent/run";
import { streamNdjson } from "@/lib/agent/bill";

/** What the step reads: the kinds of document that are a programme. */
export interface ActivitySpec {
  /** What a row of this programme is, in the reader's words. */
  wants: string;
  /** The kinds that are a programme. Every passage of them is read. */
  programme: readonly string[];
}

export const ACTIVITY_SETS: Readonly<Record<string, ActivitySpec>> = {
  "/programme": {
    wants: "an activity of the works – what is to be done, when it starts and when it finishes – or a milestone with its date",
    programme: ["Construction programme", "Contractor's programme", "Approved programme", "Recovery programme"],
  },
};

/** Whether this module's run is activity-shaped. */
export const producesActivities = (module: string): boolean => module in ACTIVITY_SETS;
export const activitySpecFor = (module: string): ActivitySpec | undefined => ACTIVITY_SETS[module];

/** What the model proposed for one activity, once read and grounded. */
export interface ActivityResult {
  ref: string | null;
  name: string;
  /** ISO, or null where the document's date could not be read with certainty – see the text. */
  start: string | null;
  finish: string | null;
  startText: string | null;
  finishText: string | null;
  milestone: boolean;
  confidence: number;
  note: string | null;
  citation: Citation | null;
}

/** One activity as the grid and the summary read it – all three maps of §1.3.1. */
export interface ActivityRow {
  id: string;
  seq: number;
  ref: string | null;
  proposed: {
    name: string | null;
    start: string | null;
    finish: string | null;
    startText: string | null;
    finishText: string | null;
    milestone: boolean;
    confidence: number;
    note: string | null;
  };
  citation: Citation | null;
  override: {
    name: string | null;
    start: string | null;
    finish: string | null;
    milestone: boolean | null;
    by: string;
    at: string;
  } | null;
  /** Minor units as a decimal string, or null – "share the remainder", not nought. */
  value: string | null;
  /** The baseline. Null in a draft. */
  output: { name: string | null; start: string | null; finish: string | null; milestone: boolean } | null;
  omitted: { by: string; at: string } | null;
  /** The latest progress recorded against this activity, if any. */
  progress: ProgressRow | null;
}

export interface ProgressRow {
  id: string;
  asAt: string;
  start: string | null;
  finish: string | null;
  percent: number;
  note: string | null;
  by: string;
  at: string;
}

export interface PersistedProgramme {
  id: string;
  module: string;
  status: "running" | "review" | "failed";
  error: string | null;
  startedAt: string;
  lastWriteAt: string;
  signedBy: string | null;
  signedAt: string | null;
  spend: { input: number; output: number; rand: number | null } | null;
  rows: ActivityRow[];
  /** Every date progress has been recorded as at, latest first – the months the job was walked. */
  progressDates: string[];
}

/** The activity as it currently reads: override over proposal. */
export function workingActivity(row: ActivityRow): {
  name: string | null;
  start: string | null;
  finish: string | null;
  milestone: boolean;
} {
  return {
    name: row.override?.name ?? row.proposed.name,
    start: row.override?.start ?? row.proposed.start,
    finish: row.override?.finish ?? row.proposed.finish,
    milestone: row.override?.milestone ?? row.proposed.milestone,
  };
}

/** The cells a person may correct. */
export const ACTIVITY_CELLS = ["name", "start", "finish", "value"] as const;
export type ActivityCell = (typeof ACTIVITY_CELLS)[number];

export const ACTIVITY_CELL_LABEL: Readonly<Record<ActivityCell, string>> = {
  name: "Activity",
  start: "Start",
  finish: "Finish",
  value: "Value",
};

/** Rows that count: not struck out. */
export const liveActivities = (rows: readonly ActivityRow[]): ActivityRow[] => rows.filter((r) => r.omitted === null);

/**
 * What stops a programme being signed: an activity without both its dates. A baseline with a hole
 * in it cannot be slipped against, and a programme signed with "TBC" on the roof is a programme
 * that will be argued about.
 */
export function undatedActivities(rows: readonly ActivityRow[]): { name: string; missing: string }[] {
  return liveActivities(rows).flatMap((row) => {
    const working = workingActivity(row);
    const missing = [working.start === null ? "start" : null, working.finish === null ? "finish" : null].filter(
      (m): m is string => m !== null,
    );
    if (missing.length === 0) return [];
    return [{ name: working.name ?? "(unnamed activity)", missing: missing.join(" and ") }];
  });
}

export interface ProgrammeEvent {
  type: "activity" | "done" | "error";
  activity?: ActivityResult;
  error?: string;
  spend?: { input: number; output: number; rand: number | null };
  read?: number;
  discarded?: number;
  unread?: boolean;
}

export const streamProgramme = (projectId: string, module: string): AsyncGenerator<ProgrammeEvent> =>
  streamNdjson<ProgrammeEvent>(
    `/api/projects/${projectId}/runs?module=${encodeURIComponent(module)}`,
    (error) => ({ type: "error", error }),
  );
