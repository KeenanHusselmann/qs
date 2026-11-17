/**
 * Splitting a document into retrievable passages — PLATFORM.md §1.3.2, the split step.
 *
 * ── Overlapping windows, and why ───────────────────────────────────────────────────────────
 *
 * Taken from the proven engine, which covers a document with windows stepped by `size - overlap`
 * so that nothing falls between two passages. The failure it prevents is specific and quiet: a
 * sentence that straddles a boundary belongs to neither chunk, so the phrase that would have
 * satisfied a criterion is simply never found, and the platform reports a gap that is not there.
 *
 * The sizes differ from that engine's, deliberately. Its windows are ~14 000 characters because it
 * feeds them to an LLM for extraction. These are for **retrieval and citation** — what gets shown
 * to a QS as the passage a figure came from — and a 14 000-character citation is not a citation.
 */

import type { ParsedDocument } from "./parse";

/** ~1 200 characters is a long paragraph or two: enough to carry its own meaning, short enough to
 * read as a quotation beside a figure. */
const WINDOW = 1_200;

/** Generous relative to the window, because the cost of losing a straddling sentence is a false
 * "missing" and the cost of an overlap is a little duplication. */
const OVERLAP = 200;

export interface TextPassage {
  /** Position in the document, 0-based. Stable, so a citation can be re-resolved. */
  index: number;
  page?: number;
  text: string;
}

/**
 * The last position in `text` where `pattern` matches, or -1.
 *
 * `String.search` returns the *first* match, which is what this is here to correct. The patterns
 * below carried a `(?=[^]*$)` lookahead meant to pin them to the end of the window; it does not do
 * that — `[^]*$` matches from anywhere to the end, so the lookahead is always satisfied and the
 * first match is what came back.
 */
function lastMatch(text: string, pattern: RegExp): number {
  const scan = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
  let at = -1;
  for (let match = scan.exec(text); match !== null; match = scan.exec(text)) {
    at = match.index;
    if (match.index === scan.lastIndex) scan.lastIndex += 1; // a zero-width match cannot stall this
  }
  return at;
}

/**
 * Prefer to break at a paragraph, then a sentence, then a word — never mid-word.
 *
 * ── The cut this exists to prevent ─────────────────────────────────────────────────────────
 *
 * It did not do any of that. Because the first whitespace in a 1 200-character window is always
 * near its start, the "only take a break in the last third" guard rejected every candidate and the
 * function fell through to `to` — a hard cut at exactly 1 200 characters, mid-word, every time.
 *
 * A contractor's spreadsheet row is one long line with no blank lines in it, so a bill item was
 * split as `…establishing and confirming top-of-w` / `all (TOW) levels, foundation step levels…`,
 * and the drafting agent read the second half as an item of its own. It appeared in the bill as
 * "all (TOW) levels, foundation step levels and pier positions…" — a row a quantity surveyor is
 * asked to price, that begins in the middle of a word.
 */
function breakPoint(text: string, from: number, to: number): number {
  const window = text.slice(from, to);
  const earliest = (to - from) * 0.66;

  // A paragraph, then the end of a sentence, then any word gap. The last one in the window each
  // time, so the passage keeps as much as it can and still ends somewhere a reader would.
  for (const pattern of [/\n\n/, /(?<=[.!?])\s/, /\s/]) {
    const at = lastMatch(window, pattern);
    // Only take a break in the last third; earlier ones waste the window.
    if (at > earliest) return from + at;
  }
  return to;
}

/**
 * The start of the first whole word at or after `from`, giving up before `limit`.
 *
 * `limit` is where the previous passage ended: past that there is no overlap left to keep, and a
 * passage that began there would drop the words the overlap exists to carry. Where the stretch
 * holds no word gap at all — a single unbroken token — `from` stands, because a boundary inside
 * something with no words in it is the best available and losing text would be worse.
 */
function wordStart(text: string, from: number, limit: number): number {
  const gap = text.slice(from, limit).search(/\s/);
  return gap === -1 ? from : from + gap + 1;
}

/**
 * Split one page's text into overlapping windows.
 *
 * Pages are split independently so a passage never spans two pages — a citation that claimed
 * p.4 while quoting text from p.5 would be worse than no page at all.
 */
function splitPage(text: string, page: number | undefined, startIndex: number): TextPassage[] {
  if (text.length <= WINDOW) {
    return text.trim() ? [{ index: startIndex, page, text: text.trim() }] : [];
  }

  const passages: TextPassage[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const hardEnd = Math.min(cursor + WINDOW, text.length);
    const end = hardEnd === text.length ? hardEnd : breakPoint(text, cursor, hardEnd);
    const slice = text.slice(cursor, end).trim();

    if (slice) passages.push({ index: startIndex + passages.length, page, text: slice });

    if (end >= text.length) break;

    /*
      The overlap: step back so a sentence spanning the boundary appears whole in the next passage
      — then forward to the next word gap, so the passage does not *begin* mid-word.

      Both halves matter and only the first was here. Fixing the end of a passage without fixing
      its start leaves the same fragment arriving from the other direction: the step back lands
      200 characters earlier at whatever character is there, and a bill item beginning
      "all (TOW) levels…" reads exactly the same to a drafting agent whichever cut produced it.
    */
    const back = Math.max(end - OVERLAP, cursor + 1);
    cursor = wordStart(text, back, end);
  }

  return passages;
}

export function splitIntoPassages(parsed: ParsedDocument): TextPassage[] {
  const passages: TextPassage[] = [];

  for (const page of parsed.pages) {
    passages.push(...splitPage(page.text, page.page, passages.length));
  }

  return passages;
}
