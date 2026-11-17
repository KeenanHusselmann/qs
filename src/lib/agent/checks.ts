/**
 * What a QS reviewing this job would point at – computed, so the advisor can suggest it.
 *
 * ── Why the advisor needs these ────────────────────────────────────────────────────────────
 *
 * The advisor was given where the job stands (which steps are signed, which documents are missing)
 * and nothing about the work itself, so its counsel was the same for every job at the same step:
 * "review the bill", "check the tenders". A senior QS reading the bill would say which part needs
 * looking at and why. These checks are that reading, done by the platform rather than the model:
 * the arithmetic is exact here and the model only turns a finding into an action.
 *
 * ── Worded without figures, deliberately ───────────────────────────────────────────────────
 *
 * The advisor may not state a figure (`HAS_FIGURE` in `advisor.ts`): a number in its voice traces to
 * nothing. So a finding is a sentence with no digits – "a tenderer is far below our estimate" – and
 * the figures stay on the step the finding names, where they trace to the bill and the returns.
 *
 * Pure: rows and returns in, sentences out.
 */

import { againstEstimate, collusionIndicators, sameScopeTotals, type EvaluationItem, type EvaluationReturn } from "@/domain/tender-evaluation";
import { workingRow, type BillRow } from "@/lib/agent/bill";

/** Provisional and prime-cost sums above this share of a bill leave too much of the price unfixed. */
export const FIXED_SUM_SHARE = 1 / 7;
/** A tender this far under our estimate is either an error or a bid that will be recovered later. */
export const FAR_BELOW = 0.2;

const amountOf = (row: BillRow): number => (row.amount === null || row.amount === undefined ? 0 : Number(row.amount));

/** The bill's own gaps: what is unmeasured, unpriced, or left to fixed sums. */
export function billChecks(rows: readonly BillRow[]): string[] {
  const items = rows.filter((r) => r.rowType === "item" && !r.omitted);
  if (items.length === 0) return [];

  const findings: string[] = [];
  const working = items.map(workingRow);
  if (working.some((w) => w.quantity === null)) {
    findings.push("Some bill items have no quantity yet: they need measuring in Take-off before the bill can be signed.");
  }
  if (working.some((w) => w.rate === null)) {
    findings.push("Some bill items have no rate yet: they can be priced from the rate library on the Pricing page.");
  }

  const fixed = rows.filter((r) => (r.rowType === "provisional_sum" || r.rowType === "prime_cost") && !r.omitted).reduce((t, r) => t + amountOf(r), 0);
  const measured = items.reduce((t, r) => t + amountOf(r), 0);
  if (fixed > 0 && fixed / (fixed + measured) > FIXED_SUM_SHARE) {
    findings.push("Provisional and prime-cost sums are more than a seventh of the bill: much of the price is not yet fixed, so firm up the largest before tender.");
  }
  return findings;
}

/** What the tender returns say against our estimate and against each other. */
export function tenderChecks(items: readonly EvaluationItem[], returns: readonly EvaluationReturn[]): string[] {
  if (returns.length === 0) return [];
  const findings: string[] = [];
  // A name with a digit in it ("Phase 2 Builders") would carry a figure into the advice and get the
  // whole action dropped by the advisor's rule, so such a tenderer is named by role instead.
  const named = (t: { tenderer: string }) => (/\d/.test(t.tenderer) ? "a tenderer" : t.tenderer);
  const { tenderers } = againstEstimate(items, returns);

  const far = tenderers.filter((t) => t.variance !== null && t.variance < -FAR_BELOW);
  if (far.length > 0) {
    findings.push(
      `${far.map(named).join(" and ")} ${far.length === 1 ? "is" : "are"} far below our estimate: check for an arithmetic error or front-loaded rates before recommending.`,
    );
  }
  const gaps = tenderers.filter((t) => t.unpriced > 0);
  if (gaps.length > 0) {
    findings.push(`${gaps.map(named).join(" and ")} left items unpriced: settle how those items are treated before the tenders are compared.`);
  }
  const scope = sameScopeTotals(items, returns);
  const headlineLowest = scope.find((t) => t.headlineRank === 1);
  if (scope.length > 1 && headlineLowest && headlineLowest.rank !== 1) {
    findings.push(
      `${named(headlineLowest)} is lowest on its own prices but not once every tender covers the whole bill: ${named(scope[0]!)} is lowest on the same scope, so compare them on that basis before recommending.`,
    );
  }
  if (collusionIndicators(items, returns).indicators.length > 0) {
    findings.push("Two or more tenderers priced at a constant multiple of each other's rates: a collusion indicator to investigate before award.");
  }
  return findings;
}
