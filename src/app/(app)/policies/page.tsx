/**
 * The firm's standards — the rubric advice is given under.
 *
 * ── Why this page exists at all ────────────────────────────────────────────────────────────
 *
 * The advisor consults these before it answers, and shows the ones bearing on a question beside
 * its answer. That is only defensible if a reader can come here and see exactly what it consulted:
 * a guardrail nobody can read is a claim, not a control.
 *
 * ── A list, not a library ──────────────────────────────────────────────────────────────────
 *
 * Name, what it governs, when it took effect, who filed it. Four columns, because those are the
 * four things that decide whether a standard applies — and a missing effective date is shown as
 * missing rather than left blank, since a standard of unknown vintage reads as current.
 */

import { FileText, ShieldCheck } from "lucide-react";

import { requireSession } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { listPolicies } from "@/lib/agent/policy";
import { FilePolicyForm } from "@/components/policies/file-policy-form";

/** A bare `YYYY-MM-DD` as midnight *here*, so it renders as the day it says. */
function localDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export default async function PoliciesPage() {
  await requireSession();
  const standards = await listPolicies();

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-6 px-8 py-6">
      <header>
        <h1 className="t-xl text-[var(--n-800)]">Policies</h1>
        <p className="t-md mt-1 max-w-[80ch] text-[var(--n-600)]">
          The practice&rsquo;s own standards. The advisor reads these before it answers and shows
          the ones bearing on a question beside its answer — so what it was held to is visible here,
          not asserted.
        </p>
      </header>

      <FilePolicyForm />

      <section
        data-region="policies"
        className="overflow-hidden rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-0)]"
      >
        <div className="flex items-center gap-2 border-b border-[var(--n-200)] bg-[var(--n-50)] px-4 py-2.5">
          <ShieldCheck aria-hidden size={14} strokeWidth={2} className="text-[var(--a-700)]" />
          <h2 className="t-base font-semibold text-[var(--n-800)]">Standards in force</h2>
          <span className="t-sm num text-[var(--n-500)]">{standards.length}</span>
        </div>

        {standards.length === 0 ? (
          /*
            §7.5 — an empty surface says what would fill it. And here it says what the absence
            *costs*, which is the part that matters: with nothing filed the advisor is not being
            held to anything, and a reader is entitled to know that rather than assume otherwise.
          */
          <p className="t-sm px-4 py-6 text-[var(--n-600)]">
            No standard has been filed, so the advisor is not being held to any. File the
            practice&rsquo;s estimating standard, its sign-off policy, or its scope of services, and
            it will consult them on every question and show you which one it used.
          </p>
        ) : (
          <table className="w-full table-fixed">
            <thead>
              <tr className="border-b border-[var(--n-200)] text-left">
                <th className="t-xs w-[38%] px-4 py-2 font-semibold tracking-[0.06em] text-[var(--n-500)] uppercase">
                  Standard
                </th>
                <th className="t-xs w-[26%] px-4 py-2 font-semibold tracking-[0.06em] text-[var(--n-500)] uppercase">
                  Governs
                </th>
                <th className="t-xs w-[18%] px-4 py-2 font-semibold tracking-[0.06em] text-[var(--n-500)] uppercase">
                  Effective
                </th>
                <th className="t-xs w-[18%] px-4 py-2 font-semibold tracking-[0.06em] text-[var(--n-500)] uppercase">
                  Filed by
                </th>
              </tr>
            </thead>
            <tbody>
              {standards.map((policy) => (
                <tr key={policy.id} className="border-b border-[var(--n-100)] last:border-b-0">
                  <td className="px-4 py-2.5">
                    <span className="t-sm block font-medium text-[var(--n-800)]">
                      {policy.title}
                    </span>
                    <span className="t-xs flex items-center gap-1 text-[var(--n-500)]">
                      <FileText aria-hidden size={10} strokeWidth={2} />
                      {policy.filename}
                    </span>
                  </td>
                  <td className="t-sm px-4 py-2.5 text-[var(--n-700)]">{policy.kind}</td>
                  <td className="t-sm px-4 py-2.5 text-[var(--n-700)]">
                    {policy.effectiveFrom ? (
                      /*
                        Parsed as a local date, not through `new Date("2026-01-15")`.

                        That constructor reads a bare ISO date as UTC midnight, so anywhere west of
                        Greenwich it renders as the day before. An effective date that moves by a
                        day depending on where the reader is sitting is not a date a standard can
                        be relied on by.
                      */
                      formatDate(localDate(policy.effectiveFrom))
                    ) : (
                      /* Said, not blank. A standard of unknown vintage reads as current. */
                      <span className="text-[var(--warn-700)]">No date filed</span>
                    )}
                  </td>
                  <td className="t-sm px-4 py-2.5 text-[var(--n-600)]">{policy.filedBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p className="t-sm text-[var(--n-500)]">
        A withdrawn standard is kept but never consulted — it is what advice was given under before
        it was replaced, and deleting it would rewrite that record.
      </p>
    </div>
  );
}
