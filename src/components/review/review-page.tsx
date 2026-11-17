import { notFound } from "next/navigation";

import { getProject } from "@/app/(app)/projects/actions";
import { ReviewView } from "@/components/review/review-view";
import { estimate, optionComparison, queryCounts, reviewFindings, statusCounts } from "@/domain/design-review";
import { requireSession } from "@/lib/auth";
import { listReviews, loadReview } from "@/lib/design-review";

/**
 * Design review – a draft bill read line by line against the design (D3.1).
 *
 * Loaded on the server like every register. The estimate, the comparison and the findings are
 * computed here from the rows rather than stored, so they cannot drift from the rows they describe.
 */
export async function ReviewPage({ projectId, reviewId }: { projectId: string; reviewId?: string }) {
  await requireSession();
  const project = await getProject(projectId);
  if (!project) notFound();

  const reviews = await listReviews(projectId);
  const chosen = reviews.find((r) => r.id === reviewId) ?? reviews[0] ?? null;
  const review = chosen ? await loadReview(projectId, chosen.id) : null;

  return (
    <ReviewView
      projectId={projectId}
      projectName={project.name}
      reviews={reviews.map((r) => ({ id: r.id, title: r.title }))}
      review={review}
      computed={
        review
          ? {
              estimates: estimate(review),
              comparison: optionComparison(review.items, review.options, review.baseOption),
              findings: reviewFindings(review),
              counts: statusCounts(review.items),
              queries: queryCounts(review.queries),
            }
          : null
      }
    />
  );
}
