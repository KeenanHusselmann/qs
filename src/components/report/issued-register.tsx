/**
 * The register of documents this project has issued — PLATFORM.md §4.11, §1.3.1.
 *
 * ── Generated and issued are different, and the screen says so ─────────────────────────────
 *
 * Downloading generates a document live from whatever is signed now. That is the right default and
 * it stays: a live document cannot contradict the figures, because it is derived from them at the
 * moment it is asked for.
 *
 * Issuing keeps a copy of what was actually sent. Re-generating cannot substitute for it, because
 * the figures move — a report re-made in September is not the report a client read in March, and
 * "what did we send them" is the question a practice needs answered when somebody disagrees.
 *
 * ── What each row states, and why ──────────────────────────────────────────────────────────
 *
 * **What it rests on.** The number of signed steps the document was generated from, captured at the
 * moment of issue. Every one of those runs is frozen (`runs_frozen()`) and still readable, so this
 * is not a picture of some numbers — it is a record that can be defended (§1.3.1).
 *
 * A document resting on **nothing signed** is legitimate — a draft bill is a real thing to send —
 * and it is the one somebody should look at twice, so it says so in words rather than being left
 * to a count the reader has to interpret.
 *
 * **Withdrawn, not deleted.** A report that was sent cannot be unsent. Withdrawing says it should
 * no longer be treated as current, which is a different claim from saying it never existed, and
 * §6.1 forbids the second anyway.
 */

"use client";

import { useState, useTransition } from "react";
import { FileText, Table2, Download } from "lucide-react";

import { Panel } from "@/components/shell/panel";
import { formatDate } from "@/lib/dates";
import {
  issueDocument,
  withdrawDocument,
  type IssuedDocument,
} from "@/app/(app)/projects/[id]/document-actions";

const KIND_LABEL: Readonly<Record<string, string>> = {
  viability_report: "Viability report",
  bill_of_quantities: "Bill of Quantities",
  bill_workbook: "Bill of Quantities (workbook)",
  elemental_cost_plan: "Elemental cost plan",
  cost_report: "Cost report",
  rfq_evaluation: "Evaluation of quotations",
  rfq_comparison: "Comparative evaluation (workbook)",
  payment_certificate: "Payment certificate",
  completion_certificate: "Certificate of practical completion",
  meeting_minutes: "Minutes of meeting",
  tender_invitation: "Invitation to tender",
  tender_bill: "Bill of Quantities for tender",
  tender_opening: "Record of tenders opened",
};

const size = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(0)} KB`;

export function IssuedRegister({
  projectId,
  documents,
}: {
  projectId: string;
  documents: readonly IssuedDocument[];
}) {
  const [outcome, setOutcome] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const issue = (kind: "viability_report" | "bill_of_quantities" | "bill_workbook") =>
    start(async () => {
      setOutcome(null);
      const result = await issueDocument(projectId, kind);
      setOutcome(result.ok ? `${result.title} is issued and kept.` : result.reason);
    });

  const current = documents.filter((d) => !d.withdrawnAt);

  return (
    <Panel
      title="Issued documents"
      count={current.length === 0 ? "None yet" : `${current.length} current`}
    >
      <p className="t-sm text-[var(--n-600)]">
        A copy of what was sent, kept as it was, with the signed steps it was generated from.
        Downloading a document elsewhere always generates it fresh from what is signed now — this is
        the record of what a client actually received.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => issue("viability_report")}
          className="t-base flex h-8 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] px-3 font-medium text-[var(--n-700)] hover:bg-[var(--n-50)] disabled:opacity-40"
        >
          <FileText aria-hidden size={14} strokeWidth={1.75} />
          Issue the viability report
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => issue("bill_of_quantities")}
          className="t-base flex h-8 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] px-3 font-medium text-[var(--n-700)] hover:bg-[var(--n-50)] disabled:opacity-40"
        >
          <FileText aria-hidden size={14} strokeWidth={1.75} />
          Issue the bill
        </button>
        {/*
          The same bill, as a sheet somebody prices in.

          A workbook where numbers and amounts have to be calculated, a PDF where the thing is a
          report or a summary - and a bill is on both sides of that line. It is issued and filed,
          which is paper; it is also priced, checked and re-totalled, which is not. Both come off
          the same list of rows, so they cannot become two bills of the same job.
        */}
        <button
          type="button"
          data-action="issue-bill-workbook"
          disabled={pending}
          onClick={() => issue("bill_workbook")}
          className="t-base flex h-8 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] px-3 font-medium text-[var(--n-700)] hover:bg-[var(--n-50)] disabled:opacity-40"
        >
          <Table2 aria-hidden size={14} strokeWidth={1.75} />
          Issue the bill as a workbook
        </button>
      </div>

      {outcome && (
        <p role="status" className="t-sm mt-2 text-[var(--n-700)]">
          {outcome}
        </p>
      )}

      {documents.length === 0 ? (
        /* §7.5 — every list says what goes there rather than sitting blank. */
        <p className="t-sm mt-3 text-[var(--n-500)]">
          Nothing has been issued on this project yet. Issue a document when you send it, and this
          becomes the record of what went out and what it rested on.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col">
          {documents.map((doc) => (
            <li
              key={doc.id}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-[var(--n-100)] py-2 last:border-0"
            >
              <span className="t-base min-w-0 flex-1 text-[var(--n-800)]">
                {KIND_LABEL[doc.kind] ?? doc.kind}
                {doc.withdrawnAt && (
                  <span className="t-xs ml-2 rounded-[var(--r-sm)] bg-[var(--n-100)] px-1.5 py-0.5 text-[var(--n-600)]">
                    Withdrawn
                  </span>
                )}
                <span className="t-xs mt-0.5 block text-[var(--n-500)]">
                  Issued by {doc.issuedBy} on {formatDate(new Date(doc.issuedAt))} · {size(doc.byteSize)}
                </span>
                {/*
                  Said in words, not as a bare count. "Rests on no signed step" is the sentence that
                  makes a reader look, and a "0" beside the others would not.
                */}
                <span
                  className={`t-xs block ${doc.restsOn === 0 ? "text-[var(--warn-700)]" : "text-[var(--n-500)]"}`}
                >
                  {doc.restsOn === 0
                    ? "Rests on no signed step — it was issued from unapproved figures."
                    : `Rests on ${doc.restsOn} signed ${doc.restsOn === 1 ? "step" : "steps"}.`}
                </span>
              </span>

              <a
                href={`/projects/${projectId}/report/pdf?issued=${doc.id}`}
                className="t-sm flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--n-200)] px-2.5 font-medium text-[var(--n-700)] hover:bg-[var(--n-50)]"
              >
                <Download aria-hidden size={12} strokeWidth={2} />
                As issued
              </a>

              {!doc.withdrawnAt && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => start(async () => void (await withdrawDocument(projectId, doc.id)))}
                  title="Mark it superseded. The record of having issued it is kept."
                  className="t-sm h-7 shrink-0 rounded-[var(--r-md)] px-2 text-[var(--n-600)] underline underline-offset-2 disabled:opacity-40"
                >
                  Withdraw
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
