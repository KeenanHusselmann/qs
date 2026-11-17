/**
 * B1–B7 — the total development cost build-up. Ported from v3's `qs_agent.py`.
 *
 * ── What this platform builds up, and what v3 builds up ────────────────────────────────────
 *
 * v3 *constructs* the building cost: typology × area × rate, plus bulk, plus civils. It has to,
 * because it is estimating from a brief. This platform reads a **QS's own signed cost plan**, so
 * the building cost arrives already established by a person — the very thing v3 is approximating.
 *
 * So the shape of the port changes on purpose. B2–B4 is taken as signed rather than derived, and
 * what is added around it is exactly what a construction cost plan excludes and a *development*
 * cost includes: the land and its transfer duty, the bulk contribution, professional fees, and the
 * statutory lines. Ridgeview's cost plan says so in its own words — "excludes value added tax,
 * professional fees and land cost".
 *
 * ── Contingency counted once ───────────────────────────────────────────────────────────────
 *
 * v3 adds B7 contingency and escalation on top of a raw construction figure. A signed elemental
 * cost plan frequently carries both *inside* its total — Ridgeview's does, as named elements. So
 * the build-up asks whether they are already in there and says which, rather than adding a second
 * contingency to a figure that has one. Double-counting a contingency inflates a development cost
 * by the one line nobody checks, because everybody assumes it was included.
 *
 * ── Every line says where it came from ─────────────────────────────────────────────────────
 *
 * A development cost is not a signed figure and cannot honestly be presented as one: it is a
 * signed construction cost plus professional assumptions. Each line therefore carries its
 * provenance — `signed`, `derived` (computed from a signed figure on a stated basis), or
 * `assumption` — and the report renders the three differently. v3 does the same thing through
 * `basis=` on every `CostLine`; this makes it a field so a reader cannot miss it.
 */

import { applyPercent, money, percentFromRate, type Money } from "@/domain/money";
import { acquisitionTax, nhbrcEnrolmentFee, NHBRC_TABLE_DATE } from "@/domain/statutory";

/** Where a line's figure came from. The distinction is the point of the whole module. */
export type Provenance = "signed" | "derived" | "assumption";

export interface CostLine {
  /** v3's coding — B1.1, B5.3 — because that is how the build-up is referred to. */
  code: string;
  description: string;
  amount: Money;
  /** How it was arrived at: a percentage, a table, or a signature. */
  basis: string;
  provenance: Provenance;
}

/**
 * The consultants and what each takes, as a percentage of construction.
 *
 * v3's schedule, unchanged, and it totals 10,15% — inside the 10–12% norm for a scheme of this
 * kind. A total outside that band is worth a second look rather than a silent acceptance, which is
 * what `feesAboveNorm` reports.
 */
export const PROFESSIONAL_FEE_SCHEDULE: readonly { discipline: string; percent: number }[] = [
  { discipline: "Architect", percent: 2.25 },
  { discipline: "Quantity Surveyor", percent: 1.5 },
  { discipline: "Civil Engineer", percent: 1.25 },
  { discipline: "Structural Engineer", percent: 0.9 },
  { discipline: "Electrical Engineer", percent: 0.75 },
  { discipline: "Project Manager", percent: 1.5 },
  { discipline: "Town Planner", percent: 0.4 },
  { discipline: "Land Surveyor", percent: 0.3 },
  { discipline: "Environmental Consultant", percent: 0.3 },
  { discipline: "Health & Safety Agent", percent: 0.35 },
  { discipline: "Fire Engineer", percent: 0.2 },
  { discipline: "Landscape Architect", percent: 0.25 },
  { discipline: "Social Facilitator", percent: 0.2 },
];

/** The statutory percentages of construction, from v3's B6. */
const STATUTORY = [
  { code: "B6.2", description: "Municipal plan scrutiny and approval fees", percent: 0.25 },
  { code: "B6.3", description: "Rates, taxes and insurance during development", percent: 0.4 },
  { code: "B6.4", description: "Bonds and guarantees", percent: 0.12 },
];

/** Above this, professional fees are worth questioning rather than accepting. */
const FEE_NORM_CEILING = 12;

export interface CostStackInputs {
  /** B2–B4. The signed cost plan's total construction cost. */
  construction: Money | null;
  /**
   * Whether that signed total already carries contingency and escalation.
   *
   * Derived by the caller from whether the cost plan signed those elements — not assumed, because
   * assuming it either way is how a contingency gets counted twice or not at all.
   */
  constructionCarriesContingency: boolean;
  /** B1. Null where no land value has been signed, which is the usual case at feasibility. */
  landValue: Money | null;
  /** A VAT vendor recovers input VAT and pays no transfer duty. */
  vatVendor: boolean;
  /** B2 external — the bulk services contribution, where it was signed separately. */
  bulkContribution: Money | null;
  /** B6.1 needs a count and a value per home. */
  units: number | null;
  averageHomeValue: Money | null;
  /** B5 — a fee percentage the QS has stated, which overrides the schedule. */
  statedFeePercent?: number | null;
}

export interface CostStack {
  lines: readonly CostLine[];
  construction: Money;
  bulk: Money;
  land: Money;
  professionalFees: Money;
  statutory: Money;
  /** The whole build-up. Null when the construction cost itself is not established. */
  totalDevelopmentCost: Money | null;
  /** Fees as a percentage of construction, for the norm check. */
  feePercent: number;
  feesAboveNorm: boolean;
  /** What could not be established, in the reader's words. */
  notes: readonly string[];
}

