/**
 * Which step "Next" goes to, from the page the reader is on.
 *
 * ── The bug this is the fix for ────────────────────────────────────────────────────────────
 *
 * The advisor's Next step link used the chain's recommendation, which points at the earliest step
 * that needs something — often *behind* the reader. A tester on step one pressed Next to walk
 * forward, was sent to step two, and could never press their way to step four: "it redirects my
 * progress to step 2". So on a step page, Next is the next step after that page, and whatever is
 * still open behind it is returned separately, to be shown as what it is rather than as a redirect.
 *
 * Off a step (the overview, the corpus) there is no "after", and the chain's recommendation is the
 * right answer.
 */

import type { Brief, StepPosition } from "@/lib/agent/advisor";

export interface StepsAround {
  next: StepPosition | null;
  /** Unsigned steps before the current page, in process order. */
  openBehind: StepPosition[];
  /** Whether the reader is on a step at all. */
  onStep: boolean;
}

export function stepsAround(brief: Pick<Brief, "steps" | "next">, currentModule: string | null): StepsAround {
  const index = currentModule === null ? -1 : brief.steps.findIndex((s) => s.module === currentModule);

  if (index === -1) return { next: brief.next, openBehind: [], onStep: false };

  return {
    next: brief.steps.slice(index + 1).find((s) => s.state !== "signed_off") ?? null,
    openBehind: brief.steps.slice(0, index).filter((s) => s.state !== "signed_off" && s.state !== "not_built"),
    onStep: true,
  };
}

/** "/projects/<id>/feasibility/anything" → "/feasibility". Null on the project's overview. */
export function moduleOf(pathname: string, projectId: string): string | null {
  const prefix = `/projects/${projectId}`;
  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return null;
  const segment = pathname.slice(prefix.length).split("/")[1];
  return segment ? `/${segment}` : null;
}
