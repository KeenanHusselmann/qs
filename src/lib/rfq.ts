/**
 * The Quotations step for one project – its RFQs, their responses, and the recommendation worked out
 * from them on every read (D1.3).
 *
 * The check of each response is stored when it is evaluated – it needs the document's text to
 * ground every figure – and the recommendation is recomputed from those checks each time, so a
 * response renamed, added or removed moves it without anyone pressing a button.
 */

import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db/client";
import { documents, rfqResponseDocuments, rfqResponses, rfqs } from "@/db/schema";
import { recommend, type CheckedResponse, type QuoteExtraction, type Recommendation } from "@/domain/quote-check";
import type { WorkbookResponse } from "@/lib/report/rfq-workbook";
import { nameOf } from "@/lib/signers";
import { RESPONSE_KINDS } from "@/lib/document-kinds";

export interface ResponseView {
  id: string;
  documentId: string;
  documentName: string;
  /** The name shown: the QS's where they set one, the response's own, or the file's. */
  name: string;
  evaluated: boolean;
  evaluatedAt: string | null;
  error: string | null;
  result: CheckedResponse | null;
  usage: { input: number; output: number } | null;
  /** The rest of the submission, read with the priced document. */
  supporting: { documentId: string; name: string }[];
}

export interface RfqView {
  id: string;
  title: string;
  scope: string[];
  requirements: string[];
  responses: ResponseView[];
  /** Over the evaluated responses only, by their index in `evaluated`. */
  recommendation: Recommendation | null;
  evaluated: ResponseView[];
  decision: { responseId: string; name: string; reason: string | null; by: string; at: string; followsRecommendation: boolean } | null;
  createdAt: string;
}

/** Quotations filed on the project and not yet a response to this RFQ – what "add a response" offers. */
export interface QuotationOption {
  id: string;
  name: string;
}

/**
 * Everything filed on the project, for attaching a supporting paper to a response.
 *
 * Wider than `QuotationOption` on purpose. A response's supporting documents are whatever the firm
 * sent with its price – a technical proposal, an organogram, a team schedule, a programme – and
 * none of those is a kind of quotation. Narrowing this to the response kinds would leave the
 * picker empty for exactly the documents it exists to attach.
 */
export type FiledDocument = QuotationOption;

