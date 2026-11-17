/**
 * Drafting a bill from the corpus, reviewing it, and signing it — PLATFORM.md §1.3.1, §1.3.3, §4.7.
 *
 * The sibling of `run-panel.tsx`, and deliberately its mirror: the same gate, the same words about
 * an outage, the same "an earlier run is signed" notice, the same one signature at the end. A QS who
 * has reviewed a feasibility run should recognise every part of this except the middle.
 *
 * The middle is a grid, because what this step establishes is rows. Everything about that is in
 * `bill-grid.tsx`; what is here is the run around it.
 */

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CopyPlus, Lock, PenLine, Play, Plus, Sparkles } from "lucide-react";

import { formatDate } from "@/lib/dates";
import { BillGrid } from "@/components/agent/bill-grid";
import { Citation } from "@/components/documents/citation";
import { addRow, reviseBill, signOffBill, startBill } from "@/app/(app)/projects/[id]/bill-actions";
import { MeasureDrawings } from "@/components/takeoff/measure-drawings";
import {
  billTotal,
  blockingRows,
  pricedRows,
  streamBill,
  workingRow,
  type BillEvent,
  type ItemResult,
  type PersistedBill,
} from "@/lib/agent/bill";
import { runState } from "@/lib/agent/run";
import { CriterionUpload } from "@/components/criteria/criterion-upload";
import type { BlockingInput } from "@/lib/criteria-status";
import { formatMoney } from "@/domain/money";

/** §7.7's date, shared — see `lib/dates.ts` for why seven copies of it was a problem. */
const on = formatDate;

