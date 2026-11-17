"use client";

/**
 * The job card – where this job is and what to do next, on the project's own overview.
 *
 * ── Why it is here and not in the advisor ──────────────────────────────────────────────────
 *
 * "Where this job is" lived at the top of the advisor's chat, then behind a tab in it, and readers
 * took it for part of the conversation. It is a property of the project, so it sits on the project's
 * front page: it reads the job (computed on the server – the same chain and checklist the steps use),
 * names the next move, holds every phase, and on request writes the plan. The advisor is for questions.
 *
 * The status is computed and costs nothing; the plan is a model call asked for with a button, so
 * opening a project never spends money on its own.
 */

import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, BookMarked, ChevronRight, RefreshCw, Wand2 } from "lucide-react";

import type { Advice } from "@/lib/agent/advisor";
import { planStepLabel } from "@/lib/agent/plan-steps";
import { AdvisorMark } from "@/components/shell/advisor-mark";
import { Thinking } from "@/components/shell/assistant-ui";
import { whyUnreachable } from "@/lib/unreachable";

export interface ProjectAgentStatus {
  projectId: string;
  /** The stage the work is in — the earliest with an open step. Null once everything is signed. */
  stage: string | null;
  documents: number;
  signed: number;
  steps: number;
  /** Requirements met of the requirements in scope, and steps that can start of steps in scope. */
  counts: { met: number; criteria: number; ready: number };
  next: {
    heading: string;
    label: string;
    href: string;
    summary: string;
    missing: string[];
    waitingOn: string[];
  } | null;
}

type Plan = { advice: Advice & { cost: number | null } } | { failed: string };


