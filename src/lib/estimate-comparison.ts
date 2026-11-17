/**
 * Estimate comparisons, loaded – `domain/estimate-comparison.ts` is what they mean.
 */

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db/client";
import {
  comparisonClarifications,
  comparisonCorrections,
  comparisonEstimates,
  comparisonLines,
  estimateComparisons,
} from "@/db/schema";
import type { Comparison } from "@/domain/estimate-comparison";

export type LoadedComparison = Comparison & { id: string; projectId: string };

export async function listComparisons(projectId: string) {
  return db
    .select({ id: estimateComparisons.id, title: estimateComparisons.title })
    .from(estimateComparisons)
    .where(
      and(
        eq(estimateComparisons.projectId, projectId),
        isNull(estimateComparisons.deletedAt),
      ),
    )
    .orderBy(desc(estimateComparisons.updatedAt));
}

export async function loadComparison(
  projectId: string,
  comparisonId: string,
): Promise<LoadedComparison | null> {
  const [head] = await db
    .select()
    .from(estimateComparisons)
    .where(
      and(
        eq(estimateComparisons.id, comparisonId),
        eq(estimateComparisons.projectId, projectId),
        isNull(estimateComparisons.deletedAt),
      ),
    )
    .limit(1);
  if (!head) return null;

  const estimates = await db
    .select()
    .from(comparisonEstimates)
    .where(eq(comparisonEstimates.comparisonId, comparisonId))
    .orderBy(asc(comparisonEstimates.position));
  const ids = estimates.map((e) => e.id);
  const [lines, corrections, clarifications] = await Promise.all([
    ids.length
      ? db
          .select()
          .from(comparisonLines)
          .where(inArray(comparisonLines.estimateId, ids))
          .orderBy(asc(comparisonLines.position))
      : Promise.resolve([]),
    ids.length
      ? db
          .select()
          .from(comparisonCorrections)
          .where(inArray(comparisonCorrections.estimateId, ids))
          .orderBy(asc(comparisonCorrections.position))
      : Promise.resolve([]),
    db
      .select()
      .from(comparisonClarifications)
      .where(eq(comparisonClarifications.comparisonId, comparisonId))
      .orderBy(asc(comparisonClarifications.number)),
  ]);

  return {
    id: head.id,
    projectId: head.projectId,
    title: head.title,
    subject: head.subject,
    elements: head.elements,
    commonUnits: head.commonUnits,
    unitLabel: head.unitLabel,
    alternativeContingency: head.alternativeContingency,
    estimates: estimates.map((e) => ({
      id: e.id,
      position: e.position,
      name: e.name,
      preparedBy: e.preparedBy,
      dated: e.dated,
      basis: e.basis,
      units: e.units,
      preliminaries: e.preliminaries,
      contingency: e.contingency,
      derivedFrom: e.derivedFrom,
      lines: lines
        .filter((l) => l.estimateId === e.id)
        .map(
          ({
            id,
            position,
            element,
            description,
            quantity,
            unit,
            rate,
            lumpSum,
          }) => ({
            id,
            position,
            element,
            description,
            quantity,
            unit,
            rate,
            lumpSum,
          }),
        ),
      corrections: corrections
        .filter((x) => x.estimateId === e.id)
        .map(({ id, position, ref, element, description, amount, basis }) => ({
          id,
          position,
          ref,
          element,
          description,
          amount,
          basis,
        })),
    })),
    clarifications: clarifications.map(
      ({
        id,
        number,
        estimate,
        observation,
        evidence,
        consequence,
        response,
        status,
      }) => ({
        id,
        number,
        estimate,
        observation,
        evidence,
        consequence,
        response,
        status,
      }),
    ),
  };
}
