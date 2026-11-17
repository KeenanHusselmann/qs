/**
 * Generate the Ridgeview Gardens test corpus — the official demonstration project's documents.
 *
 *     npx tsx scripts/make-test-corpus.mts
 *
 * ── What this is for ───────────────────────────────────────────────────────────────────────
 *
 * Sixteen PDFs covering the three areas named as the proof of value: **feasibility, procurement
 * and cost management**. Between them they satisfy every mandatory entry criterion on the path
 * from an appointment letter to a cost report, and they carry the figures each step's field set
 * asks for — so a run over this corpus returns answers rather than a screen of `not_found`, which
 * is what a demonstration has to show.
 *
 * ── Generated, not hand-written ────────────────────────────────────────────────────────────
 *
 * Every figure comes from `lib/test-scheme.mjs`, and `verify()` runs before a single byte is
 * written. Fifteen documents that have to agree about a contract sum will not stay in agreement if
 * a person maintains them separately; generating them means the cost plan, the tender adjudication
 * and the contract cannot drift, because there is only one number and they all read it.
 *
 * Re-running is safe and produces byte-identical output — there is no date stamp, no random
 * reference and no ordering that depends on the filesystem. A corpus that changed on every run
 * would show up as a diff in every commit and would make "did the extraction change?" unanswerable.
 *
 * ── Filenames are the classifier's input ───────────────────────────────────────────────────
 *
 * `inferKind` scores the path against the kinds the criteria accept, so each file is named after
 * the kind it is. That is not decoration: it is what lets somebody drag the whole folder into the
 * import window and have it file itself, which is the flow this corpus is meant to demonstrate.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createPdf, type Pdf } from "../src/lib/pdf/writer";
import { SCHEME as S, money, number, verify } from "./lib/test-scheme.mjs";

const OUT = "fixtures/ridgeview";

/** Column geometry, shared so every table in the corpus lines up the same way. */
const COL = { label: 0, wide: 250, mid: 300, amount: 340, narrow: 90 };

/** A document header — every professional document in a QS corpus carries one. */
interface Header {
  title: string;
  reference: string;
  date: string;
  subtitle?: string;
}

function header(doc: Pdf, { title, reference, date, subtitle }: Header) {
  doc.text(S.practice.toUpperCase(), { size: 9, bold: true, gap: 1 });
  doc.text(`${S.name} · ${S.code}`, { size: 9, gap: 6 });
  doc.rule({ gap: 10 });
  doc.text(title.toUpperCase(), { size: 15, bold: true, gap: 2 });
  if (subtitle) doc.text(subtitle, { size: 10.5, gap: 6 });
  doc.text(`Reference: ${reference}     Date: ${date}`, { size: 9, gap: 10 });
  doc.rule({ gap: 12 });
}

/**
 * One element of the estimate, by name.
 *
 * Throws rather than returning undefined. A document that quotes 'Preliminaries and general'
 * in its closing paragraph and a scheme that no longer has that element is a corpus that
 * disagrees with itself, which is the one thing `test-scheme.mjs` exists to prevent — better
 * to fail generating than to print 'undefined' into a cost plan.
 */
function element(label: string): { code: string; label: string; amount: number } {
  const found = S.elements.find((e) => e.label === label);
  if (!found) throw new Error(`The scheme has no element called ${JSON.stringify(label)}`);
  return found;
}

/** A labelled fact on its own line — the shape an extractor finds most reliably. */
const fact = (doc: Pdf, label: string, value: string | number) =>
  doc.row([
    { text: label, x: COL.label, width: 200, bold: true },
    { text: String(value), x: 210, width: 273 },
  ]);

/** A money line in a schedule: description left, amount right-aligned. */
const line = (doc: Pdf, label: string, amount: string | number, opts: { bold?: boolean } = {}) =>
  doc.row([
    { text: label, x: COL.label, width: COL.wide, bold: opts.bold },
    { text: typeof amount === "number" ? money(amount) : amount, x: COL.amount, width: 143, align: "right", bold: opts.bold },
  ]);

