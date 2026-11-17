/**
 * What an agent run is — PLATFORM.md §1.3, §1.3.1, §1.3.2.
 *
 * ── A run is not a conversation ────────────────────────────────────────────────────────────
 *
 * The obvious thing to build over a corpus is a chatbox: ask anything, get an answer. Every
 * platform has one, and for a QS it answers the wrong question. Nobody is trying to find out what
 * is in the documents — they are trying to fill in a cost model, and the model has a fixed shape.
 *
 * So a run is defined by the **fields it must return**, not by a prompt. It asks: what is the unit
 * count, the erf extent, the achievable selling price. Each answer arrives with the passage that
 * proves it. A field the corpus cannot ground comes back `not_found` — never guessed, never
 * averaged, never filled from another project (§1.3, no project-specific defaults).
 *
 * That constraint is the product. A number with a quotation behind it can be defended in a
 * valuation meeting; a number without one is a guess wearing a figure's clothes.
 *
 * ── One pattern, nine agents ───────────────────────────────────────────────────────────────
 *
 * Take-off, BoQ drafting, estimating, tender analysis, valuations, variations, cost reporting,
 * final account, contract administration — each is a run over the corpus plus the signed output of
 * the step before it. They differ in their field set and their reader, not in their shape, so this
 * module describes all of them and each module supplies its own `FieldSpec[]`.
 *
 * ── This module is the contract, not the work ──────────────────────────────────────────────
 *
 * The types and the field set are here because both sides need them. The reading happens on the
 * server, where the key is — `streamRun` is the client's half, and it yields exactly the events
 * `mockRun` used to. Building the screen against a mock first paid off precisely here: wiring in a
 * real model changed this module and added two, and the panel barely moved.
 */

import { reconcile } from "@/domain/amount";
import { formatMoney } from "@/domain/money";

/** Where a value ended up, and how much it can be trusted. */
export type FieldState =
  /** Found in the corpus, with a passage to show for it. */
  | "found"
  /** Read, but the agent is not confident. Needs a human before anything downstream reads it. */
  | "uncertain"
  /** Not in the corpus. Stated as absent — never inferred, never carried from another project. */
  | "not_found";

/** One thing a run is required to establish. */
export interface FieldSpec {
  id: string;
  label: string;
  /** What it feeds, so a reviewer knows what a wrong value would break. */
  feeds: string;
  unit?: string;
  /** A field the model cannot proceed without. Its absence is a refusal, not a gap. */
  required: boolean;
  /**
   * What to search the corpus for before asking anything.
   *
   * **The words a document uses, not a description of the field.** The first set of these were
   * written as labels — "erf extent", "average unit area" — and retrieved nothing from a brief that
   * says "Erf 180" and "walk-up units of 48 m2". Seven of ten fields came back "no passage mentions
   * this" about a document that mentioned most of them. So: `accommodation schedule`, because that
   * is what a South African feasibility calls it; `comparable sales`, because that is where a
   * market study puts a price.
   *
   * **Bias toward recall.** The two errors are not symmetric now that a quote has to be found in
   * the corpus before a value is reported: retrieving a passage that turns out not to answer the
   * question costs a few tokens and the model says so, while failing to retrieve the passage that
   * does answer it is indistinguishable, on screen, from the document not containing it. One is
   * visible and cheap, the other is silent and wrong.
   *
   * Still phrases rather than loose words — `retrieve.ts` records what happens otherwise, where
   * "project" matches every construction document ever written. Single words appear here only when
   * they are terms of art: `erf`, `servitude`, `absorption`.
   */
  terms: readonly string[];

  /**
   * A figure this step takes from an upstream service rather than reading again — §1.3.1.
   *
   * ── Why a carried field is not just a retrieved one ────────────────────────────────────
   *
   * The cost plan needs the unit count. It is in the brief, so the model could be asked for it a
   * second time — and would sometimes come back with a different answer, from a different sentence,
   * on a project where a person has already reviewed the first one and signed their name to it.
   * Two numbers for one fact, one of them approved and one of them not, is the failure this whole
   * chain is arranged against.
   *
   * So it is **carried**: read from the upstream run's frozen `output`, never re-extracted, and
   * never asked of the model at all. `where signed_at is not null` is what makes that safe — an
   * unsigned upstream has nothing to give, so a step cannot accidentally build on a draft.
   *
   * Both provenances survive. `carried_via` records the path it travelled, and the original
   * document, page and quote are copied across with it, because a reader checking a figure in a
   * cost report needs to reach the brief it was read from — not merely the step it came through.
   */
  carriedFrom?: { module: string; fieldId: string };

  /**
   * How this figure takes part in the step's own arithmetic — PLATFORM.md §5.
   *
   * `element` is a part; `total` is the whole the document states. Marking them is what lets a step
   * check itself: the elements are summed and compared with the stated total, and a difference is
   * reported to the QS rather than resolved. Nothing else is money, and a figure left unmarked is
   * never added to anything — `R42 000,00 per calendar day` is a real number and is not a quantity
   * of money this project owes.
   */
  money?: "element" | "total";
}

