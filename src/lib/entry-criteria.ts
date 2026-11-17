/**
 * Entry criteria — PLATFORM.md §1.3.3.
 *
 * What a process area needs before it may begin. A gate, not a suggestion: whether a step is
 * `startable` depends on its upstream being signed (§1.3.1) **and** its inputs being present, and
 * this is the second half.
 *
 * ── These are defaults, not project data ───────────────────────────────────────────────────
 *
 * §1.3 forbids seed data, and that rule is about fabricating a *project's* figures. A default
 * checklist is a **template** — the same kind of thing as the ASAQS standard the rate library
 * follows. A firm edits it. Nothing here invents a project.
 *
 * ── Where these came from ──────────────────────────────────────────────────────────────────
 *
 * The first version was derived from the process model's input columns, which named the *kinds* of
 * input each step needs but not the documents a South African QS is actually handed. It was thin,
 * and visibly so.
 *
 * This version is reconciled against a real feasibility corpus — a KZN residential estate, whose
 * land-use submission carries the annexure set these schemes are assembled from: power of attorney,
 * title deed, layout plan, site development plan, geotechnical report, environmental impact
 * assessment, record of decision, water use licence, traffic impact assessment, electrical services
 * report, bulk water and bulk sewer reports, stormwater management report, conditions of
 * establishment, previous decision notices. Alongside it: a residential market study, bulk
 * infrastructure cost estimates, and the fee proposal.
 *
 * Two requirements were missing outright and are now here — **environmental authorisation** and
 * **traffic impact**. Both are conditions of approval that carry priced work, and a feasibility
 * that omits them understates cost rather than merely lacking a document.
 *
 * It is still a template a firm edits (§1.3), and it is not an ASAQS standard — no published
 * checklist exists. It is what one real scheme required, which is a great deal better than what
 * the process model's column headings implied.
 */

/** Whether a criterion blocks the run or merely flags a gap. */
export type CriterionWeight = "mandatory" | "advisory";

export interface Criterion {
  id: string;
  /** The process area this gates — "D1.1". */
  process: string;
  /**
   * Where this is filed: the project-relative href of the nav item that owns it.
   *
   * Everything used to be listed on the project overview — every criterion for every process, and
   * one upload box for all of them. That page answered "what does this project need?" and nothing
   * else, so a QS who came to work on the feasibility estimate had to read past the zoning and the
   * mandate to find the two rows that concerned them.
   *
   * Allocating each criterion to a module puts the requirement where the work happens. It is stated
   * here rather than derived from `process` because several nav items share a process code — D3.1
   * covers data import, documents and site — and a guess would silently file things in the wrong
   * place. `npm run check:modules` asserts every href here exists in PROJECT_NAV.
   */
  module: string;
  /** What is needed, in the QS's words. Never a document filename. */
  label: string;
  /** Why it is needed, and what it feeds. Shown when someone asks why they are blocked. */
  detail: string;
  weight: CriterionWeight;
  /**
   * Document kinds that would satisfy this.
   *
   * A criterion is a required **input**, not a required document — "site and market data" may
   * arrive as a geotechnical report, a fee schedule or a market study. This is what tells the
   * agent what to look for in the corpus (§1.3.2).
   */
  acceptedEvidence: readonly string[];
  /**
   * The words the documents themselves use, when the kind names are not those words.
   *
   * ── Why this had to be separated ───────────────────────────────────────────────────────
   *
   * `acceptedEvidence` was doing two jobs: naming the kinds a document may be filed under, *and*
   * being the phrases the corpus is searched for. They are usually close enough — a market study
   * says "market study" — and for a whole class of document they are not close at all. A JBCC
   * contract never contains the words "signed contract"; it says *principal building agreement*,
   * *the contractor is*, *contract sum*. So a contract filed under exactly the right kind was
   * grounded by nothing, sat at `uncertain`, and blocked its own step for ever.
   *
   * It is the same failure the handoff already recorded against a workbook — "a workbook that files
   * is not a workbook that is found" — and adding five modules at once turned a known limitation
   * into five broken steps.
   *
   * Both lists are searched, biased toward recall for the reason `FieldSpec.terms` gives: an extra
   * passage costs a little retrieval and is discarded, while a missed one is indistinguishable on
   * screen from the document not being there.
   */
  terms?: readonly string[];
  /**
   * Whether a human may satisfy this without a document.
   *
   * From v3's `can_declare_without_documents`. Sometimes the QS knows the zoning is right and the
   * certificate is in the post. They may say so — with a name and a reason — and it shows as
   * **declared**, never as satisfied. An unsigned upstream is never declarable: that would let a
   * step read figures nobody approved.
   */
  declarable: boolean;
  /**
   * What the platform does when this is absent but not mandatory.
   *
   * §1.3's integrity rule, declared up front rather than decided silently at report time.
   */
  fallback?: string;
}