export function ProjectAgent({ status, phases }: { status: ProjectAgentStatus; phases?: ReactNode }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planning, setPlanning] = useState(false);
  const inFlight = useRef<AbortController | null>(null);

  const askForPlan = async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setPlanning(true);
    try {
      const response = await fetch(`/api/projects/${status.projectId}/advice`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => null)) as {
        advice?: (Advice & { cost: number | null }) | null;
        unavailable?: string;
        error?: string;
      } | null;
      if (body?.advice) setPlan({ advice: body.advice });
      else setPlan({ failed: body?.unavailable ?? body?.error ?? whyUnreachable(response.status, "The agent") });
    } catch (error) {
      if (controller.signal.aborted) return;
      setPlan({ failed: `The request did not reach the server: ${error instanceof Error ? error.message : "unknown error"}.` });
    } finally {
      if (!controller.signal.aborted) setPlanning(false);
    }
  };

  const planButton = (
    <button
      type="button"
      data-action="agent-plan"
      onClick={askForPlan}
      disabled={planning}
      className="t-sm flex h-8 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] px-3 font-medium text-[var(--n-700)] transition-colors hover:bg-[var(--n-50)] disabled:opacity-60"
      style={{ transitionDuration: "var(--m-fast)" }}
    >
      <Wand2 aria-hidden size={14} strokeWidth={2} className="text-[var(--ai-500)]" />
      {plan && "failed" in plan ? "Try the plan again" : "Plan it for me"}
    </button>
  );

  return (
    <section
      data-region="project-agent"
      aria-label="Job card"
      className="overflow-hidden rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-0)] shadow-[var(--e-1)]"
    >
      {/*
        ── Less is more ───────────────────────────────────────────────────────────────────────
        One line says where the job is, one box says what to do next, and the phases sit under it,
        folded. Anything longer – what a step still needs, the agent's plan – is one click away
        rather than always on screen.
      */}
      <header className="flex items-center gap-3 border-b border-[var(--n-100)] px-4 py-3">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--ai-500)] text-white">
          <AdvisorMark size={20} strokeWidth={1.9} />
        </span>
        <div data-region="agent-status" className="min-w-0 flex-1">
          <h2 className="t-base font-semibold text-[var(--n-800)]">Job card</h2>
          <p
            data-region="job-counts"
            data-met={`${status.counts.met}/${status.counts.criteria}`}
            data-ready={`${status.counts.ready}/${status.steps}`}
            className="t-xs text-[var(--n-500)]"
          >
            <span className="font-medium text-[var(--n-700)]">{status.stage ?? "Every stage signed off"}</span>
            {" · "}
            {status.signed}/{status.steps} signed · {status.counts.met}/{status.counts.criteria} requirements met ·{" "}
            {status.documents} {status.documents === 1 ? "document" : "documents"}
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-3 px-4 pt-3 pb-3.5">
        {/* ── The next move ──────────────────────────────────────────────────────────────── */}
        {status.next ? (
          <div data-region="agent-next" className="rounded-[var(--r-lg)] bg-[var(--a-50)] px-3.5 py-3">
            <p className="t-xs font-semibold tracking-[0.02em] text-[var(--a-700)] uppercase">Next move</p>
            <p className="t-base mt-0.5 font-semibold text-[var(--n-800)]">
              {status.next.heading} {status.next.label}
            </p>
            <p className="t-sm mt-0.5 text-[var(--n-600)]">
              {status.next.waitingOn.length > 0
                ? `Waiting on ${status.next.waitingOn.join(", ")} to be signed off.`
                : status.next.summary}
            </p>

            {status.next.missing.length > 0 && (
              <details className="group mt-1.5">
                <summary className="t-xs inline-flex cursor-pointer list-none items-center gap-1 font-medium text-[var(--warn-700)] [&::-webkit-details-marker]:hidden">
                  <ChevronRight aria-hidden size={12} strokeWidth={2} className="transition-transform group-open:rotate-90" />
                  Still needs {status.next.missing.length} {status.next.missing.length === 1 ? "item" : "items"}
                </summary>
                <ul className="t-xs mt-1 ml-5 list-disc text-[var(--n-700)]">
                  {status.next.missing.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </details>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Link
                href={status.next.href}
                data-region="next-step"
                className="t-sm inline-flex h-8 items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--a-500)] px-3 font-medium text-white transition-colors hover:bg-[var(--a-600)]"
                style={{ transitionDuration: "var(--m-fast)" }}
              >
                Open {status.next.label}
                <ArrowRight aria-hidden size={14} strokeWidth={2} />
              </Link>
              {planButton}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 rounded-[var(--r-lg)] bg-[var(--ok-50)] px-3.5 py-3">
            <p className="t-sm min-w-0 flex-1 font-medium text-[var(--ok-700)]">
              Nothing waiting on you – every step in scope is signed off.
            </p>
            {planButton}
          </div>
        )}

        {/* ── The plan, only once asked for ──────────────────────────────────────────────────── */}
        {(planning || plan) && (
          <div data-region="agent-plan" data-scroller="plan" className="max-h-[42vh] overflow-y-auto rounded-[var(--r-lg)] border border-[var(--n-200)] px-3.5 py-3">
            {planning ? (
              <Thinking label="Reading the job and writing the plan…" />
            ) : plan && "advice" in plan ? (
              <PlanView projectId={status.projectId} advice={plan.advice} onRefresh={askForPlan} />
            ) : plan && "failed" in plan ? (
              <p role="alert" className="t-sm text-[var(--err-700)]">
                {plan.failed}
              </p>
            ) : null}
          </div>
        )}

        {/* ── Every phase, folded but for the one the work is in ───────────────────────────── */}
        {phases}
      </div>
    </section>
  );
}

/**
 * The plan – where the job is in one sentence, then the actions as a table a QS can work from: what,
 * why, on which step (a link), who ordinarily does it, how soon and how urgent.
 *
 * The owner is a role and the due date a suggestion: the plan knows the job, not the office. Both are
 * written into the item's description for the person who takes it on, and nothing is assigned by it.
 */
function PlanView({
  projectId,
  advice,
  onRefresh,
}: {
  projectId: string;
  advice: Advice & { cost: number | null };
  onRefresh: () => void;
}) {
  const cell = "px-3 py-2 align-top";

  return (
    <div data-region="advisor-advice">
      <div className="flex items-start gap-3">
        <p className="t-base min-w-0 flex-1 leading-snug font-medium text-[var(--n-900)]">{advice.position}</p>
        <button
          type="button"
          onClick={onRefresh}
          aria-label="Write the plan again"
          title="Write the plan again"
          className="grid size-8 shrink-0 place-items-center rounded-[var(--r-md)] text-[var(--n-500)] hover:bg-[var(--n-100)] hover:text-[var(--n-800)]"
        >
          <RefreshCw aria-hidden size={14} strokeWidth={2} />
        </button>
      </div>

      <div className="mt-3 rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-0)]">
        <table data-region="plan-table" className="w-full table-fixed border-collapse text-left">
          <thead className="t-xs bg-[var(--n-50)] font-semibold tracking-[0.02em] text-[var(--n-600)] uppercase">
            <tr>
              <th scope="col" className={`${cell} w-9`}>#</th>
              <th scope="col" className={cell}>Action · owner · due · priority</th>
              <th scope="col" className={`${cell} w-40`}>Step</th>
            </tr>
          </thead>
          <tbody className="t-sm text-[var(--n-800)]">
            {advice.actions.map((action, index) => (
              <tr key={action.do} data-plan-row className="border-t border-[var(--n-100)]">
                <td className={`${cell} num text-[var(--n-500)]`}>{index + 1}</td>
                <td className={cell}>
                  <span data-cell="action" className="block">
                    <span className="flex items-start gap-1.5">
                      {action.type === "rfi" && (
                        <span className="t-xs mt-0.5 shrink-0 rounded-[var(--r-sm)] bg-[var(--ai-50)] px-1.5 py-px font-medium text-[var(--ai-700)]">RFI</span>
                      )}
                      <span className="font-medium">{action.do}</span>
                    </span>
                    {action.because && <span className="t-xs mt-0.5 block text-[var(--n-600)]">{action.because}</span>}
                  </span>
                  {/* Who, how soon, how urgent – on one quiet line. The owner is a role, the due date a suggestion. */}
                  <span className="t-xs mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[var(--n-600)]">
                    <span>
                      <span className="text-[var(--n-500)]">Owner</span> {action.owner ?? "–"}
                    </span>
                    <span data-cell="due">
                      <span className="text-[var(--n-500)]">Due</span>{" "}
                      {action.dueInDays ? (
                        <>
                          <span className="num">{action.dueInDays}</span> working {action.dueInDays === 1 ? "day" : "days"}
                        </>
                      ) : (
                        "–"
                      )}
                    </span>
                    <span
                      className={`rounded-[var(--r-sm)] px-1.5 py-px font-medium ${
                        action.priority === "urgent"
                          ? "bg-[var(--err-50)] text-[var(--err-700)]"
                          : action.priority === "high"
                            ? "bg-[var(--warn-50)] text-[var(--warn-700)]"
                            : "bg-[var(--n-100)] text-[var(--n-700)]"
                      }`}
                    >
                      {action.priority[0].toUpperCase() + action.priority.slice(1)}
                    </span>
                  </span>
                </td>
                <td className={cell}>
                  {action.module ? (
                    <Link
                      href={`/projects/${projectId}${action.module}`}
                      className="t-xs inline-flex max-w-full items-center gap-1 rounded-[var(--r-md)] border border-[var(--n-200)] px-2 py-1 font-medium text-[var(--a-700)] hover:border-[var(--a-300)] hover:bg-[var(--a-50)]"
                    >
                      <span className="truncate">{planStepLabel(action.module)}</span> <ArrowRight aria-hidden size={11} className="shrink-0" />
                    </Link>
                  ) : (
                    <span className="t-xs text-[var(--n-500)]">Outside the platform</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        {advice.standard && (
          <p className="t-xs flex items-start gap-1.5 text-[var(--n-600)]">
            <BookMarked aria-hidden size={12} strokeWidth={2} className="mt-0.5 shrink-0" />
            <span>
              <span className="font-semibold text-[var(--n-700)]">Standard:</span> {advice.standard}
            </span>
          </p>
        )}
        {advice.caution && (
          <p className="t-xs flex items-start gap-1.5 rounded-[var(--r-md)] bg-[var(--warn-50)] px-2.5 py-2 text-[var(--warn-700)]">
            <AlertTriangle aria-hidden size={12} strokeWidth={2} className="mt-0.5 shrink-0" />
            {advice.caution}
          </p>
        )}
        {/* Said every time: the agent's words are guidance on process, never a source of figures. */}
        <p className="t-xs text-[var(--n-400)]">
          Guidance on process, not on figures – no number in this platform comes from the agent. Owners are roles and due
          dates are suggestions until somebody agrees them.
          {advice.cost !== null && ` · R ${advice.cost.toFixed(4)}`}
        </p>
      </div>
    </div>
  );
}
