"use server";

/**
 * Design cost control's two acts a person takes – D1.1-SP-003 T04 and T05.
 *
 * Saying why a line of the check moved, and recording what the client decided. Neither changes a
 * figure: the check is computed from the cost plan and the bill, and a decision is appended with the
 * figures it was made on, never edited.
 */

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { getProject } from "@/app/(app)/projects/actions";
import { db } from "@/db/client";
import { costDecisions, costMovementNotes } from "@/db/schema";
import { readAmount } from "@/domain/amount";
import { decisionRefusal, isCostLine, isDecision } from "@/domain/cost-control";
import type { Money } from "@/domain/money";
import { requireSession } from "@/lib/auth";
import { loadCostControl } from "@/lib/cost-control";

export type CostControlAction = { ok: true } | { ok: false; reason: string };

const NOTE_MAX = 1_000;
const path = (projectId: string) => `/projects/${projectId}/cost-control`;

/** Why a line moved. An empty note clears it – the line then has no explanation, which the page shows. */
export async function setMovementNote(projectId: string, line: string, note: string): Promise<CostControlAction> {
  const session = await requireSession();
  if (!(await getProject(projectId))) return { ok: false, reason: "No such project." };
  if (!isCostLine(line)) return { ok: false, reason: "That is not a line of the cost check." };

  const text = (typeof note === "string" ? note : "").trim();
  if (text.length > NOTE_MAX) return { ok: false, reason: `Keep the note under ${NOTE_MAX} characters – the detail belongs in the cost report.` };

  if (text === "") {
    await db.delete(costMovementNotes).where(and(eq(costMovementNotes.projectId, projectId), eq(costMovementNotes.line, line)));
  } else {
    await db
      .insert(costMovementNotes)
      .values({ projectId, line, note: text, setBy: session.email })
      .onConflictDoUpdate({
        target: [costMovementNotes.projectId, costMovementNotes.line],
        set: { note: text, setBy: session.email, setAt: new Date() },
      });
  }

  revalidatePath(path(projectId));
  return { ok: true };
}

/**
 * The client's decision on the cost report.
 *
 * Checked against the figures as they stand **now**, read here rather than taken from the page: a
 * page left open while the bill was repriced would otherwise record "proceed" on an estimate that
 * has since gone over budget. The record carries those figures, so it says what the decision was
 * made on even after the bill moves again.
 */
export async function recordDecision(
  projectId: string,
  input: { decision: string; note: string; revisedBudget: string },
): Promise<CostControlAction> {
  const session = await requireSession();
  if (!(await getProject(projectId))) return { ok: false, reason: "No such project." };
  if (!isDecision(input.decision)) return { ok: false, reason: "Choose what the client decided." };

  const note = (typeof input.note === "string" ? input.note : "").trim();
  if (note.length > NOTE_MAX) return { ok: false, reason: `Keep the reason under ${NOTE_MAX} characters.` };

  let amount: Money | null = null;
  if (input.decision === "revise-budget") {
    const reading = readAmount(input.revisedBudget);
    if (!reading.ok) return { ok: false, reason: `The revised budget: ${reading.reason}` };
    amount = reading.amount;
  }

  const control = await loadCostControl(projectId);
  if (!control.check || !control.costPlan || !control.bill) {
    return { ok: false, reason: "There is nothing to decide on yet: the check needs a signed Cost Plan and a priced bill." };
  }

  const refusal = decisionRefusal(control.check, input.decision, note, amount);
  if (refusal) return { ok: false, reason: refusal };

  await db.insert(costDecisions).values({
    projectId,
    decision: input.decision,
    note,
    revisedBudget: amount,
    budget: control.check.budget,
    detailed: control.check.detailed,
    verdict: control.check.verdict,
    costPlanRunId: control.costPlan.runId,
    billRunId: control.bill.runId,
    decidedBy: session.email,
  });

  revalidatePath(path(projectId));
  return { ok: true };
}
