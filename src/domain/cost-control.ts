/**
 * Design cost control – the detailed estimate checked against the cost plan's targets (D1.1-SP-003).
 *
 * ── What it is for ─────────────────────────────────────────────────────────────────────────
 *
 * The signed cost plan gives each element a figure, and those figures are the design team's
 * budget. As the design develops the bill is measured and priced, and the elemental plan built from
 * it is the detailed estimate. This sets the two side by side, element by element, and answers the
 * process model's question: is the detailed estimate within the approved budget, and where it is
 * not, which elements moved and by how much.
 *
 * ── The three things it refuses to say ─────────────────────────────────────────────────────
 *
 *  - That an element nobody measured came in under budget. A target of R2m against nothing in the
 *    bill is not a R2m saving; it is work the bill does not carry yet, and the line says so.
 *  - That the detailed estimate is within budget while any element is unmeasured or any item is
 *    unpriced. A total that is low because it is incomplete looks exactly like one that is low
 *    because it is cheap. The verdict is "incomplete" and names the gap.
 *  - That a figure it could not read is nought. A target signed as text that is not one amount in
 *    rand is "unreadable", quoted as signed.
 *
 * Pure: no database. Money through `money.ts`, in cents.
 */

import { readAmount } from "@/domain/amount";
import type { ElementId, ElementalPlan } from "@/domain/elemental-plan";
import { divideRounded, formatMoney, money, sum, type Money } from "@/domain/money";

/**
 * How far an element may move before it is reported as over or under, in basis points of its
 * target – 500 is 5%.
 *
 * A detailed estimate never lands exactly on a cost plan; a move inside this band is the estimate
 * becoming more precise, not the design costing more. Five per cent is the narrow end of what a
 * concept-stage plan claims for itself (ASAQS Class 4 is typically −15% to +25%), so a move outside
 * it is worth a sentence to the client.
 */
export const TOLERANCE_BP = 500;

/** Which cost plan field each line is checked against, and which bill elements make it up. */
export const COST_LINES = [
  { id: "substructure", label: "Substructure", target: "cp-substructure", elements: ["substructure"] },
  { id: "superstructure", label: "Superstructure", target: "cp-superstructure", elements: ["superstructure"] },
  // The cost plan carries one line for both; the bill keeps them apart.
  { id: "finishes", label: "Finishes and fittings", target: "cp-finishes", elements: ["finishes", "fittings"] },
  { id: "services", label: "Engineering services", target: "cp-services", elements: ["services"] },
  { id: "external", label: "External works", target: "cp-external-works", elements: ["external"] },
  // A cost plan has no field of its own for these; where the bill carries them they have no target.
  { id: "provisional", label: "Provisional and prime cost sums", target: null, elements: ["provisional"] },
  { id: "preliminaries", label: "Preliminaries and general", target: "cp-preliminaries", elements: ["preliminaries"], allowance: "preliminaries" },
  { id: "contingency", label: "Contingency", target: "cp-contingency", elements: [], allowance: "contingency" },
  { id: "escalation", label: "Escalation", target: "cp-escalation", elements: [], allowance: "escalation" },
] as const satisfies readonly {
  id: string;
  label: string;
  target: string | null;
  elements: readonly ElementId[];
  allowance?: "preliminaries" | "contingency" | "escalation";
}[];

export type CostLineId = (typeof COST_LINES)[number]["id"];
export const isCostLine = (value: string): value is CostLineId => COST_LINES.some((l) => l.id === value);

/** The total the detailed estimate is held to. */
export const TOTAL_FIELD = "cp-total";

export type LineStatus = "within" | "over" | "under" | "no-target" | "not-measured" | "unreadable";

export interface CheckedLine {
  id: CostLineId;
  label: string;
  /** The cost plan's figure. Null where the plan carries none, or carries one that cannot be read. */
  target: Money | null;
  /** The target as signed, where it could not be read as one amount in rand. */
  unreadable: string | null;
  /** The detailed estimate's figure. Nought where the bill carries nothing for this line. */
  detailed: Money;
  /** Bill items in this line, and how many of them are not priced. */
  items: number;
  unpriced: number;
  /** Detailed less target. Null without a target, or where the bill has not measured the line. */
  movement: Money | null;
  /** The movement in basis points of the target. Null where there is no movement, or the target is nought. */
  movementBp: number | null;
  status: LineStatus;
}

