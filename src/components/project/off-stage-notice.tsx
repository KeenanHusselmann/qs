/**
 * A step the practice is not engaged for — PLATFORM.md §7.5, §7.7.
 *
 * ── The sidebar said it and the page did not ───────────────────────────────────────────────
 *
 * A module outside the project's stages is dimmed in the sidebar and filed under a disclosure on
 * the board, both marked "off stage". Its own page said nothing at all: the same header, the same
 * checklist, the same live "Run extraction" button that spends money reading documents for a stage
 * nobody appointed this practice to. The one screen where the fact changes what somebody should do
 * was the one screen that withheld it.
 *
 * ── Stated, not blocked ────────────────────────────────────────────────────────────────────
 *
 * The run is left working, deliberately, and for the reason the board already gives for setting
 * these aside rather than hiding them: a project whose stages were entered wrongly must still be
 * able to reach the step it actually needs, and a QS handed an early document on a late project
 * should be able to file it. Disabling the page would make a data-entry slip at setup into a wall.
 *
 * So this is a statement with an offer attached, not a gate. §7.7 — say what to do next.
 *
 * ── Why the offer is one click and not a link to settings ──────────────────────────────────
 *
 * Reaching this page is nearly always a correction. Sending somebody to a form to work out which
 * of six checkboxes corresponds to the page they are standing on is asking them to translate a
 * thing they already know. `addStage` only ever widens, so the click cannot set other work aside.
 */

"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Layers } from "lucide-react";

import { addStage } from "@/app/(app)/projects/[id]/settings-actions";

export function OffStageNotice({
  projectId,
  stageName,
  phase,
  runs,
}: {
  projectId: string;
  /** The stage this step belongs to — the one the project does not run. */
  stageName: string;
  phase: number;
  /** The stages it does run, by name, so the reader can see the shape of the engagement. */
  runs: readonly string[];
}) {
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);

  return (
    <div
      data-region="off-stage"
      className="mt-4 rounded-[var(--r-lg)] border border-[var(--warn-500)]/40 bg-[var(--warn-50)] px-4 py-3"
    >
      <p className="t-sm flex items-center gap-1.5 font-semibold text-[var(--warn-700)]">
        <Layers aria-hidden size={13} strokeWidth={2} />
        This step is outside the stages this project runs
      </p>

      <p className="t-sm mt-1 max-w-[80ch] text-[var(--n-700)]">
        It belongs to <span className="font-medium text-[var(--n-800)]">{stageName}</span>, and this
        project is engaged for{" "}
        {/* Named rather than counted: "one stage" tells a reader nothing they can check. */}
        {runs.map((name, i) => (
          <span key={name}>
            {i > 0 && (i === runs.length - 1 ? " and " : ", ")}
            <span className="font-medium text-[var(--n-800)]">{name}</span>
          </span>
        ))}
. It is set aside, not blocked – use it if the job needs it.
      </p>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setFailed(false);
              try {
                await addStage(projectId, phase);
              } catch {
                // §1.3 — a failure is said, never swallowed into a button that looks like it worked.
                setFailed(true);
              }
            })
          }
          className="t-sm flex h-8 items-center rounded-[var(--r-md)] border border-[var(--warn-500)]/50 bg-[var(--n-0)] px-3 font-medium text-[var(--n-800)] hover:bg-[var(--warn-50)] disabled:opacity-40"
        >
          {pending ? "Adding…" : `Add ${stageName} to this project`}
        </button>

        <Link
          href={`/projects/${projectId}/settings`}
          className="t-sm text-[var(--a-600)] hover:underline"
        >
          Change every stage
        </Link>
      </div>

      {failed && (
        <p role="status" className="t-sm mt-2 text-[var(--warn-700)]">
          The stage could not be added. Nothing changed — set the stages under Project Details.
        </p>
      )}
    </div>
  );
}
