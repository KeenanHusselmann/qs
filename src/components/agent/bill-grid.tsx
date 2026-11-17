/**
 * The bill — PLATFORM.md §4.7, §5.2, §7.4.
 *
 * §4.7: **"the most important screen in the app. It gets more attention than everything else
 * combined. If it's excellent we have a product with rough edges. If it's mediocre, nothing else
 * saves us."**
 *
 * ── What is built, and what is honestly not ────────────────────────────────────────────────
 *
 * §7.4 lists eight mandatory grid requirements. Three of them decide whether a QS can use this at
 * all, and they are here:
 *
 *   · **inline editing, no modal** — the cell *is* the input, always, so a review pass is typing
 *     rather than clicking Correct and waiting for a form. The field table learned this first.
 *   · **full keyboard navigation** — arrows, Tab, Enter, Escape, and Alt+arrow to fold a section.
 *   · **paste a multi-cell block from Excel** — §7.4 says it outright: *"if a QS can't paste a
 *     column from Excel, they won't use the product"*. A block longer than the bill appends rows.
 *
 * Not built, and not pretended: virtualisation and 15 000 rows, undo/redo, `⌘D` fill-down, and
 * resizable / reorderable / hideable columns persisted per user. They wait for a bill big enough to
 * need them, which is the same moment virtualisation becomes the thing that makes the rest possible.
 *
 * ── Every row keeps its passage, and that is why the row is two lines ──────────────────────
 *
 * §4.7's columns are `Item ref | Description | Unit | Qty | Rate | Amount`, and it puts provenance in
 * a right-hand drawer that does not exist yet. Rather than ship a bill whose rows have no visible
 * evidence at all, the citation sits **under the description** — the document, openable, and the
 * passage in full. It costs a second line on a row §7.4 would keep at 32px, which is a real trade
 * and the right way round: a quote folded behind a disclosure is a quote nobody checks, and this
 * platform's whole claim is that every figure traces.
 *
 * ── The amount is not computed here ────────────────────────────────────────────────────────
 *
 * `round(quantity × rate)` happens once, in the database, on the way in (§5.2, migration 0010). What
 * this screen renders is the column the trigger wrote. A grid that did its own arithmetic would be a
 * second implementation of the one rule §5 says to be paranoid about, and the two would agree right
 * up until the day they did not.
 */

"use client";

import { useCallback, useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, RotateCcw, Strikethrough } from "lucide-react";

import { Citation } from "@/components/documents/citation";
import { MoneyCell } from "@/components/agent/money-cell";
import {
  CELL_LABEL,
  EDITABLE_CELLS,
  billTotal,
  itemReferences,
  pricedRows,
  workingRow,
  type BillRow,
  type EditableCell,
  type WireRate,
} from "@/lib/agent/bill";
import { formatQuantity, formatRate, parseQuantity, rate } from "@/domain/money";
import { correctCell, omitRow, pasteBlock } from "@/app/(app)/projects/[id]/bill-actions";

/** What a cell shows when nobody is typing in it: the working value, in the reader's format. */
function cellText(row: BillRow, cell: EditableCell): string {
  const working = workingRow(row);

  switch (cell) {
    case "description":
      return working.description ?? "";
    case "unit":
      return working.unit ?? "";
    case "quantity":
      return working.quantity === null ? "" : formatQuantity(parseQuantity(working.quantity));
    case "rate":
      return working.rate === null ? "" : formatRate(rate(BigInt(working.rate.value), working.rate.precision));
  }
}

const isNumeric = (cell: EditableCell) => cell === "quantity" || cell === "rate";

/** Where the agent's own answer differs from what is shown, so a reviewer can see what changed. */
function proposedText(row: BillRow, cell: EditableCell): string | null {
  const { proposed, override } = row;
  if (!override) return null;

  switch (cell) {
    case "description":
      return override.description !== null ? (proposed.description ?? "nothing") : null;
    case "unit":
      return override.unit !== null ? (proposed.unit ?? "nothing") : null;
    case "quantity":
      return override.quantity !== null
        ? proposed.quantity === null
          ? "nothing"
          : formatQuantity(parseQuantity(proposed.quantity))
        : null;
    case "rate":
      return override.rate !== null
        ? proposed.rate === null
          ? "nothing"
          : formatRate(rate(BigInt(proposed.rate.value), proposed.rate.precision))
        : null;
  }
}

