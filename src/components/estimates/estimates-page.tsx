import { notFound } from "next/navigation";

import { getProject } from "@/app/(app)/projects/actions";
import { EstimatesView } from "@/components/estimates/estimates-view";
import {
  comparisonFindings,
  elementOrder,
  priceAll,
} from "@/domain/estimate-comparison";
import { requireSession } from "@/lib/auth";
import { listComparisons, loadComparison } from "@/lib/estimate-comparison";

/**
 * Estimate comparison – estimates for the same works, element by element (D1.1).
 *
 * The pricing, the gap and the findings are computed here from the lines rather than stored, so a
 * line changed is a total changed, everywhere, at once.
 */
export async function EstimatesPage({
  projectId,
  comparisonId,
}: {
  projectId: string;
  comparisonId?: string;
}) {
  await requireSession();
  const project = await getProject(projectId);
  if (!project) notFound();

  const all = await listComparisons(projectId);
  const chosen = all.find((c) => c.id === comparisonId) ?? all[0] ?? null;
  const comparison = chosen ? await loadComparison(projectId, chosen.id) : null;
  const priced = comparison ? priceAll(comparison) : [];

  return (
    <EstimatesView
      projectId={projectId}
      projectName={project.name}
      comparisons={all}
      comparison={comparison}
      priced={priced}
      order={comparison ? elementOrder(comparison) : []}
      findings={comparison ? comparisonFindings(comparison, priced) : []}
    />
  );
}
