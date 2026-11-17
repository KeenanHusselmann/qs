"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Download,
  FileUp,
  Plus,
  Save,
  Trash2,
} from "lucide-react";

import {
  addQuery,
  importReviewWorkbook,
  markItem,
  respondToQuery,
  setAssumptions,
  setItemRate,
  startReview,
  withdrawReview,
} from "@/app/(app)/projects/[id]/design-review-actions";
import {
  ITEM_STATUSES,
  QUERY_PRIORITIES,
  QUERY_STATUSES,
  STATUS_MEANS,
  type ComparisonRow,
  type ItemStatus,
  type OptionEstimate,
  type ReviewFinding,
  type ReviewItem,
  type ReviewQuery,
  type StatusCount,
} from "@/domain/design-review";
import { displayUnit, formatMoney, money } from "@/domain/money";
import type { LoadedReview } from "@/lib/design-review";

const rands = (m: bigint) => formatMoney(money(m), { symbol: "R" });
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

/** A quantity string for reading – "1473.1500" is 1 473,15; null is n/a. */
const qty = (s: string | null | undefined) => {
  if (s === null || s === undefined || s === "") return "n/a";
  const [w, f = ""] = s.split(".");
  const frac = f.replace(/0+$/, "");
  return `${w.replace(/\B(?=(\d{3})+(?!\d))/g, " ")}${frac ? `,${frac.length < 2 ? frac.padEnd(2, "0") : frac}` : ""}`;
};
/** A difference with its sign shown: +238 or −1 473,15. */
const signed = (d: string) =>
  d.startsWith("-") ? `−${qty(d.slice(1))}` : `+${qty(d)}`;
const pct = (s: string) =>
  `${(Number(s) * 100).toFixed((Number(s) * 100) % 1 === 0 ? 0 : 1)}%`;

/** Status colours: settled, needs a decision, wrong. */
const TONE: Record<ItemStatus, string> = {
  Aligned: "bg-[var(--ok-50)] text-[var(--ok-700)]",
  Standard: "bg-[var(--n-100)] text-[var(--n-700)]",
  "QS addition": "bg-[var(--n-100)] text-[var(--n-700)]",
  Query: "bg-[var(--warn-50)] text-[var(--warn-700)]",
  Discrepancy: "bg-[var(--warn-50)] text-[var(--warn-700)]",
  Gap: "bg-[var(--err-50)] text-[var(--err-700)]",
  Error: "bg-[var(--err-50)] text-[var(--err-700)]",
};

type Tab =
  "items" | "queries" | "estimate" | "comparison" | "parameters" | "sources";
const TABS: { key: Tab; label: string }[] = [
  { key: "items", label: "Item Mapping" },
  { key: "queries", label: "Queries" },
  { key: "estimate", label: "Cost Estimate" },
  { key: "comparison", label: "Option Comparison" },
  { key: "parameters", label: "Design Parameters" },
  { key: "sources", label: "Sources" },
];

export interface Computed {
  estimates: OptionEstimate[];
  comparison: ComparisonRow[];
  findings: ReviewFinding[];
  counts: { counts: StatusCount[]; unmarked: number; total: number };
  queries: { open: number; answered: number; closed: number; highOpen: number };
}

