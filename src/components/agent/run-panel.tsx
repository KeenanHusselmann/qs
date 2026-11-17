/**
 * Running the agent over the corpus, reviewing what it found, and signing it.
 *
 * ── The gate is real ───────────────────────────────────────────────────────────────────────
 *
 * The button is disabled until the step's required documents are filed. Not to be strict for its
 * own sake: a run over a corpus that lacks the market study will return no selling price, and a
 * screen full of `not_found` teaches a reader that the agent is unreliable when in fact they never
 * gave it anything to read. The refusal says which documents are missing (§7.7).
 *
 * ── Every value carries its passage ────────────────────────────────────────────────────────
 *
 * §1.3.2: what the agent cannot ground, it does not assert. A found value shows the quote it came
 * from, so a reviewer checks the *evidence* rather than deciding whether they feel like trusting a
 * number. `not_found` is stated plainly and is never a zero — a missing absorption rate and an
 * absorption rate of nought are different facts, and conflating them is how a model produces a
 * confident wrong answer.
 *
 * ── The run is a row now, and the screen reads it ──────────────────────────────────────────
 *
 * Results used to live in this component's state, which meant a reload lost a minute of paid model
 * calls and a second tab saw nothing. The run is persisted (§1.3.1), so what is rendered here is the
 * database's answer — except while a run is actually streaming, when the events arriving are ahead
 * of any query. The moment the stream ends the screen goes back to the server's version, which is
 * also the version that has the ids the Correct and Sign-off controls act on.
 *
 * ── Correct, then sign. There is no Accept ─────────────────────────────────────────────────
 *
 * The row used to carry a disabled Accept button, waiting for exactly this work. It is not what
 * arrived. §1.3.1 has four maps — proposed, overrides, working, output — and none of them is an
 * approval per field: *a signature freezes*, once, over the whole run. A per-row Accept would be a
 * fifth piece of state with nothing downstream reading it, and ten clicks a QS has to make before
 * the one click that means something. So the row's control is **Correct**, which writes an
 * override, and the run's control is **Sign off**, which writes `output` and freezes it.
 */

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowDownToLine, ArrowRight, FileText, Lock, PenLine, Play, RotateCcw, Sparkles, TriangleAlert, Undo2 } from "lucide-react";

import { formatDate } from "@/lib/dates";
import { Citation } from "@/components/documents/citation";
import { CriterionUpload } from "@/components/criteria/criterion-upload";
import type { BlockingInput } from "@/lib/criteria-status";
import { readUnit } from "@/domain/units";
import { feedsInto } from "@/lib/chain";
import { PROJECT_NAV } from "@/lib/navigation";
import { correctField, enterByHand, revertField, signOffRun } from "@/app/(app)/projects/[id]/run-actions";
import { kindOf, PLACEHOLDER } from "@/lib/agent/field-kinds";
import {
  blockingFields,
  reconciliationGap,
  runState,
  specFor,
  streamRun,
  workingValue,
  type FieldResult,
  type FieldSpec,
  type FieldState,
  type PersistedRun,
  type RunEvent,
  type RunField,
} from "@/lib/agent/run";

/** §7.7's date, shared — see `lib/dates.ts` for why seven copies of it was a problem. */
const on = formatDate;

/**
 * The upstream step's name from the module href a carried figure records.
 *
 * `navigation.ts` owns the labels and this is a client component, so it reads them the same way
 * every other surface does rather than being handed a second copy that could disagree.
 */
const upstreamName = (module: string) =>
  PROJECT_NAV.flatMap((g) => g.items).find((i) => i.href === module)?.label ?? module;

