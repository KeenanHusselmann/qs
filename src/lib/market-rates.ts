/**
 * The practice's past tender rates, for `domain/market-check.ts`.
 *
 * Every project with a signed bill other than this one, and every tender return priced against that
 * bill: each tenderer's rate per item, with the item's own description and unit. Read from signed
 * bills only, so a draft never becomes somebody's benchmark.
 */

import { itemReferences, workingRow, type BillRow } from "@/lib/agent/bill";
import { loadSignedBill } from "@/lib/agent/persist-bill";
import { loadTenderReturns } from "@/lib/agent/persist-tender";
import { benchmarkCandidates } from "@/lib/benchmark-stage-data";
import { marketCheck, type CheckedItem, type MarketFinding, type PastTenderRate } from "@/domain/market-check";

const rands = (rate: { value: string; precision: number } | null): number | null => (rate === null ? null : Number(rate.value) / 10 ** rate.precision);

/** How many past projects are read at most – the newest. Enough for a market, not a full scan per page load. */
const PAST_PROJECTS = 20;

export async function pastTenderRates(exceptProjectId: string): Promise<PastTenderRate[]> {
  const projects = (await benchmarkCandidates()).filter((p) => p.id !== exceptProjectId).slice(0, PAST_PROJECTS);
  const out: PastTenderRate[] = [];
  for (const project of projects) {
    const bill = await loadSignedBill(project.id, "/bill");
    if (!bill) continue;
    const items = new Map(bill.rows.filter((r) => r.rowType === "item" && !r.omitted).map((r) => [r.id, workingRow(r)]));
    for (const tender of await loadTenderReturns(project.id, bill.runId)) {
      for (const price of tender.prices) {
        const row = items.get(price.itemId);
        const rate = rands(price.rate);
        if (!row?.description || rate === null || rate <= 0) continue;
        out.push({ description: row.description, unit: row.unit, rate, project: project.name });
      }
    }
  }
  return out;
}

/** This bill's priced items, as the check reads them. */
export function checkedItems(rows: readonly BillRow[]): CheckedItem[] {
  const refs = itemReferences(rows);
  return rows
    .filter((r) => r.rowType === "item" && !r.omitted)
    .map((r) => {
      const w = workingRow(r);
      return { id: r.id, ref: refs.get(r.id) ?? "", description: w.description ?? "", unit: w.unit, rate: rands(w.rate) };
    });
}

/** A bill's rates against the practice's past tenders. Null when there are no past tenders to compare with. */
export async function marketFindings(projectId: string, rows: readonly BillRow[]): Promise<{ findings: MarketFinding[]; pastRates: number } | null> {
  const past = await pastTenderRates(projectId);
  if (past.length === 0) return null;
  return { findings: marketCheck(checkedItems(rows), past), pastRates: past.length };
}
