/**
 * The side card: what this step needs, and the tick against each one.
 *
 * ── Two ways an item gets ticked, and they are not the same claim ──────────────────────────
 *
 * A filed document whose text grounds the criterion ticks it **automatically** — that box is filled,
 * and it is not yours to change, because what backs it is a passage that can be quoted (§1.3.2).
 *
 * Everything else you tick yourself, and the tick is recorded with your name and the time
 * (§1.3.3). That is the manual audit trail: months later, "who said the stakeholder register was
 * handled, and when" has an answer. An outlined box rather than a filled one, so a reviewer can see
 * at a glance which items rest on a document and which rest on a person.
 *
 * Where a criterion is not declarable — a client mandate is not something anyone may simply assert
 * — the tick is still recorded and still shown, but the item stays blocking. The record of the
 * claim is worth keeping even where the claim cannot open the gate, and saying so is better than
 * refusing the tick and explaining nothing.
 */

"use client";

import { useState, useTransition } from "react";
import { Check, Lock } from "lucide-react";

import { Panel } from "@/components/shell/panel";
import { formatDate } from "@/lib/dates";
import { setCriterionChecked } from "@/app/(app)/projects/[id]/actions";
import type { CriterionOutcome } from "@/lib/criteria-status";

export interface CheckRecord {
  checkedBy: string;
  checkedAt: Date;
}

export function ChecklistCard({
  projectId,
  outcomes,
  checks,
}: {
  projectId: string;
  outcomes: readonly CriterionOutcome[];
  checks: ReadonlyMap<string, CheckRecord>;
}) {
  const done = outcomes.filter(
    (o) => o.state === "satisfied" || checks.has(o.criterion.id),
  ).length;

  return (
    <aside className="w-[320px] shrink-0">
      {/*
        The same panel as everything beside it. This card was the module page's one bordered
        section, in its own dialect — a tinted body and an untinted header — against a readiness
        list that wore no container at all. Both are panels now, so the two columns read as two
        sections of one page rather than as a card next to some text.

        **The count says "ticked", and the list beside it says "filed", because they are not the
        same claim.** A requirement is filed when a passage in the corpus grounds it; it is ticked
        when that has happened *or* when a named person said so (§1.3.3). Two bare ratios one
        column apart, differing by one, would read as an error in one of them.
      */}
      <div className="sticky top-6">
        <Panel title="Checklist" count={`${done}/${outcomes.length} ticked`} flush>
          <ul className="flex flex-col px-2 py-1.5">
            {outcomes.map((outcome) => (
              <Item
                key={outcome.criterion.id}
                projectId={projectId}
                outcome={outcome}
                check={checks.get(outcome.criterion.id)}
              />
            ))}
          </ul>
        </Panel>
      </div>
    </aside>
  );
}

function Item({
  projectId,
  outcome,
  check,
}: {
  projectId: string;
  outcome: CriterionOutcome;
  check?: CheckRecord;
}) {
  const { criterion, state, evidence } = outcome;
  const [pending, start] = useTransition();

  // The server is the truth, but a checkbox that waits for a round trip feels broken.
  const [optimistic, setOptimistic] = useState<boolean | null>(null);

  const automatic = state === "satisfied";
  const ticked = automatic || (optimistic ?? Boolean(check));

  function toggle(next: boolean) {
    setOptimistic(next);
    start(async () => {
      await setCriterionChecked(projectId, criterion.id, next);
      setOptimistic(null);
    });
  }

  return (
    <li className="rounded-[var(--r-sm)] px-2 py-2 hover:bg-[var(--n-50)]">
      <label className={`flex gap-2.5 ${automatic ? "cursor-default" : "cursor-pointer"}`}>
        <input
          type="checkbox"
          checked={ticked}
          disabled={automatic || pending}
          onChange={(e) => toggle(e.target.checked)}
          className="peer sr-only"
        />

        <span
          aria-hidden
          className={`mt-px grid size-[17px] shrink-0 place-items-center rounded-[4px] border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--a-500)] ${
            automatic
              ? "border-[var(--ok-500)] bg-[var(--ok-500)]"
              : ticked
                ? "border-[var(--ok-500)] bg-[var(--ok-50)]"
                : "border-[var(--n-300)] bg-[var(--n-0)]"
          }`}
          style={{ transitionDuration: "var(--m-fast)" }}
        >
          {ticked && (
            <Check
              size={12}
              strokeWidth={3}
              className={automatic ? "text-white" : "text-[var(--ok-700)]"}
            />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="t-sm flex items-center gap-1.5 text-[var(--n-800)]">
            <span className="min-w-0 truncate">{criterion.label}</span>
            {automatic && (
              <Lock
                aria-label="Ticked by a filed document — not editable"
                size={11}
                strokeWidth={2}
                className="shrink-0 text-[var(--n-400)]"
              />
            )}
          </span>

          {/* The attribution. This is the whole point of the manual tick. */}
          {automatic ? (
            <span className="t-xs mt-0.5 block truncate text-[var(--n-500)]">
              {evidence?.document ?? "From a filed document"}
            </span>
          ) : check ? (
            <span className="t-xs mt-0.5 block text-[var(--n-500)]">
              {check.checkedBy} · {formatDate(check.checkedAt)}
              {!criterion.declarable && (
                <span className="text-[var(--warn-700)]"> · still needs the document</span>
              )}
            </span>
          ) : (
            <span className="t-xs mt-0.5 block text-[var(--n-400)]">
              {criterion.weight === "mandatory" ? "Required" : "Optional"}
            </span>
          )}
        </span>
      </label>
    </li>
  );
}
