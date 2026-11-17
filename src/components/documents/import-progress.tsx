/**
 * What is happening to fifty-nine documents, while it happens — and what became of them after.
 *
 * ── Why a dialog ───────────────────────────────────────────────────────────────────────────
 *
 * A real import is forty to sixty files, several of them tens of megabytes, and it runs for minutes.
 * Before this, the only sign of life was per-row icons somewhere in a long list: a person who
 * scrolled away could not tell whether the import was running, stalled, or finished ten minutes ago,
 * and the row that failed was wherever it happened to be. `<dialog>` with `showModal()` makes the
 * page inert, which is the honest state — nothing else should be touched while the corpus is being
 * written, and there is nothing useful to do until it is.
 *
 * ── It does not close itself ───────────────────────────────────────────────────────────────
 *
 * §7.7: the end of a long operation is the moment its result matters most, and a dialog that
 * vanishes on completion takes the result with it. It stays, states what landed and what did not,
 * and says where the documents have gone — because "filed" is not the end of the story for a QS,
 * "Site & zoning can now see the title deed" is.
 *
 * ── Failures are not hidden behind a total ─────────────────────────────────────────────────
 *
 * "57 of 59 filed" is the sentence that loses two documents. Every failure is listed by name with
 * its own reason, and they are listed *first*.
 */

"use client";

import { useEffect, useRef } from "react";
import { CircleAlert, CircleCheck, Loader2 } from "lucide-react";

import { mb } from "@/lib/ingest/limits";
import { EXPLANATIONS, reasonFor } from "@/lib/ingest/readability";

export interface ImportProgress {
  /** Every file in this batch, in the order they will be filed. */
  total: number;
  filed: number;
  /** Name, and why it did not file. Shown in full — a count would lose them. */
  failed: { name: string; reason?: string }[];
  /**
   * Filed, and nothing could be read from it. Not a failure and not a clean success.
   *
   * The kind travels with it because it decides which of these is a problem: a drawing is meant to
   * be measured rather than read, and reporting that as a shortfall sends someone looking for a fix
   * to something that is working.
   */
  unreadable: { name: string; kind: string; reason?: string }[];
  /** What is being sent right now, and how far through it is. */
  current?: { name: string; size: number; fraction?: number };
  done: boolean;
}

