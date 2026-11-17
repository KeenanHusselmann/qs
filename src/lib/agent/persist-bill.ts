/**
 * A bill, written down — PLATFORM.md §1.3.1, §5, §6.5.
 *
 * The sibling of `persist.ts`, and deliberately its mirror: rows are written **as each batch
 * settles** rather than at the end, for the same reason fields are — a run killed part-way must not
 * throw away the rows somebody has already paid for and could be checking.
 *
 * ── What this file does not do ─────────────────────────────────────────────────────────────
 *
 * It never writes `amount`. §5.2's single rounding point is a database trigger
 * (`0010_run_items.sql`), so an insert here supplies a quantity and a rate and the extension arrives
 * with the row it belongs to. Nothing in this application can produce a row whose amount disagrees
 * with its own figures, because nothing in this application computes one.
 */

import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import { db } from "@/db/client";
import { rateBuildUps, rateComponents, runItems, runs } from "@/db/schema";
import { costOf } from "@/lib/agent/deepseek";
import type { BillRow, ItemResult, PersistedBill, QuantitySource } from "@/lib/agent/bill";
import { nameIn, signerNames } from "@/lib/signers";
import type { BuildUp } from "@/lib/pricing";

/**
 * Sparse ordinals — 100, 200, 300 (§6.3).
 *
 * A bill has rows inserted into the middle of it for its whole life, and dense ordinals would mean
 * renumbering everything below the insert every time. Wide enough that a QS can add a row between
 * any two without this platform ever having to renumber.
 */
export const SEQ_STEP = 100;

/**
 * Write one batch of proposed rows, creating the headings their sections imply.
 *
 * ── Why the headings are ours and the items are the model's ────────────────────────────────
 *
 * §4.7 wants a bill that reads as Section → Item, and a flat list of forty rows is not a bill. But a
 * heading is not a *claim* about the documents — it carries no figure — so it is derived here, from
 * the section each item named, in the order the items arrived. The model never proposes a heading
 * row, and no heading exists that no item sits under.
 *
 * Returns the sections it created, so a second batch adds its items under the headings the first one
 * already made rather than starting a duplicate.
 */
export async function recordItems(
  runId: string,
  items: readonly ItemResult[],
  headings: Map<string, string>,
  startSeq: number,
): Promise<number> {
  let seq = startSeq;

  for (const item of items) {
    const section = item.section?.trim() || null;
    let parentId: string | null = null;

    if (section) {
      const key = section.toLowerCase();
      let headingId = headings.get(key);

      if (!headingId) {
        const [row] = await db
          .insert(runItems)
          .values({ runId, seq, rowType: "heading", proposedDescription: section })
          .returning({ id: runItems.id });

        headingId = row.id;
        headings.set(key, headingId);
        seq += SEQ_STEP;
      }

      parentId = headingId;
    }

    await db.insert(runItems).values({
      runId,
      seq,
      parentId,
      rowType: "item",
      proposedDescription: item.description,
      proposedUnit: item.unit,
      proposedQuantity: item.quantity,
      proposedRate: item.rate ? BigInt(item.rate.value) : null,
      proposedRatePrecision: item.rate ? item.rate.precision : null,
      proposedQuantityText: item.quantityText,
      proposedRateText: item.rateText,
      proposedConfidence: item.confidence,
      proposedNote: item.note,
      sourceDocumentId: item.citation?.documentId ?? null,
      sourceDocument: item.citation?.document ?? null,
      sourcePage: item.citation?.page ?? null,
      sourceExcerpt: item.citation?.quote ?? null,
      quantitySource: "ai_derived",
    });

    seq += SEQ_STEP;
  }

  return seq;
}

/**
 * A row as the database has it, turned into the shape the screen and the domain rules read.
 *
 * Exported because `dashboard.ts` needs it too and had been carrying a copy, with a note saying so
 * and saying that the tidy-up was to export this the next time the shape changed. §4.8 changed it —
 * `rate_source` — and a mapper that has to be edited in two places is a mapper that will be edited
 * in one.
 */
