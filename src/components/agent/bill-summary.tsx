/**
 * What a bill comes to — PLATFORM.md §4.7, §5.2, §5.3.
 *
 * ── The reference design, with its arithmetic corrected ────────────────────────────────────
 *
 * The prototype's BoQ Builder puts a summary beside the grid, and it is the right thing to have:
 * a QS reading four hundred items wants the shape of the money without scrolling. Its figures are
 * followed here; two of its lines are not, and both are worth writing down.
 *
 * **Preliminaries are not a percentage.** The prototype prices `1. PRELIMINARIES` as bill items —
 * site establishment, temporary services — and *then* adds "Preliminaries (12%)" to the net total.
 * They are counted twice. In South African practice preliminaries are measured items in Bill No. 1;
 * a 12% uplift is a concept estimate's convention, and applying it to a priced bill inflates a
 * tender document. So there is no uplift here. What the bill prices is what the bill comes to.
 *
 * **The totals must reconcile.** The prototype shows a "Grand Total" of R273,1m built from a net
 * of R198,7m, and beneath it a "Total Project Value" of R342,5m summing four packages. Both are
 * labelled as totals and neither can be derived from the other. Everything here is one sum of one
 * set of rows: the section breakdown adds to the net, and the net is what the grand total is built
 * from.
 *
 * ── VAT is shown, and shown as what it is ──────────────────────────────────────────────────
 *
 * §5.3: VAT is applied at certificate level, never per item — and a tender is priced excluding it,
 * because that is what a tenderer submits. So the bill's own figure is the net, and VAT is an
 * optional line that says who it is for. Off by default: the number a QS issues, checks and
 * compares against a tender return is the exclusive one, and a summary whose headline moves 15%
 * depending on a checkbox somebody left ticked is a summary that will be misread.
 *
 * Applied once, to the total, via `applyPercent` — never per item, which is the rule that keeps a
 * hand-added column matching (§5.2).
 */

"use client";

import { useMemo, useState } from "react";

import { Panel } from "@/components/shell/panel";
import { billTotal, pricedRows, sectionTotal, workingRow, type BillRow } from "@/lib/agent/bill";
import { applyPercent, formatMoney, money, percentFromRate } from "@/domain/money";

/** §5.3, and the rate a South African certificate carries. */
const VAT = percentFromRate(15);

