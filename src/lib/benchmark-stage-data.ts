/**
 * The bills and tenders a stage benchmark is built from (November meeting).
 *
 * For each project the practice has put in a benchmark – its boundary wall, its blocks of flats – the
 * signed bill is our estimate, and every tender priced against it is the market's answer: their rates
 * against our quantities. Each is broken down by stage in `domain/benchmark-stages.ts`.
 */

import { and, desc, eq, isNotNull, isNull, lte } from "drizzle-orm";

import { db } from "@/db/client";
import { assumptions, projects, runs } from "@/db/schema";
import { breakdown, stageOf, type BenchmarkProfile, type PricedItem, type StageTotal } from "@/domain/benchmark-stages";
import { workingRow, type BillRow } from "@/lib/agent/bill";
import { loadSignedBill } from "@/lib/agent/persist-bill";
import { loadTenderReturns } from "@/lib/agent/persist-tender";

export const profileKey = (profile: string) => `benchmark.profile.${profile}`;

export interface StageSource {
  project: { id: string; name: string };
  /** "Our estimate", or the tenderer's name. */
  label: string;
  kind: "estimate" | "tender";
  stages: StageTotal[];
  total: number;
  /** For the estimate: which items went into which stage, so a misplaced one can be seen. */
  itemsByStage?: Record<string, string[]>;
}

const rands = (rate: { value: string; precision: number } | null) => (rate === null ? null : Number(rate.value) / 10 ** rate.precision);

/** A signed bill's items, as the breakdown reads them – with the heading each one sits under. */
export function pricedItems(rows: readonly BillRow[]): PricedItem[] {
  const headings = new Map(rows.filter((r) => r.rowType === "heading").map((r) => [r.id, workingRow(r).description]));
  return rows
    .filter((r) => (r.rowType === "item" || r.rowType === "provisional_sum" || r.rowType === "prime_cost") && !r.omitted)
    .map((r) => {
      const w = workingRow(r);
      const quantity = w.quantity === null ? null : Number(w.quantity);
      return {
        id: r.id,
        description: w.description ?? "",
        section: r.parentId ? (headings.get(r.parentId) ?? null) : null,
        unit: w.unit,
        quantity: quantity !== null && Number.isFinite(quantity) ? quantity : null,
        rate: rands(w.rate),
        fixed: r.rowType === "provisional_sum" || r.rowType === "prime_cost",
      };
    });
}

/** Projects with a signed bill – the only ones that can say what a stage costs. */
export async function benchmarkCandidates(): Promise<{ id: string; name: string }[]> {
  const rows = await db
    .selectDistinct({ id: projects.id, name: projects.name, at: projects.createdAt })
    .from(runs)
    .innerJoin(projects, eq(projects.id, runs.projectId))
    // Test projects never become benchmarks or past tenders (audit C5).
    .where(and(eq(runs.module, "/bill"), isNotNull(runs.signedAt), isNull(runs.deletedAt), isNull(projects.deletedAt), eq(projects.isTest, false)))
    .orderBy(desc(projects.createdAt));
  return rows.map(({ id, name }) => ({ id, name }));
}

/** The projects the practice has put in this benchmark, newest choice in force. */
export async function chosenProjects(profile: string): Promise<string[]> {
  const [row] = await db
    .select({ value: assumptions.value })
    .from(assumptions)
    .where(and(eq(assumptions.key, profileKey(profile)), lte(assumptions.effectiveFrom, new Date().toISOString().slice(0, 10))))
    .orderBy(desc(assumptions.effectiveFrom), desc(assumptions.createdAt))
    .limit(1);
  try {
    const parsed: unknown = row ? JSON.parse(row.value) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function stageSources(profile: BenchmarkProfile, projectIds: readonly string[], names: ReadonlyMap<string, string>): Promise<StageSource[]> {
  const out: StageSource[] = [];
  for (const id of projectIds) {
    const bill = await loadSignedBill(id, "/bill");
    if (!bill) continue;
    const project = { id, name: names.get(id) ?? "A project" };
    const items = pricedItems(bill.rows);
    const itemsByStage: Record<string, string[]> = {};
    for (const i of items) (itemsByStage[stageOf(profile, i)] ??= []).push(i.description);
    out.push({ project, label: "Our estimate", kind: "estimate", ...breakdown(profile, items), itemsByStage });
    for (const t of await loadTenderReturns(id, bill.runId)) {
      const rates = new Map(t.prices.map((p) => [p.itemId, rands(p.rate)]));
      // Their rates against our quantities; a fixed sum stays as the bill set it.
      const theirs = items.map((i) => (i.fixed ? i : { ...i, rate: rates.get(i.id) ?? null }));
      out.push({ project, label: t.tenderer, kind: "tender", ...breakdown(profile, theirs) });
    }
  }
  return out;
}