export type Verdict = "within-budget" | "over-budget" | "incomplete" | "no-budget";

export interface CostCheck {
  lines: CheckedLine[];
  /** The budget the detailed estimate is held to: a revised budget where the client approved one. */
  budget: Money | null;
  budgetSource: "cost-plan" | "revised" | null;
  /** The cost plan's own total, as signed, where it could not be read. */
  budgetUnreadable: string | null;
  /** The detailed estimate, excluding VAT – the same basis as the cost plan's total. */
  detailed: Money;
  movement: Money | null;
  movementBp: number | null;
  verdict: Verdict;
  /** Sentences for the reader, most consequential first. */
  findings: string[];
}

/** A signed cost plan figure, by field id – the value as the run's output froze it. */
export type SignedFigures = ReadonlyMap<string, string>;

const readTarget = (figures: SignedFigures, fieldId: string | null): { amount: Money | null; unreadable: string | null } => {
  if (!fieldId) return { amount: null, unreadable: null };
  const raw = figures.get(fieldId);
  if (raw === undefined || raw.trim() === "") return { amount: null, unreadable: null };
  const reading = readAmount(raw);
  return reading.ok ? { amount: reading.amount, unreadable: null } : { amount: null, unreadable: raw };
};

/** Basis points of `of`, rounded; null where `of` is nought or below. */
const bp = (value: Money, of: Money): number | null => (of > 0n ? Number(divideRounded(value * 10_000n, of)) : null);

const statusOf = (movement: Money, movementBp: number | null): LineStatus => {
  if (movementBp === null) return movement > 0n ? "over" : movement < 0n ? "under" : "within";
  if (Math.abs(movementBp) <= TOLERANCE_BP) return "within";
  return movementBp > 0 ? "over" : "under";
};

// The platform's one way of writing money, so a finding's figure reads as it does in the table.
const R = (m: Money) => formatMoney(m, { symbol: "R" });
/**
 * A movement as a share of what it moved from, to one place – "35,7%", or "+35,7%" signed.
 *
 * Worked from the money in one rounding, by `divideRounded`. It was twice wrong before it was
 * right: `(365 / 100).toFixed(1)` read 3,654% as 3,6% (3.65 is not exact in binary), and rounding
 * to basis points first and then to tenths read R53 620,65 over R150 000 – 35,747% – as 3 575 basis
 * points and so as 35,8%. Found by the browser suite. One rounding, from the cents, has neither edge.
 *
 * Null where there is nothing to take a share of.
 */
export function shareText(movement: Money, base: Money | null, signed = false): string | null {
  if (base === null || base <= 0n) return null;
  const negative = movement < 0n;
  const tenths = divideRounded((negative ? -movement : movement) * 1_000n, base);
  return `${signed ? (negative ? "−" : "+") : ""}${tenths / 10n},${tenths % 10n}%`;
}

const pct = (movement: Money, base: Money | null) => shareText(movement, base) ?? "–";

/**
 * Check the detailed estimate against the cost plan.
 *
 * `revisedBudget` is the client's approved revision, where one stands for this cost plan. It
 * replaces the plan's total, not its element figures: a client approves a budget, and the element
 * targets stay the design team's until the plan is revised.
 */
