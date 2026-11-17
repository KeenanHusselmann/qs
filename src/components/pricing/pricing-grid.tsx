/**
 * The pricing overview — PLATFORM.md §4.8, §7.1, §7.2, §7.4.
 *
 * §4.8, entire: *"the whole bill with priced / unpriced (amber) / overridden state and a persistent
 * unpriced count. Bulk actions: apply a rate set, apply % markup across a selection."*
 *
 * ── What decides whether this screen is usable ─────────────────────────────────────────────
 *
 * That a QS can price a bill without touching every row. Three things do that, and they are here:
 *
 *   · **a filter down to what is unpriced**, because that is the list being worked through
 *   · **a selection, and one act across all of it** — §4.8's own sentence is "nobody prices 4,000
 *     items one at a time", and a selection model is what makes the count on the tally actionable
 *   · **a build-up behind a row**, so a rate is a derivation somebody can argue with rather than a
 *     number that appeared
 *
 * ── Not built, and not pretended ──────────────────────────────────────────────────────────
 *
 * The same list the bill grid carries: virtualisation and 15 000 rows, undo/redo, `⌘D` fill-down,
 * columns resizable and reorderable per user. And §4.8's *other* bulk action — apply a **rate set**
 * — which is the Rate Library, which is not built; `pricing-actions.ts` records why an imitation of
 * it does not belong inside this screen.
 *
 * ── The selection is the one mechanic, on purpose ──────────────────────────────────────────
 *
 * §2.5: one path per task. There is a checkbox per row, one on each section that takes its items,
 * and one in the header that takes everything **currently shown** — so "select every unpriced row"
 * is the filter plus the header box rather than a third control that does it in one click. Three
 * ways to select the same forty rows is exactly what that rule is about.
 */

"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Calculator, ChevronDown, ChevronRight, X } from "lucide-react";

import { MoneyCell } from "@/components/agent/money-cell";
import { BuildUpEditor } from "@/components/pricing/build-up";
import { correctCell } from "@/app/(app)/projects/[id]/bill-actions";
import { adjustRates, applyRate } from "@/app/(app)/projects/[id]/pricing-actions";
import { itemReferences, workingRow, type BillRow } from "@/lib/agent/bill";
import {
  PRICE_STATE_LABEL,
  RATE_SOURCE_LABEL,
  computeBuildUp,
  formatWireRate,
  priceState,
  pricingTally,
  type BuildUp,
  type PriceState,
} from "@/lib/pricing";
import { formatQuantity, parseQuantity } from "@/domain/money";

/**
 * §7.2's semantic roles, and §7.1 #5 — colour means exactly one thing, and never alone.
 *
 * Amber is "attention / unpriced / due soon" in that table and is used here for exactly that. The
 * word is always beside it, which is what makes the state legible to a reader who cannot separate
 * the two colours.
 */
const STATE_TONE: Readonly<Record<PriceState, string>> = {
  priced: "bg-[var(--ok-50)] text-[var(--ok-700)]",
  overridden: "bg-[var(--a-50)] text-[var(--a-700)]",
  unpriced: "bg-[var(--warn-50)] text-[var(--warn-700)]",
};

