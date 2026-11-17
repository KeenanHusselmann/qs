/**
 * The elemental cost plan, as issued – D1.1 Cost Plan Revision.
 *
 * One or two pages the way a South African practice sends one: the elements with their cost and
 * share (and cost per unit of the plan's measure, where one is set), the build-up from measured work
 * to the total including VAT, and the basis – which bill it was revised from, and whether that bill
 * was signed. Figures come from `domain/elemental-plan.ts` through `lib/elemental-plan.ts`; nothing
 * is computed here but the layout.
 */

import { displayUnit, formatMoney, formatQuantity, type Money } from "@/domain/money";
import { inSentence, type ElementalPlan } from "@/domain/elemental-plan";
import { createPdf, PAGE } from "@/lib/pdf/writer";

export interface ElementalPlanSubject {
  practice: string;
  projectName: string;
  code: string | null;
  client: string | null;
  basis: string;
  allowances: { preliminaries: string; contingency: string; escalation: string; vat: string; typical: boolean };
  measure: { label: string } | null;
  issuedBy: string;
  issuedOn: string;
}

const W = PAGE.textWidth;
const R = (m: Money) => formatMoney(m, { symbol: "R" });
/*
  The element table's columns, with or without a cost per unit of the plan's measure.

  Per metre of wall is a column of its own, as it is on screen, and not a footnote. The September
  review (§8) read this plan's elemental rates – per m³ of footing concrete, per m² of walling – as
  making the substructure look expensive (R5 560 per m³) while hiding what it left out, and asked
  for a per-metre figure by element, which is what two walls can be compared on. The figure was
  already computed; it was printed in grey under the totals, where nobody comparing looks.

  Last, as on screen, so the two read in the same order. Share was 76 pt wide for "25,3%", so it
  gives up most of the room.
*/
const columns = (perMeasure: boolean) =>
  perMeasure
    ? {
        element: { x: 0, width: W - 342 },
        quantity: { x: W - 338, width: 70 },
        rate: { x: W - 264, width: 66 },
        amount: { x: W - 194, width: 78 },
        share: { x: W - 112, width: 42 },
        per: { x: W - 66, width: 66 },
      }
    : {
        element: { x: 0, width: W - 330 },
        quantity: { x: W - 326, width: 78 },
        rate: { x: W - 244, width: 70 },
        per: null,
        amount: { x: W - 170, width: 90 },
        share: { x: W - 76, width: 76 },
      };

