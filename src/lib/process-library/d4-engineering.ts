/** D4 — Engineering. The PROCSA structural, civil, electrical and mechanical engineer activities. */

import { SOURCES as S, sub, task as t } from "./build";
import type { Area } from "./types";

export const D4: readonly Area[] = [
  {
    code: "D4.1",
    name: "Site Investigation & Surveys",
    domain: "D4",
    phase: 1,
    purpose: "Find out what is under and on the site before the design depends on it.",
    subProcesses: [
      sub("D4.1-SP-001", "Surveys & Geotechnical Investigation", "geo", {
        purpose: "Establish the ground conditions, levels and existing services the design must respond to.",
        trigger: "The engineers advise which surveys and investigations stage 2 will need",
        outcome: "Survey and geotechnical reports issued to the design team",
        references: [S.PROCSA],
        tasks: [
          t("T01", "Advise on necessary surveys and investigations", "civil", "Advise which surveys, tests and investigations are needed, including infrastructure availability.", ["Project brief", "Site information"], ["Investigation scope"], { with: ["struct", "geo"], references: [S.PROCSA] }),
          t("T02", "Commission the topographical and contour survey", "survey", "Survey the site's levels, features and boundaries.", ["Investigation scope", "SG diagram"], ["Topographical and contour survey"]),
          t("T03", "Carry out the geotechnical investigation", "geo", "Excavate test pits or boreholes, sample and test the soils.", ["Investigation scope", "Survey"], ["Geotechnical test results"]),
          t("T04", "Report founding conditions and site classification", "geo", "Report founding recommendations, site class and risks such as dolomite or heaving clay.", ["Geotechnical test results"], ["Geotechnical report"], { with: ["struct"] }),
          t("T05", "Locate existing services", "civil", "Establish the location and capacity of existing services on and near the site.", ["Municipal records", "Survey"], ["Existing services record"]),
        ],
        gateway: {
          question: "Do the ground conditions require special foundations or further investigation?",
          yes: "Add further investigation and allow for special foundations in the estimate",
          no: "Design on standard founding",
          after: "T04",
        },
      }),
    ],
  },
  {
    code: "D4.2",
    name: "Civil & Structural Design",
    domain: "D4",
    phase: 2,
    purpose: "Design the structure and civil works to be safe, compliant, coordinated and within budget.",
    subProcesses: [
      sub("D4.2-SP-001", "Concept & Preliminary Engineering Design", "struct", {
        purpose: "Set design criteria and prepare preliminary designs suitable for approval and costing.",
        trigger: "The concept design starts",
        outcome: "Preliminary designs approved and suitable for estimating",
        references: [S.PROCSA],
        tasks: [
          t("T01", "Establish concept design criteria", "struct", "Set loads, systems, codes and performance criteria.", ["Brief", "Geotechnical report"], ["Design criteria"], { references: [S.PROCSA] }),
          t("T02", "Establish authority requirements", "civil", "Establish the regulatory authorities' requirements and incorporate them.", ["Design criteria"], ["Authority requirements"], { with: ["authority"], references: [S.PROCSA] }),
          t("T03", "Establish access, utilities and connections", "civil", "Establish access, utilities, services and connections the design needs.", ["Existing services record"], ["Connections schedule"], { references: [S.PROCSA] }),
          t("T04", "Prepare preliminary designs for approval and costing", "struct", "Prepare preliminary designs for the client and authorities and suitable for estimates.", ["Design criteria", "Architect's concept"], ["Preliminary engineering design"], { with: ["qs", "arch"], references: [S.PROCSA] }),
        ],
      }),
      sub("D4.2-SP-002", "Detailed Engineering Design & Documentation", "struct", {
        purpose: "Develop and document the engineering design for approval, measurement and construction.",
        trigger: "Preliminary designs are approved",
        outcome: "Engineering working drawings and specifications issued",
        references: [S.PROCSA, S.SANS10400],
        tasks: [
          t("T01", "Prepare design development drawings", "struct", "Prepare drawings with draft technical details and specifications.", ["Preliminary design", "Architect's design development"], ["Engineering design development"], { references: [S.PROCSA] }),
          t("T02", "Submit design documentation for approval", "struct", "Submit the engineering documentation to the local authority.", ["Engineering design development"], ["Engineering submission"], { with: ["authority"], references: [S.PROCSA] }),
          t("T03", "Prepare working drawings and specifications", "civil", "Prepare working drawings and specifications and agree preambles with the QS.", ["Approved design"], ["Engineering working drawings", "Engineering specifications"], { with: ["qs"], references: [S.PROCSA] }),
          t("T04", "Check the estimate with the QS", "struct", "Check the cost estimate and adjust documents to remain within budget.", ["Engineering working drawings", "Estimate"], ["Budget-compliant engineering documents"], { with: ["qs"], references: [S.PROCSA] }),
        ],
      }),
    ],
  },
  {
    code: "D4.3",
    name: "Building Services Design",
    domain: "D4",
    phase: 2,
    purpose: "Design the electrical, mechanical, fire and wet services, with their costs and life-cycle costs.",
    subProcesses: [
      sub("D4.3-SP-001", "Services Design & Coordination", "elec", {
        purpose: "Design the building services and coordinate them with the architecture and structure.",
        trigger: "The concept design starts",
        outcome: "Coordinated services working drawings and specifications",
        references: [S.PROCSA, S.SANS10400],
        tasks: [
          t("T01", "Establish utilities and connections", "elec", "Establish supply capacities and connections required.", ["Brief", "Utility information"], ["Services connections schedule"], { with: ["mech"], references: [S.PROCSA] }),
          t("T02", "Prepare preliminary services designs", "mech", "Prepare preliminary electrical and mechanical designs suitable for costing.", ["Concept design"], ["Preliminary services designs"], { with: ["elec"], references: [S.PROCSA] }),
          t("T03", "Provide cost estimates and life-cycle costs", "elec", "Estimate installation and life-cycle costs of the services for the QS.", ["Preliminary services designs"], ["Services cost and life-cycle estimate"], { with: ["mech", "qs"], references: [S.PROCSA] }),
          t("T04", "Coordinate services with other consultants", "mech", "Coordinate routes, plant space and interfaces.", ["Architect's design", "Structural design"], ["Services coordination"], { with: ["arch", "struct"], references: [S.PROCSA] }),
          t("T05", "Prepare services working drawings and specifications", "elec", "Document the services and agree preambles with the QS.", ["Services coordination"], ["Services working drawings", "Services specifications"], { with: ["mech", "qs"], references: [S.PROCSA] }),
        ],
      }),
      sub("D4.3-SP-002", "Energy & Regulatory Compliance", "mech", {
        purpose: "Show the design meets the energy, fire and ventilation requirements of the building regulations.",
        trigger: "Services design development",
        outcome: "Compliance calculations submitted with the building plans",
        references: [S.SANS10400],
        tasks: [
          t("T01", "Assess energy usage compliance", "mech", "Assess the design against the energy usage requirements, by deemed-to-satisfy or rational design.", ["Design development drawings"], ["Energy compliance assessment"], { with: ["arch"], references: [S.SANS10400] }),
          t("T02", "Design fire protection and ventilation", "mech", "Design fire detection, protection and ventilation to the regulations.", ["Design development drawings"], ["Fire and ventilation design"], { references: [S.SANS10400] }),
          t("T03", "Issue compliance documentation for submission", "mech", "Prepare the certificates and calculations for the building plan submission.", ["Energy assessment", "Fire design"], ["Services compliance documents"], { with: ["arch"] }),
        ],
      }),
    ],
  },
  {
    code: "D4.4",
    name: "Bulk Services & Municipal Engineering",
    domain: "D4",
    phase: 1,
    purpose: "Secure water, sewer, stormwater, roads and electricity capacity from the authorities, and establish what it will cost the developer.",
    subProcesses: [
      sub("D4.4-SP-001", "Bulk Services Capacity & Contributions", "civil", {
        purpose: "Confirm bulk capacity and agree the contributions and connection conditions.",
        trigger: "The development yield is known",
        outcome: "A bulk services agreement or confirmed capacity and contributions",
        references: [S.PROCSA],
        tasks: [
          t("T01", "Calculate the development's demand", "civil", "Calculate water demand, sewer flow, stormwater run-off, trips and electrical load.", ["Development yield", "Unit mix"], ["Services demand calculations"], { with: ["elec"] }),
          t("T02", "Obtain capacity confirmation", "civil", "Request confirmation of bulk capacity from the municipality and utilities.", ["Services demand calculations"], ["Capacity confirmation"], { with: ["authority"] }),
          t("T03", "Prepare the services reports", "civil", "Prepare the bulk water, sewer, stormwater, roads and electrical services reports.", ["Capacity confirmation"], ["Services reports"], { with: ["elec"] }),
          t("T04", "Estimate bulk contributions and upgrades", "civil", "Estimate the development charges and any upgrades the developer must fund.", ["Services reports", "Development charges policy"], ["Bulk contributions estimate"], { with: ["qs"] }),
          t("T05", "Negotiate the services agreement", "dm", "Agree contributions, credits for installed infrastructure and conditions with the authority.", ["Bulk contributions estimate"], ["Services agreement"], { with: ["civil", "authority"] }),
          t("T06", "Formalise service agreements and deposits", "dm", "Formalise the agreements with the authorities and pay the deposits.", ["Services agreement"], ["Signed service agreements"], { references: [S.PROCSA] }),
        ],
        gateway: {
          question: "Is bulk capacity available without upgrades?",
          yes: "Pay the standard contributions and proceed",
          no: "Cost the upgrades, negotiate responsibility and credits, and re-test viability (D1.1)",
          after: "T02",
        },
      }),
    ],
  },
  {
    code: "D4.5",
    name: "Engineering Inspection & Testing",
    domain: "D4",
    phase: 4,
    purpose: "Inspect engineered work at the stages that matter, witness tests, and approve interim valuations for the engineering packages.",
    subProcesses: [
      sub("D4.5-SP-001", "Stage Inspections & Tests", "struct", {
        purpose: "Inspect foundations, reinforcement, structure and services before they are covered, and witness tests.",
        trigger: "The contractor gives notice that work is ready for inspection",
        outcome: "Inspection approval or instruction to rectify",
        references: [S.PROCSA],
        tasks: [
          t("T01", "Inspect work before it is covered", "struct", "Inspect founding, reinforcement and structural elements at the agreed hold points.", ["Inspection notice", "Engineering drawings"], ["Inspection record"], { with: ["contractor"], references: [S.PROCSA] }),
          t("T02", "Witness and review tests", "civil", "Witness cube tests, compaction tests, pressure tests and similar.", ["Test programme"], ["Test certificates"], { with: ["contractor"], references: [S.PROCSA] }),
          t("T03", "Instruct rectification of non-conforming work", "struct", "Instruct rectification through the principal agent.", ["Inspection record"], ["Rectification instruction"], { with: ["pm"], references: [S.PROCSA] }),
          t("T04", "Approve interim payment valuations", "civil", "Receive, comment and approve interim valuations for the engineering work.", ["Interim valuation"], ["Engineer's valuation approval"], { with: ["qs"], references: [S.PROCSA] }),
        ],
        gateway: {
          question: "Does the work conform to the drawings and specification?",
          yes: "Approve and allow the work to be covered",
          no: "Instruct rectification and re-inspect",
          after: "T01",
        },
      }),
    ],
  },
  {
    code: "D4.6",
    name: "Testing & Commissioning",
    domain: "D4",
    phase: 5,
    purpose: "Prove the installations work as designed before the user relies on them.",
    subProcesses: [
      sub("D4.6-SP-001", "Services Commissioning", "mech", {
        purpose: "Commission the building services and obtain the compliance certificates.",
        trigger: "Installations are complete",
        outcome: "Commissioning records and statutory certificates obtained",
        references: [S.PROCSA],
        tasks: [
          t("T01", "Agree the commissioning programme", "mech", "Agree what is tested, in which order, and who witnesses it.", ["Specifications", "Programme"], ["Commissioning programme"], { with: ["elec", "contractor"] }),
          t("T02", "Provide operator input to early commissioning", "dm", "Provide the operator's input to testing and commissioning.", ["Commissioning programme"], ["Operator input"], { with: ["fm"], references: [S.PROCSA] }),
          t("T03", "Witness commissioning", "elec", "Witness mock-ups, tests and commissioning of the services.", ["Commissioning programme"], ["Commissioning records"], { with: ["mech", "sub"], references: [S.PROCSA] }),
          t("T04", "Obtain compliance certificates", "contractor", "Obtain the electrical certificate of compliance, fire and plumbing certificates.", ["Commissioning records"], ["Compliance certificates"], { with: ["elec", "sub"] }),
          t("T05", "Inspect and issue practical completion lists", "elec", "Inspect the installations and issue practical completion and defects lists.", ["Commissioning records"], ["Services defects lists"], { with: ["mech"], references: [S.PROCSA] }),
        ],
        gateway: {
          question: "Did every system pass its commissioning test?",
          yes: "Accept and include certificates in the record information",
          no: "Rectify and re-test before practical completion",
          after: "T03",
        },
      }),
    ],
  },
];
