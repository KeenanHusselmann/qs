/**
 * D7 — Compliance & Regulatory. The statutory permissions a South African project cannot proceed
 * without. Time limits are stated only where the source was read: the Building Standards Act s7
 * decision periods and lapse, the NHBRC's fifteen-day enrolment rule and five-year structural
 * warranty, and the client's duties under Construction Regulation 5. Where a threshold was not
 * verified (such as when a construction work permit is required), the task names the obligation
 * and leaves the number to the regulation.
 */

import { SOURCES as S, sub, task as t } from "./build";
import type { Area } from "./types";

export const D7: readonly Area[] = [
  {
    code: "D7.1",
    name: "Land Use Rights & Building Plan Approval",
    domain: "D7",
    phase: 1,
    purpose: "Obtain the right to use the land as intended, and the municipality's approval of the building plans.",
    subProcesses: [
      sub("D7.1-SP-001", "Zoning & Land-Use Rights", "planner", {
        purpose: "Apply for the rezoning, consent use, subdivision or relaxation the development needs.",
        trigger: "The site analysis shows the current rights do not permit the development",
        outcome: "Land use rights approved with conditions, or refused",
        references: [S.SPLUMA],
        tasks: [
          t("T01", "Hold a pre-application consultation", "planner", "Consult the municipality's planning department on the intended application.", ["Site analysis", "Concept"], ["Pre-application minutes"], { with: ["authority"] }),
          t("T02", "Prepare the land use application", "planner", "Prepare the motivation, plans and specialist reports the municipal planning by-law requires.", ["Site development plan", "Services reports", "Traffic impact assessment"], ["Land use application"], { with: ["civil", "arch"], references: [S.SPLUMA] }),
          t("T03", "Advertise and give notice", "planner", "Give public notice and notify interested parties as the by-law requires.", ["Land use application"], ["Proof of notice"], { references: [S.SPLUMA] }),
          t("T04", "Respond to objections and comments", "planner", "Respond to objections and comments from the public and departments.", ["Objections", "Departmental comments"], ["Response report"]),
          t("T05", "Obtain the decision", "authority", "The municipal planning tribunal or authorised official decides the application.", ["Application", "Response report"], ["Land use decision and conditions"], { references: [S.SPLUMA] }),
          t("T06", "Comply with the conditions of approval", "planner", "Record the conditions and see they are met before rights are exercised.", ["Land use decision"], ["Conditions compliance register"], { with: ["civil", "dm"] }),
        ],
        gateway: {
          question: "Are the land use rights approved?",
          yes: "Proceed, meeting the conditions of approval",
          no: "Appeal, amend the application, or revise the development",
          after: "T05",
        },
      }),
      sub("D7.1-SP-002", "Building Plan Approval", "arch", {
        purpose: "Obtain approval to erect the building under the National Building Regulations.",
        trigger: "The building plan submission is lodged (D3.3)",
        outcome: "Approved building plans endorsed by the local authority",
        references: [S.NBR, S.SANS10400],
        tasks: [
          t("T01", "Lodge the application with the local authority", "arch", "Lodge the plans, specifications and documents and record the date received.", ["Building plan submission"], ["Application reference"], { with: ["authority"], references: [S.NBR] }),
          t("T02", "Obtain departmental comments", "authority", "The building control officer circulates the application and makes a recommendation.", ["Application"], ["Building control officer's recommendation"], { references: [S.NBR] }),
          t("T03", "Respond to amendments", "arch", "Amend the plans for any compliance comments and resubmit.", ["Recommendation comments"], ["Amended plans"], { with: ["struct", "mech"] }),
          t("T04", "Obtain the decision", "authority", "The local authority grants or refuses approval — within 30 days for a building under 500 m² and 60 days for 500 m² or more.", ["Application", "Recommendation"], ["Approval or refusal with reasons"], { references: [S.NBR] }),
          t("T05", "Record the approval's lapse date", "pm", "Record that the approval lapses after 12 months unless erection has commenced or the period is extended.", ["Approved plans"], ["Approval validity record"], { references: [S.NBR] }),
        ],
        gateway: {
          question: "Are the plans approved?",
          yes: "Endorsed plans may be built; construction must start within 12 months",
          no: "Amend and resubmit within the period the Act allows",
          after: "T04",
        },
      }),
    ],
  },
  {
    code: "D7.2",
    name: "NHBRC Registration & Enrolment",
    domain: "D7",
    phase: 2,
    purpose: "Register the home builder and enrol every new home with the NHBRC, so the homes are inspected and covered by the warranty.",
    subProcesses: [
      sub("D7.2-SP-001", "Enrolment Application", "contractor", {
        purpose: "Enrol each new home before construction starts.",
        trigger: "A residential project's plans and programme are settled",
        outcome: "Enrolment certificates issued for the homes",
        references: [S.NHBRC],
        tasks: [
          t("T01", "Confirm the builder's registration", "contractor", "Confirm the home builder is registered with the NHBRC.", ["Builder details"], ["Registration confirmation"], { references: [S.NHBRC] }),
          t("T02", "Compile the enrolment documents", "contractor", "Compile approved plans, geotechnical report, engineer's appointment and the home values.", ["Approved plans", "Geotechnical report", "Engineer's appointment"], ["Enrolment pack"], { with: ["geo", "struct"] }),
          t("T03", "Apply for enrolment at least 15 days before construction", "contractor", "Submit the enrolment application no later than 15 days before construction starts.", ["Enrolment pack"], ["Enrolment application"], { with: ["authority"], references: [S.NHBRC] }),
          t("T04", "Pay the enrolment fee", "dm", "Pay the fee scaled to the value of the homes.", ["Enrolment application"], ["Proof of payment"], { references: [S.NHBRC] }),
          t("T05", "Receive the enrolment certificates", "contractor", "Receive the certificates and file them with the project records.", ["Proof of payment"], ["Enrolment certificates"], { references: [S.NHBRC] }),
        ],
      }),
      sub("D7.2-SP-002", "Inspection Schedule", "contractor", {
        purpose: "Allow the NHBRC's inspections at key construction stages.",
        trigger: "Enrolment is confirmed",
        outcome: "Inspections recorded for each enrolled home",
        references: [S.NHBRC],
        tasks: [
          t("T01", "Agree the inspection stages", "contractor", "Agree the stages at which the inspector will call.", ["Enrolment certificates", "Programme"], ["Inspection schedule"], { with: ["authority"] }),
          t("T02", "Notify the inspector at each stage", "contractor", "Notify the NHBRC inspector when each stage is ready.", ["Inspection schedule"], ["Inspection requests"]),
          t("T03", "Rectify non-compliance", "contractor", "Rectify anything the inspector finds and record the re-inspection.", ["Inspection reports"], ["Rectification record"], { with: ["struct"] }),
        ],
      }),
    ],
  },
  {
    code: "D7.3",
    name: "Environmental Authorisation",
    domain: "D7",
    phase: 1,
    purpose: "Establish whether listed activities trigger environmental authorisation, and obtain it before they start.",
    subProcesses: [
      sub("D7.3-SP-001", "Environmental Screening & Authorisation", "env", {
        purpose: "Screen the development against the listed activities and run the required assessment process.",
        trigger: "The site and development are defined",
        outcome: "Environmental authorisation granted, or confirmation that none is required",
        references: [S.NEMA],
        tasks: [
          t("T01", "Screen for listed activities", "env", "Screen the development and site against the listed activities and sensitivities.", ["Site information", "Development description"], ["Screening report"], { references: [S.NEMA] }),
          t("T02", "Determine the assessment route", "env", "Determine whether a basic assessment or scoping and EIA applies.", ["Screening report"], ["Assessment route"], { references: [S.NEMA] }),
          t("T03", "Commission specialist studies", "env", "Commission the specialist studies the assessment needs.", ["Assessment route"], ["Specialist studies"], { with: ["geo", "civil"] }),
          t("T04", "Run public participation", "env", "Run the public participation process the regulations require.", ["Draft report"], ["Public participation record"], { references: [S.NEMA] }),
          t("T05", "Submit the report and EMPr", "env", "Submit the final report and environmental management programme to the competent authority.", ["Specialist studies", "Public participation record"], ["Application submission"], { with: ["authority"], references: [S.NEMA] }),
          t("T06", "Receive the decision", "authority", "The competent authority grants or refuses authorisation with conditions.", ["Application submission"], ["Environmental authorisation"], { references: [S.NEMA] }),
        ],
        gateway: {
          question: "Does the development trigger a listed activity?",
          yes: "Run the assessment before the activity starts",
          no: "Record the screening outcome and proceed",
          after: "T01",
        },
      }),
    ],
  },
  {
    code: "D7.4",
    name: "Construction Health & Safety Compliance",
    domain: "D7",
    phase: 3,
    purpose: "Meet the client's duties under the Construction Regulations before and during construction.",
    subProcesses: [
      sub("D7.4-SP-001", "Client Health & Safety Duties", "hs", {
        purpose: "Prepare the baseline risk assessment and health and safety specification, and see they reach the designer and tenderers.",
        trigger: "Design starts, and before procurement",
        outcome: "A health and safety specification included in the tender and a compliant appointment",
        references: [S.CR2014, S.PROCSA],
        tasks: [
          t("T01", "Prepare the baseline risk assessment", "hs", "Identify the hazards of the intended construction work.", ["Project description", "Site information"], ["Baseline risk assessment"], { with: ["client"], references: [S.CR2014] }),
          t("T02", "Prepare the health and safety specification", "hs", "Prepare a site-specific specification based on the baseline risk assessment.", ["Baseline risk assessment"], ["Health and safety specification"], { references: [S.CR2014] }),
          t("T03", "Provide the specification to the designer", "client", "Provide the designer with the health and safety specification.", ["Health and safety specification"], ["Designer notification"], { with: ["arch", "struct"], references: [S.CR2014] }),
          t("T04", "Include the specification in the tender", "qs", "Include the specification in the tender so tenderers price compliance.", ["Health and safety specification"], ["Tender H&S requirements"], { references: [S.CR2014] }),
          t("T05", "Obtain a construction work permit where required", "client", "Apply for a construction work permit where the project falls within the regulation's thresholds.", ["Project value and duration"], ["Construction work permit"], { with: ["hs"], references: [S.CR2014] }),
        ],
      }),
      sub("D7.4-SP-002", "Health & Safety Plan Approval & Audit", "hs", {
        purpose: "Approve the contractor's plan before work starts and audit its implementation.",
        trigger: "The contractor submits the health and safety plan",
        outcome: "An approved plan and periodic audit reports",
        references: [S.CR2014, S.SACQSP],
        tasks: [
          t("T01", "Review the contractor's health and safety plan", "hs", "Review the plan against the specification.", ["Contractor's H&S plan", "Health and safety specification"], ["Plan review"], { with: ["pm"], references: [S.SACQSP] }),
          t("T02", "Approve or return the plan", "hs", "Approve the plan or return it for correction.", ["Plan review"], ["Approved H&S plan"], { references: [S.CR2014] }),
          t("T03", "Audit implementation", "hs", "Audit the contractor's compliance at agreed intervals.", ["Approved H&S plan"], ["Audit reports"], { with: ["contractor"], references: [S.CR2014] }),
          t("T04", "Receive the health and safety file at completion", "hs", "Receive the completed file for handover to the client.", ["Health and safety file"], ["Accepted H&S file"], { with: ["dm"], references: [S.PROCSA] }),
        ],
        gateway: {
          question: "Does the plan meet the specification?",
          yes: "Approve; construction may start",
          no: "Return for correction",
          after: "T01",
        },
      }),
    ],
  },
  {
    code: "D7.5",
    name: "Occupation & Statutory Certificates",
    domain: "D7",
    phase: 5,
    purpose: "Obtain the certificates that allow the building to be lawfully occupied and used.",
    subProcesses: [
      sub("D7.5-SP-001", "Certificate of Occupancy", "arch", {
        purpose: "Apply for and obtain the local authority's certificate of occupancy.",
        trigger: "Practical completion approaches",
        outcome: "A certificate of occupancy issued",
        references: [S.NBR, S.JBCC, S.PROCSA],
        tasks: [
          t("T01", "Collect the compliance certificates", "pm", "Collect the electrical, plumbing, glazing, fire and engineers' completion certificates.", ["Commissioning records"], ["Compliance certificate set"], { with: ["contractor", "struct", "elec"], references: [S.PROCSA] }),
          t("T02", "Apply for the certificate of occupancy", "arch", "Submit the application and certificates to the local authority.", ["Compliance certificate set", "Approved plans"], ["Occupancy application"], { with: ["authority"], references: [S.NBR] }),
          t("T03", "Attend the building control inspection", "arch", "Accompany the building control officer's final inspection.", ["Occupancy application"], ["Inspection outcome"], { with: ["authority", "contractor"] }),
          t("T04", "Receive the certificate of occupancy", "authority", "The local authority issues the certificate of occupancy.", ["Inspection outcome"], ["Certificate of occupancy"], { references: [S.NBR] }),
          t("T05", "Distribute statutory certificates", "dm", "Distribute the certificates to the parties who need them.", ["Certificate of occupancy", "Compliance certificate set"], ["Distributed certificates"], { references: [S.PROCSA] }),
        ],
        gateway: {
          question: "Does the building comply with the approved plans and regulations?",
          yes: "Issue the certificate of occupancy",
          no: "Rectify and request re-inspection — the building may not be occupied meanwhile",
          after: "T03",
        },
      }),
    ],
  },
  {
    code: "D7.6",
    name: "Warranty & Structural Defect Claims",
    domain: "D7",
    phase: 7,
    purpose: "Use the statutory warranty cover when a major structural defect appears in an enrolled home.",
    subProcesses: [
      sub("D7.6-SP-001", "NHBRC Warranty Claim", "fm", {
        purpose: "Lodge and pursue a claim for a major structural defect within the warranty period.",
        trigger: "A structural defect appears in an enrolled home",
        outcome: "The defect remedied by the builder or under the warranty scheme",
        references: [S.NHBRC],
        tasks: [
          t("T01", "Confirm the home is enrolled and within cover", "fm", "Confirm enrolment and that the defect falls within the five-year structural warranty from occupation.", ["Enrolment certificate", "Occupation date"], ["Cover confirmation"], { references: [S.NHBRC] }),
          t("T02", "Notify the builder", "client", "Notify the home builder to remedy the defect.", ["Defect record"], ["Notice to builder"], { with: ["contractor"] }),
          t("T03", "Lodge the complaint with the NHBRC", "client", "Lodge the complaint where the builder does not remedy the defect.", ["Notice to builder", "Cover confirmation"], ["NHBRC complaint"], { with: ["authority"], references: [S.NHBRC] }),
          t("T04", "Support the NHBRC assessment", "fm", "Give access and records for the NHBRC's assessment of the defect.", ["NHBRC complaint"], ["Assessment outcome"], { with: ["struct", "authority"] }),
          t("T05", "Record the remedy", "fm", "Record the remedial work in the asset and warranty registers.", ["Assessment outcome"], ["Updated warranty register"]),
        ],
      }),
    ],
  },
];
