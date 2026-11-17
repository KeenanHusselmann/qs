"use server";

/**
 * Issuing a document, and the register of what has been issued — PLATFORM.md §4.11, §1.3.1.
 *
 * ── Generating and issuing are different acts ──────────────────────────────────────────────
 *
 * Downloading a report generates it live from whatever is signed now, and that stays exactly as it
 * was: a live document cannot contradict the figures, because it is derived from them at the moment
 * it is asked for.
 *
 * **Issuing** is the other thing. It says: this is what we sent. The bytes are kept as they were,
 * with who sent them, when, and which signed runs they were generated from — and re-generating a
 * year later cannot reproduce that, because the figures have moved since.
 *
 * A practice needs both and they answer different questions. Nothing here replaces the live path.
 *
 * ── Only async functions ───────────────────────────────────────────────────────────────────
 *
 * A `"use server"` module may export nothing else; a synchronous helper beside these once broke the
 * module at load and returned 500 on every page including login.
 */

import { after } from "next/server";
import { toldIssued } from "@/lib/notifications";
import { revalidatePath } from "next/cache";
import { and, desc, eq, isNull } from "drizzle-orm";

import { db } from "@/db/client";
import { issuedDocuments } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { store } from "@/lib/ingest/storage";
import { loadSignedFigures } from "@/lib/agent/persist";
import { loadLatestBill } from "@/lib/agent/persist-bill";
import { currentAssumptions } from "@/lib/assumptions";
import { viabilityReport } from "@/lib/report/viability";
import { renderViabilityPdf } from "@/lib/report/pdf";
import { billPdf } from "@/lib/report/bill-pdf";
import { billWorkbook } from "@/lib/report/bill-workbook";
import { getProject } from "@/app/(app)/projects/actions";
import { FIRM } from "@/lib/firm";
import { formatDate } from "@/lib/dates";
import { arrayContains } from "drizzle-orm";
import { loadSignedOutput } from "@/lib/agent/persist";
import { paymentCertificates } from "@/lib/certificates";
import { paymentCertificatePdf, type CertificateParties } from "@/lib/report/certificate-pdf";
import { nameOf } from "@/lib/signers";
import { contractTerms } from "@/domain/contract-form";
import { loadTenderRoom } from "@/lib/tender-room";
import { invitationPdf, openingRecordPdf } from "@/lib/report/tender-pdf";
import { loadSignedBill } from "@/lib/agent/persist-bill";
import { loadElementalPlan } from "@/lib/elemental-plan";
import { elementalPlanPdf } from "@/lib/report/elemental-plan-pdf";
import { loadRfq, loadRfqReadings } from "@/lib/rfq";
import { rfqWorkbook } from "@/lib/report/rfq-workbook";
import { rfqPdf } from "@/lib/report/rfq-pdf";
import { loadCostControl } from "@/lib/cost-control";
import { costReportPdf } from "@/lib/report/cost-report-pdf";

/** A row of the register, as the screen reads it. */
export interface IssuedDocument {
  id: string;
  kind: string;
  title: string;
  byteSize: number;
  /** How many signed steps it was generated from. Nought is legitimate and worth noticing. */
  restsOn: number;
  issuedBy: string;
  issuedAt: string;
  withdrawnAt: string | null;
  withdrawnBy: string | null;
}

/** What the practice has issued on this project, newest first. Withdrawn ones included, marked. */
export async function listIssued(projectId: string): Promise<IssuedDocument[]> {
  await requireSession();

  const rows = await db
    .select()
    .from(issuedDocuments)
    .where(eq(issuedDocuments.projectId, projectId))
    .orderBy(desc(issuedDocuments.issuedAt));

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    byteSize: row.byteSize,
    restsOn: row.signedRunIds.length,
    issuedBy: row.issuedBy,
    issuedAt: row.issuedAt.toISOString(),
    withdrawnAt: row.withdrawnAt?.toISOString() ?? null,
    withdrawnBy: row.withdrawnBy,
  }));
}

export type IssueOutcome = { ok: true; title: string; id: string } | { ok: false; reason: string };

/**
 * Generate a document as it stands and keep it.
 *
 * The **same** renderers the download route uses, so an issued document is byte-for-byte what a
 * reader would have downloaded at that moment. Rendering it a second way here would be two
 * statements of what the document is, and they would part company.
 */
