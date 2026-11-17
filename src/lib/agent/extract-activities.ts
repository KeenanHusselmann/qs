/**
 * Reading a programme's activities out of the contractor's programme – D2.5.
 *
 * ── The same three steps as `extract-items.ts`, with dates where the bill has money ────────
 *
 * Retrieve, ask, **check**. The model is shown the programme's passages and asked for the
 * activities they list; every row's quote is located in the passages it was given, and a row
 * that cannot be grounded is discarded and counted. The dates then cross `readDate`, which
 * **refuses rather than guesses**: `08/12/2026` read the wrong way round is four months of
 * liquidated damages, and a refusal leaves the document's own words beside an empty cell for
 * the person to settle.
 *
 * A programme printed from MS Project or Candy lists an ID, a name, a duration, a start and a
 * finish per line; a hand-drawn bar chart lists names against weeks. The first reads; the second
 * comes back as names with "wk 12" in the date text, which is exactly what the reader should see.
 */

import { isSpatial } from "@/lib/ingest/document-class";
import { locateQuote } from "@/lib/agent/grounding";
import { askForJson, type Usage } from "@/lib/agent/deepseek";
import { fence } from "@/lib/egress/fence";
import type { SourcePassage } from "@/lib/agent/extract";
import type { ActivityResult, ActivitySpec } from "@/lib/agent/programme";
import { readDate } from "@/domain/date-reading";

const CONFIDENT = 0.75;
const MAX_ACTIVITIES = 40;
const MAX_PASSAGE_CHARS = 1_400;

const SYSTEM = `You are a construction project manager's assistant reading a contractor's programme of works.

You are given numbered passages from ONE project's programme and asked for the activities they list. Rules, in order of importance:

1. Answer only from the passages given. You have no other knowledge of this project.
2. Quote VERBATIM. Each activity's "quote" must be copied character for character from one passage – the activity's line as the passage prints it, with its dates if they follow. Do not tidy it, do not paraphrase. An activity whose quote is not in the passages is discarded.
3. List EVERY activity in the passages, in the order they appear – every trade, every section, every milestone. Never summarise, never stop early, never merge two activities into one.
4. A passage can start or end part-way through a line. Skip an activity whose name or dates are cut off at the very start or end of a passage; the neighbouring passage carries it whole.
5. NOT activities: column headings ("Task Name", "Start", "Finish", "Duration"), the project title line, page numbers, legends, and summary bars that merely group the activities under them ("Substructure" with children listed beneath it is a heading – return its children, not it – unless it carries its own dates and no children).
6. NEVER invent a date. Copy "start" and "finish" EXACTLY as the document prints them – "Mon 12/08/26", "12 Aug 2026", "wk 14" – and where a date is not printed, null. Never convert a duration into a finish date.
7. A milestone is a line with one date, or a duration of 0 days, or named as one ("Practical completion", "Site handover"): "milestone": true and "finish" the same as "start".
8. "ref" is the activity's own number or ID as printed ("1.2", "14"), or null.
9. A passage that lists no activities returns none. An empty list is a correct answer.

Reply with json in exactly this shape:
{"activities": [{"ref": string|null, "name": string, "start": string|null, "finish": string|null, "milestone": boolean, "quote": string, "confidence": 0.0-1.0}]}`;

function prompt(spec: ActivitySpec, passages: readonly SourcePassage[]): string {
  const numbered = passages.map((p, i) => fence(`passage [${i + 1}]`, p.body.slice(0, MAX_PASSAGE_CHARS))).join("\n\n");
  return `Each activity wanted is ${spec.wants}.
Return at most ${MAX_ACTIVITIES} activities from these passages.

Passages:

${numbered}`;
}

interface RawActivity {
  ref: string | null;
  name: string;
  start: string | null;
  finish: string | null;
  milestone: boolean;
  quote: string;
  confidence: number;
}

const asText = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

