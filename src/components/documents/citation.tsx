/**
 * A value's provenance, rendered — PLATFORM.md §1.3.2.
 *
 * The document, openable, and the passage, **never shortened**. It was written inside the run
 * panel's table and the bill needs the identical thing under each of its rows: same promise, same
 * words, and no chance of one surface quietly starting to truncate what the other shows in full.
 *
 * `DocumentLink` truncates by default, which is right for a list of filenames and wrong here.
 * Rendered in a citation it produced "DEMACON_Wewe (Kings Estate) Residential Mark…" with the page
 * number pushed under the next column and clipped — and a citation a reader cannot finish reading is
 * not a citation, because the whole promise of §1.3.2 is that they can go and check it.
 */

import { DocumentLink } from "@/components/documents/document-link";
import type { Citation as SourceCitation } from "@/lib/agent/run";

export function Citation({
  citation,
  note,
  projectId,
}: {
  citation: SourceCitation | null;
  /** Why there is no citation, when there is none. Carries the caught-fabrication case. */
  note?: string | null;
  projectId: string;
}) {
  if (!citation) {
    // No document to cite. The note carries the reason instead — including the one that matters
    // most, a quote the agent offered that was not in the corpus and was discarded. It must not be
    // dressed as a quotation from a document that does not exist.
    return <span className="t-sm text-[var(--n-500)]">{note ?? "No source."}</span>;
  }

  return (
    <>
      <span className="flex flex-wrap items-baseline gap-x-1.5">
        {citation.documentId ? (
          <DocumentLink
            projectId={projectId}
            documentId={citation.documentId}
            filename={citation.document}
            className="t-sm [&>span]:break-all [&>span]:whitespace-normal"
          />
        ) : (
          // Deleted after the run cited it. Pretending it can be opened would be worse than saying
          // it cannot.
          <span className="t-sm text-[var(--n-500)]">{citation.document}</span>
        )}
        {citation.page !== undefined && (
          <span className="num t-xs text-[var(--n-400)]">p.{citation.page}</span>
        )}
      </span>
      <span className="t-sm mt-0.5 block break-words text-[var(--n-500)] italic">
        &ldquo;{citation.quote}&rdquo;
      </span>
    </>
  );
}
