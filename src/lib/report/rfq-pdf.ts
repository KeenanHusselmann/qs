/**
 * The evaluation of the responses to an RFQ, as issued – D1.3 Quotations.
 *
 * The recommendation and its rule first, then the responses compared – price as stated and as
 * corrected, like for like on the scope every response prices, scope, requirements and the facts
 * they disagree on – then each response's arithmetic line by line, and the clarifications to put
 * before appointment. Figures come from `domain/quote-check.ts` through `lib/rfq.ts`; nothing is
 * computed here but the layout.
 */

import type { CheckedResponse } from "@/domain/quote-check";
import type { RfqView } from "@/lib/rfq";
import { createPdf, PAGE } from "@/lib/pdf/writer";

export interface RfqSubject {
  practice: string;
  projectName: string;
  code: string | null;
  client: string | null;
  issuedBy: string;
  issuedOn: string;
}

const W = PAGE.textWidth;
const R = (cents: number | null) => {
  if (cents === null) return "–";
  const [w, f] = (Math.abs(cents) / 100).toFixed(2).split(".");
  return `${cents < 0 ? "-" : ""}R ${w!.replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${f}`;
};
const pct = (n: number) => `${n.toFixed(2).replace(".", ",")}%`;

export function rfqPdf(rfq: RfqView, s: RfqSubject): Buffer {
  const rec = rfq.recommendation!;
  const rows: CheckedResponse[] = rfq.evaluated.map((e) => e.result!);
  const doc = createPdf({ title: `${s.projectName} – Evaluation of quotations` });
  doc.footerOnEveryPage((page, total) => `${s.practice} · ${s.projectName}${s.code ? ` · ${s.code}` : ""}   –   Evaluation of quotations   –   Page ${page} of ${total}`);

  doc.text(s.practice, { size: 9, grey: 0.35, gap: 2 });
  doc.text("Evaluation of quotations", { size: 16, bold: true, gap: 2 });
  doc.text(rfq.title, { size: 11.5, gap: 2 });
  doc.text(`${s.projectName}${s.code ? ` · ${s.code}` : ""}`, { size: 10, grey: 0.3, gap: 10 });
  doc.rule({ gap: 8 });

  const line = (label: string, value: string) =>
    doc.row([
      { text: label, x: 0, width: 110, grey: 0.4 },
      { text: value, x: 114, width: W - 114 },
    ]);
  if (s.client) line("Client", s.client);
  line("Responses", rows.map((r) => r.supplier).join("; "));
  line("Scope required", rfq.scope.join("; "));
  line("Issued", `${s.issuedOn} by ${s.issuedBy}`);
  if (rfq.decision) {
    line("Decision", `${rfq.decision.name}, by ${rfq.decision.by} – ${rfq.decision.followsRecommendation ? "as recommended" : "against the recommendation"}${rfq.decision.reason ? `: ${rfq.decision.reason}` : ""}`);
  }
  doc.space(6);

  // ── The recommendation ─────────────────────────────────────────────────────────────────────
  doc.heading("Recommendation", { size: 11.5 });
  doc.text(rec.headline, { size: 10.5, bold: true, gap: 4 });
  for (const r of rec.reasons) doc.text(`•  ${r}`, { size: 9.5, indent: 8, gap: 2 });
  doc.text(
    "The rule: responses covering more of the required scope rank first, then those meeting more of the requirements, then the lowest price with its arithmetic corrected. Where the responses price different scopes, the preference is provisional until the clarifications below are answered.",
    { size: 8.5, grey: 0.35, gap: 4 },
  );

  // ── Compared ───────────────────────────────────────────────────────────────────────────────
  const label = 150;
  const col = (W - label) / Math.max(rows.length, 1);
  const compare = (name: string, values: string[], bold = false) =>
    doc.row(
      [{ text: name, x: 0, width: label - 6, grey: 0.35 }, ...values.map((v, i) => ({ text: v, x: label + i * col, width: col - 8, bold }))],
      { size: 8.5, gap: 3 },
    );
  doc.heading("The responses compared", { size: 11.5 });
  doc.row(
    [{ text: "", x: 0, width: label - 6 }, ...rows.map((r, i) => ({ text: `${r.supplier}${rec.preferred === i ? " (preferred)" : ""}`, x: label + i * col, width: col - 8, bold: true }))],
    { size: 9 },
  );
  doc.rule({ thickness: 0.8, gap: 4 });
  compare("Reference, date", rows.map((r) => [r.reference, r.date].filter(Boolean).join(" · ") || "not stated"));
  compare("Signed by", rows.map((r) => r.signatory ?? "not stated"));
  compare("Price excl. VAT, as stated", rows.map((r) => R(r.statedTotal)));
  compare(
    "Price excl. VAT, corrected",
    rows.map((r) => `${R(r.correctedTotal)}${r.correctedTotal !== null && r.statedTotal !== null && r.correctedTotal !== r.statedTotal ? ` (${R(r.correctedTotal - r.statedTotal)})` : ""}`),
    true,
  );
  for (const l of rec.likeForLike) {
    compare(`Like for like – ${l.item}`, l.prices.map((p) => (p.net === null ? "not priced separately" : `${p.derived ? "about " : ""}${R(p.net)}${p.rate !== null ? ` – ${pct(p.rate)} of ${R(p.basis)}` : ""}${p.derived ? " (derived from its breakdown, not a price offered)" : ""}`)));
  }
  compare("Arithmetic errors", rows.map((r) => (r.errors.length ? r.errors.map((e) => `${e.label}: ${R(e.stated)} stated, ${R(e.computed)} by its own figures`).join("; ") : "none")));
  rfq.scope.forEach((item, i) => compare(`Scope – ${item}`, rows.map((r) => r.scope[i]?.status ?? "not stated")));
  compare("Counts that do not add up", rows.map((r) => r.tallies.filter((t) => t.verdict === "error").map((t) => `${t.label}: ${t.stated} stated, ${t.computed} by its figures`).join("; ") || "none"));
  compare("Queries on the document", rows.map((r) => r.observations.map((o) => o.text).join(" ") || "–"));
  compare("Priced beyond the RFQ", rows.map((r) => r.extraScope.join("; ") || "–"));
  compare("Exclusions", rows.map((r) => r.exclusions.join("; ") || "–"));
  rfq.requirements.forEach((req, i) => compare(req, rows.map((r) => r.requirements[i]?.status ?? "not stated")));
  for (const d of rec.differences) compare(`${d.fact} (differs)`, rows.map((r) => d.values.find((v) => v.supplier === r.supplier)?.value ?? "not stated"));
  doc.rule({ gap: 4 });

  // ── Risks ──────────────────────────────────────────────────────────────────────────────────
  if (rec.risks.length) {
    doc.heading("Risks noted in the responses", { size: 11.5 });
    for (const k of rec.risks) doc.text(`•  ${k.supplier}: ${k.text}`, { size: 9, indent: 8, gap: 2 });
  }

  // ── Clarifications ─────────────────────────────────────────────────────────────────────────
  if (rec.clarifications.length) {
    doc.heading("Clarifications before appointment", { size: 11.5 });
    rec.clarifications.forEach((c, i) => doc.text(`${i + 1}.  ${c}`, { size: 9, indent: 8, gap: 2 }));
  }

  // ── Each response's arithmetic ─────────────────────────────────────────────────────────────
  const C = {
    line: { x: 0, width: W - 330 },
    stated: { x: W - 326, width: 92 },
    computed: { x: W - 230, width: 92 },
    verdict: { x: W - 134, width: 134 },
  };
  for (const r of rows) {
    doc.heading(`${r.supplier} – every price line checked`, { size: 11.5 });
    doc.row(
      [
        { text: "Line", ...C.line, bold: true },
        { text: "As stated", ...C.stated, align: "right", bold: true },
        { text: "By its own figures", ...C.computed, align: "right", bold: true },
        { text: "Check", ...C.verdict, bold: true },
      ],
      { size: 8 },
    );
    doc.rule({ thickness: 0.8, gap: 3 });
    for (const l of r.lines) {
      doc.row(
        [
          { text: l.label, ...C.line, bold: l.verdict === "error" },
          { text: R(l.stated), ...C.stated, align: "right" },
          { text: R(l.computed), ...C.computed, align: "right" },
          { text: `${l.verdict}${l.note ? ` – ${l.note}` : ""}`, ...C.verdict, bold: l.verdict === "error" },
        ],
        { size: 8, gap: 2 },
      );
    }
    if (r.feeImpact) doc.text(`Fee on the corrected cost of works: ${R(r.feeImpact.netOnCorrected)} (${R(r.feeImpact.change)} on the fee stated).`, { size: 8.5, gap: 2 });
    if (r.basisMismatch) doc.text(`The fee is worked on ${R(r.basisMismatch.used)}, not the response's own estimate of ${R(r.basisMismatch.stated)}.`, { size: 8.5, gap: 2 });
    for (const u of r.unseen) doc.text(`Not checked: ${u} – not in the response's text.`, { size: 8.5, grey: 0.3, gap: 2 });
  }

  doc.space(12);
  doc.rule({ gap: 6 });
  for (const n of [
    "Every figure was read from the response and found in its text; every sum, percentage, discount and fee formula was recalculated from the response's own figures. \"Consequential\" marks a line right on the figure it was given but changed once an error above it is corrected.",
    "Content a response shows only as an image is not read, and is listed as not checked.",
    "The recommendation is the platform's, by the rule stated; the appointment is the quantity surveyor's decision.",
  ])
    doc.text(n, { size: 8, grey: 0.35, gap: 3 });

  return doc.build();
}
