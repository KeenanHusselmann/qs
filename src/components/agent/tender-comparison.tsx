"use client";

/**
 * The tender comparison — §1.4 (D1.3), §5.2, §7.4.
 *
 * ── Rows down, tenderers across ────────────────────────────────────────────────────────────
 *
 * The bill's own rows are the spine, because that is the only thing every tenderer priced. A
 * comparison laid out any other way — one panel per tenderer, a summary per column — is a set of
 * totals side by side, and totals side by side is what a QS already had before this platform.
 *
 * Each cell is an `<input>`, and unpriced cells advertise themselves as boxes, for exactly the
 * reason the bill's do: a rate that has not been quoted is work still to be done, and a grey dash
 * reads as a report rather than as a field. That lesson was learned one screen back.
 *
 * ── The two figures under each column ──────────────────────────────────────────────────────
 *
 * **Extended** is what their rates come to against our quantities. **Stated** is what they wrote on
 * the form. The difference between them is the arithmetic correction, and surfacing it is the
 * reason this screen holds rows at all — no summary of a tender can produce it. Where the two
 * agree, the row says so plainly rather than going quiet, because "checked and correct" is a
 * finding a QS needs to be able to point at.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Plus, TriangleAlert, X } from "lucide-react";

import { formatMoney, formatQuantity, formatRate, money, parseQuantity, rate } from "@/domain/money";
import { compareTenders, type TenderReturn } from "@/lib/agent/tender";
import { itemReferences, workingRow, type BillRow } from "@/lib/agent/bill";
import {
  addTenderer,
  pasteTenderColumn,
  setStatedSum,
  setTenderPrice,
  withdrawTender,
} from "@/app/(app)/projects/[id]/tender-actions";

export function TenderComparison({
  projectId,
  rows,
  returns,
  billTotal,
}: {
  projectId: string;
  /** The signed bill, in its own order. Headings included — they are how the grid reads. */
  rows: readonly BillRow[];
  returns: readonly TenderReturn[];
  /** Our own total, as a decimal string of minor units. The benchmark every column is read against. */
  billTotal: string;
}) {
  const router = useRouter();
  const [pending, act] = useTransition();
  const [name, setName] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);

  const items = rows.filter((r) => r.rowType === "item" && !r.omitted);
  const itemIds = items.map((r) => r.id);
  const refs = itemReferences(rows);

  const { columns, lowest } = compareTenders(returns, itemIds, money(BigInt(billTotal)));
  const priceOf = new Map(
    returns.map((entry) => [entry.id, new Map(entry.prices.map((p) => [p.itemId, p]))]),
  );

  const run = (work: () => Promise<{ ok: boolean; reason?: string }>) =>
    act(async () => {
      const outcome = await work();
      setRefusal(outcome.ok ? null : (outcome.reason ?? "That did not save."));
      if (outcome.ok) router.refresh();
    });

  return (
    <section
      data-region="tender-comparison"
      className="mt-6 rounded-[var(--r-lg)] border border-[var(--n-200)]"
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--n-100)] px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="t-base font-semibold text-[var(--n-800)]">Tenders, row by row</h2>
          <p className="t-sm mt-0.5 text-[var(--n-500)]">
            Each tenderer&rsquo;s rates against the quantities in the signed bill. Paste a column
            straight from their spreadsheet — the amounts follow, and so does the check against what
            they said their tender comes to.
          </p>
        </div>

        <form
          className="flex shrink-0 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const tenderer = name;
            setName("");
            run(() => addTenderer(projectId, tenderer));
          }}
        >
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Tenderer's name"
            aria-label="Tenderer's name"
            data-field="tenderer-name"
            className="t-sm h-8 w-[180px] rounded-[var(--r-md)] border border-[var(--n-200)] px-2 outline-none focus:border-[var(--a-500)]"
          />
          <button
            type="submit"
            disabled={pending || name.trim() === ""}
            data-action="add-tenderer"
            className="t-sm flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--n-300)] bg-[var(--n-0)] px-2.5 font-medium text-[var(--n-700)] transition-colors hover:bg-[var(--n-50)] disabled:cursor-not-allowed disabled:opacity-50"
            style={{ transitionDuration: "var(--m-fast)" }}
          >
            <Plus aria-hidden size={13} strokeWidth={2.25} />
            Add a tender
          </button>
        </form>
      </header>

      {refusal && (
        <p role="alert" className="t-sm border-b border-[var(--n-100)] px-4 py-2.5 text-[var(--err-700)]">
          {refusal}
        </p>
      )}

      {columns.length === 0 ? (
        <p className="t-sm px-4 py-4 text-[var(--n-600)]">
          No tenders yet. Add one and its rates go in the column beside the bill — nothing is
          compared until there is something to compare.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-[var(--n-200)]">
                  <th scope="col" className="t-xs px-3 py-2 text-left font-semibold tracking-wide text-[var(--n-600)] uppercase">
                    Item
                  </th>
                  <th scope="col" className="t-xs px-3 py-2 text-left font-semibold tracking-wide text-[var(--n-600)] uppercase">
                    Description
                  </th>
                  <th scope="col" className="t-xs px-3 py-2 text-right font-semibold tracking-wide text-[var(--n-600)] uppercase">
                    Qty
                  </th>
                  <th scope="col" className="t-xs px-3 py-2 text-right font-semibold tracking-wide text-[var(--n-600)] uppercase">
                    Our rate
                  </th>

                  {columns.map((column) => (
                    <th
                      key={column.id}
                      scope="col"
                      data-tenderer={column.id}
                      className="t-xs min-w-[130px] px-3 py-2 text-right font-semibold tracking-wide text-[var(--n-700)] uppercase"
                    >
                      <span className="flex items-center justify-end gap-1.5">
                        <span className="truncate">{column.tenderer}</span>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => run(() => withdrawTender(projectId, column.id))}
                          title={`Withdraw ${column.tenderer} from the comparison`}
                          aria-label={`Withdraw ${column.tenderer}`}
                          className="shrink-0 text-[var(--n-400)] transition-colors hover:text-[var(--err-700)]"
                          style={{ transitionDuration: "var(--m-fast)" }}
                        >
                          <X aria-hidden size={12} strokeWidth={2.25} />
                        </button>
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {rows.map((row) => {
                  const heading = row.rowType === "heading";
                  const out = row.output;
                  const working = workingRow(row);

                  if (heading) {
                    return (
                      <tr key={row.id} className="border-b border-[var(--n-100)] bg-[var(--n-25)]">
                        <td className="t-sm px-3 py-1.5 text-[var(--n-500)]">{refs.get(row.id) ?? ""}</td>
                        <td
                          colSpan={3 + columns.length}
                          className="t-sm px-3 py-1.5 font-semibold text-[var(--n-800)]"
                        >
                          {out?.description ?? working.description ?? ""}
                        </td>
                      </tr>
                    );
                  }

                  if (row.omitted) return null;

                  return (
                    <tr key={row.id} data-row={row.id} className="border-b border-[var(--n-100)] align-top">
                      <td className="t-sm px-3 py-1.5 text-[var(--n-500)]">{refs.get(row.id) ?? ""}</td>
                      <td className="t-sm px-3 py-1.5 text-[var(--n-700)]">
                        {out?.description ?? working.description ?? ""}
                      </td>
                      <td className="t-sm num px-3 py-1.5 text-right whitespace-nowrap text-[var(--n-600)]">
                        {/*
                          Through `formatQuantity`, not raw. The column read "25.0000 m3" — a
                          point decimal and four trailing zeros, on a screen where every other
                          figure is §7.7's comma. The stored form is the database's; this is the
                          reader's.
                        */}
                        {out?.quantity ? formatQuantity(parseQuantity(out.quantity)) : ""}{" "}
                        {out?.unit ?? ""}
                      </td>
                      <td className="t-sm num px-3 py-1.5 text-right whitespace-nowrap text-[var(--n-600)]">
                        {out?.rate ? formatRate(rate(BigInt(out.rate.value), out.rate.precision)) : ""}
                      </td>

                      {columns.map((column) => {
                        const price = priceOf.get(column.id)?.get(row.id);
                        const quoted = price?.rate
                          ? formatRate(rate(BigInt(price.rate.value), price.rate.precision))
                          : "";

                        return (
                          <td key={column.id} className="px-2 py-1">
                            <PriceCell
                              value={quoted}
                              amount={price?.amount ?? null}
                              disabled={pending}
                              onSave={(typed) =>
                                run(() => setTenderPrice(projectId, column.id, row.id, typed))
                              }
                              onPaste={(block) =>
                                run(async () => {
                                  // From this row down: a QS pastes into the cell where their
                                  // column starts, not always at the top. The bill's grid settled
                                  // this and the two behave the same way.
                                  const from = itemIds.indexOf(row.id);
                                  return pasteTenderColumn(
                                    projectId,
                                    column.id,
                                    itemIds.slice(from),
                                    block,
                                  );
                                })
                              }
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>

              <tfoot>
                <tr className="total-row">
                  <td colSpan={3} className="t-sm px-3 py-2 font-semibold text-[var(--n-800)]">
                    Tender total — their rates, our quantities
                  </td>
                  <td className="t-sm num px-3 py-2 text-right font-semibold whitespace-nowrap text-[var(--n-800)]">
                    {formatMoney(money(BigInt(billTotal)))}
                  </td>

                  {columns.map((column) => (
                    <td
                      key={column.id}
                      data-total={column.id}
                      className="t-sm num px-3 py-2 text-right font-semibold whitespace-nowrap text-[var(--n-900)]"
                    >
                      {formatMoney(column.extended)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>

          {/*
            The findings, under the grid rather than in it.

            Three facts per tender that are not rates and do not belong in a rate column: what they
            said it comes to, what the arithmetic says, and how they sit against our own bill.
          */}
          <div className="border-t border-[var(--n-100)] px-4 py-3">
            <h3 className="t-sm font-semibold text-[var(--n-800)]">What each tender says, and what it checks out at</h3>

            <ul className="mt-2 flex flex-col gap-2">
              {columns.map((column) => (
                <li
                  key={column.id}
                  data-finding={column.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--n-100)] pb-2 last:border-0 last:pb-0"
                >
                  <span className="t-sm min-w-[130px] font-medium text-[var(--n-800)]">
                    {column.tenderer}
                    {lowest === column.id && (
                      <span className="t-xs ml-1.5 rounded-[var(--r-sm)] bg-[var(--ok-500)]/15 px-1.5 py-0.5 font-medium text-[var(--ok-700)]">
                        lowest
                      </span>
                    )}
                  </span>

                  <label className="t-sm flex items-center gap-1.5 text-[var(--n-600)]">
                    Stated on the form
                    <StatedCell
                      value={column.stated === null ? "" : formatMoney(column.stated)}
                      disabled={pending}
                      onSave={(typed) => run(() => setStatedSum(projectId, column.id, typed))}
                    />
                  </label>

                  {/* The arithmetic check — the reason this screen holds rows at all. */}
                  {column.difference === null ? (
                    <span className="t-sm text-[var(--n-500)]">
                      nothing stated to check the rates against
                    </span>
                  ) : column.difference === 0n ? (
                    <span className="t-sm flex items-center gap-1.5 text-[var(--ok-700)]">
                      <Check aria-hidden size={13} strokeWidth={2.25} />
                      arithmetic checks out
                    </span>
                  ) : (
                    <span className="t-sm flex items-center gap-1.5 font-medium text-[var(--warn-700)]">
                      <TriangleAlert aria-hidden size={13} strokeWidth={2.25} />
                      <span className="num">{formatMoney(column.difference, { symbol: "R" })}</span>
                      {column.difference > 0n ? "more than stated" : "less than stated"}
                    </span>
                  )}

                  {column.unpriced > 0 && (
                    <span className="t-sm text-[var(--warn-700)]">
                      {column.unpriced} {column.unpriced === 1 ? "item" : "items"} not priced
                    </span>
                  )}

                  <span className="t-sm ml-auto text-[var(--n-600)]">
                    <span className="num font-medium">
                      {formatMoney(column.againstBill, { symbol: "R" })}
                    </span>{" "}
                    against our bill
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * One tenderer's rate against one row.
 *
 * Empty cells are boxed and filled ones are not — the bill's rule, for the bill's reason: an
 * unquoted rate is work outstanding, and a dash reads as a status rather than as a field. Measured
 * on the same tokens: border 3,55:1, placeholder 5,16:1.
 */
function PriceCell({
  value,
  amount,
  disabled,
  onSave,
  onPaste,
}: {
  value: string;
  amount: string | null;
  disabled: boolean;
  onSave: (typed: string) => void;
  onPaste: (block: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;

  const commit = () => {
    if (draft === null || draft === value) return setDraft(null);
    onSave(draft);
    setDraft(null);
  };

  return (
    <span className="block">
      <input
        data-price
        value={shown}
        disabled={disabled}
        placeholder="rate"
        aria-label="Tendered rate"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
            event.currentTarget.blur();
          }
          if (event.key === "Escape") setDraft(null);
        }}
        onPaste={(event) => {
          const block = event.clipboardData.getData("text/plain");
          // A single cell is an ordinary paste; a block is a column, and §7.4 is emphatic that a
          // QS who cannot paste one out of Excel will not use the product.
          if (!/[\n\r]/.test(block)) return;
          event.preventDefault();
          onPaste(block);
        }}
        className={`t-sm num w-full rounded-[var(--r-sm)] border px-1 py-0.5 text-right outline-none focus:border-[var(--a-500)] focus:bg-[var(--n-0)] ${
          shown.trim() === ""
            ? "border-[var(--warn-500)] bg-[var(--warn-50)] placeholder:text-[var(--warn-700)]"
            : "border-transparent bg-transparent"
        }`}
      />

      {amount && (
        <span className="t-xs num mt-0.5 block text-right text-[var(--n-500)]">
          {formatMoney(money(BigInt(amount)))}
        </span>
      )}
    </span>
  );
}

/** What the tenderer wrote on the form — one figure per tender, not per row. */
function StatedCell({
  value,
  disabled,
  onSave,
}: {
  value: string;
  disabled: boolean;
  onSave: (typed: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;

  const commit = () => {
    if (draft === null || draft === value) return setDraft(null);
    onSave(draft);
    setDraft(null);
  };

  return (
    <input
      data-stated
      value={shown}
      disabled={disabled}
      placeholder="not stated"
      aria-label="Tender sum as stated on the form"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") setDraft(null);
      }}
      className={`t-sm num w-[130px] rounded-[var(--r-sm)] border px-1.5 py-0.5 text-right outline-none focus:border-[var(--a-500)] ${
        shown.trim() === ""
          ? "border-[var(--warn-500)] bg-[var(--warn-50)] placeholder:text-[var(--warn-700)]"
          : "border-[var(--n-200)] bg-[var(--n-0)]"
      }`}
    />
  );
}
