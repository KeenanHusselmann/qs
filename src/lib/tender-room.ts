/**
 * The Tender Room for a project – the tender in progress (or the last one opened), its tenderers,
 * addenda and acknowledgements, and the opening register.
 */

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db/client";
import { contacts, tenderAcknowledgements, tenderAddenda, tenderInvitees, tenders } from "@/db/schema";
import { isLate, openingRegister, unacknowledged } from "@/domain/tender-room";
import { billTotal } from "@/lib/agent/bill";
import { loadSignedBill } from "@/lib/agent/persist-bill";
import { nameIn, signerNames } from "@/lib/signers";

export interface InviteeView {
  id: string;
  company: string;
  contactName: string | null;
  email: string | null;
  receivedAt: string | null;
  /** Minor units as a decimal string. */
  sum: string | null;
  qualifications: string | null;
  declined: boolean;
  late: boolean;
  acknowledged: number[];
  missingAddenda: number[];
}

export interface AddendumView {
  id: string;
  number: number;
  subject: string;
  body: string;
  issuedAt: string;
  issuedBy: string;
}

export interface TenderView {
  id: string;
  reference: string;
  closingAt: string;
  validityDays: number;
  briefingAt: string | null;
  briefingVenue: string | null;
  issuedAt: string | null;
  issuedBy: string | null;
  openedAt: string | null;
  openedBy: string | null;
  invitees: InviteeView[];
  addenda: AddendumView[];
  /** Present once opened (and previewed before, for the page to say what opening will do). */
  register: {
    opened: { company: string; sum: string; rank: number; missingAddenda: number[]; receivedAt: string }[];
    noSum: string[];
    late: { company: string; receivedAt: string }[];
    declined: string[];
    noReturn: string[];
  };
}

export interface TenderRoomData {
  bill: { runId: string; total: string; by: string; at: string; items: number } | null;
  tender: TenderView | null;
  contractors: { id: string; organisation: string; person: string | null; email: string | null }[];
}

export async function loadTenderRoom(projectId: string): Promise<TenderRoomData> {
  const [signed, names, contractorRows] = await Promise.all([
    loadSignedBill(projectId, "/bill"),
    signerNames(),
    db
      .select({ id: contacts.id, organisation: contacts.organisation, person: contacts.person, email: contacts.email })
      .from(contacts)
      .where(and(eq(contacts.kind, "contractor"), isNull(contacts.deletedAt)))
      .orderBy(asc(contacts.organisation)),
  ]);

  const [open] = await db.select().from(tenders).where(and(eq(tenders.projectId, projectId), isNull(tenders.openedAt))).limit(1);
  const [last] = open ? [open] : await db.select().from(tenders).where(eq(tenders.projectId, projectId)).orderBy(desc(tenders.openedAt)).limit(1);
  const t = open ?? last ?? null;

  let tender: TenderView | null = null;
  if (t) {
    const invitees = await db.select().from(tenderInvitees).where(eq(tenderInvitees.tenderId, t.id)).orderBy(asc(tenderInvitees.createdAt));
    const addenda = await db.select().from(tenderAddenda).where(eq(tenderAddenda.tenderId, t.id)).orderBy(asc(tenderAddenda.number));
    const acks = addenda.length
      ? await db.select().from(tenderAcknowledgements).where(inArray(tenderAcknowledgements.addendumId, addenda.map((a) => a.id)))
      : [];
    const numberOf = new Map(addenda.map((a) => [a.id, a.number]));
    const allNumbers = addenda.map((a) => a.number);
    const closingAt = t.closingAt.toISOString();

    const views: InviteeView[] = invitees.map((i) => {
      const acknowledged = acks.filter((a) => a.inviteeId === i.id).map((a) => numberOf.get(a.addendumId)!).sort((a, b) => a - b);
      const receivedAt = i.receivedAt?.toISOString() ?? null;
      return {
        id: i.id,
        company: i.company,
        contactName: i.contactName,
        email: i.email,
        receivedAt,
        sum: i.tenderSum === null ? null : i.tenderSum.toString(),
        qualifications: i.qualifications,
        declined: i.declinedAt !== null,
        late: isLate(receivedAt, closingAt),
        acknowledged,
        missingAddenda: unacknowledged(allNumbers, acknowledged),
      };
    });

    const reg = openingRegister(
      views.map((v) => ({ inviteeId: v.id, company: v.company, receivedAt: v.receivedAt, sum: v.sum === null ? null : BigInt(v.sum), declined: v.declined, acknowledged: v.acknowledged })),
      closingAt,
      allNumbers,
    );

    tender = {
      id: t.id,
      reference: t.reference,
      closingAt,
      validityDays: t.validityDays,
      briefingAt: t.briefingAt?.toISOString() ?? null,
      briefingVenue: t.briefingVenue,
      issuedAt: t.issuedAt?.toISOString() ?? null,
      issuedBy: t.issuedBy ? nameIn(names, t.issuedBy) : null,
      openedAt: t.openedAt?.toISOString() ?? null,
      openedBy: t.openedBy ? nameIn(names, t.openedBy) : null,
      invitees: views,
      addenda: addenda.map((a) => ({ id: a.id, number: a.number, subject: a.subject, body: a.body, issuedAt: a.issuedAt.toISOString(), issuedBy: nameIn(names, a.issuedBy) })),
      register: {
        opened: reg.opened.map((o) => ({ company: o.company, sum: o.sum!.toString(), rank: o.rank, missingAddenda: o.missingAddenda, receivedAt: o.receivedAt! })),
        noSum: reg.noSum.map((r) => r.company),
        late: reg.late.map((r) => ({ company: r.company, receivedAt: r.receivedAt! })),
        declined: reg.declined.map((r) => r.company),
        noReturn: reg.noReturn.map((r) => r.company),
      },
    };
  }

  return {
    bill: signed
      ? { runId: signed.runId, total: billTotal(signed.rows, true).toString(), by: signed.by, at: signed.at, items: signed.rows.filter((r) => r.rowType === "item").length }
      : null,
    tender,
    contractors: contractorRows,
  };
}
