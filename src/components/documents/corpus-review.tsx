/**
 * What the import agent found, and what a person does about it — PLATFORM.md §1.1.
 *
 * ── Every row is a proposal, and every proposal shows its working ──────────────────────────
 *
 * The verdict is never the whole of what is displayed. "Reference only" on its own is an opinion a
 * QS has to either accept or ignore, with no way to judge which; "1 230 drawing operations — a
 * picture placed on a page, not geometry, where a technical drawing on this corpus has 2 256 170"
 * is a measurement they can disagree with. The agent's job is to hand over the number it acted on.
 *
 * ── Archiving stays a human action ─────────────────────────────────────────────────────────
 *
 * Nothing on this screen removes anything by itself. The button beside a proposal is the same
 * Withdraw a person could have clicked anyway, and it is a soft delete (§13.4) — the row survives
 * so anything that cited it still resolves. The corpus is evidence. An agent that tidied it
 * silently would eventually drop the copy that turned out to be the signed one, and nobody would
 * know until it was needed.
 *
 * ── Everything filed, with the flagged rows first ──────────────────────────────────────────
 *
 * This listed only the documents the agent had an objection to, on the argument that forty rows of
 * "this is fine" is a screen people stop reading. That was half right and one thing short: it left
 * nowhere to see the corpus as a whole, and nowhere to clear it. A folder imported wrongly — the
 * wrong folder, kinds guessed before anyone looked — could only be undone one row at a time from
 * the pages that happened to mention each document.
 *
 * So the whole corpus is here, ordered so the agent's objections are still what a reader meets
 * first, and the rest is a plain list underneath.
 */

"use client";