export function ReviewView({
  projectId,
  projectName,
  reviews,
  review,
  computed,
}: {
  projectId: string;
  projectName: string;
  reviews: { id: string; title: string }[];
  review: LoadedReview | null;
  computed: Computed | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("items");
  const [panelOpen, setPanelOpen] = useState<"import" | "start" | null>(
    review ? null : "import",
  );
  const [outcome, setOutcome] = useState<string | null>(null);
  const [pending, act] = useTransition();

  const go = (id: string) =>
    router.push(`/projects/${projectId}/review?review=${id}`);

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-5 px-8 py-6">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-[20rem] flex-1">
          <h1 className="t-xl text-[var(--n-800)]">Design Review</h1>
          <p className="t-md mt-0.5 text-[var(--n-500)]">{projectName}</p>
          <p className="t-sm mt-2 max-w-[86ch] text-[var(--n-600)]">
            Check a draft bill against the consultants&rsquo; documents, item by item. Imports and exports the review workbook.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {reviews.length > 1 && (
            <div className="w-64">
              <select
                aria-label="Choose a review"
                value={review?.id ?? ""}
                onChange={(e) => go(e.target.value)}
                className={field}
              >
                {reviews.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
            </div>
          )}
          <button
            type="button"
            data-action="open-import"
            onClick={() =>
              setPanelOpen(panelOpen === "import" ? null : "import")
            }
            className={button}
          >
            <FileUp aria-hidden size={13} /> Import workbook
          </button>
          <button
            type="button"
            data-action="open-start"
            onClick={() => setPanelOpen(panelOpen === "start" ? null : "start")}
            className={button}
          >
            <Plus aria-hidden size={13} /> Start a review
          </button>
          {review && (
            <a
              data-action="export-review"
              href={`/projects/${projectId}/report/pdf?document=design-review&review=${review.id}`}
              className={button}
            >
              <Download aria-hidden size={13} /> Export workbook
            </a>
          )}
        </div>
      </header>

      {panelOpen === "import" && (
        <ImportForm
          projectId={projectId}
          onDone={(message, id) => {
            setOutcome(message);
            if (id) {
              setPanelOpen(null);
              go(id);
            }
          }}
        />
      )}
      {panelOpen === "start" && (
        <StartForm
          projectId={projectId}
          onDone={(message, id) => {
            setOutcome(message);
            if (id) {
              setPanelOpen(null);
              go(id);
            }
          }}
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

      {!review || !computed ? (
        <section className={`${panel} px-4 py-6`}>
          <p className="t-sm text-[var(--n-600)]">
            No review yet. Import the mapping workbook, or start one here.
          </p>
        </section>
      ) : (
        <>
          <section
            data-region="review-heading"
            className="flex flex-wrap items-baseline gap-x-4 gap-y-1"
          >
            <h2 className="t-lg font-semibold text-[var(--n-800)]">
              {review.title}
            </h2>
            {review.subject && (
              <span className="t-sm text-[var(--n-500)]">{review.subject}</span>
            )}
            {review.sourceFile && (
              <span className="t-xs text-[var(--n-400)]">
                from {review.sourceFile}
              </span>
            )}
            <button
              type="button"
              aria-label="Withdraw this review"
              disabled={pending}
              onClick={() => {
                if (
                  !window.confirm(
                    `Withdraw "${review.title}"? It is kept on the record and leaves this page.`,
                  )
                )
                  return;
                act(async () => {
                  const r = await withdrawReview(projectId, review.id);
                  setOutcome(r.ok ? "The review is withdrawn." : r.reason);
                  router.push(`/projects/${projectId}/review`);
                  router.refresh();
                });
              }}
              className="ml-auto text-[var(--n-400)] hover:text-[var(--err-700)]"
            >
              <Trash2 aria-hidden size={15} />
            </button>
          </section>

          <Summary
            review={review}
            computed={computed}
            onStatus={() => setTab("items")}
          />

          {computed.findings.length > 0 && (
            <Findings findings={computed.findings} />
          )}

          <nav
            aria-label="Review sheets"
            className="flex flex-wrap gap-1 border-b border-[var(--n-200)]"
          >
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                data-tab={t.key}
                aria-current={tab === t.key ? "page" : undefined}
                onClick={() => setTab(t.key)}
                className={`t-sm -mb-px border-b-2 px-3 py-2 font-medium ${tab === t.key ? "border-[var(--a-600)] text-[var(--n-800)]" : "border-transparent text-[var(--n-500)] hover:text-[var(--n-700)]"}`}
              >
                {t.label}
                {t.key === "queries" && computed.queries.open > 0 && (
                  <span className="t-xs num ml-1.5 text-[var(--warn-700)]">
                    {computed.queries.open} open
                  </span>
                )}
              </button>
            ))}
          </nav>

          {tab === "items" && (
            <Items
              projectId={projectId}
              review={review}
              onOutcome={setOutcome}
            />
          )}
          {tab === "queries" && (
            <Queries
              projectId={projectId}
              review={review}
              onOutcome={setOutcome}
            />
          )}
          {tab === "estimate" && (
            <Estimate
              projectId={projectId}
              review={review}
              estimates={computed.estimates}
              onOutcome={setOutcome}
            />
          )}
          {tab === "comparison" && (
            <Comparison review={review} rows={computed.comparison} />
          )}
          {tab === "parameters" && <Parameters review={review} />}
          {tab === "sources" && <Sources review={review} />}
        </>
      )}
    </div>
  );
}

// ── Import and start ──────────────────────────────────────────────────────────────────────

function ImportForm({
  projectId,
  onDone,
}: {
  projectId: string;
  onDone: (message: string, id?: string) => void;
}) {
  const [pending, act] = useTransition();
  return (
    <form
      data-form="import-review"
      className={`${panel} flex flex-wrap items-end gap-3 px-4 py-3`}
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        act(async () => {
          const r = await importReviewWorkbook(projectId, form);
          if (r.ok)
            onDone(
              [r.message, ...(r.notes ?? [])].filter(Boolean).join("\n"),
              r.id,
            );
          else onDone(r.reason);
        });
      }}
    >
      <label className="min-w-[20rem] flex-1">
        <span className="t-xs text-[var(--n-600)]">
          Review workbook (.xlsx)
        </span>
        <input
          name="file"
          type="file"
          accept=".xlsx"
          required
          className="t-sm block w-full"
        />
      </label>
      <button
        type="submit"
        data-action="import-review"
        disabled={pending}
        className={button}
      >
        <FileUp aria-hidden size={13} /> {pending ? "Reading…" : "Import"}
      </button>
      <p className="t-xs w-full text-[var(--n-500)]">
        Sheets are matched by their headings; totals are recalculated from the rows.
      </p>
    </form>
  );
}

function StartForm({
  projectId,
  onDone,
}: {
  projectId: string;
  onDone: (message: string, id?: string) => void;
}) {
  const [pending, act] = useTransition();
  const [form, setForm] = useState({ title: "", subject: "", options: "" });
  return (
    <form
      data-form="start-review"
      className={`${panel} flex flex-wrap items-end gap-3 px-4 py-3`}
      onSubmit={(e) => {
        e.preventDefault();
        act(async () => {
          const r = await startReview(projectId, form);
          onDone(
            r.ok ? "The review is started." : r.reason,
            r.ok ? r.id : undefined,
          );
        });
      }}
    >
      <label className="min-w-[16rem] flex-1">
        <span className="t-xs text-[var(--n-600)]">Title</span>
        <input
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="Boundary wall – QS BOQ vs design"
          className={field}
        />
      </label>
      <label className="min-w-[16rem] flex-1">
        <span className="t-xs text-[var(--n-600)]">What is being reviewed</span>
        <input
          value={form.subject}
          onChange={(e) => setForm({ ...form, subject: e.target.value })}
          placeholder="Draft bills from the QS, Sep 2026"
          className={field}
        />
      </label>
      <label className="min-w-[16rem] flex-1">
        <span className="t-xs text-[var(--n-600)]">
          Options, comma-separated
        </span>
        <input
          value={form.options}
          onChange={(e) => setForm({ ...form, options: e.target.value })}
          placeholder="Option A, Option B, Max Brick"
          className={field}
        />
      </label>
      <button type="submit" disabled={pending} className={button}>
        <Plus aria-hidden size={13} /> Start
      </button>
    </form>
  );
}