export function costCheck(
  figures: SignedFigures,
  plan: ElementalPlan,
  revisedBudget: Money | null = null,
): CostCheck {
  const byElement = new Map(plan.elements.map((e) => [e.id, e]));

  const lines: CheckedLine[] = COST_LINES.map((line) => {
    const { amount: target, unreadable } = readTarget(figures, line.target);
    const elements = line.elements.map((id) => byElement.get(id)).filter((e) => e !== undefined);
    const fromBill = sum(elements.map((e) => e.amount));
    const allowance = "allowance" in line ? plan[line.allowance] : 0n;
    const detailed = money(fromBill + allowance);
    const items = elements.reduce((n, e) => n + e.items, 0);
    const unpriced = elements.reduce((n, e) => n + e.unpriced, 0);
    // Measured: the bill carries items for it, or – for an allowance – the allowance is set above nought.
    const measured = items > 0 || allowance > 0n;

    if (unreadable !== null) {
      return { id: line.id, label: line.label, target: null, unreadable, detailed, items, unpriced, movement: null, movementBp: null, status: "unreadable" as const };
    }
    if (target === null) {
      return { id: line.id, label: line.label, target: null, unreadable: null, detailed, items, unpriced, movement: null, movementBp: null, status: "no-target" as const };
    }
    if (!measured && target > 0n) {
      return { id: line.id, label: line.label, target, unreadable: null, detailed, items, unpriced, movement: null, movementBp: null, status: "not-measured" as const };
    }
    const movement = money(detailed - target);
    const movementBp = bp(movement, target);
    return { id: line.id, label: line.label, target, unreadable: null, detailed, items, unpriced, movement, movementBp, status: statusOf(movement, movementBp) };
  })
    // A line neither the plan nor the bill carries says nothing; leave it off.
    .filter((l) => l.target !== null || l.unreadable !== null || l.items > 0 || l.detailed > 0n);

  const planTotal = readTarget(figures, TOTAL_FIELD);
  const budget = revisedBudget ?? planTotal.amount;
  const budgetSource = revisedBudget !== null ? "revised" : planTotal.amount !== null ? "cost-plan" : null;
  const detailed = plan.excludingVat;
  const movement = budget === null ? null : money(detailed - budget);
  const movementBp = budget === null || movement === null ? null : bp(movement, budget);

  const notMeasured = lines.filter((l) => l.status === "not-measured");
  const unpriced = plan.unpriced;
  const verdict: Verdict =
    budget === null
      ? "no-budget"
      : detailed > budget
        ? // Over even with work missing – it can only get worse as the gaps are measured.
          "over-budget"
        : notMeasured.length > 0 || unpriced > 0
          ? "incomplete"
          : "within-budget";

  return {
    lines,
    budget,
    budgetSource,
    budgetUnreadable: revisedBudget === null ? planTotal.unreadable : null,
    detailed,
    movement,
    movementBp,
    verdict,
    findings: findingsFor(lines, { budget, budgetSource, detailed, movement, movementBp, verdict, unpriced, figures, planTotal: planTotal.amount }),
  };
}

function findingsFor(
  lines: readonly CheckedLine[],
  t: {
    budget: Money | null;
    budgetSource: CostCheck["budgetSource"];
    detailed: Money;
    movement: Money | null;
    movementBp: number | null;
    verdict: Verdict;
    unpriced: number;
    figures: SignedFigures;
    planTotal: Money | null;
  },
): string[] {
  const out: string[] = [];
  const budgetName = t.budgetSource === "revised" ? "the revised budget" : "the cost plan's total";

  if (t.verdict === "no-budget") {
    out.push("The cost plan has no total that can be read, so the detailed estimate cannot be held to a budget. Sign the Cost Plan with its total construction cost.");
  } else if (t.verdict === "over-budget") {
    out.push(`The detailed estimate is ${R(t.movement!)} (${pct(t.movement!, t.budget)}) over ${budgetName}. The client decides between design changes and a revised budget.`);
  } else if (t.verdict === "incomplete") {
    out.push(`The detailed estimate is ${R(money(t.budget! - t.detailed))} under ${budgetName}, but it is not complete, so that is not yet a saving.`);
  } else {
    out.push(`The detailed estimate is within ${budgetName}${t.movement !== null && t.movement < 0n ? `, ${R(money(-t.movement))} under it` : ""}.`);
  }

  // Where it moved, largest first – the sentence a cost report to the client is built round.
  for (const l of lines.filter((l) => l.status === "over").sort((a, b) => Number(b.movement! - a.movement!))) {
    out.push(`${l.label} is ${R(l.movement!)} (${pct(l.movement!, l.target)}) over its target of ${R(l.target!)}.`);
  }
  for (const l of lines.filter((l) => l.status === "not-measured")) {
    out.push(`${l.label} has a target of ${R(l.target!)} and nothing in the bill – the detailed estimate is short of it until it is measured.`);
  }
  for (const l of lines.filter((l) => l.status === "no-target" && l.detailed > 0n)) {
    out.push(`${l.label} of ${R(l.detailed)} in the bill have no target in the cost plan.`);
  }
  for (const l of lines.filter((l) => l.status === "unreadable")) {
    out.push(`The cost plan's ${l.label.toLowerCase()} was signed as "${l.unreadable}", which is not one amount in rand, so the line is not checked.`);
  }
  for (const l of lines.filter((l) => l.status === "under").sort((a, b) => Number(a.movement! - b.movement!))) {
    out.push(`${l.label} is ${R(money(-l.movement!))} (${pct(l.movement!, l.target)}) under its target.`);
  }
  if (t.unpriced > 0) {
    out.push(`${t.unpriced} bill ${t.unpriced === 1 ? "item is" : "items are"} not priced and not in the detailed estimate.`);
  }

  /*
    The plan's elements against its own total. A cost plan whose elements do not add up to its total
    carries money in no element – a provisional sum, a rounding, an item the reader missed – and the
    element checks above cannot see it.
  */
  if (t.planTotal !== null) {
    const elementTargets = lines.flatMap((l) => (l.target === null ? [] : [l.target]));
    if (elementTargets.length > 0) {
      const added = sum(elementTargets);
      const gap = money(t.planTotal - added);
      // A rand either way is rounding. Short of the total is money in no element; over it, the plan
      // does not reconcile at all – one of the signed figures is wrong, and which one decides the check.
      if (gap > 100n) {
        out.push(`The cost plan's elements add to ${R(added)} and its total is ${R(t.planTotal)}: ${R(gap)} sits in no element, so no element check covers it.`);
      } else if (gap < -100n) {
        out.push(`The cost plan's elements add to ${R(added)}, ${R(money(-gap))} more than its total of ${R(t.planTotal)}. The plan does not reconcile – check which figure was signed before relying on the check.`);
      }
    }
  }

  return out;
}

