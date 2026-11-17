"use server";

/**
 * The Quotations step's actions – an RFQ set up, its responses added and evaluated, a respondent
 * named, and the decision recorded (D1.3).
 */

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth";
import { db } from "@/db/client";
import { documents, rfqResponseDocuments, rfqResponses, rfqs } from "@/db/schema";
import { ModelUnavailable } from "@/lib/agent/deepseek";
import { evaluateQuote } from "@/lib/agent/evaluate-quote";
import { forProject } from "@/lib/egress/scope";

export type RfqAction = { ok: true; id?: string } | { ok: false; reason: string };

const done = (projectId: string, id?: string): RfqAction => {
  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true, id };
};
const lines = (text: string, max: number) =>
  text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-•*\d.)]+\s*/, "").trim())
    .filter(Boolean)
    .slice(0, max);

async function ownRfq(projectId: string, rfqId: string) {
  const [rfq] = await db.select().from(rfqs).where(and(eq(rfqs.id, rfqId), eq(rfqs.projectId, projectId), isNull(rfqs.deletedAt))).limit(1);
  return rfq ?? null;
}

export async function saveRfq(projectId: string, input: { id?: string; title: string; scope: string; requirements: string }): Promise<RfqAction> {
  const session = await requireSession();
  const title = input.title.trim().slice(0, 200);
  if (!title) return { ok: false, reason: "Say what is being procured – \"Civil and structural engineering services\"." };
  const scope = lines(input.scope, 20);
  if (scope.length === 0) return { ok: false, reason: "List at least one scope item every response must cover – one per line." };
  const requirements = lines(input.requirements, 20);
  if (input.id) {
    if (!(await ownRfq(projectId, input.id))) return { ok: false, reason: "That RFQ is not on this project." };
    await db.update(rfqs).set({ title, scope, requirements }).where(eq(rfqs.id, input.id));
    return done(projectId, input.id);
  }
  const [row] = await db.insert(rfqs).values({ projectId, title, scope, requirements, createdBy: session.email }).returning({ id: rfqs.id });
  return done(projectId, row!.id);
}

/** Add filed quotations as responses – by document, or the latest filed under a name. */
export async function addResponses(projectId: string, rfqId: string, input: { documentIds?: string[]; filenames?: string[] }): Promise<RfqAction> {
  const session = await requireSession();
  if (!(await ownRfq(projectId, rfqId))) return { ok: false, reason: "That RFQ is not on this project." };
  const ids = new Set(input.documentIds ?? []);
  for (const name of input.filenames ?? []) {
    const [doc] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.projectId, projectId), eq(documents.filename, name), isNull(documents.deletedAt)))
      .orderBy(documents.createdAt)
      .limit(1);
    if (doc) ids.add(doc.id);
  }
  for (const documentId of ids) {
    const [doc] = await db.select({ id: documents.id }).from(documents).where(and(eq(documents.id, documentId), eq(documents.projectId, projectId))).limit(1);
    if (!doc) continue;
    await db.insert(rfqResponses).values({ rfqId, documentId, createdBy: session.email }).onConflictDoNothing();
  }
  return done(projectId);
}

/**
 * Attach the rest of a submission to a response – a technical proposal, an organogram, a schedule.
 *
 * Not a second response: the price is read from the one document the response was filed on, and a
 * submission split into three would be ranked against parts of itself. These are read with it.
 */
export async function attachSupporting(projectId: string, rfqId: string, responseId: string, input: { documentIds?: string[]; filenames?: string[] }): Promise<RfqAction> {
  const session = await requireSession();
  if (!(await ownRfq(projectId, rfqId))) return { ok: false, reason: "That RFQ is not on this project." };
  const [response] = await db.select({ id: rfqResponses.id, documentId: rfqResponses.documentId }).from(rfqResponses).where(and(eq(rfqResponses.id, responseId), eq(rfqResponses.rfqId, rfqId), isNull(rfqResponses.deletedAt))).limit(1);
  if (!response) return { ok: false, reason: "That response is no longer on the RFQ." };

  const ids = new Set(input.documentIds ?? []);
  for (const name of input.filenames ?? []) {
    const [doc] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.projectId, projectId), eq(documents.filename, name), isNull(documents.deletedAt)))
      .orderBy(documents.createdAt)
      .limit(1);
    if (doc) ids.add(doc.id);
  }
  /*
    Nobody else's response may be attached to this one.

    A supporting document is the rest of *this* submission - the technical proposal and organogram
    that came with this firm's price. Another respondent's priced proposal is not that, and a
    response read together with a rival's fee is an evaluation of neither: the reader is shown one
    firm's name over two firms' money. It happened - three engineering proposals on one RFQ ended
    up attached to each other, and the prices are the whole point of the comparison.
  */
  const rivals = await db
    .select({ documentId: rfqResponses.documentId })
    .from(rfqResponses)
    .where(and(eq(rfqResponses.rfqId, rfqId), isNull(rfqResponses.deletedAt)));
  const isAResponse = new Set(rivals.map((r) => r.documentId));

  for (const documentId of ids) {
    // The priced document is already the response; attaching it to itself would read it twice.
    if (documentId === response.documentId) continue;
    if (isAResponse.has(documentId)) continue;
    const [doc] = await db.select({ id: documents.id }).from(documents).where(and(eq(documents.id, documentId), eq(documents.projectId, projectId), isNull(documents.deletedAt))).limit(1);
    if (!doc) continue;
    await db.insert(rfqResponseDocuments).values({ responseId, documentId, createdBy: session.email }).onConflictDoNothing();
  }
  return done(projectId);
}