/** The passage a value came from. Without this a value is not reportable (§1.3.2). */
export interface Citation {
  /**
   * Null where the document has since been deleted.
   *
   * `on delete set null` on the foreign key is deliberate — a citation whose document is gone is
   * still provenance, because the *name* is what tells a reader which document it was. This used
   * to be typed `string` and the read coerced the null to `""`, which produced a value that meant
   * "no document" while looking like a document id. It reached Postgres as an empty string in a
   * uuid column and crashed the run that carried it.
   *
   * Every consumer already branched on it being falsy to decide whether to render a link, so the
   * type was the only thing insisting the id was always there.
   */
  documentId: string | null;
  document: string;
  page?: number;
  quote: string;
}

export interface FieldResult {
  field: FieldSpec;
  state: FieldState;
  value: string | null;
  citation: Citation | null;
  /** 0–1. Below the threshold a value is `uncertain` however well-formed it looks. */
  confidence: number;
  /**
   * Why this field ended up where it did, when the reason is not obvious from the state.
   *
   * It exists for one case above all: the model returned a figure and a quote, and the quote was
   * not in the corpus. Discarding that silently would show `not_found` and let a reader conclude
   * the documents are missing something they are not. The guardrail has to be visible, or nobody
   * can tell a quiet agent from a careful one.
   */
  note?: string;
}

/**
 * Where a run got to, as it is stored.
 *
 * **`signed` is not one of these.** A signature is `signedBy` + `signedAt`, and a status column
 * beside a timestamp is two places for one fact that can disagree — §6.5 says derive. `runState`
 * below is the one place that decides what a run *is*, so a header and a row cannot differ about it.
 */
export type RunStatus = "running" | "review" | "failed";

/**
 * One field of a persisted run — the four maps of §1.3.1 as they are actually stored.
 *
 * `proposed` and `override` are separate objects rather than flattened columns because the whole
 * design is that they stay distinguishable: the agent's answer is still there underneath a
 * correction, and a reviewer months later can see both what the machine said and what the person
 * decided.
 */
export interface RunField {
  fieldId: string;
  /**
   * The label as it was at proposal time, copied like a BillItem copies its description (§6.4 #9).
   * The live spec is looked up from `fieldId` for the unit and what it feeds; this is what makes a
   * frozen run still readable after the field set moves on.
   */
  label: string;
  seq: number;
  proposed: {
    state: FieldState;
    value: string | null;
    confidence: number;
    note: string | null;
  };
  /** The retrieval record the value came from (§1.3.2). Null where nothing grounded it. */
  citation: Citation | null;
  /**
   * The upstream module this figure travelled through, when it was not read from a document here.
   *
   * Its `citation` is still the original document (§1.3.1 — both provenances are kept), so a reader
   * gets the brief the number came out of *and* the step that approved it.
   */
  carriedVia: string | null;
  /** What the human corrected or filled. Null where they have not touched it. */
  override: { value: string; reason: string | null; by: string; at: string } | null;
  /** Frozen at sign-off. Null in a draft — and null in a signed run means "signed as unestablished". */
  output: string | null;
}

/** A run as a row rather than as component state — §1.3.1, "a run in flight survives everything". */
export interface PersistedRun {
  id: string;
  module: string;
  status: RunStatus;
  /** The provider's own words when it stopped. Surfaced, never swallowed (§1.3). */
  error: string | null;
  startedAt: string;
  /**
   * When something was last written — the newest field, or the start if nothing landed yet.
   *
   * Derived from the fields rather than stored, so a run does not need an extra UPDATE per field to
   * keep a heartbeat. It is what tells a stalled run from a running one.
   */
  lastWriteAt: string;
  signedBy: string | null;
  signedAt: string | null;
  /** Why it was signed although its money did not reconcile (audit C3). Absent or null: none. */
  signoffNote?: string | null;
  spend: { input: number; output: number; rand: number | null } | null;
  fields: RunField[];
}

/**
 * `working` — proposed plus overrides, **human wins** (§1.3.1).
 *
 * One function, used by the screen, by sign-off, and by whatever reads a signed run downstream. Two
 * implementations of this rule is how a screen comes to show one figure and a certificate another.
 */
export function workingValue(field: RunField): string | null {
  return field.override?.value ?? field.proposed.value;
}

/**
 * A run started and never finished stops looking like a run at some point.
 *
 * The function that produced it is capped at 60 seconds (`maxDuration`), and a Vercel function
 * killed at the cap writes nothing on its way out — so a row can sit at `running` forever. §1.3.1:
 * when a run has been open too long with nothing written, the platform says *that* rather than
 * showing a spinner that lies.
 *
 * The grace is generous on purpose. Calling a live run stalled is worse than calling a dead one
 * running: one wastes a reader's patience, the other tells them their work was lost when it was not.
 */
const STALL_AFTER_MS = 120_000;

export type RunState = RunStatus | "stalled" | "signed";

/**
 * What a run *is*, decided once — for a field run and a row-shaped one alike.
 *
 * It takes the three columns the answer depends on rather than a whole `PersistedRun`, so a bill
 * asks the same function rather than growing a second definition of "stalled". §6.5's rule applied
 * to logic: one place, or two surfaces eventually disagree about what a word means.
 */
export function runState(
  run: Pick<PersistedRun, "status" | "lastWriteAt" | "signedAt">,
  now: number = Date.now(),
): RunState {
  if (run.signedAt) return "signed";
  if (run.status !== "running") return run.status;
  return now - new Date(run.lastWriteAt).getTime() > STALL_AFTER_MS ? "stalled" : "running";
}