/** A subtotal, derived on every read (§6.5) as a sum of already-rounded amounts (§5.2). */
interface Subtotal {
  kind: "subtotal";
  headingId: string;
  label: string;
  total: string;
  items: number;
}

type Line = { kind: "row"; row: BillRow; ref: string } | Subtotal;

/**
 * The bill in reading order, with a subtotal wherever a section ends.
 *
 * Sections come from `parent_id`, and the order comes from `seq` — the two agree because rows are
 * written that way, and a subtotal is placed when the group changes rather than stored as a row.
 * §6.5: a stored subtotal is a value that can disagree with what it was derived from, and on a bill
 * somebody is editing it would disagree within seconds.
 */
function layout(rows: readonly BillRow[], collapsed: ReadonlySet<string>, signed: boolean): Line[] {
  const lines: Line[] = [];
  const refs = itemReferences(rows);
  const labelOf = new Map(
    rows.filter((r) => r.rowType === "heading").map((r) => [r.id, workingRow(r).description ?? "Section"]),
  );

  const closeSection = (headingId: string | null) => {
    if (!headingId) return;
    const items = rows.filter((r) => r.parentId === headingId && r.rowType === "item" && !r.omitted);
    if (items.length === 0) return;

    lines.push({
      kind: "subtotal",
      headingId,
      label: labelOf.get(headingId) ?? "Section",
      total: billTotal(items, signed).toString(),
      items: items.length,
    });
  };

  let section: string | null = null;

  for (const row of rows) {
    const ref = refs.get(row.id) ?? "";

    if (row.rowType === "heading") {
      closeSection(section);
      section = row.id;
      lines.push({ kind: "row", row, ref });
      continue;
    }

    if (row.parentId !== section) {
      closeSection(section);
      section = row.parentId;
    }

    if (!(section && collapsed.has(section))) lines.push({ kind: "row", row, ref });
  }

  closeSection(section);
  return lines;
}

/** One typed value on its way to the database. */
interface Pending {
  rowId: string;
  cell: EditableCell;
  text: string;
}

