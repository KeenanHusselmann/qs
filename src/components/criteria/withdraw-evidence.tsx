/**
 * Withdrawing the document a criterion is standing on.
 *
 * It used to live in the project-wide documents panel. That panel is gone — filing happens on the
 * row that needs the document — so withdrawing had to follow it, or the capability would have
 * survived only as a server action nobody could reach.
 *
 * Soft delete (§13.4): the record stays so anything that cited it still resolves, but its passages
 * stop answering searches. That is the point — a retracted figure must not keep a process looking
 * ready.
 */

"use client";

import { useTransition } from "react";
import { X } from "lucide-react";

import { removeDocument } from "@/app/(app)/projects/[id]/actions";

export function WithdrawEvidence({
  projectId,
  documentId,
  filename,
}: {
  projectId: string;
  documentId: string;
  filename: string;
}) {
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      aria-label={`Withdraw ${filename}`}
      title="Withdraw — kept on record, but no longer used as evidence"
      onClick={() => start(async () => void (await removeDocument(projectId, documentId)))}
      className="grid size-6 shrink-0 place-items-center rounded-[var(--r-sm)] text-[var(--n-400)] transition-colors hover:bg-[var(--err-50)] hover:text-[var(--err-500)] disabled:opacity-50"
      style={{ transitionDuration: "var(--m-fast)" }}
    >
      <X aria-hidden size={14} strokeWidth={2} />
    </button>
  );
}
