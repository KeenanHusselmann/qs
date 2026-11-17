/**
 * Finding the passage that satisfies a criterion — PLATFORM.md §1.3.2, the retrieve and ground
 * steps.
 *
 * ── What this is, and what it is not ───────────────────────────────────────────────────────
 *
 * This is the **lexical half** of hybrid retrieval, and for construction documents it is the half
 * that carries the most weight: a corpus dense with `SANS 1200`, `25 MPa/19mm` and `Erf 180` is
 * exactly where exact matching wins and embeddings blur. The semantic half — which finds
 * "waterproofing to substructure" when the document says "damp proofing below ground level" —
 * needs an embedding provider and lands with one.
 *
 * Until then, what is returned is honest about its own limits: a passage that matched, with the
 * terms it matched on, and no claim about whether the document *means* what the criterion needs.
 * §1.3.2: a value the agent cannot ground, it does not assert.
 */

import { and, eq, isNull, notInArray, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { documents, passages } from "@/db/schema";
import type { Criterion } from "@/lib/entry-criteria";

export interface Passage {
  chunkId: string;
  documentId: string;
  page: number | null;
  body: string;
  /** Postgres `ts_rank` — a relative score within this query, never a probability. */
  rank: number;
}

/**
 * Search phrases for a criterion.
 *
 * **Phrases, not words, and the difference is the whole reliability of this.** The first version
 * split each accepted phrase into its words and OR'd them, so "Project programme" became
 * `project or programme or draft or plan`. The word "project" is in virtually every construction
 * document, so nearly every criterion matched something and the platform reported a scheme ready
 * to start on the strength of a document that said nothing relevant. That is asserting what cannot
 * be grounded — the one thing §1.3.2 forbids.
 *
 * Built from what the criterion *accepts* rather than its label: "Market data" appears in no
 * document, while "market study" and "absorption analysis" do.
 */
export function phrasesFor(criterion: Criterion): string[] {
  // The document's own words first where the criterion supplies them, then the kinds it accepts.
  // See `Criterion.terms` for the contract that made the distinction necessary — a JBCC agreement
  // is filed under exactly the right kind and contains none of that kind's words.
  return [...(criterion.terms ?? []), ...criterion.acceptedEvidence]
    .map((phrase) => phrase.trim().toLowerCase())
    .filter((phrase) => phrase.length > 0)
    .filter((phrase, i, all) => all.indexOf(phrase) === i);
}

/** The words a phrase is made of, for locating it inside a passage when quoting. */
export const wordsOf = (phrases: readonly string[]): string[] =>
  phrases.flatMap((phrase) => phrase.split(/\s+/)).filter((w) => w.length > 3);

/**
 * The best passages in this project's corpus for a set of terms.
 *
 * **Scoped to one project, in the query.** §1.3.2 makes this a hard boundary rather than a prompt
 * instruction: a figure from another scheme surfacing in this one's cost plan is the failure that
 * would end trust in the platform.
 */
export async function search(
  projectId: string,
  phrases: readonly string[],
  limit = 3,
): Promise<Passage[]> {
  if (phrases.length === 0) return [];

  /**
   * Each phrase quoted, then OR'd.
   *
   * `websearch_to_tsquery` treats a quoted string as an adjacency requirement, so `"market study"`
   * matches only where those words appear together — while a document satisfying a criterion
   * rarely uses *every* accepted phrase, so the phrases themselves are alternatives.
   */
  const query = phrases.map((phrase) => `"${phrase.replace(/"/g, "")}"`).join(" or ");

  /**
   * `search` is a Postgres generated column, declared in migration 0002 rather than in the Drizzle
   * schema — the application never writes it, and describing it as a writable column would invite
   * exactly that. Referenced as raw SQL for the same reason.
   */
  const vector = sql`search`;
  const tsquery = sql`websearch_to_tsquery('english', ${query})`;

  const rows = await db
    .select({
      chunkId: passages.id,
      documentId: passages.documentId,
      page: passages.page,
      body: passages.body,
      rank: sql<number>`ts_rank(${vector}, ${tsquery})`,
    })
    .from(passages)
    /**
     * Joined so a withdrawn document's passages disappear with it.
     *
     * Without this, soft-deleting a document left its passages answering searches: a criterion went
     * on citing a document that had been removed, and a process stayed "ready" on the strength of
     * evidence nobody could open. Soft delete is supposed to preserve history, not keep a
     * retracted figure in circulation.
     */
    .innerJoin(documents, eq(documents.id, passages.documentId))
    .where(
      and(
        eq(passages.projectId, projectId),
        isNull(documents.deletedAt),
        sql`${vector} @@ ${tsquery}`,
      ),
    )
    .orderBy(sql`ts_rank(${vector}, ${tsquery}) desc`)
    .limit(limit);

  return rows;
}

/**
 * The significant words of a set of phrases, for a looser second pass.
 *
 * Letters and digits only, so nothing a person typed can reach the tsquery as syntax; three letters
 * or more, so "of" and "m2" do not match every passage.
 */
export function significantWords(phrases: readonly string[]): string[] {
  const words = phrases
    .flatMap((phrase) => phrase.toLowerCase().split(/[^\p{L}\p{N}]+/u))
    .filter((word) => word.length >= 3 && !LOOSE_NOISE.has(word));
  return [...new Set(words)];
}

/** Words present in the field vocabulary that carry no meaning on their own. */
const LOOSE_NOISE = new Set(["and", "the", "for", "per", "with", "from", "total", "number", "rate"]);

/**
 * Passages for *reading a figure*, rather than for deciding a criterion is met.
 *
 * ── Why this is looser than `search`, and why that is safe here ───────────────────────────
 *
 * `search` quotes each phrase, and `phrasesFor` records why that strictness is right for a gate: a
 * loose match there ticks a criterion off a document that merely used a word. Extraction is a
 * different question with its own guard. The model must quote the passage verbatim and
 * `locateQuote` checks that it did, so a passage that does not state the figure produces nothing,
 * while a passage that does is only found if it reaches the model at all.
 *
 * Phrase-only retrieval failed a tester's documents exactly that way. "The site is 8.5 ha" and
 * "Construction is expected to take 18 months" were filed and indexed, matched none of the fixed
 * phrases, and the run reported "No passage in the filed documents mentions this" for figures the
 * documents plainly stated. A QS writes in their own words, not the platform's vocabulary.
 *
 * So the phrase hits come first, as before, and a second pass on the phrases' individual words fills
 * the remaining slots, ranked by how many of those words each passage contains.
 */
export async function searchForExtraction(
  projectId: string,
  phrases: readonly string[],
  limit = 12,
): Promise<{ passages: Passage[]; exact: number }> {
  const exact = await search(projectId, phrases, limit);
  if (exact.length >= limit) return { passages: exact, exact: exact.length };

  const words = significantWords(phrases);
  if (words.length === 0) return { passages: exact, exact: exact.length };

  const vector = sql`search`;
  const tsquery = sql`websearch_to_tsquery('english', ${words.join(" or ")})`;
  const seen = exact.map((p) => p.chunkId);

  const loose = await db
    .select({
      chunkId: passages.id,
      documentId: passages.documentId,
      page: passages.page,
      body: passages.body,
      rank: sql<number>`ts_rank(${vector}, ${tsquery})`,
    })
    .from(passages)
    .innerJoin(documents, eq(documents.id, passages.documentId))
    .where(
      and(
        eq(passages.projectId, projectId),
        isNull(documents.deletedAt),
        sql`${vector} @@ ${tsquery}`,
        seen.length > 0 ? notInArray(passages.id, seen) : undefined,
      ),
    )
    .orderBy(sql`ts_rank(${vector}, ${tsquery}) desc`)
    .limit(limit - exact.length);

  return { passages: [...exact, ...loose], exact: exact.length };
}

/**
 * Trim a passage to something that reads as a citation.
 *
 * A 1 200-character chunk is a retrieval unit, not a quotation. This takes the sentence around the
 * strongest match so what a QS sees beside a figure is the line that justified it.
 */
export function excerpt(body: string, phrases: readonly string[], maxLength = 220): string {
  const lower = body.toLowerCase();

  /**
   * A whole phrase wins over any of its words, and that ordering matters.
   *
   * Searching both at once and taking the earliest position quoted the wrong line: "Market data"
   * cited a passage about unit counts, because "market" appears in "GAP market" earlier in the
   * document than the phrase "market study" it actually matched on. A citation that points at the
   * wrong sentence is worse than a short one — it is the reader's evidence, and it has to be the
   * line that justified the match.
   */
  const findFirst = (terms: readonly string[]) =>
    terms
      .map((term) => lower.indexOf(term))
      .filter((i) => i >= 0)
      .sort((a, b) => a - b)[0];

  const hit = findFirst(phrases) ?? findFirst(wordsOf(phrases));

  if (hit === undefined) return body.slice(0, maxLength).trim();

  // Widen to sentence boundaries where they are close, so the quote does not start mid-clause.
  const from = Math.max(0, body.lastIndexOf(". ", hit) + 1 || hit - maxLength / 2);
  const slice = body.slice(from, from + maxLength).trim();

  return (from > 0 ? "… " : "") + slice + (from + maxLength < body.length ? " …" : "");
}

/**
 * Every passage of the given documents, in reading order – for a bill, which is read, not searched.
 *
 * ── Why a bill cannot be retrieved like a field ─────────────────────────────────────────────
 *
 * A field is one fact, and the best few passages for its words are where it is. A bill is every
 * item in a document, and "the best few passages" is a sample of it: the bill run read the nine
 * passages that best matched a list of trade words, so a measured bill of four hundred items could
 * yield a few dozen rows, and six of the Ridgeview specification's twenty-two clauses – floor
 * finishes, ceilings and all four engineering services – were never shown to the model at all.
 *
 * Scoped to the project in the query like every other read here, and to documents still filed.
 */
export async function passagesOfDocuments(
  projectId: string,
  documentIds: readonly string[],
  limit: number,
): Promise<Passage[]> {
  if (documentIds.length === 0) return [];

  const rows = await db
    .select({ chunkId: passages.id, documentId: passages.documentId, page: passages.page, body: passages.body })
    .from(passages)
    .innerJoin(documents, eq(documents.id, passages.documentId))
    .where(
      and(
        eq(passages.projectId, projectId),
        isNull(documents.deletedAt),
        sql`${passages.documentId} in (${sql.join(documentIds.map((id) => sql`${id}`), sql`, `)})`,
      ),
    )
    // The order the documents were given in, then the order of the text inside each one.
    .orderBy(sql`array_position(array[${sql.join(documentIds.map((id) => sql`${id}::uuid`), sql`, `)}], ${passages.documentId})`, passages.seq)
    .limit(limit);

  return rows.map((row) => ({ ...row, rank: 0 }));
}
