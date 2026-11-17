/**
 * Pricing a bill from the firm's library — PLATFORM.md §4.8, §6.3.
 *
 * ── It offers; a person accepts ────────────────────────────────────────────────────────────
 *
 * Nothing here applies itself. Every proposal names the library entry behind it, its source and its
 * effective date, and the reader takes them one at a time or takes the certain ones together.
 *
 * The reason is the ASAQS test of an LLM pricing a one-brick wall: it answered R215,23/m² from
 * essentially one website, and practising quantity surveyors assessed it inaccurate — a plausible
 * figure for something nobody had checked. The defence is not a better guess. It is that every rand
 * comes from a row the practice curated and that anything less than certain arrives as a question.
 *
 * ── Certain and plausible are shown apart ──────────────────────────────────────────────────
 *
 * An exact match is the same significant words both ways. A partial one is a library entry whose
 * every word appears in the bill item, but which says less than the item does — "Concrete in strip
 * footings" against "25 MPa concrete in strip footings". That is a reasonable rate and it is not
 * the same item, so it is never in the bulk action and it says what it is missing.
 */

"use client";

import { useMemo, useState, useTransition } from "react";
import { Library } from "lucide-react";

import { Panel } from "@/components/shell/panel";
import { REGIONS, displayRate, type LibraryRate } from "@/lib/rates";
import { matchRates, tallyMatches } from "@/lib/rate-match";
import { formatDate } from "@/lib/dates";
import { applyLibraryRates } from "@/app/(app)/projects/[id]/pricing-actions";
import type { BillRow } from "@/lib/agent/bill";

