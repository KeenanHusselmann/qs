/**
 * The practice's resource factors — what a unit of work consumes.
 *
 * ── Why a practice writes these down ───────────────────────────────────────────────────────
 *
 * The take-off can ask a model what a square metre of walling is made of, and for **materials**
 * that is sound: 104 bricks in a square metre of one-brick walling is fixed by geometry and a QS
 * spots a wrong one instantly.
 *
 * It does not hold for **labour and plant**. Asked the same question twice on the same day the
 * model returned 0,10 and then 0,15 hours of concrete mixer per m² — a fifty per cent spread in a
 * figure somebody might price from. Hours per square metre is a productivity assumption, and that
 * belongs to the practice: it depends on the gang, the site, the access and the season, and a firm
 * that has been building for twenty years knows its own better than any general answer.
 *
 * So this is where a firm records what it actually achieves. Anything held here is used ahead of
 * the model, and the take-off says on every line which of the two it used.
 *
 * ── Appended, never edited ─────────────────────────────────────────────────────────────────
 *
 * The same rule as the rates (§6.3). Revising a factor files a new row with a later date, so a
 * take-off done last March can still be reproduced on the assumptions that applied then. There is
 * no edit control, and its absence is the point rather than an omission.
 */

"use client";

import { useMemo, useState, useTransition } from "react";
import { Layers, Plus } from "lucide-react";

import { Panel } from "@/components/shell/panel";
import { COMPONENT_KINDS, COMPONENT_KIND_LABEL, type ComponentKind } from "@/lib/pricing";
import { REGIONS } from "@/lib/rates";
import { formatDate } from "@/lib/dates";
import type { ResourceFactor } from "@/lib/factors";
import { PUBLISHED_FACTORS } from "@/lib/published-factors";
import { addFactor, withdrawFactor, type NewFactor } from "@/app/(app)/rates/actions";

const BLANK: NewFactor = {
  work: "",
  workUnit: "m2",
  kind: "material",
  resource: "",
  resourceUnit: "",
  quantity: "",
  wasteRate: "",
  region: "",
  source: "",
  effectiveDate: new Date().toISOString().slice(0, 10),
};