export function elementalPlanPdf(plan: ElementalPlan, s: ElementalPlanSubject): Buffer {
  const doc = createPdf({ title: `${s.projectName} – Elemental Cost Plan` });
  doc.footerOnEveryPage((page, total) => `${s.practice} · ${s.projectName}${s.code ? ` · ${s.code}` : ""}   –   Elemental Cost Plan   –   Page ${page} of ${total}`);
  const COL = columns(s.measure !== null);
  const perLabel = s.measure ? displayUnit(s.measure.label) : "";

  doc.text(s.practice, { size: 9, grey: 0.35, gap: 2 });
  doc.text("Elemental Cost Plan", { size: 16, bold: true, gap: 2 });
  doc.text(`${s.projectName}${s.code ? ` · ${s.code}` : ""}`, { size: 11, gap: 10 });
  doc.rule({ gap: 8 });

  const line = (label: string, value: string) =>
    doc.row([
      { text: label, x: 0, width: 110, grey: 0.4 },
      { text: value, x: 114, width: W - 114 },
    ]);
  if (s.client) line("Client", s.client);
  line("Basis", s.basis);
  line("Issued", `${s.issuedOn} by ${s.issuedBy}`);
  doc.space(6);

  // ── The totals, before the detail ──────────────────────────────────────────────────────────
  doc.band([
    { label: "Measured work", value: R(plan.net) },
    { label: "Total excl. VAT", value: R(plan.excludingVat) },
    { label: "Total incl. VAT", value: R(plan.includingVat) },
  ]);
  doc.space(10);

  // ── Elements ───────────────────────────────────────────────────────────────────────────────
  doc.heading("Cost by element", { size: 11.5 });
  doc.row(
    [
      { text: "Element", ...COL.element, bold: true },
      { text: "Quantity", ...COL.quantity, align: "right", bold: true },
      { text: "Rate (R)", ...COL.rate, align: "right", bold: true },
      { text: "Amount (R)", ...COL.amount, align: "right", bold: true },
      { text: "Share", ...COL.share, align: "right", bold: true },
      ...(COL.per ? [{ text: `Per ${perLabel} (R)`, ...COL.per, align: "right" as const, bold: true }] : []),
    ],
    { size: 8.5 },
  );
  doc.rule({ thickness: 0.8, gap: 4 });
  for (const e of plan.elements) {
    doc.row([
      { text: `${e.label}${e.unpriced ? ` (${e.unpriced} not priced)` : ""}`, ...COL.element },
      { text: e.quantity ? `${formatQuantity(e.quantity.value)} ${displayUnit(e.quantity.unit)}` : "–", ...COL.quantity, align: "right" },
      { text: e.rate !== null ? formatMoney(e.rate, { symbol: "" }) : "–", ...COL.rate, align: "right" },
      { text: formatMoney(e.amount, { symbol: "" }), ...COL.amount, align: "right" },
      { text: `${(e.share / 100).toFixed(1).replace(".", ",")}%`, ...COL.share, align: "right" },
      ...(COL.per ? [{ text: e.perMeasure !== null ? formatMoney(e.perMeasure, { symbol: "" }) : "–", ...COL.per, align: "right" as const }] : []),
    ]);
    // What the element quantity is taken from, under the element – the rate is only as good as it.
    if (e.quantity) doc.row([{ text: e.quantity.set ? `Quantity: ${e.quantity.basis}` : `Quantity of ${inSentence(e.quantity.basis)}`, ...COL.element, grey: 0.45 }], { size: 7.5, gap: 3 });
  }
  doc.rule({ gap: 4 });
  doc.row([
    { text: "Measured work", ...COL.element, bold: true },
    { text: "", ...COL.quantity },
    { text: "", ...COL.rate },
    { text: formatMoney(plan.net, { symbol: "" }), ...COL.amount, align: "right", bold: true },
    { text: "100%", ...COL.share, align: "right", bold: true },
  ]);
  doc.space(14);

  // ── From measured work to the total ──────────────────────────────────────────────────────
  doc.heading("From measured work to the total", { size: 11.5 });
  const step = (label: string, value: Money, bold = false) =>
    doc.row(
      [
        { text: label, x: 0, width: W - 140, bold },
        { text: R(value), x: W - 136, width: 136, align: "right", bold },
      ],
      { size: bold ? 10.5 : 9.5, gap: 3 },
    );
  step("Measured work", plan.net);
  step(`Preliminaries and general at ${s.allowances.preliminaries}%`, plan.preliminaries);
  step(`Contingency at ${s.allowances.contingency}%`, plan.contingency);
  step(`Escalation at ${s.allowances.escalation}%`, plan.escalation);
  doc.rule({ gap: 4 });
  step("Total excluding VAT", plan.excludingVat, true);
  step(`VAT at ${s.allowances.vat}%`, plan.vat);
  doc.rule({ thickness: 1.2, gap: 4 });
  step("Total including VAT", plan.includingVat, true);
  if (plan.perMeasure && s.measure) {
    doc.space(4);
    doc.text(`${R(plan.perMeasure.excludingVat)} per ${displayUnit(s.measure.label)} excluding VAT · ${R(plan.perMeasure.includingVat)} including VAT`, { size: 9, grey: 0.3 });
  }

  doc.space(14);
  doc.rule({ gap: 6 });
  const notes = [
    "Measured work is the priced bill of quantities, each item grouped into its element.",
    s.allowances.typical
      ? "The allowances are typical figures and have not been set for this project – confirm them before relying on the totals."
      : "The allowances were set for this project by the quantity surveyor.",
    plan.unpriced ? `${plan.unpriced} bill ${plan.unpriced === 1 ? "item is" : "items are"} not priced and not included in these totals.` : null,
  ].filter(Boolean) as string[];
  for (const n of notes) doc.text(n, { size: 8.5, grey: 0.35, gap: 3 });

  return doc.build();
}
