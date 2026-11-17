"use server";

/**
 * The Tender Room – issue a tender on the signed bill, its addenda, its returns, its opening.
 *
 * Times are entered in South African time (the practice's) and held as timestamps. Sums cross
 * `readAmount`. After the opening the database refuses changes to the tender's returns and
 * addenda (0029's trigger); these actions say so first, in words.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth";
import { db } from "@/db/client";
import { contacts, tenderAcknowledgements, tenderAddenda, tenderInvitees, tenderReturns, tenders } from "@/db/schema";
import { readAmount } from "@/domain/amount";
import { canOpen, openingRegister } from "@/domain/tender-room";
import { loadSignedBill } from "@/lib/agent/persist-bill";

export type TenderRoomAction = { ok: true } | { ok: false; reason: string; errors?: Record<string, string> };

const done = (projectId: string): TenderRoomAction => {
  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true };
};
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * "2026-05-14T12:00" from a datetime field, read as South African Standard Time (UTC+2, no daylight
 * saving) – the time printed on the invitation and on the clock in the tender box.
 */
function readLocal(text: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+02:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function ownTender(projectId: string, tenderId: string) {
  const [t] = await db.select().from(tenders).where(and(eq(tenders.id, tenderId), eq(tenders.projectId, projectId))).limit(1);
  return t ?? null;
}

const openedRefusal = { ok: false as const, reason: "The tenders were opened – what was received and opened is the record, and cannot change." };

export async function startTender(projectId: string, input: { reference: string; closingAt: string; validityDays: string; briefingAt: string; briefingVenue: string }): Promise<TenderRoomAction> {
  const session = await requireSession();
  const bill = await loadSignedBill(projectId, "/bill");
  if (!bill) return { ok: false, reason: "A tender is issued on a signed bill. Sign the Bill of Quantities first." };

  const errors: Record<string, string> = {};
  const reference = clean(input.reference, 80);
  if (!reference) errors.reference = "Give the tender a reference – it is quoted on every return.";
  const closingAt = readLocal(input.closingAt);
  if (!closingAt) errors.closingAt = "Give the closing date and time.";
  else if (closingAt.getTime() < Date.now()) errors.closingAt = "The closing time is in the past.";
  const validity = Number(input.validityDays || "90");
  if (!Number.isInteger(validity) || validity < 1 || validity > 365) errors.validityDays = "Validity is a whole number of days, 1 to 365.";
  const briefingAt = input.briefingAt.trim() ? readLocal(input.briefingAt) : null;
  if (input.briefingAt.trim() && !briefingAt) errors.briefingAt = "Give the briefing date and time, or leave it empty.";
  if (briefingAt && closingAt && briefingAt >= closingAt) errors.briefingAt = "The briefing is before the closing time.";
  if (Object.keys(errors).length) return { ok: false, reason: "Some fields need attention.", errors };

  try {
    await db.insert(tenders).values({
      projectId,
      billRunId: bill.runId,
      reference,
      closingAt: closingAt!,
      validityDays: validity,
      briefingAt,
      briefingVenue: clean(input.briefingVenue, 200) || null,
      createdBy: session.email,
    });
  } catch {
    return { ok: false, reason: "A tender is already in progress on this project. Open it before starting another." };
  }
  return done(projectId);
}

export async function addInvitee(projectId: string, tenderId: string, input: { contactId: string; company: string; contactName: string; email: string }): Promise<TenderRoomAction> {
  await requireSession();
  const tender = await ownTender(projectId, tenderId);
  if (!tender) return { ok: false, reason: "That tender is not on this project." };
  if (tender.openedAt) return openedRefusal;

  let company = clean(input.company, 200);
  let contactName = clean(input.contactName, 120) || null;
  let email = clean(input.email, 200) || null;
  const contactId = clean(input.contactId, 40) || null;
  if (contactId) {
    const [c] = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
    if (!c) return { ok: false, reason: "That contact is not in the directory." };
    company = c.organisation;
    contactName = c.person;
    email = c.email;
  }
  if (!company) return { ok: false, reason: "Name the tenderer.", errors: { company: "Name the tenderer." } };

  try {
    await db.insert(tenderInvitees).values({ tenderId, contactId, company, contactName, email });
  } catch {
    return { ok: false, reason: `${company} is already invited.` };
  }
  return done(projectId);
}

export async function removeInvitee(projectId: string, tenderId: string, inviteeId: string): Promise<TenderRoomAction> {
  await requireSession();
  const tender = await ownTender(projectId, tenderId);
  if (!tender) return { ok: false, reason: "That tender is not on this project." };
  if (tender.openedAt) return openedRefusal;
  if (tender.issuedAt) return { ok: false, reason: "The tender was issued to this tenderer. Mark them as declined instead – the record keeps who was invited." };
  await db.delete(tenderInvitees).where(and(eq(tenderInvitees.id, inviteeId), eq(tenderInvitees.tenderId, tenderId)));
  return done(projectId);
}

/** Issue: the tenderers and the terms are set. At least three is the norm; fewer is allowed and said. */
export async function issueTender(projectId: string, tenderId: string): Promise<TenderRoomAction> {
  const session = await requireSession();
  const tender = await ownTender(projectId, tenderId);
  if (!tender) return { ok: false, reason: "That tender is not on this project." };
  if (tender.issuedAt) return { ok: false, reason: "The tender is already issued." };
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(tenderInvitees).where(eq(tenderInvitees.tenderId, tenderId));
  if (count === 0) return { ok: false, reason: "Invite at least one tenderer before issuing." };
  if (tender.closingAt.getTime() < Date.now()) return { ok: false, reason: "The closing time has passed. Set a new one before issuing." };
  await db.update(tenders).set({ issuedAt: new Date(), issuedBy: session.email, updatedAt: new Date() }).where(eq(tenders.id, tenderId));
  return done(projectId);
}

export async function issueAddendum(projectId: string, tenderId: string, input: { subject: string; body: string }): Promise<TenderRoomAction> {
  const session = await requireSession();
  const tender = await ownTender(projectId, tenderId);
  if (!tender) return { ok: false, reason: "That tender is not on this project." };
  if (tender.openedAt) return openedRefusal;
  if (!tender.issuedAt) return { ok: false, reason: "Issue the tender first – an addendum amends documents the tenderers already have." };
  if (tender.closingAt.getTime() < Date.now()) return { ok: false, reason: "The tender has closed. An addendum after closing would reach tenderers who have already priced." };
  const subject = clean(input.subject, 200);
  const body = clean(input.body, 4000);
  const errors: Record<string, string> = {};
  if (!subject) errors.subject = "Give the addendum a subject.";
  if (!body) errors.body = "Say what the addendum changes.";
  if (Object.keys(errors).length) return { ok: false, reason: "The addendum needs attention.", errors };

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`addendum:${tenderId}`}))`);
    const [row] = await tx.select({ max: sql<number | null>`max(${tenderAddenda.number})` }).from(tenderAddenda).where(eq(tenderAddenda.tenderId, tenderId));
    await tx.insert(tenderAddenda).values({ tenderId, number: (row?.max ?? 0) + 1, subject, body, issuedBy: session.email });
  });
  return done(projectId);
}

export async function setAcknowledged(projectId: string, tenderId: string, addendumId: string, inviteeId: string, acknowledged: boolean): Promise<TenderRoomAction> {
  await requireSession();
  const tender = await ownTender(projectId, tenderId);
  if (!tender) return { ok: false, reason: "That tender is not on this project." };
  if (tender.openedAt) return openedRefusal;
  if (acknowledged) {
    await db.insert(tenderAcknowledgements).values({ addendumId, inviteeId }).onConflictDoNothing();
  } else {
    await db.delete(tenderAcknowledgements).where(and(eq(tenderAcknowledgements.addendumId, addendumId), eq(tenderAcknowledgements.inviteeId, inviteeId)));
  }
  return done(projectId);
}

/** A return received – the time decides whether it is late. */
export async function recordReturn(projectId: string, tenderId: string, inviteeId: string, input: { receivedAt: string; sum: string; qualifications: string }): Promise<TenderRoomAction> {
  await requireSession();
  const tender = await ownTender(projectId, tenderId);
  if (!tender) return { ok: false, reason: "That tender is not on this project." };
  if (tender.openedAt) return openedRefusal;
  if (!tender.issuedAt) return { ok: false, reason: "The tender has not been issued – nothing can have been returned." };
  const errors: Record<string, string> = {};
  const receivedAt = readLocal(input.receivedAt);
  if (!receivedAt) errors.receivedAt = "Give the date and time it was received – it decides whether it is late.";
  else if (receivedAt.getTime() > Date.now() + 60_000) errors.receivedAt = "That is in the future.";
  let sum: bigint | null = null;
  if (input.sum.trim()) {
    const read = readAmount(input.sum);
    if (!read.ok) errors.sum = read.reason;
    else if (read.amount <= 0n) errors.sum = "A tender sum is more than nought.";
    else sum = read.amount;
  }
  if (Object.keys(errors).length) return { ok: false, reason: "The return needs attention.", errors };
  await db
    .update(tenderInvitees)
    .set({ receivedAt, tenderSum: sum, qualifications: clean(input.qualifications, 2000) || null, declinedAt: null })
    .where(and(eq(tenderInvitees.id, inviteeId), eq(tenderInvitees.tenderId, tenderId)));
  return done(projectId);
}

export async function markDeclined(projectId: string, tenderId: string, inviteeId: string): Promise<TenderRoomAction> {
  await requireSession();
  const tender = await ownTender(projectId, tenderId);
  if (!tender) return { ok: false, reason: "That tender is not on this project." };
  if (tender.openedAt) return openedRefusal;
  await db
    .update(tenderInvitees)
    .set({ declinedAt: new Date(), receivedAt: null, tenderSum: null })
    .where(and(eq(tenderInvitees.id, inviteeId), eq(tenderInvitees.tenderId, tenderId)));
  return done(projectId);
}

/**
 * Open the tenders – at or after the closing time, once. The on-time sums become returns against
 * the signed bill, which Tender Analysis compares; late returns are recorded and not opened.
 */
export async function openTenders(projectId: string, tenderId: string): Promise<TenderRoomAction> {
  const session = await requireSession();
  const tender = await ownTender(projectId, tenderId);
  if (!tender) return { ok: false, reason: "That tender is not on this project." };
  if (!tender.issuedAt) return { ok: false, reason: "The tender was never issued." };
  const may = canOpen(tender.closingAt.toISOString(), tender.openedAt?.toISOString() ?? null);
  if (!may.ok) return may;

  const invitees = await db.select().from(tenderInvitees).where(eq(tenderInvitees.tenderId, tenderId));
  const register = openingRegister(
    invitees.map((i) => ({ inviteeId: i.id, company: i.company, receivedAt: i.receivedAt?.toISOString() ?? null, sum: i.tenderSum, declined: i.declinedAt !== null, acknowledged: [] })),
    tender.closingAt.toISOString(),
    [],
  );

  await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: tenderReturns.id, tenderer: tenderReturns.tenderer })
      .from(tenderReturns)
      .where(and(eq(tenderReturns.projectId, projectId), eq(tenderReturns.billRunId, tender.billRunId), isNull(tenderReturns.deletedAt)));
    for (const o of [...register.opened, ...register.noSum.map((r) => ({ ...r, rank: 0, missingAddenda: [] }))]) {
      const match = existing.find((e) => e.tenderer.toLowerCase() === o.company.toLowerCase());
      let returnId = match?.id;
      if (match) {
        await tx.update(tenderReturns).set({ statedSum: o.sum, receivedAt: new Date(o.receivedAt!), updatedAt: new Date() }).where(eq(tenderReturns.id, match.id));
      } else {
        const [created] = await tx
          .insert(tenderReturns)
          .values({ projectId, billRunId: tender.billRunId, tenderer: o.company, statedSum: o.sum, receivedAt: new Date(o.receivedAt!), createdBy: session.email })
          .returning({ id: tenderReturns.id });
        returnId = created!.id;
      }
      await tx.update(tenderInvitees).set({ returnId }).where(eq(tenderInvitees.id, o.inviteeId));
    }
    // Last: once this is set the trigger freezes the returns above.
    await tx.update(tenders).set({ openedAt: new Date(), openedBy: session.email, updatedAt: new Date() }).where(eq(tenders.id, tenderId));
  });
  return done(projectId);
}
