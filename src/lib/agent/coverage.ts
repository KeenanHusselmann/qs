/**
 * Does this document cover that requirement — read, not phrase-matched. PLATFORM.md §1.3.2, §1.3.3.
 *
 * ── Why a model, and why only here ─────────────────────────────────────────────────────────
 *
 * `criteria-grounding.ts` meets a requirement when a document of an accepted kind contains one of
 * its phrases. That is instant and free and right most of the time, and it fails exactly where a
 * tester's documents failed: a sales outlook filed as a Market study, stating the absorption rate and
 * the selling price, never used the words "market study", so the Feasibility Estimate would not
 * start. This is the semantic half `retrieve.ts` has always said was missing.
 *
 * It is asked only when the phrases did not match, only for a document of a kind the requirement
 * accepts, and once per document — the answer is stored (`document_coverage`).
 *
 * ── The same rule as extraction: a quote, located ──────────────────────────────────────────
 *
 * The model's "yes" is not believed on its own. It must quote the document, and `locateQuote` must
 * find that quote in the passages it was given. A yes with no locatable quote is recorded as not
 * covered, so a document is never ticked off on the model's say-so.
 *
 * No database here, so it is testable against a table of passages.
 */

import type { Criterion } from "@/lib/entry-criteria";
import { askForJson, type Usage } from "@/lib/agent/deepseek";
import { fence } from "@/lib/egress/fence";
import { locateQuote, type Passage } from "@/lib/agent/grounding";

/** Enough of a document to judge it; a covering document says so early. */
const MAX_PASSAGES = 10;
const MAX_PASSAGE_CHARS = 1_400;

const SYSTEM = `You check whether a document filed on a South African construction project provides what one project requirement asks for.

Documents are written in their authors' own words, not in the wording of the requirement. A "sales outlook" stating an absorption rate and selling prices provides market data. A "development overview" stating the unit count and site provides the project brief. Judge what the document says, not what it is called.

Rules:
1. covered=true only if the document actually provides the substance the requirement describes. A passing mention is not enough: a cost plan that says "the programme is still to be confirmed" does not provide a project programme.
2. When covered, quote VERBATIM the one sentence or line that best shows it — copied character for character from one passage.
3. When not covered, quote null.

Reply as json: {"covered": true|false, "quote": string|null}`;

export interface CoverageResult {
  covered: boolean;
  quote: string | null;
  page: number | null;
  usage: Usage;
}

export function coveragePrompt(criterion: Criterion, passages: readonly Passage[]): string {
  const numbered = passages
    .slice(0, MAX_PASSAGES)
    .map((p, i) => fence(`passage [${i + 1}]`, p.body.slice(0, MAX_PASSAGE_CHARS)))
    .join("\n\n");

  return [
    `Requirement: ${criterion.label}`,
    `What it is for: ${criterion.detail}`,
    `Documents that would normally provide it: ${criterion.acceptedEvidence.join(", ")}`,
    "",
    "The document:",
    "",
    numbered,
  ].join("\n");
}

/** The model's answer, held to the quote rule. */
export function readCoverage(json: unknown, passages: readonly Passage[], usage: Usage): CoverageResult {
  const reply = (json ?? {}) as Record<string, unknown>;
  const quote = typeof reply.quote === "string" ? reply.quote.trim() : "";

  if (reply.covered !== true || quote.length === 0) {
    return { covered: false, quote: null, page: null, usage };
  }

  const located = locateQuote(quote, passages.slice(0, MAX_PASSAGES));
  if (!located) return { covered: false, quote: null, page: null, usage };

  return { covered: true, quote: located.quote, page: located.passage.page, usage };
}

/** Throws `ModelUnavailable` on an outage — the caller decides that is not a "no". */
export async function assessCoverage(
  criterion: Criterion,
  passages: readonly Passage[],
  signal?: AbortSignal,
): Promise<CoverageResult> {
  if (passages.length === 0) {
    return { covered: false, quote: null, page: null, usage: { input: 0, output: 0 } };
  }

  const { json, usage } = await askForJson({ purpose: "criteria.coverage",
    system: SYSTEM,
    user: coveragePrompt(criterion, passages),
    maxTokens: 250,
    signal,
  });

  return readCoverage(json, passages, usage);
}
