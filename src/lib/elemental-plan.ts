/**
 * The elemental cost plan for one project, read from its bill – D1.1 Cost Plan Revision.
 *
 * The signed bill where there is one, because that is what the chain lets a downstream step read
 * (§1.3.1); otherwise the draft, said to be one on every surface that shows it. Each row's element
 * is the one the measuring agent or a QS assigned, or – where nobody did – the one its words suggest,
 * and the page says which is which.
 */

import { eq, inArray } from "drizzle-orm";

import { db } from "@/db/client";
import { billElements, costPlanAllowances, elementQuantities } from "@/db/schema";
import { classifyElement, elementalPlan, isElement, ELEMENTS, type Allowances, type ElementalPlan, type ElementId, type ElementQuantity } from "@/domain/elemental-plan";
import { money, parsePercent, parseQuantity, percent, quantityToNumeric, type Quantity } from "@/domain/money";
import { itemReferences, workingRow, type BillRow } from "@/lib/agent/bill";
import { loadLatestBill, loadSignedBill } from "@/lib/agent/persist-bill";

/** Typical figures, shown as assumptions until a QS sets their own. VAT is the statutory 15%. */
export const TYPICAL: Allowances = { preliminaries: percent(1200n), contingency: percent(500n), escalation: percent(0n), vat: percent(1500n) };

export interface PlanItemView {
  id: string;
  ref: string;
  description: string;
  unit: string | null;
  quantity: string | null;
  /** Cents as a decimal string – bigint does not cross to the client. */
  amount: string | null;
  element: ElementId;
  /** Where the element came from: the agent that measured it, a person, or its words. */
  assignedBy: "agent" | "person" | "words";
}

export interface ElementalPlanView {
  bill: { runId: string; signed: boolean; by: string | null; at: string | null };
  items: PlanItemView[];
  plan: {
    elements: {
      id: ElementId;
      label: string;
      amount: string;
      items: number;
      unpriced: number;
      share: number;
      perMeasure: string | null;
      /** The element unit quantity – four-place numeric text – its unit and what it is taken from. */
      quantity: { value: string; unit: string; basis: string; set: boolean } | null;
      /** The element unit rate, in cents. */
      rate: string | null;
    }[];
    net: string;
    preliminaries: string;
    contingency: string;
    escalation: string;
    excludingVat: string;
    vat: string;
    includingVat: string;
    perMeasure: { excludingVat: string; includingVat: string } | null;
    unpriced: number;
  };
  allowances: { preliminaries: string; contingency: string; escalation: string; vat: string; set: { by: string; at: string } | null };
  measure: { label: string; value: string } | null;
}

const pct = (p: bigint) => {
  // 1200n → "12", 1250n → "12,5"
  const whole = p / 100n;
  const frac = (p % 100n).toString().padStart(2, "0").replace(/0+$/, "");
  return frac ? `${whole},${frac}` : `${whole}`;
};

function asView(plan: ElementalPlan) {
  const s = (m: bigint) => m.toString();
  return {
    elements: plan.elements.map((e) => ({
      ...e,
      amount: s(e.amount),
      perMeasure: e.perMeasure === null ? null : s(e.perMeasure),
      quantity: e.quantity ? { ...e.quantity, value: quantityToNumeric(e.quantity.value) } : null,
      rate: e.rate === null ? null : s(e.rate),
    })),
    net: s(plan.net),
    preliminaries: s(plan.preliminaries),
    contingency: s(plan.contingency),
    escalation: s(plan.escalation),
    excludingVat: s(plan.excludingVat),
    vat: s(plan.vat),
    includingVat: s(plan.includingVat),
    perMeasure: plan.perMeasure ? { excludingVat: s(plan.perMeasure.excludingVat), includingVat: s(plan.perMeasure.includingVat) } : null,
    unpriced: plan.unpriced,
  };
}

export async function loadElementalPlan(projectId: string): Promise<(ElementalPlanView & { computed: ElementalPlan }) | null> {
  const signed = await loadSignedBill(projectId, "/bill");
  const latest = signed ? null : await loadLatestBill(projectId, "/bill");
  const rows: readonly BillRow[] = signed?.rows ?? latest?.rows ?? [];
  if (!signed && !latest) return null;

  const items = rows.filter((r) => r.rowType === "item" && !r.omitted);
  const headings = new Map(rows.filter((r) => r.rowType === "heading").map((r) => [r.id, workingRow(r).description ?? null]));
  const refs = itemReferences(rows);
  const assigned = items.length
    ? await db.select().from(billElements).where(inArray(billElements.runItemId, items.map((r) => r.id)))
    : [];
  const byRow = new Map(assigned.map((a) => [a.runItemId, a]));

  const view: PlanItemView[] = items.map((row) => {
    const w = signed ? { description: row.output?.description ?? null, unit: row.output?.unit ?? null, quantity: row.output?.quantity ?? null } : workingRow(row);
    const amount = signed ? (row.output?.amount ?? null) : row.amount;
    const given = byRow.get(row.id);
    const element: ElementId = given && isElement(given.element) ? given.element : classifyElement(w.description ?? "", row.parentId ? (headings.get(row.parentId) ?? null) : null);
    return {
      id: row.id,
      ref: row.itemRef ?? refs.get(row.id) ?? "",
      description: w.description ?? "",
      unit: w.unit,
      quantity: w.quantity,
      amount: amount === null || amount === undefined ? null : String(amount),
      element,
      assignedBy: given ? (given.setBy === "agent" ? "agent" : "person") : "words",
    };
  });

  const [saved] = await db.select().from(costPlanAllowances).where(eq(costPlanAllowances.projectId, projectId)).limit(1);
  const allowances: Allowances = saved
    ? { preliminaries: parsePercent(saved.preliminaries), contingency: parsePercent(saved.contingency), escalation: parsePercent(saved.escalation), vat: parsePercent(saved.vat) }
    : TYPICAL;
  const measure: Quantity | null = saved?.measureValue ? parseQuantity(saved.measureValue) : null;
  const setQuantities = new Map<ElementId, ElementQuantity>(
    (await db.select().from(elementQuantities).where(eq(elementQuantities.projectId, projectId)))
      .filter((q) => isElement(q.element))
      .map((q) => [q.element as ElementId, { quantity: parseQuantity(q.quantity), unit: q.unit, label: q.label }]),
  );

  const computed = elementalPlan(
    view.map((i) => ({
      id: i.id,
      description: i.description,
      element: i.element,
      amount: i.amount === null ? null : money(BigInt(i.amount)),
      quantity: i.quantity ? parseQuantity(i.quantity) : null,
      unit: i.unit,
    })),
    allowances,
    measure,
    setQuantities,
  );

  return {
    bill: signed
      ? { runId: signed.runId, signed: true, by: signed.by, at: signed.at }
      : { runId: latest!.id, signed: false, by: null, at: null },
    items: view,
    plan: asView(computed),
    allowances: {
      preliminaries: pct(allowances.preliminaries),
      contingency: pct(allowances.contingency),
      escalation: pct(allowances.escalation),
      vat: pct(allowances.vat),
      set: saved ? { by: saved.setBy, at: saved.setAt.toISOString() } : null,
    },
    measure: saved?.measureValue && saved.measureLabel ? { label: saved.measureLabel, value: saved.measureValue } : null,
    computed,
  };
}

export { ELEMENTS };
