/**
 * The Tender Room's documents – the invitation to tender, and the record of tenders opened.
 *
 * The bill tenderers price is the signed bill with its rates and amounts left blank, rendered by
 * `bill-pdf.ts` like any other bill; these two are the letters around it.
 */

import { formatMoney, money } from "@/domain/money";
import { formatDate } from "@/lib/dates";
import type { TenderView } from "@/lib/tender-room";
import { createPdf, PAGE } from "@/lib/pdf/writer";

const W = PAGE.textWidth;
const R = (minor: string) => `R ${formatMoney(money(BigInt(minor)))}`;
/** "14 May 2026 at 12:00" in South African time, the clock the tender box keeps. */
const at = (iso: string) => {
  const d = new Date(iso);
  const local = new Date(d.getTime() + 2 * 3_600_000);
  return `${formatDate(local.toISOString().slice(0, 10))} at ${local.toISOString().slice(11, 16)}`;
};

interface Parties {
  practice: string;
  projectName: string;
  code: string | null;
  employer: string | null;
  issuedBy: string;
  issuedOn: string;
  billTotalItems: number;
}

function head(doc: ReturnType<typeof createPdf>, title: string, tender: TenderView, parties: Parties) {
  doc.text(parties.practice, { size: 9, grey: 0.35, gap: 2 });
  doc.text(title, { size: 16, bold: true, gap: 2 });
  doc.text(`${parties.projectName}${parties.code ? ` · ${parties.code}` : ""} · Tender ${tender.reference}`, { size: 10.5, gap: 10 });
  doc.rule({ gap: 8 });
}

const fact = (doc: ReturnType<typeof createPdf>, label: string, value: string) =>
  doc.row([
    { text: label, x: 0, width: 150, grey: 0.4 },
    { text: value, x: 154, width: W - 154 },
  ]);

export function invitationPdf(tender: TenderView, parties: Parties): Buffer {
  const doc = createPdf({ title: `${parties.projectName} – Invitation to tender ${tender.reference}` });
  doc.footerOnEveryPage(() => `${parties.practice} · ${parties.projectName} · Invitation to tender ${tender.reference}`);
  head(doc, "Invitation to Tender", tender, parties);

  doc.text(
    `${parties.employer ?? "The employer"} invites tenders for the works described in the enclosed bill of quantities (${parties.billTotalItems} items). Tenders are to be priced on the bill, signed, and delivered by the closing time below. A tender received after the closing time will not be opened.`,
    { size: 10, gap: 10 },
  );

  fact(doc, "Tender reference", tender.reference);
  fact(doc, "Closing time", at(tender.closingAt));
  fact(doc, "Tender validity", `${tender.validityDays} days from the closing time`);
  if (tender.briefingAt) fact(doc, "Briefing / site visit", `${at(tender.briefingAt)}${tender.briefingVenue ? `, ${tender.briefingVenue}` : ""}`);
  doc.space(8);

  doc.text("Invited to tender", { size: 10.5, bold: true, gap: 4 });
  tender.invitees.forEach((i, n) => doc.text(`${n + 1}. ${i.company}${i.contactName ? ` – attention ${i.contactName}` : ""}`, { size: 9.5, gap: 2 }));

  if (tender.addenda.length > 0) {
    doc.space(8);
    doc.text("Addenda issued", { size: 10.5, bold: true, gap: 4 });
    for (const a of tender.addenda) doc.text(`Addendum ${a.number} (${formatDate(a.issuedAt)}): ${a.subject}`, { size: 9.5, gap: 2 });
  }

  doc.space(12);
  doc.rule({ gap: 8 });
  doc.text(`Issued ${parties.issuedOn} by ${parties.issuedBy}. Acknowledge receipt of this invitation and of every addendum in writing; a tender priced without an addendum may be treated as qualified.`, { size: 8.5, grey: 0.35 });
  return doc.build();
}

export function openingRecordPdf(tender: TenderView, parties: Parties): Buffer {
  const doc = createPdf({ title: `${parties.projectName} – Record of tenders opened ${tender.reference}` });
  doc.footerOnEveryPage(() => `${parties.practice} · ${parties.projectName} · Record of tenders opened ${tender.reference}`);
  head(doc, "Record of Tenders Opened", tender, parties);

  fact(doc, "Closing time", at(tender.closingAt));
  fact(doc, "Opened", tender.openedAt ? `${at(tender.openedAt)} by ${tender.openedBy ?? ""}` : "not yet opened");
  fact(doc, "Addenda issued", tender.addenda.length === 0 ? "none" : tender.addenda.map((a) => String(a.number)).join(", "));
  doc.space(8);

  doc.row(
    [
      { text: "Rank", x: 0, width: 40, bold: true, grey: 0.4 },
      { text: "Tenderer", x: 44, width: 230, bold: true, grey: 0.4 },
      { text: "Received", x: 278, width: 110, bold: true, grey: 0.4 },
      { text: "Tender sum", x: 392, width: W - 392, bold: true, grey: 0.4, align: "right" },
    ],
    { size: 8.5 },
  );
  doc.rule({ gap: 4, grey: 0.7 });
  for (const o of tender.register.opened) {
    doc.row([
      { text: String(o.rank), x: 0, width: 40 },
      { text: `${o.company}${o.missingAddenda.length ? `  (addendum ${o.missingAddenda.join(", ")} not acknowledged)` : ""}`, x: 44, width: 230 },
      { text: at(o.receivedAt), x: 278, width: 110 },
      { text: R(o.sum), x: 392, width: W - 392, align: "right", bold: o.rank === 1 },
    ]);
  }
  if (tender.register.opened.length === 0) doc.text("No tender was opened.", { size: 9.5, grey: 0.4, gap: 4 });

  const list = (label: string, names: string[]) => {
    if (names.length === 0) return;
    doc.space(6);
    doc.text(`${label}: ${names.join("; ")}.`, { size: 9.5, gap: 3 });
  };
  list("Opened, no sum stated", tender.register.noSum);
  list("Received after the closing time – not opened", tender.register.late.map((l) => `${l.company} (${at(l.receivedAt)})`));
  list("Declined to tender", tender.register.declined);
  list("No return received", tender.register.noReturn);

  doc.space(12);
  doc.rule({ gap: 8 });
  doc.text(`Issued ${parties.issuedOn} by ${parties.issuedBy}. Sums are as stated on the forms of tender, before arithmetic checking; the adjudication follows in the tender report.`, { size: 8.5, grey: 0.35 });
  return doc.build();
}
