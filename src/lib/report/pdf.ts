/**
 * The QS Viability Report as a document — the thing a QS actually issues.
 *
 * ── One model, two renderers ───────────────────────────────────────────────────────────────
 *
 * This takes the same `ViabilityReport` the on-screen sheet renders. That is the whole design: a
 * PDF built from its own second reading of the database would eventually disagree with the page
 * the reader approved it on, and "the printout says something different from the screen" is the
 * defect nobody forgives in a cost document. The screen is the preview because it is the same
 * document.
 *
 * ── What it takes from v3 ──────────────────────────────────────────────────────────────────
 *
 * v3's `exemplar_pdf.py` is the reference and its furniture is deliberate, not decoration:
 *
 *   - a **cover** naming who it is prepared for and in respect of what, over a KPI band
 *   - a **contents** page, because a QS refers to a report by section number in a meeting
 *   - **page X of Y** on every page, so a printed copy can be checked for completeness
 *   - the **basis of the estimate** and **limiting conditions**, which is what makes it a
 *     professional opinion rather than a printout
 *   - a **glossary**, because the reader is often the client rather than another QS
 *
 * ── What it does not take ──────────────────────────────────────────────────────────────────
 *
 * v3's cover band carries net income, return on capital and return on equity. Those are engine
 * output and this platform's engine is part-ported, so the band carries what is signed and says so
 * where it is not. v3 does the same thing under `_benchmark_only`: with no QS cost plan it prints
 * "— indic." rather than a phantom loss. Withholding is the established behaviour, not a shortfall
 * invented here.
 */

import { createPdf, PAGE, type Bar } from "@/lib/pdf/writer";
import { formatRand } from "@/domain/money";
import type { ReportSection, ViabilityReport } from "@/lib/report/viability";

/**
 * The verdict as one word on a cover.
 *
 * "None" rather than a blank or a hedge where a gate is still untested: a cover that simply omits
 * the verdict reads as an oversight, and one that softens it to "indicative" reads as a verdict.
 * The finding underneath says which gates could not be tested and why.
 */
const VERDICT_WORD: Readonly<Record<string, string>> = {
  go: "Go",
  conditional: "Conditional",
  "no-go": "No-Go",
  none: "Withheld",
};

/** A count, grouped the platform's way — §7.7, so 1 046 does not wrap mid-number. */
const formatCount = (n: number) =>
  n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");


/** Column geometry for the section tables, so every section lines up. */
const COL = { label: 0, value: 200, source: 360 };

export interface ReportSubject {
  projectName: string;
  code: string | null;
  client: string | null;
  /** The practice issuing it. */
  practice: string;
  /** Latest signature on the project, ISO. */
  latestSignature: string | null;
  issuedOn: string;
}

/** The elemental breakdown, where the cost plan has been signed — the one chart the data supports. */
function elementBars(section: ReportSection | undefined): Bar[] {
  if (!section || section.state !== "established") return [];

  return section.rows
    .filter((row) => !/total/i.test(row.label) && !/basis|class/i.test(row.label))
    .map((row) => {
      // The bar's length needs a number; the label beside it stays the document's own words.
      const digits = row.value.replace(/[^\d]/g, "");
      return { label: row.label, value: Number(digits) || 0, shown: row.value };
    })
    .filter((bar) => bar.value > 0);
}

