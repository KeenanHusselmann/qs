/**
 * L0 phases and L1 domains.
 *
 * Phase names match `process-model.ts`, so the platform's chain and the generic model speak of the
 * same seven phases. The PROCSA and FIDPM equivalents are given on each, because a South African
 * practice will meet both: PROCSA stages in a private appointment, FIDPM stages and gates on public
 * work. They do not line up one to one, and where they differ the mapping says so.
 */

import type { Domain, Phase } from "./types";

const PROCSA = "PROCSA stages and development team matrix";
const SACQSP = "SACQSP Guideline Tariff of Professional Fees 2024 (GG 52152)";
const FIDPM = "National Treasury FIDPM (2019)";
const JBCC = "JBCC 6.2 Guide to Completion and Payment";

export const PHASES: readonly Phase[] = [
  {
    number: 1,
    name: "Feasibility & Inception",
    purpose:
      "Establish whether the project should exist at all: the need and desirability, the land and the rights to develop it, the client's brief, and a first test of whether it can be delivered within an affordable cost.",
    procsa: "Stage 0 — Project initiation & briefing, and Stage 1 — Inception",
    fidpm: "Stage 1 — Initiation (Initiation Report or Prefeasibility Report)",
    gate: {
      deliverable: "Approved project brief and initiation / prefeasibility report",
      approvedBy: "client",
      criteria: [
        "Project objectives, needs, priorities and constraints are documented",
        "The site, its rights and constraints are known well enough to design against",
        "A preliminary desktop viability supports proceeding",
        "A procurement policy is set and the necessary consultants are appointed",
      ],
    },
    keyDeliverables: [
      "First business case",
      "Project brief",
      "Preliminary site assessment",
      "Preliminary desktop viability",
      "Consultant appointments and agreed scopes of service",
    ],
    references: [PROCSA, SACQSP, FIDPM],
  },
  {
    number: 2,
    name: "Design & Documentation",
    purpose:
      "Turn the brief into a concept, develop it into a coordinated design with a cost plan that fits the budget, obtain the statutory approvals, and produce the documentation a contractor can price and build from.",
    procsa: "Stage 2 — Concept & viability, Stage 3 — Design development, and the documentation half of Stage 4",
    fidpm: "Stage 2 — Concept (Concept or Feasibility Report), Stage 3 — Design Development, Stage 4 — Design Documentation",
    gate: {
      deliverable: "Approved design documentation within the approved budget",
      approvedBy: "client",
      criteria: [
        "The concept and its viability were approved (and on public work passed the Stage 2 gateway review)",
        "The design development report confirms the scope can be completed within budget, or proposes a revised budget",
        "Building plans are approved or submitted and their conditions known",
        "Working drawings and specifications are complete enough to measure and tender",
      ],
    },
    keyDeliverables: [
      "Concept design and viability report",
      "Preliminary and elemental estimates of construction cost",
      "Design development report and detailed estimate",
      "Approved building plans",
      "Working drawings, specifications and bills of quantities",
    ],
    references: [PROCSA, SACQSP, FIDPM, "National Building Regulations and Building Standards Act 103 of 1977"],
  },
  {
    number: 3,
    name: "Procurement & Tender",
    purpose:
      "Decide how the works will be bought, prepare tender documents that match that strategy, invite and evaluate tenders, and award a contract to a responsive tenderer at a price reconciled to the budget.",
    procsa: "Stage 4 — Documentation & procurement (procurement half)",
    fidpm: "Procurement gates PG1 to PG7",
    gate: {
      deliverable: "Signed contract with the successful tenderer",
      approvedBy: "client",
      criteria: [
        "The procurement strategy and documents were approved (PG2, PG3)",
        "Cash flow is confirmed sufficient to meet the contract's obligations (PG4)",
        "Tenders were evaluated for completeness and responsiveness and the evaluation ratified (PG6)",
        "The tender price is reconciled with the project budget",
      ],
    },
    keyDeliverables: [
      "Procurement strategy and programme",
      "Tender documentation",
      "Tender evaluation report and recommendation",
      "Priced contract documentation for signature",
    ],
    references: [PROCSA, SACQSP, FIDPM, "CIDB Standard for Uniformity in Construction Procurement"],
  },
  {
    number: 4,
    name: "Construction & Delivery",
    purpose:
      "Build the works under the contract: hand over the site, control time, cost, quality and safety, value and certify the work monthly, manage change, and bring the works to practical completion.",
    procsa: "Stage 5 — Construction",
    fidpm: "Stage 5 — Works",
    gate: {
      deliverable: "Certificate of practical completion",
      approvedBy: "pm",
      criteria: [
        "The works are substantially complete and can effectively be used for the purpose intended",
        "Items on the list for practical completion are rectified",
        "Statutory certificates required for occupation are obtained or in hand",
      ],
    },
    keyDeliverables: [
      "Approved construction programme",
      "Monthly payment certificates and recovery statements",
      "Contract instructions and priced variations",
      "Monthly cost reports and cash flow forecasts",
      "Progress reports and site meeting records",
    ],
    references: [PROCSA, SACQSP, FIDPM, JBCC, "Construction Regulations 2014"],
  },
  {
    number: 5,
    name: "Handover & Commissioning",
    purpose:
      "Test and commission the installations, hand the works and their record information to the user, train the people who will run it, and obtain the certificates that allow it to be occupied.",
    procsa: "Stage 5 (practical completion) into Stage 6 — Close-out",
    fidpm: "Stage 6 — Handover (Handover / Record Information Report)",
    gate: {
      deliverable: "Works taken over by the user, with record information and occupation certificate",
      approvedBy: "client",
      criteria: [
        "Installations are tested and commissioned",
        "As-built drawings, O&M manuals, guarantees and warranties are received",
        "The health and safety file is handed over",
        "A certificate of occupancy is issued by the local authority",
      ],
    },
    keyDeliverables: [
      "Commissioning records",
      "As-built drawings and O&M manuals",
      "Health and safety file",
      "Certificate of occupancy",
      "List for completion (defects)",
    ],
    references: [PROCSA, FIDPM, JBCC, "National Building Regulations and Building Standards Act 103 of 1977, s14"],
  },
  {
    number: 6,
    name: "Close-out & Final Account",
    purpose:
      "Rectify the defects listed at practical completion, reach final completion, agree the final account and certify the last payment, and close the project with a report that captures what was learned.",
    procsa: "Stage 6 — Close-out",
    fidpm: "Stage 7 — Close-out (Defects / Final Completion certificate, Final Account, Close-out Report)",
    gate: {
      deliverable: "Certificate of final completion, agreed final account and approved close-out report",
      approvedBy: "client",
      criteria: [
        "All defects on the list for final completion are rectified",
        "The final account is agreed by the parties",
        "The final payment certificate is issued",
        "Record information is archived and contract completion data captured",
      ],
    },
    keyDeliverables: [
      "Certificate of final completion",
      "Final account",
      "Final payment certificate",
      "Project close-out report",
    ],
    references: [PROCSA, SACQSP, FIDPM, JBCC],
  },
  {
    number: 7,
    name: "Asset & Warranty",
    purpose:
      "Run and maintain the completed asset: keep the asset register current, plan operations and maintenance, and manage warranties and latent defects claims for as long as they last.",
    procsa: "Beyond the PROCSA stages — the client's own facilities management",
    fidpm: "Operations & Maintenance phases (Planning, Implementation, Review, Improvement)",
    gate: {
      deliverable: "Updated asset register and approved operations and maintenance plans",
      approvedBy: "fm",
      criteria: [
        "The asset register records what was built, where and at what cost",
        "Operations and maintenance management plans are approved",
        "Warranty and latent defect periods and their contacts are recorded",
      ],
    },
    keyDeliverables: [
      "Updated asset register",
      "Operations management plan",
      "Maintenance management plan",
      "Warranty and latent defects register",
    ],
    references: [FIDPM, JBCC, "NHBRC home enrolment and warranty scheme"],
  },
];

