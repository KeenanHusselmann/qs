/**
 * Reading filed documents against the requirements their kind answers, and keeping the answer.
 *
 * `lib/agent/coverage.ts` asks the question; this decides when to ask it and stores the result in
 * `document_coverage` for `criteria-grounding.ts` to read on every render without a model call.
 *
 * ── Two entry points ───────────────────────────────────────────────────────────────────────
 *
 * `assessDocument` runs at filing time, so a document filed against a requirement is judged before
 * the page that filed it refreshes. `assessProject` catches everything filed before this existed,
 * and anything a model outage left unjudged: it asks only about documents with no stored answer,
 * so calling it after every module render costs nothing once a project is judged.
 *
 * ── An outage is not a "no" ────────────────────────────────────────────────────────────────
 *
 * A failed call stores nothing. The requirement stays `uncertain`, exactly as it would have been
 * before, and the next filing or render asks again. Storing `covered = false` for a question that
 * was never answered would block a step on a document nobody read.
 */

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { documentCoverage, documents, passages } from "@/db/schema";
import { assessCoverage } from "@/lib/agent/coverage";
import { ModelUnavailable } from "@/lib/agent/deepseek";
import { DEFAULT_CRITERIA } from "@/lib/entry-criteria";
import { isSpatial } from "@/lib/ingest/document-class";
import { phrasesFor } from "@/lib/ingest/retrieve";
import { enterEgressScope } from "@/lib/egress/scope";

/** How many model calls one render may pay for. The rest are judged on the next. */
const PER_PROJECT_PASS = 4;

/** Whether any of a document's passages contains one of the phrases — the free check, first. */
async function matchesPhrases(documentId: string, phrases: readonly string[]): Promise<boolean> {
  if (phrases.length === 0) return false;
  const query = phrases.map((phrase) => `"${phrase.replace(/"/g, "")}"`).join(" or ");

  const [hit] = await db
    .select({ one: sql<number>`1` })
    .from(passages)
    .where(
      and(
        eq(passages.documentId, documentId),
        sql`search @@ websearch_to_tsquery('english', ${query})`,
      ),
    )
    .limit(1);

  return Boolean(hit);
}

/**
 * Judge one document against every requirement its kind answers, where the phrases did not match.
 *
 * Returns how many questions were answered, for the caller's own reporting. Never throws for a
 * model outage — see the header.
 */
export async function assessDocument(
  documentId: string,
  kind: string,
  /** The most model calls this may make. Filing passes none: every requirement is judged. */
  budget = Infinity,
): Promise<number> {
  if (isSpatial(kind)) return 0;

  const criteria = DEFAULT_CRITERIA.filter((c) => c.acceptedEvidence.includes(kind));
  if (criteria.length === 0) return 0;

  const [text, known] = await Promise.all([
    db
      .select({ documentId: passages.documentId, page: passages.page, body: passages.body })
      .from(passages)
      .where(eq(passages.documentId, documentId))
      .orderBy(asc(passages.seq))
      .limit(10),
    db
      .select({ criterionId: documentCoverage.criterionId })
      .from(documentCoverage)
      .where(eq(documentCoverage.documentId, documentId)),
  ]);

  // Nothing readable — a scan. Grounding already says so; there is nothing for a model to read.
  if (text.length === 0) return 0;

  const answered = new Set(known.map((row) => row.criterionId));
  let asked = 0;

  for (const criterion of criteria) {
    if (asked >= budget) break;
    if (answered.has(criterion.id)) continue;
    if (await matchesPhrases(documentId, phrasesFor(criterion))) continue;

    try {
      const result = await assessCoverage(criterion, text);
      await db
        .insert(documentCoverage)
        .values({
          documentId,
          criterionId: criterion.id,
          covered: result.covered,
          quote: result.quote,
          page: result.page,
        })
        // Two renders judging the same document at once is harmless; the first answer stands.
        .onConflictDoNothing();
      asked += 1;
    } catch (error) {
      if (error instanceof ModelUnavailable) {
        console.warn(`Coverage for ${criterion.id} on ${documentId} not judged: ${error.message}`);
        continue;
      }
      throw error;
    }
  }

  return asked;
}

/**
 * Judge the documents on a project that have no stored answer yet, a few at a time.
 *
 * Meant for `after()`: it runs once the page has been sent, so a reader never waits on it, and the
 * next render reads what it stored.
 */
export async function assessProject(projectId: string): Promise<void> {
  // Runs in `after()`, past the request: name the project for the egress ledger (ARC-005).
  enterEgressScope({ projectId, actor: null });
  const filed = await db
    .select({ id: documents.id, kind: documents.kind })
    .from(documents)
    .where(and(eq(documents.projectId, projectId), isNull(documents.deletedAt)));

  // Every readable document of a kind some requirement accepts. `assessDocument` skips what is
  // already answered per requirement, so a document an outage left half-judged is finished here.
  const pending = filed.filter(
    (d) => !isSpatial(d.kind) && DEFAULT_CRITERIA.some((c) => c.acceptedEvidence.includes(d.kind)),
  );

  /*
    A budget of model calls, not a count of documents. A document whose phrases already match stores
    no row and so looks unjudged on every pass; slicing the first few documents let those crowd out
    the ones that actually needed reading. Walking them costs a few indexed queries.
  */
  let budget = PER_PROJECT_PASS;
  for (const document of pending) {
    if (budget <= 0) break;
    budget -= await assessDocument(document.id, document.kind, budget);
  }
}

/** Stored answers for a set of documents, for grounding to read. */
export async function coverageOf(documentIds: readonly string[]) {
  if (documentIds.length === 0) return [];
  return db
    .select()
    .from(documentCoverage)
    .where(and(inArray(documentCoverage.documentId, [...documentIds]), eq(documentCoverage.covered, true)));
}
