/**
 * Reading tender returns — §1.4 (D1.3), §6.5.
 *
 * The one thing worth saying here that the schema does not: returns are loaded **for a named bill
 * run**, never for a project. A tender was invited on one issue of the bill, and a project that has
 * revised and re-signed its bill has returns against both. Loading by project would mix them and
 * produce a comparison whose columns priced different quantities — which looks exactly like a
 * comparison and is not one.
 */

import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db/client";
import { tenderPrices, tenderReturns } from "@/db/schema";
import type { TenderReturn } from "@/lib/agent/tender";

export async function loadTenderReturns(
  projectId: string,
  billRunId: string,
): Promise<TenderReturn[]> {
  const entries = await db
    .select()
    .from(tenderReturns)
    .where(
      and(
        eq(tenderReturns.projectId, projectId),
        eq(tenderReturns.billRunId, billRunId),
        isNull(tenderReturns.deletedAt),
      ),
    )
    .orderBy(asc(tenderReturns.createdAt));

  if (entries.length === 0) return [];

  // One query for every price, scoped by `inArray` to the returns just loaded. One query per
  // tenderer would be five against a four-hundred row bill; an unscoped select would be every
  // price on every project, which is how a comparison quietly acquires another job's rates.
  const all = await db
    .select()
    .from(tenderPrices)
    .where(
      inArray(
        tenderPrices.returnId,
        entries.map((entry) => entry.id),
      ),
    );

  const byReturn = new Map<string, typeof all>();
  for (const row of all) {
    const list = byReturn.get(row.returnId) ?? [];
    list.push(row);
    byReturn.set(row.returnId, list);
  }

  return entries.map((entry) => ({
    id: entry.id,
    tenderer: entry.tenderer,
    statedSum: entry.statedSum === null ? null : entry.statedSum.toString(),
    receivedAt: entry.receivedAt?.toISOString() ?? null,
    prices: (byReturn.get(entry.id) ?? []).map((price) => ({
      itemId: price.itemId,
      rate:
        price.rate === null
          ? null
          : { value: price.rate.toString(), precision: price.ratePrecision },
      amount: price.amount?.toString() ?? null,
    })),
  }));
}
