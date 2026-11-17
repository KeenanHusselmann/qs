/**
 * What kind of value each field holds, and the check a typed figure must pass (audit C4).
 *
 * A field was free text, so "421000" could be typed and signed as the list of tenderers. Each field
 * now declares a kind, and a correction is read with the same readers the platform already uses for
 * documents – a figure that cannot be read with certainty is refused in words, never stored.
 *
 * One map rather than a property on 74 specs: it reads as a single reviewable list, and the test
 * beside it fails when a field set gains a field without a kind. `text` is the default only by
 * declaration – prose fields (a contract form, payment terms, a penalty "per day") are not figures,
 * and forcing them through a money reader would refuse what a QS legitimately writes.
 */

import { readAmount, readPercent, readQuantity } from "@/domain/amount";
import { readDate } from "@/domain/date-reading";

export type FieldKind = "money" | "count" | "quantity" | "percent" | "date" | "names" | "text";

export const FIELD_KINDS: Readonly<Record<string, FieldKind>> = {
  // Feasibility
  erf: "text",
  units: "count",
  mix: "text",
  "unit-area": "quantity",
  "selling-price": "money",
  // A rate – "96 units per annum", "8 a month" – which the quantity reader refuses as a ratio.
  absorption: "text",
  bulk: "money",
  zoning: "text",
  subsidy: "money",
  // A band – "R3 500 to R22 000 a month" – not one amount.
  "income-band": "text",
  programme: "quantity",
  // Cost plan
  "cp-units": "count",
  "cp-unit-area": "quantity",
  "cp-erf": "text",
  "cp-basis": "text",
  "cp-total": "money",
  "cp-substructure": "money",
  "cp-superstructure": "money",
  "cp-finishes": "money",
  "cp-services": "money",
  "cp-external-works": "money",
  "cp-preliminaries": "money",
  "cp-contingency": "money",
  "cp-escalation": "money",
  // Contract
  "ct-form": "text",
  "ct-contractor": "names",
  "ct-sum": "money",
  "ct-retention": "percent",
  // Often stated as a percentage of the contract sum, so not forced to rand.
  "ct-retention-limit": "text",
  "ct-completion": "date",
  // A rate per day, which the money reader rightly refuses as an amount.
  "ct-penalty": "text",
  "ct-cpap": "text",
  "ct-payment-terms": "text",
  "ct-advance": "text",
  "ct-signed": "date",
  // Valuations
  "vl-contract-sum": "money",
  "vl-retention": "percent",
  "vl-number": "text",
  "vl-period": "date",
  "vl-work-executed": "money",
  "vl-materials": "money",
  "vl-variations": "money",
  "vl-previously": "money",
  "vl-dayworks": "money",
  // Variations
  "vo-number": "text",
  "vo-instruction": "text",
  "vo-description": "text",
  "vo-reason": "text",
  "vo-value": "money",
  "vo-time": "text",
  "vo-status": "text",
  "vo-contract-sum": "money",
  // Cost report
  "cr-contract-sum": "money",
  "cr-certified": "money",
  "cr-date": "date",
  "cr-forecast": "money",
  "cr-variance": "money",
  "cr-committed": "money",
  "cr-variations": "money",
  "cr-risks": "text",
  // Final account
  "fa-contract-sum": "money",
  "fa-value": "money",
  "fa-variations": "money",
  "fa-remeasurement": "money",
  "fa-retention": "money",
  "fa-penalties": "money",
  "fa-date": "date",
  "fa-agreed-by": "names",
  // Tender analysis
  "ta-tenderers": "names",
  // One sum per tenderer, so a list rather than one amount.
  "ta-sums": "text",
  "ta-lowest": "money",
  "ta-recommended": "names",
  "ta-adjustments": "text",
  "ta-qualifications": "text",
  "ta-validity": "text",
  "ta-closing": "date",
};

export const kindOf = (fieldId: string): FieldKind => FIELD_KINDS[fieldId] ?? "text";

/** What the empty box shows, so the expected form is visible before anything is refused. */
export const PLACEHOLDER: Readonly<Record<FieldKind, string>> = {
  money: "R 0,00",
  count: "e.g. 1 046",
  quantity: "e.g. 48",
  percent: "e.g. 5%",
  date: "e.g. 31/03/2027",
  names: "Names, separated by commas",
  text: "Your figure",
};

export type FieldCheck = { ok: true } | { ok: false; reason: string };

const COUNT = /^\d{1,3}(?:[  ]\d{3})*$|^\d+$/;

/** Whether a typed value can stand as this kind of field. Refusals are one short sentence. */
export function checkFieldValue(kind: FieldKind, value: string, unit?: string): FieldCheck {
  const text = value.trim();
  if (text === "") return { ok: false, reason: "Enter a value." };

  switch (kind) {
    case "money": {
      const r = readAmount(text);
      return r.ok ? { ok: true } : { ok: false, reason: r.reason };
    }
    case "count":
      return COUNT.test(text) ? { ok: true } : { ok: false, reason: "A count is a whole number, e.g. 1 046." };
    case "quantity": {
      const r = readQuantity(text, { unit });
      return r.ok ? { ok: true } : { ok: false, reason: r.reason };
    }
    case "percent": {
      const r = readPercent(text, { min: 0, max: 100 });
      return r.ok ? { ok: true } : { ok: false, reason: r.reason };
    }
    case "date": {
      const r = readDate(text);
      return r.ok ? { ok: true } : { ok: false, reason: r.reason };
    }
    case "names":
      return /\p{L}/u.test(text) ? { ok: true } : { ok: false, reason: "Enter names, not a number." };
    case "text":
      return { ok: true };
  }
}
