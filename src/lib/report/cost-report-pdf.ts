/**
 * The cost report to the client – D1.1-SP-003 T04, "report what moved, why, and the options".
 *
 * One or two pages: the budget against the detailed estimate, the verdict in a sentence, every line
 * of the check with its target, detailed figure and movement and the quantity surveyor's reason
 * under it, then the findings and the decision in force. Figures come from `domain/cost-control.ts`
 * through `lib/cost-control.ts`; nothing is computed here but the layout.
 */

import { DECISIONS, shareText, TOLERANCE_BP, type CheckedLine, type CostCheck, type CostLineId, type LineStatus } from "@/domain/cost-control";
import { formatMoney, type Money } from "@/domain/money";
import type { DecisionRecord } from "@/lib/cost-control";
import { createPdf, PAGE } from "@/lib/pdf/writer";

export interface CostReportSubject {
  practice: string;
  projectName: string;
  code: string | null;
  client: string | null;
  /** Which signed cost plan the targets are, and which bill the detailed estimate is. */
  costPlan: string;
  bill: string;
  issuedBy: string;
  issuedOn: string;
}

const W = PAGE.textWidth;
const R = (m: Money) => formatMoney(m, { symbol: "R" });
const N = (m: Money) => formatMoney(m, { symbol: "" });
const COL = {
  line: { x: 0, width: W - 352 },
  target: { x: W - 348, width: 88 },
  detailed: { x: W - 256, width: 88 },
  movement: { x: W - 164, width: 88 },
  status: { x: W - 72, width: 72 },
};

/** What a line's status says, in the column – short, because the findings say it at length. */
const STATUS: Readonly<Record<LineStatus, string>> = {
  within: "Within",
  over: "Over",
  under: "Under",
  "no-target": "No target",
  "not-measured": "Not measured",
  unreadable: "Unreadable",
};

// The domain's share, from the cents, so the table and the findings above it cannot disagree.
const movementText = (l: CheckedLine) => {
  if (l.movement === null) return "–";
  const share = shareText(l.movement, l.target, true);
  return `${l.movement > 0n ? "+" : ""}${N(l.movement)}${share ? ` (${share})` : ""}`;
};

export function costReportPdf(
  check: CostCheck,
  notes: ReadonlyMap<CostLineId, { note: string }>,
  decision: DecisionRecord | null,
  s: CostReportSubject,
): Buffer {
  const doc = createPdf({ title: `${s.projectName} – Cost Report` });
  doc.footerOnEveryPage((page, total) => `${s.practice} · ${s.projectName}${s.code ? ` · ${s.code}` : ""}   –   Cost Report   –   Page ${page} of ${total}`);

  doc.text(s.practice, { size: 9, grey: 0.35, gap: 2 });
  doc.text("Cost Report", { size: 16, bold: true, gap: 2 });
  doc.text(`${s.projectName}${s.code ? ` · ${s.code}` : ""}`, { size: 11, gap: 10 });
  doc.rule({ gap: 8 });

  const line = (label: string, value: string) =>
    doc.row([
      { text: label, x: 0, width: 110, grey: 0.4 },
      { text: value, x: 114, width: W - 114 },
    ]);
  if (s.client) line("Client", s.client);
  line("Targets", s.costPlan);
  line("Detailed estimate", s.bill);
  line("Issued", `${s.issuedOn} by ${s.issuedBy}`);
  doc.space(6);

  // ── The answer, before the detail ──────────────────────────────────────────────────────────
  doc.band([
    { label: check.budgetSource === "revised" ? "Revised budget" : "Budget", value: check.budget === null ? "–" : R(check.budget) },
    { label: "Detailed estimate", value: R(check.detailed) },
    { label: "Movement", value: check.movement === null ? "–" : `${check.movement > 0n ? "+" : ""}${R(check.movement)}` },
  ]);
  doc.space(6);
  if (check.findings[0]) doc.text(check.findings[0], { size: 10, bold: true, gap: 10 });

  // ── Line by line ───────────────────────────────────────────────────────────────────────────
  doc.heading("Against the cost plan, line by line", { size: 11.5 });
  doc.row(
    [
      { text: "Line", ...COL.line, bold: true },
      { text: "Target (R)", ...COL.target, align: "right", bold: true },
      { text: "Detailed (R)", ...COL.detailed, align: "right", bold: true },
      { text: "Movement (R)", ...COL.movement, align: "right", bold: true },
      { text: "Status", ...COL.status, align: "right", bold: true },
    ],
    { size: 8.5 },
  );
  doc.rule({ thickness: 0.8, gap: 4 });
  for (const l of check.lines) {
    doc.row([
      { text: `${l.label}${l.unpriced ? ` (${l.unpriced} not priced)` : ""}`, ...COL.line },
      { text: l.target === null ? (l.unreadable ? "unreadable" : "–") : N(l.target), ...COL.target, align: "right" },
      { text: l.status === "not-measured" ? "not measured" : N(l.detailed), ...COL.detailed, align: "right" },
      { text: movementText(l), ...COL.movement, align: "right" },
      { text: STATUS[l.status], ...COL.status, align: "right" },
    ]);
    // The reason under the figure it explains – a movement with no reason is half a report.
    const why = notes.get(l.id)?.note;
    if (why) doc.row([{ text: why, x: 8, width: W - 8, grey: 0.4 }], { size: 7.5, gap: 3 });
  }
  doc.rule({ gap: 4 });
  doc.space(10);

  // ── Findings ───────────────────────────────────────────────────────────────────────────────
  if (check.findings.length > 1) {
    doc.heading("What moved, and what is missing", { size: 11.5 });
    for (const f of check.findings.slice(1)) doc.text(`• ${f}`, { size: 9, gap: 3 });
    doc.space(8);
  }

  // ── The decision ───────────────────────────────────────────────────────────────────────────
  doc.heading("The client's decision", { size: 11.5 });
  if (decision) {
    doc.text(`${DECISIONS[decision.decision]}${decision.revisedBudget !== null ? `: ${R(decision.revisedBudget)} excluding VAT` : ""}.`, { size: 9.5, gap: 3 });
    if (decision.note) doc.text(decision.note, { size: 9, grey: 0.3, gap: 3 });
    doc.text(`Recorded by ${decision.by} on ${decision.at.slice(0, 10)}, on a detailed estimate of ${R(decision.detailed)}.`, { size: 8.5, grey: 0.4, gap: 3 });
  } else {
    doc.text("Not yet recorded. The options are to bring the design back within budget, or to approve a revised budget.", { size: 9.5, gap: 3 });
  }

  doc.space(12);
  doc.rule({ gap: 6 });
  for (const n of [
    "Figures exclude VAT. The detailed estimate is the priced bill of quantities grouped into its elements, with the preliminaries, contingency and escalation set on the Cost Plan.",
    `A line within ${TOLERANCE_BP / 100}% of its target is reported as within it: at this stage that is the estimate becoming more precise, not the design costing more.`,
    "A line marked not measured has a target and nothing in the bill yet. It is not a saving, and the detailed estimate is short of it until it is measured.",
  ]) {
    doc.text(n, { size: 8.5, grey: 0.35, gap: 3 });
  }

  return doc.build();
}
