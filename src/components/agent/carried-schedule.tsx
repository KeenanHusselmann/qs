/**
 * The rows a step opened from — PLATFORM.md §1.3.1, §1.4.
 *
 * ── What this is for ───────────────────────────────────────────────────────────────────────
 *
 * A step that carries a *field* shows it in the field table with "carried from the cost plan"
 * beside it, so a reader can see where a figure came from without leaving the screen. A step that
 * carries **rows** had nowhere to show that at all, and the bill — the most consequential thing the
 * platform produces — reached the next step invisibly or not at all.
 *
 * This is that surface. It is deliberately **read-only and complete**: the schedule going out to
 * tender is the signed bill, unchanged, and a screen that let it be edited here would be a second
 * bill with the same name. Editing it means revising the bill, which is where that act lives.
 *
 * ── Why the total is recomputed and not carried ────────────────────────────────────────────
 *
 * `billTotal(rows, true)` sums the frozen `output_amount`s, which is the same sum the bill's own
 * signature strip prints. Reading it from a stored figure instead would create a second number for
 * one fact — §6.5's rule, and the reason no total in this platform is stored anywhere.
 */

import Link from "next/link";
import { FileSpreadsheet } from "lucide-react";

import { formatDate } from "@/lib/dates";
import { formatMoney, formatQuantity, formatRate, money, parseQuantity, rate } from "@/domain/money";
import { billTotal, itemReferences, pricedRows, workingRow, type BillRow } from "@/lib/agent/bill";

export function CarriedSchedule({
  projectId,
  from,
  fromLabel,
  rows,
  by,
  at,
}: {
  projectId: string;
  /** The module the rows were signed in, so the header can link back to it. */
  from: string;
  /** Its menu label — the one name for it, from `navigation.ts` via `chain.ts`. */
  fromLabel: string;
  rows: readonly BillRow[];
  by: string;
  at: string;
}) {
  const items = pricedRows(rows);
  const refs = itemReferences(rows);

  return (
    <section
      data-region="carried-schedule"
      className="mt-6 rounded-[var(--r-lg)] border border-[var(--n-200)]"
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--n-100)] px-4 py-3">
        <FileSpreadsheet
          aria-hidden
          size={16}
          strokeWidth={1.75}
          className="shrink-0 text-[var(--n-500)]"
        />
        <div className="min-w-0 flex-1">
          <h2 className="t-base font-semibold text-[var(--n-800)]">
            The schedule this step tenders
          </h2>
          <p className="t-sm mt-0.5 text-[var(--n-500)]">
            Carried from{" "}
            <Link
              href={`/projects/${projectId}${from}`}
              className="font-medium text-[var(--a-700)] underline underline-offset-2 hover:text-[var(--a-600)]"
            >
              {fromLabel}
            </Link>
            , signed off by {by} on {formatDate(at)}. These are the frozen rows, not a copy — nothing
            here is retyped, and nothing here can be edited except by revising that bill.
          </p>
        </div>

        <p className="t-sm shrink-0 text-right text-[var(--n-600)]">
          {items.length} {items.length === 1 ? "item" : "items"}
          <span className="num t-base mt-0.5 block font-semibold text-[var(--n-900)]">
            R {formatMoney(billTotal(rows, true))}
          </span>
        </p>
      </header>

      {/*
        The whole bill, scrolling inside its own box.

        Not the first ten with "and 380 more": the reader of this screen is about to send these rows
        to contractors, and a schedule you cannot read all of is one nobody checked. The box scrolls
        rather than the page so the header above stays with it.
      */}
      <div className="max-h-[420px] overflow-y-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-[1] bg-[var(--n-50)]">
            <tr className="border-b border-[var(--n-200)]">
              {["Item", "Description", "Unit", "Qty", "Rate (R)", "Amount (R)"].map((head, i) => (
                <th
                  key={head}
                  scope="col"
                  className={`t-xs px-3 py-2 font-semibold tracking-wide text-[var(--n-600)] uppercase ${
                    i >= 3 ? "text-right" : "text-left"
                  }`}
                >
                  {head}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => {
              const heading = row.rowType === "heading";
              const working = workingRow(row);
              const out = row.output;

              return (
                <tr
                  key={row.id}
                  data-row={row.id}
                  className={`border-b border-[var(--n-100)] align-top last:border-0 ${
                    heading ? "bg-[var(--n-25)]" : ""
                  }`}
                >
                  <td className="t-sm px-3 py-1.5 text-[var(--n-500)]">{refs.get(row.id) ?? ""}</td>
                  <td
                    className={`t-sm px-3 py-1.5 ${
                      heading ? "font-semibold text-[var(--n-800)]" : "text-[var(--n-700)]"
                    }`}
                  >
                    {out?.description ?? working.description ?? ""}
                  </td>
                  <td className="t-sm px-3 py-1.5 text-[var(--n-600)]">{out?.unit ?? ""}</td>
                  <td className="t-sm num px-3 py-1.5 text-right text-[var(--n-700)]">
                    {out?.quantity ? formatQuantity(parseQuantity(out.quantity)) : ""}
                  </td>
                  <td className="t-sm num px-3 py-1.5 text-right text-[var(--n-700)]">
                    {out?.rate ? formatRate(rate(BigInt(out.rate.value), out.rate.precision)) : ""}
                  </td>
                  <td className="t-sm num px-3 py-1.5 text-right font-medium text-[var(--n-800)]">
                    {out?.amount ? formatMoney(money(BigInt(out.amount))) : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