/** The decisions a client makes on a cost report – D1.1-SP-003 T05. */
export const DECISIONS = {
  proceed: "Proceed – the detailed estimate is within budget",
  redesign: "Redesign – bring the design back within budget",
  "revise-budget": "Approve a revised budget",
} as const;

export type Decision = keyof typeof DECISIONS;
export const isDecision = (value: string): value is Decision => value in DECISIONS;

/**
 * The revised budget that stands, if any: the latest revision approved against **this** cost plan.
 *
 * Decisions come newest first. A redesign or a decision to proceed after a revision does not undo
 * it – they are decisions taken on that budget. A cost plan signed again is a new budget, and a
 * revision approved against the old one no longer applies; the history still shows it.
 */
export function revisionInForce<D extends { decision: Decision; revisedBudget: Money | null; costPlanRunId: string | null }>(
  decisions: readonly D[],
  costPlanRunId: string | null,
): D | null {
  if (!costPlanRunId) return null;
  return decisions.find((d) => d.decision === "revise-budget" && d.revisedBudget !== null && d.costPlanRunId === costPlanRunId) ?? null;
}

/**
 * Whether a decision may be recorded against this check, and if not, why.
 *
 * "Proceed" only where the estimate is within budget: proceeding on an estimate over budget is a
 * revised budget, and the record should say so rather than call it proceeding. Proceeding on an
 * incomplete estimate is refused for the same reason the verdict is "incomplete".
 */
export function decisionRefusal(check: CostCheck, decision: Decision, note: string, amount: Money | null): string | null {
  if (check.verdict === "no-budget") return "There is no budget to decide against. Sign the Cost Plan with its total first.";
  if (decision === "proceed" && check.verdict !== "within-budget") {
    return check.verdict === "over-budget"
      ? "The detailed estimate is over budget. To go ahead at that cost, approve a revised budget instead."
      : "The detailed estimate is not complete. Measure or price what is missing before deciding to proceed on it.";
  }
  if (decision === "redesign" && note.trim().length < 10) return "Say what is to be redesigned – the elements and the target to bring them back to.";
  if (decision === "revise-budget") {
    if (amount === null || amount <= 0n) return "A revised budget needs its amount, excluding VAT.";
    if (note.trim().length < 10) return "Say why the budget is revised – the client's reason is the record.";
  }
  return null;
}
