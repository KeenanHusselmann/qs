/**
 * A payment certificate and a certificate of practical completion, as the documents a contractor
 * receives.
 *
 * One page each, laid out the way a South African QS practice issues them: who it is from and to,
 * the contract it is under, the stack of figures in the order they add up, and the signature block
 * naming who certified it and when. Every figure on the page comes from `domain/certificates.ts`
 * through `lib/certificates.ts`; nothing is computed here but the layout.
 */

import { formatMoney, type Money } from "@/domain/money";
import { formatDate } from "@/lib/dates";
import type { PaymentCertificateView } from "@/lib/certificates";
import { createPdf, PAGE } from "@/lib/pdf/writer";
import { contractTerms } from "@/domain/contract-form";

export interface CertificateParties {
  practice: string;
  projectName: string;
  code: string | null;
  employer: string | null;
  contractor: string | null;
  contractForm: string | null;
  contractSum: string | null;
  issuedBy: string;
  issuedOn: string;
}

const W = PAGE.textWidth;
const LABEL = { x: 0, width: W * 0.62 };
const FIGURE = { x: W * 0.62, width: W * 0.38 };
// A deduction prints in brackets with its currency inside them – (R 45 000,00) – the accounting
// convention a certificate is read in.
const R = (m: Money) => formatMoney(m, { accounting: true, symbol: "R" });

function head(doc: ReturnType<typeof createPdf>, title: string, number: string | null, parties: CertificateParties) {
  doc.text(parties.practice, { size: 9, grey: 0.35, gap: 2 });
  doc.text(title, { size: 16, bold: true, gap: 2 });
  if (number) doc.text(number, { size: 11, gap: 10 });
  doc.rule({ gap: 8 });

  const line = (label: string, value: string | null) =>
    doc.row([
      { text: label, x: 0, width: 130, grey: 0.4 },
      { text: value ?? "not stated", x: 134, width: W - 134 },
    ]);
  line("Project", `${parties.projectName}${parties.code ? ` · ${parties.code}` : ""}`);
  line("Employer", parties.employer);
  line("Contractor", parties.contractor);
  line("Contract", parties.contractForm);
  line("Contract sum", parties.contractSum);
  doc.space(6);
  doc.rule({ gap: 10 });
}

function figure(doc: ReturnType<typeof createPdf>, label: string, value: string, options: { bold?: boolean; grey?: number } = {}) {
  doc.row(
    [
      { text: label, ...LABEL, bold: options.bold, grey: options.grey },
      { text: value, ...FIGURE, align: "right", bold: options.bold },
    ],
    { size: options.bold ? 10.5 : 9.5, gap: 3 },
  );
}

function signature(doc: ReturnType<typeof createPdf>, certifiedBy: string, on: string, parties: CertificateParties, note: string) {
  const terms = contractTerms(parties.contractForm);
  doc.space(18);
  doc.rule({ gap: 8 });
  doc.text(note, { size: 8.5, grey: 0.35, gap: 12 });
  doc.row([
    { text: "Certified by", x: 0, width: 130, grey: 0.4 },
    { text: certifiedBy, x: 134, width: W - 134, bold: true },
  ]);
  doc.row([
    { text: "Signed off", x: 0, width: 130, grey: 0.4 },
    { text: on, x: 134, width: W - 134 },
  ]);
  doc.row([
    { text: "Issued", x: 0, width: 130, grey: 0.4 },
    { text: `${parties.issuedOn} by ${parties.issuedBy}`, x: 134, width: W - 134 },
  ]);
  doc.space(28);
  doc.row([
    { text: "_______________________________", x: 0, width: 240 },
    { text: "_______________________", x: 300, width: 180 },
  ]);
  doc.row([
    { text: terms.certifier, x: 0, width: 240, grey: 0.4 },
    { text: "Date", x: 300, width: 180, grey: 0.4 },
  ]);
}

export function paymentCertificatePdf(cert: PaymentCertificateView, parties: CertificateParties): Buffer {
  // FIDIC calls it an Interim Payment Certificate, issued by the Engineer; JBCC a Payment Certificate.
  const name = contractTerms(parties.contractForm).paymentCertificate;
  const doc = createPdf({ title: `${parties.projectName} – ${name} ${cert.number}` });
  doc.footerOnEveryPage(() => `${parties.practice} · ${parties.projectName} · ${name} ${cert.number}`);

  head(doc, name, `No. ${cert.number} · valuation to ${formatDate(cert.period)}`, parties);

  const f = cert.figures;
  const pct = (scaled: bigint) => `${(Number(scaled) / 100).toLocaleString("en-ZA", { maximumFractionDigits: 2 })}%`;

  figure(doc, "Value of work executed", R(cert.parts.workExecuted));
  if (cert.parts.variations !== null) figure(doc, "Approved variations", R(cert.parts.variations));
  if (cert.parts.dayworks !== null) figure(doc, "Dayworks", R(cert.parts.dayworks));
  if (cert.parts.materialsOnSite !== null) figure(doc, "Materials on site", R(cert.parts.materialsOnSite));
  doc.rule({ gap: 3, grey: 0.7 });
  doc.space(3);
  figure(doc, "Gross valuation", R(f.gross), { bold: true });
  figure(
    doc,
    f.limited
      ? `Less retention at ${pct(cert.retentionRate)}, limited to ${R(cert.retentionLimit!)}`
      : `Less retention at ${pct(cert.retentionRate)}${cert.retentionLimit !== null ? ` (limit ${R(cert.retentionLimit)})` : ""}`,
    R(-f.retention as Money),
  );
  doc.rule({ gap: 3, grey: 0.7 });
  doc.space(3);
  figure(doc, "Net valuation", R(f.net), { bold: true });
  figure(doc, `Less previously certified${cert.previouslyDerived ? " (net of the certificate before)" : ""}`, R(-f.previouslyCertified as Money));
  doc.rule({ gap: 3, grey: 0.7 });
  doc.space(3);
  figure(doc, "Amount due, excluding VAT", R(f.dueExVat), { bold: true });
  figure(doc, "VAT at 15%", R(f.vat));
  doc.rule({ gap: 3, thickness: 1.2, grey: 0.1 });
  doc.space(5);
  figure(doc, "AMOUNT DUE FOR PAYMENT", R(f.due), { bold: true });

  signature(
    doc,
    cert.signedBy,
    formatDate(cert.signedAt),
    parties,
    `Every figure above is the signed valuation's own, read without alteration; retention and VAT are each rounded once to the cent. ${
      f.dueExVat < 0n ? "The amount due is negative: this certificate corrects an over-certification and is recovered from the contractor." : ""
    }`.trim(),
  );

  return doc.build();
}
