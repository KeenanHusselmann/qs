/**
 * A rate, and what it is made of — PLATFORM.md §4.8.
 *
 * *"Component rows (Labour / Material / Plant / Subcontract / Other) with quantity and unit rate,
 * then waste %, markup %, computed rate. A manual 'plug' override that is flagged, never hidden."*
 *
 * ── Why it shows the working and not just the answer ───────────────────────────────────────
 *
 * §1.1's case for this product is that a QS reuses a rate instead of rebuilding it, and §6.3 says
 * plainly why that needs provenance: *"a rate nobody can defend does not get reused"*. A build-up
 * that printed only its total would be a number of unknown origin with extra steps. So every
 * component's own cost sits beside it, and net, waste and markup are three lines a reader can add
 * up by hand — which is also §5.2's actual test.
 *
 * ── It computes on the screen and again on the server, with one function ───────────────────
 *
 * `readBuildUpDraft` turns what was typed into figures and `computeBuildUp` works them out; both
 * live in `@/lib/pricing` and both run here **and** in `saveBuildUp`. That is not duplication, it
 * is the same code called twice: the rate appears the moment somebody stops typing rather than
 * after a round trip, and it cannot differ from the one written to the row, because neither copy
 * has its own opinion about what `1,234` means.
 *
 * ── Inline, not a drawer ──────────────────────────────────────────────────────────────────
 *
 * §7.5 specifies a right drawer for row detail and this platform has never built one. Rather than
 * introduce the first one here — where it would be judged against a component that does not exist
 * anywhere else in the product — the build-up expands under its row, which is the idiom the bill
 * grid already established for a row's own evidence. The drawer arrives with the screen that needs
 * a drawer, and this moves into it.
 */

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Sparkles, Trash2, X } from "lucide-react";

import { MoneyCell } from "@/components/agent/money-cell";
import { proposeBuildUp, removeBuildUp, saveBuildUp } from "@/app/(app)/projects/[id]/pricing-actions";
import {
  COMPONENT_KINDS,
  COMPONENT_KIND_LABEL,
  EMPTY_COMPONENT,
  EMPTY_DRAFT,
  computeBuildUp,
  draftOf,
  formatWireRate,
  readBuildUpDraft,
  type BuildUp,
  type BuildUpDraft,
  type ComponentKind,
} from "@/lib/pricing";