export async function detachSupporting(projectId: string, rfqId: string, responseId: string, documentId: string): Promise<RfqAction> {
  await requireSession();
  if (!(await ownRfq(projectId, rfqId))) return { ok: false, reason: "That RFQ is not on this project." };
  await db
    .update(rfqResponseDocuments)
    .set({ deletedAt: new Date() })
    .where(and(eq(rfqResponseDocuments.responseId, responseId), eq(rfqResponseDocuments.documentId, documentId), isNull(rfqResponseDocuments.deletedAt)));
  return done(projectId);
}

export async function removeResponse(projectId: string, rfqId: string, responseId: string): Promise<RfqAction> {
  await requireSession();
  if (!(await ownRfq(projectId, rfqId))) return { ok: false, reason: "That RFQ is not on this project." };
  await db.update(rfqResponses).set({ deletedAt: new Date() }).where(and(eq(rfqResponses.id, responseId), eq(rfqResponses.rfqId, rfqId)));
  // A decision for a response that is gone is no decision.
  await db.update(rfqs).set({ decidedResponseId: null, decisionReason: null, decidedBy: null, decidedAt: null }).where(and(eq(rfqs.id, rfqId), eq(rfqs.decidedResponseId, responseId)));
  return done(projectId);
}

/** Read a response against the RFQ and check it – every figure grounded, every sum redone. */
export async function evaluateResponse(projectId: string, rfqId: string, responseId: string): Promise<RfqAction> {
  await requireSession();
  const rfq = await ownRfq(projectId, rfqId);
  if (!rfq) return { ok: false, reason: "That RFQ is not on this project." };
  const [response] = await db.select().from(rfqResponses).where(and(eq(rfqResponses.id, responseId), eq(rfqResponses.rfqId, rfqId), isNull(rfqResponses.deletedAt))).limit(1);
  if (!response) return { ok: false, reason: "That response is no longer on the RFQ." };
  try {
    const supporting = await db
      .select({ documentId: rfqResponseDocuments.documentId })
      .from(rfqResponseDocuments)
      .where(and(eq(rfqResponseDocuments.responseId, response.id), isNull(rfqResponseDocuments.deletedAt)));
    const { extraction, result, usage } = await forProject(projectId, () => evaluateQuote(response.documentId, rfq, undefined, supporting.map((s) => s.documentId)));
    await db
      .update(rfqResponses)
      .set({ extraction, result, evaluatedAt: new Date(), inputTokens: usage.input, outputTokens: usage.output, error: null })
      .where(eq(rfqResponses.id, responseId));
  } catch (error) {
    const reason = error instanceof ModelUnavailable || error instanceof Error ? error.message : "The response could not be evaluated.";
    await db.update(rfqResponses).set({ error: reason }).where(eq(rfqResponses.id, responseId));
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: false, reason };
  }
  return done(projectId);
}

/** The respondent's name, where the response's text does not carry it – a letterhead image. */
export async function nameResponse(projectId: string, rfqId: string, responseId: string, name: string): Promise<RfqAction> {
  await requireSession();
  if (!(await ownRfq(projectId, rfqId))) return { ok: false, reason: "That RFQ is not on this project." };
  const value = name.trim().slice(0, 160) || null;
  await db.update(rfqResponses).set({ supplier: value }).where(and(eq(rfqResponses.id, responseId), eq(rfqResponses.rfqId, rfqId)));
  return done(projectId);
}

/**
 * The decision – the recommendation accepted, or another response chosen. Choosing against the
 * recommendation needs a reason, because the reason is what the file shows afterwards.
 */
export async function decide(projectId: string, rfqId: string, input: { responseId: string; reason: string; againstRecommendation: boolean }): Promise<RfqAction> {
  const session = await requireSession();
  if (!(await ownRfq(projectId, rfqId))) return { ok: false, reason: "That RFQ is not on this project." };
  const reason = input.reason.trim().slice(0, 2000);
  if (input.againstRecommendation && !reason) return { ok: false, reason: "Say why this response is chosen over the recommended one – the file will show it." };
  const [response] = await db.select({ id: rfqResponses.id }).from(rfqResponses).where(and(eq(rfqResponses.id, input.responseId), eq(rfqResponses.rfqId, rfqId), isNull(rfqResponses.deletedAt))).limit(1);
  if (!response) return { ok: false, reason: "That response is no longer on the RFQ." };
  await db.update(rfqs).set({ decidedResponseId: input.responseId, decisionReason: reason || null, decidedBy: session.email, decidedAt: new Date() }).where(eq(rfqs.id, rfqId));
  return done(projectId);
}
