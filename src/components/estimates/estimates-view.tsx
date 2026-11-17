"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Copy,
  Download,
  FileUp,
  Plus,
  Save,
  Trash2,
} from "lucide-react";

import {
  addClarification,
  addCorrection,
  addEstimate,
  addLine,
  deriveEstimate,
  removeCorrection,
  removeEstimate,
  removeLine,
  respondToClarification,
  setComparison,
  startComparison,
  updateEstimate,
  withdrawComparison,
  type ComparisonAction,
} from "@/app/(app)/projects/[id]/estimate-comparison-actions";
import {
  CLARIFICATION_STATUSES,
  gapBetween,
  type Clarification,
  type ComparisonFinding,
  type PricedEstimate,
} from "@/domain/estimate-comparison";
import { displayUnit, formatMoney, money, parseMoney } from "@/domain/money";
import type { LoadedComparison } from "@/lib/estimate-comparison";

const rands = (m: bigint) => formatMoney(money(m), { symbol: "R" });
/** A rand figure as stored – read exactly, never through a float; a four-place rate is shown as written. */
const figure = (s: string) =>
  /\.\d{3,}$/.test(s) ? `R ${s}` : formatMoney(parseMoney(s), { symbol: "R" });
/** R million to two places – how the memo reads a civils estimate. */
const millions = (m: bigint) =>
  `${(Number(m) / 100 / 1e6).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (s: string) => `${+(Number(s) * 100).toFixed(2)}%`;
const field =
  "t-sm h-8 w-full rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] px-2 text-[var(--n-800)] outline-none focus:border-[var(--a-500)]";
const area =
  "t-sm w-full rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] px-2 py-1.5 text-[var(--n-800)] outline-none focus:border-[var(--a-500)]";
const button =
  "t-base flex h-8 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] px-3 font-medium text-[var(--n-700)] hover:bg-[var(--n-50)] disabled:opacity-40";
const panel =
  "overflow-hidden rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-0)]";
const th =
  "t-xs px-2 py-2 text-left font-semibold tracking-[0.04em] text-[var(--n-600)] uppercase";
const td = "t-sm px-2 py-1.5 align-top text-[var(--n-700)]";
const qty = (s: string | null) =>
  s === null
    ? ""
    : Number(s).toLocaleString("en-ZA", { maximumFractionDigits: 4 });

/** Run an action, report it, refresh. Returns whether it succeeded. */
function useAct(onOutcome: (m: string) => void) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (
    fn: () => Promise<ComparisonAction>,
    after?: (r: ComparisonAction) => void,
  ) =>
    start(async () => {
      const r = await fn();
      onOutcome(
        r.ok
          ? [r.message, ...(r.notes ?? [])].filter(Boolean).join("\n") ||
              "Saved."
          : r.reason,
      );
      after?.(r);
      router.refresh();
    });
  return { pending, run };
}

export function EstimatesView({
  projectId,
  projectName,
  comparisons,
  comparison,
  priced,
  order,
  findings,
}: {
  projectId: string;
  projectName: string;
  comparisons: { id: string; title: string }[];
  comparison: LoadedComparison | null;
  priced: PricedEstimate[];
  order: string[];
  findings: ComparisonFinding[];
}) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<string | null>(null);
  const [starting, setStarting] = useState(!comparison);
  const go = (id: string) =>
    router.push(`/projects/${projectId}/estimates?comparison=${id}`);

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-5 px-8 py-6">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-[20rem] flex-1">
          <h1 className="t-xl text-[var(--n-800)]">Estimate Comparison</h1>
          <p className="t-md mt-0.5 text-[var(--n-500)]">{projectName}</p>
          <p className="t-sm mt-2 max-w-[86ch] text-[var(--n-600)]">
            Estimates side by side, element by element, on one unit count – showing where the gap between them sits.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {comparisons.length > 1 && (
            <div className="w-64">
              <select
                aria-label="Choose a comparison"
                value={comparison?.id ?? ""}
                onChange={(e) => go(e.target.value)}
                className={field}
              >
                {comparisons.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </div>
          )}
          <button
            type="button"
            data-action="open-start-comparison"
            onClick={() => setStarting((v) => !v)}
            className={button}
          >
            <Plus aria-hidden size={13} /> Start a comparison
          </button>
          {comparison && (
            <a
              data-action="export-comparison"
              href={`/projects/${projectId}/report/pdf?document=estimate-comparison&comparison=${comparison.id}`}
              className={button}
            >
              <Download aria-hidden size={13} /> Export workbook
            </a>
          )}
        </div>
      </header>

      {starting && (
        <StartForm
          projectId={projectId}
          onOutcome={setOutcome}
          onStarted={(id) => (setStarting(false), go(id))}
        />
      )}
      {outcome && (
        <p
          role="status"
          className="t-sm whitespace-pre-line text-[var(--n-600)]"
        >
          {outcome}
        </p>
      )}

      {!comparison ? (
        <p className={`${panel} t-sm px-4 py-6 text-[var(--n-600)]`}>
          No comparison on this project yet. Start one, then add each estimate –
          from its workbook or line by line.
        </p>
      ) : (
        <>
          <Heading
            projectId={projectId}
            comparison={comparison}
            onOutcome={setOutcome}
          />
          {priced.length > 0 && (
            <Summary comparison={comparison} priced={priced} order={order} />
          )}
          {priced.length >= 2 && <GapPanel priced={priced} />}
          {findings.length > 0 && <Findings findings={findings} />}
          {priced.map((p) => (
            <EstimateCard
              key={p.estimate.id}
              projectId={projectId}
              comparison={comparison}
              priced={p}
              order={order}
              onOutcome={setOutcome}
            />
          ))}
          <AddEstimate
            projectId={projectId}
            comparisonId={comparison.id}
            onOutcome={setOutcome}
          />
          <Clarifications
            projectId={projectId}
            comparison={comparison}
            onOutcome={setOutcome}
          />
        </>
      )}
    </div>
  );
}

// ── Start and settings ────────────────────────────────────────────────────────────────────

function StartForm({
  projectId,
  onOutcome,
  onStarted,
}: {
  projectId: string;
  onOutcome: (m: string) => void;
  onStarted: (id: string) => void;
}) {
  const { pending, run } = useAct(onOutcome);
  const [form, setForm] = useState({
    title: "",
    subject: "",
    elements: "",
    commonUnits: "",
    unitLabel: "units",
  });
  const input = (
    k: keyof typeof form,
    label: string,
    cls: string,
    placeholder = "",
  ) => (
    <label className={cls}>
      <span className="t-xs text-[var(--n-600)]">{label}</span>
      <input
        name={k}
        value={form[k]}
        placeholder={placeholder}
        onChange={(e) => setForm({ ...form, [k]: e.target.value })}
        className={field}
      />
    </label>
  );
  return (
    <form
      data-form="start-comparison"
      className={`${panel} flex flex-wrap items-end gap-3 px-4 py-3`}
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => startComparison(projectId, form),
          (r) => r.ok && r.id && onStarted(r.id),
        );
      }}
    >
      {input(
        "title",
        "Title",
        "min-w-[16rem] flex-1",
        "Internal civil works – engineers' estimates",
      )}
      {input(
        "subject",
        "What is compared",
        "min-w-[16rem] flex-1",
        "NAKO ILISO Jul 2026 and N.E.T Oct 2026",
      )}
      {input(
        "elements",
        "Elements, comma-separated",
        "min-w-[18rem] flex-1",
        "Earthworks and platforms, Retaining walls, Roads and parking, …",
      )}
      {input("commonUnits", "Common count", "w-28", "1100")}
      {input("unitLabel", "Of", "w-24")}
      <button
        type="submit"
        data-action="start-comparison"
        disabled={pending}
        className={button}
      >
        <Plus aria-hidden size={13} /> Start
      </button>
    </form>
  );
}

function Heading({
  projectId,
  comparison,
  onOutcome,
}: {
  projectId: string;
  comparison: LoadedComparison;
  onOutcome: (m: string) => void;
}) {
  const { pending, run } = useAct(onOutcome);
  const router = useRouter();
  const [form, setForm] = useState({
    commonUnits: comparison.commonUnits
      ? String(Number(comparison.commonUnits))
      : "",
    unitLabel: comparison.unitLabel,
    alternativeContingency: comparison.alternativeContingency
      ? String(Number(comparison.alternativeContingency) * 100)
      : "",
    elements: comparison.elements.join(", "),
  });
  return (
    <section data-region="comparison-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-4">
        <h2 className="t-lg font-semibold text-[var(--n-800)]">
          {comparison.title}
        </h2>
        {comparison.subject && (
          <span className="t-sm text-[var(--n-500)]">{comparison.subject}</span>
        )}
        <button
          type="button"
          aria-label="Withdraw this comparison"
          disabled={pending}
          onClick={() => {
            if (
              !window.confirm(
                `Withdraw "${comparison.title}"? It is kept on the record and leaves this page.`,
              )
            )
              return;
            run(
              () => withdrawComparison(projectId, comparison.id),
              () => router.push(`/projects/${projectId}/estimates`),
            );
          }}
          className="ml-auto text-[var(--n-400)] hover:text-[var(--err-700)]"
        >
          <Trash2 aria-hidden size={15} />
        </button>
      </div>
      <form
        data-form="comparison-settings"
        className={`${panel} flex flex-wrap items-end gap-2 px-4 py-3`}
        onSubmit={(e) => {
          e.preventDefault();
          run(() => setComparison(projectId, comparison.id, form));
        }}
      >
        <label className="w-28">
          <span className="t-xs text-[var(--n-600)]">Common count</span>
          <input
            name="commonUnits"
            value={form.commonUnits}
            onChange={(e) => setForm({ ...form, commonUnits: e.target.value })}
            className={field}
          />
        </label>
        <label className="w-24">
          <span className="t-xs text-[var(--n-600)]">Of</span>
          <input
            value={form.unitLabel}
            onChange={(e) => setForm({ ...form, unitLabel: e.target.value })}
            className={field}
          />
        </label>
        <label className="w-36">
          <span className="t-xs text-[var(--n-600)]">
            Also test contingency %
          </span>
          <input
            name="alternativeContingency"
            value={form.alternativeContingency}
            onChange={(e) =>
              setForm({ ...form, alternativeContingency: e.target.value })
            }
            className={field}
          />
        </label>
        <label className="min-w-[20rem] flex-1">
          <span className="t-xs text-[var(--n-600)]">
            Elements, in reading order
          </span>
          <input
            value={form.elements}
            onChange={(e) => setForm({ ...form, elements: e.target.value })}
            className={field}
          />
        </label>
        <button
          type="submit"
          data-action="save-comparison"
          disabled={pending}
          className={button}
        >
          <Save aria-hidden size={13} /> Save
        </button>
      </form>
    </section>
  );
}

// ── The memo's Table 1 ────────────────────────────────────────────────────────────────────

function Summary({
  comparison,
  priced,
  order,
}: {
  comparison: LoadedComparison;
  priced: PricedEstimate[];
  order: string[];
}) {
  const nameOf = (id: string | null) =>
    priced.find((p) => p.estimate.id === id)?.estimate.name;
  const row = (
    label: string,
    cells: (p: PricedEstimate) => string,
    opts: { bold?: boolean; key?: string } = {},
  ) => (
    <tr key={opts.key ?? label} className="border-t border-[var(--n-100)]">
      <td
        className={`${td} ${opts.bold ? "font-semibold text-[var(--n-800)]" : ""}`}
      >
        {label}
      </td>
      {priced.map((p) => (
        <td
          key={p.estimate.id}
          className={`${td} num text-right ${opts.bold ? "font-semibold text-[var(--n-800)]" : ""}`}
        >
          {cells(p)}
        </td>
      ))}
    </tr>
  );
  return (
    <section
      data-region="comparison-summary"
      className={`${panel} overflow-x-auto`}
    >
      <table className="w-full min-w-[760px] border-collapse">
        <thead className="bg-[var(--n-50)]">
          <tr>
            <th className={th}>R million, excl. VAT</th>
            {priced.map((p) => (
              <th key={p.estimate.id} className={`${th} text-right`}>
                {p.estimate.name}
                {p.estimate.derivedFrom && (
                  <span className="block normal-case tracking-normal text-[var(--a-700)]">
                    from{" "}
                    {nameOf(p.estimate.derivedFrom) ??
                      "an estimate since removed"}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {order.map((element) =>
            row(element, (p) => {
              const e = p.elements.find((x) => x.element === element)!;
              return e.amount === 0n ? "–" : millions(e.amount);
            }),
          )}
          {row("Direct works", (p) => millions(p.direct), { bold: true })}
          {row(
            "Preliminary and general",
            (p) =>
              `${millions(p.preliminaries)} (${pct(p.estimate.preliminaries)})`,
          )}
          {row(
            "Contingency",
            (p) =>
              `${millions(p.contingency)} (${pct(p.estimate.contingency)})`,
          )}
          {row("Total excl. VAT", (p) => millions(p.total), { bold: true })}
          {comparison.alternativeContingency &&
            row(
              `Total at ${pct(comparison.alternativeContingency)} contingency`,
              (p) =>
                p.alternativeTotal === null
                  ? "–"
                  : millions(p.alternativeTotal),
            )}
          {row(
            `${comparison.unitLabel[0]?.toUpperCase()}${comparison.unitLabel.slice(1)} assumed`,
            (p) => qty(p.estimate.units) || "not stated",
          )}
          {row(
            `Per ${comparison.unitLabel.replace(/s$/, "")}, own count (R)`,
            (p) => (p.perUnitOwn === null ? "–" : rands(p.perUnitOwn)),
          )}
          {comparison.commonUnits &&
            row(
              `Per ${comparison.unitLabel.replace(/s$/, "")} at ${qty(comparison.commonUnits)} (R)`,
              (p) => (p.perUnitCommon === null ? "–" : rands(p.perUnitCommon)),
              { bold: true },
            )}
          {row("Lump sums in direct works", (p) =>
            p.lumpShare === null ? "–" : `${Math.round(p.lumpShare * 100)}%`,
          )}
        </tbody>
      </table>
    </section>
  );
}

function GapPanel({ priced }: { priced: PricedEstimate[] }) {
  const [from, setFrom] = useState(
    priced[1]?.estimate.id ?? priced[0].estimate.id!,
  );
  const [to, setTo] = useState(priced[0].estimate.id!);
  const a = priced.find((p) => p.estimate.id === from) ?? priced[1];
  const b = priced.find((p) => p.estimate.id === to) ?? priced[0];
  const gap = useMemo(() => gapBetween(a, b), [a, b]);
  const largest = gap.parts.reduce(
    (m, p) =>
      (p.difference < 0n ? -p.difference : p.difference) > m
        ? p.difference < 0n
          ? -p.difference
          : p.difference
        : m,
    1n,
  );
  return (
    <section data-region="comparison-gap" className={panel}>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--n-200)] bg-[var(--n-50)] px-4 py-2.5">
        <h2 className="t-base font-semibold text-[var(--n-800)]">
          Where the gap sits
        </h2>
        <div className="w-56">
          <select
            aria-label="Compare to"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className={field}
          >
            {priced.map((p) => (
              <option key={p.estimate.id} value={p.estimate.id}>
                {p.estimate.name}
              </option>
            ))}
          </select>
        </div>
        <span className="t-sm text-[var(--n-600)]">less</span>
        <div className="w-56">
          <select
            aria-label="Compare from"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className={field}
          >
            {priced.map((p) => (
              <option key={p.estimate.id} value={p.estimate.id}>
                {p.estimate.name}
              </option>
            ))}
          </select>
        </div>
        <span className="t-base num ml-auto font-semibold text-[var(--n-800)]">
          R{millions(gap.total)}m
        </span>
      </div>
      <ul className="px-4 py-2">
        {gap.parts.map((p) => {
          const size =
            Number(
              ((p.difference < 0n ? -p.difference : p.difference) * 1000n) /
                largest,
            ) / 10;
          return (
            <li
              key={p.label}
              data-gap-part={p.label}
              className="grid grid-cols-[14rem_6rem_1fr] items-center gap-3 py-1"
            >
              <span className="t-sm text-[var(--n-700)]">{p.label}</span>
              <span
                className={`t-sm num text-right ${p.difference < 0n ? "text-[var(--ok-700)]" : "text-[var(--n-800)]"}`}
              >
                {millions(p.difference)}
              </span>
              <span className="h-2 rounded-[var(--r-full)] bg-[var(--n-100)]">
                <span
                  className={`block h-2 rounded-[var(--r-full)] ${p.difference < 0n ? "bg-[var(--ok-500)]" : "bg-[var(--a-500)]"}`}
                  style={{ width: `${size}%` }}
                />
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Findings({ findings }: { findings: ComparisonFinding[] }) {
  return (
    <section
      data-region="comparison-findings"
      className="overflow-hidden rounded-[var(--r-lg)] border border-[var(--warn-500)] bg-[var(--warn-50)]"
    >
      <div className="flex items-center gap-2 border-b border-[var(--warn-500)] px-4 py-2">
        <AlertTriangle
          aria-hidden
          size={14}
          className="text-[var(--warn-700)]"
        />
        <h2 className="t-base font-semibold text-[var(--n-800)]">
          Before any of these is used
        </h2>
        <span className="t-xs ml-auto text-[var(--n-600)]">
          questions, not corrections
        </span>
      </div>
      <ul>
        {findings.map((f) => (
          <li
            key={f.id}
            data-finding={f.id}
            className="border-b border-[var(--n-200)] px-4 py-2.5 last:border-b-0"
          >
            <p className="t-sm font-medium text-[var(--n-800)]">{f.finding}</p>
            <p className="t-sm text-[var(--n-600)]">{f.action}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── One estimate ──────────────────────────────────────────────────────────────────────────

function EstimateCard({
  projectId,
  comparison,
  priced,
  order,
  onOutcome,
}: {
  projectId: string;
  comparison: LoadedComparison;
  priced: PricedEstimate;
  order: string[];
  onOutcome: (m: string) => void;
}) {
  const e = priced.estimate;
  const { pending, run } = useAct(onOutcome);
  const [form, setForm] = useState({
    name: e.name,
    preparedBy: e.preparedBy ?? "",
    dated: e.dated ?? "",
    basis: e.basis ?? "",
    units: e.units ? String(Number(e.units)) : "",
    preliminaries: String(+(Number(e.preliminaries) * 100).toFixed(2)),
    contingency: String(+(Number(e.contingency) * 100).toFixed(2)),
  });
  const [line, setLine] = useState({
    element: order[0] ?? "",
    description: "",
    quantity: "",
    unit: "",
    rate: "",
    lumpSum: "",
  });
  const [corr, setCorr] = useState({
    element: order[0] ?? "",
    description: "",
    amount: "",
    basis: "",
  });
  const input = <T extends Record<string, string>>(
    state: T,
    set: (s: T) => void,
    k: keyof T & string,
    label: string,
    cls: string,
    form?: string,
  ) => (
    <label className={cls}>
      <span className="t-xs text-[var(--n-600)]">{label}</span>
      <input
        name={k}
        value={state[k]}
        onChange={(ev) => set({ ...state, [k]: ev.target.value })}
        className={field}
        data-form-field={form}
      />
    </label>
  );

  return (
    <section data-estimate={e.name} className={panel}>
      <form
        data-form="estimate-details"
        className="flex flex-wrap items-end gap-2 border-b border-[var(--n-200)] bg-[var(--n-50)] px-4 py-3"
        onSubmit={(ev) => {
          ev.preventDefault();
          run(() => updateEstimate(projectId, comparison.id, e.id!, form));
        }}
      >
        {input(form, setForm, "name", "Estimate", "min-w-[12rem] flex-1")}
        {input(form, setForm, "preparedBy", "Prepared by", "w-40")}
        {input(form, setForm, "dated", "Dated", "w-28")}
        {input(form, setForm, "units", "Units", "w-24")}
        {input(form, setForm, "preliminaries", "P&G %", "w-20")}
        {input(form, setForm, "contingency", "Contingency %", "w-28")}
        {input(
          form,
          setForm,
          "basis",
          "How it was made",
          "min-w-[16rem] flex-1",
        )}
        <button type="submit" disabled={pending} className={button}>
          <Save aria-hidden size={13} /> Save
        </button>
        <button
          type="button"
          data-action="derive-estimate"
          disabled={pending}
          onClick={() =>
            run(() =>
              deriveEstimate(projectId, comparison.id, e.id!, {
                name: `${e.name}, stress-tested`,
              }),
            )
          }
          className={button}
        >
          <Copy aria-hidden size={13} /> Derive a corrected copy
        </button>
        <button
          type="button"
          aria-label={`Remove ${e.name}`}
          disabled={pending}
          onClick={() =>
            window.confirm(
              `Remove ${e.name} and its lines from the comparison?`,
            ) && run(() => removeEstimate(projectId, comparison.id, e.id!))
          }
          className="text-[var(--n-400)] hover:text-[var(--err-700)]"
        >
          <Trash2 aria-hidden size={15} />
        </button>
      </form>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] border-collapse">
          <thead className="bg-[var(--n-25)]">
            <tr>
              <th className={th}>Description</th>
              <th className={`${th} text-right`}>Qty</th>
              <th className={th}>Unit</th>
              <th className={`${th} text-right`}>Rate</th>
              <th className={`${th} text-right`}>Lump sum</th>
              <th className={`${th} text-right`}>Amount</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {priced.elements
              .filter((el) => el.lines > 0 || el.corrections !== 0n)
              .map((el) => (
                <ElementRows
                  key={el.element}
                  el={el}
                  lines={e.lines.filter((l) => l.element === el.element)}
                  onRemove={(id) =>
                    run(() => removeLine(projectId, comparison.id, e.id!, id))
                  }
                  pending={pending}
                />
              ))}
            <tr className="border-t-2 border-[var(--n-200)]">
              <td
                className={`${td} font-semibold text-[var(--n-800)]`}
                colSpan={5}
              >
                Direct works
                {priced.lumpShare !== null && (
                  <span className="t-xs ml-2 font-normal text-[var(--n-500)]">
                    {Math.round(priced.lumpShare * 100)}% lump sums
                  </span>
                )}
              </td>
              <td
                className={`${td} num text-right font-semibold text-[var(--n-800)]`}
              >
                {rands(priced.direct)}
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      <form
        data-form="add-line"
        className="flex flex-wrap items-end gap-2 border-t border-[var(--n-100)] bg-[var(--n-25)] px-4 py-3"
        onSubmit={(ev) => {
          ev.preventDefault();
          run(
            () => addLine(projectId, comparison.id, e.id!, line),
            (r) =>
              r.ok &&
              setLine({
                ...line,
                description: "",
                quantity: "",
                rate: "",
                lumpSum: "",
              }),
          );
        }}
      >
        <label className="w-48">
          <span className="t-xs text-[var(--n-600)]">Element</span>
          <input
            name="element"
            list={`elements-${e.id}`}
            value={line.element}
            onChange={(ev) => setLine({ ...line, element: ev.target.value })}
            className={field}
          />
        </label>
        <datalist id={`elements-${e.id}`}>
          {order.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
        {input(line, setLine, "description", "Line", "min-w-[14rem] flex-1")}
        {input(line, setLine, "quantity", "Qty", "w-24")}
        {input(line, setLine, "unit", "Unit", "w-16")}
        {input(line, setLine, "rate", "Rate", "w-24")}
        {input(line, setLine, "lumpSum", "or lump sum", "w-28")}
        <button
          type="submit"
          data-action="add-line"
          disabled={pending}
          className={button}
        >
          <Plus aria-hidden size={13} /> Add line
        </button>
      </form>

      {e.derivedFrom && (
        <div
          data-region="corrections"
          className="border-t border-[var(--n-200)]"
        >
          <p className="t-sm px-4 pt-3 font-semibold text-[var(--n-800)]">
            Corrections
          </p>
          {e.corrections.length === 0 ? (
            <p className="t-sm px-4 py-2 text-[var(--n-500)]">
              None yet. Each correction says what it changes, by how much, and
              on what basis.
            </p>
          ) : (
            <table className="w-full border-collapse">
              <tbody>
                {e.corrections.map((c) => (
                  <tr
                    key={c.id}
                    data-correction={c.ref}
                    className="border-t border-[var(--n-100)]"
                  >
                    <td className={`${td} num w-10 font-semibold`}>{c.ref}</td>
                    <td className={`${td} w-48 text-[var(--n-500)]`}>
                      {c.element}
                    </td>
                    <td className={td}>
                      {c.description}
                      {c.basis ? (
                        <span className="t-xs block text-[var(--n-500)]">
                          {c.basis}
                        </span>
                      ) : (
                        <span className="t-xs block text-[var(--warn-700)]">
                          No basis stated.
                        </span>
                      )}
                    </td>
                    <td className={`${td} num w-36 text-right`}>
                      {figure(c.amount)}
                    </td>
                    <td className="w-8">
                      <button
                        type="button"
                        aria-label={`Remove correction ${c.ref}`}
                        disabled={pending}
                        onClick={() =>
                          run(() =>
                            removeCorrection(
                              projectId,
                              comparison.id,
                              e.id!,
                              c.id!,
                            ),
                          )
                        }
                        className="text-[var(--n-400)] hover:text-[var(--err-700)]"
                      >
                        <Trash2 aria-hidden size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <form
            data-form="add-correction"
            className="flex flex-wrap items-end gap-2 px-4 py-3"
            onSubmit={(ev) => {
              ev.preventDefault();
              run(
                () => addCorrection(projectId, comparison.id, e.id!, corr),
                (r) =>
                  r.ok &&
                  setCorr({ ...corr, description: "", amount: "", basis: "" }),
              );
            }}
          >
            <label className="w-48">
              <span className="t-xs text-[var(--n-600)]">Element</span>
              <input
                name="element"
                list={`elements-${e.id}`}
                value={corr.element}
                onChange={(ev) =>
                  setCorr({ ...corr, element: ev.target.value })
                }
                className={field}
              />
            </label>
            {input(
              corr,
              setCorr,
              "description",
              "What it changes",
              "min-w-[14rem] flex-1",
            )}
            {input(corr, setCorr, "amount", "Adds (R)", "w-32")}
            {input(
              corr,
              setCorr,
              "basis",
              "On what basis",
              "min-w-[14rem] flex-1",
            )}
            <button
              type="submit"
              data-action="add-correction"
              disabled={pending}
              className={button}
            >
              <Plus aria-hidden size={13} /> Apply
            </button>
          </form>
        </div>
      )}
    </section>
  );
}

function ElementRows({
  el,
  lines,
  onRemove,
  pending,
}: {
  el: PricedEstimate["elements"][number];
  lines: LoadedComparison["estimates"][number]["lines"];
  onRemove: (id: string) => void;
  pending: boolean;
}) {
  return (
    <>
      <tr className="bg-[var(--n-50)]">
        <td
          className="t-xs px-2 py-1.5 font-semibold tracking-[0.04em] text-[var(--n-700)] uppercase"
          colSpan={5}
        >
          {el.element}
          {el.allIn && (
            <span className="ml-2 normal-case tracking-normal font-normal text-[var(--n-500)]">
              {rands(el.allIn.rate)}/{displayUnit(el.allIn.unit)} all-in over{" "}
              {qty(el.allIn.quantity)} {displayUnit(el.allIn.unit)}
            </span>
          )}
          {el.corrections !== 0n && (
            <span className="ml-2 normal-case tracking-normal font-normal text-[var(--a-700)]">
              incl. corrections {rands(el.corrections)}
            </span>
          )}
        </td>
        <td className="t-sm num px-2 py-1.5 text-right font-semibold text-[var(--n-800)]">
          {rands(el.amount)}
        </td>
        <td />
      </tr>
      {lines.map((l) => {
        const measured = l.quantity !== null && l.rate !== null;
        return (
          <tr
            key={l.id}
            data-line={l.description}
            className="border-t border-[var(--n-100)]"
          >
            <td className={td}>{l.description}</td>
            <td className={`${td} num text-right`}>{qty(l.quantity)}</td>
            <td className={td}>{l.unit ? displayUnit(l.unit) : ""}</td>
            <td className={`${td} num text-right`}>
              {l.rate ? figure(l.rate) : ""}
            </td>
            <td
              className={`${td} num text-right ${l.lumpSum ? "text-[var(--warn-700)]" : ""}`}
            >
              {l.lumpSum ? figure(l.lumpSum) : ""}
            </td>
            <td className={`${td} num text-right`}>
              {measured || l.lumpSum ? (
                ""
              ) : (
                <span className="t-xs text-[var(--err-700)]">unpriced</span>
              )}
            </td>
            <td className="w-8">
              <button
                type="button"
                aria-label={`Remove ${l.description}`}
                disabled={pending}
                onClick={() => onRemove(l.id!)}
                className="text-[var(--n-400)] hover:text-[var(--err-700)]"
              >
                <Trash2 aria-hidden size={13} />
              </button>
            </td>
          </tr>
        );
      })}
    </>
  );
}

function AddEstimate({
  projectId,
  comparisonId,
  onOutcome,
}: {
  projectId: string;
  comparisonId: string;
  onOutcome: (m: string) => void;
}) {
  const { pending, run } = useAct(onOutcome);
  const [open, setOpen] = useState(false);
  return (
    <section className={panel}>
      <button
        type="button"
        data-action="open-add-estimate"
        onClick={() => setOpen((v) => !v)}
        className="t-base flex w-full items-center gap-2 px-4 py-3 font-semibold text-[var(--n-800)] hover:bg-[var(--n-25)]"
      >
        <Plus aria-hidden size={14} /> Add an estimate
      </button>
      {open && (
        <form
          data-form="add-estimate"
          className="flex flex-wrap items-end gap-2 border-t border-[var(--n-100)] px-4 py-3"
          onSubmit={(ev) => {
            ev.preventDefault();
            const data = new FormData(ev.currentTarget);
            run(
              () => addEstimate(projectId, comparisonId, data),
              (r) => r.ok && setOpen(false),
            );
          }}
        >
          {[
            ["name", "Whose estimate", "min-w-[12rem] flex-1"],
            ["preparedBy", "Prepared by", "w-40"],
            ["dated", "Dated", "w-28"],
            ["units", "Units", "w-24"],
            ["preliminaries", "P&G %", "w-20"],
            ["contingency", "Contingency %", "w-28"],
            ["basis", "How it was made", "min-w-[16rem] flex-1"],
          ].map(([name, label, cls]) => (
            <label key={name} className={cls}>
              <span className="t-xs text-[var(--n-600)]">{label}</span>
              <input name={name} className={field} />
            </label>
          ))}
          <label className="min-w-[18rem] flex-1">
            <span className="t-xs text-[var(--n-600)]">
              Its lines, from the cost model (.xlsx, optional)
            </span>
            <input
              name="file"
              type="file"
              accept=".xlsx"
              className="t-sm block w-full"
            />
          </label>
          <button
            type="submit"
            data-action="add-estimate"
            disabled={pending}
            className={button}
          >
            <FileUp aria-hidden size={13} /> Add
          </button>
        </form>
      )}
    </section>
  );
}

// ── Clarifications ────────────────────────────────────────────────────────────────────────

function Clarifications({
  projectId,
  comparison,
  onOutcome,
}: {
  projectId: string;
  comparison: LoadedComparison;
  onOutcome: (m: string) => void;
}) {
  const { pending, run } = useAct(onOutcome);
  const [form, setForm] = useState({
    estimate: "",
    observation: "",
    evidence: "",
    consequence: "",
  });
  return (
    <section data-region="clarifications" className={panel}>
      <div className="border-b border-[var(--n-200)] bg-[var(--n-50)] px-4 py-2.5">
        <h2 className="t-base font-semibold text-[var(--n-800)]">
          Clarifications
        </h2>
        <p className="t-xs text-[var(--n-500)]">
          Observations that go back to an estimate&rsquo;s author, with the
          evidence and what follows from them.
        </p>
      </div>
      <ul>
        {comparison.clarifications.map((c) => (
          <ClarificationRow
            key={c.id}
            projectId={projectId}
            comparisonId={comparison.id}
            clarification={c}
            onOutcome={onOutcome}
          />
        ))}
      </ul>
      <form
        data-form="add-clarification"
        className="flex flex-wrap items-end gap-2 border-t border-[var(--n-100)] bg-[var(--n-25)] px-4 py-3"
        onSubmit={(ev) => {
          ev.preventDefault();
          run(
            () => addClarification(projectId, comparison.id, form),
            (r) =>
              r.ok &&
              setForm({
                estimate: form.estimate,
                observation: "",
                evidence: "",
                consequence: "",
              }),
          );
        }}
      >
        <label className="w-44">
          <span className="t-xs text-[var(--n-600)]">To</span>
          <select
            name="estimate"
            value={form.estimate}
            onChange={(e) => setForm({ ...form, estimate: e.target.value })}
            className={field}
          >
            <option value="">All</option>
            {comparison.estimates.map((e) => (
              <option key={e.id} value={e.name}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        {(["observation", "evidence", "consequence"] as const).map((k) => (
          <label key={k} className="min-w-[14rem] flex-1">
            <span className="t-xs text-[var(--n-600)]">
              {k[0].toUpperCase() + k.slice(1)}
            </span>
            <input
              name={k}
              value={form[k]}
              onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              className={field}
            />
          </label>
        ))}
        <button
          type="submit"
          data-action="add-clarification"
          disabled={pending}
          className={button}
        >
          <Plus aria-hidden size={13} /> Raise
        </button>
      </form>
    </section>
  );
}

function ClarificationRow({
  projectId,
  comparisonId,
  clarification: c,
  onOutcome,
}: {
  projectId: string;
  comparisonId: string;
  clarification: Clarification;
  onOutcome: (m: string) => void;
}) {
  const { pending, run } = useAct(onOutcome);
  const [response, setResponse] = useState(c.response ?? "");
  const [status, setStatus] = useState<string>(c.status);
  return (
    <li
      data-clarification={c.number}
      data-status={c.status}
      className="border-b border-[var(--n-100)] px-4 py-3"
    >
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="t-sm num font-semibold text-[var(--n-700)]">
          C{c.number}
        </span>
        <span className="t-sm font-medium text-[var(--n-800)]">
          {c.observation}
        </span>
        {c.estimate && (
          <span className="t-xs text-[var(--n-500)]">to {c.estimate}</span>
        )}
        <span className="t-xs ml-auto font-medium text-[var(--n-700)]">
          {c.status}
        </span>
      </div>
      {c.evidence && (
        <p className="t-sm mt-1 text-[var(--n-600)]">{c.evidence}</p>
      )}
      {c.consequence && (
        <p className="t-sm text-[var(--n-700)]">{c.consequence}</p>
      )}
      <form
        data-form="respond-clarification"
        className="mt-2 flex flex-wrap items-end gap-2"
        onSubmit={(ev) => {
          ev.preventDefault();
          run(() =>
            respondToClarification(projectId, comparisonId, c.id!, {
              response,
              status,
            }),
          );
        }}
      >
        <label className="min-w-[20rem] flex-1">
          <span className="sr-only">Response to C{c.number}</span>
          <textarea
            rows={1}
            value={response}
            onChange={(e) => setResponse(e.target.value)}
            placeholder="Response, as received"
            className={`${area} bg-[var(--warn-50)]`}
          />
        </label>
        <div className="w-32 shrink-0">
          <select
            aria-label={`Status of C${c.number}`}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className={field}
          >
            {CLARIFICATION_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={pending} className={button}>
          <Save aria-hidden size={13} /> Save
        </button>
      </form>
    </li>
  );
}
