/**
 * What each phase has to produce, and whether this project has it – the job card's phases.
 *
 * ── Why the phases needed this ─────────────────────────────────────────────────────────────
 *
 * A phase tile counted the platform's own steps: Design & Documentation read "0/1" because the Bill
 * of Quantities is the one step built there. But the phase is concept design, the elemental estimate,
 * design development, approved building plans and the working drawings, specification and bill –
 * and a card that shows one of the five reads as though the phase were one step from done.
 *
 * So every phase lists its key deliverables, as the process research names them (`process-library/
 * levels.ts` – PROCSA, SACQSP, FIDPM), and says for each one what this project has:
 *
 *  - **Signed off**, where a platform step produces it and that step is signed;
 *  - **Filed**, where the platform does not produce it but a document of its kind is on file;
 *  - **Outstanding** otherwise – including the deliverables the platform does not track at all,
 *    which say so rather than being left off the list.
 *
 * "Filed" is not "approved": a filed document of the right kind is evidence the deliverable exists,
 * not that anybody accepted it, and the label says only what is known.
 */

import { PHASES } from "@/lib/process-library/levels";

/** What would show a deliverable exists: a step that produces it, or documents of these kinds. */
interface Evidence {
  modules?: readonly string[];
  kinds?: readonly string[];
}

/**
 * Keyed by the research's own words for each deliverable, so the list shown is the research's list.
 * A deliverable with no entry is tracked by nothing – `phase-deliverables.test.ts` fails if the
 * research gains one this file has not considered.
 */
const EVIDENCE: Readonly<Record<string, Evidence>> = {
  // 1 — Feasibility & Inception
  "First business case": { modules: ["/feasibility"] },
  "Project brief": { modules: ["/inputs"], kinds: ["Project brief", "Developer requirements"] },
  "Preliminary site assessment": { modules: ["/site"] },
  "Preliminary desktop viability": { modules: ["/feasibility"] },
  "Consultant appointments and agreed scopes of service": {
    kinds: ["Appointment letter", "Signed mandate", "Appointment schedule", "Professional team list"],
  },

  // 2 — Design & Documentation
  "Concept design and viability report": { kinds: ["Concept drawings", "Concept parameters"] },
  "Preliminary and elemental estimates of construction cost": { modules: ["/cost-plan"] },
  "Design development report and detailed estimate": {},
  "Approved building plans": {},
  "Working drawings, specifications and bills of quantities": { modules: ["/bill"] },

  // 3 — Procurement & Tender
  "Procurement strategy and programme": { kinds: ["Procurement schedule"] },
  "Tender documentation": {},
  "Tender evaluation report and recommendation": { modules: ["/tender-analysis"] },
  "Priced contract documentation for signature": { modules: ["/contract"] },

  // 4 — Construction & Delivery
  "Approved construction programme": { kinds: ["Construction programme", "Contractor's programme", "Approved programme"] },
  "Monthly payment certificates and recovery statements": { modules: ["/valuations"] },
  "Contract instructions and priced variations": { modules: ["/variations"] },
  "Monthly cost reports and cash flow forecasts": { modules: ["/cost-report"] },
  "Progress reports and site meeting records": { kinds: ["Meeting minutes", "Inspection report"] },

  // 5 — Handover & Commissioning
  "Commissioning records": {},
  "As-built drawings and O&M manuals": { kinds: ["As-built drawings", "O&M manual"] },
  "Health and safety file": {},
  "Certificate of occupancy": {},
  "List for completion (defects)": { kinds: ["Snag list", "Defects list", "Practical completion certificate"] },

  // 6 — Close-out & Final Account
  "Certificate of final completion": { kinds: ["Certificate of completion", "Completion certificate"] },
  "Final account": { modules: ["/final-account"] },
  "Final payment certificate": {},
  "Project close-out report": {},
};

/** Exported for the test that keeps this file and the research in step. */
export const trackedDeliverables = (): readonly string[] => Object.keys(EVIDENCE);

/**
 * The document kinds the deliverables count, so `document-kinds.ts` can offer them for filing. Since
 * 16 Nov 2026 some deliverables are evidenced only by a filed document – the programme, the snag
 * list – because the steps that read them were removed; a kind nothing offers could not be filed.
 */
export const deliverableKinds = (): readonly string[] => Object.values(EVIDENCE).flatMap((e) => e.kinds ?? []);

export type DeliverableState = "signed" | "filed" | "outstanding";

export interface DeliverableStatus {
  label: string;
  state: DeliverableState;
  /** One line on why: the step and what it still needs, the document on file, or that nothing tracks it. */
  detail: string;
  /** The step to open for it, where a step produces it. */
  step: { module: string; label: string } | null;
}

/** What the project has, read once for the page. */
export interface ProjectEvidence {
  signed: ReadonlySet<string>;
  /** Filed documents by kind: how many of each. */
  filed: ReadonlyMap<string, number>;
  /** A step's menu label. */
  labelOf: (module: string) => string;
  /** What a step still needs before it can run, by requirement label. Empty when nothing. */
  missingFor: (module: string) => readonly string[];
}

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;

/** The deliverables of one phase, each with what this project has for it. */
export function phaseDeliverables(phase: number, project: ProjectEvidence): DeliverableStatus[] {
  const research = PHASES.find((p) => p.number === phase);
  if (!research) return [];

  return research.keyDeliverables.map((label) => {
    const evidence = EVIDENCE[label] ?? {};
    const modules = evidence.modules ?? [];

    if (modules.length > 0) {
      const open = modules.filter((module) => !project.signed.has(module));
      const step = { module: open[0] ?? modules[0], label: project.labelOf(open[0] ?? modules[0]) };

      if (open.length === 0) {
        return { label, state: "signed", detail: `${modules.map(project.labelOf).join(" and ")} signed off`, step };
      }

      const missing = open.flatMap(project.missingFor);
      return {
        label,
        state: "outstanding",
        detail:
          missing.length > 0
            ? `${open.map(project.labelOf).join(" and ")} still needs ${missing.join(", ")}`
            : `${open.map(project.labelOf).join(" and ")} not signed off yet`,
        step,
      };
    }

    const kinds = evidence.kinds ?? [];
    if (kinds.length > 0) {
      const count = kinds.reduce((total, kind) => total + (project.filed.get(kind) ?? 0), 0);
      return count > 0
        ? { label, state: "filed", detail: `${plural(count, "document")} on file – not produced in the platform`, step: null }
        : {
            label,
            state: "outstanding",
            detail: `Nothing filed – no ${kinds.map((kind) => kind.toLowerCase()).join(" or ")} in Documents`,
            step: null,
          };
    }

    return { label, state: "outstanding", detail: "Not tracked in the platform yet", step: null };
  });
}
