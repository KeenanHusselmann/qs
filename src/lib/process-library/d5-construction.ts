/**
 * D5 — Construction Management: the contractor's delivery of the works.
 *
 * The consultant-side sources (PROCSA, SACQSP) describe what the team does *to* the contractor; this
 * domain is what the contractor does. Where a task restates a regulation or contract it says so;
 * the rest is general site practice and carries no reference rather than a borrowed one.
 */

import { SOURCES as S, sub, task as t } from "./build";
import type { Area } from "./types";

export const D5: readonly Area[] = [
  {
    code: "D5.1",
    name: "Site Establishment & Mobilisation",
    domain: "D5",
    phase: 4,
    purpose: "Take possession of the site and set it up to build safely and legally.",
    subProcesses: [
      sub("D5.1-SP-001", "Mobilisation", "contractor", {
        purpose: "Establish the site, its services and its controls before work starts.",
        trigger: "Possession of the site is given",
        outcome: "An established site ready for construction",
        references: [S.CR2014],
        tasks: [
          t("T01", "Receive the site and record its condition", "contractor", "Attend the handover and record existing conditions and boundaries.", ["Site handover record"], ["Condition survey"], { with: ["pm"] }),
          t("T02", "Submit the health and safety plan", "contractor", "Prepare a site-specific health and safety plan from the client's specification for approval.", ["Health and safety specification", "Baseline risk assessment"], ["Health and safety plan"], { with: ["hs"], references: [S.CR2014] }),
          t("T03", "Set out the works", "contractor", "Set out the buildings and levels from the survey control.", ["Setting-out drawings", "Survey control"], ["Set-out works"], { with: ["survey"] }),
          t("T04", "Establish site facilities and temporary services", "contractor", "Erect site offices, ablutions, hoarding, water and power.", ["Site layout plan"], ["Site establishment"]),
          t("T05", "Provide contract securities and insurances", "contractor", "Provide the guarantees and insurances the contract requires.", ["Contract data"], ["Guarantees and insurance certificates"], { with: ["qs"], references: [S.JBCC] }),
        ],
        gateway: {
          question: "Is the health and safety plan approved?",
          yes: "Start construction work",
          no: "Revise the plan — construction work may not start without it",
          after: "T02",
        },
      }),
    ],
  },
  {
    code: "D5.2",
    name: "Construction Planning & Resourcing",
    domain: "D5",
    phase: 4,
    purpose: "Plan the sequence of the works and resource it with labour, plant and materials to meet the programme.",
    subProcesses: [
      sub("D5.2-SP-001", "Programme & Resource Planning", "contractor", {
        purpose: "Produce the construction programme and the resources to achieve it.",
        trigger: "The contract is awarded",
        outcome: "An approved construction programme and resource plan",
        references: [S.SACQSP],
        tasks: [
          t("T01", "Prepare the construction programme", "contractor", "Programme the activities, dependencies and critical path to the contract completion date.", ["Contract data", "Drawings"], ["Construction programme"], { references: [S.SACQSP] }),
          t("T02", "Plan labour and plant", "contractor", "Plan crews, plant and their deployment against the programme.", ["Construction programme"], ["Resource plan"]),
          t("T03", "Schedule procurement of materials", "contractor", "Schedule orders with lead times, especially long-lead items (D8.4).", ["Construction programme", "Specifications"], ["Procurement schedule"], { with: ["sub"] }),
          t("T04", "Submit the programme for approval", "contractor", "Submit the programme to the principal agent.", ["Construction programme"], ["Programme submission"], { with: ["pm"] }),
        ],
      }),
      sub("D5.2-SP-002", "Short-term Planning & Daily Records", "contractor", {
        purpose: "Plan each week's work and keep the daily records that later prove what happened.",
        trigger: "Every week during construction",
        outcome: "A look-ahead plan and complete site diary",
        tasks: [
          t("T01", "Prepare the look-ahead programme", "contractor", "Break the next weeks into tasks, crews and information needed.", ["Construction programme"], ["Look-ahead programme"]),
          t("T02", "Keep the site diary", "contractor", "Record weather, labour, plant, deliveries, visitors, instructions and delays daily.", ["Site activity"], ["Site diary"]),
          t("T03", "Report progress to the site meeting", "contractor", "Report actual against planned progress and information required.", ["Site diary", "Look-ahead programme"], ["Contractor's progress report"], { with: ["pm"] }),
        ],
      }),
    ],
  },
  {
    code: "D5.3",
    name: "Subcontractor & Supplier Management",
    domain: "D5",
    phase: 4,
    purpose: "Appoint, coordinate and pay the subcontractors and suppliers who carry out most of the work.",
    subProcesses: [
      sub("D5.3-SP-001", "Subcontract Appointment & Coordination", "contractor", {
        purpose: "Appoint subcontractors and coordinate them into one programme.",
        trigger: "A package is due for appointment on the procurement schedule",
        outcome: "Subcontractors appointed and working to programme",
        references: [S.PROCSA, S.JBCC],
        tasks: [
          t("T01", "Receive instruction to appoint nominated or selected subcontractors", "contractor", "Receive the principal agent's instruction to appoint.", ["Contract instruction"], ["Instruction to appoint"], { with: ["pm"], references: [S.PROCSA] }),
          t("T02", "Appoint domestic subcontractors", "contractor", "Appoint subcontractors for the packages the contractor sublets.", ["Subcontract quotations"], ["Subcontract agreements"], { with: ["sub"] }),
          t("T03", "Coordinate subcontractors on site", "contractor", "Coordinate access, sequencing, attendance and interfaces.", ["Construction programme"], ["Coordination meeting records"], { with: ["sub"] }),
          t("T04", "Pay subcontractors as certified", "contractor", "Issue subcontract payment advices and pay amounts included in payment certificates.", ["Payment certificate", "Subcontract payment notifications"], ["Subcontract payment advices"], { with: ["sub"], references: [S.JBCC] }),
        ],
      }),
    ],
  },
  {
    code: "D5.4",
    name: "Quality Management",
    domain: "D5",
    phase: 4,
    purpose: "Build to the specification the first time, and prove it with records.",
    subProcesses: [
      sub("D5.4-SP-001", "Quality Control Plan & Inspections", "contractor", {
        purpose: "Plan, inspect and record quality at every hold point.",
        trigger: "Construction starts",
        outcome: "Signed-off inspection and test records for the works",
        references: [S.SACQSP],
        tasks: [
          t("T01", "Agree quality assurance procedures", "contractor", "Agree the quality plan, hold points and records with the principal agent.", ["Specifications"], ["Quality plan"], { with: ["pm"], references: [S.SACQSP] }),
          t("T02", "Inspect work before notifying the consultants", "contractor", "Carry out internal inspections before calling for consultant inspection.", ["Quality plan"], ["Internal inspection records"]),
          t("T03", "Carry out required tests", "contractor", "Carry out material and workmanship tests at the specified frequency.", ["Quality plan"], ["Test results"], { with: ["sub"] }),
          t("T04", "Record and close non-conformances", "contractor", "Record non-conforming work, rectify and close it out.", ["Inspection records", "Consultant instructions"], ["Non-conformance register"]),
        ],
      }),
    ],
  },
  {
    code: "D5.5",
    name: "Site Health, Safety & Environment",
    domain: "D5",
    phase: 4,
    purpose: "Keep people safe and the environment protected for the whole construction period.",
    subProcesses: [
      sub("D5.5-SP-001", "Health & Safety Management", "contractor", {
        purpose: "Implement and maintain the health and safety plan and file.",
        trigger: "The health and safety plan is approved",
        outcome: "A maintained health and safety file and audit record",
        references: [S.CR2014],
        tasks: [
          t("T01", "Induct workers and visitors", "contractor", "Induct everyone entering the site on its hazards and rules.", ["Health and safety plan"], ["Induction register"], { references: [S.CR2014] }),
          t("T02", "Carry out risk assessments for activities", "contractor", "Assess the risk of each activity and issue safe work procedures.", ["Health and safety plan"], ["Activity risk assessments"], { references: [S.CR2014] }),
          t("T03", "Inspect and record incidents", "contractor", "Carry out inspections and record and investigate incidents.", ["Site activity"], ["Inspection and incident records"], { references: [S.CR2014] }),
          t("T04", "Submit to health and safety audits", "hs", "Audit the contractor's compliance with the plan at agreed intervals.", ["Health and safety file"], ["Audit report"], { with: ["contractor", "pm"], references: [S.CR2014] }),
          t("T05", "Maintain the health and safety file", "contractor", "Keep the file current for handover at completion.", ["All H&S records"], ["Health and safety file"], { references: [S.CR2014] }),
        ],
        gateway: {
          question: "Did the audit find non-compliance?",
          yes: "Correct within the period required; stop the activity if there is imminent danger",
          no: "Continue",
          after: "T04",
        },
      }),
      sub("D5.5-SP-002", "Environmental Management", "contractor", {
        purpose: "Implement the environmental management programme and the conditions of any authorisation.",
        trigger: "An environmental authorisation or EMPr applies to the site",
        outcome: "Environmental compliance records for the construction period",
        references: [S.NEMA, S.SACQSP],
        tasks: [
          t("T01", "Implement the environmental management programme", "contractor", "Implement the EMPr controls for dust, water, waste, noise and protected areas.", ["Environmental management programme"], ["EMPr implementation records"], { references: [S.NEMA] }),
          t("T02", "Monitor compliance", "env", "Carry out environmental control officer inspections.", ["EMPr", "Authorisation conditions"], ["ECO inspection reports"], { with: ["contractor"], references: [S.NEMA] }),
          t("T03", "Report to the authority where required", "env", "Submit the compliance reports the authorisation requires.", ["ECO inspection reports"], ["Environmental audit report"], { with: ["authority"], references: [S.NEMA] }),
        ],
      }),
    ],
  },
  {
    code: "D5.6",
    name: "Snagging & Defects Rectification",
    domain: "D5",
    phase: 5,
    purpose: "Complete outstanding work and rectify defects to reach practical and then final completion.",
    subProcesses: [
      sub("D5.6-SP-001", "Snagging to Practical Completion", "contractor", {
        purpose: "Inspect the works and clear defects before calling for the practical completion inspection.",
        trigger: "The works are nearing completion",
        outcome: "Notice to the principal agent that the works are ready for inspection",
        references: [S.JBCC],
        tasks: [
          t("T01", "Inspect the works internally", "contractor", "Inspect the works to satisfy yourself the specified degree of completion is achieved.", ["Specifications", "Practical completion criteria"], ["Internal snag list"], { references: [S.JBCC] }),
          t("T02", "Clear the internal snag list", "contractor", "Rectify the defects and complete outstanding work.", ["Internal snag list"], ["Cleared snag list"], { with: ["sub"] }),
          t("T03", "Give notice for the practical completion inspection", "contractor", "Give the principal agent timely notice to inspect on or before the anticipated date.", ["Cleared snag list"], ["Notice of readiness"], { with: ["pm"], references: [S.JBCC] }),
          t("T04", "Rectify items on the list for practical completion", "contractor", "Rectify what the principal agent listed and request re-inspection.", ["List for practical completion"], ["Rectified works"], { references: [S.JBCC] }),
        ],
      }),
      sub("D5.6-SP-002", "Defects Rectification to Final Completion", "contractor", {
        purpose: "Rectify the list for completion and latent defects that appear during the defects liability period.",
        trigger: "Practical completion is certified",
        outcome: "Defects rectified and final completion inspection requested",
        references: [S.JBCC],
        tasks: [
          t("T01", "Rectify the list for completion", "contractor", "Rectify the items on the list issued with the certificate of practical completion.", ["List for completion"], ["Rectification record"], { with: ["sub"], references: [S.JBCC] }),
          t("T02", "Give notice for the final inspection", "contractor", "Give notice at least ten working days before the defects liability period ends.", ["Rectification record"], ["Notice for final inspection"], { with: ["pm"], references: [S.JBCC] }),
          t("T03", "Rectify the list for final completion", "contractor", "Rectify remaining and latent defects on the list for final completion.", ["List for final completion"], ["Rectified works"], { references: [S.JBCC] }),
        ],
      }),
    ],
  },
];