export function ImportProgressDialog({
  progress,
  onClose,
}: {
  progress: ImportProgress | null;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!dialog.current) return;
    if (progress && !dialog.current.open) dialog.current.showModal();
    if (!progress && dialog.current.open) dialog.current.close();
  }, [progress]);

  if (!progress) return <dialog ref={dialog} className="hidden" />;

  const { total, filed, failed, unreadable, current, done } = progress;
  const settled = filed + failed.length;
  const percent = total > 0 ? Math.round((settled / total) * 100) : 0;

  return (
    <dialog
      ref={dialog}
      onCancel={(e) => {
        // Escape must not abandon an import halfway. Nothing here can stop the uploads already in
        // flight, and a dialog that closes while they continue is worse than one that waits.
        if (!done) e.preventDefault();
      }}
      className="w-[min(560px,92vw)] rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-0)] p-0 shadow-lg backdrop:bg-[var(--n-800)]/25"
    >
      <div className="border-b border-[var(--n-100)] px-5 py-4">
        <div className="flex items-center gap-2.5">
          {done ? (
            failed.length > 0 ? (
              <CircleAlert aria-hidden size={17} strokeWidth={1.75} className="text-[var(--warn-700)]" />
            ) : (
              <CircleCheck aria-hidden size={17} strokeWidth={1.75} className="text-[var(--ok-500)]" />
            )
          ) : (
            <Loader2 aria-hidden size={17} strokeWidth={2} className="animate-spin text-[var(--a-500)]" />
          )}

          <h2 className="t-lg text-[var(--n-800)]">
            {done ? "Import finished" : `Filing ${total} ${total === 1 ? "document" : "documents"}`}
          </h2>

          <span className="num t-sm ml-auto text-[var(--n-500)]">
            {settled}/{total}
          </span>
        </div>

        <div
          role="progressbar"
          aria-valuenow={settled}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label="Documents filed"
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--n-200)]"
        >
          <div
            className={`h-full rounded-full transition-[width] ${
              failed.length > 0 ? "bg-[var(--warn-500)]" : "bg-[var(--ok-500)]"
            }`}
            style={{ width: `${percent}%`, transitionDuration: "var(--m-slow)" }}
          />
        </div>

        {/*
          The file being sent, and how far through it is. A 22 MB document over a hotel connection
          is a minute of nothing happening, and a person watching a still screen assumes it hung.
        */}
        {!done && current && (
          <p className="t-sm mt-2 truncate text-[var(--n-600)]">
            {current.name}
            <span className="text-[var(--n-400)]">
              {" · "}
              {current.fraction !== undefined
                ? `${Math.round(current.fraction * 100)}% of ${mb(current.size)} to storage`
                : mb(current.size)}
            </span>
          </p>
        )}
      </div>

      <div className="max-h-[46vh] overflow-y-auto px-5 py-3">
        {/* Failures first and by name. A total is the sentence that loses two documents. */}
        {failed.length > 0 && (
          <>
            <h3 className="t-sm font-semibold tracking-[0.03em] text-[var(--err-700)] uppercase">
              {failed.length} did not file
            </h3>
            <ul className="mt-1 mb-3 flex flex-col gap-1.5">
              {failed.map((f) => (
                <li key={f.name}>
                  <span className="t-sm block truncate text-[var(--n-800)]">{f.name}</span>
                  {f.reason && <span className="t-xs text-[var(--err-700)]">{f.reason}</span>}
                </li>
              ))}
            </ul>
          </>
        )}

        {unreadable.length > 0 && (
          <>
            {/*
              Grouped by cause, because the cause is what decides whether anyone needs to act.

              This was one line — "15 filed but not searchable" — which is the platform describing
              its own index. Searchable is our word, not a QS's; it said nothing about what it cost
              them; it read as a failure when every one of those documents is filed and openable;
              and it collapsed four unrelated situations into one number, hiding the scan that is
              worth acting on among the drawings that are working exactly as designed.
            */}
            <h3 className="t-sm font-semibold tracking-[0.03em] text-[var(--n-500)] uppercase">
              {unreadable.length} filed, but nothing in them could be read
            </h3>
            <p className="t-sm mt-1 max-w-[62ch] text-[var(--n-600)]">
              They are in the corpus and you can open them. What a run cannot do is quote them, so
              they will not satisfy a requirement on their own.
            </p>

            <div className="mt-2 mb-3 flex flex-col gap-3">
              {[...new Map(
                unreadable.map((f) => [reasonFor(f.name, f.kind, f.reason), f] as const),
              ).keys()].map((reason) => {
                const named = unreadable.filter((f) => reasonFor(f.name, f.kind, f.reason) === reason);
                const { one, many, meaning } = EXPLANATIONS[reason];

                return (
                  <div key={reason}>
                    <p className="t-sm font-medium text-[var(--n-800)]">
                      {named.length} {named.length === 1 ? one : many}
                    </p>
                    <p className="t-sm mt-0.5 max-w-[62ch] text-[var(--n-600)]">{meaning}</p>
                    <ul className="mt-1 flex flex-col">
                      {named.map((f) => (
                        <li key={f.name} className="t-xs truncate text-[var(--n-500)]">
                          {f.name}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/*
          What happens next. "Filed" is not the end of the story for a QS — where the documents
          went, and what they now satisfy, is the thing they came here to find out.
        */}
        {done && (
          <p className="t-sm max-w-[62ch] text-[var(--n-600)]">
            {filed > 0 ? (
              <>
                {filed} {filed === 1 ? "document is" : "documents are"} in the corpus and readable by
                every step that needs them — a title deed filed here satisfies Site &amp; zoning
                without being filed again. What was measured about each of them, and anything that
                looks like a duplicate or a superseded revision, is listed below this dialog.
              </>
            ) : (
              <>
                Nothing was filed. The corpus is unchanged, and the reasons above are what to fix
                before trying again.
              </>
            )}
          </p>
        )}
      </div>

      <div className="flex justify-end border-t border-[var(--n-100)] px-5 py-3">
        <button
          type="button"
          disabled={!done}
          onClick={onClose}
          className="t-base h-8 rounded-[var(--r-md)] bg-[var(--a-500)] px-3 font-medium text-white transition-colors hover:bg-[var(--a-600)] disabled:cursor-not-allowed disabled:opacity-40"
          style={{ transitionDuration: "var(--m-fast)" }}
        >
          {done ? "Done" : "Filing…"}
        </button>
      </div>
    </dialog>
  );
}