/**
 * The fields a feasibility estimate has to establish — D1.1.
 *
 * Drawn from the affordability envelope and the B1–B7 cost stack: these are the inputs the
 * financial model reads, so a run that returns them is a run that can produce a verdict.
 */
export const FEASIBILITY_FIELDS: readonly FieldSpec[] = [
  {
    /**
     * The target household income band — the binding input.
     *
     * First in the set, because affordable housing is constraint-led: the price a scheme can
     * charge is capped by what its buyers can finance, and every cost after it is tested against
     * that ceiling. A feasibility that reaches cost before it reaches affordability is a
     * developer's appraisal read backwards.
     *
     * It was missing, and its absence was visible: the viability report's section 2 could not be
     * produced, and neither could the affordability gate. A brief and a market study both state
     * it in plain words — Ridgeview's say "households earning between R8 000 and R30 000 per
     * month" — so it is extracted and signed like every other figure rather than being a setting
     * somebody types.
     */
    id: "income-band",
    label: "Target household income band",
    feeds: "The affordability ceiling every cost is tested against",
    unit: "R",
    required: true,
    terms: [
      "household income",
      "income band",
      "target market",
      "earning between",
      "monthly income",
      "gross household income",
      "affordable band",
    ],
  },
  {
    id: "erf",
    label: "Erf number and extent",
    feeds: "Development charges, bulk services",
    unit: "m²",
    required: true,
    terms: ["erf", "erf number", "site extends", "hectares in extent", "developable area", "total extent"],
  },
  {
    id: "units",
    label: "Total unit count",
    feeds: "Every per-unit rate in B1–B7",
    required: true,
    terms: ["total units", "residential units", "number of units", "unit count", "dwelling units", "units delivered"],
  },
  {
    id: "mix",
    label: "Unit mix and typologies",
    feeds: "Weighted build cost",
    required: true,
    terms: ["unit mix", "accommodation schedule", "typology schedule", "typologies", "bedroom units", "unit types"],
  },
  {
    id: "unit-area",
    label: "Average unit area",
    feeds: "Rate per m² applied to the build",
    unit: "m²",
    required: true,
    terms: ["unit size", "average unit area", "accommodation schedule", "floor area", "square metres", "gross floor area"],
  },
  {
    id: "selling-price",
    label: "Achievable selling price",
    feeds: "The affordability envelope, and Gate 0",
    unit: "R",
    required: true,
    terms: ["selling price", "achievable price", "comparable sales", "sales price", "price per unit", "asking price"],
  },
  {
    id: "absorption",
    label: "Absorption rate",
    feeds: "Cash flow and escalation over the programme",
    unit: "units/yr",
    required: true,
    terms: ["absorption rate", "absorption", "sales rate", "units per annum", "take-up rate"],
  },
  {
    id: "bulk",
    label: "Bulk services contribution",
    feeds: "B4 — frequently the difference between viable and not",
    unit: "R",
    required: false,
    terms: ["bulk services contribution", "bulk contribution", "bulk services", "development charges", "engineering services contribution"],
  },
  {
    id: "zoning",
    label: "Permitted use and density",
    feeds: "Whether the scheme is buildable as briefed",
    required: false,
    terms: ["permitted use", "land use rights", "zoned", "density", "units per hectare", "zoning certificate"],
  },
  {
    id: "subsidy",
    label: "Subsidy quantum",
    feeds: "The constraint the scheme is tested against",
    unit: "R",
    required: false,
    terms: ["subsidy quantum", "subsidy", "FLISP", "housing subsidy", "funder criteria", "grant funding"],
  },
  {
    /**
     * Required, as the other three cash-flow inputs are.
     *
     * It was optional, and the cash flow refuses to run without it – so a feasibility could be
     * signed complete while the viability report's financial viability and sensitivity sections,
     * and gates 3 to 5, stayed unevaluated with nothing on the step saying why. A QS whose documents
     * do not state one types it on the row before signing.
     */
    id: "programme",
    label: "Programme duration",
    feeds: "The cash flow – financial viability, sensitivity, and escalation over the build",
    unit: "months",
    required: true,
    terms: ["construction programme", "programme duration", "construction period", "phasing", "phasing plan"],
  },
];

/**
 * The elemental cost plan — D1.1's second sub-process, and the first step to read another's output.
 *
 * ── The field set is the document's own shape ──────────────────────────────────────────────
 *
 * An elemental estimate is not an open question about a corpus; it is a known list of elements with
 * an amount against each, and a total that ought to be the sum of them. So the run asks for exactly
 * those, in the words an ASAQS Class 4/5 plan uses — `substructure`, `preliminaries and general`,
 * `contingency` — and reports the ones the plan does not carry as absent rather than as nought. An
 * element costing nothing and an element nobody priced are different facts, and the difference is
 * roughly a third of a greenfield affordable scheme.
 *
 * ── Three of them are carried, not read ────────────────────────────────────────────────────
 *
 * The scheme's shape — how many units, how big, on what land — was established, reviewed and signed
 * on the feasibility estimate. Asking a model to read it again out of the same corpus would produce
 * a second answer to a settled question, and there would be no way to tell afterwards which one a
 * cost per unit had been divided by. They arrive from the signed output with their original
 * citations intact.
 *
 * ── Why the amounts stay as the document writes them ───────────────────────────────────────
 *
 * `R186 420 000,00` is stored as text, exactly as `FEASIBILITY_FIELDS` stores its figures, and not
 * yet as the `bigint` minor units §5.1 requires. Parsing a currency out of a model's answer is
 * where a confident wrong number gets in — a misread thousands separator is silent and survives
 * review — and §5.2's round-once rule is about `quantity × rate` at a bill item, which is the BoQ's
 * job rather than this one's. `money.ts` is waiting for the step that actually multiplies.
 */
