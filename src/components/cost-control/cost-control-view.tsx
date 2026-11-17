"use client";

/**
 * Design cost control – D1.1-SP-003, on one page.
 *
 * The answer first: the budget, the detailed estimate and the verdict, in a sentence that will not
 * call an incomplete estimate a saving. Then every line against its target, with the quantity
 * surveyor's reason for each movement typed beside it; then what the client decided, and the
 * history of those decisions; then the cost report to issue.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, Gauge } from "lucide-react";

import { recordDecision, setMovementNote } from "@/app/(app)/projects/[id]/cost-control-actions";
import { issueDocument } from "@/app/(app)/projects/[id]/document-actions";
import { DECISIONS, shareText, TOLERANCE_BP, type CostLineId, type Decision, type LineStatus, type Verdict } from "@/domain/cost-control";
import { formatMoney, money } from "@/domain/money";
import { formatDate } from "@/lib/dates";

export interface CostControlData {
  costPlan: { by: string; at: string } | null;
  bill: { signed: boolean; by: string | null; at: string | null } | null;
  check: {
    lines: {
      id: CostLineId;
      label: string;
      target: string | null;
      unreadable: string | null;
      detailed: string;
      items: number;
      unpriced: number;
      movement: string | null;
      movementBp: number | null;
      status: LineStatus;
    }[];
    budget: string | null;
    budgetSource: "cost-plan" | "revised" | null;
    budgetUnreadable: string | null;
    detailed: string;
    movement: string | null;
    movementBp: number | null;
    verdict: Verdict;
    findings: string[];
  } | null;
  notes: Partial<Record<CostLineId, { note: string; by: string; at: string }>>;
  decisions: {
    id: string;
    decision: Decision;
    note: string;
    revisedBudget: string | null;
    detailed: string;
    verdict: string;
    by: string;
    at: string;
    /** The revised budget the check is currently held to. */
    inForce: boolean;
  }[];
}

const R = (cents: string) => formatMoney(money(BigInt(cents)), { symbol: "R" });
const signed = (cents: string) => `${BigInt(cents) > 0n ? "+" : ""}${R(cents)}`;
// The domain's own share, from the cents – the page and the findings must not round differently.
const pct = (movement: string | null, base: string | null) =>
  movement === null || base === null ? null : shareText(money(BigInt(movement)), money(BigInt(base)), true);
const field = "t-sm w-full rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] px-2 text-[var(--n-800)]";

const VERDICT: Readonly<Record<Verdict, { label: string; tone: string }>> = {
  "within-budget": { label: "Within budget", tone: "bg-[var(--ok-50)] text-[var(--ok-700)]" },
  "over-budget": { label: "Over budget", tone: "bg-[var(--err-50)] text-[var(--err-700)]" },
  incomplete: { label: "Incomplete – not yet a saving", tone: "bg-[var(--warn-50)] text-[var(--warn-700)]" },
  "no-budget": { label: "No budget to check against", tone: "bg-[var(--n-100)] text-[var(--n-700)]" },
};

// Words beside the colour, never colour alone.
const STATUS: Readonly<Record<LineStatus, { label: string; tone: string }>> = {
  within: { label: "Within", tone: "text-[var(--n-600)]" },
  over: { label: "Over", tone: "font-semibold text-[var(--err-700)]" },
  under: { label: "Under", tone: "text-[var(--ok-700)]" },
  "no-target": { label: "No target", tone: "text-[var(--n-500)]" },
  "not-measured": { label: "Not measured", tone: "font-semibold text-[var(--warn-700)]" },
  unreadable: { label: "Unreadable", tone: "font-semibold text-[var(--warn-700)]" },
};

export function CostControlView({ projectId, projectName, data }: { projectId: string; projectName: string; data: CostControlData }) {
  const { check } = data;

  return (
    <section data-region="cost-control" className="mx-auto flex max-w-[1440px] flex-col gap-4 px-4 py-6 sm:px-8">
      <header className="flex flex-wrap items-start gap-3">
        <Gauge aria-hidden size={18} strokeWidth={1.75} className="mt-1 text-[var(--a-600)]" />
        <div className="min-w-0 flex-1">
          <h1 className="t-xl text-[var(--n-800)]">Cost Control</h1>
          <p className="t-md mt-0.5 max-w-[85ch] text-[var(--n-600)]">
            The detailed estimate for {projectName}, built from the priced bill, checked line by line against the targets in the signed Cost Plan. Say why each line moved; record what the client decided.
          </p>
        </div>
      </header>

      {!data.costPlan || !data.bill || !check ? (
        <Missing projectId={projectId} costPlan={Boolean(data.costPlan)} bill={Boolean(data.bill)} />
      ) : (
        <>
          <Sources data={data} projectId={projectId} />
          <Answer check={check} />
          <Lines projectId={projectId} check={check} notes={data.notes} />
          <DecisionPanel projectId={projectId} check={check} decisions={data.decisions} />
          <IssueReport projectId={projectId} />
        </>
      )}
    </section>
  );
}

