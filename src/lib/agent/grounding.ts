/**
 * Proving a quotation came from the corpus — PLATFORM.md §1.3.2.
 *
 * ── The one guarantee worth having ─────────────────────────────────────────────────────────
 *
 * A model asked for a figure and a supporting quote will, sometimes, produce a fluent quote that
 * appears in no document. Nothing about the answer looks wrong: the value is plausible, the
 * sentence reads like a market study, and the citation names a real filed document. It is the most
 * dangerous output this platform can produce, because §1.3.2's whole promise is that a number can
 * be defended in a valuation meeting by opening the page it came from.
 *
 * So the quote is not taken on trust. It is **located** in the passages the model was given, by
 * string matching, here, in code that has no opinion and cannot be persuaded. A value whose quote
 * cannot be found is not reported as a finding — see `extract.ts`, which says so in as many words
 * rather than quietly downgrading it.
 *
 * ── And the citation comes from our side of the wire ───────────────────────────────────────
 *
 * The model is never asked which document a passage came from, and could not be believed if it
 * were. The document and page are read off the passage the quote was *found* in, so a citation
 * cannot point at the wrong document even if the model claims otherwise. The displayed quote is
 * the span from that passage — the document's own characters, not the model's retyping of them.
 *
 * ── Why matching is lenient about form and strict about words ──────────────────────────────
 *
 * A quote pulled out of a PDF arrives with the line breaks, double spaces and typographic quotes
 * the extractor produced, and a model reliably tidies those. Rejecting `R12 500` because the
 * document says `R12  500` would fail honest quotes and teach everyone to ignore the check.
 * Whitespace, case and the curly/straight punctuation pairs are normalised away; **words are not**.
 * A quote that says anything the document does not is rejected.
 */

/** Typographic characters a model tidies without changing meaning. */
const EQUIVALENT: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "‚": "'",
  "“": '"',
  "”": '"',
  "„": '"',
  "–": "-",
  "—": "-",
  "−": "-",
  " ": " ",
  "…": "...",
};

/** Invisible characters that survive PDF extraction and match nothing a model types. */
const INVISIBLE = /[​-‍﻿­]/;

export interface Normalised {
  text: string;
  /** For each character of `text`, where it came from in the original. */
  origin: number[];
}

/**
 * Fold away the differences that are not differences, keeping a map back to the original.
 *
 * The map is the point. Without it the best this could report is *that* a quote matched; with it,
 * the exact characters of the document can be shown, which is what a citation is.
 */
export function normalise(source: string): Normalised {
  let text = "";
  const origin: number[] = [];
  /** Where the pending run of whitespace began, or -1 when none is pending. */
  let spaceFrom = -1;

  for (let i = 0; i < source.length; i++) {
    const raw = source[i]!;
    if (INVISIBLE.test(raw)) continue;

    const mapped = EQUIVALENT[raw] ?? raw;

    if (/\s/.test(mapped)) {
      // Any run of whitespace becomes one space, and leading whitespace becomes nothing.
      if (text.length > 0 && spaceFrom === -1) spaceFrom = i;
      continue;
    }

    if (spaceFrom !== -1) {
      // The single space stands for the whole run, so it points at where the run began. Pointing
      // at the character after it would make a span starting on a space slice from the wrong
      // place, and the quote shown would be missing its own first word boundary.
      text += " ";
      origin.push(spaceFrom);
      spaceFrom = -1;
    }

    for (const char of mapped.toLowerCase()) {
      text += char;
      origin.push(i);
    }
  }

  return { text, origin };
}

export interface Passage {
  documentId: string;
  page: number | null;
  body: string;
}

export interface Grounded<P extends Passage> {
  passage: P;
  /** The document's own characters — never the model's retyping of them. */
  quote: string;
}

/**
 * Find a quote in the passages that were actually handed to the model.
 *
 * Returns null when it is not there, which is the answer that matters: it means the value has
 * nothing behind it, whatever the model said about its own confidence.
 */
export function locateQuote<P extends Passage>(
  quote: string,
  passages: readonly P[],
): Grounded<P> | null {
  const needle = normalise(quote);

  // A quote of one or two words proves nothing — "units", "erf" and "price" occur in every
  // document in the corpus, so matching one is not evidence that the *figure* came from there.
  if (needle.text.length < 12) return null;

  for (const passage of passages) {
    const haystack = normalise(passage.body);
    const at = haystack.text.indexOf(needle.text);
    if (at === -1) continue;

    // Back to the original characters, including whatever spacing the document really had.
    const from = haystack.origin[at]!;
    const last = haystack.origin[at + needle.text.length - 1]!;

    return { passage, quote: passage.body.slice(from, last + 1).trim() };
  }

  return null;
}