export const COST_PLAN_FIELDS: readonly FieldSpec[] = [
  {
    id: "cp-units",
    label: "Total unit count",
    feeds: "Cost per unit, and every per-unit rate below",
    required: true,
    terms: [],
    carriedFrom: { module: "/feasibility", fieldId: "units" },
  },
  {
    id: "cp-unit-area",
    label: "Average unit area",
    feeds: "Cost per m², the figure a plan is benchmarked on",
    unit: "m²",
    required: true,
    terms: [],
    carriedFrom: { module: "/feasibility", fieldId: "unit-area" },
  },
  {
    id: "cp-erf",
    label: "Erf number and extent",
    feeds: "External works and services, which are priced against land not floor area",
    required: false,
    terms: [],
    carriedFrom: { module: "/feasibility", fieldId: "erf" },
  },
  {
    id: "cp-basis",
    label: "Estimate class and basis",
    feeds: "The accuracy band the whole plan may be quoted at",
    required: true,
    terms: ["asaqs", "class 4", "class 5", "elemental estimate", "order of magnitude", "estimate basis", "cost plan"],
  },
  {
    id: "cp-total",
    label: "Total construction cost",
    feeds: "The number the feasibility verdict is re-tested against",
    unit: "R",
    required: true,
    money: "total",
    terms: ["total construction cost", "priced bill totals", "bill total", "total excluding vat", "estimate total", "total cost"],
  },
  {
    id: "cp-substructure",
    label: "Substructure",
    feeds: "Element cost, and the ground-conditions risk the plan is carrying",
    unit: "R",
    required: true,
    money: "element",
    terms: ["substructure", "strip footings", "foundations", "surface beds", "excavation"],
  },
  {
    id: "cp-superstructure",
    label: "Superstructure",
    feeds: "Element cost — usually the largest single element",
    unit: "R",
    required: true,
    money: "element",
    terms: ["superstructure", "external walls", "internal partitions", "roof construction", "frame"],
  },
  {
    id: "cp-finishes",
    label: "Finishes and fittings",
    feeds: "The specification level the plan assumes",
    unit: "R",
    required: false,
    money: "element",
    terms: ["finishes", "floor finishes", "wall finishes", "fittings", "ironmongery", "joinery"],
  },
  {
    id: "cp-services",
    label: "Engineering services",
    feeds: "B4 — on greenfield affordable housing frequently the difference between viable and not",
    unit: "R",
    required: false,
    money: "element",
    terms: ["engineering services", "electrical installation", "wet services", "plumbing and drainage", "bulk services", "civil services"],
  },
  {
    id: "cp-external-works",
    label: "External works",
    feeds: "Roads, parking, landscaping and site development",
    unit: "R",
    required: false,
    money: "element",
    terms: ["external works", "site works", "roads and paving", "parking", "landscaping", "boundary walls"],
  },
  {
    id: "cp-preliminaries",
    label: "Preliminaries and general",
    feeds: "The contractor's time-related cost, which moves with the programme",
    unit: "R",
    required: true,
    money: "element",
    terms: ["preliminaries", "preliminaries and general", "p&g", "site establishment", "time related"],
  },
  {
    id: "cp-contingency",
    label: "Contingency",
    feeds: "What the plan admits it does not yet know",
    unit: "R",
    required: false,
    money: "element",
    terms: ["contingency", "contingencies", "design development allowance", "risk allowance"],
  },
  {
    id: "cp-escalation",
    label: "Escalation",
    feeds: "Cost at completion rather than cost today",
    unit: "R",
    required: false,
    money: "element",
    terms: ["escalation", "cpap", "price adjustment", "inflation allowance", "base date"],
  },
];

/**
 * The contract — D1.4, and the document every figure after it is measured against.
 *
 * ── Why this reads so cleanly out of a corpus ──────────────────────────────────────────────
 *
 * A JBCC contract states its own particulars in a schedule: the form and edition, the parties, the
 * sum, the retention percentage and its limit, the dates, whether CPAP applies and from what base.
 * These are not inferred from anything — they are written down, in one document, in the words below.
 * It is the closest thing in the QS lifecycle to a form that has already been filled in, which is
 * exactly why a person should never have to retype it.
 *
 * ── And why getting it wrong is expensive ──────────────────────────────────────────────────
 *
 * §6.4's most important invariant is that an issued certificate is immutable. A certificate is
 * computed from the retention rate and the limit that sit here. A retention rate read wrongly and
 * signed is a wrong deduction on every certificate that follows it, in a document the contractor has
 * already been paid against — which is why every one of these carries the clause it came from.
 */
