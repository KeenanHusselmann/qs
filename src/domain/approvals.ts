/**
 * The statutory approval path, and what waiting on it costs — ported from v3's
 * `approval_register.py`.
 *
 * ── Why this decides thin schemes ──────────────────────────────────────────────────────────
 *
 * Nothing is built until the approvals are through, and the money for the land and the statutory
 * charges is committed long before that. On affordable housing, where margins are thin by design,
 * the holding cost over the approval period is frequently what decides viability — and it is the
 * cost most often left out, because it does not appear in a cost plan and nobody invoices for it.
 *
 * ── A reference table, not a claim about this project ──────────────────────────────────────
 *
 * The lead times below are South African norms for a greenfield residential township, concept to
 * construction. They are the same class of thing as the SARS transfer-duty table and the NHBRC
 * schedule in `statutory.ts`: published practice, dated, and defensible — not figures read from
 * anybody's documents.
 *
 * What this module will **not** do is say where a particular project stands in that sequence. That
 * is a fact about their scheme, it lives in a programme somebody signs, and inventing it would put
 * a rezoning "in progress" on a report for a site nobody has applied for.
 *
 * ── The finding it exists to produce ───────────────────────────────────────────────────────
 *
 * A critical path of nineteen months against a modelled pre-development period of six is not an
 * error to be corrected silently — it is a thirteen-month gap in the holding cost, and saying so
 * is the whole point. An optimistic programme understates holding cost, which flatters the return,
 * which is the direction that gets schemes built.
 */

import { formatRand, money, type Money } from "@/domain/money";

/**
 * When these lead times were last checked against practice.
 *
 * Dated for the reason every reference table here is dated: a norm nobody has revisited is not a
 * norm, and a reader is entitled to know how old the basis is.
 */
export const APPROVAL_TABLE_DATE = "2026-01-01";

export interface ApprovalStep {
  approval: string;
  /** South African norm for a greenfield residential township. */
  leadMonths: number;
  /** The step that must finish first. Empty runs from project start. */
  after: string;
  /** What it is, in the words a reader outside the practice needs. */
  note: string;
}

/**
 * The standard path.
 *
 * Environmental authorisation and the water use licence run **parallel** to the township
 * establishment rather than after it, which is why they carry no prerequisite: sequencing them
 * would add nineteen months to a critical path that does not have them, and a programme that
 * overstates delay is as misleading as one that understates it.
 */
export const APPROVAL_REGISTER: readonly ApprovalStep[] = [
  {
    approval: "Township establishment / rezoning (SPLUMA)",
    leadMonths: 12,
    after: "",
    note: "Land Use Scheme amendment and township register.",
  },
  {
    approval: "Environmental authorisation (EA / EIA)",
    leadMonths: 10,
    after: "",
    note: "Basic assessment or full S&EIR. Runs parallel to the SPLUMA application.",
  },
  {
    approval: "Water use licence (WULA)",
    leadMonths: 9,
    after: "",
    note: "Department of Water and Sanitation licence. Parallel to the environmental authorisation.",
  },
  {
    approval: "Engineering services agreement",
    leadMonths: 4,
    after: "Township establishment / rezoning (SPLUMA)",
    note: "Bulk and link services agreement with the municipality.",
  },
  {
    approval: "Site development plan (SDP) approval",
    leadMonths: 3,
    after: "Township establishment / rezoning (SPLUMA)",
    note: "Layout, density and coverage sign-off.",
  },
  {
    approval: "Building plan scrutiny and approval",
    leadMonths: 3,
    after: "Site development plan (SDP) approval",
    note: "Municipal plan scrutiny. The fee sits in the B6 statutory line, not here.",
  },
  {
    approval: "NHBRC enrolment",
    leadMonths: 1,
    after: "Building plan scrutiny and approval",
    note: "Home-warranty enrolment. The fee sits in the B6 statutory line, not here.",
  },
];

