/**
 * The five states of §1.3.1, each with one colour and one word.
 *
 * It was a two-way Blocked/Ready badge, which had no way to say that a step had been run, or signed,
 * or was waiting on something no document would fix. `STEP_STATE_LABEL` owns the words so a badge
 * and the sentence beside it cannot drift apart.
 *
 * ── Why it is not on the overview any more ─────────────────────────────────────────────────
 *
 * It was written there, because the board was the only place a step's state was ever stated. A
 * step's own page did not say it, so clicking a row marked "Waiting" opened a screen with no sign
 * of it — the same fact present on one surface and absent on the next. The module page states it
 * now, and a second copy of five colour assignments is exactly how the two would come to disagree.
 */

import { STEP_STATE_LABEL, type StepState } from "@/lib/chain";

export function StepBadge({ state }: { state: StepState }) {
  const tone: Record<StepState, string> = {
    signed_off: "bg-[var(--ok-50)] text-[var(--ok-700)]",
    draft: "bg-[var(--a-50)] text-[var(--a-700)]",
    ready: "bg-[var(--ok-50)] text-[var(--ok-700)]",
    waiting: "bg-[var(--err-50)] text-[var(--err-700)]",
    not_built: "bg-[var(--n-50)] text-[var(--n-500)]",
  };

  return (
    <span className={`t-xs shrink-0 rounded-[var(--r-sm)] px-1.5 py-0.5 font-medium ${tone[state]}`}>
      {STEP_STATE_LABEL[state]}
    </span>
  );
}
