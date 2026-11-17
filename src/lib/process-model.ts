/**
 * The process model — PLATFORM.md §1.4.
 *
 * The BPMN hierarchy this platform implements, as data:
 * **L0** (7-phase construction value chain) → **L1** (8 professional domains, D1–D8) →
 * **L2** (process areas) → **L3** (sub-processes).
 *
 * ── Why this is a catalogue and not a nav array ────────────────────────────────────────────
 *
 * §1.3.1 makes every module a **service in a chain**: an agent proposes into it, a human confirms,
 * a signature freezes it, and the next step reads only what was signed. That chain is what
 * `feedsFrom` and `feedsInto` record here — the menu is a *rendering* of the process, not a list
 * of links someone chose an order for.
 *
 * `reads` names the documents a step needs from the project corpus (§1.3.2). It is what lets the
 * platform answer "why can I not start this yet?" with something better than a disabled button.
 *
 * ── Where this belongs in the UI ───────────────────────────────────────────────────────────
 *
 * **On the project overview, not in the nav.** v3 built this as a sidebar tree and removed it on
 * client feedback: eight domains and 52 areas made the nav the tallest thing in the shell, so a
 * reader working on one step scrolled past the firm's whole process library to reach Settings.
 * The question it answers — "what else is there, and what can this platform do?" — is asked about
 * a project, once, while looking at that project. A page question, not a chrome question.
 *
 * When it is rendered, it is **collapsed by default** (52 areas expanded is a wall) and every
 * documented area is listed — the built ones as links, the rest inert and labelled. Hiding the
 * unbuilt ones would imply the platform does not cover the domain, which is the more misleading
 * thing to say.
 *
 * **The server will own `startable`.** This file is the static shape of the model — which steps
 * exist, what they consume and produce. Whether a *particular project's* step can start depends on
 * which upstream runs are signed and which documents are actually filed, and only the server knows
 * both (§1.3.1). Nothing here should ever be used to decide that.
 */

/** L0 — the seven-phase construction value chain. */
export interface Phase {
  number: number;
  name: string;
  summary: string;
}

export const PHASES: readonly Phase[] = [
  { number: 1, name: "Feasibility & Inception", summary: "Site analysis, feasibility studies, funding model" },
  { number: 2, name: "Design & Documentation", summary: "Concept to detailed design, BoQ production, regulatory approval" },
  { number: 3, name: "Procurement & Tender", summary: "Tender documents, contractor evaluation, contract award" },
  { number: 4, name: "Construction & Delivery", summary: "Site execution, valuations, variations, quality" },
  { number: 5, name: "Handover & Commissioning", summary: "Practical completion, snag lists, testing, O&M" },
  { number: 6, name: "Close-out & Final Account", summary: "Final measurement, final account, retention release" },
  { number: 7, name: "Asset & Warranty", summary: "Defects liability, warranty management, asset registration" },
];

/** L1 — the eight professional domains. */
export const DOMAINS: Readonly<Record<string, string>> = {
  D1: "QS & Cost Management",
  D2: "Project Management",
  D3: "Architecture & Design",
  D4: "Engineering",
  D5: "Construction Management",
  D6: "Contract Administration",
  D7: "Compliance & Regulatory",
  D8: "Procurement & Supply Chain",
};

/**
 * L2 — a process area, which is what the menu shows and what a run executes against.
 *
 * `kind` follows §1.3.1: a **step** runs the contract and freezes at sign-off; a **register** is
 * firm-wide and recomputed on every read, because freezing a lapsed clearance would let it keep
 * passing.
 */
export interface ProcessArea {
  code: string;
  name: string;
  domain: keyof typeof DOMAINS | string;
  phase: number;
  kind: "step" | "register";
  /** L3 — the sub-processes inside this area. */
  subProcesses: readonly string[];
  /** Documents this step needs from the corpus (§1.3.2). */
  reads: readonly string[];
  /** Process areas whose signed output this one consumes. */
  feedsFrom: readonly string[];
  /** Process areas that consume this one's signed output. */
  feedsInto: readonly string[];
  /** False everywhere today. Nothing is built. */
  built: boolean;
}

/**
 * The chain, in process order.
 *
 * Ordered by L0 phase, then by the sequence within it — so the menu reads the way the work
 * happens, not the way an alphabetical module list would.
 */
