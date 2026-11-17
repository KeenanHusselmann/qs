/**
 * The generic construction process model — L0 to L4, with what happens at each level.
 *
 * ── Why this is separate from `process-model.ts` ───────────────────────────────────────────
 *
 * `process-model.ts` is the platform's own chain: the areas this platform runs, the documents each
 * step reads and which signed output feeds which. It is correct for that job and `chain.ts`,
 * `stages.ts` and the criteria are built on it.
 *
 * This is a different thing: the construction value chain as the industry works it, whether or not
 * a screen exists for any part of it. The /process page rendered the platform's chain and linked
 * into its modules, and the feedback was that the process model should be the generic BPMN model,
 * drilling down to its deepest level, not a map of this platform. So the page reads this library and
 * nothing in it refers to a platform module.
 *
 * ── The levels ─────────────────────────────────────────────────────────────────────────────
 *
 *   L0  Phase         — the seven-phase value chain, in time order (when)
 *   L1  Domain        — the eight professional domains (who)
 *   L2  Process area  — a domain's work within a phase
 *   L3  Sub-process   — a BPMN process: a trigger, tasks in sequence, a decision, an outcome
 *   L4  Task          — one activity, one performer, its inputs and outputs
 *
 * Naming follows the APQC convention the levels are borrowed from: nouns above L3, verbs at L4.
 *
 * ── Where the content comes from ───────────────────────────────────────────────────────────
 *
 * Every phase and most sub-processes name their sources. The spine is South African and public:
 * the PROCSA stages and the development team matrix, the SACQSP 2024 Guideline Tariff (Government
 * Gazette 52152, 21 February 2025), the National Treasury Framework for Infrastructure Delivery and
 * Procurement Management (FIDPM, 2019), the JBCC 6.2 Guide to Completion and Payment, the National
 * Building Regulations and Building Standards Act 103 of 1977, the Construction Regulations 2014 and
 * the NHBRC. Where a task restates a source it says which; where it is general practice it cites
 * none rather than borrowing authority it does not have.
 */

export type RoleCode =
  | "client"
  | "dm" // development manager
  | "pm" // project manager / principal agent
  | "arch"
  | "qs"
  | "struct"
  | "civil"
  | "elec"
  | "mech"
  | "geo"
  | "survey" // land surveyor
  | "planner" // town planner
  | "env" // environmental assessment practitioner
  | "hs" // health and safety agent
  | "contractor"
  | "sub" // subcontractor / supplier
  | "funder"
  | "authority" // municipality, NHBRC, Department of Employment and Labour
  | "fm"; // facilities / asset manager

export const ROLES: Readonly<Record<RoleCode, string>> = {
  client: "Client / employer",
  dm: "Development manager",
  pm: "Project manager / principal agent",
  arch: "Architect",
  qs: "Quantity surveyor",
  struct: "Structural engineer",
  civil: "Civil engineer",
  elec: "Electrical engineer",
  mech: "Mechanical engineer",
  geo: "Geotechnical engineer",
  survey: "Land surveyor",
  planner: "Town planner",
  env: "Environmental assessment practitioner",
  hs: "Health and safety agent",
  contractor: "Principal contractor",
  sub: "Subcontractor / supplier",
  funder: "Funder",
  authority: "Statutory authority",
  fm: "Facilities / asset manager",
};

/** A published source a node restates. Kept short: the name a professional would recognise. */
export type Reference = string;

/** L4 — one activity, done by one performer. */
export interface Task {
  /** "T01" — unique within its sub-process. The full code is `${subProcess.code}-${code}`. */
  code: string;
  /** A verb phrase: "Prepare the elemental estimate". */
  name: string;
  performer: RoleCode;
  /** Roles consulted or informed, where it matters. */
  with?: readonly RoleCode[];
  /** What is done, in one or two sentences. */
  does: string;
  inputs: readonly string[];
  outputs: readonly string[];
  references?: readonly Reference[];
}

/** The decision a sub-process turns on, drawn as a BPMN exclusive gateway. */
export interface Gateway {
  question: string;
  yes: string;
  no: string;
  /** The task the decision follows. */
  after: string;
}

/** L3 — a BPMN process. */
export interface SubProcess {
  /** "D1.1-SP-001". */
  code: string;
  name: string;
  purpose: string;
  /** The start event. */
  trigger: string;
  /** The end event. */
  outcome: string;
  owner: RoleCode;
  tasks: readonly Task[];
  gateway?: Gateway;
  references?: readonly Reference[];
}

/** L2 — a domain's body of work within a phase. */
export interface Area {
  /** "D1.1". */
  code: string;
  name: string;
  domain: DomainCode;
  phase: PhaseNumber;
  purpose: string;
  subProcesses: readonly SubProcess[];
}

export type DomainCode = "D1" | "D2" | "D3" | "D4" | "D5" | "D6" | "D7" | "D8";
export type PhaseNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** L1 — a professional domain. */
export interface Domain {
  code: DomainCode;
  name: string;
  purpose: string;
  leads: readonly RoleCode[];
}

/** L0 — a phase of the value chain. */
export interface Phase {
  number: PhaseNumber;
  name: string;
  purpose: string;
  /** The equivalent stage in the PROCSA / SACQSP stages. */
  procsa: string;
  /** The equivalent stage or stages in the FIDPM. */
  fidpm: string;
  /** What must be approved before the next phase starts. */
  gate: { deliverable: string; approvedBy: RoleCode; criteria: readonly string[] };
  keyDeliverables: readonly string[];
  references: readonly Reference[];
}