/** What the check cannot run without, and where to get it. */
function Missing({ projectId, costPlan, bill }: { projectId: string; costPlan: boolean; bill: boolean }) {
  return (
    <div data-region="cost-missing" className="rounded-[var(--r-lg)] border border-[var(--n-200)] px-4 py-4">
      <p className="t-base font-medium text-[var(--n-800)]">There is nothing to check yet.</p>
      <ul className="t-sm mt-2 flex flex-col gap-1 text-[var(--n-700)]">
        {!costPlan && (
          <li>
            The targets come from a signed Cost Plan –{" "}
            <a href={`/projects/${projectId}/cost-plan`} className="font-medium text-[var(--a-700)] underline underline-offset-2">
              sign the Cost Plan
            </a>
            .
          </li>
        )}
        {!bill && (
          <li>
            The detailed estimate comes from a priced bill –{" "}
            <a href={`/projects/${projectId}/bill`} className="font-medium text-[var(--a-700)] underline underline-offset-2">
              draft the Bill of Quantities
            </a>
            .
          </li>
        )}
      </ul>
    </div>
  );
}

function Sources({ data, projectId }: { data: CostControlData; projectId: string }) {
  return (
    <p data-region="cost-sources" className="t-sm text-[var(--n-600)]">
      Targets from the Cost Plan signed off by {data.costPlan!.by} on {formatDate(data.costPlan!.at)}.{" "}
      {data.bill!.signed ? (
        <>
          Detailed estimate from the bill signed off by {data.bill!.by} on {formatDate(data.bill!.at!)}.
        </>
      ) : (
        <span className="text-[var(--warn-700)]">Detailed estimate from the draft bill – it is not signed off, so this check moves with every change to it.</span>
      )}{" "}
      Preliminaries, contingency and escalation are the allowances set on the{" "}
      <a href={`/projects/${projectId}/cost-plan`} className="text-[var(--a-700)] underline underline-offset-2">
        Cost Plan
      </a>
      . All figures exclude VAT.
    </p>
  );
}

