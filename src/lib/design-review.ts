/**
 * Design reviews, loaded and saved – `domain/design-review.ts` is what they mean.
 *
 * A review is written once, whole, when it is imported or started, and then edited a row at a
 * time: a status changed, a rate entered, a query answered. So saving is one transaction over six
 * tables, and editing is a single-row update in the actions beside the page.
 */

import { and, asc, desc, eq, isNull } from "drizzle-orm";

import { db } from "@/db/client";
import { designReviews, reviewAdjustments, reviewItems, reviewParameters, reviewQueries, reviewSources } from "@/db/schema";
import { DEFAULT_ASSUMPTIONS, type Review } from "@/domain/design-review";

export interface ReviewSummary {
  id: string;
  title: string;
  subject: string | null;
  updatedAt: Date;
}

export type LoadedReview = Review & { id: string; projectId: string; sourceFile: string | null; createdBy: string; createdAt: Date };

export async function listReviews(projectId: string): Promise<ReviewSummary[]> {
  return db
    .select({ id: designReviews.id, title: designReviews.title, subject: designReviews.subject, updatedAt: designReviews.updatedAt })
    .from(designReviews)
    .where(and(eq(designReviews.projectId, projectId), isNull(designReviews.deletedAt)))
    .orderBy(desc(designReviews.updatedAt));
}

export async function loadReview(projectId: string, reviewId: string): Promise<LoadedReview | null> {
  const [head] = await db
    .select()
    .from(designReviews)
    .where(and(eq(designReviews.id, reviewId), eq(designReviews.projectId, projectId), isNull(designReviews.deletedAt)))
    .limit(1);
  if (!head) return null;

  const [sources, parameters, items, queries, adjustments] = await Promise.all([
    db.select().from(reviewSources).where(eq(reviewSources.reviewId, reviewId)).orderBy(asc(reviewSources.position)),
    db.select().from(reviewParameters).where(eq(reviewParameters.reviewId, reviewId)).orderBy(asc(reviewParameters.position)),
    db.select().from(reviewItems).where(eq(reviewItems.reviewId, reviewId)).orderBy(asc(reviewItems.position)),
    db.select().from(reviewQueries).where(eq(reviewQueries.reviewId, reviewId)).orderBy(asc(reviewQueries.number)),
    db.select().from(reviewAdjustments).where(eq(reviewAdjustments.reviewId, reviewId)).orderBy(asc(reviewAdjustments.position)),
  ]);

  return {
    id: head.id,
    projectId: head.projectId,
    sourceFile: head.sourceFile,
    createdBy: head.createdBy,
    createdAt: head.createdAt,
    title: head.title,
    subject: head.subject,
    options: head.options,
    baseOption: head.baseOption,
    recommendation: head.recommendation,
    limitations: head.limitations,
    parameterColumns: head.parameterColumns,
    // Anything an older row does not carry falls back to the default, never to nought.
    assumptions: { ...DEFAULT_ASSUMPTIONS, ...head.assumptions },
    sources: sources.map(({ id, ref, discipline, document, dated, status, notes, location }) => ({ id, ref, discipline, document, dated, status, notes, location })),
    parameters: parameters.map(({ id, position, parameter, values, status, consequence }) => ({ id, position, parameter, values, status, consequence })),
    items: items.map((i) => ({
      id: i.id,
      position: i.position,
      ref: i.ref,
      bill: i.bill,
      itemNumbers: i.itemNumbers,
      description: i.description,
      unit: i.unit,
      quantities: i.quantities,
      designSource: i.designSource,
      requirement: i.requirement,
      status: i.status ?? null,
      finding: i.finding,
      action: i.action,
      rates: i.rates,
      rateBasis: i.rateBasis,
    })),
    queries: queries.map((q) => ({
      id: q.id,
      number: q.number,
      topic: q.topic,
      query: q.query,
      raisedTo: q.raisedTo,
      affects: q.affects,
      priority: q.priority ?? null,
      sourceRef: q.sourceRef,
      response: q.response,
      status: q.status,
    })),
    adjustments: adjustments.map(({ id, position, ref, queryNumber, description, unit, quantities, rates, basis }) => ({ id, position, ref, queryNumber, description, unit, quantities, rates, basis })),
  };
}

/** Write a whole review – imported or started blank – and return its id. */
export async function saveReview(projectId: string, review: Review, by: string, sourceFile: string | null): Promise<string> {
  return db.transaction(async (tx) => {
    const [head] = await tx
      .insert(designReviews)
      .values({
        projectId,
        title: review.title,
        subject: review.subject,
        options: review.options,
        baseOption: review.baseOption,
        recommendation: review.recommendation,
        limitations: review.limitations,
        parameterColumns: review.parameterColumns,
        assumptions: review.assumptions,
        sourceFile,
        createdBy: by,
      })
      .returning({ id: designReviews.id });
    const reviewId = head.id;

    if (review.sources.length) {
      await tx.insert(reviewSources).values(review.sources.map((s, i) => ({ reviewId, position: i + 1, ref: s.ref, discipline: s.discipline, document: s.document, dated: s.dated, status: s.status, notes: s.notes, location: s.location })));
    }
    if (review.parameters.length) {
      await tx.insert(reviewParameters).values(review.parameters.map((p, i) => ({ reviewId, position: i + 1, parameter: p.parameter, values: p.values, status: p.status, consequence: p.consequence })));
    }
    if (review.items.length) {
      await tx.insert(reviewItems).values(
        review.items.map((it, i) => ({
          reviewId,
          position: i + 1,
          ref: it.ref,
          bill: it.bill,
          itemNumbers: it.itemNumbers,
          description: it.description,
          unit: it.unit,
          quantities: it.quantities,
          designSource: it.designSource,
          requirement: it.requirement,
          status: it.status,
          finding: it.finding,
          action: it.action,
          rates: it.rates,
          rateBasis: it.rateBasis,
          updatedBy: by,
        })),
      );
    }
    if (review.queries.length) {
      await tx.insert(reviewQueries).values(
        review.queries.map((q) => ({ reviewId, number: q.number, topic: q.topic, query: q.query, raisedTo: q.raisedTo, affects: q.affects, priority: q.priority, sourceRef: q.sourceRef, response: q.response, status: q.status, createdBy: by })),
      );
    }
    if (review.adjustments.length) {
      await tx.insert(reviewAdjustments).values(
        review.adjustments.map((a, i) => ({ reviewId, position: i + 1, ref: a.ref, queryNumber: a.queryNumber, description: a.description, unit: a.unit, quantities: a.quantities, rates: a.rates, basis: a.basis })),
      );
    }
    return reviewId;
  });
}
