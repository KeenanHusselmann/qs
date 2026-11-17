"use server";

/**
 * What the import agent thinks of a project's corpus — PLATFORM.md §1.1.
 *
 * ── It reads; it does not act ──────────────────────────────────────────────────────────────
 *
 * Everything here returns proposals. Withdrawing a document is `removeDocument`, called by a person
 * clicking a button, and that separation is the whole design: the corpus is evidence, and an agent
 * that quietly dropped the copy which turned out to be the signed one would be worse than no agent.
 *
 * The measurements are taken at ingest (`geometry.ts`) rather than here, because counting a
 * drawing's operators costs seconds and this runs on every page load.
 */

import { and, eq, isNull, sql } from "drizzle-orm";

import { requireSession } from "@/lib/auth";
import { db } from "@/db/client";
import { documents, passages } from "@/db/schema";
import { isSpatial } from "@/lib/ingest/document-class";
import { judge, type DocumentSignals, type Judgement } from "@/lib/ingest/import-agent";

export interface ReviewedDocument {
  id: string;
  filename: string;
  sourcePath: string | null;
  kind: string;
  judgement: Judgement;
}

/**
 * Judge everything filed on a project.
 *
 * Text length and page count come from `passages` rather than from columns of their own: they are
 * already derivable, and a stored copy of a derived number is a number that can disagree with the
 * thing it was derived from.
 */
export async function reviewCorpus(projectId: string): Promise<ReviewedDocument[]> {
  await requireSession();

  const rows = await db
    .select({
      id: documents.id,
      filename: documents.filename,
      sourcePath: documents.sourcePath,
      kind: documents.kind,
      drawingOps: documents.drawingOps,
      textFingerprint: documents.textFingerprint,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(and(eq(documents.projectId, projectId), isNull(documents.deletedAt)))
    .orderBy(documents.createdAt);

  /**
   * How much text each document yielded, as its own grouped query.
   *
   * It was a correlated subquery — `where passages.document_id = documents.id` — and Drizzle
   * rendered both sides **unqualified**:
   *
   *     select sum(length("body")) from "passages" where "document_id" = "id"
   *
   * Inside that subquery both names resolve to `passages`, so the condition was
   * `passages.document_id = passages.id`: never true, sum NULL, coalesced to zero. No error, no
   * warning — just every document reported as having no text, and an agent telling a QS that a
   * market study it had read perfectly well "could not be read and may need OCR".
   *
   * Grouped, every column belongs to one table, so there is nothing left to qualify wrongly.
   */
  const measured = await db
    .select({
      documentId: passages.documentId,
      characters: sql<number>`sum(length(${passages.body}))::int`,
      pages: sql<number>`count(distinct ${passages.page})::int`,
    })
    .from(passages)
    // Scoped to the project in the query, like every other read of this table (§1.3.2).
    .where(eq(passages.projectId, projectId))
    .groupBy(passages.documentId);

  const text = new Map(measured.map((m) => [m.documentId, m]));

  const signals: DocumentSignals[] = rows.map((row) => ({
    id: row.id,
    filename: row.filename,
    kind: row.kind,
    spatial: isSpatial(row.kind),
    // A document with no passages at all has no row here, and zero is the right answer for it.
    pages: text.get(row.id)?.pages ?? 0,
    characters: text.get(row.id)?.characters ?? 0,
    operations: row.drawingOps,
    filedAt: row.createdAt,
  }));

  // Documents saying exactly the same thing, grouped by their fingerprint. Null fingerprints — text
  // too short for sameness to mean anything — are left out rather than grouped together.
  const identical = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.textFingerprint) continue;
    identical.set(row.textFingerprint, [...(identical.get(row.textFingerprint) ?? []), row.id]);
  }

  const judgements = judge(signals, [...identical.values()]);
  const byId = new Map(judgements.map((j) => [j.id, j]));

  return rows.map((row) => ({
    id: row.id,
    filename: row.filename,
    sourcePath: row.sourcePath,
    kind: row.kind,
    judgement: byId.get(row.id)!,
  }));
}
