/**
 * Reading one field out of the corpus — PLATFORM.md §1.3, §1.3.2.
 *
 * ── The shape of the thing ─────────────────────────────────────────────────────────────────
 *
 * Retrieve, then ask, then **check**. The model is shown a handful of passages from this project
 * and nothing else, and is asked for one figure and the sentence it came from. What comes back is
 * not believed: the quote is located in the passages that were sent (`grounding.ts`), and the
 * citation is built from the passage it was found in rather than from anything the model said.
 *
 * ── What `not_found` is allowed to mean ────────────────────────────────────────────────────
 *
 * Only ever "the corpus does not say". Never "the model was unreachable", never "the call timed
 * out". Those are outages, they throw, and the run turns them into a visible refusal. A cost model
 * filled from a run that quietly recorded absence for a question it failed to ask is the confident
 * wrong number this whole platform is arranged against.
 *
 * ── And a drawing is still not a document ──────────────────────────────────────────────────
 *
 * Spatial kinds are dropped before anything is sent. A site plan's text is its title block, and
 * "PROJECT LOCATION" stamped in a corner has already been measured on this corpus as enough to
 * satisfy a full-text search while containing no location at all. Feeding that to a model invites
 * it to read an extent out of a legend.
 */

import { isSpatial } from "@/lib/ingest/document-class";
import { locateQuote, type Passage as GroundingPassage } from "@/lib/agent/grounding";
import { askForJson, type Usage } from "@/lib/agent/deepseek";
import { fence } from "@/lib/egress/fence";
import type { FieldResult, FieldSpec } from "@/lib/agent/run";

/** A passage as the run has it: the retrieval columns, plus what document it belongs to. */
export interface SourcePassage extends GroundingPassage {
  documentId: string;
  documentName: string;
  documentKind: string;
  page: number | null;
  body: string;
}

/**
 * Below this a value is `uncertain` — shown, but marked as needing a person before anything
 * downstream reads it. It is not a probability and is not treated as one; it is the model's own
 * report of how clearly the passage answered the question, and it is only ever used to decide
 * whether to wave a flag.
 */
const CONFIDENT = 0.75;

const SYSTEM = `You are a quantity surveyor's assistant reading a project's own documents.

You are given numbered passages from one project and asked for ONE value. Rules, in order of importance:

1. Answer only from the passages given. You have no other knowledge of this project.
2. Quote VERBATIM. The "quote" must be copied character for character from one passage. Do not tidy it, do not join two sentences, do not paraphrase. A quote that is not in the passages is worse than no answer.
3. If the passages contain neither the value nor any part of it, say so with found=false. Do not estimate it, do not infer it from a similar project, do not offer a typical figure. A part that IS stated is found — see rule 6.
4. The value is the figure itself with its unit, as the document expresses it — "1 046", "R749 000", "±71–136 units per annum". Not a sentence about it.
5. Documents are written in their authors' words, not in the wording of the value wanted. "The site is 8.5 ha" states an extent; "construction is expected to take 18 months" states a programme duration; "12-15 units/month" is an absorption rate even when the value wanted is per year. Do not convert units — give the figure as written.
6. If the value wanted has parts and the passages state only some of them (an extent but no erf number), or state the components rather than the single figure (a size for each unit type but no average), return what IS stated, as written, with confidence at most 0.6 so a person checks it. Give EVERY component, labelled — "52 m² (two-bedroom); 68 m² (three-bedroom)", never just the first. That is a partial answer, not an estimate — never compute an average or a total yourself.

Reply with json in exactly this shape:
{"found": true|false, "value": string|null, "quote": string|null, "confidence": 0.0-1.0}`;

/** Enough context to answer from, small enough to keep the model's attention on it. */
const MAX_PASSAGES = 6;
const MAX_PASSAGE_CHARS = 1_400;

function prompt(field: FieldSpec, passages: readonly SourcePassage[]): string {
  const numbered = passages
    .map((p, i) => fence(`passage [${i + 1}]`, p.body.slice(0, MAX_PASSAGE_CHARS)))
    .join("\n\n");

  return `Value wanted: ${field.label}${field.unit ? ` (expressed in ${field.unit})` : ""}
It will be used for: ${field.feeds}

Passages:

${numbered}`;
}

