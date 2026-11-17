import { CircleDashed, ShieldCheck } from "lucide-react";

import { isChecked, type OutputRubric, type RubricRule } from "@/domain/rubric";

/**
 * One output document's rubric, as a reader works through it.
 *
 * ── Why each rule says whether it is checked ───────────────────────────────────────────────
 *
 * Two different promises are made on this page and they are worth very different amounts. A
 * **checked** rule is proved after the fact: the platform reviews what was produced and raises a
 * finding where it was not followed, so forgetting is caught. An **asked** rule is in the agent's
 * instructions and nothing verifies it — it is followed most of the time, which is not the same as
 * always.
 *
 * Printing them alike would be the useful lie: a practice reading this page would extend the
 * confidence it can have in the first kind to the second, and the rules most likely to be quietly
 * dropped are exactly the ones nothing checks. So the distinction is the loudest thing on the row.
 */
export function RubricView({ rubric }: { rubric: OutputRubric }) {
  const rules = rubric.sections.flatMap((s) => s.rules);
  const checked = rules.filter(isChecked).length;

  return (
    <section
      data-rubric={rubric.slug}
      className="overflow-hidden rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-0)]"
    >
      <header className="border-b border-[var(--n-200)] bg-[var(--n-50)] px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="t-base font-semibold text-[var(--n-800)]">{rubric.output}</h2>
          {/*
            Said, not linked. Take-off, Cost Plan and Quotations are steps *of a project*, so there
            is no one page to send a reader to from here — and a link labelled "produced in
            Take-off" that lands on the project list is worse than the plain words.
          */}
          <span data-region="produced-in" className="t-xs text-[var(--n-500)]">
            produced in {rubric.producedIn}
            <span className="num"> ({rubric.module})</span>
          </span>
          <span data-region="rule-count" className="t-xs num ml-auto text-[var(--n-500)]">
            {rules.length} rules · {checked} checked
          </span>
        </div>
        <p className="t-sm mt-1 max-w-[80ch] text-[var(--n-600)]">{rubric.purpose}</p>
      </header>

      <div className="flex flex-col">
        {rubric.sections.map((section) => (
          <div key={section.heading} className="border-b border-[var(--n-100)] last:border-b-0">
            <h3 className="t-sm max-w-[85ch] px-4 pt-4 pb-1 font-semibold text-[var(--n-800)]">
              {section.heading}
            </h3>

            <ul className="flex flex-col">
              {section.rules.map((rule) => (
                <Rule key={rule.rule} rule={rule} />
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/*
        Where the rules came from, at the foot rather than the head.

        A rubric with no provenance is somebody's opinion, and the only way to argue with one of
        these rules is to argue with the review that produced it. Naming the source is what makes
        that possible.
      */}
      <p className="t-xs border-t border-[var(--n-200)] bg-[var(--n-25)] px-4 py-2.5 text-[var(--n-500)]">
        {rubric.source}
      </p>
    </section>
  );
}

function Rule({ rule }: { rule: RubricRule }) {
  const proved = isChecked(rule);

  return (
    <li
      data-rule
      data-checked={proved}
      className="flex items-start gap-2.5 border-t border-[var(--n-100)] px-4 py-2.5 first:border-t-0"
    >
      <span
        title={
          proved
            ? "The platform reviews the finished document and raises a finding where this was not followed."
            : "The agent is asked for this. Nothing verifies it afterwards."
        }
        className={`mt-0.5 flex shrink-0 items-center gap-1 rounded-[var(--r-sm)] px-1.5 py-0.5 ${
          proved ? "bg-[var(--ok-50)] text-[var(--ok-700)]" : "bg-[var(--n-100)] text-[var(--n-600)]"
        }`}
      >
        {proved ? (
          <ShieldCheck aria-hidden size={11} strokeWidth={2} />
        ) : (
          <CircleDashed aria-hidden size={11} strokeWidth={2} />
        )}
        <span className="t-xs font-medium">{proved ? "Checked" : "Asked"}</span>
      </span>

      <span className="min-w-0 flex-1">
        <span className="t-sm block max-w-[85ch] text-[var(--n-800)]">{rule.rule}</span>
        {rule.because && (
          <span className="t-xs mt-0.5 block max-w-[85ch] text-[var(--n-500)]">{rule.because}</span>
        )}
        {proved && (
          <span data-region="finding-ids" className="t-xs mt-0.5 block font-mono text-[var(--n-400)]">
            {rule.ids?.join(" · ")}
          </span>
        )}
      </span>
    </li>
  );
}
