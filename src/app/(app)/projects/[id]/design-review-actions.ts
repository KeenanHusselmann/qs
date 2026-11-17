"use server";

/**
 * Design review – importing the workbook, and the edits a reviewer makes as answers come in.
 *
 * Not to be confused with `review-actions.ts` beside it, which is the corpus review: what the
 * agent made of the project's documents. This is the practice's review of a draft bill against the
 * design (`domain/design-review.ts`).
 *
 * Every edit names the review and the project it belongs to, and is refused unless both agree: an
 * id from one project's page posted against another's is the cheapest way to edit somebody else's
 * review, and the check costs one condition on the update.
 *
 * Rates cross `readRate` and nothing else, as everywhere: "1,234" is refused rather than read as
 * one thing or the other, because in a priced estimate that difference is a thousandfold.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { getProject } from "@/app/(app)/projects/actions";
import { db } from "@/db/client";
import { designReviews, reviewItems, reviewQueries } from "@/db/schema";
import { readPercent, readQuantity, readRate } from "@/domain/amount";
import {
  DEFAULT_ASSUMPTIONS,
  ITEM_STATUSES,
  QUERY_PRIORITIES,
  QUERY_STATUSES,
  readStatus,
  type ReviewAssumptions,
} from "@/domain/design-review";
import { requireSession } from "@/lib/auth";
import { saveReview } from "@/lib/design-review";
import { importReview } from "@/lib/design-review-import";
import { readWorkbookGrids } from "@/lib/ingest/xlsx";

export type ReviewAction = { ok: true; id?: string; notes?: string[]; message?: string } | { ok: false; reason: string };

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const optional = (v: unknown, max: number) => clean(v, max) || null;
const path = (projectId: string) => `/projects/${projectId}/review`;

/** The review, if it is this project's and has not been withdrawn. */
async function owned(projectId: string, reviewId: string) {
  const [row] = await db
    .select({ id: designReviews.id, options: designReviews.options, assumptions: designReviews.assumptions })
    .from(designReviews)
    .where(and(eq(designReviews.id, reviewId), eq(designReviews.projectId, projectId), isNull(designReviews.deletedAt)))
    .limit(1);
  return row ?? null;
}

const touch = (reviewId: string) => db.update(designReviews).set({ updatedAt: new Date() }).where(eq(designReviews.id, reviewId));

/** A decimal string from a scaled integer, at the places it was written to. */
const scaledText = (value: bigint, precision: number) => {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const d = 10n ** BigInt(precision);
  return `${neg ? "-" : ""}${abs / d}.${(abs % d).toString().padStart(precision, "0")}`;
};

// ── Import, start, withdraw ───────────────────────────────────────────────────────────────

const MAX_WORKBOOK = 15 * 1024 * 1024;

export async function importReviewWorkbook(projectId: string, form: FormData): Promise<ReviewAction> {
  const session = await requireSession();
  if (!(await getProject(projectId))) return { ok: false, reason: "That project is not available." };

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, reason: "Choose a workbook to import." };
  if (!/\.xlsx$/i.test(file.name)) return { ok: false, reason: "A review imports from an .xlsx workbook." };
  if (file.size > MAX_WORKBOOK) return { ok: false, reason: "That workbook is larger than a review should be (15 MB)." };

  const grids = readWorkbookGrids(new Uint8Array(await file.arrayBuffer()));
  if (grids.warning) return { ok: false, reason: grids.warning };

  const result = importReview(grids.sheets, file.name);
  if (!result.ok) return result;

  const id = await saveReview(projectId, result.review, session.email, file.name);
  revalidatePath(path(projectId));
  const r = result.review;
  return {
    ok: true,
    id,
    notes: result.notes,
    message: `Imported ${r.items.length} items across ${r.options.length} option${r.options.length === 1 ? "" : "s"}, ${r.sources.length} sources and ${r.queries.length} queries.`,
  };
}

/** A review started in the platform rather than imported: a title and the options' names. */
export async function startReview(projectId: string, input: { title: string; subject?: string; options: string }): Promise<ReviewAction> {
  const session = await requireSession();
  if (!(await getProject(projectId))) return { ok: false, reason: "That project is not available." };
  const title = clean(input.title, 200);
  if (!title) return { ok: false, reason: "Give the review a title – what is being reviewed against what." };

  const labels = [...new Set(clean(input.options, 400).split(/[,\n]/).map((s) => s.trim()).filter(Boolean))].slice(0, 8);
  const options = (labels.length ? labels : ["Bill"]).map((label) => ({ key: label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "option", label }));
  if (new Set(options.map((o) => o.key)).size !== options.length) return { ok: false, reason: "Two options have names that read the same; name them apart." };

  const id = await saveReview(
    projectId,
    {
      title,
      subject: optional(input.subject, 300),
      options,
      baseOption: options[0].key,
      recommendation: null,
      limitations: null,
      parameterColumns: ["Architect", "Engineer", "Surveyor", "Geotechnical", ...options.map((o) => `QS ${o.label}`)],
      assumptions: { ...DEFAULT_ASSUMPTIONS },
      sources: [],
      parameters: [],
      items: [],
      queries: [],
      adjustments: [],
    },
    session.email,
    null,
  );
  revalidatePath(path(projectId));
  return { ok: true, id };
}