export function renderViabilityPdf(report: ViabilityReport, subject: ReportSubject): Buffer {
  const doc = createPdf({ title: `${subject.projectName} – QS Viability Report` });

  doc.footerOnEveryPage(
    (page, total) =>
      `${subject.practice} · ${subject.projectName}${subject.code ? ` · ${subject.code}` : ""}` +
      `   –   Page ${page} of ${total}`,
  );

  // ── Cover ───────────────────────────────────────────────────────────────────────────────
  doc.space(150);
  doc.rule({ thickness: 1.4, gap: 14, grey: 0.2 });
  doc.text("QUANTITY SURVEYOR’S", { size: 22, bold: true, align: "centre", gap: 2 });
  doc.text("VIABILITY REPORT", { size: 22, bold: true, align: "centre", gap: 10 });
  doc.rule({ thickness: 1.4, gap: 22, grey: 0.2 });

  doc.text("prepared for", { size: 9, align: "centre", grey: 0.4, gap: 2 });
  doc.text(subject.client ?? "The employer", { size: 13, bold: true, align: "centre", gap: 12 });

  doc.text("in respect of", { size: 9, align: "centre", grey: 0.4, gap: 2 });
  doc.text(subject.projectName, { size: 13, bold: true, align: "centre", gap: 2 });
  if (subject.code) doc.text(subject.code, { size: 10, align: "centre", grey: 0.35, gap: 16 });

  /*
    ── The cover leads with the scheme, then the conclusion ──────────────────────────────

    It used to lead with "10 of 12 sections established · 2 signed steps · latest signature" —
    three measures of how much of the document the platform had managed to fill in. Those are the
    platform talking about itself, on the first page a client opens to find out whether to build a
    thousand homes.

    The band now carries what the scheme *is* and what the report *concludes*. The completeness
    figures are not deleted — a reader is entitled to know how much of this rests on signatures —
    but they belong at the foot of the page and on the control page, which exists for them.
  */
  doc.band([
    {
      label: "Units",
      value: report.headline.units ? formatCount(report.headline.units) : "Not established",
    },
    {
      label: "Construction cost",
      value: report.headline.construction ? formatRand(report.headline.construction) : "Not established",
    },
    {
      label: "Verdict",
      value: VERDICT_WORD[report.headline.verdict ?? "none"],
    },
  ]);

  doc.space(16);

  /*
    The sentence the whole document comes to, on the cover.

    A viability report whose conclusion is on page six has buried it. This is the same sentence
    section 11 carries — one derivation, printed twice — so the cover cannot say something the
    conclusion contradicts.
  */
  doc.text("THE FINDING", { size: 8, bold: true, align: "centre", grey: 0.4, gap: 5 });
  doc.text(report.headline.sentence, {
    size: 10.5,
    align: "centre",
    gap: 4,
    width: 380,
  });

  doc.space(10);
  doc.rule({ thickness: 0.8, gap: 10 });
  doc.text(`Report date: ${subject.issuedOn}`, { size: 9, align: "centre", grey: 0.35, gap: 2 });
  doc.text(subject.practice, { size: 9, align: "centre", grey: 0.35, gap: 2 });
  doc.text(
    "CONFIDENTIAL – indicative ASAQS Class 4/5 feasibility estimate (±15–25%)",
    { size: 8.5, align: "centre", grey: 0.35, gap: 6 },
  );
  // Demoted, not dropped. How much of this rests on signatures is a fact a reader is owed — it is
  // simply not the headline.
  doc.text(
    `${report.established} of ${report.total} sections established from signed figures.` +
      (subject.latestSignature ? ` Latest signature ${subject.latestSignature}.` : ""),
    { size: 8.5, align: "centre", grey: 0.4 },
  );

  // ── Contents ────────────────────────────────────────────────────────────────────────────
  doc.page();
  doc.text("CONTENTS", { size: 14, bold: true, gap: 4 });
  doc.rule({ gap: 10 });

  for (const section of report.sections) {
    doc.row(
      [
        { text: section.no, x: 0, width: 24 },
        { text: section.title, x: 26, width: 330 },
        {
          /*
            Only the exceptions are marked.

            Twelve rows reading "Established" is the platform reporting on itself, and it made the
            contents page a status board rather than a way into the document. A reader assumes a
            section in a report they are holding has something in it; what they need pointing out
            is the two that do not.
          */
          text:
            section.state === "established"
              ? ""
              : section.state === "unsigned"
                ? "not signed off"
                : "not modelled yet",
          x: 360,
          width: PAGE.textWidth - 360,
          align: "right",
          grey: 0.45,
        },
      ],
      { size: 9.5, gap: 3 },
    );
  }

  doc.space(10);
  doc.text(
    "Every figure in this report is read from a run that a named person has signed off, and carries " +
      "the document it was read from. Nothing is estimated here. Sections without approved figures " +
      "behind them state that rather than being omitted.",
    { size: 9, grey: 0.25 },
  );

  // ── The sections ────────────────────────────────────────────────────────────────────────
  doc.page();

  for (const section of report.sections) {
    doc.heading(`${section.no}   ${section.title}`, { size: 11.5, gap: 4 });

    if (section.reason) {
      doc.text(section.reason, { size: 9, grey: 0.3, gap: 4 });
    }

    if (section.rows.length > 0) {
      doc.row(
        [
          { text: "Item", x: COL.label, width: 190, bold: true },
          { text: "Figure", x: COL.value, width: 150, bold: true },
          { text: "Source", x: COL.source, width: PAGE.textWidth - COL.source, bold: true },
        ],
        { size: 8.5, gap: 2 },
      );
      doc.rule({ gap: 4 });

      section.rows.forEach((row, i) => {
        doc.row(
          [
            { text: row.label, x: COL.label, width: 190 },
            { text: row.value, x: COL.value, width: 150 },
            { text: row.source ?? "–", x: COL.source, width: PAGE.textWidth - COL.source },
          ],
          { size: 9, gap: 2, shade: i % 2 === 1 },
        );
      });
    }

    if (section.from) {
      doc.space(2);
      doc.text(`Signed by ${section.from.by}.`, { size: 8, grey: 0.4, gap: section.from.note ? 2 : 6 });
      if (section.from.note) doc.text(`Signed with a difference: ${section.from.note}`, { size: 8, grey: 0.25, gap: 6 });
    }

    /*
      ── The charts, where the section they belong to has them ─────────────────────────────

      A QS viability report is read on its charts before it is read on any table, and this one had
      exactly one small bar list in nine sections. The S-curve is the construction industry's own
      — the vertical gap between the curves *is* the funding requirement — and the tornado is the
      appraisal's, because a single NPV says nothing about which assumption it is hostage to.

      Drawn from `report.charts`, which is built where sections 8 and 9 get their figures, so a
      chart cannot disagree with the table above it.
    */
    if (section.no === "8" && report.charts && report.charts.cost.length > 1) {
      doc.space(6);
      doc.reserve(16 + 150 + 40);
      doc.text("Cost against revenue, month by month", { size: 9.5, bold: true, gap: 8 });
      doc.curves(
        [
          { name: "Cumulative cost", points: report.charts.cost, grey: 0.55 },
          { name: "Cumulative revenue", points: report.charts.revenue, grey: 0.2 },
        ],
        { label: (v) => `R ${(v / 100 / 1e6).toFixed(0)}m` },
      );
      doc.text(
        "The gap between the curves is what the scheme has to fund. Escalation and selling " +
          "commission are stated assumptions, not signed figures.",
        { size: 8, grey: 0.4, gap: 4 },
      );
    }

    if (section.no === "9" && report.charts && report.charts.levers.length > 0) {
      doc.space(6);
      doc.reserve(16 + report.charts.levers.length * 18 + 26);
      doc.text("What the answer is hostage to", { size: 9.5, bold: true, gap: 8 });
      doc.tornado(report.charts.levers);
      doc.text(
        "Each input moved on its own against equity NPV, widest first. The bar at the top is the " +
          "assumption worth the most diligence.",
        { size: 8, grey: 0.4, gap: 4 },
      );
    }

    // The elemental breakdown is the one chart the signed data supports today.
    if (section.no === "6") {
      const bars = elementBars(section);
      if (bars.length > 0) {
        doc.space(4);
        // The label and the chart are one block: 16 for the label, 16 a bar, and a tail.
        doc.reserve(16 + bars.length * 16 + 12);
        doc.text("Elemental breakdown", { size: 9.5, bold: true, gap: 6 });
        doc.bars(bars);
      }
    }

    doc.space(4);
  }

  // ── Basis, limiting conditions, glossary ────────────────────────────────────────────────
  doc.page();
  doc.text("BASIS AND LIMITING CONDITIONS", { size: 14, bold: true, gap: 4 });
  doc.rule({ gap: 10 });

  doc.heading("Basis of the figures", { size: 11 });
  doc.text(
    "Every figure reproduced in this report is the output of a run that a named person signed off " +
      "on this platform. Each carries the document it was read from. No figure in this report was " +
      "produced by this report: nothing is estimated, interpolated or inferred at the point of " +
      "printing.",
    { size: 9.5 },
  );

  doc.heading("Limiting conditions and reliance", { size: 11 });
  for (const condition of [
    "This is an indicative estimate at ASAQS Class 4/5 (±15–25%). It is not a tender price, a valuation, or a guarantee of outturn cost.",
    "Sections marked as not yet established carry no figures. They are not nil, and they must not be read as nil.",
    "The report reflects the corpus filed on this project at the date of issue. A document filed afterwards is not in it.",
    "Figures exclude value added tax unless the signed source states otherwise.",
    "Reliance is limited to the addressee named on the cover.",
  ])
    doc.text(`•  ${condition}`, { size: 9.5, indent: 8, gap: 3 });

  doc.heading("Glossary", { size: 11 });
  for (const [term, meaning] of [
    ["ASAQS", "Association of South African Quantity Surveyors, whose estimating classes define the accuracy band stated on the cover."],
    ["Class 4/5", "A concept or pre-feasibility estimate, accurate to about −15% / +25%. Not a priced bill."],
    ["Elemental estimate", "Construction cost divided by building element – substructure, superstructure and so on – rather than by trade."],
    ["Signed off", "A named person froze a step's figures. Only frozen figures appear in this report."],
    ["Established", "A section whose figures come from a signed step. The alternative is stated, never blank."],
  ] as const)
    doc.row(
      [
        { text: term, x: 0, width: 110, bold: true },
        { text: meaning, x: 118, width: PAGE.textWidth - 118 },
      ],
      { size: 9, gap: 4 },
    );

  return doc.build();
}