export const CONTRACT_FIELDS: readonly FieldSpec[] = [
  {
    id: "ct-form",
    label: "Contract form and edition",
    feeds: "Which rules govern everything downstream — payment, variations, penalties",
    required: true,
    terms: ["jbcc", "principal building agreement", "form of contract", "edition", "nec", "fidic", "general conditions of contract"],
  },
  {
    id: "ct-contractor",
    label: "Contractor",
    feeds: "Who is certified to, and named on every certificate",
    required: true,
    terms: ["contractor", "the contractor is", "appointed contractor", "successful tenderer", "party of the second part"],
  },
  {
    id: "ct-sum",
    label: "Contract sum",
    feeds: "The baseline every variation and certificate moves against",
    unit: "R",
    required: true,
    terms: ["contract sum", "accepted contract amount", "contract value", "tender sum", "total contract price"],
  },
  {
    id: "ct-retention",
    label: "Retention percentage",
    feeds: "A deduction on every certificate — §6.4's invariant depends on it",
    required: true,
    terms: ["retention", "retention percentage", "percentage retention", "retention shall be"],
  },
  {
    id: "ct-retention-limit",
    label: "Retention limit",
    feeds: "The cap retention may never exceed (§6.4 #6)",
    unit: "R",
    required: false,
    terms: ["limit of retention", "maximum retention", "retention limit", "retention shall not exceed"],
  },
  {
    id: "ct-completion",
    label: "Practical completion date",
    feeds: "Penalties, extensions of time, and the programme every valuation is read against",
    required: true,
    terms: ["practical completion", "date for practical completion", "completion date", "construction period", "commencement date"],
  },
  {
    id: "ct-penalty",
    label: "Penalty for late completion",
    feeds: "What a delay costs, per day",
    unit: "R",
    required: false,
    terms: ["penalty", "penalties", "liquidated damages", "per calendar day", "penalty for late completion"],
  },
  {
    id: "ct-cpap",
    label: "CPAP applicability and base date",
    feeds: "Whether prices escalate, and from when",
    required: false,
    terms: ["cpap", "contract price adjustment", "price adjustment", "base date", "escalation"],
  },
  {
    id: "ct-payment-terms",
    label: "Payment terms",
    feeds: "When a certificate becomes due, and the interest if it is not paid",
    required: false,
    terms: ["payment period", "payment terms", "days of the date of the certificate", "interest on overdue"],
  },
  {
    id: "ct-advance",
    label: "Advance payment and recovery",
    feeds: "A deduction on every certificate until it is recovered",
    unit: "R",
    required: false,
    terms: ["advance payment", "mobilisation payment", "advance recovery", "repayment of advance"],
  },
  {
    id: "ct-signed",
    label: "Date signed",
    feeds: "When the obligations started running",
    required: false,
    terms: ["signed at", "date of signature", "signed on", "executed on", "in witness whereof"],
  },
];

/**
 * A payment certificate — D1.5, JBCC's money stack.
 *
 * The contract's terms are **carried**: a certificate computed against a retention rate somebody
 * re-read out of the corpus, rather than the one a person signed, is a wrong deduction that the
 * contractor has already been paid against by the time anybody notices. §6.4 calls an issued
 * certificate the most important invariant in the system; this is the step that feeds it.
 *
 * What is read here is the *period* — what was built this month, what is on site, what was certified
 * before. Those live in the valuation record, not in the contract.
 */
export const VALUATION_FIELDS: readonly FieldSpec[] = [
  {
    id: "vl-contract-sum",
    label: "Contract sum",
    feeds: "The baseline this certificate is a percentage of",
    unit: "R",
    required: true,
    terms: [],
    carriedFrom: { module: "/contract", fieldId: "ct-sum" },
  },
  {
    id: "vl-retention",
    label: "Retention percentage",
    feeds: "The deduction — carried, never re-read, because a certificate is immutable once issued",
    required: true,
    terms: [],
    carriedFrom: { module: "/contract", fieldId: "ct-retention" },
  },
  {
    id: "vl-number",
    label: "Certificate number",
    feeds: "The carry-forward chain — §6.4 #8, sequential and never reissued",
    required: true,
    terms: ["payment certificate", "certificate no", "certificate number", "interim certificate", "valuation number"],
  },
  {
    id: "vl-period",
    label: "Valuation period end",
    feeds: "What the certificate is a snapshot of",
    required: true,
    terms: ["period ending", "valuation date", "as at", "period end", "measured to"],
  },
  {
    id: "vl-work-executed",
    label: "Value of work executed",
    feeds: "The gross figure the whole stack is built on",
    unit: "R",
    required: true,
    terms: ["work executed", "value of work completed", "work done to date", "measured work", "gross valuation"],
  },
  {
    id: "vl-materials",
    label: "Materials on site",
    feeds: "Certified but not yet built in — carried at risk until it is",
    unit: "R",
    required: false,
    terms: ["materials on site", "unfixed materials", "goods on site", "materials off site"],
  },
  {
    id: "vl-variations",
    label: "Approved variations included",
    feeds: "What this certificate pays for beyond the contract bill",
    unit: "R",
    required: false,
    terms: ["approved variations", "variation orders", "variations to date", "authorised variations"],
  },
  {
    id: "vl-previously",
    label: "Previously certified",
    feeds: "Deducted to reach the amount now due (§6.4 #3)",
    unit: "R",
    required: false,
    terms: ["previously certified", "less previous certificates", "amount previously paid", "certified to date"],
  },
  {
    id: "vl-dayworks",
    label: "Dayworks",
    feeds: "Work done on time and materials rather than against a rate",
    unit: "R",
    required: false,
    terms: ["dayworks", "daywork sheets", "time and materials"],
  },
];

