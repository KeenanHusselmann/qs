/**
 * Payment certificates and the certificate of practical completion, assembled from signed steps.
 *
 * ── Every figure is read, or the certificate is not issued ──────────────────────────────────
 *
 * A certificate is the document money moves on. So each figure is read from a signed run by the
 * one reader every figure crosses (`readAmount`, `readPercent`, `readDate`), and a figure that
 * cannot be read stops the certificate with a sentence naming it – never a nought in its place.
 * The only figure derived rather than read is "previously certified" where the valuation did not
 * state it: then it is the net of the certificate before, computed the same way, and the
 * certificate says so on its face.
 */

import { and, arrayContains, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import { db } from "@/db/client";
import { issuedDocuments, runFields, runs } from "@/db/schema";
import { readAmount, readPercent } from "@/domain/amount";
import { paymentCertificate, type PaymentCertificate } from "@/domain/certificates";
import { readDate } from "@/domain/date-reading";
import { money, type Money } from "@/domain/money";
import { loadSignedOutput } from "@/lib/agent/persist";
import { nameIn, signerNames } from "@/lib/signers";

/** The current (not withdrawn) issued copy of a certificate for a run, if one exists. */
export async function issuedFor(projectId: string, kind: string, runId: string): Promise<{ id: string; issuedAt: string; issuedBy: string } | null> {
  const [row] = await db
    .select({ id: issuedDocuments.id, issuedAt: issuedDocuments.issuedAt, issuedBy: issuedDocuments.issuedBy })
    .from(issuedDocuments)
    .where(and(eq(issuedDocuments.projectId, projectId), eq(issuedDocuments.kind, kind), arrayContains(issuedDocuments.signedRunIds, [runId]), isNull(issuedDocuments.withdrawnAt)))
    .limit(1);
  if (!row) return null;
  const names = await signerNames();
  return { id: row.id, issuedAt: row.issuedAt.toISOString(), issuedBy: nameIn(names, row.issuedBy) };
}

export interface PaymentCertificateView {
  runId: string;
  number: string;
  period: string;
  signedBy: string;
  signedAt: string;
  /** Scaled fraction – 10% is 1 000. */
  retentionRate: bigint;
  retentionLimit: Money | null;
  parts: { workExecuted: Money; variations: Money | null; dayworks: Money | null; materialsOnSite: Money | null };
  /** True where "previously certified" was derived from the certificate before rather than read. */
  previouslyDerived: boolean;
  figures: PaymentCertificate;
}

type Read<T> = { ok: true; value: T } | { ok: false; reason: string };

const amountOf = (fields: Map<string, string>, id: string, label: string, required: boolean): Read<Money | null> => {
  const text = fields.get(id);
  if (text === undefined || text.trim() === "") return required ? { ok: false, reason: `${label} is not stated on the signed valuation.` } : { ok: true, value: null };
  const read = readAmount(text);
  return read.ok ? { ok: true, value: read.amount } : { ok: false, reason: `${label} – ${read.reason}` };
};

/** Every signed valuation's figures, oldest first. */
async function signedValuationFields(projectId: string) {
  const signed = await db
    .select({ id: runs.id, signedBy: runs.signedBy, signedAt: runs.signedAt })
    .from(runs)
    .where(and(eq(runs.projectId, projectId), eq(runs.module, "/valuations"), isNotNull(runs.signedAt), isNull(runs.deletedAt)))
    .orderBy(asc(runs.signedAt));
  if (signed.length === 0) return [];
  const rows = await db.select().from(runFields).where(and(inArray(runFields.runId, signed.map((r) => r.id)), isNotNull(runFields.outputValue)));
  return signed.map((run) => ({
    run,
    fields: new Map(rows.filter((r) => r.runId === run.id).map((r) => [r.fieldId, r.outputValue!])),
  }));
}

/**
 * Every signed valuation as a certificate, oldest first – or, for the first one that cannot be
 * read, the reasons. Later certificates depend on earlier ones, so reading stops there.
 */
export async function paymentCertificates(projectId: string): Promise<{ certificates: PaymentCertificateView[]; refused: { runId: string; reasons: string[] } | null }> {
  const [valuations, contract, names] = await Promise.all([signedValuationFields(projectId), loadSignedOutput(projectId, "/contract"), signerNames()]);

  const limitText = contract.get("ct-retention-limit")?.value ?? null;
  const limitRead = limitText ? readAmount(limitText) : null;

  const certificates: PaymentCertificateView[] = [];
  for (const [index, { run, fields }] of valuations.entries()) {
    const reasons: string[] = [];
    const take = <T,>(r: Read<T>): T | null => (r.ok ? r.value : (reasons.push(r.reason), null));

    const workExecuted = take(amountOf(fields, "vl-work-executed", "Value of work executed", true));
    const variations = take(amountOf(fields, "vl-variations", "Approved variations", false));
    const dayworks = take(amountOf(fields, "vl-dayworks", "Dayworks", false));
    const materialsOnSite = take(amountOf(fields, "vl-materials", "Materials on site", false));
    const previouslyStated = take(amountOf(fields, "vl-previously", "Previously certified", false));

    const retentionText = fields.get("vl-retention") ?? contract.get("ct-retention")?.value ?? null;
    const retentionRead = retentionText ? readPercent(retentionText.replace(/\s*(of|on).*$/i, ""), { min: 0, max: 100 }) : null;
    if (!retentionRead) reasons.push("The retention percentage is not stated on the valuation or the signed contract.");
    else if (!retentionRead.ok) reasons.push(`Retention percentage – ${retentionRead.reason}`);
    if (limitRead && !limitRead.ok) reasons.push(`Retention limit on the contract – ${limitRead.reason}`);

    const periodRead = readDate(fields.get("vl-period") ?? "");
    if (!periodRead.ok) reasons.push(`Valuation period end – ${periodRead.reason}`);

    if (reasons.length > 0 || workExecuted === null || !retentionRead?.ok || !periodRead.ok) {
      return { certificates, refused: { runId: run.id, reasons } };
    }

    const previouslyDerived = previouslyStated === null;
    const previously = previouslyStated ?? (index === 0 ? money(0n) : certificates[index - 1]!.figures.net);
    const parts = { workExecuted, variations, dayworks, materialsOnSite };
    certificates.push({
      runId: run.id,
      number: fields.get("vl-number")?.trim() || String(index + 1),
      period: periodRead.date,
      signedBy: nameIn(names, run.signedBy!),
      signedAt: run.signedAt!.toISOString(),
      retentionRate: retentionRead.percent,
      retentionLimit: limitRead?.ok ? limitRead.amount : null,
      parts,
      previouslyDerived,
      figures: paymentCertificate({ parts, retentionRate: retentionRead.percent, retentionLimit: limitRead?.ok ? limitRead.amount : null, previouslyCertified: previously }),
    });
  }
  return { certificates, refused: null };
}
