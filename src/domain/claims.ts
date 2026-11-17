/**
 * Notices, claims and extensions of time – D6.1, the part of contract administration that makes
 * a principal agent a principal agent.
 *
 * ── The completion date is a fact with a history ───────────────────────────────────────────
 *
 * The contract sets a date for practical completion. Every extension of time **awarded** moves
 * it, and only an award moves it – a claim lodged is a request, and a claim under assessment is
 * still a request. So the revised completion date is the contract's date plus the calendar days
 * of every award, in the order they were made, and each award records the date it produced.
 * JBCC 6.2 clause 23 extends by calendar days; FIDIC (1999 clause 8.4) likewise; a working-day
 * award is a contract that says so, and is entered as the calendar days it comes to.
 *
 * ── Penalties are exposure, not a charge ───────────────────────────────────────────────────
 *
 * A penalty for late completion runs from the revised completion date to the date the works are
 * actually completed – or, before that, the date the programme now expects. What this computes is
 * the **exposure**: days late times the contract's daily penalty, on the dates as they stand. It
 * is a warning on a cost report, never a deduction; a deduction is a figure on a certificate that
 * somebody signs.
 *
 * Nothing here knows about the database or a screen.
 */

import { daysFrom, plusDays } from "@/domain/date-reading";
import { money, type Money } from "@/domain/money";

export const NOTICE_KINDS = ["delay", "claim", "dispute", "variation", "other"] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];
export const NOTICE_KIND_LABEL: Readonly<Record<NoticeKind, string>> = {
  delay: "Notice of delay",
  claim: "Notice of intention to claim",
  dispute: "Notice of dispute",
  variation: "Notice of a variation",
  other: "Other notice",
};

export const NOTICE_STATUSES = ["received", "acknowledged", "claim_lodged", "closed"] as const;
export type NoticeStatus = (typeof NOTICE_STATUSES)[number];
export const NOTICE_STATUS_LABEL: Readonly<Record<NoticeStatus, string>> = {
  received: "Received",
  acknowledged: "Acknowledged",
  claim_lodged: "Claim lodged",
  closed: "Closed",
};

export const PARTIES = ["contractor", "employer", "principal_agent", "subcontractor", "other"] as const;
export type Party = (typeof PARTIES)[number];
export const PARTY_LABEL: Readonly<Record<Party, string>> = {
  contractor: "Contractor",
  employer: "Employer",
  principal_agent: "Principal agent",
  subcontractor: "Subcontractor",
  other: "Other",
};

export const CLAIM_KINDS = ["time", "cost", "time_and_cost"] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];
export const CLAIM_KIND_LABEL: Readonly<Record<ClaimKind, string>> = {
  time: "Extension of time",
  cost: "Cost – loss and expense",
  time_and_cost: "Extension of time with cost",
};

export const CLAIM_STATUSES = ["lodged", "under_assessment", "awarded", "rejected", "withdrawn"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
export const CLAIM_STATUS_LABEL: Readonly<Record<ClaimStatus, string>> = {
  lodged: "Lodged",
  under_assessment: "Under assessment",
  awarded: "Awarded",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

/** An award as the completion date needs it. */
export interface Award {
  claimNumber: number;
  /** Calendar days of extension awarded – zero for a claim rejected or for cost only. */
  daysAwarded: number;
  amountAwarded: Money | null;
  /** When the award was made, ISO – the order awards move the date in. */
  awardedOn: string;
}

/** The completion date as each award left it. */
export interface CompletionStep {
  claimNumber: number;
  daysAwarded: number;
  /** The completion date after this award. */
  completion: string;
}

/**
 * The contract's completion date, moved by every award in the order they were made.
 *
 * Null where there is no contract date: an award with nothing to extend is recorded, and the
 * summary says the date it moves is not established rather than inventing one.
 */
export function revisedCompletion(
  contractCompletion: string | null,
  awards: readonly Award[],
): { completion: string | null; daysAwarded: number; steps: CompletionStep[] } {
  const ordered = [...awards].sort((a, b) => (a.awardedOn < b.awardedOn ? -1 : a.awardedOn > b.awardedOn ? 1 : a.claimNumber - b.claimNumber));
  const daysAwarded = ordered.reduce((n, a) => n + a.daysAwarded, 0);
  if (contractCompletion === null) return { completion: null, daysAwarded, steps: [] };

  let completion = contractCompletion;
  const steps = ordered
    .filter((a) => a.daysAwarded !== 0)
    .map((a) => {
      completion = plusDays(completion, a.daysAwarded);
      return { claimNumber: a.claimNumber, daysAwarded: a.daysAwarded, completion };
    });
  return { completion, daysAwarded, steps };
}

/**
 * Days late against the revised completion date, and what they cost at the contract's daily
 * penalty – on the date the works completed, or the date the programme now expects them to.
 *
 * `null` for the exposure where the penalty is not established: a figure of nought would read as
 * "no penalty", and "the contract does not state one" is a different fact.
 */
export function penaltyExposure(
  revisedCompletion: string | null,
  expectedOrActualCompletion: string | null,
  penaltyPerDay: Money | null,
): { daysLate: number; exposure: Money | null } {
  if (!revisedCompletion || !expectedOrActualCompletion) return { daysLate: 0, exposure: penaltyPerDay === null ? null : money(0n) };
  const daysLate = Math.max(0, daysFrom(revisedCompletion, expectedOrActualCompletion));
  return { daysLate, exposure: penaltyPerDay === null ? null : money(penaltyPerDay * BigInt(daysLate)) };
}

/** The sums a register reports: claimed and awarded, days and money. */
export function claimTotals(
  claims: readonly { status: ClaimStatus; daysClaimed: number | null; amountClaimed: Money | null; daysAwarded: number | null; amountAwarded: Money | null }[],
): { open: number; daysClaimed: number; amountClaimed: Money; daysAwarded: number; amountAwarded: Money } {
  const live = claims.filter((c) => c.status !== "withdrawn");
  return {
    open: live.filter((c) => c.status === "lodged" || c.status === "under_assessment").length,
    daysClaimed: live.reduce((n, c) => n + (c.daysClaimed ?? 0), 0),
    amountClaimed: money(live.reduce((n, c) => n + (c.amountClaimed ?? 0n), 0n)),
    daysAwarded: live.reduce((n, c) => n + (c.status === "awarded" ? (c.daysAwarded ?? 0) : 0), 0),
    amountAwarded: money(live.reduce((n, c) => n + (c.status === "awarded" ? (c.amountAwarded ?? 0n) : 0n), 0n)),
  };
}