/**
 * A variation — D1.6.
 *
 * **The instruction reference and its date are the point.** §4.10 says it plainly: they are the
 * field you argue from in a dispute two years later. A variation with a value and no instruction
 * behind it is a number somebody will eventually have to defend without a document.
 *
 * The contract sum is carried but **not required**, because a variation is a real thing whether or
 * not the contract step has been signed — and the gate is derived from required carries, so this is
 * the field that decides whether a QS can record a variation before the contract has been captured.
 * They can, and the percentage it represents is simply not computed until the contract is signed.
 */
export const VARIATION_FIELDS: readonly FieldSpec[] = [
  {
    id: "vo-number",
    label: "Variation number",
    feeds: "The register, and the certificate that will carry it",
    required: true,
    terms: ["variation order", "variation no", "vo number", "site instruction number", "change order"],
  },
  {
    id: "vo-instruction",
    label: "Instruction reference and date",
    feeds: "What this rests on — the field a dispute turns on two years later",
    required: true,
    terms: ["contract instruction", "site instruction", "instruction no", "architect's instruction", "dated"],
  },
  {
    id: "vo-description",
    label: "Description of the varied work",
    feeds: "What was actually changed",
    required: true,
    terms: ["description of variation", "varied work", "scope of variation", "the works are varied"],
  },
  {
    id: "vo-reason",
    label: "Reason for the variation",
    feeds: "Whether it is recoverable, and from whom",
    required: false,
    terms: ["reason for variation", "cause", "client instruction", "design development", "latent condition", "unforeseen"],
  },
  {
    id: "vo-value",
    label: "Net value",
    feeds: "Contract value, the cost report and the next certificate",
    unit: "R",
    required: true,
    terms: ["net value", "variation value", "add", "omit", "net addition", "net omission", "value of variation"],
  },
  {
    id: "vo-time",
    label: "Extension of time claimed",
    feeds: "The completion date, and any penalty measured against it",
    required: false,
    terms: ["extension of time", "eot", "revised completion date", "delay", "calendar days"],
  },
  {
    id: "vo-status",
    label: "Approval status",
    feeds: "Whether it may enter a certificate at all",
    required: false,
    terms: ["approved", "instruction approved", "pending approval", "rejected", "for approval"],
  },
  {
    id: "vo-contract-sum",
    label: "Contract sum",
    feeds: "What this variation is a percentage of",
    unit: "R",
    required: false,
    terms: [],
    carriedFrom: { module: "/contract", fieldId: "ct-sum" },
  },
];

/**
 * The cost report — D1.7. What the job will finally cost, and how that compares with the budget.
 *
 * Two figures are carried because they are settled elsewhere and must not be re-derived here: the
 * contract sum, and what has been certified. A cost report that quietly disagreed with the
 * certificates it summarises is the class of bug §1.3.1's integrity agent is described to catch —
 * "a figure that changed, vanished or went stale as it crossed from one service to the next".
 */
export const COST_REPORT_FIELDS: readonly FieldSpec[] = [
  {
    id: "cr-contract-sum",
    label: "Contract sum",
    feeds: "The budget every variance is measured against",
    unit: "R",
    required: true,
    terms: [],
    carriedFrom: { module: "/contract", fieldId: "ct-sum" },
  },
  {
    id: "cr-certified",
    label: "Value of work executed",
    feeds: "Expenditure to date, from the certificate rather than from a second reading",
    unit: "R",
    required: false,
    terms: [],
    carriedFrom: { module: "/valuations", fieldId: "vl-work-executed" },
  },
  {
    id: "cr-date",
    label: "Report date",
    feeds: "What this is a statement of — a cost report without one is undated advice",
    required: true,
    terms: ["report date", "as at", "reporting period", "month ending", "cut-off date"],
  },
  {
    id: "cr-forecast",
    label: "Forecast final cost",
    feeds: "The number the client budgets against",
    unit: "R",
    required: true,
    terms: ["forecast final cost", "anticipated final cost", "estimated final cost", "projected final account", "cost to complete"],
  },
  {
    id: "cr-variance",
    label: "Variance against budget",
    feeds: "Whether the job is in trouble, stated rather than left to be worked out",
    unit: "R",
    required: true,
    terms: ["variance", "over budget", "under budget", "saving", "overrun", "against budget"],
  },
  {
    id: "cr-committed",
    label: "Committed cost",
    feeds: "What is already spent or contracted, whether or not it is certified",
    unit: "R",
    required: false,
    terms: ["committed cost", "commitments", "orders placed", "subcontract commitments"],
  },
  {
    id: "cr-variations",
    label: "Approved variations to date",
    feeds: "The gap between contract sum and current contract value",
    unit: "R",
    required: false,
    terms: ["approved variations", "variations to date", "total variations", "contract value adjustment"],
  },
  {
    id: "cr-risks",
    label: "Cost risks and provisions",
    feeds: "What the forecast is exposed to but has not yet absorbed",
    required: false,
    terms: ["cost risk", "provision", "potential claims", "contingency remaining", "risk register", "exposure"],
  },
];