/** What the model is contracted to return. Checked, never assumed. */
function readReply(json: unknown): {
  found: boolean;
  value: string | null;
  quote: string | null;
  confidence: number;
} | null {
  if (typeof json !== "object" || json === null) return null;
  const reply = json as Record<string, unknown>;

  const confidence = Number(reply.confidence);

  return {
    found: reply.found === true,
    value: typeof reply.value === "string" && reply.value.trim() ? reply.value.trim() : null,
    quote: typeof reply.quote === "string" && reply.quote.trim() ? reply.quote.trim() : null,
    // A missing or nonsense confidence is treated as no confidence rather than as certainty.
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
  };
}

export interface Extraction {
  result: FieldResult;
  usage: Usage;
}

const absent = (field: FieldSpec, note?: string): FieldResult => ({
  field,
  state: "not_found",
  value: null,
  citation: null,
  confidence: 0,
  note,
});

/**
 * Establish one field.
 *
 * Throws only for an outage (see `deepseek.ts`). Every other outcome — including the model
 * inventing a quote — is a result the reader gets to see.
 */
export async function extractField(
  field: FieldSpec,
  retrieved: readonly SourcePassage[],
  signal?: AbortSignal,
): Promise<Extraction> {
  const passages = retrieved.filter((p) => !isSpatial(p.documentKind)).slice(0, MAX_PASSAGES);

  // Nothing to read. Answered without spending a call, and it is the honest answer: retrieval
  // found no passage in this project's corpus that even mentions what the field is about.
  if (passages.length === 0) {
    return {
      result: absent(field, "No passage in the filed documents mentions this."),
      usage: { input: 0, output: 0 },
    };
  }

  const { json, usage } = await askForJson({ purpose: "extract.field",
    system: SYSTEM,
    user: prompt(field, passages),
    signal,
  });

  const reply = readReply(json);
  if (!reply) {
    return { result: absent(field, "The model's reply did not have the shape it was asked for."), usage };
  }

  /**
   * Read, and not there. A different fact from "nothing in the corpus is about this", and worth
   * separating: the reader who sees this has the right documents and is missing a figure, while the
   * reader above is missing a document. Observed on a real brief — it gives comparable sales in
   * adjacent schemes and never states an achievable selling price for this scheme, and the model
   * correctly declined to offer the one as the other.
   */
  if (!reply.found || !reply.value) {
    return {
      result: absent(field, "The passages that cover this do not state a figure for it."),
      usage,
    };
  }

  /**
   * The check that earns the rest of it.
   *
   * A value with no quote, or with a quote that is not in the passages the model was given, is not
   * grounded — and §1.3.2 does not allow asserting it. Said out loud rather than folded into a
   * plain `not_found`, because "the documents do not cover this" and "the agent made something up
   * and was caught" should not look identical to the person deciding what to go and find.
   */
  const grounded = reply.quote ? locateQuote(reply.quote, passages) : null;

  if (!grounded) {
    return {
      result: absent(
        field,
        reply.quote
          ? `A value was offered — ${reply.value} — with a quote that is not in the filed documents. Discarded.`
          : `A value was offered — ${reply.value} — with nothing quoted to support it. Discarded.`,
      ),
      usage,
    };
  }

  const source = passages.find((p) => p.documentId === grounded.passage.documentId)!;

  return {
    result: {
      field,
      state: reply.confidence >= CONFIDENT ? "found" : "uncertain",
      value: reply.value,
      citation: {
        documentId: source.documentId,
        document: source.documentName,
        page: source.page ?? undefined,
        // The document's characters, from the passage the quote was found in.
        quote: grounded.quote,
      },
      confidence: reply.confidence,
      note:
        reply.confidence >= CONFIDENT
          ? undefined
          : "The passage was found but does not state this plainly. Check it before anything downstream reads it.",
    },
    usage,
  };
}
