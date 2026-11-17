/**
 * The ad hoc requests, as a list – on the Ad hoc requests page (the "ad hoc request screen" every back-link points
 * to, `#adhoc`) and, shortened, on the landing page's card.
 */

import Link from "next/link";
import { CalendarClock, Check, FileText, User, Zap } from "lucide-react";

import { dueLine } from "@/lib/adhoc";
import { AdhocRequestDialog } from "@/components/adhoc/adhoc-request-dialog";

export interface AdhocRow {
  id: string;
  name: string;
  request: string | null;
  requestedBy: string | null;
  dueOn: string | null;
  answered: boolean;
  inputs: number;
}

export function AdhocList({ rows, today, limit, heading = true }: { rows: readonly AdhocRow[]; today: string; limit?: number; heading?: boolean }) {
  const open = rows.filter((r) => !r.answered);
  const shown = limit ? open.slice(0, limit) : rows;

  return (
    <section id="adhoc" data-region="adhoc-requests" className="scroll-mt-4 rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-0)]">
      {heading && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--n-200)] px-5 py-3">
          <div>
            <h2 className="t-base inline-flex items-center gap-1.5 font-semibold text-[var(--n-800)]">
              <Zap aria-hidden size={15} className="text-[var(--a-600)]" /> Ad hoc requests
            </h2>
            <p className="t-sm text-[var(--n-500)]">
              <span className="num">{open.length}</span> open – here&rsquo;s the input, this is what I need. No project setup.
            </p>
          </div>
          <AdhocRequestDialog trigger="primary" />
        </div>
      )}

      {shown.length === 0 ? (
        <p className="t-sm px-5 py-6 text-[var(--n-500)]">
          {rows.length === 0
            ? "None yet. Use one for work that arrives out of the blue – a steel schedule for a supplier meeting, the sheet count for a change of roofing."
            : "Nothing open. Answered requests stay below, with their inputs, for the next question about them."}
        </p>
      ) : (
        <ul className="divide-y divide-[var(--n-100)]">
          {shown.map((r) => {
            const due = r.answered ? null : dueLine(r.dueOn, today);
            return (
              <li key={r.id} data-adhoc={r.id} data-answered={r.answered}>
                <Link href={`/projects/${r.id}`} className="flex flex-col gap-0.5 px-5 py-2.5 hover:bg-[var(--n-50)]">
                  <span className="t-base flex items-center gap-2 font-medium text-[var(--n-800)]">
                    {r.answered && <Check aria-label="Answered" size={14} className="shrink-0 text-[var(--ok-700)]" />}
                    <span className={`truncate ${r.answered ? "text-[var(--n-500)]" : ""}`}>{r.name}</span>
                  </span>
                  {r.request && <span className="t-sm line-clamp-1 text-[var(--n-600)]">{r.request}</span>}
                  <span className="t-xs flex flex-wrap items-center gap-x-3 text-[var(--n-500)]">
                    {r.requestedBy && <span className="inline-flex items-center gap-1"><User aria-hidden size={11} /> {r.requestedBy}</span>}
                    <span className="inline-flex items-center gap-1"><FileText aria-hidden size={11} /> {r.inputs} {r.inputs === 1 ? "input" : "inputs"}</span>
                    {due && (
                      <span className={`inline-flex items-center gap-1 ${due.overdue ? "font-medium text-[var(--err-700)]" : ""}`}>
                        <CalendarClock aria-hidden size={11} /> {due.text}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {limit && open.length > limit && (
        <Link href="/my-work#adhoc" className="t-sm block border-t border-[var(--n-100)] px-5 py-2 text-[var(--a-700)] hover:underline">
          All {open.length} open requests
        </Link>
      )}
    </section>
  );
}