export async function loadRfqs(projectId: string): Promise<{ rfqs: RfqView[]; quotations: QuotationOption[]; corpus: FiledDocument[] }> {
  const rows = await db
    .select()
    .from(rfqs)
    .where(and(eq(rfqs.projectId, projectId), isNull(rfqs.deletedAt)))
    .orderBy(asc(rfqs.createdAt));
  const responses = rows.length
    ? await db
        .select({ r: rfqResponses, documentName: documents.filename })
        .from(rfqResponses)
        .innerJoin(documents, eq(documents.id, rfqResponses.documentId))
        .where(and(inArray(rfqResponses.rfqId, rows.map((r) => r.id)), isNull(rfqResponses.deletedAt)))
        .orderBy(asc(rfqResponses.createdAt))
    : [];
  const supporting = responses.length
    ? await db
        .select({ responseId: rfqResponseDocuments.responseId, documentId: rfqResponseDocuments.documentId, name: documents.filename })
        .from(rfqResponseDocuments)
        .innerJoin(documents, eq(documents.id, rfqResponseDocuments.documentId))
        .where(and(inArray(rfqResponseDocuments.responseId, responses.map(({ r }) => r.id)), isNull(rfqResponseDocuments.deletedAt)))
        .orderBy(asc(rfqResponseDocuments.createdAt))
    : [];
  const quotations = await db
    .select({ id: documents.id, name: documents.filename })
    .from(documents)
    .where(and(eq(documents.projectId, projectId), inArray(documents.kind, [...RESPONSE_KINDS]), isNull(documents.deletedAt)))
    .orderBy(asc(documents.createdAt));

  const corpus = await db
    .select({ id: documents.id, name: documents.filename })
    .from(documents)
    .where(and(eq(documents.projectId, projectId), isNull(documents.deletedAt)))
    .orderBy(asc(documents.createdAt));

  const views: RfqView[] = [];
  for (const rfq of rows) {
    const mine: ResponseView[] = responses
      .filter(({ r }) => r.rfqId === rfq.id)
      .map(({ r, documentName }) => {
        const stored = (r.result as CheckedResponse | null) ?? null;
        // A check stored before counts and document queries were read has neither: none found, not unknown.
        const result = stored ? { ...stored, tallies: stored.tallies ?? [], observations: stored.observations ?? [], unseen: stored.unseen ?? [] } : null;
        const name = r.supplier ?? result?.supplier ?? documentName.replace(/\.[a-z0-9]+$/i, "");
        return {
          id: r.id,
          documentId: r.documentId,
          documentName,
          name,
          evaluated: result !== null,
          evaluatedAt: r.evaluatedAt?.toISOString() ?? null,
          error: r.error,
          // The QS's name for the respondent replaces a stand-in, and the recommendation speaks it.
          result: result ? { ...result, supplier: name, named: result.named || r.supplier !== null } : null,
          usage: r.inputTokens !== null ? { input: r.inputTokens, output: r.outputTokens ?? 0 } : null,
          supporting: supporting.filter((s) => s.responseId === r.id).map(({ documentId, name }) => ({ documentId, name })),
        };
      });
    const evaluated = mine.filter((m) => m.result !== null);
    const recommendation = evaluated.length ? recommend(evaluated.map((m) => m.result!)) : null;
    const decided = rfq.decidedResponseId ? mine.find((m) => m.id === rfq.decidedResponseId) : null;
    views.push({
      id: rfq.id,
      title: rfq.title,
      scope: rfq.scope,
      requirements: rfq.requirements,
      responses: mine,
      evaluated,
      recommendation,
      decision:
        decided && rfq.decidedAt
          ? {
              responseId: decided.id,
              name: decided.name,
              reason: rfq.decisionReason,
              by: await nameOf(rfq.decidedBy ?? ""),
              at: rfq.decidedAt.toISOString(),
              followsRecommendation: recommendation?.preferred !== null && recommendation?.preferred !== undefined && evaluated[recommendation.preferred]?.id === decided.id,
            }
          : null,
      createdAt: rfq.createdAt.toISOString(),
    });
  }
  const used = new Set([...responses.map(({ r }) => r.documentId), ...supporting.map((s) => s.documentId)]);
  return { rfqs: views, quotations: quotations.filter((q) => !used.has(q.id)), corpus };
}

export async function loadRfq(projectId: string, rfqId: string): Promise<RfqView | null> {
  return (await loadRfqs(projectId)).rfqs.find((r) => r.id === rfqId) ?? null;
}

/**
 * The evaluated responses with the reading behind each – what the comparative workbook needs.
 *
 * The page never carries this: the extraction holds every quantity, rate and printed formula, and
 * sending all of it to the browser would be a payload nobody there reads. The workbook does read
 * it, because its recalculation is written as live formulas over those same figures.
 */
export async function loadRfqReadings(projectId: string, rfqId: string): Promise<{ rfq: RfqView; responses: WorkbookResponse[] } | null> {
  const rfq = await loadRfq(projectId, rfqId);
  if (!rfq) return null;
  const rows = await db
    .select({ id: rfqResponses.id, extraction: rfqResponses.extraction })
    .from(rfqResponses)
    .where(and(eq(rfqResponses.rfqId, rfqId), isNull(rfqResponses.deletedAt)));
  const extractions = new Map(rows.map((r) => [r.id, (r.extraction as QuoteExtraction | null) ?? null]));
  return {
    rfq,
    responses: rfq.evaluated.map((e) => ({
      name: e.name,
      documentName: [e.documentName, ...e.supporting.map((s) => s.name)].join(", "),
      evaluatedAt: e.evaluatedAt,
      result: e.result!,
      extraction: extractions.get(e.id) ?? null,
    })),
  };
}
