import { notFound } from "next/navigation";

import { BulkImport } from "@/components/documents/bulk-import";
import { CorpusReview } from "@/components/documents/corpus-review";
import { getProject } from "@/app/(app)/projects/actions";
import { reviewCorpus } from "@/app/(app)/projects/[id]/review-actions";
import { listDocuments } from "@/app/(app)/projects/[id]/actions";

/**
 * The project corpus — everything filed, and what the agent makes of it (§1.3.2).
 *
 * The module pages file one document against one requirement, which is right when a QS has a
 * document in hand. This is the other case: a project arrives as a folder of forty files and
 * nobody should classify them one at a time (§1.1).
 *
 * Named for the corpus rather than for the import, because the corpus is what persists. An import
 * happens on a Tuesday; the documents are read by every step for the life of the project.
 */
export async function ProjectCorpus({ projectId: id }: { projectId: string }) {
  const project = await getProject(id);
  if (!project) notFound();

  const filed = await listDocuments(id);
  // The agent's read of what is already here. Measured at ingest, so this is a query rather than
  // forty PDFs being re-opened on every page load.
  const reviewed = await reviewCorpus(id);

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col px-8 py-6">
      <header>
        <h1 className="t-xl text-[var(--n-800)]">Documents</h1>
        <p className="t-md mt-0.5 text-[var(--n-500)]">{project.name}</p>
      </header>

      <p className="t-sm mt-4 max-w-[70ch] text-[var(--n-600)]">
        Everything filed here goes into one corpus, and the checklists read from it — a geotechnical
        report filed once satisfies the requirement on Site &amp; zoning without being filed again.
        {filed.length > 0 && (
          <>
            {" "}
            <span className="font-medium text-[var(--n-800)]">
              {filed.length} {filed.length === 1 ? "document is" : "documents are"} already filed.
            </span>
          </>
        )}
      </p>

      <div className="mt-5">
        <BulkImport projectId={id} />
      </div>

      <CorpusReview projectId={id} reviewed={reviewed} />
    </div>
  );
}