function Answer({ check }: { check: NonNullable<CostControlData["check"]> }) {
  const verdict = VERDICT[check.verdict];
  return (
    <div className="rounded-[var(--r-lg)] border border-[var(--n-200)]">
      <div className="grid grid-cols-1 gap-px bg-[var(--n-100)] sm:grid-cols-3">
        {[
          {
            label: check.budgetSource === "revised" ? "Revised budget" : "Budget",
            value: check.budget === null ? (check.budgetUnreadable ? "Unreadable" : "–") : R(check.budget),
            note: check.budgetSource === "revised" ? "approved by the client" : check.budgetUnreadable ? `signed as "${check.budgetUnreadable}"` : "the Cost Plan's total",
          },
          { label: "Detailed estimate", value: R(check.detailed), note: "from the bill, with the allowances" },
          {
            label: "Movement",
            value: check.movement === null ? "–" : signed(check.movement),
            note: pct(check.movement, check.budget) === null ? "" : `${pct(check.movement, check.budget)} of the budget`,
          },
        ].map((t) => (
          <div key={t.label} className="bg-[var(--n-0)] px-4 py-3">
            <p className="t-xs font-semibold tracking-[0.03em] text-[var(--n-500)] uppercase">{t.label}</p>
            <p data-total={t.label} className="num mt-0.5 text-[1.25rem] leading-tight font-semibold text-[var(--n-900)]">
              {t.value}
            </p>
            <p className="t-xs mt-0.5 text-[var(--n-500)]">{t.note}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2 border-t border-[var(--n-100)] px-4 py-3">
        <p className="flex flex-wrap items-center gap-2">
          <span data-region="cost-verdict" data-verdict={check.verdict} className={`t-sm rounded-[var(--r-sm)] px-2 py-0.5 font-semibold ${verdict.tone}`}>
            {verdict.label}
          </span>
          {check.findings[0] && <span className="t-base text-[var(--n-800)]">{check.findings[0]}</span>}
        </p>
        {check.findings.length > 1 && (
          <ul data-region="cost-findings" className="t-sm flex list-disc flex-col gap-0.5 pl-5 text-[var(--n-700)]">
            {check.findings.slice(1).map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Lines({ projectId, check, notes }: { projectId: string; check: NonNullable<CostControlData["check"]>; notes: CostControlData["notes"] }) {
  return (
    <div className="overflow-x-auto rounded-[var(--r-lg)] border border-[var(--n-200)]">
      <table data-region="cost-lines" className="w-full min-w-[760px] border-collapse">
        <thead>
          <tr className="t-xs text-left font-semibold tracking-[0.03em] text-[var(--n-600)] uppercase">
            <th className="px-4 py-2">Line</th>
            <th className="px-2 py-2 text-right">Target</th>
            <th className="px-2 py-2 text-right">Detailed</th>
            <th className="px-2 py-2 text-right">Movement</th>
            <th className="px-2 py-2">Status</th>
            <th className="w-[32%] px-4 py-2">Why it moved</th>
          </tr>
        </thead>
        <tbody>
          {check.lines.map((l) => (
            <tr key={l.id} data-line={l.id} data-status={l.status} className="border-t border-[var(--n-100)] align-top">
              <td className="t-base px-4 py-2 text-[var(--n-800)]">
                {l.label}
                {l.unpriced > 0 && <span className="t-xs block text-[var(--warn-700)]">{l.unpriced} not priced</span>}
              </td>
              <td className="num t-sm px-2 py-2 text-right">{l.target === null ? (l.unreadable ? <span title={l.unreadable}>unreadable</span> : "–") : R(l.target)}</td>
              <td className="num t-sm px-2 py-2 text-right">{l.status === "not-measured" ? <span className="text-[var(--warn-700)]">not in the bill</span> : R(l.detailed)}</td>
              <td className="num t-sm px-2 py-2 text-right">
                {l.movement === null ? "–" : signed(l.movement)}
                {pct(l.movement, l.target) !== null && <span className="t-xs block text-[var(--n-500)]">{pct(l.movement, l.target)}</span>}
              </td>
              <td className={`t-sm px-2 py-2 ${STATUS[l.status].tone}`}>{STATUS[l.status].label}</td>
              <td className="px-4 py-2">
                <Note projectId={projectId} line={l.id} saved={notes[l.id] ?? null} wanted={l.status === "over" || l.status === "not-measured"} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="t-xs border-t border-[var(--n-100)] px-4 py-2 text-[var(--n-500)]">
        A line within {TOLERANCE_BP / 100}% of its target is within it – at this stage that is the estimate getting more precise, not the design costing more.
      </p>
    </div>
  );
}

/** The reason for one line's movement. Saved when the reader moves off it, as the run panel does. */
function Note({ projectId, line, saved, wanted }: { projectId: string; line: CostLineId; saved: { note: string; by: string; at: string } | null; wanted: boolean }) {
  const router = useRouter();
  const [pending, act] = useTransition();
  const [draft, setDraft] = useState(saved?.note ?? "");
  const [refusal, setRefusal] = useState<string | null>(null);

  const save = () => {
    if (draft.trim() === (saved?.note ?? "")) return;
    act(async () => {
      const r = await setMovementNote(projectId, line, draft);
      if (!r.ok) return setRefusal(r.reason);
      setRefusal(null);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-0.5">
      <textarea
        data-note={line}
        rows={2}
        value={draft}
        disabled={pending}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        placeholder={wanted ? "Why it moved – the cost report needs this" : "Optional"}
        className={`${field} py-1 ${wanted && !saved ? "border-[var(--warn-500)]" : ""}`}
      />
      {refusal && <span className="t-xs text-[var(--err-700)]">{refusal}</span>}
      {saved && !refusal && (
        <span className="t-xs text-[var(--n-500)]">
          {saved.by}, {formatDate(saved.at)}
        </span>
      )}
    </div>
  );
}

function DecisionPanel({ projectId, check, decisions }: { projectId: string; check: NonNullable<CostControlData["check"]>; decisions: CostControlData["decisions"] }) {
  const router = useRouter();
  const [pending, act] = useTransition();
  // Offer the decision the verdict points to: proceeding is only open on an estimate within budget.
  const [form, setForm] = useState<{ decision: Decision; note: string; revisedBudget: string }>({
    decision: check.verdict === "within-budget" ? "proceed" : "redesign",
    note: "",
    revisedBudget: "",
  });
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <form
        data-region="cost-decision"
        onSubmit={(e) => {
          e.preventDefault();
          act(async () => {
            const r = await recordDecision(projectId, form);
            if (!r.ok) return setSaid({ ok: false, text: r.reason });
            setSaid({ ok: true, text: "Decision recorded." });
            setForm({ ...form, note: "", revisedBudget: "" });
            router.refresh();
          });
        }}
        className="flex flex-col gap-2 rounded-[var(--r-lg)] border border-[var(--n-200)] p-4"
      >
        <p className="t-base font-medium text-[var(--n-800)]">The client&rsquo;s decision</p>
        <fieldset className="flex flex-col gap-1">
          <legend className="sr-only">What the client decided</legend>
          {(Object.keys(DECISIONS) as Decision[]).map((d) => (
            <label key={d} className="t-sm flex items-center gap-2 text-[var(--n-700)]">
              <input type="radio" name="decision" value={d} checked={form.decision === d} onChange={() => setForm({ ...form, decision: d })} />
              {DECISIONS[d]}
            </label>
          ))}
        </fieldset>
        {form.decision === "revise-budget" && (
          <label className="flex flex-col gap-0.5">
            <span className="t-xs text-[var(--n-500)]">Revised budget, excluding VAT</span>
            <input
              name="revisedBudget"
              inputMode="decimal"
              value={form.revisedBudget}
              onChange={(e) => setForm({ ...form, revisedBudget: e.target.value })}
              placeholder="R 4 100 000"
              className={`${field} num h-8 text-right`}
            />
          </label>
        )}
        <label className="flex flex-col gap-0.5">
          <span className="t-xs text-[var(--n-500)]">{form.decision === "redesign" ? "What is to be redesigned, and the target to bring it back to" : form.decision === "revise-budget" ? "Why the budget is revised" : "Note (optional)"}</span>
          <textarea name="note" rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className={`${field} py-1`} />
        </label>
        <button type="submit" data-action="record-decision" disabled={pending} className="t-sm h-8 self-start rounded-[var(--r-md)] bg-[var(--n-800)] px-3 font-medium text-white hover:bg-[var(--n-900)] disabled:opacity-50">
          Record the decision
        </button>
        {said && (
          <p role="status" className={`t-sm ${said.ok ? "text-[var(--ok-700)]" : "text-[var(--err-700)]"}`}>
            {said.text}
          </p>
        )}
      </form>

      <div data-region="cost-decisions" className="rounded-[var(--r-lg)] border border-[var(--n-200)] p-4">
        <p className="t-base font-medium text-[var(--n-800)]">Decisions so far</p>
        {decisions.length === 0 ? (
          <p className="t-sm mt-2 text-[var(--n-500)]">None recorded.</p>
        ) : (
          <ol className="mt-2 flex flex-col gap-3">
            {decisions.map((d) => (
              <li key={d.id} data-decision={d.decision} className="t-sm border-l-2 border-[var(--n-200)] pl-3 text-[var(--n-700)]">
                <p className="font-medium text-[var(--n-800)]">
                  {DECISIONS[d.decision]}
                  {d.revisedBudget && <>: {R(d.revisedBudget)}</>}
                  {d.inForce && <span className="t-xs ml-2 rounded-[var(--r-sm)] bg-[var(--a-50)] px-1.5 py-0.5 text-[var(--a-700)]">in force</span>}
                </p>
                {d.note && <p className="mt-0.5 whitespace-pre-line">{d.note}</p>}
                <p className="t-xs mt-0.5 text-[var(--n-500)]">
                  {d.by}, {formatDate(d.at)} – on a detailed estimate of {R(d.detailed)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function IssueReport({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [pending, act] = useTransition();
  const [issued, setIssued] = useState<{ id: string; title: string } | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  return (
    <footer className="flex flex-wrap items-center gap-3 rounded-[var(--r-lg)] border border-[var(--n-200)] px-4 py-3">
      <button
        type="button"
        data-action="issue-cost-report"
        disabled={pending}
        onClick={() =>
          act(async () => {
            const r = await issueDocument(projectId, "cost_report");
            if (!r.ok) return setSaid(r.reason);
            setSaid(null);
            setIssued({ id: r.id, title: r.title });
            router.refresh();
          })
        }
        className="t-base flex h-8 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] px-3 font-medium text-[var(--n-700)] hover:bg-[var(--n-50)] disabled:opacity-40"
      >
        <FileText aria-hidden size={14} strokeWidth={1.75} />
        Issue the cost report
      </button>
      {issued && (
        <a data-action="download-cost-report" href={`/projects/${projectId}/report/pdf?issued=${issued.id}`} className="t-sm flex items-center gap-1 font-medium text-[var(--a-700)] underline underline-offset-2">
          <Download aria-hidden size={12} /> {issued.title}
        </a>
      )}
      {said && <span className="t-sm text-[var(--err-700)]">{said}</span>}
      <span className="t-xs ml-auto text-[var(--n-500)]">Issued documents are kept on the project&rsquo;s Report page.</span>
    </footer>
  );
}
