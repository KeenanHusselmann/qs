/**
 * The signed bill and the tender returns, in the shape `domain/tender-evaluation.ts` reads.
 *
 * Rates cross as `{ value, precision }` (minor units, §5.1); the evaluation compares ratios, so they
 * become rands here and nowhere earlier.
 */

import type { EvaluationItem, EvaluationReturn } from "@/domain/tender-evaluation";
import { itemReferences, workingRow, type BillRow } from "@/lib/agent/bill";
import type { TenderReturn } from "@/lib/agent/tender";

const rands = (rate: { value: string; precision: number } | null): number | null =>
  rate === null ? null : Number(rate.value) / 10 ** rate.precision;

export function evaluationInputs(rows: readonly BillRow[], returns: readonly TenderReturn[]): { items: EvaluationItem[]; tenders: EvaluationReturn[] } {
  const refs = itemReferences(rows);
  const items = rows
    .filter((r) => r.rowType === "item" && !r.omitted)
    .map((r): EvaluationItem => {
      const w = workingRow(r);
      const quantity = w.quantity === null ? null : Number(w.quantity);
      return {
        id: r.id,
        ref: refs.get(r.id) ?? "",
        description: w.description ?? "",
        unit: w.unit,
        quantity: quantity !== null && Number.isFinite(quantity) ? quantity : null,
        estimateRate: rands(w.rate),
      };
    });
  const tenders = returns.map((t): EvaluationReturn => ({
    id: t.id,
    tenderer: t.tenderer,
    rates: new Map(t.prices.map((p) => [p.itemId, rands(p.rate)])),
  }));
  return { items, tenders };
}
