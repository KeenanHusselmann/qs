/**
 * The kinds of document the platform files.
 *
 * ── Derived, not typed out ─────────────────────────────────────────────────────────────────
 *
 * These come from the `acceptedEvidence` on the entry criteria (§1.3.3), because that is what
 * makes a filed document *satisfy* something. Keeping a second hand-maintained list would let the
 * two drift, and v3 records exactly what that costs:
 *
 * > "This control once sent `category: "other"` for everything, no service reads `other`, so every
 * > document uploaded through the portal was filed where nothing could read it. The upload
 * > succeeded and the step went on asking for a document that was already there."
 *
 * A document filed under a kind no criterion looks for is invisible, and invisible in the worst
 * way — the user believes they have done the thing. So the list of kinds *is* the list of evidence
 * criteria accept, and nothing can be filed outside it.
 */

import { DEFAULT_CRITERIA } from "@/lib/entry-criteria";
import { deliverableKinds } from "@/lib/phase-deliverables";

/**
 * Kinds a step reads without an entry criterion asking for them. A quotation is filed on the
 * Quotations step as a response to an RFQ – the step's own list says what is filed, and a criterion
 * would only count it a second time.
 */
const STEP_KINDS = ["Quotation"];

/** Every kind of evidence some criterion accepts, the kinds a step reads itself, and the kinds a deliverable counts – sorted, de-duplicated. */
export const DOCUMENT_KINDS: readonly string[] = [
  ...new Set([...DEFAULT_CRITERIA.flatMap((c) => c.acceptedEvidence), ...STEP_KINDS, ...deliverableKinds()]),
].sort((a, b) => a.localeCompare(b));

/**
 * The kinds that would satisfy a given criterion, offered first when filing from a blocked step.
 *
 * v3's rule: a reader who discovered they needed a document should be able to file it *there*,
 * without leaving to find a documents page and work out the category. The rest stay available —
 * a geotechnical report is worth filing even where nothing reads it yet.
 */
export function kindsFor(criterionId: string): readonly string[] {
  const criterion = DEFAULT_CRITERIA.find((c) => c.id === criterionId);
  if (!criterion) return DOCUMENT_KINDS;

  return [
    ...criterion.acceptedEvidence,
    ...DOCUMENT_KINDS.filter((k) => !criterion.acceptedEvidence.includes(k)),
  ];
}

/** Which criteria a document of this kind could satisfy. The other direction of the same link. */
export function criteriaSatisfiedBy(kind: string): readonly string[] {
  return DEFAULT_CRITERIA.filter((c) => c.acceptedEvidence.includes(kind)).map((c) => c.id);
}

export const isKnownKind = (kind: string) => DOCUMENT_KINDS.includes(kind);

/**
 * The kinds that can answer a request for quotation – a supplier's priced submission.
 *
 * ── Why this is a list and not just "Quotation" ────────────────────────────────────────────
 *
 * The Quotations step offered the corpus to pick a response from, filtered to documents filed as
 * "Quotation". Three engineering fee proposals were filed on a real project, correctly, as "Fee
 * proposal" – so the picker was empty, and the only way to get them onto the RFQ was to upload
 * them a second time. A project's corpus is meant to be the place every step reads from; a step
 * that makes you re-file what is already there has stopped believing that.
 *
 * What belongs here is one idea: a supplier's priced answer to a request. A bill of quantities is
 * not one (it is what a response prices), an appointment letter is not one (it comes after), and a
 * technical proposal is not one either – it carries no price, and it attaches to a response as a
 * supporting document rather than standing as one.
 */
export const RESPONSE_KINDS: readonly string[] = [
  "Quotation",
  "Fee proposal",
  "Contractor's quotation",
  "Contractor's response",
  "Tender submission",
  "Tender return",
];