export function BillPanel({
  projectId,
  module,
  heading,
  blurb,
  blockedBy,
  pricedSource,
  drawings = [],
  waitingOn,
  bill,
  signature,
  signer,
}: {
  projectId: string;
  module: string;
  heading: string;
  blurb: string;
  /**
   * Required inputs still missing, each with the kind it files under. Non-empty means the run
   * cannot start — and every one of them can be cleared from this panel (§1.3.3).
   */
  blockedBy: readonly BlockingInput[];
  /**
   * Whether a priced source for rates is already on file.
   *
   * Advisory, so it never reaches `blockedBy` — and the sign-off gate needs it anyway. See the note
   * on the gate's last line: with one filed, "file the priced source" is advice to go and repeat
   * work that is done.
   */
  pricedSource: boolean;
  /** Drawings filed on the project – measured by the take-off agent rather than read (§1.3.2). */
  drawings?: readonly { id: string; name: string }[];
  /** Upstream steps whose output is not signed. Nothing filed here clears it (§1.3.3). */
  waitingOn: readonly string[];
  bill: PersistedBill | null;
  signature: { runId: string; by: string; at: string } | null;
  signer: string;
}) {
  const router = useRouter();

  const [streaming, setStreaming] = useState(false);
  const [live, setLive] = useState<ItemResult[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [summary, setSummary] = useState<BillEvent | null>(null);
  const [settling, startSettling] = useTransition();

  async function start() {
    setStreaming(true);
    setLive([]);
    setFailure(null);
    setSummary(null);

    try {
      for await (const event of streamBill(projectId, module)) {
        if (event.type === "error") {
          // §1.3 — an outage is surfaced, never a silent gap. The rows already read stay on screen;
          // they were grounded before it stopped.
          setFailure(event.error ?? "The run did not finish.");
          break;
        }
        if (event.type === "item" && event.item) setLive((current) => [...current, event.item!]);
        if (event.type === "done") setSummary(event);
      }
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "The run did not finish.");
    } finally {
      setStreaming(false);
      // The server holds everything this stream reported, plus the ids the grid's controls act on.
      startSettling(() => router.refresh());
    }
  }

  const blocked = blockedBy.length > 0 || waitingOn.length > 0;
  const state = bill ? runState(bill) : null;
  const signed = state === "signed";
  const showLive = streaming || settling;

  return (
    <section data-region="run" className="rounded-[var(--r-lg)] border border-[var(--n-200)]">
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--n-100)] px-4 py-3">
        <Sparkles aria-hidden size={16} strokeWidth={1.75} className="shrink-0 text-[var(--a-500)]" />
        <div className="min-w-0 flex-1">
          <h2 className="t-base font-semibold text-[var(--n-800)]">{heading}</h2>
          <p className="t-sm mt-0.5 text-[var(--n-500)]">{blurb}</p>
        </div>

        {/*
          The way in that needs no document (audit C1). Only offered while there is no bill: once
          one exists, its rows are added in the grid below and this would be a second button for it.
        */}
        {!bill && !streaming && <StartByHand projectId={projectId} module={module} />}

        <button
          type="button"
          disabled={blocked || streaming || state === "running"}
          onClick={start}
          title={
            waitingOn.length > 0
              ? `Waiting on ${waitingOn.join(", ")}`
              : blocked
                ? `Still needed: ${blockedBy.map((input) => input.label).join(", ")}`
                : undefined
          }
          className="t-base flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--a-500)] px-3 font-medium text-white transition-colors hover:bg-[var(--a-600)] disabled:cursor-not-allowed disabled:opacity-50"
          style={{ transitionDuration: "var(--m-fast)" }}
        >
          <Play aria-hidden size={13} strokeWidth={2.5} />
          {streaming ? "Reading…" : bill ? "Draft again" : "Draft the bill"}
        </button>
      </header>

      {waitingOn.length > 0 && (
        <p className="t-sm border-b border-[var(--n-100)] bg-[var(--warn-50)]/40 px-4 py-2.5 text-[var(--warn-700)]">
          Waiting on {waitingOn.join(", ")} to be signed off. This step reads figures from{" "}
          {waitingOn.length === 1 ? "it" : "them"}, and nothing filed here will clear it.
        </p>
      )}

      {/*
        The refusal **offers** what would clear it, rather than naming it and leaving.

        A reader who has just been told to file a project brief is a reader holding a project brief.
        Naming the document and putting the only way to file it further down the page is the v3
        lesson — "a reader who discovers they need a document must be able to file it *there*" —
        one screen further in than v3 found it.

        This is the same `CriterionUpload` the readiness row uses, bound to the same criterion and
        filing under the same kind, so §2.5 holds: one act, offered where the reader is. What that
        rule forbids is two *ways* to file, which is why the project-wide panel with a kind select
        was removed.

        The upstream banner above deliberately has none of this. **Nothing filed here clears an
        unsigned upstream**, and putting an upload under that sentence would be the exact confusion
        §1.3.3 keeps the two blockers apart to prevent.
      */}
      {waitingOn.length === 0 && blockedBy.length > 0 && (
        <div data-region="blocked" className="border-b border-[var(--n-100)] bg-[var(--warn-50)]/40 px-4 py-2.5">
          <p className="t-sm text-[var(--warn-700)]">
            To draft the bill from documents, file {blockedBy.length === 1 ? "this" : "these"} first.
            Or start the bill by hand and type, paste or measure its rows – no document needed.
          </p>

          <ul className="mt-2 flex flex-col gap-1.5">
            {blockedBy.map((input) => (
              <li key={input.label} className="flex flex-wrap items-center gap-3">
                <span className="t-sm min-w-0 flex-1 text-[var(--n-700)]">{input.label}</span>
                {input.kind ? (
                  <CriterionUpload
                    projectId={projectId}
                    kind={input.kind}
                    label={input.label}
                    compact
                  />
                ) : (
                  // No accepted kind means nothing to press — said rather than shown as a dead
                  // button, which is what these were before they did anything.
                  <span className="t-sm text-[var(--n-500)]">no document kind accepts this</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(failure ?? (!showLive && bill?.error)) && (
        <p role="alert" className="t-sm border-b border-[var(--n-100)] px-4 py-2.5 text-[var(--err-700)]">
          {failure ?? bill?.error}
          <span className="mt-1 block text-[var(--n-600)]">
            The rows below were read before it stopped. The rest of the corpus was not asked — they
            are absent from this run, not from the documents.
          </span>
        </p>
      )}

      {!showLive && state === "stalled" && (
        <p role="alert" className="t-sm border-b border-[var(--n-100)] px-4 py-2.5 text-[var(--warn-700)]">
          This run stopped without finishing or reporting why — it was started on{" "}
          {on(bill!.startedAt)} and nothing has been written to it since. The rows below are what it
          managed to read. Run it again.
        </p>
      )}

      {!showLive && state === "running" && (
        <div className="t-sm flex flex-wrap items-center gap-3 border-b border-[var(--n-100)] px-4 py-2.5 text-[var(--n-600)]">
          <span>This run is in progress — started {on(bill!.startedAt)}, elsewhere or before this page was loaded.</span>
          <button
            type="button"
            onClick={() => router.refresh()}
            className="t-sm h-7 rounded-[var(--r-md)] border border-[var(--n-200)] px-2 text-[var(--n-600)] transition-colors hover:border-[var(--n-300)] hover:bg-[var(--n-50)]"
            style={{ transitionDuration: "var(--m-fast)" }}
          >
            Check again
          </button>
        </div>
      )}

      {signature && signature.runId !== bill?.id && (
        <p className="t-sm border-b border-[var(--n-100)] bg-[var(--ok-50)]/40 px-4 py-2.5 text-[var(--n-700)]">
          An earlier draft of this bill is signed off — by {signature.by} on {on(signature.at)}.
          Those are the rows the next step reads. The bill below replaces them only when it is signed.
        </p>
      )}

      {!signed && drawings.length > 0 && <MeasureDrawings projectId={projectId} drawings={drawings} measured={Boolean(bill?.rows.some((r) => r.quantitySource === "takeoff"))} />}

      {!showLive && !bill && <WhatItDoes />}

      {showLive ? (
        <LiveRows rows={live} projectId={projectId} streaming={streaming} summary={summary} />
      ) : (
        bill && (
          <Drafted
            bill={bill}
            projectId={projectId}
            module={module}
            signer={signer}
            pricedSource={pricedSource}
            frozen={signed}
            superseding={signature !== null && signature.runId !== bill.id}
          />
        )
      )}
    </section>
  );
}

/** Open an empty bill to fill by hand (audit C1). Refusals in words, beside the button. */
function StartByHand({ projectId, module }: { projectId: string; module: string }) {
  const router = useRouter();
  const [pending, act] = useTransition();
  const [refusal, setRefusal] = useState<string | null>(null);

  return (
    <div className="flex shrink-0 flex-col items-end">
      <button
        type="button"
        data-action="start-bill"
        disabled={pending}
        onClick={() =>
          act(async () => {
            const outcome = await startBill(projectId, module);
            setRefusal(outcome.ok ? null : outcome.reason);
            router.refresh();
          })
        }
        className="t-base flex h-8 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--n-300)] bg-[var(--n-0)] px-3 font-medium text-[var(--n-700)] transition-colors hover:border-[var(--n-400)] hover:bg-[var(--n-50)] disabled:cursor-not-allowed disabled:opacity-50"
        style={{ transitionDuration: "var(--m-fast)" }}
      >
        <PenLine aria-hidden size={13} strokeWidth={2} />
        {pending ? "Opening…" : "Start by hand"}
      </button>
      {refusal && (
        <p role="alert" className="t-sm mt-1 max-w-[40ch] text-right text-[var(--err-700)]">
          {refusal}
        </p>
      )}
    </div>
  );
}

/**
 * What this step establishes, before it is run — the reader's half of §1.3's "no blank forms".
 *
 * A field run lists its figures here. A bill cannot: how many rows there are is what the run finds
 * out. So what is promised instead is the *shape* of a row and, more importantly, the one thing a QS
 * needs to know before pressing the button — that the quantities are theirs.
 */
function WhatItDoes() {
  return (
    <div data-region="rubric" className="border-b border-[var(--n-100)] px-4 py-3">
      <p className="t-base font-medium text-[var(--n-800)]">What this step establishes</p>
      <p className="t-sm mt-1 max-w-[85ch] text-[var(--n-600)]">
        Every item of work the filed documents describe, as a bill row: a description, the unit it is
        measured in, a quantity and a rate — each with the passage it was read from. Sections come
        from the way the documents group the work.
      </p>
      <p className="t-sm mt-2 max-w-[85ch] text-[var(--n-600)]">
        <span className="font-medium text-[var(--n-800)]">
          A quantity the documents do not state is left empty for you to measure.
        </span>{" "}
        It is never guessed and never nought — an item nobody has measured and an item measured at
        zero are different facts, and the signature is refused until every row has both figures.
      </p>
    </div>
  );
}

/** What the stream is saying, while it is saying it. Read-only: these rows have no id yet. */
function LiveRows({
  rows,
  projectId,
  streaming,
  summary,
}: {
  rows: readonly ItemResult[];
  projectId: string;
  streaming: boolean;
  summary: BillEvent | null;
}) {
  if (rows.length === 0) {
    if (streaming) {
      return <p className="t-sm px-4 py-3 text-[var(--n-500)]">Reading the filed documents…</p>;
    }

    // A run that finished having found nothing. Said plainly, with what it read, because an empty
    // grid on its own reads as a broken agent rather than as a corpus that describes no work.
    return summary ? (
      <p className="t-sm px-4 py-3 text-[var(--n-600)]">
        Nothing in the {summary.read ?? 0} passages read describes an item of measurable work. Add
        rows by hand below, or file a specification or a priced bill and draft again.
      </p>
    ) : null;
  }

  return (
    <>
      <Tally
        items={rows.length}
        unpriced={rows.filter((row) => row.quantity === null || row.rate === null).length}
        discarded={summary?.discarded ?? 0}
        furniture={summary?.furniture ?? 0}
        spend={summary?.spend ?? null}
        aside="Nothing is signed off yet — the next step cannot read these until it is."
      />

      {rows.length > 0 && rows.every((row) => row.quantity === null) && <Unmeasured />}
      {summary?.unread && (
        <p data-region="bill-unread" className="t-sm border-b border-[var(--n-100)] px-4 py-2.5 text-[var(--n-600)]">
          The filed bill is longer than one draft reads, so its last pages were not read. Add their items by hand,
          or split the bill into two documents.
        </p>
      )}

      <table className="w-full table-fixed">
        <colgroup>
          <col className="w-[44%]" />
          <col className="w-[8%]" />
          <col className="w-[12%]" />
          <col className="w-[14%]" />
          <col className="w-[22%]" />
        </colgroup>
        <thead>
          <tr className="border-b border-[var(--n-200)]">
            {[
              ["Description", false],
              ["Unit", false],
              ["Qty", true],
              ["Rate (R)", true],
              ["Source", false],
            ].map(([label, numeric]) => (
              <th
                key={String(label)}
                scope="col"
                className={`t-sm px-3 py-2 font-semibold tracking-[0.03em] text-[var(--n-500)] uppercase ${
                  numeric ? "text-right" : "text-left"
                }`}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-[var(--n-100)] align-top last:border-0">
              <td className="px-3 py-1.5">
                {row.section && (
                  <span className="t-xs block text-[var(--n-500)] uppercase">{row.section}</span>
                )}
                <span className="text-[var(--n-800)]">{row.description}</span>
              </td>
              <td className="t-sm px-3 py-1.5 text-[var(--n-600)]">{row.unit ?? "—"}</td>
              <td className="num px-3 py-1.5 text-right text-[var(--n-800)]">
                {row.quantity ?? <span className="t-sm text-[var(--n-400)]">to measure</span>}
              </td>
              <td className="num px-3 py-1.5 text-right text-[var(--n-800)]">
                {row.rateText ?? <span className="t-sm text-[var(--n-400)]">to price</span>}
              </td>
              <td className="px-3 py-1.5 break-words">
                <Citation citation={row.citation} note={row.note} projectId={projectId} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {streaming && (
        <p className="t-sm px-4 py-3 text-[var(--n-500)]">Reading the filed documents…</p>
      )}
    </>
  );
}

/** The bill as the database has it: editable while it is a draft, frozen once it is signed. */
function Drafted({
  bill,
  projectId,
  module,
  signer,
  pricedSource,
  frozen,
  superseding,
}: {
  bill: PersistedBill;
  projectId: string;
  module: string;
  signer: string;
  pricedSource: boolean;
  frozen: boolean;
  superseding: boolean;
}) {
  const [pending, act] = useTransition();
  const [refusal, setRefusal] = useState<string | null>(null);
  const router = useRouter();

  /*
    The add controls, shown on an empty bill too. They used to sit after an early return for the
    empty case, so a draft that read nothing – and any bill with no rows – had no way to add one:
    the dead end the audit hit from Take-off (C1).
  */
  const addBar = !frozen && (
    <div className="flex flex-wrap items-center gap-2 border-t border-[var(--n-100)] px-4 py-2">
      {/*
        §1.3.3 — "manual entry never disappears: a QS must always be able to measure by hand, and
        a hand-entered value is simply an override with a human as its source."
      */}
      {(["item", "heading"] as const).map((rowType) => (
        <button
          key={rowType}
          type="button"
          data-action={rowType === "item" ? "add-item" : "add-section"}
          disabled={pending}
          onClick={() =>
            act(async () => {
              const outcome = await addRow(projectId, bill.id, rowType);
              setRefusal(outcome.ok ? null : outcome.reason);
              router.refresh();
            })
          }
          className="t-sm flex h-7 items-center gap-1 rounded-[var(--r-md)] border border-[var(--n-200)] px-2 text-[var(--n-600)] transition-colors hover:border-[var(--n-300)] hover:bg-[var(--n-50)] disabled:opacity-50"
          style={{ transitionDuration: "var(--m-fast)" }}
        >
          <Plus aria-hidden size={12} strokeWidth={2} />
          {rowType === "item" ? "Add an item" : "Add a section"}
        </button>
      ))}
      {bill.rows.length > 0 && (
        <span className="t-sm ml-auto text-[var(--n-500)]">
          Paste a block straight from a spreadsheet — it fills from the cell you paste into and
          adds rows if it runs past the end.
        </span>
      )}
      {refusal && (
        <p role="alert" className="t-sm w-full text-[var(--err-700)]">
          {refusal}
        </p>
      )}
    </div>
  );

  if (bill.rows.length === 0) {
    // An empty draft said in words – a blank panel reads as a broken agent, not as documents that
    // describe no work in text (a drawing set, most often). A bill opened by hand spent nothing,
    // so it has no spend, and it is told what to do rather than why the agent found nothing.
    return (
      <>
        <p data-region="bill-empty" className="t-sm px-4 py-3 text-[var(--n-600)]">
          {bill.spend === null
            ? "This bill has no rows yet. Add a section and its items below, or send measured items from Take-off."
            : "This draft has no rows: nothing in the filed text describes an item of measurable work. Drawings are measured rather than read – measure them above – add rows by hand below, or file a specification and draft again."}
        </p>
        {addBar}
      </>
    );
  }

  const priced = pricedRows(bill.rows);
  const unpriced = priced.filter((row) => {
    const working = workingRow(row);
    return working.quantity === null || working.rate === null;
  }).length;

  return (
    <>
      <Tally
        items={priced.length}
        unpriced={unpriced}
        // A correction is a change to what the agent proposed; a measured or hand-added row is not one.
        corrected={bill.rows.filter((row) => row.override && [row.proposed.description, row.proposed.unit, row.proposed.quantity, row.proposed.rate].some((v) => v !== null)).length}
        struck={bill.rows.filter((row) => row.omitted).length}
        discarded={0}
        furniture={0}
        spend={bill.spend}
        aside={
          frozen
            ? undefined
            : superseding
              ? "Not signed off — the next step still reads the bill that was."
              : "Nothing is signed off yet — the next step cannot read these until it is."
        }
      />

      {!frozen && priced.length > 0 && priced.every((row) => workingRow(row).quantity === null) && <Unmeasured />}

      <BillGrid projectId={projectId} runId={bill.id} rows={bill.rows} frozen={frozen} />

      {addBar}

      <SignOff
        bill={bill}
        projectId={projectId}
        module={module}
        signer={signer}
        pricedSource={pricedSource}
      />
    </>
  );
}

/**
 * The signature — §1.3.1, the act the whole chain hangs from.
 *
 * The gate is the bill's version of `blockingFields`: **no item may be signed without a quantity and
 * a rate**. Named rather than counted, and capped at three names with a count for the rest, because
 * a bill can have four hundred unpriced rows and a list of four hundred is not a refusal anybody can
 * act on.
 */
function SignOff({
  bill,
  projectId,
  module,
  signer,
  pricedSource,
}: {
  bill: PersistedBill;
  projectId: string;
  module: string;
  signer: string;
  pricedSource: boolean;
}) {
  const router = useRouter();
  const [pending, act] = useTransition();
  const [refusal, setRefusal] = useState<string | null>(null);

  if (bill.signedAt) {
    return (
      <div
        data-region="signature"
        className="flex flex-wrap items-center gap-2 border-t border-[var(--n-100)] bg-[var(--ok-50)]/40 px-4 py-3"
      >
        <Lock aria-hidden size={14} strokeWidth={2} className="shrink-0 text-[var(--ok-700)]" />
        <p className="t-sm min-w-0 flex-1 text-[var(--n-700)]">
          <span className="font-medium text-[var(--ok-700)]">Signed off</span> by {bill.signedBy} on{" "}
          {on(bill.signedAt)} — {pricedRows(bill.rows).length} items totalling{" "}
          <span className="num font-medium">R {formatMoney(billTotal(bill.rows, true))}</span>. These
          rows are frozen and the next step reads them.{" "}
          <span className="text-[var(--n-500)]">
            A revision starts from these figures rather than from the documents — nothing is
            measured twice, and this bill stays the one in force until the revision is signed.
          </span>
        </p>

        {/*
          The way onward from a signature, offered on the signature itself.

          Without it the only route was "Draft again" in the header, which re-reads the corpus and
          re-proposes every row — so a QS who had measured four hundred cells measured them again.
          Nothing about a frozen bill required that; it was simply the only button there was.
        */}
        <button
          type="button"
          data-action="revise-bill"
          disabled={pending}
          onClick={() =>
            act(async () => {
              const outcome = await reviseBill(projectId, module);
              setRefusal(outcome.ok ? null : outcome.reason);
              if (outcome.ok) router.refresh();
            })
          }
          title="Open a new draft carrying these figures forward"
          className="t-sm flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--n-300)] bg-[var(--n-0)] px-2.5 font-medium text-[var(--n-700)] transition-colors hover:border-[var(--n-400)] hover:bg-[var(--n-50)] disabled:cursor-not-allowed disabled:opacity-50"
          style={{ transitionDuration: "var(--m-fast)" }}
        >
          <CopyPlus aria-hidden size={13} strokeWidth={2} />
          {pending ? "Opening…" : "Revise this bill"}
        </button>

        {refusal && (
          <p role="alert" className="t-sm w-full text-[var(--err-700)]">
            {refusal}
          </p>
        )}
      </div>
    );
  }

  if (runState(bill) === "running") return null;

  const blocked = blockingRows(bill.rows);

  // Eight, not three. A reader who has to hunt for the ninth cannot judge the work; one who sees
  // most of them at once knows whether this is ten minutes or an afternoon.
  const named = blocked.rows.slice(0, 8);

  return (
    <>
      {/*
        ── Why the button is grey, above the button ────────────────────────────────────

        It was a run-on paragraph *under* a disabled control, built by joining three full item
        descriptions with commas: "Excavate in all materials for strip footings to the depths
        shown, average 1,20 m below existing ground level. (a quantity and a rate), Concrete in
        footings to be 25 MPa/19 mm, mechanically vibrated. (a quantity and a rate)…". A reader
        met a greyed button and then had to parse a wall of specification prose to learn what to
        do about it.

        The count leads now, the rows are a list rather than a sentence, and it sits above the
        control rather than under it — the reason before the refusal. §7.7: an error says what to
        do next, and it can only do that if it is read.
      */}
      {blocked.rows.length > 0 && (
        <div
          data-region="bill-blocked"
          className="border-t border-[var(--n-100)] bg-[var(--warn-50)] px-4 py-3"
        >
          <p className="t-sm font-semibold text-[var(--warn-700)]">
            Sign-off is greyed out: {blocked.rows.length}{" "}
            {blocked.rows.length === 1 ? "row has" : "rows have"} no measure
          </p>
          <p className="t-sm mt-0.5 max-w-[86ch] text-[var(--n-700)]">
            Every amber box in the bill above is a cell waiting for a figure. Type into it, press one
            below to be taken to it, or strike the {blocked.rows.length === 1 ? "row" : "rows"} out.
            A signed bill with a hole in it reads downstream as an approved total.
          </p>

          {/*
            The row and the way to fix it, on the same line.

            This was a list of descriptions with a "needs a quantity and a rate" chip beside each —
            true, unactionable, and read by the person it was written for as a report on a problem
            rather than a way through it. The chip is now the control: it names the column and it
            goes there. `run-panel` learned this first and this is the same shape, one screen over.
          */}
          <ul className="mt-2 flex flex-col gap-1.5">
            {named.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-2">
                <span className="t-sm min-w-0 flex-1 truncate text-[var(--n-700)]">
                  {row.description}
                </span>

                {row.cells.map((cell) => (
                  <button
                    key={cell}
                    type="button"
                    data-blocked={cell}
                    onClick={() => revealCell(row.id, cell)}
                    className="t-sm inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--r-sm)] border border-[var(--warn-500)] bg-[var(--n-0)] px-2 font-medium whitespace-nowrap text-[var(--warn-700)] transition-colors hover:bg-[var(--warn-50)]"
                    style={{ transitionDuration: "var(--m-fast)" }}
                  >
                    Enter {cell === "quantity" ? "a quantity" : "a rate"}
                    <ArrowRight aria-hidden size={12} strokeWidth={2} />
                  </button>
                ))}
              </li>
            ))}
          </ul>

          {blocked.rows.length > named.length && (
            <p className="t-sm mt-1.5 text-[var(--n-600)]">
              and {blocked.rows.length - named.length} more.
            </p>
          )}

          {/*
            The bulk way out — and it is two different sentences, because it is two different facts.

            With no priced source on file, the answer to fifty unpriced rows is not to type fifty
            rates; it is to file the cost plan or rate schedule they live in and draft again. With
            one already filed, that same sentence sends a QS off to repeat work they have done and
            it will not help — the source is there and the draft found no rate on these rows. The
            first screenshot of this panel said the first thing on a project that was in the second
            state, which is how the branch got here.

            Either way it is a **link, not a second uploader**. That upload exists on this page, in
            the readiness list below, bound to the criterion that knows which kinds satisfy it.
            Growing one here with a kind hardcoded into it is the second way to file that §2.5
            forbids, and it would file a cost plan under whatever label this component happened to
            name.
          */}
          <p className="t-sm mt-3 max-w-[86ch] border-t border-[var(--warn-500)]/25 pt-3 text-[var(--n-700)]">
            {pricedSource ? (
              <>
                A{" "}
                <button
                  type="button"
                  data-action="file-rates"
                  onClick={() => revealCriterion("d1.2-rates")}
                  className="font-medium text-[var(--a-700)] underline underline-offset-2 hover:text-[var(--a-600)]"
                >
                  priced source is already on file
                </button>{" "}
                and this draft found no rate in it for{" "}
                {blocked.rows.length === 1 ? "this row" : "these rows"} — so they are yours to
                measure and price, or to strike out.
              </>
            ) : (
              <>
                Rather than typing them,{" "}
                <button
                  type="button"
                  data-action="file-rates"
                  onClick={() => revealCriterion("d1.2-rates")}
                  className="font-medium text-[var(--a-700)] underline underline-offset-2 hover:text-[var(--a-600)]"
                >
                  file the priced source the rates come from
                </button>{" "}
                — a cost plan, a priced bill, a rate schedule — and draft the bill again to read
                them off it.
              </>
            )}
          </p>
        </div>
      )}

      <div
      data-region="signature"
      className="flex flex-wrap items-center gap-3 border-t border-[var(--n-100)] px-4 py-3"
    >
      <p className="t-sm min-w-0 flex-1 text-[var(--n-500)]">
        Signing puts your name on this bill as its quantities and rates, freezes these rows so
        nothing can change under them, and releases the total to the steps that read it. It is a
        version, not a door: you can revise it afterwards, the revision starts from these figures,
        and this bill stays the one in force until the new one is signed.
      </p>

      <button
        type="button"
        disabled={pending || blocked.empty || blocked.rows.length > 0}
        /*
          The reason on the control, not only in the panel above it.

          The panel says why the button is grey and says it well, but somebody reading this screen
          reported not knowing — a disabled button is the thing a reader points at, and it was the
          one part of the page with nothing to say for itself. Hovering it now answers.
        */
        title={
          blocked.empty
            ? "There are no items in this bill to sign"
            : blocked.rows.length > 0
              ? `${blocked.rows.length} ${blocked.rows.length === 1 ? "row" : "rows"} still without a quantity or a rate — see the amber panel above`
              : undefined
        }
        onClick={() =>
          act(async () => {
            const outcome = await signOffBill(projectId, bill.id);
            setRefusal(outcome.ok ? null : outcome.reason);
          })
        }
        className="t-base flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--n-800)] px-3 font-medium text-white transition-colors hover:bg-[var(--n-900)] disabled:cursor-not-allowed disabled:opacity-40"
        style={{ transitionDuration: "var(--m-fast)" }}
      >
        <Lock aria-hidden size={13} strokeWidth={2.25} />
        {pending ? "Signing…" : `Sign off as ${signer}`}
      </button>

      {blocked.empty && (
        <p className="t-sm w-full text-[var(--warn-700)]">
          There is nothing in this bill to sign. An approved total of nought over a job nobody has
          measured is worse than an unsigned step.
        </p>
      )}


      {refusal && (
        <p role="alert" className="t-sm w-full text-[var(--err-700)]">
          {refusal}
        </p>
      )}
      </div>
    </>
  );
}

/**
 * Send the reader to the cell that is blocking sign-off.
 *
 * An event rather than a `querySelector` from here, because a row inside a folded section is not in
 * the DOM and only the grid can unfold it — see the listener in `bill-grid.tsx`, which owns both the
 * fold state and the focus.
 */
function revealCell(rowId: string, cell: string) {
  window.dispatchEvent(new CustomEvent("bill:reveal", { detail: { rowId, cell } }));
}

/** Send the reader to the readiness row whose upload would supply the rates. */
function revealCriterion(id: string) {
  const row = document.querySelector(`[data-criterion="${id}"]`);
  if (!row) return;

  row.scrollIntoView({ behavior: "smooth", block: "center" });
}

/**
 * Why no item has a quantity, where the answer is the corpus rather than the run.
 *
 * A bill drafted from a specification has no quantities and no rates, because a specification states
 * neither – and a grid of empty cells with nothing said reads as extraction that failed. The audit of
 * the Ridgeview bill found exactly that: the run had done its job and the project had no measured
 * document to read. Shown off the rows, not the run's last event, so it is still there after a reload.
 */
function Unmeasured() {
  return (
    <p
      data-region="bill-unmeasured"
      className="t-sm border-b border-[var(--n-100)] bg-[var(--warn-50)] px-4 py-2.5 text-[var(--warn-700)]"
    >
      None of these items came with a quantity: the documents they were read from describe the work without
      measuring it. File a measured bill of quantities or priced bill and draft again – or enter the quantities
      here and price them from the rate library.
    </p>
  );
}

function Tally({
  items,
  unpriced,
  corrected = 0,
  struck = 0,
  discarded,
  furniture,
  spend,
  aside,
}: {
  items: number;
  unpriced: number;
  corrected?: number;
  struck?: number;
  discarded: number;
  furniture: number;
  spend: { input: number; output: number; rand: number | null } | null | undefined;
  aside?: string;
}) {
  return (
    <div className="t-sm flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--n-100)] px-4 py-2">
      <span className="text-[var(--n-700)]">
        {items} {items === 1 ? "item" : "items"}
      </span>
      {unpriced > 0 && (
        <span className="text-[var(--warn-700)]">{unpriced} still to measure or price</span>
      )}
      {corrected > 0 && <span className="text-[var(--a-600)]">{corrected} corrected by hand</span>}
      {struck > 0 && <span className="text-[var(--n-500)]">{struck} struck out</span>}
      {/*
        §1.3.2 — a row the agent offered whose quote was not in the corpus. Counted out loud, because
        "the documents describe no work" and "four rows were invented and caught" send a QS to
        completely different places.
      */}
      {discarded > 0 && (
        <span className="text-[var(--n-500)]">
          {discarded} discarded — the quote was not in the filed documents
        </span>
      )}
      {/*
        Said separately from the discarded rows, because it is a different fault. A discarded row
        is one the documents do not support; one of these is a cover-page line the documents state
        plainly and that is simply not work to be priced.
      */}
      {furniture > 0 && (
        <span className="text-[var(--n-500)]">
          {furniture} set aside — a cover page&rsquo;s headings and title block, not work
        </span>
      )}
      {aside && <span className="ml-auto text-[var(--n-500)]">{aside}</span>}
      {spend && (
        <span className="num t-xs text-[var(--n-400)]">
          {(spend.input + spend.output).toLocaleString()} tokens
          {spend.rand !== null && ` · $${spend.rand.toFixed(4)}`}
        </span>
      )}
    </div>
  );
}
