/**
 * Design cost control for one project – the check, the notes on it and the client's decisions.
 *
 * The check is computed here from what the project holds, never stored: the signed cost plan is
 * the target, and the elemental plan built from the bill (`lib/elemental-plan.ts`) is the detailed
 * estimate. The signed bill where there is one, otherwise the draft – and the page says which,
 * because a check against a draft bill is a forecast of the check, not the check.
 */

import { desc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { costDecisions, costMovementNotes } from "@/db/schema";
import { costCheck, isCostLine, isDecision, revisionInForce, type CostCheck, type CostLineId, type Decision } from "@/domain/cost-control";
import { money, type Money } from "@/domain/money";
import { loadSignedFigures } from "@/lib/agent/persist";
import { loadElementalPlan } from "@/lib/elemental-plan";
import { nameIn, signerNames } from "@/lib/signers";

export interface DecisionRecord {
  id: string;
  decision: Decision;
  note: string;
  revisedBudget: Money | null;
  budget: Money | null;
  detailed: Money;
  verdict: string;
  costPlanRunId: string | null;
  by: string;
  at: string;
}

export interface CostControl {
  /** The signed cost plan the targets come from, or null where none is signed. */
  costPlan: { runId: string; by: string; at: string } | null;
  /** The bill the detailed estimate is built from, or null where there is none yet. */
  bill: { runId: string; signed: boolean; by: string | null; at: string | null } | null;
  /** Null where either side is missing – there is nothing to check. */
  check: CostCheck | null;
  notes: ReadonlyMap<CostLineId, { note: string; by: string; at: string }>;
  /** Newest first. */
  decisions: DecisionRecord[];
  /** The revised budget in force for this cost plan, and the decision that approved it. */
  revision: DecisionRecord | null;
}

export async function loadCostControl(projectId: string): Promise<CostControl> {
  const [signed, elemental, noteRows, decisionRows, names] = await Promise.all([
    loadSignedFigures(projectId),
    loadElementalPlan(projectId),
    db.select().from(costMovementNotes).where(eq(costMovementNotes.projectId, projectId)),
    db.select().from(costDecisions).where(eq(costDecisions.projectId, projectId)).orderBy(desc(costDecisions.decidedAt)),
    signerNames(),
  ]);

  const plan = signed.find((step) => step.module === "/cost-plan") ?? null;

  const decisions: DecisionRecord[] = decisionRows
    .filter((d) => isDecision(d.decision))
    .map((d) => ({
      id: d.id,
      decision: d.decision as Decision,
      note: d.note,
      revisedBudget: d.revisedBudget === null ? null : money(d.revisedBudget),
      budget: d.budget === null ? null : money(d.budget),
      detailed: money(d.detailed),
      verdict: d.verdict,
      costPlanRunId: d.costPlanRunId,
      by: nameIn(names, d.decidedBy),
      at: d.decidedAt.toISOString(),
    }));

  const revision = revisionInForce(decisions, plan?.runId ?? null);
  const hasBill = elemental !== null && elemental.items.length > 0;

  return {
    costPlan: plan ? { runId: plan.runId, by: plan.by, at: plan.at } : null,
    bill: elemental ? elemental.bill : null,
    check: plan && hasBill ? costCheck(new Map(plan.fields.map((f) => [f.fieldId, f.value])), elemental.computed, revision?.revisedBudget ?? null) : null,
    notes: new Map(
      noteRows.filter((n) => isCostLine(n.line)).map((n) => [n.line as CostLineId, { note: n.note, by: nameIn(names, n.setBy), at: n.setAt.toISOString() }]),
    ),
    decisions,
    revision,
  };
}