export function asBillRow(row: typeof runItems.$inferSelect, names: ReadonlyMap<string, string> = new Map()): BillRow {
  return {
    id: row.id,
    seq: row.seq,
    parentId: row.parentId,
    rowType: row.rowType,
    itemRef: row.itemRef,
    proposed: {
      description: row.proposedDescription,
      unit: row.proposedUnit,
      quantity: row.proposedQuantity,
      rate:
        row.proposedRate === null
          ? null
          : { value: row.proposedRate.toString(), precision: row.proposedRatePrecision ?? 2 },
      quantityText: row.proposedQuantityText,
      rateText: row.proposedRateText,
      confidence: row.proposedConfidence,
      note: row.proposedNote,
    },
    citation: row.sourceExcerpt
      ? {
          // A citation whose document was hard-deleted keeps its name and its quote. Saying "the
          // original is gone" is the honest version; dropping the citation would make a grounded
          // row look invented.
          documentId: row.sourceDocumentId ?? "",
          document: row.sourceDocument ?? "A document no longer filed",
          page: row.sourcePage ?? undefined,
          quote: row.sourceExcerpt,
        }
      : null,
    override:
      row.overrideBy && row.overrideAt
        ? {
            description: row.overrideDescription,
            unit: row.overrideUnit,
            quantity: row.overrideQuantity,
            rate:
              row.overrideRate === null
                ? null
                : { value: row.overrideRate.toString(), precision: row.overrideRatePrecision ?? 2 },
            reason: row.overrideReason,
            by: nameIn(names, row.overrideBy),
            at: row.overrideAt.toISOString(),
          }
        : null,
    quantitySource: row.quantitySource,
    rateSource: row.rateSource,
    amount: row.amount === null ? null : row.amount.toString(),
    output:
      row.outputAmount === null &&
      row.outputDescription === null &&
      row.outputQuantity === null &&
      row.outputRate === null
        ? null
        : {
            description: row.outputDescription,
            unit: row.outputUnit,
            quantity: row.outputQuantity,
            rate:
              row.outputRate === null
                ? null
                : { value: row.outputRate.toString(), precision: row.outputRatePrecision ?? 2 },
            amount: row.outputAmount === null ? null : row.outputAmount.toString(),
          },
    omitted:
      row.omittedAt && row.omittedBy ? { by: nameIn(names, row.omittedBy), at: row.omittedAt.toISOString() } : null,
  };
}

/**
 * The latest bill run of a step, with its rows.
 *
 * Latest rather than latest-signed: this is what the screen shows, and the screen shows the work in
 * progress. What a *downstream* step reads is `loadSignedBill`.
 */
export async function loadLatestBill(
  projectId: string,
  module: string,
): Promise<PersistedBill | null> {
  const [run] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.projectId, projectId), eq(runs.module, module), isNull(runs.deletedAt)))
    .orderBy(desc(runs.createdAt))
    .limit(1);

  if (!run) return null;

  const names = await signerNames();
  const rows = await db
    .select()
    .from(runItems)
    .where(eq(runItems.runId, run.id))
    .orderBy(asc(runItems.seq));

  // The heartbeat, derived rather than stored: the newest row written, or the start if nothing has
  // landed. An UPDATE on the run per batch would record something the rows already say.
  const lastWrite = rows.reduce(
    (latest, row) => (row.createdAt > latest ? row.createdAt : latest),
    run.createdAt,
  );

  return {
    id: run.id,
    module: run.module,
    status: run.status,
    error: run.error,
    startedAt: run.createdAt.toISOString(),
    lastWriteAt: lastWrite.toISOString(),
    // Shown as the signer's name (`signers.ts`); the run still records the email.
    signedBy: nameIn(names, run.signedBy),
    signedAt: run.signedAt?.toISOString() ?? null,
    spend:
      run.inputTokens === null || run.outputTokens === null
        ? null
        : {
            input: run.inputTokens,
            output: run.outputTokens,
            rand: costOf({ input: run.inputTokens, output: run.outputTokens }),
          },
    rows: rows.map((row) => asBillRow(row, names)),
  };
}

/** One approved bill, as a downstream step would read it — §1.3.1's frozen `output`. */
export interface SignedBill {
  runId: string;
  by: string;
  at: string;
  rows: BillRow[];
}

