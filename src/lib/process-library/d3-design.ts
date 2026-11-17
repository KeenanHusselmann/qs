/** D3 — Architecture & Design. Largely the PROCSA architect activities, stage by stage. */

import { SOURCES as S, sub, task as t } from "./build";
import type { Area } from "./types";

export const D3: readonly Area[] = [
  {
    code: "D3.1",
    name: "Briefing & Site Analysis",
    domain: "D3",
    phase: 1,
    purpose: "Understand what the client needs and what the site allows before anything is drawn.",
    subProcesses: [
      sub("D3.1-SP-001", "Client Brief Capture", "arch", {
        purpose: "Turn the client's requirements into a design brief the team can work to.",
        trigger: "The architect is appointed",
        outcome: "An agreed design brief and accommodation schedule",
        references: [S.PROCSA],
        tasks: [
          t("T01", "Attend project initiation meetings", "arch", "Meet the client and team to understand objectives and priorities.", ["Client vision"], ["Meeting notes"], { with: ["pm", "client"], references: [S.PROCSA] }),
          t("T02", "Assist in developing the project brief", "arch", "Contribute the functional, spatial and quality requirements to the brief.", ["User requirements"], ["Design brief input"], { references: [S.PROCSA] }),
          t("T03", "Prepare the accommodation schedule", "arch", "List the spaces, their areas and relationships.", ["Design brief input"], ["Accommodation schedule"], { with: ["qs"] }),
          t("T04", "Determine availability of data and drawings", "arch", "Establish what surveys, drawings and plans of the site already exist.", ["Site records"], ["Available information register"], { references: [S.PROCSA] }),
        ],
      }),
      sub("D3.1-SP-002", "Site Analysis & Zoning", "arch", {
        purpose: "Establish the site's rights, constraints and opportunities that will shape the design.",
        trigger: "A site is identified",
        outcome: "A site analysis with the development parameters",
        references: [S.PROCSA, S.SPLUMA],
        tasks: [
          t("T01", "Obtain the title deed, SG diagram and zoning certificate", "planner", "Collect the property's legal description, extent, servitudes and zoning.", ["Erf details"], ["Title deed, SG diagram, zoning certificate"], { with: ["survey"] }),
          t("T02", "Establish the development controls", "planner", "Read the land use scheme for permitted use, coverage, FAR, height, density and building lines.", ["Zoning certificate", "Land use scheme"], ["Development parameters"], { references: [S.SPLUMA] }),
          t("T03", "Advise on rights, constraints, consents and approvals", "arch", "Advise which rights exist and which must be applied for.", ["Development parameters"], ["Rights and approvals advice"], { with: ["planner"], references: [S.PROCSA] }),
          t("T04", "Analyse the site", "arch", "Record orientation, topography, access, views, services and neighbours.", ["Contour survey", "Locality plan"], ["Site analysis"], { with: ["civil", "survey"] }),
        ],
        gateway: {
          question: "Does the current zoning permit the intended development?",
          yes: "Design within the existing rights",
          no: "Apply for land use rights (D7.1) before or in parallel with design",
          after: "T02",
        },
      }),
    ],
  },
  {
    code: "D3.2",
    name: "Concept & Scheme Design",
    domain: "D3",
    phase: 2,
    purpose: "Find the design idea that meets the brief within the site's rights and the budget.",
    subProcesses: [
      sub("D3.2-SP-001", "Concept Design", "arch", {
        purpose: "Prepare a concept design based on the client's brief and the consultants' input.",
        trigger: "The brief and site analysis are approved",
        outcome: "A concept design presented for client approval",
        references: [S.PROCSA, S.FIDPM],
        tasks: [
          t("T01", "Agree the documentation programme", "arch", "Agree the documentation programme with the principal consultant and others.", ["Initiation programme"], ["Agreed documentation programme"], { with: ["pm"], references: [S.PROCSA] }),
          t("T02", "Prepare concept design options", "arch", "Develop alternative concepts that satisfy the brief and test them.", ["Design brief", "Site analysis"], ["Concept options"], { references: [S.FIDPM] }),
          t("T03", "Incorporate the consultants' input", "arch", "Consult the engineers and coordinate design interfaces.", ["Engineers' concept criteria"], ["Coordinated concept"], { with: ["struct", "civil", "elec", "mech"], references: [S.PROCSA] }),
          t("T04", "Confirm space norms and relationships", "arch", "Clarify space norms to optimise functional efficiency.", ["Accommodation schedule"], ["Space norms confirmation"], { references: [S.PROCSA] }),
          t("T05", "Select general materials and finishes", "arch", "Select intended construction materials and finishes so the QS can estimate.", ["Coordinated concept"], ["Materials and finishes outline"], { references: [S.PROCSA] }),
          t("T06", "Provide information for the construction cost estimate", "arch", "Issue the concept drawings and outline specification to the QS.", ["Coordinated concept", "Materials outline"], ["Estimate information set"], { with: ["qs"], references: [S.PROCSA] }),
          t("T07", "Present the concept to the client", "arch", "Present the concept design for approval.", ["Coordinated concept", "Elemental estimate"], ["Client-approved concept"], { with: ["client", "pm"], references: [S.PROCSA] }),
        ],
        gateway: {
          question: "Does the concept meet the brief within the estimate?",
          yes: "Proceed to scheme design and statutory discussions",
          no: "Revise the concept or the brief",
          after: "T06",
        },
      }),
      sub("D3.2-SP-002", "Scheme Design & Site Development Plan", "arch", {
        purpose: "Fix the scheme in enough detail for the authorities to comment and the site development plan to be submitted.",
        trigger: "The concept is approved",
        outcome: "A scheme design and site development plan submitted where required",
        references: [S.PROCSA, S.FIDPM],
        tasks: [
          t("T01", "Discuss the concept with the local authority", "arch", "Test the scheme informally with the municipality before submission.", ["Approved concept"], ["Authority comments"], { with: ["planner"], references: [S.PROCSA] }),
          t("T02", "Prepare the site development plan", "arch", "Draw the site layout with buildings, access, parking, services and landscaping.", ["Approved concept", "Civil layouts"], ["Site development plan"], { with: ["civil"], references: [S.FIDPM] }),
          t("T03", "Submit the site development plan", "arch", "Submit the SDP to the local authority where the land use scheme requires it.", ["Site development plan"], ["SDP submission"], { with: ["planner", "authority"], references: [S.PROCSA] }),
        ],
      }),
    ],
  },
  {
    code: "D3.3",
    name: "Design Development",
    domain: "D3",
    phase: 2,
    purpose: "Develop the approved concept into a coordinated design with outline specifications and a confirmed budget.",
    subProcesses: [
      sub("D3.3-SP-001", "Design Development", "arch", {
        purpose: "Incorporate the client's detailed requirements and the consultants' designs into the building design.",
        trigger: "The concept and viability are approved",
        outcome: "Design development drawings and outline specifications",
        references: [S.PROCSA, S.FIDPM],
        tasks: [
          t("T01", "Incorporate the client's detailed requirements", "arch", "Develop the design to the client's detailed operational and end-user requirements.", ["End-user requirements"], ["Developed design"], { with: ["dm"], references: [S.PROCSA] }),
          t("T02", "Incorporate the consultants' designs", "arch", "Integrate structure and services into the building design.", ["Engineers' design development"], ["Coordinated design development"], { with: ["struct", "mech", "elec"], references: [S.PROCSA] }),
          t("T03", "Prepare design development drawings", "arch", "Prepare drawings with draft technical details and outline specifications.", ["Coordinated design development"], ["Design development drawings", "Outline specifications"], { references: [S.PROCSA] }),
          t("T04", "Review the budget with the QS", "arch", "Review the design against the detailed estimate and adjust.", ["Detailed estimate"], ["Budget review"], { with: ["qs"], references: [S.PROCSA] }),
          t("T05", "Describe function, construction and maintenance", "arch", "Record how components function, will be safely built, maintained and commissioned.", ["Design development drawings"], ["Design development report input"], { references: [S.FIDPM] }),
        ],
      }),
      sub("D3.3-SP-002", "Building Plan Submission", "arch", {
        purpose: "Submit plans complying with the National Building Regulations for approval.",
        trigger: "The design development is sufficiently resolved",
        outcome: "Building plans approved by the local authority (D7.1)",
        references: [S.NBR, S.SANS10400, S.PROCSA],
        tasks: [
          t("T01", "Check compliance with SANS 10400", "arch", "Check the design against the deemed-to-satisfy rules or prepare rational designs.", ["Design development drawings"], ["Compliance checklist"], { with: ["struct", "mech"], references: [S.SANS10400] }),
          t("T02", "Compile the submission", "arch", "Compile plans, forms, engineers' appointments and energy calculations.", ["Compliance checklist"], ["Building plan submission"], { with: ["struct", "elec"] }),
          t("T03", "Submit drawings to the local authority", "arch", "Submit and track the application (D7.1).", ["Building plan submission"], ["Submission receipt"], { with: ["authority"], references: [S.PROCSA, S.NBR] }),
        ],
      }),
    ],
  },
  {
    code: "D3.4",
    name: "Construction Documentation",
    domain: "D3",
    phase: 2,
    purpose: "Produce the information that details, specifies, sizes and positions every component so the works can be priced and built.",
    subProcesses: [
      sub("D3.4-SP-001", "Working Drawings", "arch", {
        purpose: "Prepare the production drawings for construction and procurement.",
        trigger: "Design development is approved",
        outcome: "Coordinated working drawings issued to the QS",
        references: [S.PROCSA, S.FIDPM],
        tasks: [
          t("T01", "Prepare working drawings and details", "arch", "Produce plans, sections, elevations, schedules and details.", ["Approved design development"], ["Working drawings"], { references: [S.FIDPM] }),
          t("T02", "Prepare services coordination drawings", "arch", "Coordinate services and prepare coordination drawings.", ["Engineers' services drawings"], ["Services coordination drawings"], { with: ["mech", "elec", "civil"], references: [S.PROCSA] }),
          t("T03", "Check the cost estimate with the QS", "arch", "Check the documents against the estimate and adjust to remain within budget.", ["Working drawings", "Budget"], ["Budget-compliant documents"], { with: ["qs"], references: [S.PROCSA] }),
          t("T04", "Issue working drawings for procurement", "arch", "Issue the drawings to the QS for the procurement documentation.", ["Budget-compliant documents"], ["Drawings issued for measurement"], { with: ["qs"], references: [S.PROCSA] }),
        ],
        gateway: {
          question: "Do the documents remain within the approved budget?",
          yes: "Issue for measurement",
          no: "Adjust the documents with the QS before issue",
          after: "T03",
        },
      }),
      sub("D3.4-SP-002", "Specifications", "arch", {
        purpose: "Specify materials, workmanship and performance, agreed with the QS's preambles.",
        trigger: "Working drawings are in progress",
        outcome: "Specifications agreed and bound into the tender",
        references: [S.PROCSA],
        tasks: [
          t("T01", "Prepare the specification", "arch", "Specify materials, products, standards and workmanship.", ["Working drawings"], ["Specification"], { references: [S.PROCSA] }),
          t("T02", "Agree preambles with the QS", "arch", "Align the specification and bill preambles so they do not conflict.", ["Specification"], ["Agreed preambles"], { with: ["qs"], references: [S.PROCSA] }),
          t("T03", "Assess samples and products", "arch", "Assess proposed samples and products for compliance and design intent.", ["Samples", "Product data"], ["Product approvals"], { references: [S.PROCSA] }),
        ],
      }),
    ],
  },
  {
    code: "D3.5",
    name: "Design Monitoring During Construction",
    domain: "D3",
    phase: 4,
    purpose: "See that the works conform to the design, answer questions from site, and approve what is built to the design intent.",
    subProcesses: [
      sub("D3.5-SP-001", "Site Inspection & Clarification", "arch", {
        purpose: "Inspect the works for conformity and give interpretations and direction on the standard required.",
        trigger: "The regular inspection cycle or a request for information",
        outcome: "Inspection reports, clarifications and instructions issued",
        references: [S.PROCSA, S.JBCC],
        tasks: [
          t("T01", "Issue construction documentation", "arch", "Issue construction documents in accordance with the documentation programme.", ["Documentation programme"], ["Issued construction drawings"], { references: [S.PROCSA] }),
          t("T02", "Inspect the works for conformity", "arch", "Inspect at appropriate intervals against the contract documents.", ["Construction drawings", "Specification"], ["Inspection report"], { references: [S.PROCSA, S.JBCC] }),
          t("T03", "Clarify details during construction", "arch", "Answer the contractor's requests for information.", ["Request for information"], ["Clarification"], { with: ["contractor"], references: [S.PROCSA] }),
          t("T04", "Issue contract instructions as required", "arch", "Issue instructions through the principal agent where the design requires change (D6.1).", ["Clarification", "Design change"], ["Draft contract instruction"], { with: ["pm"], references: [S.PROCSA] }),
          t("T05", "Update and issue the drawings register", "arch", "Keep the register of current drawings and revisions.", ["Issued drawings"], ["Drawings register"], { references: [S.PROCSA] }),
        ],
      }),
      sub("D3.5-SP-002", "Shop Drawings, Samples & Tests", "arch", {
        purpose: "Approve subcontract shop drawings, samples, mock-ups and tests for design intent.",
        trigger: "A submittal is received from the contractor",
        outcome: "The submittal approved, approved with comments, or rejected",
        references: [S.PROCSA],
        tasks: [
          t("T01", "Check subcontract shop drawings", "arch", "Check shop drawings for design intent.", ["Shop drawings"], ["Shop drawing review"], { with: ["sub"], references: [S.PROCSA] }),
          t("T02", "Witness tests and mock-ups", "arch", "Witness and review tests and mock-ups on and off site.", ["Test programme"], ["Test and mock-up record"], { references: [S.PROCSA] }),
          t("T03", "Record the approval status", "arch", "Record and communicate the approval status of each submittal.", ["Shop drawing review", "Test record"], ["Submittal register"], { with: ["contractor"] }),
        ],
        gateway: {
          question: "Does the submittal meet the design intent?",
          yes: "Approve for fabrication or installation",
          no: "Return with comments for resubmission",
          after: "T02",
        },
      }),
    ],
  },
  {
    code: "D3.6",
    name: "As-built Documentation",
    domain: "D3",
    phase: 5,
    purpose: "Record what was actually built, for the owner, the authorities and future alterations.",
    subProcesses: [
      sub("D3.6-SP-001", "As-built Drawings & Record Information", "arch", {
        purpose: "Prepare or procure as-built drawings and documentation that accurately reflect the works.",
        trigger: "Practical completion approaches",
        outcome: "As-built drawings and record information handed over",
        references: [S.PROCSA, S.FIDPM],
        tasks: [
          t("T01", "Collect site changes and marked-up drawings", "arch", "Collect instructions and the contractor's marked-up drawings.", ["Contract instructions", "Marked-up drawings"], ["As-built change record"], { with: ["contractor"] }),
          t("T02", "Prepare as-built drawings", "arch", "Update the drawings to reflect the works as built.", ["As-built change record"], ["As-built drawings"], { references: [S.PROCSA] }),
          t("T03", "Review O&M manuals and warranties", "arch", "Review and comment on operation and maintenance manuals, guarantees and warranties.", ["O&M manuals", "Warranties"], ["O&M review comments"], { references: [S.PROCSA] }),
          t("T04", "Assemble record information", "arch", "Assemble the record information for handover (D2.7).", ["As-built drawings", "O&M review comments"], ["Record information set"], { with: ["pm"], references: [S.FIDPM] }),
        ],
      }),
    ],
  },
];
