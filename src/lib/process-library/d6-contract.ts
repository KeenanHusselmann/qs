/**
 * D6 — Contract Administration. The principal agent's impartial administration of the building
 * contract. Completion and defects periods restate the JBCC 6.2 Guide to Completion and Payment;
 * other contract forms (GCC, NEC) have equivalents with different names and time bars.
 */

import { SOURCES as S, sub, task as t } from "./build";
import type { Area } from "./types";

export const D6: readonly Area[] = [
  {
    code: "D6.1",
    name: "Contract Administration",
    domain: "D6",
    phase: 4,
    purpose: "Issue instructions, handle notices, and adjudicate entitlements to time under the contract.",
    subProcesses: [
      sub("D6.1-SP-001", "Contract Instructions", "pm", {
        purpose: "Instruct changes and clarifications in writing, so every change to the works is traceable.",
        trigger: "A change, clarification or direction is needed",
        outcome: "A numbered contract instruction issued and registered",
        references: [S.PROCSA, S.JBCC_PBA],
        tasks: [
          t("T01", "Confirm the change is approved", "pm", "Confirm the client approved any change with a cost or time effect (D1.6).", ["Variation advice", "Client decision"], ["Approval to instruct"], { with: ["qs", "client"], references: [S.PROCSA] }),
          t("T02", "Draft the instruction", "pm", "Draft the instruction with drawings and a clear description of what changes.", ["Approval to instruct", "Revised drawings"], ["Draft contract instruction"], { with: ["arch", "struct"] }),
          t("T03", "Issue the contract instruction", "pm", "Issue the numbered instruction to the contractor.", ["Draft contract instruction"], ["Contract instruction"], { with: ["contractor"], references: [S.JBCC_PBA] }),
          t("T04", "Register and distribute", "pm", "Record it in the instruction register and send it to the QS for valuation.", ["Contract instruction"], ["Instruction register"], { with: ["qs"] }),
        ],
      }),
      sub("D6.1-SP-002", "Extension of Time", "pm", {
        purpose: "Decide whether the contractor is entitled to more time, and how much.",
        trigger: "The contractor gives notice of a delay and claims an extension",
        outcome: "A revised date for practical completion, or a reasoned rejection",
        references: [S.PROCSA, S.JBCC_PBA],
        tasks: [
          t("T01", "Receive the notice and claim", "pm", "Check the notice was given within the contract's time bars.", ["Contractor's notice", "Contract data"], ["Registered EOT claim"], { with: ["contractor"] }),
          t("T02", "Analyse the delay against the programme", "pm", "Establish cause, effect on the critical path and concurrent delay.", ["Approved programme", "Site diary", "Registered EOT claim"], ["Delay analysis"], { with: ["arch"] }),
          t("T03", "Adjudicate the entitlement", "pm", "Adjudicate the entitlement arising from the change to the programme.", ["Delay analysis"], ["EOT determination"], { references: [S.PROCSA] }),
          t("T04", "Assess any cost consequence", "qs", "Value any associated expense and loss the contract allows.", ["EOT determination"], ["Expense and loss valuation"], { with: ["pm"] }),
          t("T05", "Notify the revised completion date", "pm", "Notify the parties of the decision and revised date.", ["EOT determination"], ["Revised date for practical completion"], { with: ["contractor", "client"] }),
        ],
        gateway: {
          question: "Is the delay at the employer's risk under the contract?",
          yes: "Grant an extension and assess expense and loss",
          no: "Reject with reasons; penalties may apply",
          after: "T02",
        },
      }),
    ],
  },
  {
    code: "D6.2",
    name: "Contract Award & Documentation",
    domain: "D6",
    phase: 3,
    purpose: "Award the contract correctly and put a complete, signed contract in place.",
    subProcesses: [
      sub("D6.2-SP-001", "Award & Signature", "pm", {
        purpose: "Notify tenderers, compile the contract and formally accept the offer.",
        trigger: "The tender recommendation is approved by the client",
        outcome: "A signed contract issued to the contractor (PG7)",
        references: [S.FIDPM, S.PROCSA, S.SACQSP],
        tasks: [
          t("T01", "Obtain client approval of the tender recommendation", "pm", "Present the recommendation and obtain approval.", ["Tender evaluation report"], ["Approved recommendation"], { with: ["client"], references: [S.SACQSP] }),
          t("T02", "Confirm compliance with award requirements", "pm", "Confirm the tenderer provided the securities, insurances and documents the tender data requires.", ["Tender data", "Tenderer's documents"], ["Award compliance check"], { references: [S.FIDPM] }),
          t("T03", "Notify successful and unsuccessful tenderers", "pm", "Notify all tenderers of the outcome.", ["Approved recommendation"], ["Award notifications"], { references: [S.FIDPM] }),
          t("T04", "Coordinate the contract documentation for signature", "pm", "Assemble the contract documents for signature.", ["Priced contract documentation"], ["Contract for signature"], { with: ["qs", "arch"], references: [S.SACQSP] }),
          t("T05", "Sign the contract", "client", "Sign the principal contract and direct appointments.", ["Contract for signature"], ["Signed contract"], { with: ["contractor", "dm"], references: [S.PROCSA, S.FIDPM] }),
          t("T06", "Place the project insurances", "dm", "Place the contract works and development risk insurances.", ["Insurance advice"], ["Insurance policies"], { references: [S.PROCSA] }),
        ],
      }),
    ],
  },
  {
    code: "D6.3",
    name: "Claims & Dispute Resolution",
    domain: "D6",
    phase: 4,
    purpose: "Deal with contractual and financial claims promptly and fairly, and resolve disagreements before they become disputes.",
    subProcesses: [
      sub("D6.3-SP-001", "Claims Adjudication", "pm", {
        purpose: "Receive, review and adjudicate the contractor's claims.",
        trigger: "The contractor submits a claim",
        outcome: "A determination issued, accepted or disputed",
        references: [S.PROCSA, S.SACQSP],
        tasks: [
          t("T01", "Receive and register the claim", "pm", "Register the claim and check the notices and time bars.", ["Contractor's claim"], ["Claims register"], { references: [S.SACQSP] }),
          t("T02", "Adjudicate financial claims", "qs", "Adjudicate and resolve financial claims.", ["Contractor's claim", "Records"], ["Financial claim assessment"], { with: ["pm"], references: [S.SACQSP] }),
          t("T03", "Assess contractual entitlement", "pm", "Assess entitlement under the contract with the consultants' input.", ["Financial claim assessment"], ["Claim determination"], { with: ["arch", "struct"], references: [S.PROCSA] }),
          t("T04", "Recommend settlement to the client", "pm", "Recommend settlement for the client's approval.", ["Claim determination"], ["Settlement recommendation"], { with: ["client"], references: [S.PROCSA] }),
        ],
      }),
      sub("D6.3-SP-002", "Dispute Resolution", "pm", {
        purpose: "Follow the contract's dispute procedure when a determination is not accepted.",
        trigger: "A party disputes a determination",
        outcome: "The dispute settled, adjudicated or arbitrated",
        references: [S.JBCC_PBA],
        tasks: [
          t("T01", "Record the dispute notice", "pm", "Record the notice and the contract's dispute timeline.", ["Dispute notice"], ["Dispute record"], { references: [S.JBCC_PBA] }),
          t("T02", "Attempt negotiated settlement", "pm", "Meet the parties to narrow and settle the issues.", ["Dispute record"], ["Settlement or narrowed issues"], { with: ["client", "contractor", "qs"] }),
          t("T03", "Refer to adjudication or arbitration", "client", "Refer unresolved issues to the forum the contract names.", ["Narrowed issues"], ["Referral"], { references: [S.JBCC_PBA] }),
          t("T04", "Implement the outcome", "pm", "Give effect to the settlement, adjudicator's decision or award in the accounts.", ["Decision or award"], ["Adjusted contract records"], { with: ["qs"] }),
        ],
        gateway: {
          question: "Is the dispute settled by negotiation?",
          yes: "Record the settlement and implement it",
          no: "Refer to adjudication or arbitration",
          after: "T02",
        },
      }),
    ],
  },
  {
    code: "D6.4",
    name: "Completion Certification",
    domain: "D6",
    phase: 5,
    purpose: "Certify each degree of completion strictly by the contract, because responsibility, insurance, penalties and guarantees all turn on the dates.",
    subProcesses: [
      sub("D6.4-SP-001", "Practical Completion", "pm", {
        purpose: "Decide whether the works can effectively be used for the intended purpose, and certify it.",
        trigger: "The contractor gives notice to inspect for practical completion",
        outcome: "A certificate of practical completion and a list for completion",
        references: [S.JBCC],
        tasks: [
          t("T01", "Inspect the works", "pm", "Inspect with the other agents whether the works are substantially complete for the purpose intended.", ["Notice of readiness", "Practical completion criteria"], ["Inspection findings"], { with: ["arch", "struct", "elec", "mech"], references: [S.JBCC] }),
          t("T02", "Issue the list for practical completion", "pm", "If not complete, issue one comprehensive and conclusive list within five working days of the inspection.", ["Inspection findings"], ["List for practical completion"], { references: [S.JBCC] }),
          t("T03", "Re-inspect rectified items", "pm", "Inspect items the contractor has rectified; an updated list may exclude remedied items.", ["Contractor's re-inspection notice"], ["Updated list"], { references: [S.JBCC] }),
          t("T04", "Issue the certificate of practical completion", "pm", "Certify practical completion and issue the list for completion.", ["Inspection findings"], ["Certificate of practical completion", "List for completion"], { references: [S.JBCC] }),
          t("T05", "Apply the consequences", "qs", "Stop penalties, reduce guarantees, start the defects liability period and the final account period.", ["Certificate of practical completion", "Contract data"], ["Practical completion consequences schedule"], { with: ["pm"], references: [S.JBCC] }),
        ],
        gateway: {
          question: "Can the works effectively be used for the purpose intended?",
          yes: "Certify practical completion",
          no: "Issue the list for practical completion and re-inspect when notified",
          after: "T01",
        },
      }),
      sub("D6.4-SP-002", "Final Completion", "pm", {
        purpose: "Certify that the works are free of defects, which ends the contractor's obligations other than for latent defects.",
        trigger: "The contractor gives notice that the list for completion is rectified",
        outcome: "A certificate of final completion",
        references: [S.JBCC],
        tasks: [
          t("T01", "Inspect the whole of the works", "pm", "Inspect within five working days of notice, including latent defects that have become patent.", ["Contractor's notice"], ["Final inspection findings"], { with: ["arch", "struct"], references: [S.JBCC] }),
          t("T02", "Issue the list for final completion", "pm", "List the remaining items and latent defects to rectify.", ["Final inspection findings"], ["List for final completion"], { references: [S.JBCC] }),
          t("T03", "Issue the certificate of final completion", "pm", "Certify final completion once every item is rectified and the defects period has run.", ["Rectified works"], ["Certificate of final completion"], { references: [S.JBCC] }),
          t("T04", "Record the latent defects period", "pm", "Record the latent defects liability period end date for the owner.", ["Certificate of final completion"], ["Latent defects period record"], { with: ["fm"], references: [S.JBCC] }),
        ],
        gateway: {
          question: "Are all items on the list for final completion rectified?",
          yes: "Certify final completion",
          no: "Keep the list open and re-inspect when notified",
          after: "T02",
        },
      }),
    ],
  },
  {
    code: "D6.5",
    name: "Defects Liability & Latent Defects",
    domain: "D6",
    phase: 7,
    purpose: "Hold the contractor to its obligation to remedy defects that appear after completion, within the periods the contract and the law allow.",
    subProcesses: [
      sub("D6.5-SP-001", "Latent Defect Claim", "fm", {
        purpose: "Notify the contractor of a latent defect and have it remedied within the latent defects liability period.",
        trigger: "A defect appears after final completion",
        outcome: "The defect remedied by the contractor, or by another at the contractor's expense",
        references: [S.JBCC],
        tasks: [
          t("T01", "Record the defect", "fm", "Record the defect with photographs, location and date observed.", ["Defect observation"], ["Defect record"]),
          t("T02", "Confirm it falls within the period", "pm", "Confirm the defect is within the latent defects liability period and prescription.", ["Defect record", "Latent defects period record"], ["Liability confirmation"], { references: [S.JBCC] }),
          t("T03", "Notify the contractor to remedy", "client", "Give the contractor notice to remedy the defect.", ["Liability confirmation"], ["Notice to remedy"], { with: ["pm"], references: [S.JBCC] }),
          t("T04", "Verify the remedy", "pm", "Inspect and confirm the defect is remedied.", ["Contractor's remedy"], ["Remedy verification"], { with: ["fm"] }),
          t("T05", "Employ others and recover cost if not remedied", "client", "Employ another contractor and claim the expense from the defaulting contractor.", ["Notice to remedy"], ["Recovery claim"], { with: ["qs"], references: [S.JBCC] }),
        ],
        gateway: {
          question: "Did the contractor remedy the defect in time?",
          yes: "Close the defect record",
          no: "Employ another contractor and recover the expense",
          after: "T03",
        },
      }),
    ],
  },
];