export function BillSummary({
  projectId,
  rows,
  signed,
}: {
  projectId: string;
  rows: readonly BillRow[];
  signed: boolean;
}) {
  const [withVat, setWithVat] = useState(false);

  const net = useMemo(() => billTotal(rows, signed), [rows, signed]);

  /*
    "Priced" means *carries an amount*, which is not what `pricedRows` returns.

    That helper means "items, not struck out" — the rows that count towards a total at all. Reading
    it as "rows that have a price" made this panel report 5 of 5 priced directly beneath a grid
    saying one row still had no measure, and beneath a sign-off gate refusing for that exact reason.
    Three surfaces, one fact, and this was the one that disagreed.
  */
  const counting = pricedRows(rows);
  const priced = counting.filter((r) => (signed ? r.output?.amount : r.amount) != null);
  const unpriced = counting.length - priced.length;

  /**
   * The sections, summing to the net.
   *
   * This is what the prototype's package strip wanted to be. Packages are not derivable here —
   * nothing maps a bill section to "Building" or "MEP", and inventing that mapping would be a
   * declaration masquerading as a derivation (invariant 4). Sections are what this bill actually
   * has: they come from the documents it was drafted from, and they add up.
   */
  const sections = useMemo(
    () =>
      rows
        .filter((r) => r.rowType === "heading")
        .map((heading) => ({
          id: heading.id,
          label: workingRow(heading).description ?? "Section",
          // The grid's own subtotal function, so the panel and the row it sits under cannot differ.
          total: sectionTotal(rows, heading.id, signed),
          items: rows.filter((r) => r.parentId === heading.id && r.rowType === "item").length,
        }))
        .filter((s) => s.items > 0),
    [rows, signed],
  );

  const vat = applyPercent(net, VAT);
  const gross = money(net + vat);

  return (
    <Panel
      title="What this bill comes to"
      count={`${priced.length} of ${counting.length} priced`}
      tone={unpriced > 0 ? "warn" : undefined}
      /*
        §7.1 #6 — the printout is the product. Until this existed a QS could draft a bill, price it
        and sign it off, and then not produce the document a tenderer reads. The printed form
        carries what the screen cannot: carried-forward subtotals across every page break, repeating
        column headings, and a collection page that adds the sections to the total.
      */
      action={{ href: `/projects/${projectId}/report/pdf?document=bill`, label: "Download PDF" }}
    >
      <dl className="flex flex-col gap-1.5">
        <Line label="Priced items" value={formatMoney(net, { symbol: "R" })} strong />

        {/*
          The line the prototype has no room for, and the one that matters most on a draft.

          A total over a bill with holes in it is not the bill's total — it is the total of the part
          somebody has measured. §1.3: a gap is stated, never quietly summed past. The sign-off gate
          refuses on the same fact, so this is the figure agreeing with the refusal rather than a
          second opinion about it.
        */}
        {unpriced > 0 && (
          <Line
            label={`${unpriced} ${unpriced === 1 ? "item is" : "items are"} not priced`}
            value="excluded"
            tone="warn"
          />
        )}
      </dl>

      {sections.length > 0 && (
        <div className="mt-3 border-t border-[var(--n-100)] pt-2">
          <p className="t-sm mb-1.5 font-medium text-[var(--n-700)]">By section</p>
          <dl className="flex flex-col gap-1">
            {sections.map((s) => (
              <Line
                key={s.id}
                label={s.label}
                value={formatMoney(s.total, { symbol: "R" })}
                note={
                  net > 0n
                    ? `${((Number(s.total) / Number(net)) * 100).toFixed(1)}%`
                    : undefined
                }
              />
            ))}
          </dl>
        </div>
      )}

      <div className="mt-3 border-t border-[var(--n-100)] pt-2">
        <label className="t-sm flex items-center gap-2 text-[var(--n-600)]">
          <input
            type="checkbox"
            checked={withVat}
            onChange={(e) => setWithVat(e.target.checked)}
            className="size-3.5 accent-[var(--a-500)]"
          />
          Show VAT
        </label>

        {/*
          Off by default and labelled when on. A tender is submitted excluding VAT, so the figure a
          QS issues and compares against a return is the net — and a headline that moves 15% on a
          checkbox somebody left ticked is a headline that gets misread into a recommendation.
        */}
        {withVat && (
          <dl className="mt-2 flex flex-col gap-1.5">
            <Line label="VAT at 15%" value={formatMoney(vat, { symbol: "R" })} />
            <Line label="Including VAT" value={formatMoney(gross, { symbol: "R" })} strong />
            <p className="t-xs mt-0.5 text-[var(--n-500)]">
              For information. A tender is priced excluding VAT, and VAT is applied on a certificate
              rather than on an item (§5.3) — so the figure this bill is issued and adjudicated on is
              the one above.
            </p>
          </dl>
        )}
      </div>
    </Panel>
  );
}

function Line({
  label,
  value,
  note,
  strong,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  strong?: boolean;
  tone?: "warn";
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={`t-sm min-w-0 truncate ${tone === "warn" ? "text-[var(--warn-700)]" : "text-[var(--n-600)]"}`}>
        {label}
      </dt>
      <dd className="flex shrink-0 items-baseline gap-2">
        {note && <span className="t-xs text-[var(--n-400)]">{note}</span>}
        {/*
          One colour class, not two: the strong line used to set a darker ink and then have the
          default overwrite it, so the headline figure rendered lighter than the lines under it.
        */}
        <span
          className={`num ${strong ? "text-[1.3rem] leading-tight font-bold" : "t-sm"} ${
            tone === "warn" ? "text-[var(--warn-700)]" : strong ? "text-[var(--n-900)]" : "text-[var(--n-700)]"
          }`}
        >
          {value}
        </span>
      </dd>
    </div>
  );
}