import { useState } from "react";
import { Check, Copy, FileStack, ImageOff, Layers, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

import { removeAllDocuments, removeDocument } from "@/app/(app)/projects/[id]/actions";
import { DocumentLink, DocumentOrigin } from "@/components/documents/document-link";
import { VERDICTS, type Verdict } from "@/lib/ingest/import-agent";
import type { ReviewedDocument } from "@/app/(app)/projects/[id]/review-actions";

const ICONS: Record<Verdict, typeof Copy> = {
  "carries-data": Check,
  "reference-only": ImageOff,
  duplicate: Copy,
  superseded: Layers,
};

export function CorpusReview({
  projectId,
  reviewed,
}: {
  projectId: string;
  reviewed: readonly ReviewedDocument[];
}) {
  const router = useRouter();
  const [withdrawing, setWithdrawing] = useState<string | null>(null);

  if (reviewed.length === 0) return null;

  const flagged = reviewed.filter((d) => VERDICTS[d.judgement.verdict].archive);

  /**
   * Grouped by verdict, objections first.
   *
   * Every row used to carry its own sentence — "1 230 drawing operations, a picture placed on a
   * page, not geometry. A technical drawing on this corpus has 2 256 170." Forty of those is forty
   * paragraphs at the same weight as everything around them, three quarters of it the same
   * yardstick repeated, and the figure a reader actually wants buried mid-clause.
   *
   * The interpretation belongs to the verdict, so it is said once above the group. What is left on
   * the row is the fact: a name, where it came from, and the number that put it there.
   */
  const order: Verdict[] = ["duplicate", "superseded", "reference-only", "carries-data"];
  const groups = order
    .map((verdict) => ({ verdict, rows: reviewed.filter((d) => d.judgement.verdict === verdict) }))
    .filter((group) => group.rows.length > 0);

  return (
    <section className="mt-8" data-region="corpus">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex items-baseline gap-2">
          <FileStack aria-hidden size={15} strokeWidth={1.75} className="translate-y-0.5 text-[var(--n-400)]" />
          <h2 className="t-lg text-[var(--n-800)]">What is in the corpus</h2>
        </div>

        <span className="t-sm text-[var(--n-500)]">
          <span className="num font-medium text-[var(--n-800)]">{reviewed.length}</span> filed
          {flagged.length > 0 && (
            <>
              {" · "}
              <span className="text-[var(--warn-700)]">{flagged.length} may not be worth keeping</span>
            </>
          )}
        </span>
      </div>

      <p className="t-sm mt-0.5 max-w-[70ch] text-[var(--n-500)]">
        Everything this project has, measured when it was filed. Nothing is removed automatically —
        withdrawing is yours to do.
      </p>

      <div className="mt-4 flex flex-col gap-5">
        {groups.map(({ verdict, rows }) => {
          const { label, archive, one, many, explanation } = VERDICTS[verdict];
          const Icon = ICONS[verdict];

          return (
            // `data-archive` marks the groups the agent is proposing be removed. It is here for the
            // end-to-end check that the site's geometry is never one of them — asserting that on the
            // heading's wording would re-fail every time the copy is edited.
            <div key={verdict} data-verdict={verdict} data-archive={archive ? "" : undefined}>
              <h3 className={`t-base font-semibold ${archive ? "text-[var(--warn-700)]" : "text-[var(--n-800)]"}`}>
                {rows.length} {rows.length === 1 ? one : many}
              </h3>
              <p className="t-sm mt-0.5 max-w-[72ch] text-[var(--n-500)]">{explanation}</p>

              <ul className="mt-1.5 flex flex-col">
                {rows.map((document) => (
                  <li
                    key={document.id}
                    className="flex items-start gap-3 border-b border-[var(--n-100)] py-2 last:border-b-0"
                  >
                    <Icon
                      aria-label={label}
                      size={14}
                      strokeWidth={1.75}
                      className={`mt-1 shrink-0 ${archive ? "text-[var(--warn-700)]" : "text-[var(--ok-500)]"}`}
                    />

                    <div className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <DocumentLink
                          projectId={projectId}
                          documentId={document.id}
                          filename={document.filename}
                        />
                        <span className="t-xs text-[var(--n-400)]">{document.kind}</span>
                      </span>

                      {/*
                        Where it came from and what it measured, on one quiet line. The number is
                        the part a QS can disagree with, so it is a figure rather than a clause.
                      */}
                      <span className="t-xs block truncate text-[var(--n-500)]">
                        <DocumentOrigin sourcePath={document.sourcePath} inline />
                        {document.sourcePath ? " · " : ""}
                        <span className="num">{document.judgement.detail}</span>
                      </span>
                    </div>

                    <button
                      type="button"
                      disabled={withdrawing === document.id}
                      onClick={async () => {
                        setWithdrawing(document.id);
                        try {
                          await removeDocument(projectId, document.id);
                          router.refresh();
                        } finally {
                          setWithdrawing(null);
                        }
                      }}
                      title="Withdraw — kept on record, but no longer used as evidence"
                      className="t-sm h-7 shrink-0 rounded-[var(--r-md)] border border-[var(--n-200)] px-2.5 text-[var(--n-700)] transition-colors hover:border-[var(--err-500)] hover:bg-[var(--err-50)] hover:text-[var(--err-700)] disabled:opacity-50"
                      style={{ transitionDuration: "var(--m-fast)" }}
                    >
                      {withdrawing === document.id ? "Withdrawing…" : "Withdraw"}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <ClearCorpus projectId={projectId} count={reviewed.length} />
    </section>
  );
}

/**
 * Emptying the corpus, behind a typed confirmation.
 *
 * ── Why it is here and not on each page ────────────────────────────────────────────────────
 *
 * One corpus, filed in one place, so cleared in one place. The module pages show the slice of it
 * each of them needs; clearing from Site & zoning would raise the question of what happened to the
 * documents that page never showed. This is the screen that owns the whole thing.
 *
 * ── Typed, because this one genuinely destroys ─────────────────────────────────────────────
 *
 * Withdrawing a document is soft: the row stays, the file stays, and anything that cited it still
 * resolves. **This is not that.** Rows, passages and stored bytes go, and the space with them —
 * which is the point, because a folder dropped twice is not history worth keeping. Four attempts at
 * the same import left one project holding 298 rows to show 54 documents, each withdrawn one still
 * paying for its stored original.
 *
 * So the consequence is stated before the confirmation is asked for, in the words it deserves, and
 * a phrase has to be typed. A control that destroys a forty-document corpus on one stray click
 * during a scroll is not a control, it is a trap.
 */
function ClearCorpus({ projectId, count }: { projectId: string; count: number }) {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  /** Why it did not happen — a signed run citing these documents is the one case. */
  const [refused, setRefused] = useState<string | null>(null);

  const PHRASE = "remove all";
  const matches = confirmation.trim().toLowerCase() === PHRASE;

  return (
    <div className="mt-5 rounded-[var(--r-lg)] border border-[var(--err-500)]/30 bg-[var(--err-50)]/40 p-4">
      <h3 className="t-base font-semibold text-[var(--err-700)]">Start the corpus again</h3>
      <p className="t-sm mt-1 max-w-[70ch] text-[var(--n-600)]">
        <span className="font-medium text-[var(--err-700)]">Deletes</span> all {count}{" "}
        {count === 1 ? "document" : "documents"}, everything read from them and the stored files. There is no undo.
      </p>
      <p className="t-sm mt-1.5 max-w-[70ch] text-[var(--n-500)]">
        For a single document you have decided against, use Withdraw above instead: that keeps the
        record and the file, so anything already citing it still works.
      </p>

      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!matches || busy) return;

          setBusy(true);
          try {
            const outcome = await removeAllDocuments(projectId);
            setConfirmation("");

            if ("refused" in outcome) {
              setRefused(outcome.refused);
              return;
            }

            setRefused(null);
            setDone(outcome.deleted);
            router.refresh();
          } finally {
            setBusy(false);
          }
        }}
        className="mt-3 flex flex-wrap items-end gap-2.5"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="clear-corpus" className="t-sm text-[var(--n-600)]">
            Type <span className="font-medium text-[var(--n-800)]">{PHRASE}</span> to confirm
          </label>
          <input
            id="clear-corpus"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            autoComplete="off"
            className="t-base h-8 w-[220px] rounded-[var(--r-sm)] border border-[var(--n-200)] bg-[var(--n-0)] px-2.5 outline-none focus:border-[var(--err-500)]"
          />
        </div>

        <button
          type="submit"
          disabled={!matches || busy}
          className="t-base flex h-8 items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--err-500)] px-3 font-medium text-white transition-colors hover:bg-[var(--err-700)] disabled:cursor-not-allowed disabled:opacity-40"
          style={{ transitionDuration: "var(--m-fast)" }}
        >
          <Trash2 aria-hidden size={14} strokeWidth={1.75} />
          {busy ? "Deleting…" : `Delete all ${count}`}
        </button>
      </form>

      {/* A refusal that names what is stopping it and what to do instead (§7.7). The alternative —
          a button that does nothing — reads as a broken screen. */}
      {refused && (
        <p role="alert" className="t-sm mt-2 max-w-[70ch] text-[var(--err-700)]">
          {refused}
        </p>
      )}

      {/* Said, not merely done. A screen that empties and says nothing leaves a reader wondering
          whether it worked or whether they were looking at the wrong project. */}
      {done !== null && (
        <p role="status" className="t-sm mt-2 text-[var(--n-700)]">
          {done} {done === 1 ? "document" : "documents"} deleted, with their stored files. Every step
          that was reading them is empty again.
        </p>
      )}
    </div>
  );
}
