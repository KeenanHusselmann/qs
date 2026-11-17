"use client";

/**
 * The job card's phases – small tiles, and what the phase picked still needs under them.
 *
 * ── Why tiles and not rows ─────────────────────────────────────────────────────────────────
 *
 * Six full-width rows, one per phase, made the card as tall as the board it replaced. Six tiles in
 * a grid take two short lines, and the phase picked opens below. The phase the work is in is picked
 * on arrival.
 *
 * ── Why a phase lists its deliverables, not only its steps ─────────────────────────────────
 *
 * A tile used to count the platform's steps, so Design & Documentation read "0/1": one built step in
 * a phase of five deliverables. A reader took that as a phase one step from done. Now a tile counts
 * the phase's deliverables the project has, and the phase lists every one with its state –
 * signed off, filed, or outstanding, including the work the platform does not track, which says so
 * (`lib/phase-deliverables.ts`). The platform's own steps follow, with what each still needs.
 *
 * Every phase is rendered and the others `hidden`, not unmounted: the rows are server components
 * passed in, a reader's find-in-page still reaches them, and so do the suites that read the board.
 */

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Check, CircleDashed, FileCheck2, Layers } from "lucide-react";

import { addStage } from "@/app/(app)/projects/[id]/settings-actions";
import type { DeliverableStatus } from "@/lib/phase-deliverables";

export interface PhaseTile {
  number: number;
  name: string;
  /** Whether the project runs this phase. A phase it does not run offers to be added. */
  runs: boolean;
  deliverables: (DeliverableStatus & { href: string | null })[];
  /** The phase's step rows, rendered on the server. */
  steps: ReactNode;
}

const STATE_LABEL: Readonly<Record<DeliverableStatus["state"], string>> = {
  signed: "Signed off",
  filed: "Filed",
  outstanding: "Outstanding",
};

