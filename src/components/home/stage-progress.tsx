/**
 * How far through the work a project is, by stage.
 *
 * ── The one component the reference build has that this did not ────────────────────────────
 *
 * `ProjectProgress.tsx` in the Mzilikazi build is a labelled row per stage with a percentage and a
 * bar, and it is the most immediately QS-legible thing on that screen — a glance says which part of
 * the job is done and which has not started. Ours said `0 of 11 steps` in a table cell.
 *
 * **Its data is a hard-coded array** — `Standards Mapping 87%` is a literal in the component, with
 * nothing behind it. §14 names that as a way this project fails, so what is copied here is the
 * shape and not the substance: every bar below is signed steps over signable steps, counted from
 * the chain.
 *
 * ── The stages are L0's, and there is only one list ────────────────────────────────────────
 *
 * The same `STAGES` a project's own stages are picked from at creation (`stages.ts`), which are
 * L0's phases from `process-model.ts`. A progress display that invented its own buckets would be a
 * fourth vocabulary beside the nav groups, the process areas and the domains.
 *
 * A stage with nothing signed still gets a row. "Not started" is the most useful thing this can
 * say — a stage that vanished until it had progress would hide the work still to do, which is the
 * question somebody opens this to ask.
 */

import Link from "next/link";

import { STAGES, phaseOfModule } from "@/lib/stages";

export interface StageLine {
  number: number;
  name: string;
  done: number;
  total: number;
}

/**
 * Signed steps per stage, over the steps that stage could sign.
 *
 * `signable` is every module that produces a run — the same list the "0 of 11" count is taken
 * from — so a stage's denominator is the work it actually contains rather than a share of eleven.
 */
export function stageLines(
  signable: readonly string[],
  signedModules: readonly string[],
): StageLine[] {
  const signed = new Set(signedModules);

  return STAGES.flatMap((stage) => {
    const inStage = signable.filter((module) => phaseOfModule(module) === stage.number);
    if (inStage.length === 0) return [];

    return [
      {
        number: stage.number,
        name: stage.name,
        done: inStage.filter((module) => signed.has(module)).length,
        total: inStage.length,
      },
    ];
  });
}

export interface PipelineStage {
  number: number;
  name: string;
  /** How many projects sit at this stage. */
  projects: number;
}

/**
 * Projects by stage — the portfolio's question, and not the same one as `stageLines`.
 *
 * `stageLines` is a ratio: signed steps over the steps a job runs. It is meaningful because every
 * step in it belongs to one scheme. Summed across a portfolio it stops being meaningful — two jobs
 * at 100% and 0% add to 50%, which is true of neither, and the more projects there are the more
 * confidently the figure says nothing.
 *
 * A portfolio has a *shape*, not a ratio. So this counts jobs, and a job is counted at the
 * earliest stage it has not finished, which is where its work actually is.
 */
export function projectsByStage(
  signable: readonly string[],
  projects: readonly { signedModules: readonly string[] }[],
): PipelineStage[] {
  const stepsIn = (stage: number) => signable.filter((module) => phaseOfModule(module) === stage);

  const counts = new Map<number, number>();

  for (const project of projects) {
    const signed = new Set(project.signedModules);

    const unfinished = STAGES.find((stage) => {
      const steps = stepsIn(stage.number);
      return steps.length > 0 && steps.some((module) => !signed.has(module));
    });

    // Everything signed puts the job at the last stage that has any work in it.
    const last = [...STAGES].reverse().find((stage) => stepsIn(stage.number).length > 0);
    const at = unfinished ?? last;
    if (!at) continue;

    counts.set(at.number, (counts.get(at.number) ?? 0) + 1);
  }

  return STAGES.filter((stage) => stepsIn(stage.number).length > 0).map((stage) => ({
    number: stage.number,
    name: stage.name,
    projects: counts.get(stage.number) ?? 0,
  }));
}

export function StageProgress({
  lines,
  href,
}: {
  lines: readonly StageLine[];
  /** Where the whole panel points — the project these stages belong to. */
  href: string;
}) {
  if (lines.length === 0) return null;

  return (
    <div data-region="stage-progress" className="flex flex-col gap-2.5">
      {lines.map((line) => {
        const complete = line.done === line.total;
        const started = line.done > 0;
        const percent = Math.round((line.done / line.total) * 100);

        return (
          <Link
            key={line.number}
            href={href}
            data-stage={line.number}
            className="group block rounded-[var(--r-sm)] px-1 py-0.5 transition-colors hover:bg-[var(--n-25)]"
            style={{ transitionDuration: "var(--m-fast)" }}
          >
            <span className="flex items-baseline justify-between gap-3">
              <span className="t-sm truncate text-[var(--n-700)]">{line.name}</span>
              {/*
                §7.1 #5 — colour means exactly one thing and never alone. Green is §7.2's "approved
                / complete" and it is used here for exactly that; everything else is neutral,
                because "started" is not a state the palette has a colour for. The figures are
                beside it either way, so nothing rests on the colour being seen.
              */}
              <span
                className={`num t-sm shrink-0 ${
                  complete ? "text-[var(--ok-700)]" : "text-[var(--n-500)]"
                }`}
              >
                {line.done} of {line.total}
              </span>
            </span>

            <span
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${line.name}: ${line.done} of ${line.total} steps signed off`}
              className="mt-1 block h-1 overflow-hidden rounded-[var(--r-full)] bg-[var(--n-100)]"
            >
              <span
                className={`block h-full rounded-[var(--r-full)] ${
                  complete
                    ? "bg-[var(--ok-500)]"
                    : started
                      ? "bg-[var(--a-500)]"
                      : "bg-transparent"
                }`}
                style={{ width: `${percent}%` }}
              />
            </span>
          </Link>
        );
      })}
    </div>
  );
}
