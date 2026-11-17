/**
 * D8 — Procurement & Supply Chain. The FIDPM procurement gates (PG1 to PG8) are the spine: each
 * gate's minimum requirements appear as tasks, and the gate itself as the decision that closes them.
 */

import { SOURCES as S, sub, task as t } from "./build";
import type { Area } from "./types";

export const D8: readonly Area[] = [
  {
    code: "D8.1",
    name: "Contractor Procurement",
    domain: "D8",
    phase: 3,
    purpose: "Invite, receive and account for tender offers from contractors by a fair and documented process.",
    subProcesses: [
      sub("D8.1-SP-001", "Prequalification", "pm", {
        purpose: "Shortlist tenderers with the capability, grading and standing to perform the contract.",
        trigger: "The procurement strategy calls for a shortlist or restricted tender",
        outcome: "An approved list of prequalified tenderers",
        references: [S.CIDB_SFU, S.PROCSA],
        tasks: [
          t("T01", "Set the prequalification criteria", "pm", "Set grading, experience, capacity, financial and preference criteria.", ["Procurement strategy"], ["Prequalification criteria"], { with: ["qs"], references: [S.CIDB_SFU] }),
          t("T02", "Invite expressions of interest", "pm", "Invite contractors to submit expressions of interest.", ["Prequalification criteria"], ["Expressions of interest"]),
          t("T03", "Evaluate the submissions", "qs", "Evaluate the submissions against the criteria.", ["Expressions of interest"], ["Prequalification evaluation"], { with: ["pm"] }),
          t("T04", "Approve the tender list", "dm", "Review and approve the proposed tenderers.", ["Prequalification evaluation"], ["Approved tender list"], { with: ["client"], references: [S.PROCSA] }),
        ],
      }),
      sub("D8.1-SP-002", "Tender Invitation & Receipt", "pm", {
        purpose: "Solicit tender offers and account for every offer received.",
        trigger: "Tender documents are approved (PG3) and cash flow confirmed (PG4)",
        outcome: "All tender offers received, recorded and safeguarded (PG5)",
        references: [S.FIDPM, S.SACQSP],
        tasks: [
          t("T01", "Invite tender offers", "pm", "Issue the tender to the approved tenderers or advertise it.", ["Approved tender document", "Tender list"], ["Tender invitation"], { references: [S.FIDPM] }),
          t("T02", "Hold the clarification meeting and issue addenda", "pm", "Hold the compulsory briefing or site meeting and issue answers to all tenderers.", ["Tenderers' queries"], ["Minutes and addenda"], { with: ["qs", "arch"] }),
          t("T03", "Receive tender offers", "pm", "Receive offers at the closing time and place.", ["Tender offers"], ["Tender receipt register"], { references: [S.FIDPM] }),
          t("T04", "Record and safeguard tender offers", "pm", "Record the offers and keep them secure.", ["Tender receipt register"], ["Tender record"], { references: [S.FIDPM] }),
          t("T05", "Report on offers received", "pm", "Prepare a report on the tender offers received for evaluation (D1.3).", ["Tender record"], ["Report on offers received"], { with: ["qs"], references: [S.FIDPM] }),
        ],
        gateway: {
          question: "Are all received tender offers duly accounted for (PG5)?",
          yes: "Proceed to evaluation",
          no: "Investigate and correct the record before evaluation",
          after: "T04",
        },
      }),
    ],
  },
  {
    code: "D8.2",
    name: "Procurement Strategy",
    domain: "D8",
    phase: 3,
    purpose: "Decide what is being bought, how, on what contract and pricing basis, and confirm the money is there.",
    subProcesses: [
      sub("D8.2-SP-001", "Permission to Procure", "pm", {
        purpose: "Obtain permission to start procurement on a broad scope and a confirmed budget.",
        trigger: "A package of work needs to be procured",
        outcome: "A decision to proceed or not with the procurement (PG1)",
        references: [S.FIDPM],
        tasks: [
          t("T01", "Establish what needs to be procured", "pm", "Establish and clarify the goods, services or works to be procured.", ["Project brief", "Design"], ["Procurement need"], { references: [S.FIDPM] }),
          t("T02", "Prepare the broad scope of work", "pm", "Prepare a broad scope of work and a title for the procurement.", ["Procurement need"], ["Broad scope of work"], { with: ["arch"], references: [S.FIDPM] }),
          t("T03", "Estimate the financial value", "qs", "Estimate the value of the procurement and contract for budgetary purposes.", ["Broad scope of work"], ["Procurement estimate"], { references: [S.FIDPM] }),
          t("T04", "Confirm the budget", "client", "Confirm the budget covers the estimate.", ["Procurement estimate", "Budget"], ["Budget confirmation"], { references: [S.FIDPM] }),
        ],
        gateway: {
          question: "Does the designated person approve proceeding (PG1)?",
          yes: "Proceed to the procurement strategy",
          no: "Stop or revise the scope",
          after: "T04",
        },
      }),
      sub("D8.2-SP-002", "Strategy & Cash Flow Approval", "pm", {
        purpose: "Approve the procurement, contracting and pricing strategies, and confirm cash flow before tenders are invited.",
        trigger: "Permission to procure is given (PG1)",
        outcome: "Approved procurement strategy (PG2) and confirmed cash flow (PG4)",
        references: [S.FIDPM, S.PPPFA],
        tasks: [
          t("T01", "Decide the procurement strategy", "pm", "Decide the delivery method (e.g. design by employer, design and build, management) and packaging.", ["Broad scope", "Programme", "Risk profile"], ["Procurement strategy"], { with: ["qs"], references: [S.FIDPM] }),
          t("T02", "Establish preferential procurement opportunities", "pm", "Establish opportunities for preferential procurement in line with legislation and the sector code.", ["Procurement strategy"], ["Preference objectives"], { references: [S.FIDPM, S.PPPFA] }),
          t("T03", "Establish the contracting and pricing strategy", "qs", "Allocate responsibilities and risks and choose how contractors are paid.", ["Procurement strategy"], ["Contracting and pricing strategy"], { with: ["pm"], references: [S.FIDPM] }),
          t("T04", "Establish procurement procedures", "pm", "Choose the procedure — open, qualified, nominated, negotiated.", ["Contracting strategy"], ["Procurement procedure"], { references: [S.FIDPM, S.CIDB_SFU] }),
          t("T05", "Obtain strategy approval", "client", "The delegated person approves the strategies (PG2).", ["Procurement strategy", "Contracting strategy", "Procedure"], ["Approved strategy"], { references: [S.FIDPM] }),
          t("T06", "Confirm cash flow and payment controls", "qs", "Confirm cash flow meets projected contractual obligations and payment controls exist (PG4).", ["Approved strategy", "Cash flow forecast"], ["Cash flow confirmation"], { with: ["client"], references: [S.FIDPM] }),
        ],
      }),
    ],
  },
  {
    code: "D8.3",
    name: "Professional Service Provider Procurement",
    domain: "D8",
    phase: 1,
    purpose: "Appoint architects, engineers, quantity surveyors and specialists on a defined scope and fee basis.",
    subProcesses: [
      sub("D8.3-SP-001", "Consultant Selection & Appointment", "pm", {
        purpose: "Select consultants on capability and fee and appoint them on a standard agreement.",
        trigger: "The project procurement policy is set",
        outcome: "Signed professional services agreements",
        references: [S.PROCSA, S.SACQSP],
        tasks: [
          t("T01", "Define the scope of services and deliverables", "pm", "Define each discipline's stages, services and deliverables.", ["Project brief"], ["Terms of reference"], { references: [S.PROCSA] }),
          t("T02", "Request proposals", "pm", "Request proposals on capability, approach, team and fee.", ["Terms of reference"], ["Proposals"]),
          t("T03", "Evaluate quality and fee", "pm", "Evaluate proposals on quality first and fee second, as the policy sets.", ["Proposals"], ["Evaluation report"], { with: ["dm"] }),
          t("T04", "Negotiate the fee against the guideline tariff", "dm", "Agree the fee basis, using the professions' guideline tariffs as the reference.", ["Evaluation report"], ["Agreed fee"], { references: [S.SACQSP] }),
          t("T05", "Appoint on a professional services agreement", "client", "Sign the appointment with the agreed scope, fee and stages.", ["Agreed fee", "Terms of reference"], ["Signed appointment"], { references: [S.PROCSA] }),
        ],
      }),
    ],
  },
  {
    code: "D8.4",
    name: "Materials & Long-lead Procurement",
    domain: "D8",
    phase: 4,
    purpose: "Get materials and equipment to site when the programme needs them, at the specified quality.",
    subProcesses: [
      sub("D8.4-SP-001", "Ordering & Expediting", "contractor", {
        purpose: "Order, expedite and receive materials and long-lead equipment.",
        trigger: "An item reaches its order date on the procurement schedule",
        outcome: "Materials delivered, checked and recorded",
        tasks: [
          t("T01", "Obtain approval of products and samples", "contractor", "Submit product data and samples for approval before ordering.", ["Specification", "Product data"], ["Approved products"], { with: ["arch"] }),
          t("T02", "Obtain quotations and place orders", "contractor", "Obtain quotations and place orders with delivery dates.", ["Approved products", "Procurement schedule"], ["Purchase orders"], { with: ["sub"] }),
          t("T03", "Expedite long-lead items", "contractor", "Track fabrication and shipping of long-lead items against the programme.", ["Purchase orders"], ["Expediting report"], { with: ["sub"] }),
          t("T04", "Receive and inspect deliveries", "contractor", "Check deliveries for quantity, damage and compliance.", ["Delivery notes"], ["Goods received record"]),
          t("T05", "Record materials for valuation", "contractor", "Record materials on and off site with proof of ownership for the valuation (D1.5).", ["Goods received record", "Invoices"], ["Materials on site schedule"], { with: ["qs"] }),
        ],
        gateway: {
          question: "Will the item arrive before the programme needs it?",
          yes: "Continue tracking",
          no: "Escalate, find an alternative, or re-sequence the works",
          after: "T03",
        },
      }),
    ],
  },
  {
    code: "D8.5",
    name: "Contract Completion Records & Performance",
    domain: "D8",
    phase: 6,
    purpose: "Record how each contract ended and how the contractor performed, for accountability and future procurement.",
    subProcesses: [
      sub("D8.5-SP-001", "Contract Completion Data", "pm", {
        purpose: "Capture contract award, completion or termination data and a performance assessment.",
        trigger: "The contract reaches final completion or is terminated",
        outcome: "Contract completion data captured (PG8)",
        references: [S.FIDPM],
        tasks: [
          t("T01", "Confirm compliance with contractual requirements", "pm", "Confirm the contract was administered and completed in accordance with its terms.", ["Contract records"], ["Contract compliance confirmation"], { references: [S.FIDPM] }),
          t("T02", "Assess contractor performance", "pm", "Assess time, cost, quality and safety performance.", ["Progress reports", "Final account", "Audit reports"], ["Contractor performance assessment"], { with: ["qs", "hs"] }),
          t("T03", "Capture contract completion data", "pm", "Capture the completion or termination data in the procurement record.", ["Contract compliance confirmation", "Final account"], ["Contract completion record"], { references: [S.FIDPM] }),
          t("T04", "Share the performance record", "pm", "Share the assessment with the contractor and file it for future evaluations.", ["Contractor performance assessment"], ["Filed performance record"], { with: ["contractor"] }),
        ],
      }),
    ],
  },
];