export async function withdrawReview(projectId: string, reviewId: string): Promise<ReviewAction> {
  await requireSession();
  const [row] = await db
    .update(designReviews)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(designReviews.id, reviewId), eq(designReviews.projectId, projectId), isNull(designReviews.deletedAt)))
    .returning({ id: designReviews.id });
  if (!row) return { ok: false, reason: "That review is no longer on this project." };
  revalidatePath(path(projectId));
  return { ok: true };
}

// ── Items ─────────────────────────────────────────────────────────────────────────────────

export async function markItem(
  projectId: string,
  reviewId: string,
  itemId: string,
  input: { status: string; finding?: string; action?: string },
): Promise<ReviewAction> {
  const session = await requireSession();
  if (!(await owned(projectId, reviewId))) return { ok: false, reason: "That review is no longer on this project." };

  const status = input.status === "" ? null : readStatus(input.status, ITEM_STATUSES);
  if (input.status !== "" && !status) return { ok: false, reason: "That is not a status in the key." };

  const [row] = await db
    .update(reviewItems)
    .set({ status, finding: optional(input.finding, 1000), action: optional(input.action, 1000), updatedBy: session.email, updatedAt: new Date() })
    .where(and(eq(reviewItems.id, itemId), eq(reviewItems.reviewId, reviewId)))
    .returning({ ref: reviewItems.ref });
  if (!row) return { ok: false, reason: "That item is no longer on this review." };
  await touch(reviewId);
  revalidatePath(path(projectId));
  return { ok: true, message: `${row.ref} is ${status ?? "unmarked"}.` };
}

/** Set one option's rate on one item. An empty rate clears it – the item is then unpriced, and said to be. */
export async function setItemRate(projectId: string, reviewId: string, itemId: string, optionKey: string, raw: string): Promise<ReviewAction> {
  const session = await requireSession();
  const review = await owned(projectId, reviewId);
  if (!review) return { ok: false, reason: "That review is no longer on this project." };
  if (!review.options.some((o) => o.key === optionKey)) return { ok: false, reason: "That option is not on this review." };

  let value: string | null = null;
  if (clean(raw, 40) !== "") {
    const reading = readRate(clean(raw, 40));
    if (!reading.ok) return { ok: false, reason: `That rate could not be read – ${reading.reason}` };
    if (reading.rate.value < 0n) return { ok: false, reason: "A rate is not negative; put a deduction on the adjustments." };
    value = scaledText(reading.rate.value, Math.max(2, reading.rate.precision));
  }

  const [row] = await db
    .update(reviewItems)
    .set({ rates: sql`${reviewItems.rates} || ${JSON.stringify({ [optionKey]: value })}::jsonb`, updatedBy: session.email, updatedAt: new Date() })
    .where(and(eq(reviewItems.id, itemId), eq(reviewItems.reviewId, reviewId)))
    .returning({ ref: reviewItems.ref });
  if (!row) return { ok: false, reason: "That item is no longer on this review." };
  await touch(reviewId);
  revalidatePath(path(projectId));
  return { ok: true, message: value === null ? `${row.ref} is unpriced in this option.` : `${row.ref} is rated at R ${value}.` };
}

// ── Queries ───────────────────────────────────────────────────────────────────────────────

export async function addQuery(
  projectId: string,
  reviewId: string,
  input: { query: string; topic?: string; raisedTo?: string; affects?: string; priority?: string; sourceRef?: string },
): Promise<ReviewAction> {
  const session = await requireSession();
  if (!(await owned(projectId, reviewId))) return { ok: false, reason: "That review is no longer on this project." };
  const query = clean(input.query, 2000);
  if (!query) return { ok: false, reason: "Say what is being asked." };

  const number = await db.transaction(async (tx) => {
    // Numbered per review under a lock – two reviewers adding at once must not both raise Q29.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`review-queries:${reviewId}`}))`);
    const [m] = await tx.select({ max: sql<number | null>`max(${reviewQueries.number})` }).from(reviewQueries).where(eq(reviewQueries.reviewId, reviewId));
    const n = (m?.max ?? 0) + 1;
    await tx.insert(reviewQueries).values({
      reviewId,
      number: n,
      query,
      topic: optional(input.topic, 120),
      raisedTo: optional(input.raisedTo, 120),
      affects: optional(input.affects, 120),
      priority: readStatus(input.priority, QUERY_PRIORITIES),
      sourceRef: optional(input.sourceRef, 200),
      createdBy: session.email,
    });
    return n;
  });
  await touch(reviewId);
  revalidatePath(path(projectId));
  return { ok: true, message: `Q${number} is on the list.` };
}