export type IssuedKind = "viability_report" | "bill_of_quantities" | "elemental_cost_plan" | "payment_certificate" | "completion_certificate" | "meeting_minutes" | "tender_invitation" | "tender_bill" | "tender_opening" | "rfq_evaluation" | "rfq_comparison" | "bill_workbook" | "cost_report";

export async function issueDocument(
  projectId: string,
  kind: IssuedKind,
  /** For a payment certificate: the signed valuation it certifies. The latest where omitted. */
  runId?: string,
): Promise<IssueOutcome> {
  const session = await requireSession();

  // Kept in the type for the copies already in the register; no longer issued (16 Nov 2026), because
  // the Handover step and Site Meetings that produced them were removed.
  if (kind === "completion_certificate" || kind === "meeting_minutes") {
    return { ok: false, reason: "This document is no longer issued from the platform." };
  }

  const project = await getProject(projectId);
  if (!project) return { ok: false, reason: "No such project." };

  const signed = await loadSignedFigures(projectId);

  let bytes: Buffer;
  let title: string;
  // What the document rests on. A certificate rests on the one run it certifies, not on the project.
  let restsOn: string[] = signed.map((step) => step.runId);

  if (kind === "tender_invitation" || kind === "tender_bill" || kind === "tender_opening") {
    const room = await loadTenderRoom(projectId);
    const tender = room.tender;
    if (!tender || !room.bill) return { ok: false, reason: "There is no tender on this project – start one in the Tender Room." };
    const parties = {
      practice: FIRM.name,
      projectName: project.name,
      code: project.code ?? null,
      employer: project.client ?? null,
      issuedBy: await nameOf(session.email),
      issuedOn: formatDate(new Date()),
      billTotalItems: room.bill.items,
    };
    if (kind === "tender_invitation") {
      if (tender.invitees.length === 0) return { ok: false, reason: "Invite the tenderers first – the invitation names them." };
      title = `${project.name} – Invitation to tender ${tender.reference}`;
      bytes = invitationPdf(tender, parties);
    } else if (kind === "tender_opening") {
      if (!tender.openedAt) return { ok: false, reason: "The tenders have not been opened yet." };
      title = `${project.name} – Record of tenders opened ${tender.reference}`;
      bytes = openingRecordPdf(tender, parties);
    } else {
      /*
        The bill for pricing: the signed bill with every rate and amount taken off, so a tenderer
        prices the practice's quantities and never sees its estimate.
      */
      const signedBill = (await loadSignedBill(projectId, "/bill"))!;
      const blank = signedBill.rows.map((row) => ({
        ...row,
        amount: null,
        proposed: { ...row.proposed, rate: null },
        override: row.override ? { ...row.override, rate: null } : null,
        output: row.output ? { ...row.output, rate: null, amount: null } : null,
      }));
      title = `${project.name} – Bill of Quantities for tender ${tender.reference}`;
      bytes = billPdf(blank, { practice: FIRM.name, projectName: project.name, code: project.code ?? null, title: `Bill of Quantities – for tender ${tender.reference}`, signedBy: signedBill.by, signedAt: formatDate(new Date(signedBill.at)) }, true, true);
    }
    restsOn = [room.bill.runId];
  } else if (kind === "payment_certificate") {
    const contract = await loadSignedOutput(projectId, "/contract");
    const parties: CertificateParties = {
      practice: FIRM.name,
      projectName: project.name,
      code: project.code ?? null,
      employer: project.client ?? null,
      contractor: contract.get("ct-contractor")?.value ?? null,
      contractForm: contract.get("ct-form")?.value ?? null,
      contractSum: contract.get("ct-sum")?.value ?? null,
      issuedBy: await nameOf(session.email),
      issuedOn: formatDate(new Date()),
    };

    const { certificates, refused } = await paymentCertificates(projectId);
    const cert = runId ? certificates.find((c) => c.runId === runId) : certificates.at(-1);
    if (!cert) {
      return {
        ok: false,
        reason: refused
          ? `The certificate cannot be issued: ${refused.reasons.join("; ")}. Correct the valuation and sign it again.`
          : "There is no signed valuation to certify. Sign one under Valuations first.",
      };
    }
    /*
      Sequential and never reissued (§6.4 #8). A second copy of certificate 4 in circulation is two
      claims on the same money; withdrawing the first is how a correction is made, and the
      register keeps both.
    */
    const [already] = await db
      .select({ issuedAt: issuedDocuments.issuedAt })
      .from(issuedDocuments)
      .where(and(eq(issuedDocuments.projectId, projectId), eq(issuedDocuments.kind, kind), arrayContains(issuedDocuments.signedRunIds, [cert.runId]), isNull(issuedDocuments.withdrawnAt)))
      .limit(1);
    if (already) {
      return { ok: false, reason: `Payment Certificate ${cert.number} was issued on ${formatDate(already.issuedAt)}. Withdraw it in the register to issue a corrected one.` };
    }
    title = `${project.name} – ${contractTerms(parties.contractForm).paymentCertificate} ${cert.number}`;
    bytes = paymentCertificatePdf(cert, parties);
    restsOn = [cert.runId];
  } else if (kind === "rfq_comparison") {
    // The workbook the quantity surveyor works in afterwards: the same findings, live.
    const loaded = runId ? await loadRfqReadings(projectId, runId) : null;
    if (!loaded) return { ok: false, reason: "That RFQ is not on this project." };
    if (!loaded.rfq.recommendation) return { ok: false, reason: "Evaluate the responses first – the workbook compares their checks." };
    title = `${project.name} – Comparative evaluation – ${loaded.rfq.title}`;
    bytes = await rfqWorkbook(loaded.rfq, loaded.responses, {
      practice: FIRM.name,
      projectName: project.name,
      code: project.code ?? null,
      client: project.client ?? null,
      issuedBy: await nameOf(session.email),
      issuedOn: formatDate(new Date()),
    });
    restsOn = [];
  } else if (kind === "rfq_evaluation") {
    // `runId` carries the RFQ here; an evaluation rests on no signed run.
    const rfq = runId ? await loadRfq(projectId, runId) : null;
    if (!rfq) return { ok: false, reason: "That RFQ is not on this project." };
    if (!rfq.recommendation) return { ok: false, reason: "Evaluate the responses first – the report is their evaluation." };
    title = `${project.name} – Evaluation of quotations – ${rfq.title}`;
    bytes = rfqPdf(rfq, { practice: FIRM.name, projectName: project.name, code: project.code ?? null, client: project.client ?? null, issuedBy: await nameOf(session.email), issuedOn: formatDate(new Date()) });
    restsOn = [];
  } else if (kind === "elemental_cost_plan") {
    const view = await loadElementalPlan(projectId);
    if (!view || view.items.length === 0) {
      return { ok: false, reason: "There is no bill to plan from yet. Measure or draft one under Bill of Quantities." };
    }
    title = `${project.name} – Elemental Cost Plan`;
    bytes = elementalPlanPdf(view.computed, {
      practice: FIRM.name,
      projectName: project.name,
      code: project.code ?? null,
      client: project.client ?? null,
      basis: view.bill.signed
        ? `Revised from the Bill of Quantities signed off by ${view.bill.by} on ${formatDate(new Date(view.bill.at!))}`
        : "Revised from the draft Bill of Quantities – not yet signed off",
      allowances: { ...view.allowances, typical: view.allowances.set === null },
      measure: view.measure ? { label: view.measure.label } : null,
      issuedBy: await nameOf(session.email),
      issuedOn: formatDate(new Date()),
    });
    // What it rests on: the signed bill, where it was revised from one; nothing, from a draft.
    restsOn = view.bill.signed ? [view.bill.runId] : [];
  } else if (kind === "cost_report") {
    // The design cost check, as sent to the client – D1.1-SP-003 T04.
    const control = await loadCostControl(projectId);
    if (!control.check || !control.costPlan || !control.bill) {
      return { ok: false, reason: "There is nothing to report yet: the check needs a signed Cost Plan and a priced bill." };
    }
    title = `${project.name} – Cost Report`;
    bytes = costReportPdf(control.check, control.notes, control.decisions[0] ?? null, {
      practice: FIRM.name,
      projectName: project.name,
      code: project.code ?? null,
      client: project.client ?? null,
      costPlan: `The Cost Plan signed off by ${control.costPlan.by} on ${formatDate(new Date(control.costPlan.at))}`,
      bill: control.bill.signed
        ? `The Bill of Quantities signed off by ${control.bill.by} on ${formatDate(new Date(control.bill.at!))}`
        : "The draft Bill of Quantities – not yet signed off",
      issuedBy: await nameOf(session.email),
      issuedOn: formatDate(new Date()),
    });
    // What it rests on: the signed cost plan, and the bill where that is signed too.
    restsOn = [control.costPlan.runId, ...(control.bill.signed ? [control.bill.runId] : [])];
  } else if (kind === "bill_workbook") {
    /*
      The bill as a spreadsheet, because a bill is worked in rather than read.

      The practice's rule for which documents are which: a workbook where numbers and amounts have
      to be calculated, a PDF where the thing is a report or a summary. A bill is the clearest case
      on either side of that line - a tenderer prices it, and the amounts have to come out.
    */
    const bill = await loadLatestBill(projectId, "/bill");
    if (!bill || bill.rows.length === 0) {
      return { ok: false, reason: "There is no bill to issue yet. Draft one under Bill of Quantities." };
    }
    title = `${project.name} – Bill of Quantities (workbook)`;
    bytes = await billWorkbook(
      bill.rows,
      {
        practice: FIRM.name,
        projectName: project.name,
        code: project.code ?? null,
        title: "Bill of Quantities",
        signedBy: bill.signedBy ?? null,
        signedAt: bill.signedAt ? formatDate(new Date(bill.signedAt)) : null,
      },
      !bill.signedAt,
    );
  } else if (kind === "bill_of_quantities") {
    const bill = await loadLatestBill(projectId, "/bill");
    if (!bill || bill.rows.length === 0) {
      // §7.7 — say what to do next, not that something is missing.
      return { ok: false, reason: "There is no bill to issue yet. Draft one under Bill of Quantities." };
    }

    title = `${project.name} – Bill of Quantities`;
    bytes = billPdf(
      bill.rows,
      {
        practice: FIRM.name,
        projectName: project.name,
        code: project.code ?? null,
        title: "Bill of Quantities",
        signedBy: bill.signedBy ?? null,
        signedAt: bill.signedAt ? formatDate(new Date(bill.signedAt)) : null,
      },
      Boolean(bill.signedAt),
    );
  } else {
    title = `${project.name} – QS Viability Report`;
    bytes = renderViabilityPdf(viabilityReport(signed, await currentAssumptions()), {
      projectName: project.name,
      code: project.code ?? null,
      client: project.client ?? null,
      practice: FIRM.name,
      latestSignature: signed.length > 0 ? formatDate(signed[0]!.at) : null,
      issuedOn: formatDate(new Date()),
    });
  }

  const id = crypto.randomUUID();
  // A workbook is kept as a workbook: the register serves the bytes back by the extension here.
  const extension = kind === "rfq_comparison" ? "xlsx" : "pdf";
  const stored = await store(id, `${title}.${extension}`, new Uint8Array(bytes));

  /*
    A failure to keep the bytes is a failure to issue.

    `store` can refuse — no Blob token, a full disk — and it says why. Recording the row anyway
    would put an entry in the register pointing at nothing: the practice would believe it had a
    copy of what it sent, and find out otherwise on the day it mattered. §1.3, the rule this
    platform is built on: never a silent gap.
  */
  if (!stored.retained) {
    return { ok: false, reason: `The document was generated but could not be kept: ${stored.reason}` };
  }

  await db.insert(issuedDocuments).values({
    id,
    projectId,
    kind,
    title,
    storageLocation: stored.location,
    byteSize: bytes.length,
    /*
      What it rests on, captured at the moment of issue.

      This is the difference between a stored PDF and a record: each of these runs is frozen by
      `runs_frozen()` and still readable, so a document issued last March can still say which
      approved figures produced it (§1.3.1). Empty where nothing was signed — legitimate for a
      draft bill, and exactly the document somebody should look at twice.
    */
    signedRunIds: restsOn,
    issuedBy: session.email,
  });

  revalidatePath(`/projects/${projectId}`, "layout");
  after(() => toldIssued(projectId, title, id, session.email).catch((e) => console.error("[notifications]", e)));
  return { ok: true, title, id };
}

/**
 * Withdraw an issued document.
 *
 * Marked superseded, never deleted (§6.1). A report that was sent cannot be unsent, and the record
 * of having sent it is the fact somebody will need — withdrawing says it should no longer be
 * treated as current, which is a different claim from saying it never existed.
 */
export async function withdrawDocument(projectId: string, id: string): Promise<void> {
  const session = await requireSession();

  await db
    .update(issuedDocuments)
    .set({ withdrawnAt: new Date(), withdrawnBy: session.email })
    .where(
      and(
        eq(issuedDocuments.id, id),
        eq(issuedDocuments.projectId, projectId),
        isNull(issuedDocuments.withdrawnAt),
      ),
    );

  revalidatePath(`/projects/${projectId}`, "layout");
}
