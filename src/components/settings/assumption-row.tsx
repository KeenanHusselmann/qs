"use client";

/**
 * One assumption, and what changing it moves.
 *
 * ── The `moves` line is not decoration ─────────────────────────────────────────────────────
 *
 * A settings page of nine numbers invites somebody to change one and see what happens. Saying what
 * each figure decides — "the price ceiling every cost is tested against" — is what turns an idle
 * edit into a considered one. These nine numbers set an affordability ceiling, pass or fail six
 * gates and print a verdict on a client's report.
 *
 * ── Whose figure it is, always visible ─────────────────────────────────────────────────────
 *
 * An unset assumption says so, and names the platform as its source. That is the whole point of
 * the page: before it existed the report said "a stated assumption" about a figure nobody at the
 * practice had ever seen, let alone stated.
 */

import { useState, useTransition } from "react";
import { Check } from "lucide-react";

import { setAssumption } from "@/app/(app)/settings/actions";
import { showAssumption, toInput, type AssumptionSpec } from "@/lib/assumption-set";

export function AssumptionRow({
  spec,
  value,
  isDefault,
  effectiveFrom,
  setBy,
}: {
  spec: AssumptionSpec;
  value: number;
  isDefault: boolean;
  effectiveFrom: string | null;
  setBy: string | null;
}) {
  const [pending, start] = useTransition();
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  return (
    <form
      data-assumption={spec.key}
      className="border-b border-[var(--n-100)] px-4 py-3 last:border-b-0"
      action={(form) =>
        start(async () => {
          setRefusal(null);
          setSaved(null);

          const outcome = await setAssumption(form);

          if (outcome.ok) setSaved(outcome.shown ?? "Saved");
          else setRefusal(outcome.reason ?? "It could not be saved.");
        })
      }
    >
      <input type="hidden" name="key" value={spec.key} />

      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <span className="min-w-[210px] flex-1">
          <span className="t-sm block font-medium text-[var(--n-800)]">{spec.label}</span>
          <span className="t-xs block max-w-[64ch] text-[var(--n-600)]">{spec.moves}</span>
        </span>

        <label className="flex items-baseline gap-1.5">
          <input
            name="value"
            defaultValue={toInput(spec, value)}
            inputMode="decimal"
            aria-label={spec.label}
            className="t-sm num h-8 w-24 rounded-[var(--r-md)] border border-[var(--n-200)] px-2.5 text-right text-[var(--n-800)] focus:border-[var(--a-500)] focus:outline-none"
          />
          <span className="t-xs w-12 text-[var(--n-500)]">
            {spec.unit === "percent" || spec.unit === "share" ? "%" : spec.unit}
          </span>
        </label>

        <button
          type="submit"
          disabled={pending}
          data-action="set-assumption"
          className="t-sm flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--n-200)] px-2.5 font-medium text-[var(--n-700)] transition-colors hover:bg-[var(--n-50)] disabled:opacity-40"
          style={{ transitionDuration: "var(--m-fast)" }}
        >
          {pending ? "Saving…" : "Set"}
        </button>
      </div>

      <p className="t-xs mt-1.5 text-[var(--n-500)]">
        {isDefault ? (
          /*
            Named as the platform's, not left blank.

            The report says "a stated assumption" about every one of these. Until this page existed
            the figure was one nobody at the practice had seen — and a settings row that showed a
            number with no source would have carried on implying otherwise.
          */
          <>
            <span className="text-[var(--warn-700)]">Not set by the practice.</span> Showing the
            platform&rsquo;s own figure, {showAssumption(spec, value)}, which is what every report
            currently uses.
          </>
        ) : (
          <>
            Set by {setBy}
            {effectiveFrom ? `, effective ${effectiveFrom}` : ""}. Currently{" "}
            {showAssumption(spec, value)}.
          </>
        )}
      </p>

      {refusal && (
        <p role="alert" className="t-sm mt-1.5 text-[var(--err-700)]">
          {refusal}
        </p>
      )}

      {saved && (
        <p role="status" className="t-sm mt-1.5 flex items-center gap-1 text-[var(--ok-700)]">
          <Check aria-hidden size={12} strokeWidth={2.5} />
          Now {saved}. Every report printed from here on uses it.
        </p>
      )}
    </form>
  );
}
