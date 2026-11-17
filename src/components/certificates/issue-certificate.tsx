"use client";

/**
 * Issue the certificate a signed step produces – on the step itself.
 *
 * A signed valuation is the figures; a payment certificate is the document the contractor is paid
 * on. The button sits where the signature is, issues through the one register (so the bytes sent
 * are kept and a certificate cannot be issued twice), and offers the download of what was kept.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileCheck2 } from "lucide-react";

import { issueDocument } from "@/app/(app)/projects/[id]/document-actions";

export function IssueCertificate({
  projectId,
  kind,
  runId,
  label,
  issued,
}: {
  projectId: string;
  kind: "payment_certificate" | "completion_certificate";
  runId?: string;
  label: string;
  /** The current issued copy for this run, if there is one. */
  issued: { id: string; issuedAt: string; issuedBy: string } | null;
}) {
  const router = useRouter();
  const [pending, act] = useTransition();
  const [said, setSaid] = useState<string | null>(null);

  return (
    <div data-region="issue-certificate" className="flex flex-wrap items-center gap-3 rounded-[var(--r-lg)] border border-[var(--n-200)] px-4 py-3">
      <FileCheck2 aria-hidden size={16} strokeWidth={1.75} className="shrink-0 text-[var(--a-500)]" />
      <p className="t-sm min-w-0 flex-1 text-[var(--n-700)]">
        {issued ? (
          <>
            <span className="font-medium text-[var(--n-800)]">{label}</span> issued {new Date(issued.issuedAt).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })} by {issued.issuedBy}. The copy sent is kept in the register.
          </>
        ) : (
          <>The signed figures are ready to certify. Issuing keeps the document exactly as sent, under your name.</>
        )}
      </p>
      {issued ? (
        <a
          href={`/projects/${projectId}/report/pdf?issued=${issued.id}`}
          data-action="download-certificate"
          className="t-sm flex h-8 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--n-200)] px-2.5 font-medium text-[var(--n-700)] hover:bg-[var(--n-50)]"
        >
          Download
        </a>
      ) : (
        <button
          type="button"
          data-action="issue-certificate"
          disabled={pending}
          onClick={() =>
            act(async () => {
              const result = await issueDocument(projectId, kind, runId);
              setSaid(result.ok ? null : result.reason);
              if (result.ok) router.refresh();
            })
          }
          className="t-sm flex h-8 items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--n-800)] px-3 font-medium text-white hover:bg-[var(--n-900)] disabled:opacity-50"
        >
          {pending ? "Issuing…" : `Issue ${label.toLowerCase()}`}
        </button>
      )}
      {said && (
        <p role="alert" className="t-sm w-full text-[var(--err-700)]">
          {said}
        </p>
      )}
    </div>
  );
}