export function BillGrid({
  projectId,
  runId,
  rows,
  frozen,
}: {
  projectId: string;
  runId: string;
  rows: readonly BillRow[];
  /** A signed bill has nothing to correct: the cells become text and the controls go. */
  frozen: boolean;
}) {
  const router = useRouter();
  const grid = useRef<HTMLTableSectionElement>(null);

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [refusals, setRefusals] = useState<{ at: string; reason: string }[]>([]);
  const [wanted, setWanted] = useState<{ rowId: string; cell: string; nth: number } | null>(null);
  const [busy, act] = useTransition();

  /**
   * What has been typed and not yet written back – round-2 testing's first report.
   *
   * A commit cleared the cell's draft and showed the *stored* value until the refreshed rows landed,
   * so for about a second the figure a tester had just typed was replaced by the one it replaced,
   * and the amount beside it sat unchanged with nothing to say it was being worked out. It read as
   * the edit being dropped. Optimistic state holds the typed text in the cell and marks the row's
   * amount as calculating until the transition – the write and the refresh – has settled; a second
   * edit made in that window is queued on top rather than lost, which is what the reducer form is
   * for. The amount itself is still never computed here (see the note at the top of this file).
   */
  const [pending, addPending] = useOptimistic<readonly Pending[], Pending>([], (state, next) => [
    ...state.filter((p) => !(p.rowId === next.rowId && p.cell === next.cell)),
    next,
  ]);

  const lines = layout(rows, collapsed, frozen);
  const priced = pricedRows(rows);
  const total = billTotal(rows, frozen);

  const fold = (headingId: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(headingId)) next.add(headingId);
      return next;
    });

  /**
   * Take the reader to a cell somebody else asked for — the sign-off gate's list, so far.
   *
   * It has to live in the grid, and that is the whole reason it is an event rather than a prop the
   * panel could call. A row inside a folded section **is not in the DOM**: a `querySelector` from
   * outside comes back null, and the reader presses a button that looks live and does nothing. Only
   * the grid holds the fold state, so only the grid can honour the request.
   *
   * It opens the one section the row is in, not all of them — a reader who folded the other seven
   * meant it — and focuses on the render *after* that unfold, which is why the target is state and
   * not a `requestAnimationFrame`. `nth` is what makes asking for the same cell twice work.
   */
  useEffect(() => {
    const ask = (event: Event) => {
      const { rowId, cell } = (event as CustomEvent<{ rowId: string; cell: string }>).detail;
      const parent = rows.find((r) => r.id === rowId)?.parentId;

      if (parent) {
        setCollapsed((current) => {
          if (!current.has(parent)) return current;
          const next = new Set(current);
          next.delete(parent);
          return next;
        });
      }

      setWanted((current) => ({ rowId, cell, nth: (current?.nth ?? 0) + 1 }));
    };

    window.addEventListener("bill:reveal", ask);
    return () => window.removeEventListener("bill:reveal", ask);
  }, [rows]);

  useEffect(() => {
    if (!wanted) return;

    const target = grid.current?.querySelector(
      `[data-row="${wanted.rowId}"] [data-cell="${wanted.cell}"]`,
    );
    if (!(target instanceof HTMLElement)) return;

    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.focus({ preventScroll: true });
  }, [wanted]);

  /**
   * Move the focus one cell, by the grid's own coordinates.
   *
   * The inputs carry `data-r` and `data-c` and are queried rather than held in a ref array: rows
   * appear and disappear as a paste appends and a section folds, and an index into a stale array is
   * how a keystroke lands in the wrong row.
   */
  function move(from: HTMLElement, downBy: number, acrossBy: number) {
    const r = Number(from.dataset.r);
    const c = Number(from.dataset.c);

    const target =
      grid.current?.querySelector<HTMLInputElement>(
        `[data-r="${r + downBy}"][data-c="${c + acrossBy}"]`,
      ) ??
      // A heading has only its description, so moving down a column can land on a row that has no
      // such cell. Falling back to the first cell of that row keeps the journey continuous rather
      // than swallowing the keystroke.
      grid.current?.querySelector<HTMLInputElement>(`[data-r="${r + downBy}"][data-c="0"]`);

    target?.focus();
    target?.select();
  }

  const save = (itemId: string, cell: EditableCell, value: string) =>
    act(async () => {
      addPending({ rowId: itemId, cell, text: value });
      const outcome = await correctCell(projectId, runId, itemId, cell, value);
      if (!outcome.ok) {
        setRefusals([{ at: CELL_LABEL[cell], reason: outcome.reason }]);
        return;
      }
      setRefusals([]);
      router.refresh();
    });

  /**
   * A block out of a spreadsheet — §7.4's requirement, and the one that decides adoption.
   *
   * A paste with no tab and no newline is a single value and is left to the browser: it lands in the
   * cell, and the ordinary commit-on-blur writes it. Anything two-dimensional is intercepted and
   * sent whole, so forty rows are one round trip rather than forty.
   */
  function paste(
    event: React.ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    itemId: string,
    cell: EditableCell,
  ) {
    const text = event.clipboardData.getData("text/plain");
    if (!text.includes("\t") && !text.includes("\n")) return;

    event.preventDefault();

    const block = text
      .replace(/\r/g, "")
      .split("\n")
      // A spreadsheet's copy ends in a newline. Without this every paste would append an empty row.
      .filter((line, i, all) => line !== "" || i < all.length - 1)
      .map((line) => line.split("\t"));

    act(async () => {
      const outcome = await pasteBlock(projectId, runId, itemId, cell, block);
      if (!outcome.ok) {
        setRefusals([{ at: "the paste", reason: outcome.reason }]);
        return;
      }
      setRefusals(outcome.refusals);
      router.refresh();
    });
  }

  return (
    <div data-region="bill">
      {/*
        What could not be read, named. §5: a refused figure is one number a person has to settle, on
        a screen that says which — and never a guess written into a column of four thousand.
      */}
      {refusals.length > 0 && (
        <div role="alert" className="border-b border-[var(--n-100)] bg-[var(--warn-50)] px-4 py-2.5">
          <p className="t-sm font-medium text-[var(--warn-700)]">
            {refusals.length === 1 ? "One figure was" : `${refusals.length} figures were`} not
            written, because {refusals.length === 1 ? "it" : "they"} could not be read with certainty:
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {refusals.map((refusal) => (
              <li key={refusal.at} className="t-sm text-[var(--n-700)]">
                <span className="font-medium">{refusal.at}</span> — {refusal.reason}
              </li>
            ))}
          </ul>
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
            <col className="w-[64px]" />
            <col />
            <col className="w-[56px]" />
            <col className="w-[104px]" />
            <col className="w-[96px]" />
            <col className="w-[112px]" />
            {!frozen && <col className="w-[64px]" />}
          </colgroup>

          {/* §7.4 — 12px, 600, uppercase, 0.03em. The currency lives in the header, never in a cell. */}
          <thead>
            <tr className="border-b border-[var(--n-200)]">
              {[
                ["Item ref", false],
                ["Description", false],
                ["Unit", false],
                ["Qty", true],
                ["Rate (R)", true],
                ["Amount (R)", true],
                ...(frozen ? [] : [["", false] as [string, boolean]]),
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

          <tbody ref={grid}>
            {lines.map((line, index) =>
              line.kind === "subtotal" ? (
                /* §7.4 — a subtotal row: strong top border, tinted, no zebra anywhere. */
                <tr
                  key={`sub-${line.headingId}`}
                  data-subtotal={line.headingId}
                  className="border-t-2 border-[var(--n-300)] bg-[var(--n-50)]"
                >
                  <td />
                  <td colSpan={4} className="t-sm px-3 py-1.5 text-right font-semibold text-[var(--n-800)]">
                    {line.label} — {line.items} {line.items === 1 ? "item" : "items"}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <MoneyCell minorUnits={line.total} bold />
                  </td>
                  {!frozen && <td />}
                </tr>
              ) : (
                <Row
                  key={line.row.id}
                  row={line.row}
                  reference={line.ref}
                  index={index}
                  projectId={projectId}
                  frozen={frozen}
                  busy={busy}
                  pending={pending.filter((p) => p.rowId === line.row.id)}
                  collapsed={collapsed.has(line.row.id)}
                  onFold={() => fold(line.row.id)}
                  onSave={save}
                  onPaste={paste}
                  onMove={move}
                  onStrike={(omitted) =>
                    act(async () => {
                      const outcome = await omitRow(projectId, runId, line.row.id, omitted);
                      if (!outcome.ok) setRefusals([{ at: "the row", reason: outcome.reason }]);
                      router.refresh();
                    })
                  }
                />
              ),
            )}
          </tbody>

          {/* §7.4 — the totals footer: 40px, tinted, strong top border. Derived, never stored. */}
          <tfoot>
            <tr className="total-row">
              <td />
              <td colSpan={4} className="t-base px-3 py-3 text-right font-semibold text-[var(--n-800)]">
                Bill total — {priced.length} {priced.length === 1 ? "item" : "items"}
              </td>
              <td data-region="bill-total" className="px-3 py-3 text-right">
                <MoneyCell minorUnits={total.toString()} bold />
              </td>
              {!frozen && <td />}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function Row({
  row,
  reference,
  index,
  projectId,
  frozen,
  busy,
  pending,
  collapsed,
  onFold,
  onSave,
  onPaste,
  onMove,
  onStrike,
}: {
  row: BillRow;
  /** This row's cells that are on their way to the database. */
  pending: readonly Pending[];
  /** Positional — see `layout`. `item_ref` wins the moment anything writes one. */
  reference: string;
  index: number;
  projectId: string;
  frozen: boolean;
  busy: boolean;
  collapsed: boolean;
  onFold: () => void;
  onSave: (itemId: string, cell: EditableCell, value: string) => void;
  onPaste: (
    event: React.ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    itemId: string,
    cell: EditableCell,
  ) => void;
  onMove: (from: HTMLElement, downBy: number, acrossBy: number) => void;
  onStrike: (omitted: boolean) => void;
}) {
  const heading = row.rowType === "heading";
  const struck = row.omitted !== null;
  const cells: readonly EditableCell[] = heading ? ["description"] : EDITABLE_CELLS;
  // A quantity or a rate in flight means the amount beside them is about to change.
  const calculating = pending.some((p) => p.cell === "quantity" || p.cell === "rate");

  return (
    <tr
      data-row={row.id}
      data-type={row.rowType}
      data-saving={pending.length > 0 ? "true" : undefined}
      data-omitted={struck ? "true" : undefined}
      className={`border-b border-[var(--n-100)] align-top transition-colors last:border-0 hover:bg-[var(--n-25)] ${
        heading ? "bg-[var(--n-25)]" : ""
      } ${struck ? "opacity-55" : ""}`}
      style={{ transitionDuration: "60ms" }}
    >
      <td className="t-sm px-3 py-1.5 text-[var(--n-500)]">
        {heading ? (
          <button
            type="button"
            onClick={onFold}
            aria-expanded={!collapsed}
            className="flex items-center gap-1 text-[var(--n-600)]"
            title={collapsed ? "Show this section" : "Fold this section"}
          >
            {collapsed ? (
              <ChevronRight aria-hidden size={13} strokeWidth={2} />
            ) : (
              <ChevronDown aria-hidden size={13} strokeWidth={2} />
            )}
            {/* The section's own number, so the reference under it reads as 1.1 rather than as a
                decimal that starts from nowhere. */}
            <span className="num font-semibold">{row.itemRef ?? reference}</span>
          </button>
        ) : (
          <span className="num">{row.itemRef ?? reference}</span>
        )}
      </td>

      {cells.map((cell, column) => (
        <Cell
          key={cell}
          row={row}
          cell={cell}
          r={index}
          c={column}
          heading={heading}
          struck={struck}
          frozen={frozen}
          projectId={projectId}
          pending={pending.find((p) => p.cell === cell)?.text ?? null}
          onSave={onSave}
          onPaste={onPaste}
          onMove={onMove}
          /* A heading spans the columns it has no figures for — §4.7, bold and without quantities.
             Five, not four: description through amount. At four the row was a column short of the
             table and its trailing control sat under Amount, which is a misalignment a reader reads
             as a figure being in the wrong place. */
          span={heading ? 5 : 1}
        />
      ))}

      {!heading && (
        <td className="px-3 py-1.5 text-right" aria-busy={calculating || undefined}>
          {calculating ? (
            /* The figure is being worked out in the database; the old one must not sit here
               looking current. Said in words, not only by dimming – §7.1 #5. */
            <span data-region="calculating" className="t-sm text-[var(--n-500)]">
              calculating…
            </span>
          ) : (
            <MoneyCell minorUnits={frozen ? (row.output?.amount ?? null) : row.amount} />
          )}
          {/*
            Where the quantity came from — §6.3. A figure the agent read, one a person typed and one
            pasted out of a spreadsheet are three different claims, and only this says which.
          */}
          {!heading && row.quantitySource !== "ai_derived" && (
            <span className="t-xs mt-0.5 block text-[var(--n-400)]">
              {row.quantitySource === "imported" ? "pasted" : row.quantitySource === "takeoff" ? "measured" : "by hand"}
            </span>
          )}
        </td>
      )}

      {!frozen && heading && <td />}

      {/*
        Striking is for items. A heading carries no amount, so omitting one would remove a word and
        leave every row under it in the bill — a control that appears to do something and does not.
      */}
      {!frozen && !heading && (
        <td className="px-3 py-1.5 text-right">
          <button
            type="button"
            disabled={busy}
            onClick={() => onStrike(!struck)}
            title={
              struck
                ? "Put this row back into the bill"
                : "Strike this row out — it stays on the record, out of every total"
            }
            className="t-sm inline-flex cursor-pointer items-center gap-1 text-[var(--n-500)] underline underline-offset-2 disabled:cursor-not-allowed disabled:text-[var(--n-300)]"
          >
            {struck ? (
              <>
                <RotateCcw aria-hidden size={11} strokeWidth={2} /> Restore
              </>
            ) : (
              <>
                <Strikethrough aria-hidden size={11} strokeWidth={2} /> Omit
              </>
            )}
          </button>
        </td>
      )}
    </tr>
  );
}

function Cell({
  row,
  cell,
  r,
  c,
  heading,
  struck,
  frozen,
  span,
  projectId,
  pending,
  onSave,
  onPaste,
  onMove,
}: {
  row: BillRow;
  cell: EditableCell;
  r: number;
  c: number;
  heading: boolean;
  struck: boolean;
  frozen: boolean;
  span: number;
  projectId: string;
  /** What was typed here and is still being written, shown in place of the stored value. */
  pending: string | null;
  onSave: (itemId: string, cell: EditableCell, value: string) => void;
  onPaste: (
    event: React.ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    itemId: string,
    cell: EditableCell,
  ) => void;
  onMove: (from: HTMLElement, downBy: number, acrossBy: number) => void;
}) {
  const committed = cellText(row, cell);
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? pending ?? committed;

  /** Both cell shapes commit the same way, so the type is the pair rather than one of them. */
  type CellElement = HTMLInputElement | HTMLTextAreaElement;

  const commit = (element: CellElement) => {
    if (draft === null || draft === committed) {
      setDraft(null);
      return;
    }
    onSave(row.id, cell, draft);
    setDraft(null);
    element.blur();
  };

  /**
   * The keyboard map — §7.4, and shared by the input and the textarea.
   *
   * Enter commits and descends; Escape drops the edit; up and down move rows. **Left and right move
   * the caret until it runs out and only then move the cell** — binding them to navigation outright
   * would make a description impossible to edit, and ignoring them would make a numeric column
   * slower to cross than Excel. Tab is left to the browser: the cells are in row-major order in the
   * DOM, so its default behaviour already is "next cell, wrapping rows".
   */
  const keys = (event: React.KeyboardEvent<CellElement>) => {
    const element = event.currentTarget;

    if (event.key === "Enter") {
      event.preventDefault();
      commit(element);
      onMove(element, 1, 0);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setDraft(null);
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      commit(element);
      onMove(element, event.key === "ArrowDown" ? 1 : -1, 0);
      return;
    }

    if (event.key === "ArrowLeft" && element.selectionStart === 0) {
      event.preventDefault();
      commit(element);
      onMove(element, 0, -1);
      return;
    }

    if (event.key === "ArrowRight" && element.selectionEnd === element.value.length) {
      event.preventDefault();
      commit(element);
      onMove(element, 0, 1);
    }
  };

  // Only where the agent proposed something – a row measured in Take-off or added by hand has no
  // agent answer to show under it, and "agent said nothing" on every cell of it is noise.
  const proposedAnything = [row.proposed.description, row.proposed.unit, row.proposed.quantity, row.proposed.rate].some((v) => v !== null);
  const replaced = proposedAnything ? proposedText(row, cell) : null;

  /*
    An empty measure column advertises itself as a box. This is the one change on this screen that
    somebody asked for in as many words.

    Every cell in this grid is already an input — transparent border, transparent ground, because a
    dense bill that draws 240 boxes is a form and not a bill. That trade only costs anything on an
    *empty* cell: "measure" and "price" in grey read as a status the platform is reporting, not a
    field the reader has been handed, and a QS looking at a freshly drafted bill could not tell that
    clicking there would do anything at all. Which is exactly what happened.

    So the box appears only where there is nothing yet and something is wanted — the same cells the
    sign-off gate below is counting — and it goes the instant a figure is typed. Amber, because that
    is what amber means everywhere else here: look at this one.

    Measured against the white grid: border 3,55:1, placeholder 5,16:1, a typed value 10,35:1.
  */
  const wanted = !frozen && !heading && !struck && isNumeric(cell) && value.trim() === "";

  return (
    <td
      colSpan={span}
      className={`px-3 py-1.5 ${isNumeric(cell) ? "text-right" : ""} ${
        heading ? "font-semibold text-[var(--n-800)]" : ""
      }`}
    >
      {frozen ? (
        <span className={`${isNumeric(cell) ? "num" : ""} ${struck ? "line-through" : ""}`}>
          {frozenText(row, cell)}
        </span>
      ) : cell === "description" ? (
        /**
         * The description is a **textarea**, and every other cell is an input.
         *
         * A bill item is a sentence — "Strip footings in 25 MPa/19mm concrete to SANS 1200" — and an
         * `<input>` in this column clips it to "…250 micron waterproof membr". Measured on the first
         * screenshot of this grid. The description is the column a bill is read down, so it wraps
         * and the row grows to fit it, which is also why §7.4's 32px row height is a default here
         * rather than a rule.
         */
        <Description
          value={value}
          heading={heading}
          struck={struck}
          r={r}
          c={c}
          label={`${CELL_LABEL[cell]}, row ${r + 1}`}
          onChange={setDraft}
          onCommit={commit}
          onPaste={(event) => onPaste(event, row.id, cell)}
          onKey={keys}
        />
      ) : (
        <input
          data-r={r}
          data-c={c}
          data-cell={cell}
          aria-label={`${CELL_LABEL[cell]}, row ${r + 1}`}
          value={value}
          placeholder={placeholderFor(row, cell)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => commit(event.currentTarget)}
          /*
            Select on focus, so clicking a cell and retyping replaces rather than splices.
            Found on the pricing screen and fixed in both, because these are the same money cells:
            §7.7's thousands separator is a non-breaking space, Chrome's triple-click selection will
            not cross one, and `1 900,00` typed over `1 500,00` became `11 900,00500,00`. The reader
            refuses that now; this is what stops it being produced. `move()` above already selects
            on keyboard arrival, so this makes the mouse agree with the keyboard.
          */
          onFocus={(event) => event.currentTarget.select()}
          onPaste={(event) => onPaste(event, row.id, cell)}
          onKeyDown={keys}
          /*
            Round-2 testing: "the field doesn't look like a typing box". A dense bill cannot draw
            240 boxes, but a cell can say it is one the moment the pointer is over it – a border and
            a text cursor on hover, the accent border on focus – so nobody has to click to find out.
          */
          className={`t-base w-full cursor-text rounded-[var(--r-sm)] border px-1 py-0.5 outline-none hover:border-[var(--n-300)] hover:bg-[var(--n-0)] focus:border-[var(--a-500)] focus:bg-[var(--n-0)] ${
            wanted
              ? "border-[var(--warn-500)] bg-[var(--warn-50)] placeholder:text-[var(--warn-700)]"
              : "border-transparent bg-transparent"
          } ${isNumeric(cell) ? "num text-right" : ""} ${heading ? "font-semibold" : ""} ${
            struck ? "line-through" : ""
          }`}
        />
      )}

      {/*
        The agent's own answer, still visible under a correction. It is the most reviewable fact on
        the row and the whole reason `proposed` and `overrides` are two maps rather than one value.
      */}
      {replaced !== null && (
        <span className="t-xs mt-0.5 block text-[var(--n-500)]">agent said {replaced}</span>
      )}

      {/* The passage this row was read from, under the description — §1.3.2, and see the note above. */}
      {cell === "description" && (row.citation || row.proposed.note) && (
        <div className="mt-1">
          <Citation citation={row.citation} note={row.proposed.note} projectId={projectId} />
          {row.citation && row.proposed.note && (
            <span className="t-sm mt-0.5 block text-[var(--warn-700)]">{row.proposed.note}</span>
          )}
        </div>
      )}
    </td>
  );
}

/**
 * The description cell — a textarea that is the height of its own text.
 *
 * ── Why not an input, and why not a fixed number of rows ──────────────────────────────────
 *
 * A bill item is a sentence, and this is the column the bill is read down. An `<input>` clips it;
 * a `rows={2}` textarea clips the long ones and leaves a hole under the short ones; a textarea that
 * scrolls inside its own cell is the clipping problem again with a scrollbar drawn on it.
 *
 * The height is set twice on purpose. The ref callback runs before the first paint, so a description
 * never appears at the wrong height and then jumps; the effect catches the value changing underneath
 * — a paste filling this row, or the server sending back what somebody typed — where the ref
 * callback does not run again because it is the same element.
 */
function Description({
  value,
  heading,
  struck,
  r,
  c,
  label,
  onChange,
  onCommit,
  onPaste,
  onKey,
}: {
  value: string;
  heading: boolean;
  struck: boolean;
  r: number;
  c: number;
  label: string;
  onChange: (value: string) => void;
  onCommit: (element: HTMLTextAreaElement) => void;
  onPaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onKey: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const box = useRef<HTMLTextAreaElement | null>(null);

  const fit = useCallback((element: HTMLTextAreaElement | null) => {
    if (!element) return;

    // Collapse first: `scrollHeight` never shrinks below the height already set, so a description
    // that got shorter would keep the height of the longer one.
    element.style.height = "0px";

    /**
     * The borders have to be added back, and forgetting them is a four-pixel clip.
     *
     * `height` under `box-sizing: border-box` sets the **border** box, while `scrollHeight` measures
     * content plus padding. Setting one to the other leaves the element exactly its borders too
     * short, which is enough to cut the descenders off the last line — measured, and the reason this
     * comment exists rather than a bare assignment.
     */
    const borders = element.offsetHeight - element.clientHeight;
    element.style.height = `${element.scrollHeight + borders}px`;
  }, []);

  useEffect(() => fit(box.current), [value, fit]);

  return (
    <textarea
      ref={(element) => {
        box.current = element;
        fit(element);
      }}
      data-r={r}
      data-c={c}
      data-cell="description"
      aria-label={label}
      rows={1}
      value={value}
      onChange={(event) => {
        fit(event.currentTarget);
        onChange(event.target.value);
      }}
      onBlur={(event) => onCommit(event.currentTarget)}
      onPaste={onPaste}
      onKeyDown={onKey}
      className={`t-base w-full cursor-text resize-none overflow-hidden rounded-[var(--r-sm)] border border-transparent bg-transparent px-1 py-0.5 outline-none hover:border-[var(--n-300)] hover:bg-[var(--n-0)] focus:border-[var(--a-500)] focus:bg-[var(--n-0)] ${
        heading ? "font-semibold" : ""
      } ${struck ? "line-through" : ""}`}
    />
  );
}

/** A signed row renders `output_*`, not `working` — the record of what was signed, not a rerun of it. */
function frozenText(row: BillRow, cell: EditableCell): string {
  const output = row.output;
  if (!output) return cellText(row, cell);

  switch (cell) {
    case "description":
      return output.description ?? "";
    case "unit":
      return output.unit ?? "";
    case "quantity":
      return output.quantity === null ? "" : formatQuantity(parseQuantity(output.quantity));
    case "rate":
      return output.rate === null ? "" : formatRate(rateOf(output.rate));
  }
}

const rateOf = (wire: WireRate) => rate(BigInt(wire.value), wire.precision);

/**
 * What an empty cell says about itself.
 *
 * A quantity the documents never stated is the normal case for a bill drafted from a specification —
 * the work is described, the measure is the QS's. Saying so in the cell is what stops it reading as
 * a failure of the agent.
 */
function placeholderFor(row: BillRow, cell: EditableCell): string {
  if (cell === "quantity" && row.proposed.quantityText === null && row.proposed.description !== null) {
    return "measure";
  }
  if (cell === "rate" && row.proposed.rateText === null && row.proposed.description !== null) {
    return "price";
  }
  return "";
}