/** "Mon 21/09/26" – day first with the weekday, as an MS Project export prints a date. */
const msDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  return `${day} ${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;
};

/** "2 October 2029" – the long form a certificate prints. */
const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

// ── The documents ─────────────────────────────────────────────────────────────────────────

const DOCUMENTS = [
  {
    file: "Appointment letter.pdf",
    kind: "Appointment letter",
    build() {
      const doc = createPdf({ title: "Appointment letter" });
      // The heading carries the words the criterion searches for. A real appointment is as often
      // headed "Letter of appointment", and grounding looks for the phrase "appointment letter" —
      // so the document says both, which is what a covering letter does anyway.
      header(doc, {
        title: "Appointment letter",
        subtitle: "Letter of appointment — quantity surveying services",
        reference: `${S.code}/APP/01`,
        date: "6 February 2026",
      });

      doc.text(`Dear Sirs`, { gap: 8 });
      doc.text(
        `This appointment letter confirms the appointment of ${S.practice} as quantity surveyor for the ` +
          `development known as ${S.name}, situated on ${S.erf}, ${S.municipality}, ${S.province}.`,
      );
      doc.text(
        `The appointment is made in terms of the standard conditions of engagement of the South African Council ` +
          `for the Quantity Surveying Profession, and covers the full service from pre-feasibility estimate through ` +
          `to final account.`,
      );

      doc.heading("Scope of appointment");
      for (const item of [
        "Pre-feasibility and feasibility cost advice, including the elemental cost estimate",
        "Preparation of the bill of quantities and tender documentation",
        "Tender adjudication and the award recommendation",
        "Interim payment certificates and the monthly cost report",
        "Valuation of variations and agreement of the final account",
      ])
        doc.text(`- ${item}`, { indent: 12, gap: 2 });

      doc.space(6);
      doc.heading("Particulars");
      fact(doc, "Employer", S.employer);
      fact(doc, "Project", `${S.name} (${S.code})`);
      fact(doc, "Principal agent", S.principalAgent);
      fact(doc, "Anticipated construction period", `${S.programmeMonths} months`);
      fact(doc, "Fee basis", "Tariff of professional fees, Government Gazette, as amended");

      doc.space(14);
      doc.text("Signed for and on behalf of the employer", { size: 9.5, gap: 22 });
      doc.text("_______________________________", { gap: 2 });
      doc.text(`${S.employer}`, { size: 9, gap: 0 });
      doc.text("Duly authorised · 6 February 2026", { size: 9 });

      return doc;
    },
  },

  {
    file: "Project brief.pdf",
    kind: "Project brief",
    build() {
      const doc = createPdf({ title: "Project brief" });
      header(doc, {
        title: "Project brief",
        subtitle: "Developer requirements and concept parameters",
        reference: `${S.code}/BRIEF/02`,
        date: "20 February 2026",
      });

      doc.heading("1. The development");
      doc.text(
        `${S.name} is an affordable residential development of ${number(S.units)} sectional-title units on ` +
          `${S.erf}, an erf of ${number(S.erfExtent)} m² in extent within ${S.municipality}.`,
      );
      doc.text(
        `The scheme is aimed at households earning between ${money(S.incomeBandLow)} and ` +
          `${money(S.incomeBandHigh)} per month. It is not a social housing or fully subsidised scheme: units are ` +
          `individually financed, with FLISP assistance available to qualifying purchasers.`,
      );

      doc.heading("2. Accommodation schedule");
      doc.row([
        { text: "Typology", x: COL.label, width: 200, bold: true },
        { text: "Units", x: 210, width: 60, align: "right", bold: true },
        { text: "Unit area", x: 280, width: 80, align: "right", bold: true },
        { text: "Total area", x: 370, width: 113, align: "right", bold: true },
      ]);
      doc.rule({ gap: 4 });

      for (const t of S.typologies) {
        doc.row([
          { text: t.name, x: COL.label, width: 200 },
          { text: number(t.units), x: 210, width: 60, align: "right" },
          { text: `${t.area} m²`, x: 280, width: 80, align: "right" },
          { text: `${number(t.units * t.area)} m²`, x: 370, width: 113, align: "right" },
        ]);
      }

      doc.rule({ gap: 4 });
      doc.row([
        { text: "Total", x: COL.label, width: 200, bold: true },
        { text: number(S.units), x: 210, width: 60, align: "right", bold: true },
        { text: `${S.averageUnitArea} m² avg`, x: 280, width: 80, align: "right", bold: true },
        { text: `${number(S.gfa)} m²`, x: 370, width: 113, align: "right", bold: true },
      ]);

      doc.space(8);
      doc.text(
        `The total unit count is ${number(S.units)} units. The gross floor area is ${number(S.gfa)} m², ` +
          `giving an average unit area of ${S.averageUnitArea} m².`,
      );

      doc.heading("3. Concept parameters");
      fact(doc, "Erf number and extent", `${S.erf}, ${number(S.erfExtent)} m²`);
      fact(doc, "Permitted use and density", `${S.zoning}, ${S.permittedDensity} dwelling units per hectare`);
      fact(doc, "Units permitted by zoning", `${number(S.permittedUnits)} units`);
      fact(doc, "Units proposed", `${number(S.units)} units`);
      fact(doc, "Average unit area", `${S.averageUnitArea} m²`);
      fact(doc, "Programme duration", `${S.programmeMonths} months from site handover`);
      fact(doc, "Subsidy quantum", `${money(S.subsidyQuantum)} per qualifying household (FLISP)`);
      fact(doc, "Bulk services contribution", money(S.bulkContribution));

      doc.heading("4. Pricing and take-up");
      doc.text(
        `Selling prices are to range from ${money(S.lowestPrice)} for the one-bedroom simplex to ` +
          `${money(S.highestPrice)} for the three-bedroom duplex, an average achievable selling price of ` +
          `${money(S.averageSellingPrice)} per unit across the scheme.`,
      );
      doc.text(
        `The developer requires the scheme to be planned around an absorption rate of ${S.absorption} units per ` +
          `annum, phased accordingly.`,
      );

      return doc;
    },
  },

  {
    file: "Title deed.pdf",
    kind: "Title deed",
    build() {
      const doc = createPdf({ title: "Title deed" });
      header(doc, {
        title: "Title deed",
        subtitle: `Deed of transfer ${S.titleDeed} — property description`,
        reference: S.titleDeed,
        date: "11 March 2019",
      });

      doc.text("DEEDS OFFICE, PIETERMARITZBURG", { size: 9, bold: true, gap: 10 });
      doc.text(
        `This title deed is the deed of transfer under which the property described below is held.`,
        { gap: 8 },
      );
      doc.text(
        `WHEREAS the property described below was transferred to ${S.employer}, registration number ` +
          `2016/447821/07, by Deed of Transfer ${S.titleDeed} registered on 11 March 2019.`,
      );

      doc.heading("Property");
      fact(doc, "Description", S.erf);
      fact(doc, "Registration division", "FT, Province of KwaZulu-Natal");
      fact(doc, "Local authority", S.municipality);
      fact(doc, "Extent", `${number(S.erfExtent)} (one hundred and twenty seven thousand) square metres`);
      fact(doc, "Held by", `Deed of Transfer ${S.titleDeed}`);
      fact(doc, "Registered owner", S.employer);

      doc.heading("Conditions of title");
      doc.text(
        `The property is subject to a servitude of way three comma zero (3,0) metres wide in favour of the local ` +
          `authority along the northern boundary, and to a municipal services servitude two comma zero (2,0) metres ` +
          `wide along the eastern boundary, as indicated on Diagram S.G. No. 1874/2018 annexed hereto.`,
      );
      doc.text(
        `There are no restrictive conditions prohibiting the subdivision of the property or the establishment of a ` +
          `sectional title scheme thereon.`,
      );

      return doc;
    },
  },

  {
    file: "Zoning certificate.pdf",
    kind: "Zoning certificate",
    build() {
      const doc = createPdf({ title: "Zoning certificate" });
      header(doc, {
        title: "Zoning certificate",
        subtitle: `${S.municipality} — Development Planning`,
        reference: `${S.code}/ZC/2026`,
        date: "3 March 2026",
      });

      doc.text(
        `This certificate is issued in terms of the ${S.municipality} Land Use Scheme and confirms the land use ` +
          `rights applicable to the property described below as at the date of issue.`,
      );

      doc.heading("Property and rights");
      fact(doc, "Property", S.erf);
      fact(doc, "Extent", `${number(S.erfExtent)} m²`);
      fact(doc, "Current zoning", S.zoning);
      fact(doc, "Permitted use", "Dwelling units, residential buildings and ancillary uses");
      fact(doc, "Maximum density", `${S.permittedDensity} dwelling units per hectare`);
      fact(doc, "Units permitted", `${number(S.permittedUnits)} dwelling units on the extent stated`);
      fact(doc, "Maximum height", "4 storeys");
      fact(doc, "Coverage", "50%");
      fact(doc, "Floor area ratio", "1,2");

      doc.heading("Building lines");
      fact(doc, "Street boundary", "5,0 m");
      fact(doc, "Side and rear boundaries", "3,0 m");

      doc.heading("Notes");
      doc.text(
        `The density of ${S.permittedDensity} dwelling units per hectare applied to an extent of ` +
          `${number(S.erfExtent)} m² permits ${number(S.permittedUnits)} dwelling units. Any scheme exceeding that ` +
          `number requires a departure or rezoning application in terms of the applicable planning by-law.`,
      );
      doc.text(
        `Parking is to be provided at one comma two five (1,25) bays per dwelling unit, of which not fewer than ` +
          `zero comma two five (0,25) bays per unit are to be visitors' parking.`,
      );

      return doc;
    },
  },

  {
    file: "Record of decision.pdf",
    kind: "Record of decision",
    build() {
      const doc = createPdf({ title: "Record of decision" });
      header(doc, {
        title: "Environmental authorisation",
        subtitle: "Record of decision — National Environmental Management Act, 1998",
        reference: S.environmentalRef,
        date: S.environmentalDate,
      });

      doc.text(
        `Environmental authorisation is hereby granted to ${S.employer} for the proposed residential development ` +
          `on ${S.erf}, ${S.municipality}, in terms of the National Environmental Management Act, 1998 ` +
          `(Act No. 107 of 1998), and the Environmental Impact Assessment Regulations.`,
      );

      doc.heading("Activity authorised");
      fact(doc, "Reference", S.environmentalRef);
      fact(doc, "Property", S.erf);
      fact(doc, "Extent", `${number(S.erfExtent)} m²`);
      fact(doc, "Development", `Residential development of up to ${number(S.units)} dwelling units`);
      fact(doc, "Date of decision", S.environmentalDate);
      fact(doc, "Validity", "Ten years from the date of decision");

      doc.heading("Conditions");
      for (const [i, condition] of [
        "A stormwater management plan is to be submitted to and approved by the municipality prior to any construction activity commencing.",
        "The riparian buffer of thirty two (32) metres from the delineated watercourse along the western boundary is to remain undeveloped.",
        "An environmental control officer is to be appointed for the duration of the construction period.",
        "Alien invasive vegetation is to be cleared and managed in terms of an approved alien vegetation management plan.",
        "Construction is to be confined to the hours 07:00 to 17:00 on weekdays.",
      ].entries())
        doc.text(`${i + 1}. ${condition}`, { indent: 12, gap: 4 });

      doc.space(6);
      doc.text(
        `This authorisation does not absolve the holder from complying with any other applicable legislation or ` +
          `from obtaining any other authorisation required in law.`,
      );

      return doc;
    },
  },

  {
    file: "Market study.pdf",
    kind: "Market study",
    build() {
      const doc = createPdf({ title: "Market study" });
      header(doc, {
        title: "Residential market study",
        subtitle: `${S.name} — demand, pricing and absorption`,
        reference: `${S.code}/MKT/06`,
        date: "28 February 2026",
      });

      doc.heading("1. Executive summary");
      doc.text(
        `The study assesses residential demand within a fifteen kilometre catchment of ${S.erf}. Demand in the ` +
          `affordable band is substantial and under-served, and the proposed scheme of ${number(S.units)} units is ` +
          `supportable at the pricing and absorption set out below.`,
      );

      doc.heading("2. Target market");
      doc.text(
        `The scheme addresses households earning between ${money(S.incomeBandLow)} and ${money(S.incomeBandHigh)} ` +
          `per month. Within the catchment this band comprises an estimated 41 300 households, of which some ` +
          `62 per cent are currently renting.`,
      );
      doc.text(
        `Qualifying households earning up to ${money(S.incomeBandHigh)} per month are eligible for the Finance ` +
          `Linked Individual Subsidy Programme, at a maximum subsidy quantum of ${money(S.subsidyQuantum)} per ` +
          `household on the current scale.`,
      );

      doc.heading("3. Achievable selling prices");
      doc.row([
        { text: "Typology", x: COL.label, width: 200, bold: true },
        { text: "Unit area", x: 210, width: 80, align: "right", bold: true },
        { text: "Achievable price", x: 300, width: 183, align: "right", bold: true },
      ]);
      doc.rule({ gap: 4 });

      for (const t of S.typologies) {
        doc.row([
          { text: t.name, x: COL.label, width: 200 },
          { text: `${t.area} m²`, x: 210, width: 80, align: "right" },
          { text: money(t.price), x: 300, width: 183, align: "right" },
        ]);
      }

      doc.rule({ gap: 4 });
      doc.space(4);
      doc.text(
        `The achievable selling price across the scheme averages ${money(S.averageSellingPrice)} per unit, ` +
          `ranging from ${money(S.lowestPrice)} to ${money(S.highestPrice)} by typology. At ` +
          `${number(S.units)} units the scheme's gross revenue is ${money(S.grossRevenue)}.`,
      );

      doc.heading("4. Absorption");
      doc.text(
        `Comparable schemes in the catchment have achieved sustained take-up of between 108 and 168 units per ` +
          `annum. A planning absorption rate of ${S.absorption} units per annum is recommended for this scheme, ` +
          `which implies a sales programme of approximately ${Math.ceil(S.units / S.absorption)} years and supports ` +
          `phased delivery.`,
      );

      doc.heading("5. Comparable schemes");
      doc.row([
        { text: "Scheme", x: COL.label, width: 170, bold: true },
        { text: "Units", x: 180, width: 55, align: "right", bold: true },
        { text: "Avg price", x: 245, width: 110, align: "right", bold: true },
        { text: "Take-up p.a.", x: 365, width: 118, align: "right", bold: true },
      ]);
      doc.rule({ gap: 4 });

      for (const c of [
        ["Kingfisher Park", 720, 689_000, 132],
        ["Umhlanga Rise Phase 2", 1_180, 812_000, 168],
        ["Ntuzuma Gardens", 496, 645_000, 108],
        ["Waterfall Crest", 864, 758_000, 156],
      ])
        doc.row([
          { text: c[0], x: COL.label, width: 170 },
          { text: number(c[1]), x: 180, width: 55, align: "right" },
          { text: money(c[2]), x: 245, width: 110, align: "right" },
          { text: number(c[3]), x: 365, width: 118, align: "right" },
        ]);

      return doc;
    },
  },

  {
    file: "Site development plan.pdf",
    kind: "Site development plan",
    build() {
      const doc = createPdf({ title: "Site development plan" });
      header(doc, {
        title: "Site development plan",
        subtitle: "Concept layout and typology schedule",
        reference: `${S.code}/SDP/07 Rev C`,
        date: "10 March 2026",
      });

      doc.heading("Layout");
      doc.text(
        `The layout places ${number(S.units)} sectional-title units across fourteen walk-up blocks of four ` +
          `storeys, arranged around three internal courtyards with a central open space of 4 200 m². Vehicular ` +
          `access is taken from the western boundary, clear of the riparian buffer.`,
      );

      doc.heading("Typology schedule");
      doc.row([
        { text: "Type", x: COL.label, width: 60, bold: true },
        { text: "Description", x: 70, width: 170, bold: true },
        { text: "Units", x: 250, width: 55, align: "right", bold: true },
        { text: "Area", x: 315, width: 70, align: "right", bold: true },
        { text: "Total", x: 395, width: 88, align: "right", bold: true },
      ]);
      doc.rule({ gap: 4 });

      S.typologies.forEach((t, i) => {
        doc.row([
          { text: `Type ${String.fromCharCode(65 + i)}`, x: COL.label, width: 60 },
          { text: t.name, x: 70, width: 170 },
          { text: number(t.units), x: 250, width: 55, align: "right" },
          { text: `${t.area} m²`, x: 315, width: 70, align: "right" },
          { text: `${number(t.units * t.area)} m²`, x: 395, width: 88, align: "right" },
        ]);
      });

      doc.rule({ gap: 4 });
      doc.row([
        { text: "Total", x: COL.label, width: 230, bold: true },
        { text: number(S.units), x: 250, width: 55, align: "right", bold: true },
        { text: `${S.averageUnitArea} m²`, x: 315, width: 70, align: "right", bold: true },
        { text: `${number(S.gfa)} m²`, x: 395, width: 88, align: "right", bold: true },
      ]);

      doc.space(10);
      doc.heading("Site coverage");
      fact(doc, "Erf extent", `${number(S.erfExtent)} m²`);
      fact(doc, "Gross floor area", `${number(S.gfa)} m²`);
      fact(doc, "Floor area ratio achieved", (S.gfa / S.erfExtent).toFixed(2).replace(".", ","));
      fact(doc, "Units proposed", `${number(S.units)} (${number(S.permittedUnits)} permitted)`);
      fact(doc, "Density achieved", `${(S.units / (S.erfExtent / 10_000)).toFixed(1).replace(".", ",")} units per hectare`);
      fact(doc, "Parking bays", `${number(Math.ceil(S.units * 1.25))} bays at 1,25 per unit`);

      return doc;
    },
  },

  {
    file: "QS cost plan.pdf",
    kind: "QS cost plan",
    build() {
      const doc = createPdf({ title: "QS cost plan" });
      header(doc, {
        title: "Elemental cost plan",
        subtitle: `${S.estimateClass}`,
        reference: `${S.code}/CP/08`,
        date: "31 March 2026",
      });

      doc.heading("Basis of the estimate");
      fact(doc, "Estimate class and basis", S.estimateClass);
      fact(doc, "Base date", S.estimateBaseDate);
      fact(doc, "Total unit count", number(S.units));
      fact(doc, "Average unit area", `${S.averageUnitArea} m²`);
      fact(doc, "Gross floor area", `${number(S.gfa)} m²`);
      fact(doc, "Erf number and extent", `${S.erf}, ${number(S.erfExtent)} m²`);

      doc.space(6);
      doc.text(
        `Rates are derived from the practice's cost database for comparable affordable residential schemes in ` +
          `${S.province}, adjusted to the base date. The estimate excludes value added tax, professional fees and ` +
          `land cost.`,
      );

      doc.heading("Cost analysis by element");
      doc.row([
        { text: "Code", x: COL.label, width: 45, bold: true },
        { text: "Element", x: 50, width: 175, bold: true },
        { text: "Amount", x: 230, width: 120, align: "right", bold: true },
        { text: "R/m²", x: 355, width: 70, align: "right", bold: true },
        { text: "%", x: 430, width: 53, align: "right", bold: true },
      ]);
      doc.rule({ gap: 4 });

      for (const e of S.elements) {
        doc.row([
          { text: e.code, x: COL.label, width: 45 },
          { text: e.label, x: 50, width: 175 },
          { text: money(e.amount), x: 230, width: 120, align: "right" },
          { text: number(e.amount / S.gfa, 2), x: 355, width: 70, align: "right" },
          { text: number((e.amount / S.constructionCost) * 100, 2), x: 430, width: 53, align: "right" },
        ]);
      }

      doc.rule({ gap: 4 });
      doc.row([
        { text: "", x: COL.label, width: 45 },
        { text: "Total construction cost", x: 50, width: 175, bold: true },
        { text: money(S.constructionCost), x: 230, width: 120, align: "right", bold: true },
        { text: number(S.costPerSquareMetre, 2), x: 355, width: 70, align: "right", bold: true },
        { text: "100,00", x: 430, width: 53, align: "right", bold: true },
      ]);

      doc.space(12);
      doc.heading("Summary");
      line(doc, "Total construction cost", S.constructionCost, { bold: true });
      line(doc, `Cost per square metre of gross floor area (${number(S.gfa)} m²)`, `${money(S.costPerSquareMetre, 2)}/m²`);
      line(doc, `Cost per unit (${number(S.units)} units)`, money(S.costPerUnit, 2));
      line(doc, "Bulk services contribution (excluded from the above)", S.bulkContribution);

      doc.space(10);
      doc.text(
        `The total construction cost is ${money(S.constructionCost)}, being ${money(S.costPerSquareMetre, 2)} per ` +
          `square metre of gross floor area and ${money(S.costPerUnit, 2)} per unit. Preliminaries and general are ` +
          `carried at ${money(element("Preliminaries and general").amount)} and contingency ` +
          `at ${money(element("Contingency").amount)}.`,
      );

      return doc;
    },
  },

  {
    file: "Specification.pdf",
    kind: "Specification",
    build() {
      const doc = createPdf({ title: "Specification" });
      header(doc, {
        title: "Specification of materials and workmanship",
        subtitle: "Measured scope for the bill of quantities",
        reference: `${S.code}/SPEC/09`,
        date: "14 April 2026",
      });

      doc.text(
        `This specification is to be read with the drawings listed in the tender documents and with the ` +
          `Preambles for Trades. Where a proprietary product is named, an equivalent approved in writing by the ` +
          `principal agent may be substituted.`,
      );

      const trades: readonly (readonly [string, readonly string[]])[] = [
        [
          "Earthworks and substructure",
          [
            "Excavate in all materials for strip footings to the depths shown, average 1,20 m below existing ground level.",
            "Concrete in footings to be 25 MPa/19 mm, mechanically vibrated.",
            "Surface beds 100 mm thick, 25 MPa/19 mm, on 250 micron damp-proof membrane on compacted fill.",
            "Reinforcement to be high tensile steel to SANS 920, cut, bent and fixed.",
          ],
        ],
        [
          "Masonry and superstructure",
          [
            "External walls one brick thick in clay stock brick, in class II mortar.",
            "Internal load-bearing walls half brick thick in clay stock brick.",
            "Suspended floor slabs 170 mm thick reinforced concrete, 30 MPa/19 mm, with smooth shutter finish to soffits.",
            "Staircases in reinforced concrete with cast-in nosings, balustrades in galvanised mild steel.",
          ],
        ],
        [
          "Roofing",
          [
            "Roof structure in SABS-approved pre-fabricated timber trusses at 900 mm centres.",
            "Roof covering in 0,5 mm chromadek profiled sheeting on purlins, pitch not exceeding 17 degrees.",
            "Rainwater goods in seamless aluminium gutters and downpipes.",
          ],
        ],
        [
          "Finishes",
          [
            "Internal walls plastered and finished with two coats acrylic PVA on one coat plaster primer.",
            "Floor finishes: vinyl tiles to living areas and bedrooms on 30 mm screed; ceramic tiles to kitchens and bathrooms.",
            "Ceilings in 6,4 mm gypsum board on brandering, skimmed and painted, with 75 mm cornices.",
          ],
        ],
        [
          "Engineering services",
          [
            "Cold and hot water reticulation in class 1 copper piping, insulated where exposed.",
            "Soil and waste drainage in 110 mm uPVC to SANS 967.",
            "Electrical reticulation to SANS 10142-1, with a prepaid meter to each unit.",
            "Solar water heating: one 150 litre indirect system per unit, SANS 1307 approved.",
          ],
        ],
        [
          "External works",
          [
            "Internal roads in 40 mm asphalt on 150 mm G5 base on 150 mm G7 subbase.",
            "Parking bays in 80 mm interlocking concrete pavers on 30 mm sand bedding.",
            "Boundary fencing 1,8 m high welded mesh on galvanised standards.",
            "Soft landscaping to courtyards and the central open space, including irrigation.",
          ],
        ],
      ];

      for (const [trade, clauses] of trades) {
        doc.heading(trade);
        for (const [i, clause] of clauses.entries()) doc.text(`${i + 1}. ${clause}`, { indent: 12, gap: 3 });
      }

      doc.heading("Scope");
      doc.text(
        `The measured scope comprises ${number(S.units)} dwelling units with a gross floor area of ` +
          `${number(S.gfa)} m², together with the associated external works, engineering services and site ` +
          `establishment for the whole of ${S.erf}.`,
      );

      return doc;
    },
  },

  /*
    The measured bill, priced as the pre-tender estimate.

    Laid out as a bill is: item, description, unit, quantity, rate, amount, a total under each
    trade, and a summary of the trades at the end. The summary and the section totals are there on
    purpose – they are lines with money on them that are not items, and an extractor that proposes
    "Roofing R 46 058 500,00" as a row would double-count the roofing, which is exactly what a real
    bill would tempt it into.
  */
  {
    file: "Bill of quantities.pdf",
    kind: "Bill of quantities",
    build() {
      const doc = createPdf({ title: "Bill of quantities" });
      header(doc, {
        title: "Bill of quantities",
        subtitle: "Measured and priced – pre-tender estimate",
        reference: S.billReference,
        date: S.billDate,
      });

      doc.text(
        `Measured from the working drawings and the specification ${S.code}/SPEC/09 in accordance with the ` +
          `Standard System of Measuring Building Work, for ${number(S.units)} dwelling units with a gross floor ` +
          `area of ${number(S.gfa)} m². Rates are the practice's pre-tender estimate at ${S.estimateBaseDate} and ` +
          `exclude value added tax.`,
      );

      // Wide enough that no money figure wraps: a sum split across two lines is a different number
      // to anyone reading the text out of the PDF, and the writer wraps on any space.
      const columns = (ref: string, description: string, unit: string, quantity: string, rate: string, amount: string, bold = false) => [
        { text: ref, x: 0, width: 26, bold },
        { text: description, x: 28, width: 196, bold },
        { text: unit, x: 228, width: 24, bold },
        { text: quantity, x: 252, width: 50, align: "right" as const, bold },
        { text: rate, x: 306, width: 84, align: "right" as const, bold },
        { text: amount, x: 392, width: 91, align: "right" as const, bold },
      ];

      for (const [s, section] of S.bill.entries()) {
        doc.heading(`${s + 1}. ${section.section}`);
        doc.row(columns("Item", "Description", "Unit", "Qty", "Rate", "Amount"), { bold: true });
        doc.rule({ gap: 4 });

        for (const [i, item] of section.items.entries()) {
          const cells = columns(
            `${s + 1}.${i + 1}`,
            item.description,
            item.unit,
            number(item.quantity),
            money(item.rate, 2),
            money(item.amount, 2),
          );
          doc.reserve(doc.rowHeight(cells) + 2);
          doc.row(cells, { gap: 4 });
        }

        doc.rule({ gap: 4 });
        doc.row(
          [
            { text: `Total of ${section.section} carried to summary`, x: 28, width: 300, bold: true },
            { text: money(section.total, 2), x: 360, width: 123, align: "right", bold: true },
          ],
          { gap: 8 },
        );
      }

      doc.heading("Summary");
      for (const [s, section] of S.bill.entries()) {
        doc.row([
          { text: `${s + 1}. ${section.section}`, x: 0, width: 300 },
          { text: money(section.total, 2), x: 360, width: 123, align: "right" },
        ]);
      }
      doc.rule({ gap: 4 });
      doc.row(
        [
          { text: "Total of the bill of quantities, excluding VAT", x: 0, width: 300, bold: true },
          { text: money(S.billTotal, 2), x: 360, width: 123, align: "right", bold: true },
        ],
        { gap: 10 },
      );

      doc.text(
        `Contingency and escalation, carried in the cost plan at ${money(element("Contingency").amount)} and ` +
          `${money(element("Escalation").amount)}, are not included in the bill.`,
        { size: 9 },
      );

      return doc;
    },
  },

  {
    file: "Tender return.pdf",
    kind: "Tender return",
    build() {
      const doc = createPdf({ title: "Tender return" });
      header(doc, {
        title: "Schedule of tenders received",
        subtitle: "Tender returns as opened",
        reference: `${S.code}/TEN/10`,
        date: S.tenderClosing,
      });

      doc.text(
        `Tenders for the construction of ${S.name} closed at 12:00 on ${S.tenderClosing} and were opened in ` +
          `public at the offices of ${S.practice}. Four tenders were received, all of which were responsive.`,
      );

      doc.heading("Tenders received");
      doc.row([
        { text: "Tenderer", x: COL.label, width: 250, bold: true },
        { text: "Tender sum", x: 260, width: 223, align: "right", bold: true },
      ]);
      doc.rule({ gap: 4 });

      // As opened — the submitted sums, before any arithmetic correction.
      for (const t of [...S.tenders].sort((a, b) => a.name.localeCompare(b.name))) {
        doc.row([
          { text: t.name, x: COL.label, width: 250 },
          { text: money(t.sum), x: 260, width: 223, align: "right" },
        ]);
      }

      doc.rule({ gap: 6 });
      doc.space(4);
      fact(doc, "Tender closing date", S.tenderClosing);
      fact(doc, "Tender validity period", `${S.tenderValidity} days from the closing date`);
      fact(doc, "Number of tenders received", "4");

      doc.heading("Qualifications recorded at opening");
      doc.text(
        `Summit Civils & Building (Pty) Ltd qualified its tender on the availability of the municipal bulk water ` +
          `connection, stating that a delay beyond twelve weeks from site handover would be the subject of a claim.`,
      );
      doc.text(`No other tenderer recorded a qualification or exclusion.`);

      return doc;
    },
  },

  {
    file: "Adjudication report.pdf",
    kind: "Adjudication report",
    build() {
      const doc = createPdf({ title: "Adjudication report" });
      header(doc, {
        title: "Tender adjudication and award recommendation",
        subtitle: `${S.name} — construction of ${number(S.units)} residential units`,
        reference: `${S.code}/ADJ/11`,
        date: "23 May 2026",
      });

      doc.heading("1. Tenders received");
      doc.text(
        `Four tenders were received by the closing date of ${S.tenderClosing}. Each was checked for arithmetic ` +
          `accuracy and for compliance with the tender conditions.`,
      );

      doc.heading("2. Arithmetic corrections");
      doc.text(
        `One arithmetic error was found. ${S.tenders[0].name} miscast the summary of Bill No. 3, understating its ` +
          `tender by ${money(S.tenders[0].correction)}. The correction was accepted by the tenderer in writing on ` +
          `19 May 2026 and the corrected sum is carried below.`,
      );

      doc.heading("3. Comparative schedule");
      doc.row([
        { text: "Tenderer", x: COL.label, width: 195, bold: true },
        { text: "As tendered", x: 200, width: 140, align: "right", bold: true },
        { text: "Corrected", x: 345, width: 138, align: "right", bold: true },
      ]);
      doc.rule({ gap: 4 });

      for (const t of S.tenders) {
        doc.row([
          { text: t.name, x: COL.label, width: 195 },
          { text: money(t.sum), x: 200, width: 140, align: "right" },
          { text: money(t.corrected), x: 345, width: 138, align: "right" },
        ]);
      }

      doc.rule({ gap: 6 });
      doc.space(4);

      doc.heading("4. Assessment");
      doc.text(
        `The lowest corrected tender is that of ${S.lowestTender.name} at ${money(S.lowestTender.corrected)}. ` +
          `This is ${money(S.tenders[1].corrected - S.lowestTender.corrected)} below the second-placed tender and ` +
          `${number(((S.lowestTender.corrected - S.constructionCost) / S.constructionCost) * 100, 2)} per cent ` +
          `above the elemental cost plan of ${money(S.constructionCost)}, which is within the accuracy band of a ` +
          `Class 4 estimate.`,
      );
      doc.text(
        `The tenderer's references, financial standing and current contract commitments were examined and are ` +
          `satisfactory. The tenderer holds a grading of 9GB with the Construction Industry Development Board.`,
      );

      doc.heading("5. Recommendation");
      doc.text(
        `It is recommended that the contract be awarded to ${S.recommendedTender.name} in the corrected sum of ` +
          `${money(S.recommendedTender.corrected)}, excluding value added tax.`,
      );

      doc.space(6);
      fact(doc, "Tenderers", "4");
      fact(doc, "Lowest tender", `${money(S.lowestTender.corrected)} (${S.lowestTender.name})`);
      fact(doc, "Recommended tenderer", S.recommendedTender.name);
      fact(doc, "Arithmetic corrections", `${money(S.tenders[0].correction)} added to the lowest tender`);
      fact(doc, "Tender validity period", `${S.tenderValidity} days from ${S.tenderClosing}`);

      return doc;
    },
  },

  {
    file: "Signed contract.pdf",
    kind: "Signed contract",
    build() {
      const doc = createPdf({ title: "Signed contract" });
      header(doc, {
        title: "Contract data",
        subtitle: S.contractForm,
        reference: `${S.code}/CON/12`,
        date: S.contractSigned,
      });

      doc.text(
        `An agreement made between ${S.employer} (the employer) and ${S.contractor} (the contractor) for the ` +
          `construction of ${number(S.units)} residential units at ${S.erf}, ${S.municipality}.`,
      );

      doc.heading("Contract particulars");
      fact(doc, "Contract form and edition", S.contractForm);
      fact(doc, "Employer", S.employer);
      fact(doc, "Contractor", S.contractor);
      fact(doc, "Principal agent", S.principalAgent);
      fact(doc, "Contract sum (excluding VAT)", money(S.contractSum));
      fact(doc, "Date signed", S.contractSigned);

      doc.heading("Payment and retention");
      fact(doc, "Retention percentage", `${S.retentionPercent}% of the value of work executed`);
      fact(doc, "Retention limit", `${money(S.retentionLimit)} (${S.retentionLimitPercent}% of the contract sum)`);
      fact(doc, "Payment terms", `Monthly interim certificates, payable within ${S.paymentDays} calendar days of the date of the certificate`);
      fact(doc, "Advance payment", `${money(S.advancePayment)}, recovered pro rata from certificate 3`);

      doc.heading("Time");
      fact(doc, "Site handover", S.siteHandover);
      fact(doc, "Construction period", `${S.programmeMonths} months`);
      fact(doc, "Practical completion date", S.practicalCompletion);
      fact(doc, "Penalty for late completion", `${money(S.penaltyPerDay)} per calendar day`);
      fact(doc, "Defects liability period", "12 months from practical completion");

      doc.heading("Price adjustment");
      fact(doc, "CPAP applicability", "Applicable — Haylett formula, work groups as scheduled");
      fact(doc, "CPAP base date", S.cpapBaseDate);

      doc.heading("Securities and insurance");
      fact(doc, "Payment guarantee", `${money(S.contractSum * 0.05)} (5% of the contract sum)`);
      fact(doc, "Contract works insurance", `${money(S.contractSum * 1.1)} (110% of the contract sum)`);
      fact(doc, "Public liability", money(20_000_000));

      doc.space(16);
      doc.rule({ gap: 14 });
      doc.row([
        { text: "_____________________________", x: COL.label, width: 220 },
        { text: "_____________________________", x: 250, width: 233 },
      ]);
      doc.row([
        { text: "For the employer", x: COL.label, width: 220, bold: true },
        { text: "For the contractor", x: 250, width: 233, bold: true },
      ]);
      doc.row([
        { text: S.employer, x: COL.label, width: 220 },
        { text: S.contractor, x: 250, width: 233 },
      ]);
      doc.row([
        { text: `Signed ${S.contractSigned}`, x: COL.label, width: 220 },
        { text: `Signed ${S.contractSigned}`, x: 250, width: 233 },
      ]);

      return doc;
    },
  },

  {
    file: "Measurement record.pdf",
    kind: "Measurement record",
    build() {
      const doc = createPdf({ title: "Measurement record" });
      const gross =
        S.workExecuted + S.materialsOnSite + S.variationValue + S.dayworks;

      header(doc, {
        title: "Measurement record and valuation",
        subtitle: `Valuation No. ${S.certificateNumber} — for interim payment certificate`,
        reference: `${S.code}/VAL/${S.certificateNumber}`,
        date: S.valuationPeriodEnd,
      });

      doc.text(
        `Work executed on site was measured jointly with the contractor's quantity surveyor on ` +
          `${S.valuationPeriodEnd} for the period ended on that date.`,
      );

      doc.heading("Valuation particulars");
      fact(doc, "Certificate number", S.certificateNumber);
      fact(doc, "Valuation period end", S.valuationPeriodEnd);
      fact(doc, "Contractor", S.contractor);
      fact(doc, "Contract sum", money(S.contractSum));
      fact(doc, "Retention percentage", `${S.retentionPercent}%`);

      doc.heading("Valuation");
      line(doc, "Value of work executed to date", S.workExecuted);
      line(doc, "Materials on site, unfixed", S.materialsOnSite);
      line(doc, "Approved variations included", S.variationValue);
      line(doc, "Dayworks", S.dayworks);
      doc.rule({ gap: 4 });
      line(doc, "Gross value of the works", gross, { bold: true });
      doc.space(6);
      line(doc, "Less previously certified", -S.previouslyCertified);
      doc.rule({ gap: 4 });
      line(doc, "Net value this certificate, before retention", gross - S.previouslyCertified, { bold: true });

      doc.space(12);
      doc.heading("Progress");
      doc.text(
        `The value of work executed is ${money(S.workExecuted)}, being ` +
          `${number((S.workExecuted / S.contractSum) * 100, 1)} per cent of the contract sum of ` +
          `${money(S.contractSum)}. Materials on site amount to ${money(S.materialsOnSite)} and the amount ` +
          `previously certified is ${money(S.previouslyCertified)}.`,
      );
      doc.text(
        `Progress is approximately three weeks behind the contractor's programme, attributable to the delayed ` +
          `municipal bulk water connection. No extension of time has been granted to date.`,
      );

      return doc;
    },
  },

  {
    file: "Contract instruction.pdf",
    kind: "Contract instruction",
    build() {
      const doc = createPdf({ title: "Contract instruction" });
      header(doc, {
        title: "Contract instruction",
        subtitle: `Instruction No. ${S.instructionRef} — variation ${S.variationNumber}`,
        reference: S.instructionRef,
        date: S.instructionDate,
      });

      doc.text(
        `To: ${S.contractor}. You are instructed in terms of the ${S.contractForm} to carry out the varied work ` +
          `described below.`,
      );

      doc.heading("Instruction");
      fact(doc, "Instruction reference", S.instructionRef);
      fact(doc, "Date of instruction", S.instructionDate);
      fact(doc, "Variation number", S.variationNumber);
      fact(doc, "Issued by", `${S.principalAgent}, principal agent`);

      doc.heading("Description of the varied work");
      doc.text(
        `Substitute the specified vinyl floor covering in the living areas and bedrooms of all ` +
          `${number(S.typologies[1].units)} two-bedroom simplex units with 600 x 600 mm porcelain floor tiling, ` +
          `including the associated screed adjustment, skirting and movement joints.`,
      );

      doc.heading("Reason");
      doc.text(
        `Client-instructed specification upgrade, following the review of the show unit on 4 November 2026. The ` +
          `upgrade is intended to improve the durability of the floor finish and to reduce the maintenance ` +
          `liability of the body corporate.`,
      );

      doc.heading("Valuation of the variation");
      const area = S.typologies[1].units * S.typologies[1].area * 0.62;
      line(doc, `Omit: vinyl tiling on screed, ${number(Math.round(area))} m² at R 385,00/m²`, -Math.round(area * 385));
      line(doc, `Add: porcelain floor tiling, ${number(Math.round(area))} m² at R 585,00/m²`, Math.round(area * 585));
      line(doc, "Add: adjustment to screed thickness and movement joints", 236_000);
      doc.rule({ gap: 4 });
      line(doc, `Net value of variation ${S.variationNumber}`, S.variationValue, { bold: true });

      doc.space(10);
      doc.heading("Time and status");
      fact(doc, "Extension of time claimed", "None. The work is to be carried out within the existing programme.");
      fact(doc, "Approval status", `Approved by the principal agent on ${S.variationApproved}`);
      fact(doc, "Net value", money(S.variationValue));

      return doc;
    },
  },

  {
    file: "Cost report.pdf",
    kind: "Cost report",
    build() {
      const doc = createPdf({ title: "Cost report" });
      header(doc, {
        title: "Financial review",
        subtitle: `Cost report No. 5 — period ended ${S.reportDate}`,
        reference: `${S.code}/CR/05`,
        date: S.reportDate,
      });

      doc.heading("1. Summary");
      fact(doc, "Report date", S.reportDate);
      fact(doc, "Contract sum", money(S.contractSum));
      fact(doc, "Value of work executed", money(S.workExecuted));
      fact(doc, "Approved variations to date", money(S.variationsToDate));
      fact(doc, "Committed cost", money(S.committedCost));
      fact(doc, "Forecast final cost", money(S.forecastFinalCost));
      fact(doc, "Variance against budget", `${money(S.varianceAgainstBudget)} over`);

      doc.heading("2. Financial position");
      doc.row([
        { text: "Description", x: COL.label, width: 250, bold: true },
        { text: "Amount", x: 260, width: 223, align: "right", bold: true },
      ]);
      doc.rule({ gap: 4 });
      line(doc, "Contract sum as awarded", S.contractSum);
      line(doc, "Approved variations to date", S.variationsToDate);
      line(doc, "Anticipated further variations", S.forecastFinalCost - S.contractSum - S.variationsToDate);
      doc.rule({ gap: 4 });
      line(doc, "Forecast final cost", S.forecastFinalCost, { bold: true });
      doc.space(6);
      line(doc, "Less contract sum", -S.contractSum);
      doc.rule({ gap: 4 });
      line(doc, "Variance against budget (over)", S.varianceAgainstBudget, { bold: true });

      doc.space(12);
      doc.heading("3. Commentary");
      doc.text(
        `The forecast final cost is ${money(S.forecastFinalCost)} against a contract sum of ` +
          `${money(S.contractSum)}, a variance of ${money(S.varianceAgainstBudget)} over budget, being ` +
          `${number((S.varianceAgainstBudget / S.contractSum) * 100, 2)} per cent. Committed cost through ` +
          `placed subcontract orders stands at ${money(S.committedCost)}.`,
      );

      doc.heading("4. Cost risks and provisions");
      for (const risk of [
        `Municipal bulk water connection: the connection remains outstanding and is on the critical path. A delay beyond twelve weeks would expose the employer to a contractor's claim, provisionally assessed at ${money(2_400_000)}.`,
        `CPAP escalation: measured escalation is running above the base assumption. A further ${money(3_100_000)} is carried in the forecast against the balance of the works.`,
        `Provisional sums: the balance of unexpended provisional sums is ${money(6_800_000)}, of which the lift installation at ${money(4_200_000)} is not yet let.`,
        `Ground conditions: the rock encountered in the eastern platform has been measured and is included in the approved variations above. No further provision is carried.`,
      ])
        doc.text(`- ${risk}`, { indent: 12, gap: 5 });

      return doc;
    },
  },

  {
    file: "Construction programme.pdf",
    kind: "Contractor's programme",
    build() {
      const doc = createPdf({ title: "Construction programme" });
      header(doc, {
        title: "Construction programme",
        subtitle: `Contractor's programme of works – approved at site handover`,
        reference: S.programmeRef,
        date: S.siteHandover,
      });

      doc.text(
        `Programme of works submitted by ${S.contractor} in terms of the ${S.contractForm}, reviewed and approved by ` +
          `${S.principalAgent}, principal agent, at site handover on ${S.siteHandover}. The date for practical completion is ` +
          `${S.practicalCompletion}. Dates are shown day first, as exported from the contractor's scheduling software.`,
      );

      doc.heading("Programme");
      doc.row(
        [
          { text: "ID", x: 0, width: 26, bold: true },
          { text: "Task name", x: 30, width: 250, bold: true },
          { text: "Start", x: 290, width: 90, bold: true },
          { text: "Finish", x: 390, width: 93, bold: true },
        ],
        { size: 9 },
      );
      doc.rule({ gap: 4 });
      for (const a of S.programme) {
        doc.row([
          { text: a.ref, x: 0, width: 26 },
          { text: a.milestone ? `${a.name} (milestone)` : a.name, x: 30, width: 250 },
          { text: msDate(a.start), x: 290, width: 90 },
          { text: msDate(a.finish), x: 390, width: 93 },
        ]);
      }
      doc.rule({ gap: 6 });
      fact(doc, "Contract period", "36 months from site handover");
      fact(doc, "Approved by", `${S.principalAgent}, principal agent`);

      return doc;
    },
  },

  {
    file: "Practical completion certificate.pdf",
    kind: "Practical completion certificate",
    build() {
      const doc = createPdf({ title: "Practical completion certificate" });
      header(doc, {
        title: "Certificate of practical completion",
        subtitle: `Issued in terms of the ${S.contractForm}`,
        reference: `${S.code}/PC/01`,
        date: longDate(S.practicalCompletionActual),
      });

      doc.text(
        `The principal agent certifies that the works under the contract with ${S.contractor} reached practical completion ` +
          `on the date below, subject to the list of outstanding work that follows.`,
      );

      doc.heading("Completion");
      fact(doc, "Date of practical completion", longDate(S.practicalCompletionActual));
      fact(doc, "Date for practical completion in the contract", S.practicalCompletion);
      fact(doc, "Defects liability period", `${S.defectsLiability} from the date of practical completion`);

      doc.heading("List of outstanding work");
      S.snags.forEach((snag, i) => doc.text(`${i + 1}. ${snag}`, { gap: 2 }));
      doc.space(6);
      fact(doc, "Estimated value of outstanding work", money(S.outstandingValue));

      doc.heading("Handover documents");
      doc.text("Operation and maintenance manuals, guarantees and warranties, as-built drawings and the electrical certificates of compliance were received on the date of practical completion.");
      fact(doc, "Certified by", `${S.principalAgent}, principal agent`);

      return doc;
    },
  },
];

// ── Write ─────────────────────────────────────────────────────────────────────────────────

const problems = verify();
if (problems.length) {
  console.error("The scheme does not agree with itself, so no corpus was written:\n");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

let total = 0;
for (const document of DOCUMENTS) {
  const bytes = document.build().build();
  writeFileSync(join(OUT, document.file), bytes);
  total += bytes.length;
  console.log(`  ${document.file.padEnd(30)} ${String(bytes.length).padStart(7)} bytes   ${document.kind}`);
}

console.log(`\n${DOCUMENTS.length} documents, ${(total / 1024).toFixed(1)} KB, in ${OUT}/`);

export { DOCUMENTS };