export function PricingGrid({
  projectId,
  runId,
  rows,
  buildUps,
  frozen,
}: {
  projectId: string;
  runId: string;
  rows: readonly BillRow[];
  /** Keyed by the row each one belongs to. Serialised from a Map, which does not cross the wire. */
  buildUps: Record<string, BuildUp>;
  /** A signed bill has nothing to price: the cells become text and every control goes. */
  frozen: boolean;
}) {
  const router = useRouter();

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [unpricedOnly, setUnpricedOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ said: string; skipped: string[] } | null>(null);
  const [busy, act] = useTransition();

  const refs = useMemo(() => itemReferences(rows), [rows]);
  const tally = useMemo(() => pricingTally(rows), [rows]);

  /**
   * The rows on screen, in reading order, with a heading kept only while it still has items under
   * it. A section whose every row is priced disappears with them under the filter — an empty
   * heading is a promise of rows that are not there.
   */
  const shown = useMemo(() => {
    const keep = (row: BillRow) =>
      row.rowType === "item" && !row.omitted && (!unpricedOnly || priceState(row) === "unpriced");

    const items = rows.filter(keep);
    const sections = new Set(items.map((row) => row.parentId));

    return rows.filter((row) =>
      row.rowType === "heading" ? sections.has(row.id) : keep(row),
    );
  }, [rows, unpricedOnly]);

  const shownItems = useMemo(() => shown.filter((row) => row.rowType === "item"), [shown]);
  const allShownSelected =
    shownItems.length > 0 && shownItems.every((row) => selected.has(row.id));

  const toggle = (ids: readonly string[], on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  /** Only the rows still on screen can be acted on — a hidden selection is one nobody can see. */
  const active = shownItems.filter((row) => selected.has(row.id)).map((row) => row.id);

  const bulk = (run: () => Promise<{ ok: boolean } & Record<string, unknown>>) =>
    act(async () => {
      const outcome = (await run()) as
        | { ok: true; written: number; skipped: { description: string; reason: string }[] }
        | { ok: false; reason: string };

      if (!outcome.ok) {
        setRefusal(outcome.reason);
        setNotice(null);
        return;
      }

      setRefusal(null);
      setNotice({
        said: `${outcome.written} ${outcome.written === 1 ? "rate" : "rates"} written.`,
        skipped: outcome.skipped.map((row) => `${row.description} — ${row.reason}`),
      });
      setSelected(new Set());
      router.refresh();
    });

  const saveRate = (itemId: string, value: string) =>
    act(async () => {
      const outcome = await correctCell(projectId, runId, itemId, "rate", value);
      setRefusal(outcome.ok ? null : outcome.reason);
      if (outcome.ok) router.refresh();
    });

  return (
    <div data-region="pricing-grid">
      {!frozen && (
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--n-100)] px-4 py-2">
          {/*
            The filter, not a second selection control. "Every unpriced row" is this plus the header
            checkbox — §2.5, and it also leaves the count on the tally meaning one thing.
          */}
          <div className="flex items-center gap-1" role="group" aria-label="Which items to show">
            {(
              [
                ["all", `All ${tally.items}`],
                ["unpriced", `Unpriced ${tally.unpriced}`],
              ] as const
            ).map(([key, label]) => {
              const on = (key === "unpriced") === unpricedOnly;
              return (
                <button
                  key={key}
                  type="button"
                  data-filter={key}
                  aria-pressed={on}
                  onClick={() => {
                    setUnpricedOnly(key === "unpriced");
                    setSelected(new Set());
                  }}
                  className={`t-sm h-7 rounded-[var(--r-md)] border px-2 transition-colors ${
                    on
                      ? "border-[var(--a-500)] bg-[var(--a-50)] font-medium text-[var(--a-700)]"
                      : "border-[var(--n-200)] text-[var(--n-600)] hover:border-[var(--n-300)] hover:bg-[var(--n-50)]"
                  }`}
                  style={{ transitionDuration: "var(--m-fast)" }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <span className="t-sm ml-auto text-[var(--n-500)]">
            Select rows to price them together, or open a build-up to derive one rate from what it
            is made of.
          </span>
        </div>
      )}

      {!frozen && active.length > 0 && <BulkBar count={active.length} busy={busy} onApply={bulk} projectId={projectId} runId={runId} itemIds={active} onClear={() => setSelected(new Set())} />}

      {refusal && (
        <p role="alert" className="t-sm border-b border-[var(--n-100)] bg-[var(--warn-50)] px-4 py-2.5 text-[var(--warn-700)]">
          {refusal}
        </p>
      )}

      {notice && (
        <div data-region="bulk-notice" className="border-b border-[var(--n-100)] bg-[var(--a-50)]/50 px-4 py-2.5">
          <p className="t-sm text-[var(--n-700)]">{notice.said}</p>
          {/*
            §4.8 read strictly: a bulk act that quietly skipped rows would leave a QS with no way to
            tell which of four thousand moved. Ten per cent of nothing is nothing, and writing it
            would price an unpriced item at nought.
          */}
          {notice.skipped.length > 0 && (
            <ul className="mt-1 flex flex-col gap-0.5">
              {notice.skipped.slice(0, 5).map((line) => (
                <li key={line} className="t-sm text-[var(--warn-700)]">
                  {line}
                </li>
              ))}
              {notice.skipped.length > 5 && (
                <li className="t-sm text-[var(--n-500)]">
                  and {notice.skipped.length - 5} more with no rate to adjust
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full table-fixed">
          {/*
            Fixed widths for the short columns, and the description takes what is left. Percentages
            shrank with the container, so at 1024 – or 1280 with the advisor open – "Item ref",
            "Unit" and "Amount (R)" no longer fitted their own headers (checks/viewport.mjs). A
            reference, a unit and an amount are the same width on any screen; a description is not.
          */}
          <colgroup>
            <col className="w-[44px]" />
            <col className="w-[76px]" />
            <col />
            <col className="w-[64px]" />
            <col className="w-[96px]" />
            <col className="w-[112px]" />
            <col className="w-[128px]" />
            <col className="w-[132px]" />
          </colgroup>

          {/* §7.4 — 12px, 600, uppercase, 0.03em. The currency lives in the header, never in a cell. */}
          <thead>
            <tr className="border-b border-[var(--n-200)]">
              <th scope="col" className="px-3 py-2 text-left">
                {!frozen && (
                  <input
                    type="checkbox"
                    aria-label="Select every item shown"
                    data-select-all
                    checked={allShownSelected}
                    disabled={shownItems.length === 0}
                    onChange={(event) =>
                      toggle(
                        shownItems.map((row) => row.id),
                        event.target.checked,
                      )
                    }
                    className="size-3.5 accent-[var(--a-500)]"
                  />
                )}
              </th>
              {[
                ["Item ref", false],
                ["Description", false],
                ["Unit", false],
                ["Qty", true],
                ["Rate (R)", true],
                ["Amount (R)", true],
                ["Priced", false],
              ].map(([heading, numeric], i) => (
                <th
                  key={i}
                  scope="col"
                  className={`t-sm px-3 py-2 font-semibold tracking-[0.03em] text-[var(--n-500)] uppercase ${
                    numeric ? "text-right" : "text-left"
                  }`}
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {shown.map((row, index) =>
              row.rowType === "heading" ? (
                <SectionRow
                  key={row.id}
                  row={row}
                  reference={refs.get(row.id) ?? ""}
                  frozen={frozen}
                  items={shownItems.filter((item) => item.parentId === row.id)}
                  selected={selected}
                  onToggle={toggle}
                />
              ) : (
                <ItemRow
                  key={row.id}
                  row={row}
                  reference={refs.get(row.id) ?? ""}
                  index={index}
                  frozen={frozen}
                  busy={busy}
                  buildUp={buildUps[row.id] ?? null}
                  selected={selected.has(row.id)}
                  open={open === row.id}
                  projectId={projectId}
                  runId={runId}
                  onToggle={(on) => toggle([row.id], on)}
                  onOpen={() => setOpen((current) => (current === row.id ? null : row.id))}
                  onSave={saveRate}
                />
              ),
            )}
          </tbody>

          {/* §7.4 — the totals footer: 40px, tinted, strong top border. Derived, never stored. */}
          <tfoot>
            <tr className="total-row">
              <td colSpan={6} className="t-base px-3 py-3 text-right font-semibold text-[var(--n-800)]">
                Bill total — {tally.items} {tally.items === 1 ? "item" : "items"}
                {tally.unpriced > 0 && (
                  <span className="t-sm ml-2 font-normal text-[var(--warn-700)]">
                    {tally.unpriced} still unpriced, and not counted here
                  </span>
                )}
              </td>
              <td data-region="pricing-total" className="px-3 py-3 text-right">
                <MoneyCell minorUnits={tally.total.toString()} bold />
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/**
 * §4.8's bulk application — one rate, or one percentage, across the selection.
 *
 * Two inputs rather than one control with a mode: they take different figures and mean different
 * things, and a mode a reader has to notice is how a rate gets typed into a percentage box.
 */
function BulkBar({
  count,
  busy,
  projectId,
  runId,
  itemIds,
  onApply,
  onClear,
}: {
  count: number;
  busy: boolean;
  projectId: string;
  runId: string;
  itemIds: readonly string[];
  onApply: (run: () => Promise<{ ok: boolean } & Record<string, unknown>>) => void;
  onClear: () => void;
}) {
  const [rateText, setRateText] = useState("");
  const [percentText, setPercentText] = useState("");

  return (
    <div
      data-region="bulk"
      className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-[var(--n-200)] bg-[var(--a-50)] px-4 py-2"
    >
      <span className="t-sm font-medium text-[var(--a-700)]">
        {count} {count === 1 ? "item" : "items"} selected
      </span>

      <div className="flex items-center gap-1.5">
        <label htmlFor="bulk-rate" className="t-sm text-[var(--n-600)]">
          Rate
        </label>
        <input
          id="bulk-rate"
          value={rateText}
          disabled={busy}
          placeholder="1 850,00"
          onChange={(event) => setRateText(event.target.value)}
          className="num t-base h-7 w-28 rounded-[var(--r-sm)] border border-[var(--n-200)] bg-[var(--n-0)] px-2 text-right outline-none focus:border-[var(--a-500)]"
        />
        <button
          type="button"
          data-act="apply-rate"
          disabled={busy || rateText.trim() === ""}
          onClick={() => onApply(() => applyRate(projectId, runId, itemIds, rateText))}
          className="t-sm h-7 rounded-[var(--r-md)] bg-[var(--a-500)] px-2 font-medium text-white transition-colors hover:bg-[var(--a-600)] disabled:cursor-not-allowed disabled:opacity-40"
          style={{ transitionDuration: "var(--m-fast)" }}
        >
          Apply rate
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        <label htmlFor="bulk-percent" className="t-sm text-[var(--n-600)]">
          Adjust
        </label>
        <input
          id="bulk-percent"
          value={percentText}
          disabled={busy}
          placeholder="8"
          onChange={(event) => setPercentText(event.target.value)}
          className="num t-base h-7 w-16 rounded-[var(--r-sm)] border border-[var(--n-200)] bg-[var(--n-0)] px-2 text-right outline-none focus:border-[var(--a-500)]"
        />
        <span className="t-sm text-[var(--n-600)]">%</span>
        <button
          type="button"
          data-act="adjust"
          disabled={busy || percentText.trim() === ""}
          onClick={() => onApply(() => adjustRates(projectId, runId, itemIds, percentText))}
          className="t-sm h-7 rounded-[var(--r-md)] border border-[var(--a-500)] px-2 font-medium text-[var(--a-700)] transition-colors hover:bg-[var(--a-100)] disabled:cursor-not-allowed disabled:opacity-40"
          style={{ transitionDuration: "var(--m-fast)" }}
        >
          Adjust
        </button>
      </div>

      <button
        type="button"
        onClick={onClear}
        className="t-sm ml-auto inline-flex items-center gap-1 text-[var(--n-600)] underline underline-offset-2"
      >
        <X aria-hidden size={12} strokeWidth={2} />
        Clear selection
      </button>
    </div>
  );
}

/** A section: its own checkbox takes every item under it, which is the grouping a QS prices by. */
function SectionRow({
  row,
  reference,
  frozen,
  items,
  selected,
  onToggle,
}: {
  row: BillRow;
  reference: string;
  frozen: boolean;
  items: readonly BillRow[];
  selected: ReadonlySet<string>;
  onToggle: (ids: readonly string[], on: boolean) => void;
}) {
  const all = items.length > 0 && items.every((item) => selected.has(item.id));

  return (
    <tr data-row={row.id} data-type="heading" className="border-b border-[var(--n-100)] bg-[var(--n-25)]">
      <td className="px-3 py-1.5">
        {!frozen && (
          <input
            type="checkbox"
            aria-label={`Select every item in ${workingRow(row).description ?? "this section"}`}
            checked={all}
            disabled={items.length === 0}
            onChange={(event) => onToggle(items.map((item) => item.id), event.target.checked)}
            className="size-3.5 accent-[var(--a-500)]"
          />
        )}
      </td>
      <td className="t-sm num px-3 py-1.5 font-semibold text-[var(--n-600)]">
        {row.itemRef ?? reference}
      </td>
      <td colSpan={6} className="t-base px-3 py-1.5 font-semibold text-[var(--n-800)]">
        {workingRow(row).description}
      </td>
    </tr>
  );
}

function ItemRow({
  row,
  reference,
  index,
  frozen,
  busy,
  buildUp,
  selected,
  open,
  projectId,
  runId,
  onToggle,
  onOpen,
  onSave,
}: {
  row: BillRow;
  reference: string;
  index: number;
  frozen: boolean;
  busy: boolean;
  buildUp: BuildUp | null;
  selected: boolean;
  open: boolean;
  projectId: string;
  runId: string;
  onToggle: (on: boolean) => void;
  onOpen: () => void;
  onSave: (itemId: string, value: string) => void;
}) {
  const working = workingRow(row);
  const state = priceState(row);

  /**
   * Whether the rate on the row is still the build-up's answer.
   *
   * §4.8 wants the plug "flagged, never hidden", and a rate typed over the top of a build-up in the
   * bill grid is the same situation arrived at from another screen. Derived by comparing the two
   * rather than stored, so it cannot go stale, and shown on the row so the disagreement is visible
   * without opening anything.
   */
  const applied = buildUp ? computeBuildUp(buildUp).applied : null;
  const detached =
    applied !== null &&
    (working.rate === null ||
      working.rate.value !== applied.value ||
      working.rate.precision !== applied.precision);

  return (
    <>
      <tr
        data-row={row.id}
        data-type="item"
        data-state={state}
        className={`border-b border-[var(--n-100)] align-top transition-colors hover:bg-[var(--n-25)] ${
          selected ? "bg-[var(--a-50)]/40" : ""
        }`}
        style={{ transitionDuration: "60ms" }}
      >
        <td className="px-3 py-1.5">
          {!frozen && (
            <input
              type="checkbox"
              aria-label={`Select ${working.description ?? "this item"}`}
              checked={selected}
              onChange={(event) => onToggle(event.target.checked)}
              className="size-3.5 accent-[var(--a-500)]"
            />
          )}
        </td>

        <td className="t-sm num px-3 py-1.5 text-[var(--n-500)]">{row.itemRef ?? reference}</td>

        <td className="t-base px-3 py-1.5 break-words text-[var(--n-800)]">
          {working.description ?? <span className="text-[var(--n-400)]">An unnamed item</span>}
        </td>

        <td className="t-sm px-3 py-1.5 text-[var(--n-600)]">{working.unit ?? "—"}</td>

        {/* The quantity belongs to the bill, and is read-only here. §2.5: measuring is that screen's
            job, and a second place to change it is a second place for the two to disagree. */}
        <td className="num t-base px-3 py-1.5 text-right text-[var(--n-700)]">
          {working.quantity === null ? (
            <span className="t-sm text-[var(--n-400)]">to measure</span>
          ) : (
            formatQuantity(parseQuantity(working.quantity))
          )}
        </td>

        <td className="px-3 py-1.5 text-right">
          {frozen ? (
            <span className="num t-base">
              {row.output?.rate ? formatWireRate(row.output.rate) : ""}
            </span>
          ) : (
            <RateCell row={row} index={index} onSave={onSave} />
          )}
          {/* The agent's own figure, still visible under a correction — the reason `proposed` and
              `overrides` are two maps rather than one value. */}
          {row.override?.rate && row.proposed.rate && (
            <span className="t-xs mt-0.5 block text-[var(--n-500)]">
              agent said {formatWireRate(row.proposed.rate)}
            </span>
          )}
        </td>

        <td className="px-3 py-1.5 text-right">
          <MoneyCell minorUnits={frozen ? (row.output?.amount ?? null) : row.amount} />
        </td>

        <td className="px-3 py-1.5">
          <span
            className={`t-xs inline-block rounded-[var(--r-sm)] px-1.5 py-0.5 font-medium ${STATE_TONE[state]}`}
          >
            {PRICE_STATE_LABEL[state]}
          </span>
          {state !== "unpriced" && (
            <span className="t-xs mt-0.5 block text-[var(--n-500)]">
              {RATE_SOURCE_LABEL[row.rateSource] ?? row.rateSource}
            </span>
          )}
          {detached && (
            <span className="t-xs mt-0.5 block text-[var(--warn-700)]">
              not the build-up&rsquo;s {formatWireRate(applied)}
            </span>
          )}

          {!frozen && (
            <button
              type="button"
              data-act="build-up"
              disabled={busy}
              aria-expanded={open}
              onClick={onOpen}
              className="t-sm mt-1 inline-flex items-center gap-1 text-[var(--n-600)] underline underline-offset-2 disabled:text-[var(--n-300)]"
            >
              {open ? (
                <ChevronDown aria-hidden size={11} strokeWidth={2} />
              ) : (
                <ChevronRight aria-hidden size={11} strokeWidth={2} />
              )}
              <Calculator aria-hidden size={11} strokeWidth={2} />
              {buildUp ? "Build-up" : "Build up the rate"}
            </button>
          )}
        </td>
      </tr>

      {open && !frozen && (
        <tr data-buildup-for={row.id} className="border-b border-[var(--n-100)] bg-[var(--n-25)]">
          <td colSpan={8} className="px-4 py-3">
            <BuildUpEditor
              projectId={projectId}
              runId={runId}
              itemId={row.id}
              unit={working.unit}
              buildUp={buildUp}
              onClose={onOpen}
            />
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * The rate cell — the one editable figure on this screen.
 *
 * The same idiom as the bill grid: the cell **is** the input, it commits on blur and on Enter, and
 * Escape drops the edit. It is not disabled while a save is in flight — the bill grid learned that
 * the hard way, where a slow save on a busy machine swallowed the next keystrokes and §7.4 wants a
 * column typed down without interruption.
 */
function RateCell({
  row,
  index,
  onSave,
}: {
  row: BillRow;
  index: number;
  onSave: (itemId: string, value: string) => void;
}) {
  const committed = (() => {
    const working = workingRow(row).rate;
    return working === null ? "" : formatWireRate(working);
  })();

  const [draft, setDraft] = useState<string | null>(null);

  const commit = (element: HTMLInputElement) => {
    if (draft === null || draft === committed) {
      setDraft(null);
      return;
    }
    onSave(row.id, draft);
    setDraft(null);
    element.blur();
  };

  const move = (from: HTMLElement, by: number) => {
    const target = from
      .closest("tbody")
      ?.querySelector<HTMLInputElement>(`[data-rate-row="${index + by}"]`);
    target?.focus();
    target?.select();
  };

  return (
    <input
      data-rate-row={index}
      data-cell="rate"
      aria-label={`Rate, ${workingRow(row).description ?? "unnamed item"}`}
      value={draft ?? committed}
      placeholder={row.proposed.rateText === null ? "price" : ""}
      /**
       * Selecting the whole value on focus, which is what makes "click it and retype" work.
       *
       * Measured, not assumed: with `1 500,00` in the cell, a triple-click set the selection to
       * `2-2 of 8` — nothing. §7.7 groups thousands with a **non-breaking space**, and Chrome's
       * line selection will not cross one, so the click placed a caret and typing `1 900,00`
       * produced `11 900,00500,00`. `separatorsOf` now refuses that outright rather than reading it
       * as R119 000 050 000,00, and this is the other half: the gesture works instead of producing
       * a figure that has to be refused.
       *
       * It also makes the mouse behave like the keyboard, which already selects on arrival.
       */
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => commit(event.currentTarget)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          commit(event.currentTarget);
          move(event.currentTarget, event.key === "ArrowUp" ? -1 : 1);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setDraft(null);
        }
      }}
      className="num t-base w-full rounded-[var(--r-sm)] border border-transparent bg-transparent px-1 py-0.5 text-right outline-none focus:border-[var(--a-500)] focus:bg-[var(--n-0)]"
    />
  );
}