/** Record a response and move the query on. A query marked answered with nothing written is refused. */
export async function respondToQuery(projectId: string, reviewId: string, queryId: string, input: { response: string; status: string }): Promise<ReviewAction> {
  const session = await requireSession();
  if (!(await owned(projectId, reviewId))) return { ok: false, reason: "That review is no longer on this project." };
  const status = readStatus(input.status, QUERY_STATUSES);
  if (!status) return { ok: false, reason: "That is not a status a query can be in." };
  const response = optional(input.response, 2000);
  if (status !== "Open" && !response) return { ok: false, reason: "Write the response before marking the query answered or closed – it is the record of what was decided." };

  const [row] = await db
    .update(reviewQueries)
    .set({
      response,
      status,
      answeredBy: status === "Open" ? null : session.email,
      answeredAt: status === "Open" ? null : new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(reviewQueries.id, queryId), eq(reviewQueries.reviewId, reviewId)))
    .returning({ number: reviewQueries.number });
  if (!row) return { ok: false, reason: "That query is no longer on this review." };
  await touch(reviewId);
  revalidatePath(path(projectId));
  return { ok: true, message: `Q${row.number} is ${status.toLowerCase()}.` };
}

// ── Assumptions and the base option ───────────────────────────────────────────────────────

type AssumptionInput = Partial<
  Record<"mainQuantity" | "mainUnit" | "contingency" | "vat" | "profitAndAttendance" | "rangeLow" | "rangeHigh" | "contractWeeks" | "comparisonAmount" | "comparisonLabel" | "baseOption", string>
>;

export async function setAssumptions(projectId: string, reviewId: string, input: AssumptionInput): Promise<ReviewAction> {
  await requireSession();
  const review = await owned(projectId, reviewId);
  if (!review) return { ok: false, reason: "That review is no longer on this project." };
  const next: ReviewAssumptions = { ...DEFAULT_ASSUMPTIONS, ...review.assumptions };
  const errors: string[] = [];

  // Percentages are typed as people say them – "10" or "10%" – and held as the fraction.
  const percentField = (key: "contingency" | "vat" | "profitAndAttendance" | "rangeLow" | "rangeHigh", label: string, band: { min: number; max: number }) => {
    const raw = clean(input[key], 20);
    if (raw === "") return;
    const reading = readPercent(raw, band);
    if (!reading.ok) errors.push(`${label}: ${reading.reason}`);
    else next[key] = scaledText(reading.percent, 4);
  };
  percentField("contingency", "contingency", { min: 0, max: 50 });
  percentField("vat", "VAT", { min: 0, max: 30 });
  percentField("profitAndAttendance", "profit and attendance", { min: 0, max: 30 });
  percentField("rangeLow", "range low", { min: -50, max: 0 });
  percentField("rangeHigh", "range high", { min: 0, max: 100 });

  if (input.mainQuantity !== undefined) {
    const raw = clean(input.mainQuantity, 30);
    if (raw === "") next.mainQuantity = null;
    else {
      const reading = readQuantity(raw);
      if (!reading.ok) errors.push(`main quantity: ${reading.reason}`);
      else next.mainQuantity = scaledText(reading.quantity, 4);
    }
  }
  if (input.mainUnit !== undefined) next.mainUnit = optional(input.mainUnit, 20);
  if (input.contractWeeks !== undefined) {
    const raw = clean(input.contractWeeks, 6);
    if (raw === "") next.contractWeeks = null;
    else if (/^\d{1,3}$/.test(raw)) next.contractWeeks = Number(raw);
    else errors.push("contract period: a whole number of weeks");
  }
  if (input.comparisonAmount !== undefined) {
    const raw = clean(input.comparisonAmount, 30);
    if (raw === "") next.comparisonAmount = null;
    else {
      const reading = readRate(raw);
      if (!reading.ok) errors.push(`comparison figure: ${reading.reason}`);
      else next.comparisonAmount = scaledText(reading.rate.value, reading.rate.precision);
    }
  }
  if (input.comparisonLabel !== undefined) next.comparisonLabel = optional(input.comparisonLabel, 120);
  if (errors.length) return { ok: false, reason: `Not saved – ${errors.join("; ")}.` };

  const base = input.baseOption !== undefined && review.options.some((o) => o.key === input.baseOption) ? input.baseOption : undefined;
  await db
    .update(designReviews)
    .set({ assumptions: next, ...(base ? { baseOption: base } : {}), updatedAt: new Date() })
    .where(eq(designReviews.id, reviewId));
  revalidatePath(path(projectId));
  return { ok: true, message: "The estimate's assumptions are saved." };
}
