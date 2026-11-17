/**
 * The statutory and health-and-safety record of a project – what a principal agent has to see
 * obtained, approved and handed over (D7, D2.5, D2.7).
 *
 * ── A register, seeded with the South African list ─────────────────────────────────────────
 *
 * Every project starts with the requirements South African building work carries, each with the
 * instrument it comes from, so the register is a checklist on day one rather than a blank table.
 * An item a project does not need is marked not applicable – kept, with who said so – rather than
 * deleted, because "we decided an NHBRC enrolment did not apply" is a decision somebody may be
 * asked to account for.
 *
 * ── Status is a fact with a date ───────────────────────────────────────────────────────────
 *
 * required → submitted → approved (or issued), each with its date and reference. An item is
 * overdue when it has a date it was needed by, that date has passed, and it is not approved; an
 * approval with an expiry date lapses. Both are derived on read, never stored.
 */

import { daysFrom } from "@/domain/date-reading";

export const COMPLIANCE_STATUSES = ["required", "submitted", "approved", "not_applicable"] as const;
export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];
export const COMPLIANCE_STATUS_LABEL: Readonly<Record<ComplianceStatus, string>> = {
  required: "Required",
  submitted: "Submitted",
  approved: "Approved / issued",
  not_applicable: "Not applicable",
};

export const COMPLIANCE_STAGES = ["before_construction", "during_construction", "at_completion"] as const;
export type ComplianceStage = (typeof COMPLIANCE_STAGES)[number];
export const COMPLIANCE_STAGE_LABEL: Readonly<Record<ComplianceStage, string>> = {
  before_construction: "Before work starts",
  during_construction: "During construction",
  at_completion: "At completion",
};

export interface ComplianceRequirement {
  key: string;
  title: string;
  /** The instrument it comes from, as a principal agent would cite it. */
  source: string;
  stage: ComplianceStage;
  /** Who normally obtains it. */
  responsible: string;
  /** Health and safety, or statutory approval – the two halves of the register. */
  area: "health_and_safety" | "statutory";
}

export const DEFAULT_REQUIREMENTS: readonly ComplianceRequirement[] = [
  { key: "hs-specification", title: "Client's health and safety specification", source: "Construction Regulations 2014, reg. 5(1)(b)", stage: "before_construction", responsible: "Client / H&S agent", area: "health_and_safety" },
  { key: "hs-agent", title: "Health and safety agent appointed", source: "Construction Regulations 2014, reg. 5(5)", stage: "before_construction", responsible: "Client", area: "health_and_safety" },
  { key: "construction-permit", title: "Construction work permit or notification of construction work", source: "Construction Regulations 2014, regs. 3 and 4", stage: "before_construction", responsible: "Client / contractor", area: "health_and_safety" },
  { key: "hs-plan", title: "Contractor's health and safety plan approved", source: "Construction Regulations 2014, reg. 5(1)(f) and 7(1)", stage: "before_construction", responsible: "Contractor, approved by client / H&S agent", area: "health_and_safety" },
  { key: "hs-audits", title: "Monthly health and safety audits", source: "Construction Regulations 2014, reg. 5(1)(o)", stage: "during_construction", responsible: "Client / H&S agent", area: "health_and_safety" },
  { key: "hs-file", title: "Health and safety file handed over", source: "Construction Regulations 2014, reg. 5(1)(u) and 7(1)(b)", stage: "at_completion", responsible: "Contractor", area: "health_and_safety" },
  { key: "building-plans", title: "Building plans approved", source: "National Building Regulations Act 103 of 1977, s. 4", stage: "before_construction", responsible: "Architect", area: "statutory" },
  { key: "nhbrc-enrolment", title: "NHBRC enrolment of the homes", source: "Housing Consumers Protection Measures Act 95 of 1998, s. 14", stage: "before_construction", responsible: "Developer / home builder", area: "statutory" },
  { key: "electrical-coc", title: "Electrical certificate of compliance", source: "Electrical Installation Regulations 2009, reg. 7", stage: "at_completion", responsible: "Electrical contractor", area: "statutory" },
  { key: "plumbing-coc", title: "Plumbing certificate of compliance", source: "SANS 10252 / municipal water by-laws", stage: "at_completion", responsible: "Plumbing contractor", area: "statutory" },
  { key: "fire-clearance", title: "Fire safety clearance", source: "SANS 10400-T / municipal fire by-laws", stage: "at_completion", responsible: "Fire engineer / contractor", area: "statutory" },
  { key: "occupation-certificate", title: "Occupation certificate", source: "National Building Regulations Act 103 of 1977, s. 14", stage: "at_completion", responsible: "Architect / owner, issued by the local authority", area: "statutory" },
];

export interface ComplianceState {
  status: ComplianceStatus;
  neededBy: string | null;
  expiresOn: string | null;
}

/** What needs attention about an item, today – or null where nothing does. */
export function complianceFlag(item: ComplianceState, today: string): { kind: "overdue" | "expired" | "expiring"; days: number } | null {
  if (item.status === "not_applicable") return null;
  if (item.status === "approved") {
    if (!item.expiresOn) return null;
    const left = daysFrom(today, item.expiresOn);
    if (left < 0) return { kind: "expired", days: -left };
    if (left <= 30) return { kind: "expiring", days: left };
    return null;
  }
  if (item.neededBy && item.neededBy < today) return { kind: "overdue", days: daysFrom(item.neededBy, today) };
  return null;
}

/** The register's headline: how many are done, open and in trouble, applicable items only. */
export function complianceSummary(items: readonly ComplianceState[], today: string) {
  const applicable = items.filter((i) => i.status !== "not_applicable");
  return {
    applicable: applicable.length,
    approved: applicable.filter((i) => i.status === "approved" && complianceFlag(i, today)?.kind !== "expired").length,
    open: applicable.filter((i) => i.status !== "approved").length,
    attention: applicable.filter((i) => {
      const f = complianceFlag(i, today);
      return f !== null && f.kind !== "expiring";
    }).length,
  };
}