/**
 * The final account — D1.8. The last number, agreed by both parties.
 *
 * It carries the contract sum, because the final account is meaningless except as a movement from
 * it, and reads everything else from the agreed statement. `fa-agreed-by` matters more than it
 * looks: an unsigned final account is a proposal, and the difference between the two is the whole
 * reason §1.3.1 has signatures.
 */
export const FINAL_ACCOUNT_FIELDS: readonly FieldSpec[] = [
  {
    id: "fa-contract-sum",
    label: "Contract sum",
    feeds: "What the final account is a movement from",
    unit: "R",
    required: true,
    terms: [],
    carriedFrom: { module: "/contract", fieldId: "ct-sum" },
  },
  {
    id: "fa-value",
    label: "Final account value",
    feeds: "The agreed total — the last figure the job produces",
    unit: "R",
    required: true,
    terms: ["final account", "final account value", "final contract value", "total final account", "agreed final sum"],
  },
  {
    id: "fa-variations",
    label: "Total approved variations",
    feeds: "The movement from contract sum, itemised",
    unit: "R",
    required: true,
    terms: ["approved variations", "total approved variations", "total variations", "net variations", "variation account"],
  },
  {
    id: "fa-remeasurement",
    label: "Remeasurement adjustment",
    feeds: "Provisional quantities resolved against what was actually built",
    unit: "R",
    required: false,
    terms: ["remeasurement", "re-measurement", "final measurement", "provisional quantities", "adjustment of provisional"],
  },
  {
    id: "fa-retention",
    label: "Retention released",
    feeds: "The last payment, and the end of the defects period",
    unit: "R",
    required: false,
    terms: ["retention released", "release of retention", "final release", "defects liability period expired"],
  },
  {
    id: "fa-penalties",
    label: "Penalties or damages deducted",
    feeds: "What late completion cost, if anything",
    unit: "R",
    required: false,
    terms: ["penalties deducted", "liquidated damages", "damages for delay", "penalty deduction"],
  },
  {
    id: "fa-date",
    label: "Date agreed",
    feeds: "When the account closed",
    required: true,
    terms: ["date agreed", "agreed on", "final account dated", "date of agreement"],
  },
  {
    id: "fa-agreed-by",
    label: "Agreed by",
    feeds: "Who is bound by it — an unsigned final account is a proposal",
    required: false,
    terms: ["agreed by", "signed by", "on behalf of the contractor", "for and on behalf of", "signatories"],
  },
];

/**
 * Tender analysis — D1.3. Which tender to recommend, and what the recommendation rests on.
 *
 * It carries nothing. Its upstream is D1.2, the bill, which is a row-shaped step this platform does
 * not run yet — so every figure here is read from the tender returns themselves, and the comparison
 * a QS would otherwise build in a spreadsheet is the thing being captured.
 *
 * `ta-qualifications` matters more than its position suggests. A tender is often lowest **because**
 * it is qualified, and an adjudication that records the number without the qualification is the
 * document somebody is shown in a dispute.
 */
export const TENDER_FIELDS: readonly FieldSpec[] = [
  {
    id: "ta-tenderers",
    label: "Tenderers",
    feeds: "The field the recommendation was made from",
    required: true,
    terms: ["tenderers", "bidders", "tenders received", "list of tenderers", "submissions received"],
  },
  {
    id: "ta-sums",
    label: "Tender sums",
    feeds: "The comparison itself",
    unit: "R",
    required: true,
    terms: ["tender sum", "tender amount", "bid amount", "tender price", "amount tendered"],
  },
  {
    id: "ta-lowest",
    label: "Lowest tender",
    feeds: "The benchmark every other tender is read against",
    unit: "R",
    required: true,
    terms: ["lowest tender", "lowest bid", "lowest acceptable", "most favourable"],
  },
  {
    id: "ta-recommended",
    label: "Recommended tenderer",
    feeds: "The award, and the contract that follows it",
    required: true,
    terms: ["recommended", "recommendation", "award to", "preferred tenderer", "it is recommended that"],
  },
  {
    id: "ta-adjustments",
    label: "Arithmetic corrections and adjustments",
    feeds: "Why a corrected sum differs from what was submitted",
    unit: "R",
    required: false,
    terms: ["arithmetic", "corrected tender sum", "adjustment", "errors corrected", "as corrected"],
  },
  {
    id: "ta-qualifications",
    label: "Qualifications and exclusions",
    feeds: "What the low price does not include — often the reason it is low",
    required: false,
    terms: ["qualification", "qualified", "excludes", "exclusions", "subject to", "assumptions"],
  },
  {
    id: "ta-validity",
    label: "Tender validity period",
    feeds: "How long the recommendation can still be acted on",
    required: false,
    terms: ["validity", "valid for", "tender validity", "days from the closing date"],
  },
  {
    id: "ta-closing",
    label: "Tender closing date",
    feeds: "The date the comparison is as at",
    required: false,
    terms: ["closing date", "tenders closed", "closed on", "submission deadline"],
  },
];

/** Every field set, by the module that runs it. One place, so a module runs what it declares. */
export const FIELD_SETS_BY_MODULE: Readonly<Record<string, readonly FieldSpec[]>> = {
  "/feasibility": FEASIBILITY_FIELDS,
  "/cost-plan": COST_PLAN_FIELDS,
  "/contract": CONTRACT_FIELDS,
  "/valuations": VALUATION_FIELDS,
  "/variations": VARIATION_FIELDS,
  "/cost-report": COST_REPORT_FIELDS,
  "/final-account": FINAL_ACCOUNT_FIELDS,
  "/tender-analysis": TENDER_FIELDS,
};