const sum = (amounts: readonly Money[]): Money =>
  money(amounts.reduce((total, amount) => total + amount, 0n));

/**
 * Build the development cost from what is signed plus stated assumptions.
 *
 * Returns a stack with `totalDevelopmentCost: null` when construction is not established, rather
 * than a total made of fees on nothing. A build-up whose largest line is missing is not a smaller
 * build-up; it is not a build-up.
 */
export function costStack(inputs: CostStackInputs): CostStack {
  const lines: CostLine[] = [];
  const notes: string[] = [];

  const construction = inputs.construction ?? money(0n);

  // ── B1 — land and acquisition ─────────────────────────────────────────────────────────
  let land = money(0n);

  if (inputs.landValue !== null) {
    lines.push({
      code: "B1.1",
      description: "Land acquisition",
      amount: inputs.landValue,
      basis: "Signed",
      provenance: "signed",
    });

    const tax = acquisitionTax(inputs.landValue, inputs.vatVendor);
    lines.push({
      code: "B1.2",
      description: "Transfer duty / acquisition tax",
      amount: tax.amount,
      basis: tax.basis,
      provenance: "derived",
    });

    land = money(inputs.landValue + tax.amount);
  } else {
    notes.push("No land value has been signed, so B1 is not in this build-up.");
  }

  // ── B2–B4 — the build ─────────────────────────────────────────────────────────────────
  if (inputs.construction === null) {
    notes.push("No construction cost has been signed, so no development cost can be built up.");
  } else {
    lines.push({
      code: "B4",
      description: "Construction cost",
      amount: construction,
      basis: inputs.constructionCarriesContingency
        ? "Signed cost plan, including its own contingency and escalation"
        : "Signed cost plan",
      provenance: "signed",
    });
  }

  const bulk = inputs.bulkContribution ?? money(0n);
  if (inputs.bulkContribution !== null) {
    lines.push({
      code: "B2.1",
      description: "Bulk services contribution",
      amount: inputs.bulkContribution,
      basis: "Signed",
      provenance: "signed",
    });
  } else {
    notes.push("No bulk services contribution has been signed.");
  }

  // ── B5 — professional fees ────────────────────────────────────────────────────────────
  const feeBase = money(construction + bulk);
  const feeLines: CostLine[] = [];

  if (inputs.statedFeePercent && inputs.statedFeePercent > 0) {
    feeLines.push({
      code: "B5.1",
      description: "Consultants' fees and disbursements",
      amount: applyPercent(feeBase, percentFromRate(inputs.statedFeePercent)),
      basis: `${inputs.statedFeePercent}% of construction, as stated by the QS`,
      provenance: "derived",
    });
  } else {
    PROFESSIONAL_FEE_SCHEDULE.forEach((fee, i) => {
      feeLines.push({
        code: `B5.${i + 1}`,
        description: fee.discipline,
        amount: applyPercent(feeBase, percentFromRate(fee.percent)),
        basis: `${fee.percent}% of construction`,
        provenance: "assumption",
      });
    });
  }

  const professionalFees = sum(feeLines.map((line) => line.amount));
  lines.push(...feeLines);

  // ── B6 — statutory ────────────────────────────────────────────────────────────────────
  const statutoryLines: CostLine[] = [];

  if (inputs.units !== null && inputs.averageHomeValue !== null && inputs.units > 0) {
    const perHome = nhbrcEnrolmentFee(inputs.averageHomeValue);
    statutoryLines.push({
      code: "B6.1",
      description: "Statutory home-warranty enrolment (NHBRC)",
      amount: money(perHome * BigInt(inputs.units)),
      basis: `${inputs.units} homes, NHBRC schedule of ${NHBRC_TABLE_DATE}`,
      provenance: "derived",
    });
  } else {
    notes.push("The NHBRC enrolment line needs a signed unit count and an average home value.");
  }

  for (const item of STATUTORY) {
    statutoryLines.push({
      code: item.code,
      description: item.description,
      amount: applyPercent(construction, percentFromRate(item.percent)),
      basis: `${item.percent}% of construction`,
      provenance: "assumption",
    });
  }

  const statutory = sum(statutoryLines.map((line) => line.amount));
  lines.push(...statutoryLines);

  // ── B7 — counted once ─────────────────────────────────────────────────────────────────
  if (inputs.constructionCarriesContingency) {
    notes.push(
      "Contingency and escalation are inside the signed construction cost and are not added again.",
    );
  } else if (inputs.construction !== null) {
    notes.push(
      "The signed cost plan does not carry contingency or escalation. Neither is added here — a " +
        "contingency nobody has costed is not one this build-up should invent.",
    );
  }

  const feePercent = construction > 0n ? (Number(professionalFees) / Number(construction)) * 100 : 0;

  return {
    lines,
    construction,
    bulk,
    land,
    professionalFees,
    statutory,
    totalDevelopmentCost:
      inputs.construction === null
        ? null
        : money(land + construction + bulk + professionalFees + statutory),
    feePercent,
    feesAboveNorm: feePercent > FEE_NORM_CEILING,
    notes,
  };
}
