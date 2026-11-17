/**
 * The advisor's memory – what it found on the web, recalled for later questions.
 *
 * ── The problem ────────────────────────────────────────────────────────────────────────────
 *
 * A reader searched the web for cement prices, turned web search off, and asked again later. The
 * advisor had no record it had ever looked. Now a web finding is saved as a note (migration 0023),
 * the notes are searched on every ordinary question, and the ones that bear on it are given to the
 * model with their dates and sources.
 *
 * ── A remembered figure is still a web figure ──────────────────────────────────────────────
 *
 * A price recalled from a note is exactly as indicative as the day it was found, and older. So a
 * note is never folded into the answer anonymously: the model names the notes it used, and the
 * panel shows each one under the answer as "from a web search on <date>", with its pages. A note the
 * model used without naming – its figures turn up in the answer – is shown all the same, because the
 * figure's provenance is not the model's to leave out.
 *
 * Pure: no database. `lib/memory/notes.ts` stores and searches; this decides what a note says and
 * which notes an answer rests on, and is tested against fixed text.
 */

import type { WebAnswer, WebSource, WebStructured } from "@/lib/agent/search";
import { fence } from "@/lib/egress/fence";

/** A note given to the model for one question, under a code it can cite. */
export interface RecalledNote {
  /** "M1", "M2" – the model cites these, as it cites passages by number. */
  code: string;
  id: string;
  kind: "web";
  question: string;
  title: string;
  /** ISO timestamp of when it was found. */
  savedAt: string;
  structured: WebStructured | null;
  /** The markdown the model read. */
  body: string;
  sources: WebSource[];
}

/** At most this many notes per question: enough to answer from, few enough to be read. */
export const MAX_RECALLED = 3;
/** A long note is cut for the prompt. The panel still shows the whole of it. */
const MAX_NOTE_CHARS = 1_800;
const MAX_TITLE_CHARS = 90;

/**
 * The question as a key: asking the same thing twice refreshes one note instead of adding another.
 * Case, punctuation and spacing do not make a different question.
 */
export function questionKey(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * How many of the question's words a note must share to be recalled.
 *
 * One for a short question – "cement cost" is two words, and a reader typing that is asking about
 * cement – and two for a longer one, where one shared word is a coincidence.
 */
export function wordsNeeded(count: number): number {
  return count <= 3 ? Math.min(1, count) : 2;
}

/** The markdown table for a structured answer's table. Pipes inside a cell are escaped. */
function markdownTable(table: NonNullable<WebStructured["table"]>): string {
  const cell = (text: string) => text.replace(/\|/g, "\\|");
  return [
    table.title ? `**${table.title}**\n` : "",
    `| ${table.columns.map(cell).join(" | ")} |`,
    `| ${table.columns.map(() => "---").join(" | ")} |`,
    ...table.rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ]
    .filter(Boolean)
    .join("\n");
}

/** A web finding as a note: its title, and the markdown that is indexed and read back. */
export function webNote(question: string, found: Pick<WebAnswer, "structured" | "text" | "sources">): {
  title: string;
  body: string;
} {
  const shaped = found.structured;
  const summary = shaped?.summary ?? found.text;
  const firstSentence = summary.split(/(?<=[.!?])\s/)[0] ?? summary;
  const title = (question.length <= MAX_TITLE_CHARS ? question : firstSentence).slice(0, MAX_TITLE_CHARS).trim();

  const body = [
    `# ${question.trim()}`,
    shaped
      ? [
          shaped.summary,
          shaped.points.map((point) => `- ${point}`).join("\n"),
          shaped.table ? markdownTable(shaped.table) : "",
          shaped.caveat ? `> ${shaped.caveat}` : "",
        ]
          .filter(Boolean)
          .join("\n\n")
      : found.text,
    found.sources.length > 0
      ? `## Sources\n${found.sources.map((s, i) => `${i + 1}. [${s.title}](${s.url})`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return { title, body };
}

const dateOf = (iso: string) =>
  new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });

/** The notes, for the prompt. Empty when there are none, so the prompt says nothing about memory. */
export function memoryText(notes: readonly RecalledNote[]): string {
  if (notes.length === 0) return "";

  return `SAVED NOTES – what this practice found on the web for earlier questions. Each is dated. A web figure is indicative: found online, not verified by the practice, and older than it looks.
${notes
  .map(
    // Fenced: a note is a web page's words, and a page can be written to steer whoever reads it.
    (note) =>
      fence(
        `[${note.code}] Web search on ${dateOf(note.savedAt)}`,
        `${note.body.slice(0, MAX_NOTE_CHARS)}${note.body.length > MAX_NOTE_CHARS ? "\n…" : ""}`,
      ),
  )
  .join("\n\n")}

USING SAVED NOTES:
- If a note answers the question, answer from it in PART 2: give its findings (its prices and rates too), say they come from an earlier web search on its date, and that they are indicative.
- Put the codes of the notes you used in "memory", e.g. ["M1"]. [] if none relate. Never use a note that is about something else.
- Where a note is more than a few months old and prices matter, say the reader should search again.`;
}

/** Numbers of two digits or more, as digit strings – the same reading `figuresIn` gives a passage. */
function numbersIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(/\d[\d\s,.]*\d/g)) {
    const digits = match[0].replace(/[\s,.]/g, "");
    if (digits.length >= 2) found.add(digits);
  }
  return found;
}

/**
 * The notes an answer rests on: the ones the model named, and any whose figures the answer repeats.
 *
 * A code the model invented is ignored. A note it used without naming is caught by its numbers – a
 * figure from a web note that reaches the panel without the note beside it is a figure with no page
 * and no date, which is the one thing the memory must not produce.
 */
export function notesUsed(raw: unknown, notes: readonly RecalledNote[], answerText: string): RecalledNote[] {
  const named = new Set(
    (Array.isArray(raw) ? raw : []).filter((code): code is string => typeof code === "string").map((c) => c.trim()),
  );
  const said = numbersIn(answerText);

  // Three digits or more, and not a year: "2024" in a note and in an answer is a coincidence of
  // dates, not a figure carried across.
  const telling = (figure: string) => figure.length >= 3 && !/^(19|20)\d\d$/.test(figure);

  return notes.filter(
    (note) => named.has(note.code) || [...numbersIn(note.body)].some((figure) => telling(figure) && said.has(figure)),
  );
}