export const DOMAINS: readonly Domain[] = [
  {
    code: "D1",
    name: "QS & Cost Management",
    purpose:
      "Establish, control and account for what the project costs — from the first estimate through the bill of quantities, tender, monthly valuations and variations to the agreed final account.",
    leads: ["qs"],
  },
  {
    code: "D2",
    name: "Project Management",
    purpose:
      "Define the project, assemble and direct the team, plan and control the programme, manage risk, and carry the project from brief to close-out.",
    leads: ["pm", "dm"],
  },
  {
    code: "D3",
    name: "Architecture & Design",
    purpose:
      "Interpret the brief and the site into a design, develop and coordinate it with the engineers, document it for construction, and see that what is built matches the design intent.",
    leads: ["arch"],
  },
  {
    code: "D4",
    name: "Engineering",
    purpose:
      "Investigate the ground and the site, design the structure, the civil works and the building services, secure bulk service connections, and test and commission what is installed.",
    leads: ["struct", "civil", "elec", "mech", "geo"],
  },
  {
    code: "D5",
    name: "Construction Management",
    purpose:
      "The contractor's delivery of the works: establishing the site, planning and resourcing, managing subcontractors and suppliers, quality, and site health, safety and environment.",
    leads: ["contractor"],
  },
  {
    code: "D6",
    name: "Contract Administration",
    purpose:
      "Administer the building contract impartially: award and signature, instructions and notices, extensions of time, claims, completion certificates and the defects periods.",
    leads: ["pm"],
  },
  {
    code: "D7",
    name: "Compliance & Regulatory",
    purpose:
      "Obtain and keep the permissions the law requires — land use, environmental authorisation, building plans, NHBRC enrolment, construction health and safety, and occupation.",
    leads: ["planner", "arch", "env", "hs"],
  },
  {
    code: "D8",
    name: "Procurement & Supply Chain",
    purpose:
      "Buy the professional services, contractors and materials the project needs by a fair, documented process, and record how each contract performed.",
    leads: ["pm", "qs"],
  },
];
