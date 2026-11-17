/** D2 — Project Management. Largely the PROCSA development manager and project manager activities. */

import { SOURCES as S, sub, task as t } from "./build";
import type { Area } from "./types";

export const D2: readonly Area[] = [
  {
    code: "D2.1",
    name: "Project Initiation & Charter",
    domain: "D2",
    phase: 1,
    purpose: "Decide that a project is worth pursuing, secure the land and the rights to it, and write down what it must achieve.",
    subProcesses: [
      sub("D2.1-SP-001", "Need, Desirability & First Business Case", "dm", {
        purpose: "Establish why the development should happen and whether it could make sense before anyone is appointed.",
        trigger: "An opportunity or a need for accommodation is identified",
        outcome: "An approved first business case and the client's formalised vision",
        references: [S.PROCSA],
        tasks: [
          t("T01", "Establish project need and desirability", "dm", "Test the need for the development against demand, policy and the client's strategy.", ["Client strategy", "Market indicators"], ["Need and desirability statement"], { references: [S.PROCSA] }),
          t("T02", "Procure market research", "dm", "Commission research confirming the product and its income stream.", ["Need statement"], ["Market research"], { references: [S.PROCSA] }),
          t("T03", "Source appropriate land", "dm", "Identify and secure land suited to the product.", ["Market research"], ["Land option or offer to purchase"], { with: ["planner"], references: [S.PROCSA] }),
          t("T04", "Prepare a first business case", "dm", "Set out the product, cost, revenue and return at a desktop level.", ["Market research", "Land terms"], ["First business case"], { with: ["qs"], references: [S.PROCSA] }),
          t("T05", "Formalise the client's vision", "client", "Approve the vision and objectives the project will be measured against.", ["First business case"], ["Approved client vision"], { with: ["dm"], references: [S.PROCSA] }),
        ],
        gateway: {
          question: "Does the first business case justify spending on professional fees?",
          yes: "Proceed to brief and appoint consultants",
          no: "Stop, or revise the product or land",
          after: "T04",
        },
      }),
      sub("D2.1-SP-002", "Project Brief & Charter", "pm", {
        purpose: "Document the project's objectives, priorities, constraints and assumptions as the basis for design.",
        trigger: "The client decides to proceed",
        outcome: "An approved project brief and initiation report",
        references: [S.PROCSA, S.FIDPM],
        tasks: [
          t("T01", "Facilitate development of the project brief", "pm", "Run briefing sessions with the client and consultants and draft the brief.", ["Client vision", "User requirements"], ["Draft project brief"], { with: ["arch", "qs"], references: [S.PROCSA] }),
          t("T02", "Establish the site characteristics, rights and constraints", "pm", "With the consultants and authorities, establish what the site allows and prevents.", ["Title deed", "Zoning certificate", "Site information"], ["Site constraints register"], { with: ["planner", "civil", "arch"], references: [S.PROCSA] }),
          t("T03", "Prepare a schedule of consents and approvals", "pm", "List every statutory consent the project needs and who obtains it.", ["Site constraints register"], ["Consents and approvals schedule"], { references: [S.PROCSA] }),
          t("T04", "Prepare the project initiation programme", "pm", "Programme the inception and concept activities.", ["Draft brief"], ["Project initiation programme"], { references: [S.PROCSA] }),
          t("T05", "Obtain client approval of stage documentation", "pm", "Present the brief and initiation report for approval.", ["Draft brief", "Consents schedule", "Programme"], ["Approved brief and initiation report"], { with: ["client"], references: [S.PROCSA, S.FIDPM] }),
        ],
      }),
    ],
  },
  {
    code: "D2.2",
    name: "Consultant Appointment & Team Setup",
    domain: "D2",
    phase: 1,
    purpose: "Assemble the professional team with defined roles, scopes and fees, and agree how it will work together.",
    subProcesses: [
      sub("D2.2-SP-001", "Team Definition & Appointment", "pm", {
        purpose: "Appoint each consultant with a clear scope, responsibilities and liabilities.",
        trigger: "The project brief is drafted",
        outcome: "Signed professional services agreements for the team",
        references: [S.PROCSA, S.SACQSP],
        tasks: [
          t("T01", "Establish the project procurement policy", "pm", "Agree with the client how consultants and contractors will be procured.", ["Client policies"], ["Project procurement policy"], { with: ["client"], references: [S.PROCSA] }),
          t("T02", "Define the consultants' scopes of service", "pm", "Define each discipline's scope, stages and deliverables.", ["Project brief", "Procurement policy"], ["Scopes of service"], { with: ["arch", "qs", "struct"], references: [S.PROCSA] }),
          t("T03", "Procure the consultants", "pm", "Assist the client to procure the consultants in line with the policy (D8.3).", ["Scopes of service"], ["Recommended appointments"], { references: [S.PROCSA] }),
          t("T04", "Conclude the professional services agreements", "client", "Sign an agreement with each consultant on the agreed scope and fee basis.", ["Recommended appointments"], ["Signed consultant agreements"], { references: [S.SACQSP] }),
          t("T05", "Advise on appointing a health and safety agent", "pm", "Advise the client on appointing a health and safety agent for the client's statutory duties.", ["Project scale and risk"], ["H&S agent appointment advice"], { references: [S.PROCSA, S.CR2014] }),
        ],
      }),
      sub("D2.2-SP-002", "Communication & Reporting Structure", "pm", {
        purpose: "Agree how the team communicates, meets and reports, so decisions are recorded and traceable.",
        trigger: "The team is appointed",
        outcome: "Agreed communication and reporting procedures",
        references: [S.PROCSA],
        tasks: [
          t("T01", "Define report and communication formats", "dm", "Define the formats and procedures for reports, presentations and communication.", ["Client requirements"], ["Communication procedures"], { references: [S.PROCSA] }),
          t("T02", "Agree cost control and reporting procedures", "pm", "Agree how each consultant reports cost against the budget.", ["Budget"], ["Cost reporting procedures"], { with: ["qs"], references: [S.PROCSA] }),
          t("T03", "Set the meeting schedule and minuting", "pm", "Schedule design team and client meetings and how they are recorded.", ["Programme"], ["Meeting schedule"], { references: [S.PROCSA] }),
        ],
      }),
    ],
  },
  {
    code: "D2.3",
    name: "Design & Documentation Programme Management",
    domain: "D2",
    phase: 2,
    purpose: "Plan and drive the design so it is complete, coordinated and approved in time for procurement.",
    subProcesses: [
      sub("D2.3-SP-001", "Design Programme & Coordination", "pm", {
        purpose: "Set and monitor a detailed design and documentation programme agreed by every consultant.",
        trigger: "The concept is approved for design development",
        outcome: "Design documentation delivered to programme",
        references: [S.PROCSA, S.SACQSP],
        tasks: [
          t("T01", "Prepare the documentation programme", "pm", "Prepare a documentation programme and indicative construction programme.", ["Concept approval", "Consultant input"], ["Documentation programme"], { references: [S.PROCSA] }),
          t("T02", "Agree the detailed design programme", "pm", "Agree the detailed design and documentation programme with all consultants.", ["Documentation programme"], ["Agreed design programme"], { with: ["arch", "struct", "qs"], references: [S.SACQSP] }),
          t("T03", "Conduct and record consultants' meetings", "pm", "Run design meetings, record decisions and track actions.", ["Design programme"], ["Minutes and action register"], { references: [S.PROCSA] }),
          t("T04", "Facilitate technical coordination", "pm", "Resolve interfaces between disciplines before they reach site.", ["Consultants' drawings"], ["Coordinated design"], { with: ["arch", "struct", "mech"], references: [S.PROCSA] }),
          t("T05", "Facilitate design reviews for compliance and cost", "pm", "Review each design stage against the brief, regulations and budget.", ["Design issue", "Cost check"], ["Design review record"], { with: ["qs", "arch"], references: [S.PROCSA] }),
        ],
      }),
      sub("D2.3-SP-002", "Stage Approval", "pm", {
        purpose: "Obtain the client's approval of each design stage's deliverables before the next starts.",
        trigger: "A stage's documentation is complete",
        outcome: "Stage deliverables approved by the client",
        references: [S.PROCSA, S.FIDPM],
        tasks: [
          t("T01", "Coordinate stage documentation for presentation", "pm", "Assemble the stage report from all consultants.", ["Consultants' stage deliverables"], ["Stage report"], { references: [S.PROCSA] }),
          t("T02", "Present to the client for approval", "pm", "Present the design, cost and programme and record the decision.", ["Stage report"], ["Client decision"], { with: ["client"], references: [S.PROCSA] }),
          t("T03", "Arrange the gateway review where required", "pm", "On public major capital projects, submit the stage 2 deliverable for an independent gateway review.", ["Concept / feasibility report"], ["Gateway review report"], { references: [S.FIDPM] }),
        ],
        gateway: {
          question: "Are there critical findings or is the stage deliverable rejected?",
          yes: "Address the findings and resubmit before proceeding",
          no: "Proceed to the next stage",
          after: "T03",
        },
      }),
    ],
  },
  {
    code: "D2.4",
    name: "Procurement Programme Management",
    domain: "D2",
    phase: 3,
    purpose: "Plan the procurement of contractors and suppliers so the right contracts are in place when construction needs them.",
    subProcesses: [
      sub("D2.4-SP-001", "Procurement Programme", "pm", {
        purpose: "Agree the procurement programme and proposed tenderers.",
        trigger: "The procurement strategy is recommended",
        outcome: "An approved procurement programme and tender list",
        references: [S.PROCSA, S.SACQSP],
        tasks: [
          t("T01", "Recommend the procurement strategy", "pm", "Recommend the strategy for contractors, subcontractors and suppliers (D8.2).", ["Project brief", "Budget", "Programme"], ["Procurement strategy recommendation"], { with: ["qs", "client"], references: [S.PROCSA] }),
          t("T02", "Prepare the procurement programme", "pm", "Programme each package from documents to award.", ["Procurement strategy", "Construction programme"], ["Procurement programme"], { references: [S.SACQSP] }),
          t("T03", "Approve the programme and proposed tenderers", "dm", "Review and approve the programme and the tenderers to be invited.", ["Procurement programme", "Tender list"], ["Approved procurement programme"], { with: ["client"], references: [S.PROCSA] }),
          t("T04", "Advise on insurances", "pm", "Advise the client, with the consultants, on the insurances the project needs.", ["Contract form", "Risk profile"], ["Insurance advice"], { with: ["qs"], references: [S.SACQSP] }),
        ],
      }),
    ],
  },
  {
    code: "D2.5",
    name: "Construction Programme & Progress Monitoring",
    domain: "D2",
    phase: 4,
    purpose: "Hold the contractor to the programme, see delay early, and keep the client informed.",
    subProcesses: [
      sub("D2.5-SP-001", "Site Handover & Programme Approval", "pm", {
        purpose: "Give the contractor possession of the site and approve a programme to measure progress against.",
        trigger: "The contract is signed",
        outcome: "The site handed over and the construction programme approved",
        references: [S.PROCSA, S.SACQSP],
        tasks: [
          t("T01", "Formalise occupation of the site", "dm", "Clear the site for the contractor, including terminating existing leases.", ["Contract", "Site status"], ["Site available for handover"], { references: [S.PROCSA] }),
          t("T02", "Arrange the site handover", "pm", "Hand over the site to the contractor with the team present and record its condition.", ["Contract data"], ["Site handover record"], { with: ["contractor", "arch", "qs"], references: [S.PROCSA] }),
          t("T03", "Establish the construction documentation issue process", "pm", "Agree how construction documents are issued and distributed.", ["Documentation register"], ["Document issue procedure"], { references: [S.SACQSP] }),
          t("T04", "Review and approve the construction programme", "pm", "Review the contractor's programme for logic, completeness and the contract dates.", ["Contractor's programme"], ["Approved construction programme"], { with: ["contractor"], references: [S.SACQSP] }),
        ],
      }),
      sub("D2.5-SP-002", "Progress Monitoring & Reporting", "pm", {
        purpose: "Monitor performance against the programme and report progress to the client.",
        trigger: "The regular site meeting cycle",
        outcome: "A progress report issued and corrective action recorded",
        references: [S.SACQSP, S.PROCSA],
        tasks: [
          t("T01", "Conduct and record site meetings", "pm", "Run site meetings and issue minutes and action lists.", ["Agenda", "Previous minutes"], ["Site meeting minutes"], { with: ["contractor", "arch", "qs"], references: [S.SACQSP] }),
          t("T02", "Monitor performance against the programme", "pm", "Compare actual progress with the approved programme and identify slippage.", ["Approved programme", "Site progress"], ["Progress assessment"], { references: [S.SACQSP] }),
          t("T03", "Require a recovery programme where behind", "pm", "Require the contractor to show how lost time will be recovered.", ["Progress assessment"], ["Recovery programme"], { with: ["contractor"] }),
          t("T04", "Prepare and submit the progress report", "pm", "Report progress, cost, quality, safety and risk to the client.", ["Progress assessment", "Cost report"], ["Progress report"], { with: ["client"], references: [S.SACQSP] }),
        ],
        gateway: {
          question: "Is the works behind programme?",
          yes: "Require a recovery programme and assess any extension of time (D6.1)",
          no: "Report and continue",
          after: "T02",
        },
      }),
    ],
  },
  {
    code: "D2.6",
    name: "Risk & Issue Management",
    domain: "D2",
    phase: 4,
    purpose: "Identify what could stop the project succeeding, decide what to do about it, and track it to closure.",
    subProcesses: [
      sub("D2.6-SP-001", "Risk Register Management", "pm", {
        purpose: "Keep a live register of project risks with owners and responses.",
        trigger: "Project start, then every reporting cycle",
        outcome: "A current risk register with actions reported to the client",
        tasks: [
          t("T01", "Identify risks with the team", "pm", "Run a risk workshop across design, cost, programme, safety and statutory risk.", ["Brief", "Programme", "Baseline risk assessment"], ["Risk list"], { with: ["qs", "arch", "hs"] }),
          t("T02", "Assess likelihood and impact", "pm", "Rate each risk and estimate its cost and time exposure.", ["Risk list"], ["Assessed risk register"], { with: ["qs"] }),
          t("T03", "Assign owners and responses", "pm", "Agree for each risk whether to avoid, reduce, transfer or accept it, and who owns it.", ["Assessed risk register"], ["Risk response plan"]),
          t("T04", "Review and report monthly", "pm", "Update the register and report the top risks and contingency exposure.", ["Risk response plan"], ["Risk report"], { with: ["client", "qs"] }),
        ],
      }),
    ],
  },
  {
    code: "D2.7",
    name: "Close-out & Handover",
    domain: "D2",
    phase: 5,
    purpose: "Bring the works to practical completion and hand them, and everything needed to run them, to the client.",
    subProcesses: [
      sub("D2.7-SP-001", "Practical Completion Coordination", "pm", {
        purpose: "Coordinate the inspections and lists that lead to the certificate of practical completion.",
        trigger: "The contractor gives notice that practical completion is near",
        outcome: "A certificate of practical completion and list for completion issued (D6.4)",
        references: [S.JBCC, S.SACQSP],
        tasks: [
          t("T01", "Coordinate practical completion inspections", "pm", "Arrange inspections with every consultant.", ["Contractor's notice"], ["Inspection schedule"], { with: ["arch", "struct", "elec", "mech"], references: [S.SACQSP] }),
          t("T02", "Issue the list for practical completion", "pm", "Issue a single comprehensive list of defects and outstanding work.", ["Inspection findings"], ["List for practical completion"], { references: [S.JBCC] }),
          t("T03", "Facilitate receipt of the occupation certificate", "pm", "Expedite the local authority's certificate of occupancy (D7.5).", ["Statutory certificates"], ["Occupation certificate application"], { references: [S.SACQSP] }),
        ],
      }),
      sub("D2.7-SP-002", "Handover of the Works & Record Information", "pm", {
        purpose: "Hand over the works with the documents the user needs to operate and maintain them.",
        trigger: "Practical completion is certified",
        outcome: "Works taken over by the user with complete record information",
        references: [S.PROCSA, S.FIDPM],
        tasks: [
          t("T01", "Manage procurement of O&M manuals, guarantees and warranties", "pm", "Collect operating and maintenance manuals, guarantees and warranties from the contractor.", ["Contract requirements"], ["O&M manuals and warranties"], { with: ["contractor", "mech", "elec"], references: [S.PROCSA] }),
          t("T02", "Manage preparation of as-built drawings", "pm", "Obtain as-built drawings and documentation from the consultants and contractor.", ["Construction records"], ["As-built drawings"], { with: ["arch", "struct"], references: [S.PROCSA] }),
          t("T03", "Hand over the health and safety file", "dm", "Receive the health and safety file and hand it to the client.", ["Health and safety file"], ["H&S file received by client"], { with: ["hs"], references: [S.PROCSA, S.CR2014] }),
          t("T04", "Distribute record information", "dm", "Distribute drawings, manuals and statutory certificates to the parties who will use them.", ["As-built drawings", "O&M manuals", "Statutory certificates"], ["Distributed record information"], { with: ["fm"], references: [S.PROCSA] }),
          t("T05", "Arrange user training", "pm", "Train the user's staff to operate the installations.", ["O&M manuals"], ["Training record"], { with: ["fm", "contractor"], references: [S.FIDPM] }),
        ],
      }),
    ],
  },
  {
    code: "D2.8",
    name: "Project Close-out Report & Lessons Learned",
    domain: "D2",
    phase: 6,
    purpose: "Close the project formally and record what worked and what did not.",
    subProcesses: [
      sub("D2.8-SP-001", "Close-out Report", "pm", {
        purpose: "Report the project's final cost, time and quality outcomes and close it.",
        trigger: "Final completion and final account are achieved",
        outcome: "A project close-out report approved by the client",
        references: [S.PROCSA, S.FIDPM, S.SACQSP],
        tasks: [
          t("T01", "Confirm completion certificates and final account", "pm", "Confirm final completion is certified and the final account agreed.", ["Certificate of final completion", "Final account"], ["Completion confirmation"], { references: [S.SACQSP] }),
          t("T02", "Collect outcomes against the brief", "pm", "Compare final cost, time and quality with the approved brief and budget.", ["Brief", "Final account", "Programme"], ["Outcome analysis"], { with: ["qs"] }),
          t("T03", "Run a lessons-learned review", "pm", "Record what went well and what should change, with the team.", ["Outcome analysis"], ["Lessons learned"], { with: ["arch", "qs", "contractor"] }),
          t("T04", "Prepare and present the close-out report", "pm", "Prepare the report and present it to the client for approval.", ["Outcome analysis", "Lessons learned"], ["Approved close-out report"], { with: ["client"], references: [S.PROCSA, S.FIDPM] }),
          t("T05", "Archive record information", "pm", "Archive the project's record information.", ["Project records"], ["Archived records"], { references: [S.FIDPM] }),
        ],
      }),
    ],
  },
  {
    code: "D2.9",
    name: "Asset Registration & O&M Planning",
    domain: "D2",
    phase: 7,
    purpose: "Bring the completed works into the owner's asset management, with plans to operate and maintain them.",
    subProcesses: [
      sub("D2.9-SP-001", "Asset Register Update", "fm", {
        purpose: "Record what was acquired, where it is and what it cost.",
        trigger: "Handover of the works",
        outcome: "An updated and approved asset register",
        references: [S.FIDPM],
        tasks: [
          t("T01", "Extract assets from the record information", "fm", "List the assets and components from as-built drawings and O&M manuals.", ["As-built drawings", "O&M manuals"], ["Asset list"]),
          t("T02", "Attach cost and life data", "fm", "Record each asset's cost, installation date and expected life.", ["Asset list", "Final account"], ["Asset data attributes"], { with: ["qs"] }),
          t("T03", "Approve the updated register", "client", "Approve the updated asset register.", ["Asset data attributes"], ["Approved asset register"], { references: [S.FIDPM] }),
        ],
      }),
      sub("D2.9-SP-002", "Operations & Maintenance Planning", "fm", {
        purpose: "Plan how the asset will be operated and kept near its original condition.",
        trigger: "The asset register is updated, then annually",
        outcome: "Approved operations and maintenance management plans",
        references: [S.FIDPM],
        tasks: [
          t("T01", "Prepare the operations management plan", "fm", "Set operating procedures, schedules, emergency procedures and resources.", ["Asset register", "O&M manuals"], ["Operations management plan"], { references: [S.FIDPM] }),
          t("T02", "Prepare the maintenance management plan", "fm", "Set maintenance activities, schedules, resources and OHS provisions.", ["Asset register", "Warranty register"], ["Maintenance management plan"], { references: [S.FIDPM] }),
          t("T03", "Review O&M performance annually", "fm", "Review achievement of objectives and risks, and report to the accounting officer or owner.", ["O&M records"], ["Maintenance management review report"], { with: ["client"], references: [S.FIDPM] }),
        ],
      }),
    ],
  },
];
