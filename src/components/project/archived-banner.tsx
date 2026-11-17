/**
 * The line an archived project carries on every one of its pages.
 *
 * Round-1 testing: "once it's archived the project is hard to find. There's no clear Archived label,
 * almost as though it was deleted." The list and the palette now keep it; this is the other half –
 * somebody who follows a link into an archived job is told so where they land, and can put it back
 * without hunting for Project Details.
 */

import { ArchiveRestore } from "lucide-react";

import { setArchived } from "@/app/(app)/projects/[id]/settings-actions";

export function ArchivedBanner({ projectId }: { projectId: string }) {
  return (
    <div
      data-region="archived-banner"
      role="status"
      className="t-sm flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--n-200)] bg-[var(--n-50)] px-8 py-1.5 text-[var(--n-700)]"
    >
      <span className="rounded-[var(--r-sm)] bg-[var(--n-200)] px-1.5 py-0.5 font-medium text-[var(--n-800)]">
        Archived
      </span>
      <span className="min-w-0">Out of the working list. Everything in it is still readable.</span>
      <form
        action={async () => {
          "use server";
          await setArchived(projectId, false);
        }}
        className="ml-auto"
      >
        <button
          type="submit"
          className="flex h-7 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] px-2.5 font-medium text-[var(--n-700)] transition-colors hover:bg-[var(--n-100)]"
          style={{ transitionDuration: "var(--m-fast)" }}
        >
          <ArchiveRestore aria-hidden size={14} strokeWidth={1.75} /> Restore project
        </button>
      </form>
    </div>
  );
}