export function RunPanel({
  projectId,
  module,
  fields,
  heading,
  blurb,
  blockedBy,
  waitingOn,
  run,
  signature,
  signer,
}: {
  /**
   * The whole input for a run. The panel used to be handed the document list as well, because the
   * mock run needed something to cite; the real one retrieves its own passages server-side, scoped
   * to this project in SQL. A client-supplied corpus would have been a client-supplied answer.
   */
  projectId: string;
  /** Which step this is. It selects the field set on the server and files the run under it. */
  module: string;
  /**
   * The step's field set, for the two things the screen needs it for before any run exists: naming
   * the field being read while the stream is mid-flight, and knowing which fields are required.
   *
   * Passed from the server rather than imported, so this component stays one panel for nine agents.
   */
  fields: readonly FieldSpec[];
  heading: string;
  blurb: string;
  /**
   * Required inputs still missing, each with the kind it files under. Non-empty means the run
   * cannot start — and every one of them can be cleared from this panel (§1.3.3).
   */
  blockedBy: readonly BlockingInput[];
  /**
   * Upstream steps whose output is not signed — §1.3.1.
   *
   * Kept apart from `blockedBy` because **nothing filed here clears it**, and saying "file X first"
   * over a blocker no document can lift is how v3 came to print "needs a cost plan" directly beneath
   * "Filed and indexed: the cost plan".
   */
  waitingOn: readonly string[];
  /** The latest run of this step, as the server has it. Null before the first one. */
  run: PersistedRun | null;
  /**
   * The signature in force on this step, which is not always the run on screen.
   *
   * Sign a run, then run the step again, and the panel shows a fresh draft while the signed output
   * — what a downstream step actually reads — is the earlier run. Saying "nothing is signed off
   * yet" over that would be false.
   */
  signature: { runId: string; by: string; at: string } | null;
  /** Who is signed in — the name a signature would carry. Never taken from the client. */
  signer: string;
}) {
  const router = useRouter();

  const [streaming, setStreaming] = useState(false);
  const [live, setLive] = useState<FieldResult[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [spend, setSpend] = useState<RunEvent["spend"]>(undefined);
  // Held through the refresh that follows a run, so the rows do not blink out while the server
  // re-renders with the same values it has just been sent.
  const [settling, startSettling] = useTransition();

  async function start() {
    setStreaming(true);
    setLive([]);
    setFailure(null);
    setSpend(undefined);

    try {
      for await (const event of streamRun(projectId, module)) {
        if (event.type === "error") {
          /**
           * §1.3 — an outage is surfaced, never a silent gap in the data.
           *
           * The fields already read stay on screen. They were grounded before the failure and
           * throwing them away would waste work a reader can check. The run is recorded as failed,
           * so nothing here — or on a reload — reads as a complete answer.
           */
          setFailure(event.error ?? "The run did not finish.");
          break;
        }
        if (event.type === "field" && event.result) {
          setLive((current) => [...current, event.result!]);
        }
        if (event.type === "done") setSpend(event.spend);
      }
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "The run did not finish.");
    } finally {
      setStreaming(false);
      // The server now holds everything this stream reported, plus the ids the review controls
      // need. Its version takes over.
      startSettling(() => router.refresh());
    }
  }

  const blocked = blockedBy.length > 0 || waitingOn.length > 0;
  const state = run ? runState(run) : null;
  const signed = state === "signed";
  // While the events are arriving they are ahead of any query, so they are what is shown.
  const showLive = streaming || settling;

  return (
    /*
      White, because the canvas is `--n-50` and this had no ground of its own.

      It read as a grey box beside white ones the moment the readiness list and the checklist became
      panels — three sections on one page, one of them a different colour for no reason a reader
      could name. Its header stays untinted where theirs is `--n-50`: the blurb under the heading is
      `--n-500`, which measures **4.72:1 on white and 4.45:1 on `--n-50`**, so the strip that suits a
      title and a count would put body text under §7.8's 4.5:1. A header carrying a paragraph and the
      page's primary action is not the same object as a header carrying a title and a count.
    */
    <section
      data-region="run"
      className="overflow-hidden rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-0)]"
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--n-100)] px-4 py-3">
        <Sparkles aria-hidden size={16} strokeWidth={1.75} className="shrink-0 text-[var(--a-500)]" />
        <div className="min-w-0 flex-1">
          <h2 className="t-base font-semibold text-[var(--n-800)]">{heading}</h2>
          <p className="t-sm mt-0.5 text-[var(--n-500)]">{blurb}</p>
        </div>

        {/*
          The way in that needs no document (audit C2). Offered before the first run – once a draft
          exists its figures are corrected in place – and not while an upstream is unsigned, because
          the figures this step carries come from that signature and are never typed.
        */}
        {!run && !streaming && waitingOn.length === 0 && <EnterByHand projectId={projectId} module={module} />}

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
          {streaming ? "Reading…" : run ? "Run again" : "Run extraction"}
        </button>
      </header>

      {/*
        An unsigned upstream, said first and said differently.

        §1.3.3: "the block is only ever a missing document" — an unsigned upstream cannot be
        declared past, and no upload here touches it. Printing "file X first" over this blocker is
        what produced v3's "needs a cost plan" beneath "Filed and indexed: the cost plan".
      */}
      {waitingOn.length > 0 && (
        <p className="t-sm border-b border-[var(--n-100)] bg-[var(--warn-50)]/40 px-4 py-2.5 text-[var(--warn-700)]">
          Waiting on {waitingOn.join(", ")} to be signed off. This step reads figures from{" "}
          {waitingOn.length === 1 ? "it" : "them"}, and nothing filed here will clear it — a run over
          unapproved numbers is the thing the chain exists to prevent.
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
            To read these figures from documents, file {blockedBy.length === 1 ? "this" : "these"}{" "}
            first. If you already know them, enter them by hand instead – no document needed.
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

      {/*
        The provider's own words, not "something went wrong". A depleted balance, a missing key and
        a timeout send a reader to three different places, and only one of them is worth retrying.
        Shown from the stream while it is live, and from the run's own record afterwards — a failure
        reported only at the moment it happens is a failure nobody knows about a day later.
      */}
      {(failure ?? (!showLive && run?.error)) && (
        <p role="alert" className="t-sm border-b border-[var(--n-100)] px-4 py-2.5 text-[var(--err-700)]">
          {failure ?? run?.error}
          <span className="mt-1 block text-[var(--n-600)]">
            The fields below were read before it stopped. The rest were not asked — they are absent
            from this run, not from the documents.
          </span>
        </p>
      )}

      {/*
        A run whose function was killed leaves a row that says `running` and never changes. §1.3.1:
        say that, rather than show a spinner that lies.
      */}
      {!showLive && state === "stalled" && (
        <p role="alert" className="t-sm border-b border-[var(--n-100)] px-4 py-2.5 text-[var(--warn-700)]">
          This run stopped without finishing or reporting why — it was started on{" "}
          {on(run!.startedAt)} and nothing has been written to it since. The fields below are what it
          managed to read. Run it again.
        </p>
      )}

      {!showLive && state === "running" && (
        <div className="t-sm flex flex-wrap items-center gap-3 border-b border-[var(--n-100)] px-4 py-2.5 text-[var(--n-600)]">
          <span>This run is in progress — started {on(run!.startedAt)}, elsewhere or before this page was loaded.</span>
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

      {/*
        A signature on an earlier run of this step. It is what the next step reads until the run on
        screen is signed too, and leaving it unsaid would let a QS conclude their sign-off was lost
        the moment they ran the step again.
      */}
      {signature && signature.runId !== run?.id && (
        <p className="t-sm border-b border-[var(--n-100)] bg-[var(--ok-50)]/40 px-4 py-2.5 text-[var(--n-700)]">
          An earlier run of this step is signed off — by {signature.by} on {on(signature.at)}. Those
          are the figures the next step reads. The run below is a draft and replaces them only when
          it is signed.
        </p>
      )}

      {/*
        What the run will establish, before it is run — the reader's half of §1.3's "no blank forms".
        See `Rubric` for why a run should not be a black box until it finishes.
      */}
      {!showLive && !run && <Rubric fields={fields} />}

      {showLive ? (
        <LiveResults
          results={live}
          projectId={projectId}
          fields={fields}
          spend={spend}
          streaming={streaming}
          superseding={Boolean(signature)}
        />
      ) : (
        run && (
          <Reviewed
            run={run}
            projectId={projectId}
            module={module}
            fields={fields}
            signer={signer}
            signed={signed}
            frozen={signed}
            superseding={signature !== null && signature.runId !== run.id}
          />
        )
      )}
    </section>
  );
}

/**
 * ── The run is a table ─────────────────────────────────────────────────────────────────────
 *
 * It was a list of tall rows: label, value, a note, a citation behind a disclosure, a confidence
 * badge and two buttons, stacked. Ten of those is a wall, and the first thing said about it was
 * that the extracted data was "too much, and too confusing" — which is the correct reading of a
 * surface where the ten figures a QS came to check are spread down two screens with the evidence
 * folded away.
 *
 * §7.1: **the grid is the interface**, density over whitespace, this is a financial instrument and
 * should feel like one. §7.4 fixes the numbers — 13px, 6px/12px cells, a 12px uppercase header, one
 * border between rows, no zebra. The columns are v3's, which is the surface this replaces and the
 * one a QS has already reviewed runs on: **Field · Value · Source · Your figure**, with confidence
 * riding in Value — see below for why it is not the fifth column v3 had.
 *
 * ── No horizontal scroll, and that is a correctness rule ───────────────────────────────────
 *
 * v3 records what happens otherwise: with an auto-width table the Source column — a document name
 * plus a quoted passage — grows until it pushes the override control off the right edge, and a
 * reader who does not notice a horizontal scrollbar concludes the figures cannot be changed. The
 * whole screen exists so a person can disagree with the agent. `table-fixed` with declared widths
 * is what holds it, and Source gives by **wrapping** rather than truncating: the quote is the
 * evidence, and evidence cut off at an ellipsis cannot be checked.
 *
 * ── Confidence rides with the value, because a column could not hold its own header ────────
 *
 * It used to be a fifth column at 9%. "CONFIDENCE" is a single unbreakable word needing 94px with
 * its padding, and 9% only clears that at the 1440 design target: at 1280 it is 88px, and at 1280
 * with the advisor open 57px. `table-fixed` does not shrink a word — it paints it over the
 * neighbour, so the header read `CONFIDENSOURCE` at every width below the one it was designed at.
 * A percentage cannot fix a fixed-width word, so the column had to go.
 *
 * Folding the pill into Value is not a concession to space. Confidence qualifies *that figure* —
 * "1 046, 92%" is one claim, and a column between them was what stopped it reading as one. Four
 * columns now, every one of them wider, and the rows are shorter for it.
 *
 * ── The override is a box on the row, not a button that opens one ──────────────────────────
 *
 * Correcting used to mean clicking Correct, waiting for a form, typing, clicking Save. A review
 * pass is ten figures at a time, so the box is simply there and Enter commits it — the reader goes
 * down the column. The reason field appears only on the row being edited, because a second input on
 * every row is the clutter this rewrite exists to remove.
 */
function FieldTable({
  children,
  frozen,
}: {
  children: React.ReactNode;
  /** A signed run has nothing to correct, so the last column goes and Source takes the room. */
  frozen: boolean;
}) {
  return (
    <table className="w-full table-fixed">
      <colgroup>
        <col className="w-[20%]" />
        <col className="w-[27%]" />
        <col className={frozen ? "w-[53%]" : "w-[36%]"} />
        {!frozen && <col className="w-[17%]" />}
      </colgroup>
      <thead>
        {/* §7.4 — 12px, 600, uppercase, 0.03em, one rule beneath. */}
        <tr className="border-b border-[var(--n-200)] text-left">
          {["Field", "Value", "Source", ...(frozen ? [] : ["Your figure"])].map(
            (heading) => (
              <th
                key={heading}
                scope="col"
                className="t-sm px-3 py-2 font-semibold tracking-[0.03em] text-[var(--n-500)] uppercase"
              >
                {heading}
              </th>
            ),
          )}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

/**
 * What this step will establish, shown before anything is run.
 *
 * ── Why a run should not be a black box until it finishes ──────────────────────────────────
 *
 * The field set has always existed — it is the whole definition of a run (§1.3: "a run is defined by
 * the fields it must return, not by a prompt") — and it existed only in the source. A reader met a
 * button, pressed it, spent money, and found out afterwards what had been asked. That is the same
 * complaint as the wall of rows, one step earlier: the step could not be understood before it acted.
 *
 * So the list is on the screen, in the order the run asks for it, with what each figure feeds and
 * which are required. It is the *standard the run will be judged against* — the thing a QS would
 * write down before instructing anybody — and putting it in front of the button is what makes
 * pressing the button an informed act rather than a hopeful one.
 *
 * It disappears once a run exists, because the run's own table then answers the same question
 * better: it says what was asked *and* what came back.
 */
function Rubric({ fields }: { fields: readonly FieldSpec[] }) {
  const required = fields.filter((f) => f.required).length;
  const carried = fields.filter((f) => f.carriedFrom).length;

  return (
    <div data-region="rubric">
      <div className="t-sm flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--n-100)] px-4 py-2 text-[var(--n-600)]">
        <span className="font-medium text-[var(--n-800)]">What this step establishes</span>
        <span className="num">{fields.length} figures</span>
        <span className="num">{required} required</span>
        {carried > 0 && (
          <span className="num">{carried} carried from a step above rather than read again</span>
        )}
      </div>

      <table className="w-full table-fixed">
        <colgroup>
          <col className="w-[30%]" />
          <col className="w-[70%]" />
        </colgroup>
        <thead>
          <tr className="border-b border-[var(--n-200)] text-left">
            {["Field", "What it feeds"].map((heading) => (
              <th
                key={heading}
                scope="col"
                className="t-sm px-3 py-2 font-semibold tracking-[0.03em] text-[var(--n-500)] uppercase"
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <tr
              key={field.id}
              data-field={field.id}
              className="border-b border-[var(--n-100)] align-top last:border-0"
            >
              <td className="px-3 py-1.5">
                <span className="font-medium text-[var(--n-800)]">{field.label}</span>
                {field.required && (
                  <span
                    aria-label="required"
                    title="The step cannot be signed without it"
                    className="ml-1 text-[var(--err-500)]"
                  >
                    *
                  </span>
                )}
              </td>
              <td className="t-sm px-3 py-1.5 text-[var(--n-600)]">
                {field.feeds}
                {field.carriedFrom && (
                  <span className="mt-0.5 flex items-center gap-1 text-[var(--n-500)]">
                    <ArrowDownToLine
                      aria-hidden
                      size={11}
                      strokeWidth={2}
                      className="shrink-0 text-[var(--a-500)]"
                    />
                    Carried from {upstreamName(field.carriedFrom.module)} once it is signed — not
                    read from the documents here.
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The field's unit, appended only where the value has not already said it.
 *
 * Every money row on the screen read `R 737 558 R`, and every area `48 m² m²`. Telling a reader
 * the unit is the row's job; saying it twice is how a reader learns to stop reading it — and the
 * one time it matters is when the two do *not* agree, which is the row below.
 */
function UnitSuffix({ value, unit }: { value: string | null; unit?: string }) {
  if (!value || !unit) return null;
  if (readUnit(value, unit).agreement !== "silent") return null;

  return <span className="t-sm ml-1 font-normal text-[var(--n-500)]">{unit}</span>;
}

/**
 * The unit the document stated, where it is not the unit the field records.
 *
 * A market study saying "12 units per month" against a field recorded in units/yr is a 12×
 * error, and it is invisible: nothing crashes, nothing is blank, and the confidence badge reads
 * 100%. Absorption is what the sales programme and the cash flow are built on.
 *
 * It proposes and never blocks — §7.2's amber, which is the platform's one colour for *needs
 * action*, and never `--err`, because a document stating its own unit clearly is not an error.
 * The figure is untouched: the correction box is on this same row, and a number the platform
 * substituted for itself would be a figure no document states.
 */
function UnitMismatch({ value, unit }: { value: string | null; unit?: string }) {
  const reading = readUnit(value, unit);
  if (!reading.note) return null;

  return (
    <span className="t-xs mt-1 flex items-start gap-1 font-normal text-[var(--warn-700)]">
      <TriangleAlert aria-hidden size={11} strokeWidth={2} className="mt-0.5 shrink-0" />
      <span>{reading.note}</span>
    </span>
  );
}
/**
 * Confidence, as one word or one number — §7.1 #5, colour never carries meaning alone.
 *
 * A carried figure reads **Approved** rather than a percentage: it came from a signed run, so the
 * model's own uncertainty about it was settled by a person and repeating it here would understate
 * what is known. A corrected figure reads **Human** for the same reason in reverse.
 */
function Confidence({
  state,
  value,
  carried,
  overridden,
}: {
  state: FieldState;
  value: number;
  carried: boolean;
  overridden: boolean;
}) {
  const [label, tone] = overridden
    ? ["Human", "bg-[var(--a-50)] text-[var(--a-700)]"]
    : carried
      ? ["Approved", "bg-[var(--ok-50)] text-[var(--ok-700)]"]
      : state === "not_found"
        ? ["Gap", "bg-[var(--warn-50)] text-[var(--warn-700)]"]
        : state === "uncertain"
          ? [`${Math.round(value * 100)}% · check`, "bg-[var(--warn-50)] text-[var(--warn-700)]"]
          : [`${Math.round(value * 100)}%`, "bg-[var(--ok-50)] text-[var(--ok-700)]"];

  return (
    <span
      className={`t-xs num ml-1.5 inline-block rounded-[var(--r-sm)] px-1.5 py-0.5 font-medium whitespace-nowrap ${tone}`}
    >
      {label}
    </span>
  );
}

/** What the stream is saying, while it is saying it — the same table, with nothing to edit yet. */
function LiveResults({
  results,
  projectId,
  fields,
  spend,
  streaming,
  superseding,
}: {
  results: readonly FieldResult[];
  projectId: string;
  fields: readonly FieldSpec[];
  spend: RunEvent["spend"];
  streaming: boolean;
  /** An earlier run of this step is signed, so "nothing is signed" would be the wrong sentence. */
  superseding: boolean;
}) {
  if (results.length === 0) {
    return streaming ? (
      <p className="t-sm px-4 py-3 text-[var(--n-500)]">
        Reading {fields[0]?.label.toLowerCase()}…
      </p>
    ) : null;
  }

  return (
    <>
      <Tally
        found={results.filter((r) => r.state === "found").length}
        uncertain={results.filter((r) => r.state === "uncertain").length}
        missing={results.filter((r) => r.state === "not_found").length}
        spend={spend ?? null}
        aside={
          superseding
            ? "Not signed off — the next step still reads the run that was."
            : "Nothing is signed off yet — the next step cannot read these until it is."
        }
      />

      {/*
        The override column is absent while the stream runs, and that is not a layout choice. These
        rows are events, not records: they have no id yet, so a correction typed against one would
        have nowhere to go. It appears the moment the run settles and the server's version takes
        over, which is a second later.
      */}
      <FieldTable frozen>
        {results.map((result) => (
          <tr
            key={result.field.id}
            data-field={result.field.id}
            className="border-b border-[var(--n-100)] align-top last:border-0"
          >
            <td className="px-3 py-1.5">
              <span className="font-medium text-[var(--n-800)]">{result.field.label}</span>
              {result.field.required && (
                <span aria-label="required" title="The step cannot be signed without it" className="ml-1 text-[var(--err-500)]">
                  *
                </span>
              )}
            </td>
            <td className="num px-3 py-1.5 font-medium text-[var(--n-800)]">
              {result.value ?? <span className="t-sm font-normal text-[var(--n-500)]">Not stated</span>}
              <UnitSuffix value={result.value} unit={result.field.unit} />
              <Confidence
                state={result.state}
                value={result.confidence}
                carried={false}
                overridden={false}
              />
              <UnitMismatch value={result.value} unit={result.field.unit} />
            </td>
            <td className="px-3 py-1.5">
              <Citation citation={result.citation} note={result.note} projectId={projectId} />
            </td>
          </tr>
        ))}
      </FieldTable>

      {streaming && results.length < fields.length && (
        <p className="t-sm px-4 py-3 text-[var(--n-500)]">
          Reading {fields[results.length]?.label.toLowerCase()}…
        </p>
      )}
    </>
  );
}

/** The run as the database has it: correctable while it is a draft, frozen once it is signed. */
function Reviewed({
  run,
  projectId,
  module,
  fields,
  signer,
  signed,
  frozen,
  superseding,
}: {
  run: PersistedRun;
  projectId: string;
  /** Threaded down to the signature, which says what signing this step released. */
  module: string;
  fields: readonly FieldSpec[];
  signer: string;
  signed: boolean;
  frozen: boolean;
  /** An earlier run of this step is signed, so "nothing is signed" would be the wrong sentence. */
  superseding: boolean;
}) {
  if (run.fields.length === 0) return null;

  const found = run.fields.filter((f) => f.proposed.state === "found").length;
  const uncertain = run.fields.filter((f) => f.proposed.state === "uncertain").length;
  const missing = run.fields.filter((f) => f.proposed.state === "not_found").length;
  const corrected = run.fields.filter((f) => f.override).length;

  return (
    <>
      <Tally
        found={found}
        uncertain={uncertain}
        missing={missing}
        corrected={corrected}
        // Nothing was read and nothing spent: an agent run always closes with a token count, and a
        // run still open has none yet, so no spend on a closed run means it was opened by hand.
        byHand={run.spend === null && run.status !== "running"}
        spend={run.spend}
        aside={
          signed
            ? undefined
            : superseding
              ? "Not signed off — the next step still reads the run that was."
              : "Nothing is signed off yet — the next step cannot read these until it is."
        }
      />

      <FieldTable frozen={frozen}>
        {run.fields.map((field) => (
          <ReviewRow
            key={field.fieldId}
            field={field}
            run={run}
            projectId={projectId}
            spec={specFor(field.fieldId, fields)}
            frozen={frozen}
          />
        ))}
      </FieldTable>

      <SignOff run={run} projectId={projectId} module={module} fields={fields} signer={signer} />
    </>
  );
}

function ReviewRow({
  field,
  run,
  projectId,
  spec,
  frozen,
}: {
  field: RunField;
  run: PersistedRun;
  projectId: string;
  /** The live spec, or undefined once the field set has moved on without this field. */
  spec: FieldSpec | undefined;
  frozen: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [pending, act] = useTransition();
  const [refusal, setRefusal] = useState<string | null>(null);

  const working = workingValue(field);
  // A signed run renders `output`, not `working`. They are equal at the moment of signing and the
  // row is frozen thereafter — but rendering the frozen column is what makes the screen a record of
  // what was signed rather than a recomputation that happens to agree.
  const shown = frozen ? field.output : working;
  const dirty = draft !== null && draft !== (field.override?.value ?? "");

  const save = () =>
    act(async () => {
      const outcome = await correctField(projectId, run.id, field.fieldId, draft ?? "", reason);
      if (outcome.ok) {
        setDraft(null);
        setReason("");
        setRefusal(null);
      } else {
        setRefusal(outcome.reason);
      }
    });

  return (
    <tr
      data-field={field.fieldId}
      className="border-b border-[var(--n-100)] align-top transition-colors last:border-0 hover:bg-[var(--n-25)]"
      style={{ transitionDuration: "60ms" }}
    >
      <td className="px-3 py-1.5">
        <span className="font-medium text-[var(--n-800)]">{field.label}</span>
        {spec?.required && (
          <span aria-label="required" title="The step cannot be signed without it" className="ml-1 text-[var(--err-500)]">
            *
          </span>
        )}
        {/*
          A carried figure, placed where a reader looks first — §1.3.1. Without it the row is
          indistinguishable from one this step read out of its own corpus, and the two are not the
          same claim: one was reviewed and signed by a named person upstream, the other has been
          seen by nobody yet.
        */}
        {field.carriedVia && (
          <span className="t-xs mt-0.5 flex items-center gap-1 text-[var(--n-500)]">
            <ArrowDownToLine aria-hidden size={11} strokeWidth={2} className="shrink-0 text-[var(--a-500)]" />
            approved in {upstreamName(field.carriedVia)}
          </span>
        )}
      </td>

      <td className="num px-3 py-1.5 font-medium text-[var(--n-800)]">
        {shown ?? (
          <span className="t-sm font-normal text-[var(--n-500)]">
            {frozen ? "Signed off with no figure" : "Needs your input"}
          </span>
        )}
        <UnitSuffix value={shown} unit={spec?.unit} />

        <Confidence
          state={field.proposed.state}
          value={field.proposed.confidence}
          carried={Boolean(field.carriedVia)}
          overridden={Boolean(field.override)}
        />

        <UnitMismatch value={shown} unit={spec?.unit} />

        {/*
          An override shows what it replaced. Hiding the agent's answer would remove the most
          reviewable fact on the page — it is the whole reason `proposed` and `overrides` are two
          maps rather than one editable value.
        */}
        {field.override && (
          <span className="t-xs mt-0.5 flex items-start gap-1 font-normal text-[var(--n-500)]">
            <Undo2 aria-hidden size={11} strokeWidth={2} className="mt-0.5 shrink-0" />
            <span>
              agent said {field.proposed.value ?? "nothing"} · {field.override.by}
              {field.override.reason && <> — {field.override.reason}</>}
            </span>
          </span>
        )}
      </td>

      <td className="px-3 py-1.5 break-words">
        <Citation
          citation={field.override ? null : field.citation}
          note={field.override ? "Replaced by hand — the agent's source is above." : field.proposed.note}
          projectId={projectId}
        />
      </td>

      {!frozen && (
        <td
          className="px-3 py-1.5"
          /*
            ── Moving off a figure commits it ──────────────────────────────────────────────
            A review pass is ten figures in a column, and the correction is not finished until it
            is written down. Requiring a click on Save after typing means every corrected figure
            costs a reach for the mouse, and — worse — a figure typed and then abandoned by
            clicking the next row looked saved and was not. Blur is the moment the reader has
            moved on, so it is the moment to write.

            The guard is what makes it safe. `focusout` bubbles, so this fires when focus leaves
            the value box for the reason box or for Save/Cancel — all of which are *inside* this
            cell and all of which mean the reader is still working on this figure. Committing
            there would save before the reason was typed and would fight the Cancel button for the
            same click. `contains(relatedTarget)` asks the only question that matters: did focus
            leave this correction, or move within it? A null `relatedTarget` — focus went to the
            document body — counts as leaving.

            Enter still commits, and Save still commits. This adds a third way rather than
            replacing either: the reader who never presses Enter no longer loses the figure.
          */
          onBlur={(e) => {
            if (!dirty || pending) return;
            if (e.currentTarget.contains(e.relatedTarget)) return;
            save();
          }}
        >
          <input
            id={`v-${field.fieldId}`}
            aria-label={`Your figure for ${field.label}`}
            // The expected form, before anything is refused (C4) – "R 0,00", "e.g. 31/03/2027".
            placeholder={kindOf(field.fieldId) === "text" ? "leave as is" : PLACEHOLDER[kindOf(field.fieldId)]}
            value={draft ?? field.override?.value ?? ""}
            disabled={pending}
            onChange={(e) => setDraft(e.target.value)}
            // Enter commits. A single-line box inside a column of them: reaching for the mouse
            // after every figure is what makes a ten-row review feel like a form rather than a
            // table.
            onKeyDown={(e) => {
              if (e.key === "Enter" && dirty && !pending) {
                e.preventDefault();
                save();
              }
            }}
            className="t-base num h-7 w-full rounded-[var(--r-sm)] border border-[var(--n-200)] bg-[var(--n-0)] px-2 outline-none focus:border-[var(--a-500)] disabled:opacity-60"
          />

          {/*
            The reason, and the controls, only on the row being edited. A reason box on every row
            is a second input per figure for something most corrections do not need — and this
            rewrite exists because there was too much on the row.
          */}
          {dirty && (
            <div className="mt-1 flex flex-col gap-1">
              <input
                id={`r-${field.fieldId}`}
                aria-label={`Why, for ${field.label}`}
                placeholder="why, if it helps the next reader"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="t-sm h-6 w-full rounded-[var(--r-sm)] border border-[var(--n-200)] bg-[var(--n-0)] px-2 outline-none focus:border-[var(--a-500)]"
              />
              <span className="flex items-center gap-2">
                {/*
                  Saving is what leaving the box does, so there is no Save button — see the cell's
                  `onBlur`. It stayed for one commit after the auto-commit landed and was the
                  clutter this rewrite exists to remove: a control that repeats what is about to
                  happen anyway reads as the thing you must do, and a reader who does not press it
                  wonders whether their figure was kept. What is left is the word for the state,
                  and the one act blur cannot perform.
                */}
                {pending && <span className="t-sm text-[var(--n-500)]">Saving…</span>}
                <button
                  type="button"
                  /*
                    Discarding must beat the auto-commit above, and ordering it by hoping the
                    button wins focus is not a guarantee — a browser that does not focus a button
                    on mousedown would blur the input first, save the figure, and only then run
                    this handler. Refusing the focus shift means the input never blurs, so there
                    is no commit to race.
                  */
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setDraft(null);
                    setReason("");
                  }}
                  className="t-sm cursor-pointer text-[var(--n-500)] underline underline-offset-2"
                >
                  Cancel
                </button>
              </span>
            </div>
          )}

          {/* Dropping a correction is its own act, and only offered where there is one to drop. */}
          {!dirty && field.override && (
            <button
              type="button"
              disabled={pending}
              title="Drop the correction and go back to the agent's figure"
              onClick={() =>
                act(async () => {
                  const outcome = await revertField(projectId, run.id, field.fieldId);
                  if (outcome.ok) setDraft(null);
                  else setRefusal(outcome.reason);
                })
              }
              className="t-sm mt-1 flex cursor-pointer items-center gap-1 text-[var(--n-500)] underline underline-offset-2 disabled:cursor-not-allowed"
            >
              <RotateCcw aria-hidden size={11} strokeWidth={2} />
              Revert
            </button>
          )}

          {refusal && (
            <p role="alert" className="t-sm mt-1 text-[var(--err-700)]">
              {refusal}
            </p>
          )}
        </td>
      )}
    </tr>
  );
}

/**
 * The signature — §1.3.1, the act that turns `working` into `output`.
 *
 * The consequence is stated before the button rather than behind a confirmation dialog. A signature
 * is what this screen is *for*; putting a modal in front of it would be ceremony around the one act
 * a QS came here to perform. What it must not be is ambiguous, so the button carries the name it
 * will record and the sentence beside it says the freeze cannot be undone.
 */
function SignOff({
  run,
  projectId,
  module,
  fields,
  signer,
}: {
  run: PersistedRun;
  projectId: string;
  /** Which step this is, so the signature can say what it released. */
  module: string;
  fields: readonly FieldSpec[];
  signer: string;
}) {
  const [pending, act] = useTransition();
  const [refusal, setRefusal] = useState<string | null>(null);
  const [note, setNote] = useState("");

  if (run.signedAt) {
    /**
     * What the signature released, and the way to it.
     *
     * Derived from the chain, never listed — `feedsInto` is the same answer the project overview
     * renders as "Feeds Cost Plan", so the two cannot disagree about what a step unlocks.
     */
    const released = feedsInto(module);

    /**
     * Which step's signature produces the viability report.
     *
     * The feasibility estimate, as in v3 — the report is a *feasibility* document and the
     * estimate is the step it is named for. Declared here rather than as a field on the spec
     * because it is a fact about the report, not about the run.
     */
    const producesReport = module === "/feasibility";

    return (
      <div
        data-region="signature"
        className="border-t border-[var(--n-100)] bg-[var(--ok-50)]/40 px-4 py-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Lock aria-hidden size={14} strokeWidth={2} className="shrink-0 text-[var(--ok-700)]" />
          <p className="t-sm text-[var(--n-700)]">
            <span className="font-medium text-[var(--ok-700)]">Signed off</span> by {run.signedBy} on{" "}
            {on(run.signedAt)}. These figures are frozen and the next step can read them. A change
            means a new run — this one is the record of what was approved.
          </p>
        </div>
        {run.signoffNote && (
          <p data-region="signoff-note" className="t-sm mt-1.5 text-[var(--n-700)]">
            <span className="font-medium text-[var(--warn-700)]">Signed with a difference:</span> {run.signoffNote}
          </p>
        )}

        {/*
          ── What happens next, as its own card ──────────────────────────────────────────

          It was a row of quiet links inside the signature strip, and it read as a footnote to
          the sentence above it. Measured, the label was already 9,01:1 — legible — while the
          control's own edge was 1,16:1 against the band behind it. Nobody could see the button;
          everybody could read it. The same defect the advisor tab had, and the same fix: fill
          the surface rather than darken the text.

          A card, because signing is the moment the job moves and the next thing to do deserves
          more than a line of prose. White on the tinted strip, so it lifts (§7.2 — a border only
          reads as an edge when the two sides differ).
        */}
        {(released.length > 0 || producesReport) && (
          <div
            data-region="next"
            className="mt-3 rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] px-3.5 py-3"
          >
            <p className="t-sm font-semibold text-[var(--n-800)]">What happens next</p>

            {released.length > 0 && (
              <p className="t-sm mt-0.5 text-[var(--n-600)]">
                These figures are released to{" "}
                {released.map((link) => link.label).join(", ")} — that step reads them rather than
                asking the documents again.
              </p>
            )}

            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {released.map((link) =>
                link.built && link.module ? (
                  <Link
                    key={link.code + link.module}
                    href={`/projects/${projectId}${link.module}`}
                    data-next={link.module}
                    /* Filled --a-600: white on it is 7,00:1 and its edge against this card is
                       7,00:1, where the outlined version's border was 1,16:1. */
                    className="t-sm flex h-8 items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--a-600)] px-3 font-medium text-white transition-colors hover:bg-[var(--a-700)]"
                    style={{ transitionDuration: "var(--m-fast)" }}
                  >
                    <span className="t-xs font-mono opacity-75">{link.code}</span>
                    {link.label}
                    <ArrowRight aria-hidden size={13} strokeWidth={2} />
                  </Link>
                ) : (
                  <span
                    key={link.code + (link.module ?? "")}
                    className="t-sm flex h-8 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--n-200)] px-2.5 text-[var(--n-500)]"
                  >
                    <span className="t-xs font-mono opacity-70">{link.code}</span>
                    {link.label}
                    <span className="t-xs">(not built)</span>
                  </span>
                ),
              )}

              {producesReport && (
                <Link
                  href={`/projects/${projectId}/report`}
                  data-action="report"
                  className="t-sm flex h-8 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--n-300)] px-3 font-medium text-[var(--n-700)] transition-colors hover:bg-[var(--n-50)]"
                  style={{ transitionDuration: "var(--m-fast)" }}
                >
                  <FileText aria-hidden size={13} strokeWidth={2} />
                  Generate report
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (runState(run) === "running") return null;

  const blocked = blockingFields(run.fields, fields);
  // Shown before the click, from the same check the server makes (audit C3).
  const gap = blocked.length === 0 ? reconciliationGap(run.fields, fields) : null;
  const needsNote = Boolean(gap) && !note.trim();

  return (
    <>
      {gap && (
        <div data-region="reconcile-gap" className="border-t border-[var(--warn-500)] bg-[var(--warn-50)] px-4 py-3">
          <p className="t-sm font-medium text-[var(--warn-700)]">Doesn&rsquo;t add up. {gap}</p>
          <label className="mt-2 flex flex-col gap-1">
            <span className="t-sm text-[var(--n-700)]">Correct a figure above, or say why you are signing anyway – it prints with the signature.</span>
            <textarea
              data-input="signoff-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={1000}
              placeholder="e.g. Total includes VAT; elements exclude it."
              className="t-sm w-full rounded-[var(--r-sm)] border border-[var(--n-200)] bg-[var(--n-0)] px-2 py-1.5 outline-none focus:border-[var(--a-500)]"
            />
          </label>
        </div>
      )}
      {/*
        ── The blocker leads, above the control it blocks ──────────────────────────────────

        This used to sit *under* the button: a reader met a greyed control, then a sentence
        explaining it. That is the same fault the bill's sign-off had, and the same fix — the
        count first, the fields named, and the reason above the thing it disables.

        The fields are buttons, not prose. Naming what is missing is better than a count; taking
        the reader to the box they have to fill is better than naming it. A required field on a
        forty-row table is genuinely hard to find by scrolling.
      */}
      {blocked.length > 0 && (
        <div
          data-region="signoff-blocked"
          className="border-t border-[var(--warn-500)] bg-[var(--warn-50)] px-4 py-3"
        >
          <p className="t-sm font-medium text-[var(--warn-700)]">
            {blocked.length} required {blocked.length === 1 ? "field has" : "fields have"} no value.
            This step cannot be signed until {blocked.length === 1 ? "it is" : "they are"} filled.
          </p>

          <ul className="mt-2 flex flex-wrap gap-1.5">
            {blocked.map((field) => (
              <li key={field.fieldId}>
                <button
                  type="button"
                  data-blocked={field.fieldId}
                  onClick={() => revealField(field.fieldId)}
                  className="t-sm inline-flex h-7 items-center gap-1.5 rounded-[var(--r-sm)] border border-[var(--warn-500)] bg-[var(--n-0)] px-2 font-medium text-[var(--warn-700)] transition-colors hover:bg-[var(--warn-50)]"
                  style={{ transitionDuration: "var(--m-fast)" }}
                >
                  {field.label}
                  <ArrowRight aria-hidden size={12} strokeWidth={2} />
                </button>
              </li>
            ))}
          </ul>

          <p className="t-sm mt-2 text-[var(--n-600)]">
            Enter the figure by hand, or file the document it comes from and run the step again. A
            signed output with a gap in it reads downstream as an approved figure.
          </p>
        </div>
      )}

      <div
        data-region="signature"
        className="flex flex-wrap items-center gap-3 border-t border-[var(--n-100)] px-4 py-3"
      >
        <p className="t-sm min-w-0 flex-1 text-[var(--n-500)]">
          Signing freezes these figures under your name and lets the next step read them. It cannot
          be undone — a later change means running this step again.
        </p>

        <button
          type="button"
          disabled={pending || blocked.length > 0 || needsNote}
          title={
            blocked.length > 0
              ? `Still without a value: ${blocked.map((b) => b.label).join(", ")}`
              : needsNote
                ? "The figures do not add up – correct one, or give a reason above"
                : undefined
          }
          onClick={() =>
            act(async () => {
              const outcome = await signOffRun(projectId, run.id, note);
              setRefusal(outcome.ok ? null : outcome.reason);
            })
          }
          className="t-base flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--n-800)] px-3 font-medium text-white transition-colors hover:bg-[var(--n-900)] disabled:cursor-not-allowed disabled:opacity-40"
          style={{ transitionDuration: "var(--m-fast)" }}
        >
          <Lock aria-hidden size={13} strokeWidth={2.25} />
          {pending ? "Signing…" : `Sign off as ${signer}`}
        </button>

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
 * Take the reader to the field that is blocking them, and put the cursor in it.
 *
 * The row carries `data-field`; its override input is the only text box inside it. Scrolling
 * without focusing leaves somebody looking at the right row and still hunting for the box, and
 * focusing without scrolling moves a cursor they cannot see.
 */
function revealField(fieldId: string) {
  const row = document.querySelector(`[data-field="${fieldId}"]`);
  if (!row) return;

  row.scrollIntoView({ behavior: "smooth", block: "center" });
  const input = row.querySelector("input, textarea");
  if (input instanceof HTMLElement) input.focus({ preventScroll: true });
}

/** Open a run to fill by hand (audit C2). Refusals in words, beside the button. */
function EnterByHand({ projectId, module }: { projectId: string; module: string }) {
  const router = useRouter();
  const [pending, act] = useTransition();
  const [refusal, setRefusal] = useState<string | null>(null);

  return (
    <div className="flex shrink-0 flex-col items-end">
      <button
        type="button"
        data-action="enter-by-hand"
        disabled={pending}
        onClick={() =>
          act(async () => {
            const outcome = await enterByHand(projectId, module);
            setRefusal(outcome.ok ? null : outcome.reason);
            router.refresh();
          })
        }
        className="t-base flex h-8 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--n-300)] bg-[var(--n-0)] px-3 font-medium text-[var(--n-700)] transition-colors hover:border-[var(--n-400)] hover:bg-[var(--n-50)] disabled:cursor-not-allowed disabled:opacity-50"
        style={{ transitionDuration: "var(--m-fast)" }}
      >
        <PenLine aria-hidden size={13} strokeWidth={2} />
        {pending ? "Opening…" : "Enter by hand"}
      </button>
      {refusal && (
        <p role="alert" className="t-sm mt-1 max-w-[40ch] text-right text-[var(--err-700)]">
          {refusal}
        </p>
      )}
    </div>
  );
}

function Tally({
  found,
  uncertain,
  missing,
  corrected = 0,
  byHand = false,
  spend,
  aside,
}: {
  found: number;
  uncertain: number;
  missing: number;
  corrected?: number;
  /** Opened by hand: nothing was read, so "found" can only mean carried and a gap is "to enter". */
  byHand?: boolean;
  spend: { input: number; output: number; rand: number | null } | null | undefined;
  aside?: string;
}) {
  return (
    <div className="t-sm flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--n-100)] px-4 py-2">
      {byHand ? (
        <>
          <span className="text-[var(--n-700)]">Entered by hand</span>
          {found > 0 && <span className="text-[var(--ok-700)]">{found} carried from signed steps</span>}
          {missing > 0 && <span className="text-[var(--warn-700)]">{missing} to enter</span>}
        </>
      ) : (
        <>
          <span className="text-[var(--ok-700)]">{found} found</span>
          {uncertain > 0 && <span className="text-[var(--warn-700)]">{uncertain} need review</span>}
          {missing > 0 && <span className="text-[var(--n-500)]">{missing} not in the corpus</span>}
        </>
      )}
      {corrected > 0 && <span className="text-[var(--a-600)]">{corrected} corrected by hand</span>}
      {aside && <span className="ml-auto text-[var(--n-500)]">{aside}</span>}
      {/* What it cost. Shown because a run a QS can start is a run a QS is spending on. */}
      {spend && (
        <span className="num t-xs text-[var(--n-400)]">
          {(spend.input + spend.output).toLocaleString()} tokens
          {spend.rand !== null && ` · $${spend.rand.toFixed(4)}`}
        </span>
      )}
    </div>
  );
}