function readReply(json: unknown): RawActivity[] | null {
  if (typeof json !== "object" || json === null) return null;
  const activities = (json as { activities?: unknown }).activities;
  if (!Array.isArray(activities)) return null;

  return activities.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const row = entry as Record<string, unknown>;
    const name = asText(row.name);
    const quote = asText(row.quote);
    if (!name || !quote) return [];
    const confidence = Number(row.confidence);
    return [
      {
        ref: asText(row.ref),
        name,
        start: asText(row.start),
        finish: asText(row.finish),
        milestone: row.milestone === true,
        quote,
        confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
      },
    ];
  });
}

export interface ActivityExtraction {
  activities: ActivityResult[];
  discarded: number;
  usage: Usage;
}

/**
 * A raw row, checked: the dates read where they can be, kept as text where they cannot, and the
 * reasons said in the note. Exported for the test – no model is needed to prove what a row becomes.
 */
export function readActivity(raw: RawActivity, citation: ActivityResult["citation"]): ActivityResult {
  const start = raw.start === null ? null : readDate(raw.start);
  const finish = raw.finish === null ? null : readDate(raw.finish);

  // A milestone printed with one date has that date at both ends.
  const startDate = start?.ok ? start.date : null;
  const finishDate = finish?.ok ? finish.date : raw.milestone && startDate ? startDate : null;
  const startResolved = startDate ?? (raw.milestone && finishDate ? finishDate : null);

  const notes = [
    start && !start.ok ? `Start not read — ${start.reason}` : null,
    finish && !finish.ok ? `Finish not read — ${finish.reason}` : null,
    startResolved && finishDate && finishDate < startResolved
      ? `Finishes before it starts as printed (${raw.start} → ${raw.finish}) — both dates are left for you to check.`
      : null,
    raw.confidence >= CONFIDENT ? null : "The passage was found but does not state this plainly. Check it before signing.",
  ].filter((n): n is string => n !== null);

  const ordered = !(startResolved && finishDate && finishDate < startResolved);

  return {
    ref: raw.ref,
    name: raw.name,
    start: ordered ? startResolved : null,
    finish: ordered ? finishDate : null,
    startText: raw.start,
    finishText: raw.finish,
    milestone: raw.milestone,
    confidence: raw.confidence,
    note: notes.length > 0 ? notes.join(" · ") : null,
    citation,
  };
}

export async function extractActivities(
  spec: ActivitySpec,
  retrieved: readonly SourcePassage[],
  signal?: AbortSignal,
): Promise<ActivityExtraction> {
  const passages = retrieved.filter((p) => !isSpatial(p.documentKind));
  if (passages.length === 0) return { activities: [], discarded: 0, usage: { input: 0, output: 0 } };

  const { json, usage } = await askForJson({ purpose: "programme.extract",
    system: SYSTEM,
    user: prompt(spec, passages),
    maxTokens: 4_000,
    signal,
  });

  const reply = readReply(json);
  if (!reply) return { activities: [], discarded: 0, usage };

  const activities: ActivityResult[] = [];
  let discarded = 0;

  for (const raw of reply.slice(0, MAX_ACTIVITIES)) {
    const grounded = locateQuote(raw.quote, passages);
    if (!grounded) {
      discarded += 1;
      continue;
    }
    const source = passages.find((p) => p.documentId === grounded.passage.documentId)!;
    activities.push(
      readActivity(raw, {
        documentId: source.documentId,
        document: source.documentName,
        page: source.page ?? undefined,
        quote: grounded.quote,
      }),
    );
  }

  return { activities, discarded, usage };
}

/**
 * The same activity twice – neighbouring passages overlap. Keyed on ref where there is one, else on
 * the folded name with the dates as printed; the first reading wins.
 */
export function withoutDuplicateActivities(rows: readonly ActivityResult[]): ActivityResult[] {
  const fold = (text: string | null) => (text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.ref ? `ref:${fold(row.ref)}|${fold(row.name)}` : `${fold(row.name)}|${fold(row.startText)}|${fold(row.finishText)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function freshActivities(earlier: readonly ActivityResult[], batch: readonly ActivityResult[]): ActivityResult[] {
  const kept = new Set(withoutDuplicateActivities([...earlier, ...batch]));
  return batch.filter((row) => kept.has(row));
}
