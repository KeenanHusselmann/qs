import { notFound } from "next/navigation";

import { getProject } from "@/app/(app)/projects/actions";
import { CostControlView, type CostControlData } from "@/components/cost-control/cost-control-view";
import { requireSession } from "@/lib/auth";
import { loadCostControl } from "@/lib/cost-control";

/**
 * Design cost control – the detailed estimate against the cost plan's targets (D1.1-SP-003).
 *
 * Computed here from the signed cost plan and the bill on every visit, so a bill item priced is a
 * check changed at once. Money crosses to the client as cent strings: bigint does not serialise.
 */
export async function CostControlPage({ projectId }: { projectId: string }) {
  await requireSession();
  const project = await getProject(projectId);
  if (!project) notFound();

  const control = await loadCostControl(projectId);
  const s = (m: bigint | null) => (m === null ? null : m.toString());

  const data: CostControlData = {
    costPlan: control.costPlan ? { by: control.costPlan.by, at: control.costPlan.at } : null,
    bill: control.bill ? { signed: control.bill.signed, by: control.bill.by, at: control.bill.at } : null,
    check: control.check
      ? {
          lines: control.check.lines.map((l) => ({
            id: l.id,
            label: l.label,
            target: s(l.target),
            unreadable: l.unreadable,
            detailed: l.detailed.toString(),
            items: l.items,
            unpriced: l.unpriced,
            movement: s(l.movement),
            movementBp: l.movementBp,
            status: l.status,
          })),
          budget: s(control.check.budget),
          budgetSource: control.check.budgetSource,
          budgetUnreadable: control.check.budgetUnreadable,
          detailed: control.check.detailed.toString(),
          movement: s(control.check.movement),
          movementBp: control.check.movementBp,
          verdict: control.check.verdict,
          findings: control.check.findings,
        }
      : null,
    notes: Object.fromEntries(control.notes),
    decisions: control.decisions.map((d) => ({
      id: d.id,
      decision: d.decision,
      note: d.note,
      revisedBudget: s(d.revisedBudget),
      detailed: d.detailed.toString(),
      verdict: d.verdict,
      by: d.by,
      at: d.at,
      inForce: control.revision?.id === d.id,
    })),
  };

  return <CostControlView projectId={projectId} projectName={project.name} data={data} />;
}