export function FromLibrary({
  projectId,
  projectRegion,
  runId,
  rows,
  library,
  frozen,
}: {
  projectId: string;
  /** The province the job is in, where it was stated. Null means nobody said. */
  projectRegion: string | null;
  runId: string;
  rows: readonly BillRow[];
  library: readonly LibraryRate[];
  frozen: boolean;
}) {
  /*
    The job's own province, where it has one.

    This used to default to empty and ask on every visit, because `projects` recorded no region at
    all — a question the job could answer once, put to a reader every time they opened the screen.
    Migration `0019` added the column and project setup asks for it, so this now starts where the
    work is and stays changeable, because a bill occasionally prices against another province's
    rates and that is the reader's call rather than the platform's.

    Empty still means "any province", which is the honest reading of a project that never stated
    one — and of a library whose rates may state none either.
  */
  const [region, setRegion] = useState<string>(projectRegion ?? "");
  const [outcome, setOutcome] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<{ description: string; reason: string }[]>([]);
  const [pending, start] = useTransition();

  const matches = useMemo(
    () => matchRates(rows, library, { region: region === "" ? null : region }),
    [rows, library, region],
  );
  const tally = useMemo(() => tallyMatches(rows, matches), [rows, matches]);

  const exact = matches.filter((m) => m.exact);
  const partial = matches.filter((m) => !m.exact);

  const apply = (ids: readonly string[]) => {
    setOutcome(null);
    setSkipped([]);
    start(async () => {
      const result = await applyLibraryRates(projectId, runId, ids, {
        region: region === "" ? null : region,
      });

      if (!result.ok) {
        setOutcome(result.reason);
        return;
      }

      setOutcome(
        `${result.written} ${result.written === 1 ? "row is" : "rows are"} priced from the library.`,
      );
      setSkipped(result.skipped);
    });
  };

  // Nothing to say on a signed bill: the rates are frozen and repricing means drafting again.
  if (frozen) return null;

  return (
    <Panel
      title="Price from the rate library"
      count={
        tally.offered === 0
          ? `${tally.unmatched} unmatched`
          : `${tally.exact} certain · ${tally.offered - tally.exact} to check`
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="t-sm flex items-center gap-1.5 text-[var(--n-600)]">
          Province
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className="t-base h-8 rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] px-2 text-[var(--n-800)]"
          >
            {/* Named, so a reader can see whether they are looking at the job's own province or
              at everything. "Any" alone reads as a filter nobody set. */}
          <option value="">{projectRegion ? "Any province" : "Any — none stated on this job"}</option>
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>

        {/* Only the certain ones, ever. A partial match is taken one at a time or not at all. */}
        {exact.length > 0 && (
          <button
            type="button"
            disabled={pending}
            onClick={() => apply(exact.map((m) => m.rowId))}
            className="t-base flex h-8 items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--a-500)] px-3 font-medium text-white transition-colors hover:bg-[var(--a-600)] disabled:opacity-50"
            style={{ transitionDuration: "var(--m-fast)" }}
          >
            <Library aria-hidden size={14} strokeWidth={1.75} />
            Price {exact.length} certain {exact.length === 1 ? "row" : "rows"}
          </button>
        )}
      </div>

      {outcome && (
        <p role="status" className="t-sm mt-2 text-[var(--n-700)]">
          {outcome}
        </p>
      )}

      {skipped.length > 0 && (
        <ul className="t-sm mt-2 flex flex-col gap-0.5 text-[var(--warn-700)]">
          {skipped.map((s) => (
            <li key={s.description}>
              {s.description} — {s.reason}
            </li>
          ))}
        </ul>
      )}

      {matches.length === 0 ? (
        <p className="t-sm mt-3 text-[var(--n-600)]">
          {tally.unmatched === 0
            ? "Every row on this bill already carries a rate."
            : `The library has nothing for ${tally.unmatched} unpriced ${
                tally.unmatched === 1 ? "row" : "rows"
              } in a matching unit. Import a schedule under Rate Library, or price them by hand.`}
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {exact.length > 0 && (
            <Offers
              heading="The same item"
              note="Every significant word agrees, both ways."
              matches={exact}
              onApply={apply}
              pending={pending}
            />
          )}

          {partial.length > 0 && (
            <Offers
              heading="Close, but the library says less"
              note="The entry's own words all appear in the item, but the item is more specific. Read both before taking one."
              matches={partial}
              onApply={apply}
              pending={pending}
            />
          )}
        </div>
      )}
    </Panel>
  );
}

function Offers({
  heading,
  note,
  matches,
  onApply,
  pending,
}: {
  heading: string;
  note: string;
  matches: ReturnType<typeof matchRates>;
  onApply: (ids: readonly string[]) => void;
  pending: boolean;
}) {
  return (
    <section>
      <div className="flex flex-wrap items-baseline gap-2">
        <p className="t-sm font-medium text-[var(--n-700)]">{heading}</p>
        {matches.length > 1 && (
          <button
            type="button"
            data-action="take-all"
            disabled={pending}
            onClick={() => onApply(matches.map((m) => m.rowId))}
            className="t-xs ml-auto h-6 rounded-[var(--r-md)] border border-[var(--n-200)] px-2 font-medium text-[var(--n-700)] hover:bg-[var(--n-50)] disabled:opacity-40"
          >
            Take all {matches.length}
          </button>
        )}
      </div>
      <p className="t-xs text-[var(--n-500)]">{note}</p>

      <ul className="mt-1.5 flex flex-col">
        {matches.map((m) => (
          <li
            key={m.rowId}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-[var(--n-100)] py-2 last:border-0"
          >
            <span className="t-base min-w-0 flex-1 text-[var(--n-800)]">{m.description}</span>

            {/*
              The library's own words, where they differ. A reader deciding whether to take a
              partial match cannot do it without seeing what the entry actually says.
            */}
            {!m.exact && (
              <span className="t-xs w-full text-[var(--n-500)]">
                Library: &ldquo;{m.rate.description}&rdquo;
              </span>
            )}

            <span className="t-xs text-[var(--n-500)]">
              {m.rate.source} · {formatDate(new Date(m.rate.effectiveDate))}
              {m.rate.region ? ` · ${m.rate.region}` : ""}
            </span>

            <span className="num t-base shrink-0 font-medium text-[var(--n-800)]">
              {displayRate(m.rate)}
              <span className="t-xs font-normal text-[var(--n-500)]"> /{m.unit}</span>
            </span>

            <button
              type="button"
              disabled={pending}
              onClick={() => onApply([m.rowId])}
              className="t-sm h-7 shrink-0 rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] px-2.5 font-medium text-[var(--n-700)] hover:bg-[var(--n-50)] disabled:opacity-40"
            >
              Take it
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