/** The live spec behind a stored field, or undefined once the set has moved on without it. */
export const specFor = (fieldId: string, specs: readonly FieldSpec[] = FEASIBILITY_FIELDS) =>
  specs.find((s) => s.id === fieldId);

/**
 * Whether this run can be signed, and what is stopping it.
 *
 * §1.3's integrity rule, at the moment it costs something: a required field with no working value
 * would freeze a gap into the output, and every downstream step would read it as an approved
 * answer. So it is refused — and the refusal names the fields, because the fix is in the reader's
 * hands either way: correct it by hand, or file the document and run again.
 *
 * Optional fields are not checked. §1.3.3's fallback rule is that a missing non-mandatory input is
 * labelled, not fatal.
 *
 * It is computed against the **field set**, not against the rows that happen to exist. A run that
 * stopped on the fourth field has no row for the fifth, and a check that walked the rows would find
 * nothing wrong with it — the required fields it never asked about would be missing from the output
 * with nothing anywhere saying so.
 */
/**
 * Why this step's money does not reconcile, in one sentence – or null when it does (audit C3).
 *
 * Cost plans were signed with their elements R392 800 short of the stated total, and one at
 * R13 313 against R170 743 300 of elements. Sign-off now asks for a written reason in that case;
 * this is the check, shared by the server's gate and the panel's warning so the two cannot differ.
 *
 * Only a step that states a total is checked. An empty element is not "unreadable" – it is simply
 * absent from the sum, which the difference then shows.
 */
export function reconciliationGap(fields: readonly RunField[], specs: readonly FieldSpec[]): string | null {
  const money = specs.filter((spec) => spec.money);
  if (!money.some((spec) => spec.money === "total")) return null;

  const byId = new Map(fields.map((field) => [field.fieldId, field]));
  const result = reconcile(
    money.flatMap((spec) => {
      const field = byId.get(spec.id);
      const value = field ? workingValue(field) : null;
      return value?.trim() ? [{ label: spec.label, value, money: spec.money }] : [];
    }),
  );

  if (result.refused.length > 0) {
    const first = result.refused[0]!;
    return `${first.label} cannot be read as an amount (${first.reason}), so the total cannot be checked.`;
  }
  if (result.stated === null || result.difference === null || result.difference === 0n) return null;

  return `The ${result.counted} elements sum to R ${formatMoney(result.elements)} against a stated total of R ${formatMoney(result.stated)} – R ${formatMoney(result.difference, { accounting: true })} out.`;
}

export function blockingFields(
  fields: readonly RunField[],
  specs: readonly FieldSpec[] = FEASIBILITY_FIELDS,
): { fieldId: string; label: string }[] {
  const byId = new Map(fields.map((f) => [f.fieldId, f]));

  return specs
    .filter((spec) => spec.required)
    .filter((spec) => {
      const field = byId.get(spec.id);
      return !field || !workingValue(field)?.trim();
    })
    .map((spec) => ({ fieldId: spec.id, label: spec.label }));
}

export interface RunEvent {
  type: "field" | "done" | "error";
  result?: FieldResult;
  error?: string;
  /** On `done`: what the run spent. Absent where no rates are configured — see `costOf`. */
  spend?: { input: number; output: number; rand: number | null };
}

/**
 * Open a run and yield its events as they arrive.
 *
 * ── Why it streams ─────────────────────────────────────────────────────────────────────────
 *
 * Ten fields is ten retrievals and up to ten model calls, which is tens of seconds. Waiting for all
 * of it and then painting a table would mean half a minute of a spinner, and — worse — an outage on
 * the ninth field would throw away eight answers a reader could already have been checking. Each
 * field is sent the moment it is settled.
 *
 * NDJSON rather than server-sent events: this is a plain POST that ends, not a subscription, and a
 * line of JSON per event needs no protocol on either side.
 */
export async function* streamRun(projectId: string, module: string): AsyncGenerator<RunEvent> {
  let response: Response;
  try {
    // The step, as a query parameter on the one route. Nine agents are coming and Vercel's Hobby
    // plan allows twelve functions in total — see the route for why they share it.
    response = await fetch(
      `/api/projects/${projectId}/runs?module=${encodeURIComponent(module)}`,
      { method: "POST" },
    );
  } catch {
    yield { type: "error", error: "The run did not reach the server. Check the connection." };
    return;
  }

  if (!response.ok || !response.body) {
    // The server refuses in words — a missing key, a corpus with nothing in it — and those words
    // are the whole point, so they are read out rather than replaced with a status code.
    const said = await response.text().catch(() => "");
    yield {
      type: "error",
      error: said.trim() || `The server refused the run (HTTP ${response.status}).`,
    };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // A chunk can split a line anywhere, including mid-character; the last fragment stays in the
    // buffer until its newline arrives.
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        yield JSON.parse(line) as RunEvent;
      } catch {
        // A half-written line is a bug on the sending side, not something to show a QS. Skipped
        // rather than crashing the run that produced nine good answers.
      }
    }
  }

  if (buffer.trim()) {
    try {
      yield JSON.parse(buffer) as RunEvent;
    } catch {
      /* as above */
    }
  }
}