export const PROCESS_AREAS: readonly ProcessArea[] = [
  // ── Phase 1 — Feasibility & Inception ────────────────────────────────────────────────────
  {
    code: "D2.1",
    name: "Project Initiation & Charter",
    domain: "D2",
    phase: 1,
    kind: "step",
    subProcesses: ["Project Charter Development", "Project Execution Strategy"],
    reads: ["Project brief", "Stakeholder requirements", "Mandate / instruction"],
    feedsFrom: [],
    feedsInto: ["D3.1", "D1.1"],
    built: false,
  },
  {
    code: "D3.1",
    name: "Briefing & Site Analysis",
    domain: "D3",
    phase: 1,
    kind: "step",
    subProcesses: ["Client Brief Capture", "Site Analysis & Zoning"],
    reads: ["Client brief", "Site survey", "Zoning certificate", "Title deed"],
    feedsFrom: ["D2.1"],
    feedsInto: ["D1.1", "D7.1", "D3.2"],
    built: false,
  },
  {
    code: "D1.1",
    name: "Cost Planning & Estimation",
    domain: "D1",
    phase: 1,
    kind: "step",
    subProcesses: ["Feasibility Cost Estimate", "Elemental Cost Plan", "Cost Plan Revision"],
    reads: ["Project brief", "Site information", "Market study", "QS cost plan", "Services reports"],
    feedsFrom: ["D2.1", "D3.1"],
    feedsInto: ["D1.2", "D1.9"],
    built: false,
  },
  {
    code: "D7.1",
    name: "Building Plan Approval",
    domain: "D7",
    phase: 1,
    kind: "step",
    subProcesses: ["Building Plan Submission", "Zoning & Land-Use Rights"],
    reads: ["Zoning certificate", "SG diagram", "Municipal correspondence"],
    feedsFrom: ["D3.1"],
    feedsInto: ["D3.5", "D7.6"],
    built: false,
  },

  // ── Phase 2 — Design & Documentation ─────────────────────────────────────────────────────
  {
    code: "D3.2",
    name: "Concept & Scheme Design",
    domain: "D3",
    phase: 2,
    kind: "step",
    subProcesses: ["Concept Design", "Scheme Design"],
    reads: ["Client brief", "Site potential report"],
    feedsFrom: ["D3.1"],
    feedsInto: ["D3.3", "D1.1"],
    built: false,
  },
  {
    code: "D3.3",
    name: "Design Development",
    domain: "D3",
    phase: 2,
    kind: "step",
    subProcesses: ["Design Development", "Coordination"],
    reads: ["Scheme drawings", "Engineering reports"],
    feedsFrom: ["D3.2"],
    feedsInto: ["D3.4"],
    built: false,
  },
  {
    code: "D3.4",
    name: "Construction Documentation",
    domain: "D3",
    phase: 2,
    kind: "step",
    subProcesses: ["Working Drawings", "Specifications"],
    reads: ["Developed design", "Specifications"],
    feedsFrom: ["D3.3"],
    feedsInto: ["D1.2"],
    built: false,
  },
  {
    code: "D1.2",
    name: "BoQ Production",
    domain: "D1",
    phase: 2,
    kind: "step",
    // The BPMN's own three: SP 1.2.1 Measurement & Take-off, SP 1.2.2 BoQ Compilation,
    // SP 1.2.3 Preambles & Preliminaries. This listed "Pricing" as the third, which the L2 model
    // puts *out* of scope for the area — "Tenderer pricing (external)" — and dropped preambles,
    // the part that makes a bill a contract document.
    subProcesses: ["Measurement & Take-off", "BoQ Compilation", "Preambles & Preliminaries"],
    reads: ["Working drawings", "Specifications", "Cost plan"],
    feedsFrom: ["D1.1", "D3.4"],
    feedsInto: ["D1.3"],
    built: false,
  },
  {
    code: "D7.2",
    name: "NHBRC Enrolment",
    domain: "D7",
    phase: 2,
    kind: "register",
    subProcesses: ["Enrolment Application", "Inspection Schedule"],
    reads: ["Approved plans", "Enrolment certificate"],
    feedsFrom: ["D7.1"],
    feedsInto: [],
    built: false,
  },

  // ── Phase 3 — Procurement & Tender ───────────────────────────────────────────────────────
  {
    code: "D1.3",
    name: "Tender Documentation & Evaluation",
    domain: "D1",
    phase: 3,
    kind: "step",
    subProcesses: ["Tender Documentation", "Tender Evaluation", "Award Recommendation"],
    reads: ["Bill of Quantities", "Tender returns", "Contractor submissions"],
    feedsFrom: ["D1.2"],
    feedsInto: ["D1.4", "D8.1"],
    built: false,
  },
  {
    code: "D8.1",
    name: "Contractor Procurement",
    domain: "D8",
    phase: 3,
    kind: "step",
    subProcesses: ["Prequalification", "Adjudication", "Appointment"],
    reads: ["Tender returns", "Compliance certificates"],
    feedsFrom: ["D1.3"],
    feedsInto: ["D1.4"],
    built: false,
  },

  // ── Phase 4 — Construction & Delivery ────────────────────────────────────────────────────
  {
    code: "D1.4",
    name: "Contract & Financial Administration",
    domain: "D1",
    phase: 4,
    kind: "step",
    subProcesses: ["Contract Setup", "Baseline Lock", "Financial Controls"],
    reads: ["Signed contract", "Accepted tender"],
    feedsFrom: ["D1.3", "D8.1"],
    feedsInto: ["D1.5", "D1.6", "D1.7"],
    built: false,
  },
  {
    code: "D2.5",
    name: "Construction Programme & Progress Monitoring",
    domain: "D2",
    phase: 4,
    kind: "step",
    subProcesses: ["Site Handover & Programme Approval", "Progress Monitoring & Reporting"],
    reads: ["Contractor's programme", "Contract", "Site progress"],
    feedsFrom: ["D1.4"],
    feedsInto: ["D1.7", "D6.1", "D2.7"],
    built: false,
  },
  {
    code: "D1.5",
    name: "Monthly Valuations & Payment",
    domain: "D1",
    phase: 4,
    kind: "step",
    subProcesses: ["Site Valuation", "Payment Certificate", "Certificate Issue"],
    reads: ["Contract bill", "Site records", "Approved variations"],
    feedsFrom: ["D1.4", "D1.6"],
    feedsInto: ["D1.7", "D1.8", "D1.9"],
    built: false,
  },
  {
    code: "D1.6",
    name: "Variation Assessment & Management",
    domain: "D1",
    phase: 4,
    kind: "step",
    subProcesses: ["Variation Capture", "Valuation", "Approval Workflow"],
    reads: ["Contract instructions", "Revised drawings", "Contract bill"],
    feedsFrom: ["D1.4"],
    feedsInto: ["D1.5", "D1.7", "D1.8"],
    built: false,
  },
  {
    code: "D1.7",
    name: "Budget Tracking & Cost Control",
    domain: "D1",
    phase: 4,
    kind: "step",
    subProcesses: ["Cost Report", "Forecast Final Cost", "Variance Analysis"],
    reads: ["Certificates", "Approved variations", "Cost plan"],
    feedsFrom: ["D1.4", "D1.5", "D1.6"],
    feedsInto: ["D1.9"],
    built: false,
  },
  {
    code: "D6.1",
    name: "Contract Administration",
    domain: "D6",
    phase: 4,
    kind: "step",
    subProcesses: ["Instructions", "Notices", "Extension of Time"],
    reads: ["Contract", "Correspondence"],
    feedsFrom: ["D1.4"],
    feedsInto: ["D1.6"],
    built: false,
  },

  // ── Phase 5 — Handover & Commissioning ───────────────────────────────────────────────────
  {
    code: "D2.7",
    name: "Close-out & Handover",
    domain: "D2",
    phase: 5,
    kind: "step",
    subProcesses: ["Practical Completion", "Snag List", "O&M Handover"],
    reads: ["Completion certificates", "Snag lists", "O&M manuals"],
    feedsFrom: ["D1.5"],
    feedsInto: ["D1.8"],
    built: false,
  },

  // ── Phase 6 — Close-out & Final Account ──────────────────────────────────────────────────
  {
    code: "D1.8",
    name: "Final Account & Close-out",
    domain: "D1",
    phase: 6,
    kind: "step",
    subProcesses: ["Final Measurement", "Final Account Agreement", "Retention Release"],
    reads: ["Contract bill", "All variations", "All certificates"],
    feedsFrom: ["D1.5", "D1.6", "D2.7"],
    feedsInto: ["D1.9"],
    built: false,
  },

  // ── Cross-phase ──────────────────────────────────────────────────────────────────────────
  {
    code: "D1.9",
    name: "Funder Reporting & Drawdowns",
    domain: "D1",
    phase: 4,
    kind: "step",
    subProcesses: ["Drawdown Application", "Funder Report"],
    reads: ["Certificates", "Cost reports", "Funding agreement"],
    feedsFrom: ["D1.1", "D1.5", "D1.7", "D1.8"],
    feedsInto: [],
    built: false,
  },
];

/** Process areas in a phase, in order. */
export const areasInPhase = (phase: number) =>
  PROCESS_AREAS.filter((area) => area.phase === phase);

/** Phases that actually carry process areas, so the menu shows no empty groups. */
export const populatedPhases = () =>
  PHASES.filter((phase) => areasInPhase(phase.number).length > 0);