/**
 * **The downstream read**, for a row-shaped step.
 *
 * `signed_at is not null` is in the `where` clause, and the rows come back from `output_*` rather
 * than from `working`: a draft is not filtered out by an `if` a future writer could forget or
 * invert, it is not in the result set. The same sentence `loadSignedOutput` carries, and the same
 * reason — this is what stops an unapproved bill reaching a tender or a certificate.
 *
 * Struck rows are excluded. A row a QS omitted is not in the bill, and leaving it here with a null
 * amount would invite a caller to count it.
 */
export async function loadSignedBill(
  projectId: string,
  module: string,
): Promise<SignedBill | null> {
  const [run] = await db
    .select({ id: runs.id, signedBy: runs.signedBy, signedAt: runs.signedAt })
    .from(runs)
    .where(
      and(
        eq(runs.projectId, projectId),
        eq(runs.module, module),
        isNotNull(runs.signedAt),
        isNull(runs.deletedAt),
      ),
    )
    .orderBy(desc(runs.signedAt))
    .limit(1);

  if (!run?.signedBy || !run.signedAt) return null;

  const names = await signerNames();
  const rows = await db
    .select()
    .from(runItems)
    .where(and(eq(runItems.runId, run.id), isNull(runItems.omittedAt)))
    .orderBy(asc(runItems.seq));

  return {
    runId: run.id,
    by: nameIn(names, run.signedBy),
    at: run.signedAt.toISOString(),
    rows: rows.map((row) => asBillRow(row, names)),
  };
}

/**
 * Every rate build-up on a bill, keyed by the row it belongs to — PLATFORM.md §4.8.
 *
 * Two queries for the whole bill rather than one per row: a bill runs to thousands of items (§6.8)
 * and a build-up behind each of them would otherwise be a page that gets slower the more work a QS
 * has done.
 *
 * The **computed rate is not read back**, because it is not stored. `computeBuildUp` derives it
 * from these components wherever it is needed, which is the only way the editor and the writer can
 * be guaranteed to agree about what the build-up comes to.
 */
export async function loadBuildUps(runId: string): Promise<Map<string, BuildUp>> {
  const heads = await db
    .select({
      id: rateBuildUps.id,
      runItemId: rateBuildUps.runItemId,
      wasteRate: rateBuildUps.wasteRate,
      markupRate: rateBuildUps.markupRate,
      plugRate: rateBuildUps.plugRate,
      plugRatePrecision: rateBuildUps.plugRatePrecision,
      createdBy: rateBuildUps.createdBy,
    })
    .from(rateBuildUps)
    .innerJoin(runItems, eq(runItems.id, rateBuildUps.runItemId))
    .where(eq(runItems.runId, runId));

  if (heads.length === 0) return new Map();

  const components = await db
    .select()
    .from(rateComponents)
    .where(inArray(rateComponents.buildUpId, heads.map((head) => head.id)))
    .orderBy(asc(rateComponents.seq));

  const byBuildUp = new Map<string, BuildUp["components"]>();
  for (const component of components) {
    const list = byBuildUp.get(component.buildUpId) ?? [];
    list.push({
      id: component.id,
      seq: component.seq,
      kind: component.kind,
      description: component.description,
      quantity: component.quantity,
      rate:
        component.rate === null
          ? null
          : { value: component.rate.toString(), precision: component.ratePrecision ?? 2 },
    });
    byBuildUp.set(component.buildUpId, list);
  }

  return new Map(
    heads.map((head) => [
      head.runItemId,
      {
        id: head.id,
        itemId: head.runItemId,
        wasteRate: head.wasteRate,
        markupRate: head.markupRate,
        plug:
          head.plugRate === null
            ? null
            : { value: head.plugRate.toString(), precision: head.plugRatePrecision ?? 2 },
        by: head.createdBy,
        components: byBuildUp.get(head.id) ?? [],
      },
    ]),
  );
}

/** Where the next row goes, so an append does not collide with the rows already there. */
export async function nextSeq(runId: string): Promise<number> {
  const [last] = await db
    .select({ seq: runItems.seq })
    .from(runItems)
    .where(eq(runItems.runId, runId))
    .orderBy(desc(runItems.seq))
    .limit(1);

  return (last?.seq ?? 0) + SEQ_STEP;
}

/** How a hand-entered row records where its quantity came from (§6.3). */
export const handEntered = (pasted: boolean): QuantitySource => (pasted ? "imported" : "manual");
