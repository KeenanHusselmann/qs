"use server";

/**
 * The elemental cost plan's two decisions a QS makes – D1.1 Cost Plan Revision.
 *
 * What goes on top of the measured work (preliminaries, contingency, escalation, VAT) and the plan's
 * unit of measure; and which element a bill row belongs to. Neither changes a figure in the bill: an
 * allowance is added after it, and an element is how its rows are grouped – which is why both may
 * be set against a signed bill, whose figures stay frozen.
 */

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth";
import { db } from "@/db/client";
import { billElements, costPlanAllowances, elementQuantities, runItems, runs } from "@/db/schema";
import { readPercent, readQuantity } from "@/domain/amount";
import { isElement } from "@/domain/elemental-plan";
import { percentToNumeric, quantityToNumeric } from "@/domain/money";

export type PlanAction = { ok: true } | { ok: false; reason: string; errors?: Record<string, string> };

export async function setAllowances(
  projectId: string,
  input: { preliminaries: string; contingency: string; escalation: string; vat: string; measureLabel: string; measureValue: string },
): Promise<PlanAction> {
  const session = await requireSession();
  const errors: Record<string, string> = {};
  const read = (key: "preliminaries" | "contingency" | "escalation" | "vat", max: number) => {
    const r = readPercent(input[key], { min: 0, max });
    if (!r.ok) {
      errors[key] = r.reason;
      return null;
    }
    return percentToNumeric(r.percent);
  };
  const preliminaries = read("preliminaries", 50);
  const contingency = read("contingency", 50);
  const escalation = read("escalation", 50);
  const vat = read("vat", 30);

  const label = input.measureLabel.trim().slice(0, 80);
  let measureValue: string | null = null;
  if (input.measureValue.trim()) {
    const q = readQuantity(input.measureValue);
    if (!q.ok) errors.measureValue = q.reason;
    else if (q.quantity <= 0n) errors.measureValue = "A measure is more than nought.";
    else measureValue = quantityToNumeric(q.quantity);
    if (!label) errors.measureLabel = "Say what it measures – \"m of boundary wall\", \"m² gross floor area\".";
  }
  if (Object.keys(errors).length) return { ok: false, reason: "Some figures need attention.", errors };

  const values = {
    preliminaries: preliminaries!,
    contingency: contingency!,
    escalation: escalation!,
    vat: vat!,
    measureLabel: measureValue ? label : null,
    measureValue,
    setBy: session.email,
    setAt: new Date(),
  };
  await db
    .insert(costPlanAllowances)
    .values({ projectId, ...values })
    .onConflictDoUpdate({ target: costPlanAllowances.projectId, set: values });
  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true };
}

/**
 * Set an element's unit quantity – "491,05 m of wall" for its substructure, say – or, with an empty
 * quantity, go back to its principal measured item.
 */
export async function setElementQuantity(
  projectId: string,
  element: string,
  input: { quantity: string; unit: string; label: string },
): Promise<PlanAction> {
  const session = await requireSession();
  if (!isElement(element)) return { ok: false, reason: `"${element}" is not an element of the plan.` };
  if (!input.quantity.trim()) {
    await db.delete(elementQuantities).where(and(eq(elementQuantities.projectId, projectId), eq(elementQuantities.element, element)));
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true };
  }
  const errors: Record<string, string> = {};
  const unit = input.unit.trim().slice(0, 20);
  const label = input.label.trim().slice(0, 120);
  const q = readQuantity(input.quantity, { unit });
  if (!q.ok) errors.quantity = q.reason;
  else if (q.quantity <= 0n) errors.quantity = "An element quantity is more than nought.";
  if (!unit) errors.unit = "Give its unit – m², m, m³.";
  if (!label) errors.label = "Say what it measures – \"footprint\", \"gross floor area\", \"length of wall\".";
  if (Object.keys(errors).length || !q.ok) return { ok: false, reason: "The quantity needs attention.", errors };

  const values = { quantity: quantityToNumeric(q.quantity), unit, label, setBy: session.email, setAt: new Date() };
  await db
    .insert(elementQuantities)
    .values({ projectId, element, ...values })
    .onConflictDoUpdate({ target: [elementQuantities.projectId, elementQuantities.element], set: values });
  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true };
}

export async function setElement(projectId: string, runItemId: string, element: string): Promise<PlanAction> {
  const session = await requireSession();
  if (!isElement(element)) return { ok: false, reason: `"${element}" is not an element of the plan.` };
  const [row] = await db
    .select({ id: runItems.id })
    .from(runItems)
    .innerJoin(runs, eq(runs.id, runItems.runId))
    .where(and(eq(runItems.id, runItemId), eq(runs.projectId, projectId), eq(runItems.rowType, "item")))
    .limit(1);
  if (!row) return { ok: false, reason: "That is not an item of this project's bill." };

  await db
    .insert(billElements)
    .values({ runItemId, element, setBy: session.email })
    .onConflictDoUpdate({ target: billElements.runItemId, set: { element, setBy: session.email, setAt: new Date() } });
  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true };
}
