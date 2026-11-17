"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ruler } from "lucide-react";

import { measureDrawings, type MeasureOutcome } from "@/app/(app)/projects/[id]/measure-actions";

/**
 * Measure the drawings – the take-off agent, from the bill (D1.2).
 *
 * A detailed design prints dimensions, not quantities, so drafting from its text finds nothing to
 * copy. This is the step that measures it: sheets in Take-off, each figure traced to the drawing or
 * stated as an assumption, and the measured items carried here as rows.
 */
export function MeasureDrawings({ projectId, drawings, measured }: { projectId: string; drawings: readonly { id: string; name: string }[]; measured: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [outcome, setOutcome] = useState<MeasureOutcome | null>(null);

  /*
    Which sheets to measure. All of them until somebody says otherwise.

    A reply has a length limit and a real corpus runs past it: five drawings on one project
    produced an answer that stopped mid-structure, and none of it could be used. The refusal told
    the reader to measure a smaller selection — and there was no way to select one, which made the
    advice worse than useless.

    It is also how the work is actually done. A bill is measured element by element, off the
    sheets that show that element; a boundary wall is not measured off the site layout and the
    electrical servitude at once.
  */
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const measuring = chosen.length === 0 ? drawings : drawings.filter((d) => chosen.includes(d.id));
  const toggle = (id: string) =>
    setChosen((was) => {
      // Ticking the first one turns "all of them" into a choice of one, not into "all but this".
      const current = was.length === 0 ? drawings.map((d) => d.id) : was;
      const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
      // Back to all of them is the same as no choice at all, and reads better said that way.
      return next.length === drawings.length ? [] : next;
    });

  return (
    <div data-region="measure-drawings" className="border-b border-[var(--n-100)] bg-[var(--a-50)]/40 px-4 py-3">
      <div className="flex flex-wrap items-start gap-3">
        <Ruler aria-hidden size={16} strokeWidth={1.75} className="mt-0.5 text-[var(--a-600)]" />
        <div className="min-w-0 flex-1">
          {/*
            The heading says what pressing the button produces, not what the project happens to
            contain. "5 drawings are filed" is a fact about the corpus, and a reader who asked what
            this panel does was told the filing status of their own documents instead.
          */}
          <p className="t-base font-medium text-[var(--n-800)]">
            Measure{" "}
            {measuring.length === drawings.length
              ? drawings.length === 1
                ? "the filed drawing"
                : `the ${drawings.length} filed drawings`
              : `${measuring.length} of the ${drawings.length} filed drawings`}{" "}
            into a bill
          </p>
          <p className="t-sm mt-0.5 max-w-[90ch] text-[var(--n-600)]">
            Works out the quantities from the dimensions, sections, schedules and notes on the sheets, and writes them up as bill items with a
            dimension sheet behind each one.
          </p>
          <p className="t-sm mt-0.5 max-w-[90ch] text-[var(--n-600)]">
            Every figure is traced back to the drawing it was read from, or marked as an assumption for you to confirm. The arithmetic is the
            platform&rsquo;s, and each line shows its working. Quantities only &ndash; rates are yours to price.
          </p>

          {/*
            The sheets, tickable, when there is more than one to choose between.

            Written documents filed beside them are not listed and are always read: a specification
            is not a sheet somebody picks, it is what the sheets are measured against.
          */}
          {drawings.length > 1 && (
            <ul data-region="measure-sheets" className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {drawings.map((d) => {
                const on = measuring.some((m) => m.id === d.id);
                return (
                  <li key={d.id}>
                    <label className="t-sm flex items-center gap-1.5 text-[var(--n-700)]">
                      <input
                        type="checkbox"
                        data-sheet={d.id}
                        checked={on}
                        disabled={pending}
                        onChange={() => toggle(d.id)}
                        className="size-3.5 accent-[var(--a-600)]"
                      />
                      <span className={on ? undefined : "text-[var(--n-400)]"}>{d.name}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <button
          type="button"
          data-action="measure-drawings"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setOutcome(null);
              try {
                setOutcome(await measureDrawings(projectId, chosen));
              } catch {
                /*
                  A server that stops answering, rather than one that answers "no".

                  A function that dies mid-action - crashing rather than returning a refusal -
                  rejects this await. Unhandled, the rejection was swallowed: the panel simply sat
                  there, and nothing on screen separated it from a button that had not worked. The
                  same silence hid an OCR crash in the Quotations step for as long as it did.
                */
                setOutcome({
                  ok: false,
                  reason:
                    "The server stopped before it answered, so nothing was measured or saved. Try again; if it keeps happening the server's log will say why.",
                });
              }
              router.refresh();
            })
          }
          className="t-base flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--n-800)] px-3 font-medium text-white hover:bg-[var(--n-900)] disabled:opacity-50"
        >
          <Ruler aria-hidden size={13} strokeWidth={2.25} />
          {pending ? "Measuring the drawings…" : measured ? "Measure again" : "Measure the drawings"}
        </button>
      </div>

      {pending && <p className="t-sm mt-2 text-[var(--n-500)]">Reading and measuring – a drawing set takes up to a minute or two.</p>}

      {outcome && !outcome.ok && (
        <p role="alert" className="t-sm mt-2 text-[var(--err-700)]">
          {outcome.reason}
        </p>
      )}

      {outcome?.ok && (
        <div data-region="measure-outcome" role="status" className="t-sm mt-2 flex flex-col gap-1 text-[var(--n-700)]">
          <p>
            <span className="font-medium text-[var(--n-800)]">{outcome.items} items measured</span> on {outcome.lines} dimension lines –{" "}
            {outcome.read} figures read from the drawings, {outcome.derived} worked out from them
            {outcome.assumed.length ? `, ${outcome.assumed.length} assumed` : ""}. {outcome.billed ? `${outcome.billed} rows are in the bill below.` : outcome.billReason}{" "}
            <a href={`/projects/${projectId}/take-off`} className="font-medium text-[var(--a-700)] underline underline-offset-2">
              See the sheets and their working
            </a>
            {" · "}
            <a href={`/projects/${projectId}/cost-plan`} className="font-medium text-[var(--a-700)] underline underline-offset-2">
              the elemental cost plan
            </a>
            {outcome.spend !== null ? <span className="text-[var(--n-500)]"> · US${outcome.spend.toFixed(4)}</span> : null}
          </p>
          {outcome.assumed.length > 0 && (
            <p data-region="measure-assumed" className="text-[var(--warn-700)]">
              Assumed – confirm before pricing: {outcome.assumed.map((a) => `${a.label.toLowerCase()} ${a.figure} ${a.unit}`).join("; ")}.
            </p>
          )}
          {outcome.gaps.length > 0 && (
            /*
              What the drawings require and the measurement could not reach.

              Shown beside the assumptions rather than folded away, because an omission nobody is
              told about is the expensive kind: a bill missing its reinforcement adds up perfectly.
            */
            <div data-region="measure-gaps" className="text-[var(--warn-700)]">
              <p>Not measured, and the drawings call for it:</p>
              <ul className="mt-0.5 flex list-disc flex-col gap-0.5 pl-5">
                {outcome.gaps.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
            </div>
          )}
          {outcome.refused.length > 0 && (
            <details className="text-[var(--n-600)]">
              <summary className="cursor-pointer">{outcome.refused.length} not measured – they could not be traced to the drawings</summary>
              <ul className="mt-1 list-disc pl-5">
                {outcome.refused.map((r, i) => (
                  <li key={i}>
                    {r.what}: {r.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {outcome.partial && <p className="text-[var(--warn-700)]">The drawing set is longer than one measurement reads; its last sheets were not measured.</p>}
        </div>
      )}
    </div>
  );
}