export function JobPhaseTiles({
  projectId,
  phases,
  current,
}: {
  projectId: string;
  phases: PhaseTile[];
  current: number | null;
}) {
  /*
    Nothing open on arrival. The card led with a phase already open – five deliverables and its steps
    under the tiles – and a reader who came for the next move met a wall of detail. The phases are
    their titles until one is clicked; clicking it again folds it.
  */
  const [picked, setPicked] = useState<number | null>(null);

  return (
    <div data-region="chain">
      <ol className="grid grid-cols-2 gap-1.5 @lg:grid-cols-3">
        {phases.map((phase) => {
          const selected = phase.number === picked;
          const have = phase.deliverables.filter((d) => d.state !== "outstanding").length;
          const outstanding = phase.deliverables.length - have;
          const complete = phase.deliverables.length > 0 && outstanding === 0;

          return (
            <li
              key={phase.number}
              data-stage={phase.number}
              data-runs={phase.runs}
              data-selected={selected}
              data-outstanding={phase.runs ? outstanding : 0}
            >
              <button
                type="button"
                aria-pressed={selected}
                aria-controls={`phase-${phase.number}`}
                title={
                  phase.runs
                    ? `${phase.name}: ${have} of ${phase.deliverables.length} deliverables in hand, ${outstanding} outstanding`
                    : `${phase.name}: not run on this project`
                }
                onClick={() => setPicked(selected ? null : phase.number)}
                className={`block w-full rounded-[var(--r-md)] border text-left transition-colors ${
                  selected ? "border-[var(--a-500)]" : "border-transparent hover:border-[var(--n-300)]"
                } ${phase.runs ? "" : "opacity-70 hover:opacity-100"}`}
                style={{ transitionDuration: "var(--m-fast)" }}
              >
                {/*
                  Tinted, never white: a phase is a division of the work and has to read as one. The
                  count is the header's last span, and `--n-700` on either tint clears AA.
                */}
                <header
                  className={`flex items-center gap-2 rounded-[var(--r-md)] px-2.5 py-2 ${
                    selected ? "bg-[var(--a-50)]" : "bg-[var(--n-50)]"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`num grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold ${
                      !phase.runs
                        ? "bg-[var(--n-100)] text-[var(--n-500)]"
                        : complete
                          ? "bg-[var(--ok-500)] text-white"
                          : phase.number === current
                            ? "bg-[var(--a-500)] text-white"
                            : "bg-[var(--n-200)] text-[var(--n-700)]"
                    }`}
                  >
                    {complete ? <Check size={11} strokeWidth={3} /> : phase.number}
                  </span>
                  <h3
                    className={`t-xs min-w-0 flex-1 truncate font-semibold ${phase.runs ? "text-[var(--n-900)]" : "text-[var(--n-600)]"}`}
                  >
                    {phase.name}
                  </h3>
  
                </header>
              </button>
            </li>
          );
        })}
      </ol>

      {phases.map((phase) => {
        const outstanding = phase.deliverables.filter((d) => d.state === "outstanding").length;

        return (
          <div
            key={phase.number}
            id={`phase-${phase.number}`}
            data-phase={phase.number}
            data-runs={phase.runs}
            hidden={phase.number !== picked}
            // Declared, so `checks/viewport.mjs` knows this scroller is meant: a bounded list inside
            // a card, not a second page scroller.
            data-scroller="phase"
            /*
              The phase's own scroller, so the job card fits the screen.
              The card is what a reader opens a project for, and a phase with five deliverables and
              five steps under it pushed the page into a scroll — the card's foot, and the agent's
              plan under it, off the bottom. The panel takes the room that is left and scrolls inside
              itself; the tiles, the next move and the plan button stay where they are.
            */
            className="mt-2 max-h-[clamp(10rem,30vh,22rem)] overflow-y-auto rounded-[var(--r-md)] border border-[var(--n-100)]"
          >
            {!phase.runs && <AddPhase projectId={projectId} phase={phase} />}

            <div data-region="phase-deliverables" className="px-3 pt-2.5 pb-2">
              <p className="t-xs font-semibold text-[var(--n-700)]">
                {phase.name} needs{" "}
                <span className="font-normal text-[var(--n-500)]">
                  ·{" "}
                  {!phase.runs
                    ? "not run on this project"
                    : outstanding === 0
                      ? "everything in hand"
                      : `${outstanding} outstanding`}
                </span>
              </p>
              <ul className="mt-1.5 flex flex-col">
                {phase.deliverables.map((deliverable) => (
                  <Deliverable key={deliverable.label} deliverable={deliverable} />
                ))}
              </ul>
            </div>

            <div className="border-t border-[var(--n-100)] py-1">
              <p className="t-xs px-3 pt-1.5 font-semibold text-[var(--n-700)]">
                {phase.runs ? "Steps in the platform" : "Steps set aside, and still reachable"}
              </p>
              {/*
                Set aside, not deleted: a project taken on at valuation still receives an early
                document, and `data-region` is what the suites have always counted these from.
              */}
              <ul
                {...(phase.runs ? {} : { "data-region": "set-aside" })}
                aria-label={`${phase.name} steps`}
                className="flex flex-col"
              >
                {phase.steps}
              </ul>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Bring a phase back – the one thing `addStage` does.
 *
 * A project is set up at the phase the work is at, and everything before it is set aside. That is
 * right at setup and wrong a month later, when the practice is appointed for something earlier or
 * the phase was entered wrongly. The only way back was a checkbox list under Project Details, or a
 * notice on a step page somebody had to find first. The phases are here, so the offer is here.
 *
 * Widening only: this cannot set other work aside, so it needs no confirmation, and anything signed
 * under a phase stays signed either way.
 */
function AddPhase({ projectId, phase }: { projectId: string; phase: PhaseTile }) {
  const router = useRouter();
  const [adding, start] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--n-100)] bg-[var(--n-25)] px-3 py-2">
      <p className="t-xs min-w-0 flex-1 text-[var(--n-600)]">
        This project does not run {phase.name}. Its steps stay reachable, and anything signed under
        them stays signed.
      </p>
      <button
        type="button"
        data-action="add-phase"
        data-phase={phase.number}
        disabled={adding}
        onClick={() =>
          start(async () => {
            await addStage(projectId, phase.number);
            router.refresh();
          })
        }
        className="t-xs flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] px-2.5 font-medium text-[var(--n-700)] transition-colors hover:bg-[var(--n-50)] disabled:opacity-60"
        style={{ transitionDuration: "var(--m-fast)" }}
      >
        <Layers aria-hidden size={12} strokeWidth={2} />
        {adding ? "Adding…" : `Run ${phase.name} too`}
      </button>
    </div>
  );
}

/** One deliverable: its state, what it is, and why – with the step or the corpus to open for it. */
function Deliverable({ deliverable }: { deliverable: DeliverableStatus & { href: string | null } }) {
  const { state, label, detail, href } = deliverable;

  const body = (
    <>
      <span
        className={`t-xs mt-px flex w-[5.75rem] shrink-0 items-center gap-1 font-medium ${
          state === "signed"
            ? "text-[var(--ok-700)]"
            : state === "filed"
              ? "text-[var(--a-700)]"
              : "text-[var(--warn-700)]"
        }`}
      >
        {state === "signed" ? (
          <Check aria-hidden size={12} strokeWidth={2.5} />
        ) : state === "filed" ? (
          <FileCheck2 aria-hidden size={12} strokeWidth={2} />
        ) : (
          <CircleDashed aria-hidden size={12} strokeWidth={2} />
        )}
        {STATE_LABEL[state]}
      </span>
      <span className="min-w-0 flex-1">
        <span className="t-sm block text-[var(--n-800)]">{label}</span>
        <span className="t-xs block text-[var(--n-500)]">{detail}</span>
      </span>
      {href && <ArrowRight aria-hidden size={13} strokeWidth={1.75} className="mt-1 shrink-0 text-[var(--n-300)]" />}
    </>
  );

  return (
    <li data-deliverable={label} data-state={state}>
      {href ? (
        <Link
          href={href}
          className="-mx-1.5 flex items-start gap-2 rounded-[var(--r-sm)] px-1.5 py-1 transition-colors hover:bg-[var(--n-50)]"
          style={{ transitionDuration: "var(--m-fast)" }}
        >
          {body}
        </Link>
      ) : (
        <div className="flex items-start gap-2 py-1">{body}</div>
      )}
    </li>
  );
}
