/**
 * What the portfolio's signed cost figures add up to — the firm view of the cost stack.
 *
 * ── Per project, then summed ───────────────────────────────────────────────────────────────
 *
 * The build-up is computed once per project and the categories added, rather than the inputs
 * being pooled and the build-up run once over the pool. It matters: the NHBRC line scales with a
 * *home's* value, so pooling two schemes and running one calculation would enrol every home in
 * both at some blended value that neither scheme has. Summing the answers is right where summing
 * the questions is not.
 *
 * It costs a query per project. That is the honest shape of the calculation, and a firm with fifty
 * projects can have a single aggregate written for it on the day fifty is the number — designing
 * for it now would mean guessing at how to blend a home value, which is the thing that would be
 * wrong.
 *
 * ── Only what is signed ────────────────────────────────────────────────────────────────────
 *
 * Every figure comes from `loadSignedFigures`, so a draft cost plan contributes nothing. A chart
 * of the portfolio's money that quietly included unapproved figures would be the most persuasive
 * wrong number in the platform.
 */

import { readAmount } from "@/domain/amount";
import { costStack } from "@/domain/cost-stack";
import { money, type Money } from "@/domain/money";
import { loadSignedFigures } from "@/lib/agent/persist";

/** The elements a cost plan signs, in the order a cost analysis reads them. */
const ELEMENTS: readonly { fieldId: string; label: string }[] = [
  { fieldId: "cp-substructure", label: "Substructure" },
  { fieldId: "cp-superstructure", label: "Superstructure" },
  { fieldId: "cp-finishes", label: "Finishes and fittings" },
  { fieldId: "cp-services", label: "Engineering services" },
  { fieldId: "cp-external-works", label: "External works" },
  { fieldId: "cp-preliminaries", label: "Preliminaries and general" },
  { fieldId: "cp-contingency", label: "Contingency" },
  { fieldId: "cp-escalation", label: "Escalation" },
];

export interface PortfolioCost {
  /** Signed construction cost by element, across every project that signed one. */
  elements: { label: string; amount: Money }[];
  /** What the development cost is made of, beyond the building itself. */
  composition: { label: string; amount: Money }[];
  construction: Money;
  totalDevelopmentCost: Money;
  /** How many projects contributed a signed cost plan. */
  projects: number;
}

const sum = (amounts: readonly Money[]): Money =>
  money(amounts.reduce((total, amount) => total + amount, 0n));

/**
 * Read a signed figure as money, or nothing.
 *
 * `readAmount` refuses a qualified figure rather than guessing at one — "R466 600 000 excluding
 * VAT" is not R466 600 000 — so a refusal drops the line out of the chart instead of quietly
 * understating the portfolio by whatever the qualifier meant.
 */
function amountOf(fields: readonly { fieldId: string; value: string }[], fieldId: string): Money | null {
  const found = fields.find((f) => f.fieldId === fieldId);
  if (!found) return null;

  const reading = readAmount(found.value);
  return reading.ok ? reading.amount : null;
}

export async function loadPortfolioCost(projectIds: readonly string[]): Promise<PortfolioCost> {
  const elementTotals = new Map<string, Money>();

  let construction = money(0n);
  let bulk = money(0n);
  let fees = money(0n);
  let statutory = money(0n);
  let projects = 0;

  for (const id of projectIds) {
    const signed = await loadSignedFigures(id);
    const fields = signed.flatMap((step) => step.fields);
    if (fields.length === 0) continue;

    const total = amountOf(fields, "cp-total");
    if (total === null) continue;

    projects += 1;

    for (const element of ELEMENTS) {
      const amount = amountOf(fields, element.fieldId);
      if (amount === null) continue;
      elementTotals.set(element.label, money((elementTotals.get(element.label) ?? 0n) + amount));
    }

    const units = (() => {
      const raw = fields.find((f) => f.fieldId === "cp-units" || f.fieldId === "units")?.value;
      if (!raw) return null;
      const digits = raw.replace(/[^\d]/g, "");
      return digits ? Number(digits) : null;
    })();

    const stack = costStack({
      construction: total,
      constructionCarriesContingency:
        fields.some((f) => f.fieldId === "cp-contingency" || f.fieldId === "cp-escalation"),
      landValue: null,
      vatVendor: false,
      bulkContribution: amountOf(fields, "bulk"),
      units,
      averageHomeValue: amountOf(fields, "selling-price"),
      statedFeePercent: null,
    });

    construction = money(construction + stack.construction);
    bulk = money(bulk + stack.bulk);
    fees = money(fees + stack.professionalFees);
    statutory = money(statutory + stack.statutory);
  }

  const elements = ELEMENTS.flatMap((element) => {
    const amount = elementTotals.get(element.label);
    return amount && amount > 0n ? [{ label: element.label, amount }] : [];
  }).sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));

  // Sorted, so the chart answers "which of these is largest" without the reader scanning.
  const composition = [
    { label: "Construction", amount: construction },
    { label: "Professional fees", amount: fees },
    { label: "Bulk services", amount: bulk },
    { label: "Statutory and compliance", amount: statutory },
  ]
    .filter((line) => line.amount > 0n)
    .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));

  return {
    elements,
    composition,
    construction,
    totalDevelopmentCost: sum([construction, bulk, fees, statutory]),
    projects,
  };
}