/**
 * How a criterion stands for one project.
 *
 * `satisfied` and `declared` are deliberately separate: one is evidence, the other is somebody's
 * word, and collapsing them would lose the distinction that matters at review.
 */
export type CriterionStatus = "satisfied" | "declared" | "uncertain" | "missing";

export const STATUS_LABEL: Record<CriterionStatus, string> = {
  satisfied: "Satisfied",
  declared: "Declared",
  uncertain: "Needs review",
  missing: "Missing",
};

/**
 * The default checklists.
 *
 * D1.1 is the first QS process and the one specified in depth, so it carries a criterion per input
 * named in its eight steps. D2.1 and D3.1 precede it in Phase 1 and carry theirs.
 */
export const DEFAULT_CRITERIA: readonly Criterion[] = [
  // ── D2.1 — Project Initiation ────────────────────────────────────────────────────────────
  {
    id: "d2.1-mandate",
    process: "D2.1",
    module: "/inputs",
    label: "Client mandate or appointment",
    detail: "The instruction to act. Without it there is no project to open and no fee basis.",
    weight: "mandatory",
    acceptedEvidence: [
      "Appointment letter",
      "Signed mandate",
      "Service level agreement",
      "Fee proposal",
      "Power of attorney",
    ],
    declarable: false,
  },
  {
    id: "d2.1-brief",
    process: "D2.1",
    module: "/inputs",
    label: "Developer brief",
    detail: "Scheme intent, unit counts and target market. Everything downstream is scoped by it.",
    weight: "mandatory",
    acceptedEvidence: [
      "Project brief",
      "Developer requirements",
      "Term sheet",
      "Project presentation",
      "Meeting minutes",
    ],
    declarable: false,
  },
  {
    id: "d2.1-stakeholders",
    process: "D2.1",
    module: "/inputs",
    label: "Stakeholder register",
    detail: "Who the professional team is, and who signs what.",
    weight: "advisory",
    acceptedEvidence: ["Appointment schedule", "Professional team list"],
    declarable: true,
    fallback: "Captured during the run; approvals route to the QS until the team is confirmed.",
  },

  // ── D3.1 — Briefing & Site Analysis ──────────────────────────────────────────────────────
  {
    id: "d3.1-site",
    process: "D3.1",
    module: "/site",
    label: "Site location and extent",
    detail: "Erf number, extent and locality. Bulk services and development charges key off it.",
    weight: "mandatory",
    acceptedEvidence: [
      "Title deed",
      "SG diagram",
      "Locality plan",
      "Land surveyor's drawing",
      "Site location plan",
    ],
    declarable: true,
  },
  {
    id: "d3.1-zoning",
    process: "D3.1",
    module: "/site",
    label: "Zoning and land-use rights",
    detail:
      "Permitted use, coverage, FAR and height. Determines whether the scheme is buildable as briefed.",
    weight: "mandatory",
    acceptedEvidence: [
      "Zoning certificate",
      "SPLUMA approval",
      "Town planning report",
      "Conditions of establishment",
      "Land use layout plan",
      "Previous decision notices",
    ],
    declarable: true,
  },
  {
    id: "d3.1-geotech",
    process: "D3.1",
    module: "/site",
    label: "Geotechnical information",
    detail: "Founding conditions. Drives substructure rates, which are where feasibility estimates go wrong.",
    weight: "advisory",
    acceptedEvidence: ["Geotechnical report", "Trial pit logs", "Dolomite risk assessment"],
    declarable: false,
    fallback: "Normal founding assumed and labelled as an assumption in the report.",
  },

  {
    id: "d3.1-survey",
    process: "D3.1",
    module: "/site",
    label: "Survey and topography",
    detail:
      "Levels, contours and the developable area. Cut and fill, platform costs and retaining are measured off these, not read out of a sentence.",
    weight: "advisory",
    acceptedEvidence: [
      "Topographical map",
      "Contour survey",
      "Locality map",
      "Layout plan",
      "Site location plan",
      "Land surveyor's drawing",
    ],
    declarable: false,
    fallback: "Level site assumed, and the report says so — the single biggest earthworks risk.",
  },
  {
    id: "d3.1-environmental",
    process: "D3.1",
    module: "/site",
    label: "Environmental authorisation",
    detail:
      "A scheme cannot break ground without it, and the conditions attached to it routinely add cost — attenuation, buffers, rehabilitation.",
    weight: "mandatory",
    acceptedEvidence: [
      "Environmental impact assessment",
      "Record of decision",
      "Water use licence",
      "Water use certificate",
    ],
    declarable: true,
  },
  {
    id: "d3.1-traffic",
    process: "D3.1",
    module: "/site",
    label: "Traffic impact assessment",
    detail:
      "Access, intersection upgrades and road contributions are conditions of approval, and they are priced work.",
    weight: "advisory",
    acceptedEvidence: ["Traffic impact assessment", "Access approval"],
    declarable: true,
    fallback: "No road contribution allowed for; flagged as an exclusion in the report.",
  },

  // ── D1.1 — Feasibility Cost Estimate (the first QS process) ──────────────────────────────
  {
    id: "d1.1-brief",
    process: "D1.1",
    module: "/feasibility",
    label: "Project brief and concept parameters",
    detail: "Step 1's input — developer brief, site location, unit counts. Scopes the estimate.",
    weight: "mandatory",
    acceptedEvidence: [
      "Project brief",
      "Concept parameters",
      "Accommodation schedule",
      "Site development plan",
    ],
    declarable: false,
  },
  {
    id: "d1.1-market",
    process: "D1.1",
    module: "/feasibility",
    label: "Market data",
    detail:
      "Step 2 — absorption, achievable pricing and comparable schemes. Sets the affordability envelope the whole verdict rests on.",
    weight: "mandatory",
    acceptedEvidence: [
      "Market study",
      "Comparable sales",
      "Absorption analysis",
      "Residential demand study",
    ],
    declarable: false,
  },
  {
    id: "d1.1-municipal-fees",
    process: "D1.1",
    module: "/feasibility",
    label: "Municipal fee schedule",
    detail: "Step 2 — development charges and connection fees for the relevant municipality.",
    weight: "advisory",
    acceptedEvidence: ["Municipal tariff schedule", "Development charge policy"],
    declarable: true,
    fallback: "Published tariffs pulled fresh and dated (§1.3), never carried from another project.",
  },
  {
    id: "d1.1-layouts",
    process: "D1.1",
    module: "/feasibility",
    label: "Concept layouts",
    detail: "Step 3 — unit typology and specification level. Without them the mix is assumed.",
    weight: "mandatory",
    acceptedEvidence: ["Concept drawings", "Unit plans", "Typology schedule", "Site development plan"],
    declarable: false,
  },
  {
    id: "d1.1-services",
    process: "D1.1",
    module: "/feasibility",
    label: "Services layout and bulk contributions",
    detail:
      "Step 5 — bulk and internal engineering. On greenfield affordable housing this is frequently the difference between viable and not.",
    weight: "advisory",
    acceptedEvidence: [
      "Bulk infrastructure cost estimate",
      "Bulk water report",
      "Bulk sewer report",
      "Stormwater management report",
      "Electrical services report",
      "Roads and civil services report",
      "Bulk services agreement",
    ],
    declarable: false,
    fallback: "Benchmark allowance applied per unit and flagged as an allowance, not a measurement.",
  },
  {
    id: "d1.1-cost-plan",
    process: "D1.1",
    module: "/feasibility",
    label: "QS cost plan",
    detail:
      "Anchors the cost to measured work rather than a benchmark. Its absence does not stop the run — it changes what the run may conclude.",
    weight: "advisory",
    acceptedEvidence: ["QS cost plan", "Elemental estimate", "Priced bill"],
    declarable: false,
    fallback:
      "Cost is a benchmark placeholder and the verdict is WITHHELD, labelled indicative — never presented as a real profit or loss.",
  },
  {
    id: "d1.1-subsidy",
    process: "D1.1",
    module: "/feasibility",
    label: "Subsidy quantum and funder criteria",
    detail: "Step 7 — the constraints the scheme is tested against.",
    weight: "advisory",
    acceptedEvidence: ["Funder term sheet", "DHS subsidy schedule", "FLISP parameters"],
    declarable: true,
    fallback: "Current published subsidy rates pulled fresh and dated.",
  },
  {
    id: "d1.1-programme",
    process: "D1.1",
    module: "/feasibility",
    label: "Project programme",
    detail: "Step 6 — escalation and professional fees are both computed against duration.",
    weight: "advisory",
    acceptedEvidence: ["Draft programme", "Phasing plan"],
    declarable: true,
    fallback: "Standard duration assumed for the scheme size and labelled as an assumption.",
  },

  // ── D1.1 — Elemental Cost Plan ───────────────────────────────────────────────────────────
  //
  // The same process area as the feasibility estimate — D1.1's sub-processes are "Feasibility Cost
  // Estimate", "Elemental Cost Plan", "Cost Plan Revision", in that order — and a separate step
  // within it. What separates them is not the documents: it is that this one **reads the signed
  // output of the one before it** (§1.3.1), which is why its checklist is short. The scheme's shape
  // is not asked for a second time, it is carried.
  {
    id: "d1.1cp-estimate",
    process: "D1.1",
    module: "/cost-plan",
    label: "Priced cost plan or elemental estimate",
    detail:
      "The document the elements are read out of. Without it there is nothing to price against, and a plan built from benchmarks would read exactly like one built from measured work.",
    weight: "mandatory",
    /**
     * Deliberately narrow. The first draft included the bare phrase "cost plan" and the element
     * names, and a concept-layouts document saying "the standard assumed in **the cost plan**"
     * satisfied the criterion — so the step reported that it had the priced estimate it had never
     * been given. Recall is the right bias for a *field*, whose worst case is an extra passage the
     * model discards; it is the wrong bias for a *gate*, whose worst case is a step that starts on
     * a document nobody filed.
     */
    terms: ["elemental estimate", "elemental cost plan", "priced bill totals", "asaqs class"],
    acceptedEvidence: ["QS cost plan", "Elemental estimate", "Priced bill", "Bill of quantities"],
    declarable: false,
  },
  {
    id: "d1.1cp-specification",
    process: "D1.1",
    module: "/cost-plan",
    label: "Specification or finishes schedule",
    detail:
      "What the rates are buying. Two plans with the same total and different specifications are not comparable, and nothing on the face of either says so.",
    weight: "advisory",
    acceptedEvidence: ["Specification", "Finishes schedule", "Typology schedule", "Unit plans"],
    declarable: true,
    fallback:
      "Specification level is taken from the cost plan's own wording where it states one, and labelled as read rather than confirmed.",
  },
  {
    id: "d1.1cp-services",
    process: "D1.1",
    module: "/cost-plan",
    label: "Engineering services estimate",
    detail:
      "Civil, electrical and wet services. On greenfield affordable housing these frequently exceed the superstructure, and an elemental plan that omits them reads as complete while being short by a third.",
    weight: "advisory",
    acceptedEvidence: [
      "Engineering services report",
      "Bulk services agreement",
      "Civil services estimate",
      "Municipal tariff schedule",
    ],
    declarable: true,
    fallback:
      "Services are reported as not established rather than as nil — an absent element and an element costing nothing are different facts.",
  },

  // ── D1.2 — BoQ Production ────────────────────────────────────────────────────────────────
  //
  // The first **row-shaped** step (§1.3.3): its run proposes bill items rather than a fixed set of
  // named figures, so what it needs from the corpus is different in kind. A field set asks the
  // documents a list of questions; a bill asks them what work there is.
  {
    id: "d1.2-scope",
    process: "D1.2",
    module: "/bill",
    label: "Specification or measured scope",
    detail:
      "What is to be built, in words a bill item can be written from. Without it there is nothing to describe and nothing to measure — a bill drafted from a total is a total with rows drawn under it.",
    weight: "mandatory",
    /**
     * The words a specification uses about work, not the word "bill". A document that mentions a
     * bill of quantities is not a description of work, and grounding on that phrase would let a
     * cover letter open this step.
     */
    terms: [
      "specification",
      "supply and lay",
      "supply and install",
      "measured in accordance",
      "workmanship",
      "class of concrete",
      "finishes are to",
    ],
    acceptedEvidence: [
      "Specification",
      "Finishes schedule",
      "Typology schedule",
      "Working drawings",
      "Unit plans",
      "Concept drawings",
    ],
    declarable: false,
  },
  {
    id: "d1.2-rates",
    process: "D1.2",
    module: "/bill",
    label: "Priced source for rates",
    detail:
      "Where the rates come from — a cost plan, a priced bill, a rate schedule. A bill can be measured without one; it cannot be priced without one, and an unpriced bill cannot be signed.",
    weight: "advisory",
    terms: [
      "rate of",
      "per cubic metre",
      "per square metre",
      "elemental estimate",
      "priced bill totals",
      "rate schedule",
    ],
    acceptedEvidence: [
      "QS cost plan",
      "Elemental estimate",
      "Priced bill",
      "Bill of quantities",
      "Rate schedule",
    ],
    declarable: true,
    fallback:
      "Rates are reported as not established rather than as nought, and the sign-off gate names every item still without one.",
  },

  // ── D1.4 — Contract & Financial Administration ───────────────────────────────────────────
  {
    id: "d1.4-contract",
    process: "D1.4",
    module: "/contract",
    label: "Signed contract",
    detail:
      "The agreement itself, with its schedule of particulars. Everything certified for the rest of the job is measured against what this document says.",
    weight: "mandatory",
    terms: ["principal building agreement", "the contractor is", "contract sum", "the employer is", "conditions of contract", "form of contract"],
    acceptedEvidence: ["Signed contract", "Contract agreement", "JBCC contract data", "Letter of acceptance"],
    declarable: false,
  },
  {
    id: "d1.4-tender",
    process: "D1.4",
    module: "/contract",
    label: "Accepted tender",
    detail:
      "What the contractor actually priced. The contract sum should equal it; where it does not, somebody negotiated and that is worth being able to see.",
    weight: "advisory",
    terms: ["accepted tender", "tender sum", "priced bill", "tender amount"],
    acceptedEvidence: ["Accepted tender", "Tender return", "Priced bill", "Bill of quantities"],
    declarable: true,
    fallback: "The contract sum is taken from the agreement alone, with nothing to reconcile it against.",
  },

  // ── D1.5 — Monthly Valuations & Payment ──────────────────────────────────────────────────
  {
    id: "d1.5-valuation",
    process: "D1.5",
    module: "/valuations",
    label: "Site valuation or measurement record",
    detail:
      "What was actually built this period. Without it a certificate would be a percentage somebody guessed, and a contractor gets paid against it.",
    weight: "mandatory",
    terms: ["work executed", "value of work", "progress claim", "period ending", "measured to", "materials on site"],
    acceptedEvidence: ["Site valuation", "Measurement record", "Progress claim", "Contractor's application"],
    declarable: false,
  },
  {
    id: "d1.5-previous",
    process: "D1.5",
    module: "/valuations",
    label: "Previous certificate",
    detail:
      "The carry-forward — §6.4 #3 makes this certificate's 'previously certified' the last one's value to date. On a first certificate there is none, and that is the correct answer rather than a gap.",
    weight: "advisory",
    terms: ["previously certified", "payment certificate", "interim certificate", "previous certificate"],
    acceptedEvidence: ["Payment certificate", "Interim certificate", "Certificate schedule"],
    declarable: true,
    fallback: "Treated as a first certificate: previously certified is nil, and the report says so rather than leaving it blank.",
  },

  // ── D1.6 — Variation Assessment & Management ─────────────────────────────────────────────
  {
    id: "d1.6-instruction",
    process: "D1.6",
    module: "/variations",
    label: "Contract instruction",
    detail:
      "What the variation rests on. §4.10 — the instruction reference and its date are the field you argue from in a dispute two years later, and a variation without one is a number nobody can defend.",
    weight: "mandatory",
    terms: ["contract instruction", "site instruction", "instructed to", "variation order", "the works are varied"],
    acceptedEvidence: ["Contract instruction", "Site instruction", "Architect's instruction", "Variation order"],
    declarable: false,
  },
  {
    id: "d1.6-quotation",
    process: "D1.6",
    module: "/variations",
    label: "Quotation or measured build-up",
    detail: "How the value was arrived at, rather than merely what it is.",
    weight: "advisory",
    terms: ["quotation", "star rate", "measured build-up", "daywork", "rate build up"],
    acceptedEvidence: ["Contractor's quotation", "Measured build-up", "Star rate build-up", "Daywork sheet"],
    declarable: true,
    fallback: "The value is reported as instructed rather than as measured, and labelled so.",
  },
  {
    id: "d1.6-drawings",
    process: "D1.6",
    module: "/variations",
    label: "Revised drawings",
    detail: "What changed, drawn. Measured by take-off rather than read.",
    weight: "advisory",
    acceptedEvidence: ["Revised drawings", "Concept drawings", "Unit plans"],
    declarable: true,
    fallback: "The description is taken from the instruction's own words.",
  },

  // ── D1.7 — Budget Tracking & Cost Control ────────────────────────────────────────────────
  {
    id: "d1.7-report",
    process: "D1.7",
    module: "/cost-report",
    label: "Cost report or financial statement",
    detail:
      "The period's own statement of where the money is. A forecast final cost with nothing behind it is an opinion.",
    weight: "mandatory",
    terms: ["forecast final cost", "anticipated final cost", "cost report", "variance", "expenditure to date"],
    acceptedEvidence: ["Cost report", "Financial statement", "Cost summary", "Anticipated final cost report"],
    declarable: false,
  },
  {
    id: "d1.7-commitments",
    process: "D1.7",
    module: "/cost-report",
    label: "Commitments and orders",
    detail: "What is already spent or contracted but not yet certified — the gap a forecast has to cover.",
    weight: "advisory",
    terms: ["orders placed", "committed cost", "subcontract", "commitments", "procurement schedule"],
    acceptedEvidence: ["Order schedule", "Subcontract schedule", "Commitment register", "Procurement schedule"],
    declarable: true,
    fallback: "Committed cost is reported as not established, never as nil — nothing ordered and nothing recorded are different facts.",
  },

  // ── D1.8 — Final Account & Close-out ─────────────────────────────────────────────────────
  {
    id: "d1.8-account",
    process: "D1.8",
    module: "/final-account",
    label: "Final account statement",
    detail: "The agreed total and how it was reached. The last figure the job produces.",
    weight: "mandatory",
    terms: ["final account", "final measurement", "agreed final", "remeasurement", "release of retention"],
    acceptedEvidence: ["Final account", "Final account statement", "Final measurement", "Statement of final account"],
    declarable: false,
  },
  {
    id: "d1.8-agreement",
    process: "D1.8",
    module: "/final-account",
    label: "Agreement or signature page",
    detail:
      "Who is bound by it. An unsigned final account is a proposal, and the difference between the two is the whole reason a signature exists.",
    weight: "advisory",
    terms: ["agreed by", "signed by", "on behalf of the contractor", "practical completion", "certificate of completion"],
    acceptedEvidence: ["Signed agreement", "Final account", "Certificate of completion", "Practical completion certificate"],
    declarable: true,
    fallback: "The account is reported as stated rather than as agreed, and labelled so.",
  },

  // ── D1.3 — Tender Documentation & Evaluation ─────────────────────────────────────────────
  {
    id: "d1.3-returns",
    process: "D1.3",
    module: "/tender-analysis",
    label: "Tender returns",
    detail:
      "What the tenderers actually submitted. An adjudication assembled from a summary somebody typed is an adjudication nobody can check.",
    weight: "mandatory",
    terms: ["tender sum", "tenderers", "tender amount", "bid amount", "tenders received"],
    acceptedEvidence: ["Tender return", "Tender submission", "Priced bill", "Bill of quantities"],
    declarable: false,
  },
  {
    id: "d1.3-report",
    process: "D1.3",
    module: "/tender-analysis",
    label: "Adjudication or recommendation report",
    detail: "The comparison and the reasoning, including what each price is qualified by.",
    weight: "advisory",
    terms: ["recommended", "adjudication", "arithmetic", "qualification", "lowest tender"],
    acceptedEvidence: ["Adjudication report", "Tender report", "Award recommendation", "Comparative schedule"],
    declarable: true,
    fallback: "The comparison is read from the returns alone, with no record of what was weighed beyond price.",
  },

];

export const criteriaFor = (process: string) =>
  DEFAULT_CRITERIA.filter((c) => c.process === process);

/** What one module asks for — the list its page renders and files against. */
export const criteriaForModule = (module: string) =>
  DEFAULT_CRITERIA.filter((c) => c.module === module);

/** Project-relative hrefs that own at least one criterion, in the order they are declared. */
export const modulesWithCriteria = (): readonly string[] => [
  ...new Set(DEFAULT_CRITERIA.map((c) => c.module)),
];

/** Process areas that currently carry a default checklist, in process order. */
export const processesWithCriteria = (): readonly string[] => [
  ...new Set(DEFAULT_CRITERIA.map((c) => c.process)),
];