export function FactorPanel({ factors }: { factors: readonly ResourceFactor[] }) {
  const [draft, setDraft] = useState<NewFactor>(BLANK);
  const [problems, setProblems] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const set = <K extends keyof NewFactor>(key: K, value: NewFactor[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  /** Grouped by the work they describe, which is how a QS reads them — one build-up at a time. */
  const byWork = useMemo(() => {
    const groups = new Map<string, ResourceFactor[]>();
    for (const factor of factors) {
      const key = `${factor.work} · ${factor.workUnit}`;
      groups.set(key, [...(groups.get(key) ?? []), factor]);
    }
    return [...groups.entries()];
  }, [factors]);

  const file = () =>
    start(async () => {
      setSaved(false);
      const outcome = await addFactor(draft);
      if (outcome.ok) {
        setProblems([]);
        setSaved(true);
        // The work is kept, the resource cleared: factors are entered a build-up at a time, and
        // retyping "One-brick wall in stock brick" for each of its six resources is the kind of
        // friction that stops a practice recording them at all.
        setDraft((d) => ({ ...d, resource: "", resourceUnit: "", quantity: "", wasteRate: "" }));
      } else {
        setProblems(outcome.problems);
      }
    });

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="What a unit of work consumes"
        count={factors.length === 0 ? "None yet" : `${factors.length} on file`}
      >
        <p className="t-sm max-w-[85ch] text-[var(--n-600)]">
          Used by the take-off before anything a model proposes. <strong>Labour and plant</strong> are
          the practice&rsquo;s own productivity figures – record them here.
        </p>

        <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
          <Field label="Work" value={draft.work} onChange={(v) => set("work", v)}
                 placeholder="One-brick wall in stock brick" />
          <Field label="Measured in" value={draft.workUnit} onChange={(v) => set("workUnit", v)}
                 placeholder="m2" />

          <label className="flex flex-col gap-1">
            <span className="t-sm text-[var(--n-600)]">Kind</span>
            <select
              value={draft.kind}
              onChange={(e) => set("kind", e.target.value as ComponentKind)}
              className="t-base h-8 rounded-[var(--r-sm)] border border-[var(--n-200)] bg-[var(--n-0)] px-2 text-[var(--n-800)] outline-none focus:border-[var(--a-500)]"
            >
              {COMPONENT_KINDS.map((kind) => (
                <option key={kind} value={kind}>{COMPONENT_KIND_LABEL[kind]}</option>
              ))}
            </select>
          </label>

          <Field label="Resource" value={draft.resource} onChange={(v) => set("resource", v)}
                 placeholder="Stock brick" />
          <Field label="Resource unit" value={draft.resourceUnit}
                 onChange={(v) => set("resourceUnit", v)} placeholder="no" />
          <Field label="Per one unit" value={draft.quantity} onChange={(v) => set("quantity", v)}
                 placeholder="104" />
          {/* Optional, and it says so — blank means the method's own allowance applies, which is
              not the same as none. */}
          <Field label="Waste % (optional)" value={draft.wasteRate}
                 onChange={(v) => set("wasteRate", v)} placeholder="5" />

          <label className="flex flex-col gap-1">
            <span className="t-sm text-[var(--n-600)]">Province (optional)</span>
            <select
              value={draft.region}
              onChange={(e) => set("region", e.target.value)}
              className="t-base h-8 rounded-[var(--r-sm)] border border-[var(--n-200)] bg-[var(--n-0)] px-2 text-[var(--n-800)] outline-none focus:border-[var(--a-500)]"
            >
              <option value="">Applies everywhere</option>
              {REGIONS.map((region) => <option key={region} value={region}>{region}</option>)}
            </select>
          </label>

          {/* §6.3 — required, because a factor nobody can attribute is one nobody can defend. */}
          <Field label="Source" value={draft.source} onChange={(v) => set("source", v)}
                 placeholder="Our own output records" />
          <Field label="Applies from" value={draft.effectiveDate} type="date"
                 onChange={(v) => set("effectiveDate", v)} />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={pending}
            onClick={file}
            className="t-base flex h-8 items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--a-500)] px-3 font-medium text-white hover:bg-[var(--a-600)] disabled:opacity-50"
          >
            <Plus aria-hidden size={14} strokeWidth={2} />
            {pending ? "Filing…" : "File the factor"}
          </button>
          {saved && <span role="status" className="t-sm text-[var(--ok-700)]">Filed</span>}
        </div>

        {problems.length > 0 && (
          /* Named, all of them, rather than the first — §7.7 says what to do next. */
          <ul role="alert" className="t-sm mt-2 flex flex-col gap-0.5 text-[var(--err-700)]">
            {problems.map((problem) => <li key={problem}>{problem}</li>)}
          </ul>
        )}
      </Panel>

      {/*
        What the platform supplies until the practice does.

        Shown rather than left to be discovered in a take-off line, because a firm should be able to
        see every figure being used on its behalf and decide whether to accept it. §1.3's rule is
        that nothing is *pre-populated* — these are not: they live in code, never in this table, and
        filing a row for the same resource displaces one without editing anything.
      */}
      <Panel title="Published by the platform" count={`${PUBLISHED_FACTORS.length} factors`}>
        <p className="t-sm max-w-[85ch] text-[var(--n-600)]">
          Used until the practice files its own. Materials only, from a standard 222 × 106 × 73 mm
          brick with 10 mm joints. <strong>No labour or plant</strong>: published outputs vary
          two-fold, so record your own above.
        </p>

        <ul className="mt-3 flex flex-col gap-1">
          {PUBLISHED_FACTORS.map((row) => (
            <li key={row.id} className="flex flex-wrap items-baseline gap-x-3">
              <span className="num t-base w-24 shrink-0 text-right text-[var(--n-800)]">
                {Number(row.quantity).toString().replace(".", ",")} {row.resourceUnit}
              </span>
              <span className="t-base min-w-0 flex-1 text-[var(--n-800)]">
                {row.resource}
                <span className="t-xs ml-2 text-[var(--n-600)]">
                  per {row.workUnit} of {row.work.toLowerCase()}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="On file" count={byWork.length === 0 ? "Nothing yet" : `${byWork.length} kinds of work`} flush>
        {byWork.length === 0 ? (
          /* §7.5 — a list says what goes in it. */
          <div className="px-4 py-10 text-center">
            <Layers aria-hidden size={20} strokeWidth={1.5} className="mx-auto text-[var(--n-400)]" />
            <p className="t-base mt-2 font-medium text-[var(--n-700)]">No factors on file</p>
            <p className="t-sm mx-auto mt-1 max-w-[56ch] text-[var(--n-600)]">
              The platform&rsquo;s materials factors apply until you file your own. Start with{" "}
              <strong>labour and plant</strong>.
            </p>
          </div>
        ) : (
          <div className="flex flex-col">
            {byWork.map(([work, rows]) => (
              <section key={work} className="border-b border-[var(--n-100)] px-4 py-3 last:border-0">
                <h3 className="t-base font-semibold text-[var(--n-800)]">{work}</h3>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {rows.map((row) => (
                    <li key={row.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                      <span className="num t-base w-24 shrink-0 text-right text-[var(--n-800)]">
                        {Number(row.quantity).toString().replace(".", ",")} {row.resourceUnit}
                      </span>
                      <span className="t-base min-w-0 flex-1 text-[var(--n-800)]">
                        {row.resource}
                        <span className="t-xs ml-2 text-[var(--n-600)]">
                          {COMPONENT_KIND_LABEL[row.kind]}
                          {row.wasteRate !== null &&
                            ` · ${(Number(row.wasteRate) * 100).toString().replace(".", ",")}% waste`}
                          {row.region && ` · ${row.region}`}
                        </span>
                        <span className="t-xs block text-[var(--n-600)]">
                          {row.source} · from {formatDate(row.effectiveDate)}
                        </span>
                      </span>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => start(async () => void (await withdrawFactor(row.id)))}
                        title="Withdraw it. Revising a factor files a new row instead."
                        className="t-sm shrink-0 text-[var(--n-600)] underline underline-offset-2 disabled:opacity-40"
                      >
                        Withdraw
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="t-sm text-[var(--n-600)]">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="t-base h-8 min-w-0 rounded-[var(--r-sm)] border border-[var(--n-200)] bg-[var(--n-0)] px-2 text-[var(--n-800)] placeholder:text-[var(--n-400)] outline-none focus:border-[var(--a-500)]"
      />
    </label>
  );
}