// ── Summary and findings ──────────────────────────────────────────────────────────────────

function Summary({
  review,
  computed,
  onStatus,
}: {
  review: LoadedReview;
  computed: Computed;
  onStatus: () => void;
}) {
  const base = review.baseOption;
  const unit = review.assumptions.mainUnit ?? "unit";
  return (
    <section
      data-region="review-summary"
      className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]"
    >
      <div className={`${panel} px-4 py-3`}>
        <p className="t-xs tracking-[0.06em] text-[var(--n-500)] uppercase">
          Items mapped
        </p>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {computed.counts.counts.map((c) => (
            <li key={c.status}>
              <button
                type="button"
                onClick={onStatus}
                title={STATUS_MEANS[c.status]}
                data-status-count={c.status}
                className={`t-sm rounded-[var(--r-full)] px-2.5 py-0.5 font-medium ${TONE[c.status]}`}
              >
                {c.status} <span className="num">{c.count}</span>
              </button>
            </li>
          ))}
          {computed.counts.unmarked > 0 && (
            <li className="t-sm rounded-[var(--r-full)] bg-[var(--n-100)] px-2.5 py-0.5 text-[var(--n-500)]">
              Unmarked {computed.counts.unmarked}
            </li>
          )}
        </ul>
        <p className="t-sm mt-3 text-[var(--n-600)]">
          <span className="num font-semibold text-[var(--n-800)]">
            {computed.counts.total}
          </span>{" "}
          items ·{" "}
          <span className="num font-semibold text-[var(--n-800)]">
            {computed.queries.open}
          </span>{" "}
          queries open
          {computed.queries.highOpen > 0 && (
            <>
              ,{" "}
              <span className="num font-semibold text-[var(--err-700)]">
                {computed.queries.highOpen} high priority
              </span>
            </>
          )}
          {computed.queries.answered + computed.queries.closed > 0 && (
            <>
              {" "}
              · {computed.queries.answered + computed.queries.closed} answered
            </>
          )}
        </p>
        {review.recommendation && (
          <p className="t-sm mt-2 border-t border-[var(--n-100)] pt-2 text-[var(--n-600)]">
            {review.recommendation}
          </p>
        )}
      </div>

      <div className={`${panel} overflow-x-auto`}>
        <table data-region="review-totals" className="w-full border-collapse">
          <thead className="bg-[var(--n-50)]">
            <tr>
              <th className={th}>Estimate, excl. VAT</th>
              {computed.estimates.map((e) => (
                <th key={e.option.key} className={`${th} text-right`}>
                  {e.option.label}
                  {e.option.key === base && (
                    <span className="ml-1 normal-case text-[var(--a-700)]">
                      · base
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <TotalRow
              label="Total excl. VAT"
              values={computed.estimates.map((e) => rands(e.totalExVat))}
              bold
            />
            <TotalRow
              label={`Per ${displayUnit(unit)}`}
              values={computed.estimates.map((e) =>
                e.perMainUnit === null ? "–" : rands(e.perMainUnit),
              )}
            />
            <TotalRow
              label="Range"
              values={computed.estimates.map(
                (e) => `${rands(e.rangeLow)} to ${rands(e.rangeHigh)}`,
              )}
              small
            />
            {review.assumptions.comparisonAmount && (
              <TotalRow
                label={`Against ${review.assumptions.comparisonLabel ?? "the comparison figure"}`}
                values={computed.estimates.map((e) =>
                  e.againstComparison === null
                    ? "–"
                    : `${e.againstComparison > 0n ? "+" : ""}${rands(e.againstComparison)}`,
                )}
              />
            )}
          </tbody>
        </table>
        <p className="t-xs border-t border-[var(--n-100)] px-3 py-2 text-[var(--n-500)]">
          A pre-tender budget at estimated rates, not a substitute for priced
          tenders. Contingency {pct(review.assumptions.contingency)} on the
          adjusted total.
        </p>
      </div>
    </section>
  );
}

function TotalRow({
  label,
  values,
  bold,
  small,
}: {
  label: string;
  values: string[];
  bold?: boolean;
  small?: boolean;
}) {
  return (
    <tr className="border-t border-[var(--n-100)]">
      <td
        className={`${td} ${bold ? "font-semibold text-[var(--n-800)]" : ""}`}
      >
        {label}
      </td>
      {values.map((v, i) => (
        <td
          key={i}
          className={`${td} num text-right ${bold ? "font-semibold text-[var(--n-800)]" : ""} ${small ? "t-xs" : ""}`}
        >
          {v}
        </td>
      ))}
    </tr>
  );
}

function Findings({ findings }: { findings: ReviewFinding[] }) {
  return (
    <section
      data-region="review-findings"
      className="overflow-hidden rounded-[var(--r-lg)] border border-[var(--warn-500)] bg-[var(--warn-50)]"
    >
      <div className="flex items-center gap-2 border-b border-[var(--warn-500)] px-4 py-2">
        <AlertTriangle
          aria-hidden
          size={14}
          strokeWidth={2}
          className="text-[var(--warn-700)]"
        />
        <h2 className="t-base font-semibold text-[var(--n-800)]">
          Before this review is issued
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
            data-severity={f.severity}
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

// ── Item mapping ──────────────────────────────────────────────────────────────────────────

function Items({
  projectId,
  review,
  onOutcome,
}: {
  projectId: string;
  review: LoadedReview;
  onOutcome: (m: string) => void;
}) {
  const [filter, setFilter] = useState<ItemStatus | "action" | "all">("all");
  const [open, setOpen] = useState<string | null>(null);
  const shown = useMemo(
    () =>
      review.items.filter((i) =>
        filter === "all"
          ? true
          : filter === "action"
            ? i.status !== null &&
              ["Discrepancy", "Error", "Gap", "Query"].includes(i.status)
            : i.status === filter,
      ),
    [review.items, filter],
  );

  return (
    <section data-region="review-items" className={panel}>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--n-200)] bg-[var(--n-50)] px-4 py-2.5">
        <span className="t-sm text-[var(--n-600)]">Show</span>
        {(["all", "action", ...ITEM_STATUSES] as const).map((f) => (
          <button
            key={f}
            type="button"
            data-filter={f}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={`t-xs rounded-[var(--r-full)] border px-2 py-0.5 ${filter === f ? "border-[var(--a-500)] bg-[var(--a-50)] text-[var(--a-700)]" : "border-[var(--n-200)] text-[var(--n-600)]"}`}
          >
            {f === "all" ? "All" : f === "action" ? "Needs action" : f}
          </button>
        ))}
        <span className="t-xs num ml-auto text-[var(--n-500)]">
          {shown.length} of {review.items.length}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] border-collapse">
          <thead className="bg-[var(--n-25)]">
            <tr>
              <th className={th}>Ref</th>
              <th className={th}>Description</th>
              <th className={th}>Unit</th>
              {review.options.map((o) => (
                <th key={o.key} className={`${th} text-right`}>
                  {o.label}
                </th>
              ))}
              <th className={th}>Design source</th>
              <th className={th}>Status</th>
              <th className={th}>Finding · action</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((item, i) => {
              const newBill = i === 0 || shown[i - 1].bill !== item.bill;
              return (
                <ItemRows
                  key={item.id}
                  projectId={projectId}
                  reviewId={review.id}
                  item={item}
                  options={review.options}
                  billHeading={newBill ? item.bill : null}
                  open={open === item.id}
                  onToggle={() => setOpen(open === item.id ? null : item.id!)}
                  onOutcome={onOutcome}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ItemRows({
  projectId,
  reviewId,
  item,
  options,
  billHeading,
  open,
  onToggle,
  onOutcome,
}: {
  projectId: string;
  reviewId: string;
  item: ReviewItem;
  options: LoadedReview["options"];
  billHeading: string | null;
  open: boolean;
  onToggle: () => void;
  onOutcome: (m: string) => void;
}) {
  const router = useRouter();
  const [pending, act] = useTransition();
  const [form, setForm] = useState({
    status: item.status ?? "",
    finding: item.finding ?? "",
    action: item.action ?? "",
  });
  const colSpan = 6 + options.length;

  return (
    <>
      {billHeading && (
        <tr className="bg-[var(--n-50)]">
          <td
            colSpan={colSpan}
            className="t-xs px-2 py-1.5 font-semibold tracking-[0.04em] text-[var(--n-700)] uppercase"
          >
            {billHeading}
          </td>
        </tr>
      )}
      <tr
        data-review-item={item.ref}
        data-status={item.status ?? ""}
        onClick={onToggle}
        className="cursor-pointer border-t border-[var(--n-100)] hover:bg-[var(--n-25)]"
      >
        <td className={`${td} num font-medium text-[var(--n-800)]`}>
          {item.ref}
        </td>
        <td className={`${td} max-w-[28rem]`}>{item.description}</td>
        <td className={td}>{item.unit ? displayUnit(item.unit) : ""}</td>
        {options.map((o) => (
          <td
            key={o.key}
            className={`${td} num text-right ${item.quantities[o.key] === null ? "text-[var(--n-400)]" : ""}`}
          >
            {qty(item.quantities[o.key])}
          </td>
        ))}
        <td className={`${td} max-w-[12rem] text-[var(--n-600)]`}>
          {item.designSource ?? ""}
        </td>
        <td className={td}>
          {item.status ? (
            <span
              className={`t-xs rounded-[var(--r-full)] px-2 py-0.5 font-medium whitespace-nowrap ${TONE[item.status]}`}
            >
              {item.status}
            </span>
          ) : (
            <span className="t-xs text-[var(--n-400)]">unmarked</span>
          )}
        </td>
        <td className={`${td} max-w-[26rem] text-[var(--n-600)]`}>
          {item.finding && <span>{item.finding}</span>}
          {item.action && (
            <span className="block text-[var(--n-800)]">{item.action}</span>
          )}
        </td>
      </tr>
      {open && (
        <tr className="bg-[var(--n-25)]">
          <td colSpan={colSpan} className="px-3 py-3">
            {item.requirement && (
              <p className="t-sm mb-2 text-[var(--n-600)]">
                <span className="font-medium text-[var(--n-700)]">
                  Design requirement:
                </span>{" "}
                {item.requirement}
              </p>
            )}
            <form
              data-form="mark-item"
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                act(async () => {
                  const r = await markItem(projectId, reviewId, item.id!, form);
                  onOutcome(r.ok ? (r.message ?? "Saved.") : r.reason);
                  router.refresh();
                });
              }}
            >
              <label className="w-40">
                <span className="t-xs text-[var(--n-600)]">Status</span>
                <select
                  name="status"
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className={field}
                >
                  <option value="">Unmarked</option>
                  {ITEM_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="min-w-[18rem] flex-1">
                <span className="t-xs text-[var(--n-600)]">Finding</span>
                <textarea
                  name="finding"
                  rows={2}
                  value={form.finding}
                  onChange={(e) =>
                    setForm({ ...form, finding: e.target.value })
                  }
                  className={area}
                />
              </label>
              <label className="min-w-[18rem] flex-1">
                <span className="t-xs text-[var(--n-600)]">
                  Recommended action
                </span>
                <textarea
                  name="action"
                  rows={2}
                  value={form.action}
                  onChange={(e) => setForm({ ...form, action: e.target.value })}
                  className={area}
                />
              </label>
              <button
                type="submit"
                data-action="save-item"
                disabled={pending}
                className={button}
              >
                <Save aria-hidden size={13} /> Save
              </button>
            </form>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Queries ───────────────────────────────────────────────────────────────────────────────

function Queries({
  projectId,
  review,
  onOutcome,
}: {
  projectId: string;
  review: LoadedReview;
  onOutcome: (m: string) => void;
}) {
  const [show, setShow] = useState<"open" | "all">("open");
  const [adding, setAdding] = useState(false);
  const shown = review.queries.filter(
    (q) => show === "all" || q.status === "Open",
  );
  return (
    <section data-region="review-queries" className={panel}>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--n-200)] bg-[var(--n-50)] px-4 py-2.5">
        <h2 className="t-base font-semibold text-[var(--n-800)]">
          Queries tracker
        </h2>
        {(["open", "all"] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={show === s}
            onClick={() => setShow(s)}
            className={`t-xs rounded-[var(--r-full)] border px-2 py-0.5 ${show === s ? "border-[var(--a-500)] bg-[var(--a-50)] text-[var(--a-700)]" : "border-[var(--n-200)] text-[var(--n-600)]"}`}
          >
            {s === "open" ? "Open" : "All"}
          </button>
        ))}
        <button
          type="button"
          data-action="add-query"
          onClick={() => setAdding((v) => !v)}
          className={`${button} ml-auto`}
        >
          <Plus aria-hidden size={13} /> Raise a query
        </button>
      </div>
      {adding && (
        <AddQuery
          projectId={projectId}
          reviewId={review.id}
          onDone={(m) => (onOutcome(m), setAdding(false))}
        />
      )}
      {shown.length === 0 ? (
        <p className="t-sm px-4 py-6 text-[var(--n-600)]">
          {show === "open" ? "No query is open." : "No queries yet."}
        </p>
      ) : (
        <ul>
          {shown.map((q) => (
            <QueryRow
              key={q.id}
              projectId={projectId}
              reviewId={review.id}
              query={q}
              onOutcome={onOutcome}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function QueryRow({
  projectId,
  reviewId,
  query,
  onOutcome,
}: {
  projectId: string;
  reviewId: string;
  query: ReviewQuery;
  onOutcome: (m: string) => void;
}) {
  const router = useRouter();
  const [pending, act] = useTransition();
  const [response, setResponse] = useState(query.response ?? "");
  const [status, setStatus] = useState<string>(query.status);
  return (
    <li
      data-query={query.number}
      data-status={query.status}
      className="border-b border-[var(--n-100)] px-4 py-3 last:border-b-0"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="t-sm num font-semibold text-[var(--n-700)]">
          Q{query.number}
        </span>
        {query.topic && (
          <span className="t-sm font-medium text-[var(--n-800)]">
            {query.topic}
          </span>
        )}
        {query.priority && (
          <span
            className={`t-xs rounded-[var(--r-full)] px-2 py-0.5 ${query.priority === "High" ? "bg-[var(--err-50)] text-[var(--err-700)]" : query.priority === "Medium" ? "bg-[var(--warn-50)] text-[var(--warn-700)]" : "bg-[var(--n-100)] text-[var(--n-600)]"}`}
          >
            {query.priority}
          </span>
        )}
        <span className="t-xs text-[var(--n-500)]">
          {[
            query.raisedTo && `to ${query.raisedTo}`,
            query.affects,
            query.sourceRef,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <span className="t-xs ml-auto font-medium text-[var(--n-700)]">
          {query.status}
        </span>
      </div>
      <p className="t-sm mt-1 text-[var(--n-700)]">{query.query}</p>
      <form
        data-form="respond-query"
        className="mt-2 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          act(async () => {
            const r = await respondToQuery(projectId, reviewId, query.id!, {
              response,
              status,
            });
            onOutcome(r.ok ? (r.message ?? "Saved.") : r.reason);
            router.refresh();
          });
        }}
      >
        <label className="min-w-[20rem] flex-1">
          <span className="sr-only">Response to Q{query.number}</span>
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
            aria-label={`Status of Q${query.number}`}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className={field}
          >
            {QUERY_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          data-action="save-query"
          disabled={pending}
          className={button}
        >
          <Save aria-hidden size={13} /> Save
        </button>
      </form>
    </li>
  );
}

function AddQuery({
  projectId,
  reviewId,
  onDone,
}: {
  projectId: string;
  reviewId: string;
  onDone: (m: string) => void;
}) {
  const router = useRouter();
  const [pending, act] = useTransition();
  const [form, setForm] = useState({
    topic: "",
    query: "",
    raisedTo: "",
    affects: "",
    priority: "Medium",
    sourceRef: "",
  });
  return (
    <form
      data-form="add-query"
      className="flex flex-col gap-2 border-b border-[var(--n-100)] bg-[var(--n-25)] px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        act(async () => {
          const r = await addQuery(projectId, reviewId, form);
          onDone(r.ok ? (r.message ?? "Raised.") : r.reason);
          router.refresh();
        });
      }}
    >
      <div className="flex flex-wrap gap-2">
        <label className="w-44">
          <span className="t-xs text-[var(--n-600)]">Topic</span>
          <input
            value={form.topic}
            onChange={(e) => setForm({ ...form, topic: e.target.value })}
            className={field}
          />
        </label>
        <label className="w-44">
          <span className="t-xs text-[var(--n-600)]">Raised to</span>
          <input
            value={form.raisedTo}
            onChange={(e) => setForm({ ...form, raisedTo: e.target.value })}
            placeholder="Engineer"
            className={field}
          />
        </label>
        <label className="w-36">
          <span className="t-xs text-[var(--n-600)]">Affects</span>
          <input
            value={form.affects}
            onChange={(e) => setForm({ ...form, affects: e.target.value })}
            placeholder="All options"
            className={field}
          />
        </label>
        <label className="w-28">
          <span className="t-xs text-[var(--n-600)]">Priority</span>
          <select
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}
            className={field}
          >
            {QUERY_PRIORITIES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className="w-44">
          <span className="t-xs text-[var(--n-600)]">Source reference</span>
          <input
            value={form.sourceRef}
            onChange={(e) => setForm({ ...form, sourceRef: e.target.value })}
            placeholder="E1 7.1"
            className={field}
          />
        </label>
      </div>
      <label>
        <span className="t-xs text-[var(--n-600)]">Query</span>
        <textarea
          name="query"
          rows={2}
          value={form.query}
          onChange={(e) => setForm({ ...form, query: e.target.value })}
          className={area}
        />
      </label>
      <div>
        <button
          type="submit"
          data-action="save-new-query"
          disabled={pending}
          className={button}
        >
          <Plus aria-hidden size={13} /> Raise it
        </button>
      </div>
    </form>
  );
}

// ── Estimate ──────────────────────────────────────────────────────────────────────────────

function Estimate({
  projectId,
  review,
  estimates,
  onOutcome,
}: {
  projectId: string;
  review: LoadedReview;
  estimates: OptionEstimate[];
  onOutcome: (m: string) => void;
}) {
  const router = useRouter();
  const [pending, act] = useTransition();
  const a = review.assumptions;
  const [form, setForm] = useState({
    mainQuantity: a.mainQuantity ? String(Number(a.mainQuantity)) : "",
    mainUnit: a.mainUnit ?? "",
    contingency: String(Number(a.contingency) * 100),
    vat: String(Number(a.vat) * 100),
    profitAndAttendance: String(Number(a.profitAndAttendance) * 100),
    rangeLow: String(Number(a.rangeLow) * 100),
    rangeHigh: String(Number(a.rangeHigh) * 100),
    contractWeeks: a.contractWeeks === null ? "" : String(a.contractWeeks),
    comparisonAmount: a.comparisonAmount ?? "",
    comparisonLabel: a.comparisonLabel ?? "",
    baseOption: review.baseOption ?? "",
  });
  const input = (key: keyof typeof form, label: string, width = "w-28") => (
    <label className={width}>
      <span className="t-xs text-[var(--n-600)]">{label}</span>
      <input
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className={`${field} bg-[var(--warn-50)]`}
      />
    </label>
  );
  const bills = [
    ...new Set(estimates.flatMap((e) => e.bills.map((b) => b.bill))),
  ];
  const line = (
    label: string,
    pick: (e: OptionEstimate) => bigint | null,
    bold = false,
  ) => (
    <tr key={label} className="border-t border-[var(--n-100)]">
      <td
        className={`${td} ${bold ? "font-semibold text-[var(--n-800)]" : ""}`}
      >
        {label}
      </td>
      {estimates.map((e) => {
        const v = pick(e);
        return (
          <td
            key={e.option.key}
            className={`${td} num text-right ${bold ? "font-semibold text-[var(--n-800)]" : ""}`}
          >
            {v === null ? "–" : rands(v)}
          </td>
        );
      })}
    </tr>
  );

  return (
    <div className="flex flex-col gap-4">
      <form
        data-form="review-assumptions"
        className={`${panel} flex flex-wrap items-end gap-2 px-4 py-3`}
        onSubmit={(e) => {
          e.preventDefault();
          act(async () => {
            const r = await setAssumptions(projectId, review.id, form);
            onOutcome(r.ok ? (r.message ?? "Saved.") : r.reason);
            router.refresh();
          });
        }}
      >
        <p className="t-xs w-full tracking-[0.06em] text-[var(--n-500)] uppercase">
          Key assumptions
        </p>
        {input("mainQuantity", "Main quantity")}
        {input("mainUnit", "Per", "w-16")}
        {input("contingency", "Contingency %", "w-24")}
        {input("vat", "VAT %", "w-20")}
        {input("profitAndAttendance", "P&A on prov. sums %", "w-32")}
        {input("rangeLow", "Range low %", "w-24")}
        {input("rangeHigh", "Range high %", "w-24")}
        {input("contractWeeks", "Contract weeks", "w-24")}
        {input("comparisonAmount", "Compare against (R)", "w-36")}
        {input("comparisonLabel", "Which is", "w-48")}
        <label className="w-36">
          <span className="t-xs text-[var(--n-600)]">Base option</span>
          <select
            value={form.baseOption}
            onChange={(e) => setForm({ ...form, baseOption: e.target.value })}
            className={field}
          >
            {review.options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          data-action="save-assumptions"
          disabled={pending}
          className={button}
        >
          <Save aria-hidden size={13} /> Save
        </button>
      </form>

      <section
        data-region="review-estimate-summary"
        className={`${panel} overflow-x-auto`}
      >
        <table className="w-full border-collapse">
          <thead className="bg-[var(--n-50)]">
            <tr>
              <th className={th}>Summary, R excl. VAT</th>
              {estimates.map((e) => (
                <th key={e.option.key} className={`${th} text-right`}>
                  {e.option.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bills.map((bill) =>
              line(
                bill,
                (e) => e.bills.find((b) => b.bill === bill)?.amount ?? 0n,
              ),
            )}
            {line("Total as billed", (e) => e.billed, true)}
            {line("Recommended adjustments", (e) => e.adjustments)}
            {line("Contingency", (e) => e.contingency)}
            {line("Total excl. VAT", (e) => e.totalExVat, true)}
            {line("VAT", (e) => e.vat)}
            {line("Total incl. VAT", (e) => e.totalIncVat, true)}
            {line(
              `Per ${displayUnit(a.mainUnit ?? "unit")}, excl. VAT`,
              (e) => e.perMainUnit,
            )}
            <tr className="border-t border-[var(--n-100)]">
              <td className={td}>Preliminaries on measured work</td>
              {estimates.map((e) => (
                <td key={e.option.key} className={`${td} num text-right`}>
                  {e.preliminariesShare === null
                    ? "–"
                    : `${(e.preliminariesShare * 100).toFixed(1)}%`}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </section>

      <section data-region="review-rates" className={panel}>
        <div className="border-b border-[var(--n-200)] bg-[var(--n-50)] px-4 py-2.5">
          <h2 className="t-base font-semibold text-[var(--n-800)]">Rates</h2>
          <p className="t-xs text-[var(--n-500)]">
            All-in supply and fix, excl. VAT. A rate saves when the field is
            left; blank leaves the item unpriced, and the total says so.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] border-collapse">
            <thead className="bg-[var(--n-25)]">
              <tr>
                <th className={th}>Ref</th>
                <th className={th}>Description</th>
                <th className={th}>Unit</th>
                {review.options.map((o) => (
                  <th key={o.key} className={`${th} text-right`}>
                    Rate {o.label}
                  </th>
                ))}
                <th className={th}>Rate basis</th>
              </tr>
            </thead>
            <tbody>
              {review.items.map((item) => (
                <tr
                  key={item.id}
                  data-rate-row={item.ref}
                  className="border-t border-[var(--n-100)]"
                >
                  <td className={`${td} num font-medium`}>{item.ref}</td>
                  <td className={`${td} max-w-[26rem]`}>{item.description}</td>
                  <td className={td}>
                    {item.unit ? displayUnit(item.unit) : ""}
                  </td>
                  {review.options.map((o) => (
                    <td key={o.key} className={`${td} w-32`}>
                      {item.quantities[o.key] === null ? (
                        <span className="t-xs text-[var(--n-400)]">n/a</span>
                      ) : (
                        <RateCell
                          projectId={projectId}
                          reviewId={review.id}
                          itemId={item.id!}
                          optionKey={o.key}
                          label={`${item.ref} ${o.label}`}
                          value={item.rates[o.key]}
                          onOutcome={onOutcome}
                        />
                      )}
                    </td>
                  ))}
                  <td
                    className={`${td} t-xs max-w-[18rem] text-[var(--n-500)]`}
                  >
                    {item.rateBasis ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {review.adjustments.length > 0 && (
        <section
          data-region="review-adjustments"
          className={`${panel} overflow-x-auto`}
        >
          <div className="border-b border-[var(--n-200)] bg-[var(--n-50)] px-4 py-2.5">
            <h2 className="t-base font-semibold text-[var(--n-800)]">
              Recommended adjustments
            </h2>
            <p className="t-xs text-[var(--n-500)]">
              What the design needs that the bills do not carry, each tied to
              the query behind it.
            </p>
          </div>
          <table className="w-full border-collapse">
            <tbody>
              {review.adjustments.map((adj) => (
                <tr key={adj.id} className="border-t border-[var(--n-100)]">
                  <td className={`${td} num font-medium`}>{adj.ref}</td>
                  <td className={`${td} num text-[var(--n-500)]`}>
                    {adj.queryNumber ? `Q${adj.queryNumber}` : ""}
                  </td>
                  <td className={`${td} max-w-[30rem]`}>{adj.description}</td>
                  {review.options.map((o) => (
                    <td key={o.key} className={`${td} num text-right`}>
                      {qty(adj.quantities[o.key])}{" "}
                      {adj.unit ? displayUnit(adj.unit) : ""} @{" "}
                      {adj.rates[o.key] ? `R ${adj.rates[o.key]}` : "–"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function RateCell({
  projectId,
  reviewId,
  itemId,
  optionKey,
  label,
  value,
  onOutcome,
}: {
  projectId: string;
  reviewId: string;
  itemId: string;
  optionKey: string;
  label: string;
  value: string | null;
  onOutcome: (m: string) => void;
}) {
  const router = useRouter();
  const [pending, act] = useTransition();
  const [text, setText] = useState(value ?? "");
  const missing = !value;
  return (
    <input
      aria-label={`Rate, ${label}`}
      value={text}
      disabled={pending}
      inputMode="decimal"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text.trim() === (value ?? "")) return;
        act(async () => {
          const r = await setItemRate(
            projectId,
            reviewId,
            itemId,
            optionKey,
            text,
          );
          onOutcome(r.ok ? (r.message ?? "Saved.") : r.reason);
          if (!r.ok) setText(value ?? "");
          router.refresh();
        });
      }}
      className={`${field} num text-right ${missing ? "border-[var(--warn-500)]" : "text-[var(--a-700)]"}`}
    />
  );
}

// ── The read-only sheets ──────────────────────────────────────────────────────────────────

function Comparison({
  review,
  rows,
}: {
  review: LoadedReview;
  rows: ComparisonRow[];
}) {
  const base =
    review.options.find((o) => o.key === review.baseOption) ??
    review.options[0];
  const others = review.options.filter((o) => o.key !== base?.key);
  return (
    <section
      data-region="review-comparison"
      className={`${panel} overflow-x-auto`}
    >
      <p className="t-sm border-b border-[var(--n-100)] px-4 py-2.5 text-[var(--n-600)]">
        Items whose quantities differ between options, against{" "}
        {base?.label ?? "the base"}. Everything else is measured the same in
        every option.
      </p>
      {rows.length === 0 ? (
        <p className="t-sm px-4 py-6 text-[var(--n-600)]">
          Every item is measured the same in every option.
        </p>
      ) : (
        <table className="w-full min-w-[900px] border-collapse">
          <thead className="bg-[var(--n-25)]">
            <tr>
              <th className={th}>Ref</th>
              <th className={th}>Item</th>
              {review.options.map((o) => (
                <th key={o.key} className={`${th} text-right`}>
                  {o.label}
                </th>
              ))}
              {others.map((o) => (
                <th key={o.key} className={`${th} text-right`}>
                  {o.label} vs {base?.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ref} className="border-t border-[var(--n-100)]">
                <td className={`${td} num font-medium`}>{r.ref}</td>
                <td className={`${td} max-w-[28rem]`}>
                  {r.description}{" "}
                  <span className="text-[var(--n-400)]">
                    {r.unit ? displayUnit(r.unit) : ""}
                  </span>
                </td>
                {review.options.map((o) => (
                  <td key={o.key} className={`${td} num text-right`}>
                    {qty(r.quantities[o.key])}
                  </td>
                ))}
                {others.map((o) => {
                  const c = r.against[o.key];
                  return (
                    <td
                      key={o.key}
                      className={`${td} num text-right ${c?.difference?.startsWith("-") ? "text-[var(--ok-700)]" : c?.difference && c.difference !== "0" ? "text-[var(--err-700)]" : ""}`}
                    >
                      {c?.difference === null || c === undefined
                        ? "–"
                        : `${signed(c.difference)}${c.fraction === null ? "" : ` (${(c.fraction * 100).toFixed(1)}%)`}`}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Parameters({ review }: { review: LoadedReview }) {
  if (review.parameters.length === 0)
    return (
      <p className={`${panel} t-sm px-4 py-6 text-[var(--n-600)]`}>
        No design parameters on this review.
      </p>
    );
  return (
    <section
      data-region="review-parameters"
      className={`${panel} overflow-x-auto`}
    >
      <table className="w-full min-w-[1200px] border-collapse">
        <thead className="bg-[var(--n-25)]">
          <tr>
            <th className={th}>Parameter</th>
            {review.parameterColumns.map((c) => (
              <th key={c} className={th}>
                {c}
              </th>
            ))}
            <th className={th}>Status</th>
            <th className={th}>Consequence</th>
          </tr>
        </thead>
        <tbody>
          {review.parameters.map((p) => (
            <tr key={p.id} className="border-t border-[var(--n-100)]">
              <td className={`${td} font-medium text-[var(--n-800)]`}>
                {p.parameter}
              </td>
              {review.parameterColumns.map((c) => (
                <td key={c} className={`${td} t-xs max-w-[14rem]`}>
                  {p.values[c] && p.values[c] !== "-" ? (
                    p.values[c]
                  ) : (
                    <span className="text-[var(--n-400)]">–</span>
                  )}
                </td>
              ))}
              <td className={td}>
                {p.status && (
                  <span
                    className={`t-xs rounded-[var(--r-full)] px-2 py-0.5 font-medium ${TONE[p.status as ItemStatus] ?? "bg-[var(--n-100)]"}`}
                  >
                    {p.status}
                  </span>
                )}
              </td>
              <td className={`${td} t-xs max-w-[22rem]`}>{p.consequence}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Sources({ review }: { review: LoadedReview }) {
  if (review.sources.length === 0)
    return (
      <p className={`${panel} t-sm px-4 py-6 text-[var(--n-600)]`}>
        No sources registered on this review.
      </p>
    );
  return (
    <section
      data-region="review-sources"
      className={`${panel} overflow-x-auto`}
    >
      <table className="w-full min-w-[1000px] border-collapse">
        <thead className="bg-[var(--n-25)]">
          <tr>
            <th className={th}>Ref</th>
            <th className={th}>Discipline</th>
            <th className={th}>Document</th>
            <th className={th}>Date</th>
            <th className={th}>Status / revision</th>
            <th className={th}>Relevance</th>
          </tr>
        </thead>
        <tbody>
          {review.sources.map((s) => {
            const superseded = /supersed/i.test(s.status ?? "");
            return (
              <tr
                key={s.id}
                data-source={s.ref}
                className={`border-t border-[var(--n-100)] ${superseded ? "bg-[var(--warn-50)]" : ""}`}
              >
                <td className={`${td} num font-semibold text-[var(--n-800)]`}>
                  {s.ref}
                </td>
                <td className={td}>{s.discipline}</td>
                <td className={`${td} max-w-[24rem]`}>{s.document}</td>
                <td className={`${td} whitespace-nowrap`}>{s.dated}</td>
                <td
                  className={`${td} ${superseded ? "font-medium text-[var(--warn-700)]" : ""}`}
                >
                  {s.status}
                </td>
                <td className={`${td} t-xs max-w-[26rem] text-[var(--n-600)]`}>
                  {s.notes}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