export function BuildUpEditor({
  projectId,
  runId,
  itemId,
  unit,
  buildUp,
  onClose,
}: {
  projectId: string;
  runId: string;
  itemId: string;
  /** The bill item's unit, so the editor can say what "one" of it is. */
  unit: string | null;
  buildUp: BuildUp | null;
  onClose: () => void;
}) {
  const router = useRouter();

  /**
   * The draft is read from the server once, on open, and is the QS's from then on.
   *
   * It deliberately does **not** re-sync after a save, and the reason is §13.4 — never lose a
   * user's work. A figure the server refused is stored as null, so pulling the stored state back in
   * would blank the cell somebody had just typed `1,234` into, at the exact moment they need to see
   * it in order to correct it. The refusal is named below and the text stays where they put it.
   *
   * What is not stale is the arithmetic: the working underneath is computed from this draft by the
   * same function the server ran, so the rate on screen is the rate on the row.
   */
  const [draft, setDraft] = useState<BuildUpDraft>(() =>
    buildUp ? draftOf(buildUp) : EMPTY_DRAFT,
  );
  const [busy, act] = useTransition();
  const [refusal, setRefusal] = useState<string | null>(null);
  /** What a proposed method said it assumed, and what the library could not price. */
  const [proposal, setProposal] = useState<{ note: string | null; unpriced: string[] } | null>(null);

  // The same reading and the same arithmetic the server is about to do (see the note above).
  const read = readBuildUpDraft(draft, { id: buildUp?.id ?? "", itemId, by: buildUp?.by ?? "" });
  const worked = computeBuildUp(read.buildUp);

  const save = (next: BuildUpDraft) =>
    act(async () => {
      const outcome = await saveBuildUp(projectId, runId, itemId, next);
      setRefusal(outcome.ok ? null : outcome.reason);
      if (outcome.ok) router.refresh();
    });

  /** Change one field, keep it on screen immediately, and persist the whole build-up. */
  const change = (next: BuildUpDraft, persist = true) => {
    setDraft(next);
    if (persist) save(next);
  };

  const setComponent = (index: number, patch: Partial<BuildUpDraft["components"][number]>) => ({
    ...draft,
    components: draft.components.map((component, i) =>
      i === index ? { ...component, ...patch } : component,
    ),
  });

  /**
   * Ask what this item is made of — §4.8, and the ASAQS finding turned into a design.
   *
   * ASAQS asked ChatGPT what a one-brick wall costs; it answered about R215/m² from essentially one
   * website, and practising quantity surveyors assessed the result inaccurate. The mistake is in the
   * question. This asks what the item is *made of* and takes back quantities only — 104 bricks and
   * 1,2 hours of a bricklayer in a square metre — and prices every one of them from this practice's
   * own library.
   *
   * It fills the draft rather than saving it. Nothing reaches the row until the QS presses Save, the
   * same as a build-up they typed, and a line the library could not price arrives **empty** rather
   * than at nought so the working underneath counts it as incomplete out loud.
   */
  const propose = () =>
    act(async () => {
      setRefusal(null);
      setProposal(null);

      const outcome = await proposeBuildUp(projectId, runId, itemId);
      if (!outcome.ok) {
        setRefusal(outcome.reason);
        return;
      }

      setDraft(outcome.draft);
      setProposal({ note: outcome.note, unpriced: outcome.unpriced });
    });

  const per = unit ? `one ${unit}` : "one unit";

  return (
    <div data-region="build-up" className="rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--n-100)] px-3 py-2">
        <p className="t-sm font-medium text-[var(--n-700)]">Rate build-up</p>
        <p className="t-sm text-[var(--n-500)]">
          Quantities are what goes into <span className="font-medium">{per}</span> of this item.
        </p>
        {/*
          Proposed, never applied. It writes into the draft the QS is already editing and stops
          there — the model's part is the method, and the decision stays where it was.
        */}
        <button
          type="button"
          onClick={propose}
          disabled={busy}
          title="Ask what this item is made of. Quantities only — every price comes from the rate library."
          className="t-sm ml-auto inline-flex h-7 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--n-200)] px-2 font-medium text-[var(--n-700)] hover:bg-[var(--n-50)] disabled:opacity-40"
        >
          <Sparkles aria-hidden size={12} strokeWidth={2} />
          {busy ? "Working…" : "Propose a method"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="t-sm inline-flex items-center gap-1 text-[var(--n-600)] underline underline-offset-2"
        >
          <X aria-hidden size={12} strokeWidth={2} />
          Close
        </button>
      </div>

      {refusal && (
        <p role="alert" className="t-sm border-b border-[var(--n-100)] px-3 py-2 text-[var(--err-700)]">
          {refusal}
        </p>
      )}

      {/*
        What a proposal assumed, and what it could not price.

        Both are said before the reader looks at the figure, because both change what the figure
        means. A line the library has no rate for is **empty**, not nought — the working below counts
        it as incomplete — and naming them here is what stops a rate that is knowably short from
        reading as a finished one.
      */}
      {proposal && (
        <div
          data-region="proposed-method"
          className="border-b border-[var(--n-100)] bg-[var(--n-25)] px-3 py-2"
        >
          <p className="t-xs font-semibold tracking-[0.06em] text-[var(--n-500)] uppercase">
            Proposed method — quantities only
          </p>
          <p className="t-sm mt-1 text-[var(--n-600)]">
            The resources were proposed; every rate beside them came from your library. Check the
            quantities against how you would build this item.
          </p>
          {proposal.note && <p className="t-sm mt-1 text-[var(--n-600)]">{proposal.note}</p>}
          {proposal.unpriced.length > 0 && (
            <p className="t-sm mt-1 text-[var(--warn-700)]">
              The library has no rate for {proposal.unpriced.join(", ")} — those lines are empty and
              contribute nothing, so the rate below is short until they are priced.
            </p>
          )}
        </div>
      )}

      <table className="w-full table-fixed">
        <colgroup>
          <col className="w-[16%]" />
          <col className="w-[36%]" />
          <col className="w-[14%]" />
          <col className="w-[16%]" />
          <col className="w-[14%]" />
          <col className="w-[4%]" />
        </colgroup>
        <thead>
          <tr className="border-b border-[var(--n-100)]">
            {[
              ["Kind", false],
              ["Description", false],
              ["Qty", true],
              ["Rate (R)", true],
              ["Cost (R)", true],
              ["", false],
            ].map(([heading, numeric], i) => (
              <th
                key={i}
                scope="col"
                className={`t-sm px-2 py-1.5 font-semibold tracking-[0.03em] text-[var(--n-500)] uppercase ${
                  numeric ? "text-right" : "text-left"
                }`}
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {draft.components.map((component, index) => (
            <tr key={index} data-component={index} className="border-b border-[var(--n-100)] last:border-0">
              <td className="px-2 py-1">
                <select
                  aria-label={`Kind, component ${index + 1}`}
                  value={component.kind}
                  onChange={(event) =>
                    change(setComponent(index, { kind: event.target.value as ComponentKind }))
                  }
                  className="t-base h-7 w-full rounded-[var(--r-sm)] border border-[var(--n-200)] bg-[var(--n-0)] px-1 outline-none focus:border-[var(--a-500)]"
                >
                  {COMPONENT_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {COMPONENT_KIND_LABEL[kind]}
                    </option>
                  ))}
                </select>
              </td>

              <Text
                label={`Description, component ${index + 1}`}
                value={component.description}
                placeholder="42,5N cement"
                onType={(value) => setDraft(setComponent(index, { description: value }))}
                onCommit={() => save(draft)}
              />
              <Text
                label={`Quantity, component ${index + 1}`}
                value={component.quantity}
                placeholder="0,35"
                numeric
                onType={(value) => setDraft(setComponent(index, { quantity: value }))}
                onCommit={() => save(draft)}
              />
              <Text
                label={`Rate, component ${index + 1}`}
                value={component.rate}
                placeholder="2 400,00"
                numeric
                onType={(value) => setDraft(setComponent(index, { rate: value }))}
                onCommit={() => save(draft)}
              />

              <td className="px-2 py-1 text-right">
                <MoneyCell minorUnits={worked.lines[index] ?? null} />
              </td>

              <td className="px-2 py-1 text-right">
                <button
                  type="button"
                  aria-label={`Remove component ${index + 1}`}
                  disabled={busy || draft.components.length === 1}
                  onClick={() =>
                    change({
                      ...draft,
                      components: draft.components.filter((_, i) => i !== index),
                    })
                  }
                  className="text-[var(--n-500)] disabled:text-[var(--n-300)]"
                >
                  <Trash2 aria-hidden size={12} strokeWidth={2} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex flex-wrap items-end gap-4 border-t border-[var(--n-100)] px-3 py-2">
        {/*
          **Not disabled while a save is in flight**, and this is the same lesson the bill grid
          records: a control that goes dead for the length of a round trip swallows the next thing a
          person does, and on a busy machine that round trip is long enough to notice. It is also
          safe here by construction — adding a row touches local state only, and the next blur sends
          the whole build-up, so nothing typed into the new row can be lost by a save already
          in flight.
        */}
        <button
          type="button"
          data-act="add-component"
          onClick={() =>
            change({ ...draft, components: [...draft.components, EMPTY_COMPONENT] }, false)
          }
          className="t-sm inline-flex h-7 items-center gap-1 rounded-[var(--r-md)] border border-[var(--n-200)] px-2 text-[var(--n-600)] transition-colors hover:border-[var(--n-300)] hover:bg-[var(--n-50)]"
          style={{ transitionDuration: "var(--m-fast)" }}
        >
          <Plus aria-hidden size={12} strokeWidth={2} />
          Add a component
        </button>

        <Percent
          id={`waste-${itemId}`}
          label="Waste"
          value={draft.waste}
          onType={(value) => setDraft({ ...draft, waste: value })}
          onCommit={() => save(draft)}
        />
        <Percent
          id={`markup-${itemId}`}
          label="Markup"
          value={draft.markup}
          onType={(value) => setDraft({ ...draft, markup: value })}
          onCommit={() => save(draft)}
        />

        {/*
          §4.8's plug. It sits beside the figures it overrides rather than behind a control that
          reveals it, because "flagged, never hidden" is a statement about the screen at rest.
        */}
        <div className="flex flex-col gap-0.5">
          <label htmlFor={`plug-${itemId}`} className="t-sm text-[var(--n-600)]">
            Use this rate instead
          </label>
          <input
            id={`plug-${itemId}`}
            data-cell="plug"
            value={draft.plug}
            placeholder="optional"
            onChange={(event) => setDraft({ ...draft, plug: event.target.value })}
            onBlur={() => save(draft)}
            className="num t-base h-7 w-28 rounded-[var(--r-sm)] border border-[var(--n-200)] bg-[var(--n-0)] px-2 text-right outline-none focus:border-[var(--a-500)]"
          />
        </div>

        {buildUp && (
          <button
            type="button"
            data-act="remove-build-up"
            disabled={busy}
            onClick={() =>
              act(async () => {
                const outcome = await removeBuildUp(projectId, runId, itemId);
                setRefusal(outcome.ok ? null : outcome.reason);
                if (outcome.ok) {
                  onClose();
                  router.refresh();
                }
              })
            }
            title="Remove the build-up, and the rate it set with it"
            className="t-sm ml-auto text-[var(--n-600)] underline underline-offset-2 disabled:text-[var(--n-300)]"
          >
            Remove this build-up
          </button>
        )}
      </div>

      {/* The working, as a QS would write it — and the reason a reader can check the rate by hand. */}
      <dl
        data-region="build-up-total"
        className="t-sm flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-[var(--n-100)] bg-[var(--n-50)] px-3 py-2"
      >
        <Line label="Components" value={worked.net} />
        <Line label="Waste" value={worked.waste} />
        <Line label="Markup" value={worked.markup} />
        <div className="flex items-baseline gap-1.5">
          <dt className="font-medium text-[var(--n-700)]">
            {worked.plugged ? "Build-up computes" : "Rate"}
          </dt>
          <dd className="num font-semibold text-[var(--n-800)]">
            R {formatWireRate(worked.computed)}
          </dd>
        </div>

        {worked.plugged && (
          <div className="flex items-baseline gap-1.5">
            <dt className="font-medium text-[var(--warn-700)]">Applied instead</dt>
            <dd className="num font-semibold text-[var(--warn-700)]">
              R {formatWireRate(worked.applied)}
            </dd>
          </div>
        )}

        {/*
          §5 — a rate quietly short by one line is the confident wrong number this is arranged
          against. Counted rather than silently skipped, whether the figure is missing or refused.
        */}
        {worked.incomplete > 0 && (
          <span className="text-[var(--n-500)]">
            {worked.incomplete} {worked.incomplete === 1 ? "component has" : "components have"} no
            quantity or rate yet, and {worked.incomplete === 1 ? "adds" : "add"} nothing
          </span>
        )}

        {busy && <span className="ml-auto text-[var(--n-500)]">Saving…</span>}
      </dl>

      {read.refusals.length > 0 && (
        <div role="alert" className="border-t border-[var(--n-100)] bg-[var(--warn-50)] px-3 py-2">
          <p className="t-sm font-medium text-[var(--warn-700)]">
            {read.refusals.length === 1 ? "One figure was" : `${read.refusals.length} figures were`}{" "}
            not read, because {read.refusals.length === 1 ? "it" : "they"} could not be read with
            certainty:
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {read.refusals.map((entry) => (
              <li key={entry.at} className="t-sm text-[var(--n-700)]">
                <span className="font-medium">{entry.at}</span> — {entry.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** One figure of the working, right-aligned and tabular like every other money on the screen. */
function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-[var(--n-600)]">{label}</dt>
      <dd>
        <MoneyCell minorUnits={value} />
      </dd>
    </div>
  );
}

/**
 * A cell of the component table.
 *
 * Typing is local and saving happens on blur, which is the idiom both grids use: a round trip per
 * keystroke would put §7.9's 16ms keystroke budget behind a network call.
 */
function Text({
  label,
  value,
  placeholder,
  numeric = false,
  onType,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder: string;
  numeric?: boolean;
  onType: (value: string) => void;
  onCommit: () => void;
}) {
  return (
    <td className="px-2 py-1">
      <input
        aria-label={label}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onType(event.target.value)}
        onBlur={onCommit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        className={`t-base h-7 w-full rounded-[var(--r-sm)] border border-[var(--n-200)] bg-[var(--n-0)] px-1.5 outline-none focus:border-[var(--a-500)] ${
          numeric ? "num text-right" : ""
        }`}
      />
    </td>
  );
}

function Percent({
  id,
  label,
  value,
  onType,
  onCommit,
}: {
  id: string;
  label: string;
  value: string;
  onType: (value: string) => void;
  onCommit: () => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <label htmlFor={id} className="t-sm text-[var(--n-600)]">
        {label} %
      </label>
      <input
        id={id}
        data-cell={label.toLowerCase()}
        value={value}
        placeholder="0"
        onChange={(event) => onType(event.target.value)}
        onBlur={onCommit}
        className="num t-base h-7 w-16 rounded-[var(--r-sm)] border border-[var(--n-200)] bg-[var(--n-0)] px-2 text-right outline-none focus:border-[var(--a-500)]"
      />
    </div>
  );
}