export interface ApprovalProgramme {
  steps: { approval: string; leadMonths: number; finishMonth: number; note: string }[];
  /** The longest chain — what actually decides when construction can start. */
  criticalPathMonths: number;
  /** What the money committed up front costs over that period. */
  holdingCost: Money | null;
  /** The gap between the critical path and the period the cash flow modelled. */
  divergence: string | null;
}

/**
 * Finish month for a step, following its prerequisite chain.
 *
 * Memoised, and the register is acyclic by construction — a cycle would recurse forever, and the
 * honest guard against that is a table small enough to read rather than a cycle detector nobody
 * exercises.
 */
function finishOf(
  step: ApprovalStep,
  byName: ReadonlyMap<string, ApprovalStep>,
  memo: Map<string, number>,
): number {
  const seen = memo.get(step.approval);
  if (seen !== undefined) return seen;

  const prerequisite = step.after ? byName.get(step.after) : undefined;
  const start = prerequisite ? finishOf(prerequisite, byName, memo) : 0;
  const finish = start + step.leadMonths;

  memo.set(step.approval, finish);
  return finish;
}

export function approvalProgramme(inputs: {
  /** Land, statutory charges and anything else committed before construction starts. */
  committedUpFront: Money | null;
  /** The annual rate that money is held at. A stated assumption, not a signed figure. */
  holdingRatePa: number;
  /** What the cash flow assumed, so the two can be compared. */
  modelledPreDevelopmentMonths: number;
  register?: readonly ApprovalStep[];
}): ApprovalProgramme {
  const register = inputs.register ?? APPROVAL_REGISTER;
  const byName = new Map(register.map((step) => [step.approval, step]));
  const memo = new Map<string, number>();

  const steps = register.map((step) => ({
    approval: step.approval,
    leadMonths: step.leadMonths,
    finishMonth: finishOf(step, byName, memo),
    note: step.note,
  }));

  const criticalPathMonths = Math.max(...steps.map((s) => s.finishMonth), 0);

  /*
    Simple interest over the period, not compounded.

    Holding cost on a pre-development period is ordinarily quoted as a simple carry — the money is
    committed, not drawn progressively — and compounding it would overstate a figure this section
    exists to stop people understating. The direction of the error matters more than the precision.
  */
  const holdingCost =
    inputs.committedUpFront === null || inputs.committedUpFront <= 0n
      ? null
      : money(
          BigInt(
            Math.round(
              Number(inputs.committedUpFront) * inputs.holdingRatePa * (criticalPathMonths / 12),
            ),
          ),
        );

  /*
    The finding. An optimistic programme understates holding cost, which flatters the return, which
    is the direction that gets schemes built — so a shortfall is stated in months and in money
    rather than quietly corrected.
  */
  const gap = criticalPathMonths - inputs.modelledPreDevelopmentMonths;
  const shortfall =
    holdingCost !== null && criticalPathMonths > 0
      ? money((holdingCost * BigInt(Math.round(Math.max(gap, 0) * 100))) / BigInt(Math.round(criticalPathMonths * 100)))
      : null;

  const divergence =
    gap > 1
      ? `The standard approval path runs about ${criticalPathMonths} months, against the ` +
        `${inputs.modelledPreDevelopmentMonths} months the cash flow assumes before construction ` +
        `starts. On that path the scheme carries its committed money about ${gap} months longer ` +
        `than modelled` +
        (shortfall ? `, worth roughly ${formatRand(shortfall)} of holding cost the model does not show.` : ".")
      : gap < -1
        ? `The cash flow assumes ${inputs.modelledPreDevelopmentMonths} months before construction, ` +
          `longer than the ${criticalPathMonths}-month standard approval path. Holding cost is not ` +
          "understated; confirm the longer period is deliberate."
        : null;

  return { steps, criticalPathMonths, holdingCost, divergence };
}

/** What this section is, and is not, in the words the report prints. */
export const APPROVAL_SCOPE =
  "The lead times below are South African norms for a greenfield residential township, dated " +
  `${APPROVAL_TABLE_DATE}, and are a defensible default rather than a fact about this project. ` +
  "This platform does not know which of these approvals has been applied for or granted — that " +
  "is a programme somebody signs, and none has been.";
