/**
 * The entry-criteria panel — PLATFORM.md §1.3.3.
 *
 * Two panes, following §4.5's library browser: processes on the left, that process's checklist on
 * the right. A QS configures the firm's standard here; a project's runs are then gated by it.
 *
 * **Edits do not persist yet.** There is no database, so this holds its state in the component and
 * says so on the page. §1.3's integrity rule applies to an interface too — a panel that appeared to
 * save and silently forgot would be worse than one that admits it.
 */

"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { DEFAULT_CRITERIA, type Criterion, type CriterionWeight } from "@/lib/entry-criteria";
import { PROCESS_AREAS } from "@/lib/process-model";

export function CriteriaPanel() {
  const [criteria, setCriteria] = useState<readonly Criterion[]>(DEFAULT_CRITERIA);
  const [selected, setSelected] = useState("D1.1");

  /** Every process area, with how many criteria it carries. Areas with none show as unconfigured. */
  const processes = useMemo(
    () =>
      PROCESS_AREAS.map((area) => ({
        code: area.code,
        name: area.name,
        phase: area.phase,
        count: criteria.filter((c) => c.process === area.code).length,
      })),
    [criteria],
  );

  const forSelected = criteria.filter((c) => c.process === selected);
  const area = PROCESS_AREAS.find((a) => a.code === selected);
  const mandatoryCount = forSelected.filter((c) => c.weight === "mandatory").length;

  function addCriterion(label: string) {
    const trimmed = label.trim();
    if (!trimmed) return;

    setCriteria((current) => [
      ...current,
      {
        id: `${selected}-${Date.now()}`,
        process: selected,
        // Filed alongside the criteria already on this process. A new one with no module would
        // exist in the config and appear on no page at all — see scripts/check-modules.mjs.
        module: criteria.find((c) => c.process === selected)?.module ?? "/inputs",
        label: trimmed,
        detail: "",
        weight: "mandatory",
        acceptedEvidence: [],
        declarable: false,
      },
    ]);
  }

  const removeCriterion = (id: string) =>
    setCriteria((current) => current.filter((c) => c.id !== id));

  const setWeight = (id: string, weight: CriterionWeight) =>
    setCriteria((current) => current.map((c) => (c.id === id ? { ...c, weight } : c)));

  const setDeclarable = (id: string, declarable: boolean) =>
    setCriteria((current) => current.map((c) => (c.id === id ? { ...c, declarable } : c)));

  return (
    <div className="flex h-full min-h-0">
      {/* ── Processes ─────────────────────────────────────────────────────────────────── */}
      <div className="flex w-[280px] shrink-0 flex-col border-r border-[var(--n-100)]">
        <div className="border-b border-[var(--n-100)] px-4 py-3">
          <h2 className="t-sm font-semibold tracking-[0.03em] text-[var(--n-500)] uppercase">
            Process
          </h2>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto p-2">
          {processes.map((process) => {
            const active = process.code === selected;
            return (
              <li key={process.code}>
                <button
                  type="button"
                  onClick={() => setSelected(process.code)}
                  aria-current={active ? "true" : undefined}
                  className={`flex w-full items-baseline gap-2 rounded-[var(--r-sm)] px-2 py-1.5 text-left transition-colors ${
                    active
                      ? "bg-[var(--a-50)] text-[var(--a-700)]"
                      : "text-[var(--n-600)] hover:bg-[var(--n-50)]"
                  }`}
                  style={{ transitionDuration: "var(--m-fast)" }}
                >
                  <span className="t-xs w-9 shrink-0 font-medium text-[var(--n-400)]">
                    {process.code}
                  </span>
                  <span className="t-base truncate">{process.name}</span>
                  <span
                    className={`num t-xs ml-auto shrink-0 ${
                      process.count > 0 ? "text-[var(--n-500)]" : "text-[var(--n-300)]"
                    }`}
                  >
                    {process.count > 0 ? process.count : "—"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* ── Checklist ─────────────────────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-[var(--n-100)] px-6 py-4">
          <div className="flex items-baseline gap-2">
            <span className="t-sm font-medium text-[var(--n-400)]">{selected}</span>
            <h1 className="t-xl text-[var(--n-800)]">{area?.name ?? "Unknown process"}</h1>
          </div>
          <p className="t-md mt-1 max-w-[70ch] text-[var(--n-500)]">
            What this process needs before it may begin. {mandatoryCount} of {forSelected.length}{" "}
            {mandatoryCount === 1 ? "item blocks" : "items block"} the run when missing; the rest are
            flagged and carry a stated fallback.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {forSelected.length === 0 ? (
            <div className="mx-6 my-8 max-w-[420px] rounded-[var(--r-lg)] border border-dashed border-[var(--n-200)] px-6 py-8 text-center">
              <h3 className="t-lg text-[var(--n-800)]">No checklist yet</h3>
              <p className="t-md mt-1 text-[var(--n-500)]">
                This process has no entry criteria configured, so nothing gates it. Add the first
                item below.
              </p>
            </div>
          ) : (
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10 bg-[var(--n-50)]">
                <tr className="h-9 text-left">
                  {["Required input", "Accepted evidence", "Blocks", "Declarable", ""].map((h) => (
                    <th
                      key={h}
                      scope="col"
                      className="t-sm border-b border-[var(--n-200)] px-3 font-semibold tracking-[0.03em] text-[var(--n-600)] uppercase"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {forSelected.map((criterion) => (
                  <tr
                    key={criterion.id}
                    className="border-b border-[var(--n-100)] align-top hover:bg-[var(--n-25)]"
                  >
                    <td className="max-w-[340px] px-3 py-2.5">
                      <div className="t-base font-medium text-[var(--n-800)]">{criterion.label}</div>
                      {criterion.detail && (
                        <p className="t-sm mt-0.5 text-[var(--n-500)]">{criterion.detail}</p>
                      )}
                      {/*
                        §1.3.3 — the fallback is declared up front, not decided at report time.
                        Amber because it changes what the run may conclude (§7.2).
                      */}
                      {criterion.fallback && (
                        <p className="t-sm mt-1.5 rounded-[var(--r-sm)] bg-[var(--warn-50)] px-2 py-1 text-[var(--warn-700)]">
                          If absent: {criterion.fallback}
                        </p>
                      )}
                    </td>

                    <td className="max-w-[220px] px-3 py-2.5">
                      {criterion.acceptedEvidence.length === 0 ? (
                        <span className="t-sm text-[var(--n-400)]">Not specified</span>
                      ) : (
                        <ul className="flex flex-wrap gap-1">
                          {criterion.acceptedEvidence.map((evidence) => (
                            <li
                              key={evidence}
                              className="t-xs rounded-[var(--r-sm)] bg-[var(--n-100)] px-1.5 py-0.5 text-[var(--n-600)]"
                            >
                              {evidence}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>

                    <td className="px-3 py-2.5">
                      <select
                        value={criterion.weight}
                        onChange={(e) => setWeight(criterion.id, e.target.value as CriterionWeight)}
                        aria-label={`Does ${criterion.label} block the run?`}
                        className="t-sm h-7 rounded-[var(--r-sm)] border border-[var(--n-200)] bg-[var(--n-0)] px-1.5 text-[var(--n-700)]"
                      >
                        <option value="mandatory">Blocks</option>
                        <option value="advisory">Flags</option>
                      </select>
                    </td>

                    <td className="px-3 py-2.5">
                      <label className="t-sm flex items-center gap-1.5 text-[var(--n-600)]">
                        <input
                          type="checkbox"
                          checked={criterion.declarable}
                          onChange={(e) => setDeclarable(criterion.id, e.target.checked)}
                          className="size-3.5 accent-[var(--a-500)]"
                        />
                        {criterion.declarable ? "Yes" : "No"}
                      </label>
                    </td>

                    <td className="px-3 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => removeCriterion(criterion.id)}
                        aria-label={`Remove ${criterion.label}`}
                        className="grid size-6 place-items-center rounded-[var(--r-sm)] text-[var(--n-400)] transition-colors hover:bg-[var(--err-50)] hover:text-[var(--err-500)]"
                        style={{ transitionDuration: "var(--m-fast)" }}
                      >
                        <Trash2 aria-hidden size={14} strokeWidth={1.75} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <AddCriterion onAdd={addCriterion} />

          <p className="t-sm mx-6 mt-6 mb-8 max-w-[70ch] rounded-[var(--r-sm)] bg-[var(--n-50)] px-3 py-2 text-[var(--n-500)]">
            Changes are not saved — there is no database yet. The checklist above is the shipped
            default, drawn from the process model&rsquo;s own input columns; a firm edits it to match
            how it works.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Adding a criterion. Label only — the rest is edited on the row once it exists. */
function AddCriterion({ onAdd }: { onAdd: (label: string) => void }) {
  const [label, setLabel] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onAdd(label);
        setLabel("");
      }}
      className="flex items-center gap-2 px-3 py-3"
    >
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Add a required input…"
        aria-label="New criterion"
        className="t-base h-8 w-full max-w-[340px] rounded-[var(--r-sm)] border border-[var(--n-200)] bg-[var(--n-0)] px-2.5 text-[var(--n-800)] outline-none placeholder:text-[var(--n-400)] focus:border-[var(--a-500)]"
      />
      <button
        type="submit"
        disabled={!label.trim()}
        className="t-base flex h-8 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--n-200)] px-2.5 text-[var(--n-700)] transition-colors hover:bg-[var(--n-50)] disabled:opacity-40"
        style={{ transitionDuration: "var(--m-fast)" }}
      >
        <Plus aria-hidden size={14} strokeWidth={2} />
        Add
      </button>
    </form>
  );
}
