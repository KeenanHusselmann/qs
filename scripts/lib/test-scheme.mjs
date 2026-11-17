/**
 * Ridgeview Gardens — the figures the official test project is built from.
 *
 * ── Why this file exists, rather than the numbers living in the documents ──────────────────
 *
 * The corpus is fifteen documents that have to agree with each other. A cost plan totalling
 * R466 600 000, a tender recommending R467 440 000 and a contract naming a different sum is not a
 * demonstration of anything except that nobody checked — and the whole point of the chain is that
 * a figure carried downstream is the one a person signed upstream. Typing the same number into
 * fifteen documents guarantees that one day two of them differ.
 *
 * So the scheme is declared once and every document is generated from it, and everything that can
 * be *computed* is computed: the unit mix sums to the unit count, the gross floor area is the mix
 * multiplied out, the elemental costs sum to the construction total, the retention limit is a
 * percentage of the contract sum, and the cost report's variance is the difference it claims to
 * be. `verify()` asserts all of it and the generator refuses to write a corpus that fails.
 *
 * ── Entirely invented, and that is the point ───────────────────────────────────────────────
 *
 * `fixtures/README.md` records that four of the existing fixtures are a real client's scheme, and
 * that the directory could not be published because of them. This corpus has no such problem:
 * every name, erf number, figure and party here is fabricated. It is the set that can be shown to
 * anybody, which is what a proof-of-value corpus has to be.
 *
 * The shape is realistic — an affordable-housing scheme in the R8 000–R30 000 household income
 * band, ASAQS Class 4 estimate, JBCC contract — because a demonstration against toy data proves
 * nothing about a platform whose whole claim is that it reads real documents.
 */

/** The typologies, from which the unit count and the floor area are both derived. */
const TYPOLOGIES = [
  { name: "1-bedroom simplex", units: 482, area: 40, price: 625_000 },
  { name: "2-bedroom simplex", units: 464, area: 52, price: 799_000 },
  { name: "3-bedroom duplex", units: 100, area: 68, price: 995_000 },
];

/** The elemental estimate. The construction total is their sum, never a typed-in figure. */
const ELEMENTS = [
  { code: "1", label: "Substructure", amount: 44_200_000 },
  { code: "2", label: "Superstructure", amount: 168_900_000 },
  { code: "3", label: "Finishes and fittings", amount: 62_400_000 },
  { code: "4", label: "Engineering services", amount: 71_300_000 },
  { code: "5", label: "External works", amount: 38_600_000 },
  { code: "6", label: "Preliminaries and general", amount: 41_200_000 },
  { code: "7", label: "Contingency", amount: 21_300_000 },
  { code: "8", label: "Escalation", amount: 18_700_000 },
];

/** The four tenders. The lowest and the recommendation are derived, not asserted. */
const TENDERS = [
  { name: "Ndlovu Construction (Pty) Ltd", sum: 478_900_000, correction: 0 },
  { name: "Ridgecrest Building Contractors (Pty) Ltd", sum: 466_200_000, correction: 1_240_000 },
  { name: "Summit Civils & Building (Pty) Ltd", sum: 492_350_000, correction: 0 },
  { name: "Thabo Molefe Construction CC", sum: 471_640_000, correction: 0 },
];

/**
 * The measured and priced bill of quantities — the pre-tender estimate.
 *
 * ── Why the corpus needed one ──────────────────────────────────────────────────────────────
 *
 * The specification says what is to be built and never how much of it, which is right for a
 * specification and left the bill step with nothing to measure from: every item came back with no
 * quantity and no rate, and a bill with an unmeasured item cannot be signed. A real job has this
 * document between the specification and the tender, and this corpus now does too.
 *
 * Its trades are the specification's, clause for clause, so a reader can lay one against the other.
 * The quantities are the whole scheme's – 1 046 units, 50 208 m² – and the section totals land
 * within a few per cent of the cost plan's elements rather than on them, as a measured bill does
 * against a Class 4 estimate. The vinyl rate is the one variation VO-04 later omits at, so the
 * instruction and the bill agree about what the vinyl was priced at.
 */
const BILL = [
  {
    section: "Earthworks and substructure",
    items: [
      { description: "Excavate in all materials for strip footings to the depths shown, average 1,20 m below existing ground level", unit: "m³", quantity: 9_414, rate: 185 },
      { description: "Concrete in footings, 25 MPa/19 mm, mechanically vibrated", unit: "m³", quantity: 5_230, rate: 2_450 },
      { description: "Surface beds 100 mm thick, 25 MPa/19 mm, on 250 micron damp-proof membrane on compacted fill", unit: "m²", quantity: 31_380, rate: 520 },
      { description: "High tensile steel reinforcement to SANS 920, cut, bent and fixed", unit: "kg", quantity: 620_000, rate: 21.5 },
    ],
  },
  {
    section: "Masonry and superstructure",
    items: [
      { description: "External walls one brick thick in clay stock brick, in class II mortar", unit: "m²", quantity: 118_000, rate: 690 },
      { description: "Internal load-bearing walls half brick thick in clay stock brick", unit: "m²", quantity: 76_000, rate: 420 },
      { description: "Suspended floor slabs 170 mm thick, 30 MPa/19 mm, smooth shutter finish to soffits", unit: "m²", quantity: 3_400, rate: 1_450 },
      { description: "Reinforced concrete staircases with cast-in nosings and galvanised mild steel balustrades", unit: "no", quantity: 100, rate: 38_500 },
    ],
  },
  {
    section: "Roofing",
    items: [
      { description: "Pre-fabricated timber roof trusses at 900 mm centres, measured on plan", unit: "m²", quantity: 42_000, rate: 480 },
      { description: "0,5 mm chromadek profiled roof sheeting on purlins, pitch not exceeding 17 degrees", unit: "m²", quantity: 44_500, rate: 395 },
      { description: "Seamless aluminium gutters and downpipes", unit: "m", quantity: 31_400, rate: 265 },
    ],
  },
  {
    section: "Finishes",
    items: [
      { description: "One coat plaster primer and two coats acrylic PVA to internal walls", unit: "m²", quantity: 190_000, rate: 145 },
      { description: "Vinyl tiles on 30 mm screed to living areas and bedrooms", unit: "m²", quantity: 38_000, rate: 385 },
      { description: "Ceramic floor tiles to kitchens and bathrooms", unit: "m²", quantity: 9_500, rate: 540 },
      { description: "6,4 mm gypsum board ceilings on brandering, skimmed and painted, with 75 mm cornices", unit: "m²", quantity: 47_000, rate: 310 },
    ],
  },
  {
    section: "Engineering services",
    items: [
      { description: "Cold and hot water reticulation in class 1 copper piping, complete per unit", unit: "no", quantity: 1_046, rate: 18_500 },
      { description: "Soil and waste drainage in 110 mm uPVC to SANS 967", unit: "m", quantity: 41_800, rate: 420 },
      { description: "Electrical reticulation to SANS 10142-1 with prepaid meter, complete per unit", unit: "no", quantity: 1_046, rate: 16_800 },
      { description: "150 litre indirect solar water heating system, SANS 1307 approved", unit: "no", quantity: 1_046, rate: 15_900 },
    ],
  },
  {
    section: "External works",
    items: [
      { description: "Internal roads in 40 mm asphalt on 150 mm G5 base on 150 mm G7 subbase", unit: "m²", quantity: 21_500, rate: 780 },
      { description: "Parking bays in 80 mm interlocking concrete pavers on 30 mm sand bedding", unit: "m²", quantity: 14_200, rate: 520 },
      { description: "Boundary fencing 1,8 m high welded mesh on galvanised standards", unit: "m", quantity: 1_480, rate: 1_150 },
      { description: "Soft landscaping to courtyards and central open space, including irrigation", unit: "m²", quantity: 38_000, rate: 330 },
    ],
  },
  {
    section: "Preliminaries and general",
    items: [
      { description: "Preliminaries and general, fixed and time-related charges, as detailed in the preliminaries bill", unit: "sum", quantity: 1, rate: 41_200_000 },
    ],
  },
  {
    section: "Provisional sums",
    items: [
      { description: "Provisional sum for the lift installation to the community building", unit: "sum", quantity: 1, rate: 4_200_000 },
      { description: "Provisional sum for municipal connection works", unit: "sum", quantity: 1, rate: 2_600_000 },
    ],
  },
];

const sum = (values) => values.reduce((total, value) => total + value, 0);

/** The bill with its amounts and section totals worked out. Amounts in whole cents, then rand. */
const billSections = BILL.map((section) => {
  const items = section.items.map((item) => ({
    ...item,
    // Rounded once, at the item, as §5.2 has it: quantity × rate to the cent.
    amount: Math.round(item.quantity * item.rate * 100) / 100,
  }));
  return { section: section.section, items, total: sum(items.map((item) => item.amount)) };
});

const units = sum(TYPOLOGIES.map((t) => t.units));
const gfa = sum(TYPOLOGIES.map((t) => t.units * t.area));
const constructionCost = sum(ELEMENTS.map((e) => e.amount));

/** Corrected tender sums, cheapest first — the adjudication's own ordering. */
const corrected = TENDERS.map((t) => ({ ...t, corrected: t.sum + t.correction })).sort(
  (a, b) => a.corrected - b.corrected,
);

const contractSum = corrected[0].corrected;
const retentionPercent = 10;
const retentionLimitPercent = 5;

/** Site, in m². 12.7 ha at 90 units/ha permits more than the scheme proposes — deliberately. */
const erfExtent = 127_000;
const permittedDensity = 90;

const forecastFinalCost = 479_210_000;

/**
 * The contractor's programme – twelve activities and two milestones across the 36-month contract,
 * site handover to practical completion. Phase 1 and phase 2 overlap, as housing is built.
 */
const PROGRAMME = [
  { ref: "1", name: "Site handover", start: "2026-09-18", finish: "2026-09-18", milestone: true },
  { ref: "2", name: "Site establishment", start: "2026-09-21", finish: "2026-10-30" },
  { ref: "3", name: "Bulk earthworks and platforms", start: "2026-10-12", finish: "2027-01-29" },
  { ref: "4", name: "Services reticulation – water, sewer, stormwater", start: "2027-01-11", finish: "2027-09-24" },
  { ref: "5", name: "Foundations – phase 1 blocks", start: "2027-02-01", finish: "2027-07-30" },
  { ref: "6", name: "Superstructure – phase 1 blocks", start: "2027-05-03", finish: "2028-02-25" },
  { ref: "7", name: "Roads and paving", start: "2027-06-07", finish: "2028-03-31" },
  { ref: "8", name: "Roofs – phase 1 blocks", start: "2027-11-01", finish: "2028-04-28" },
  { ref: "9", name: "Finishes and fittings – phase 1", start: "2028-01-10", finish: "2028-09-29" },
  { ref: "10", name: "Phase 2 blocks – foundations to roofs", start: "2028-02-07", finish: "2029-02-23" },
  { ref: "11", name: "Finishes and fittings – phase 2", start: "2028-10-02", finish: "2029-07-27" },
  { ref: "12", name: "External works and landscaping", start: "2029-03-05", finish: "2029-08-31" },
  { ref: "13", name: "Practical completion", start: "2029-09-18", finish: "2029-09-18", milestone: true },
];

export const SCHEME = {
  name: "Ridgeview Gardens",
  code: "RVG-001",
  client: "Ridgeview Housing Development Company (Pty) Ltd",
  employer: "Ridgeview Housing Development Company (Pty) Ltd",
  practice: "Mzilikazi Quantity Surveyors",
  principalAgent: "Mzilikazi Quantity Surveyors",

  // ── Site ──────────────────────────────────────────────────────────────────────────────
  erf: "Erf 4127, Ridgeview Extension 9",
  erfExtent,
  municipality: "eThekwini Metropolitan Municipality",
  province: "KwaZulu-Natal",
  titleDeed: "T4127/2019",
  zoning: "Residential 3",
  permittedDensity,
  permittedUnits: Math.floor((erfExtent / 10_000) * permittedDensity),
  environmentalRef: "DEA/EIA/KZN/0417/2024",
  environmentalDate: "18 October 2024",

  // ── Scheme ────────────────────────────────────────────────────────────────────────────
  typologies: TYPOLOGIES,
  units,
  gfa,
  averageUnitArea: gfa / units,
  averageSellingPrice: Math.round(sum(TYPOLOGIES.map((t) => t.units * t.price)) / units),
  lowestPrice: Math.min(...TYPOLOGIES.map((t) => t.price)),
  highestPrice: Math.max(...TYPOLOGIES.map((t) => t.price)),
  grossRevenue: sum(TYPOLOGIES.map((t) => t.units * t.price)),

  absorption: 144,
  programmeMonths: 36,
  incomeBandLow: 8_000,
  incomeBandHigh: 30_000,
  subsidyQuantum: 121_626,
  bulkContribution: 42_300_000,

  // ── Cost ──────────────────────────────────────────────────────────────────────────────
  elements: ELEMENTS,
  constructionCost,
  costPerSquareMetre: constructionCost / gfa,
  costPerUnit: constructionCost / units,
  estimateClass: "ASAQS Class 4 (concept estimate), accuracy -15% to +25%",
  estimateBaseDate: "31 March 2026",

  // ── Procurement ───────────────────────────────────────────────────────────────────────
  tenders: corrected,
  lowestTender: corrected[0],
  recommendedTender: corrected[0],
  tenderClosing: "14 May 2026",
  tenderValidity: 90,

  // ── Contract ──────────────────────────────────────────────────────────────────────────
  contractForm: "JBCC Principal Building Agreement, Edition 6.2 of May 2018",
  contractor: corrected[0].name,
  contractSum,
  retentionPercent,
  retentionLimit: (contractSum * retentionLimitPercent) / 100,
  retentionLimitPercent,
  siteHandover: "18 September 2026",
  practicalCompletion: "18 September 2029",
  penaltyPerDay: 42_000,
  cpapBaseDate: "1 June 2026",
  paymentDays: 21,
  advancePayment: (contractSum * retentionLimitPercent) / 100,
  contractSigned: "2 June 2026",

  // ── Cost management ───────────────────────────────────────────────────────────────────
  certificateNumber: "07",
  valuationPeriodEnd: "31 January 2027",
  workExecuted: 118_460_000,
  materialsOnSite: 6_240_000,
  previouslyCertified: 96_720_000,
  dayworks: 214_500,

  variationNumber: "VO-04",
  instructionRef: "CI-017",
  instructionDate: "12 November 2026",
  variationValue: 3_180_000,
  variationApproved: "20 November 2026",

  reportDate: "31 January 2027",
  forecastFinalCost,
  varianceAgainstBudget: forecastFinalCost - contractSum,
  committedCost: 402_800_000,
  variationsToDate: 8_940_000,

  // ── Bill of quantities ────────────────────────────────────────────────────────────────
  billReference: "RVG-001/BOQ/10",
  billDate: "28 April 2026",
  bill: billSections,
  billTotal: sum(billSections.map((section) => section.total)),
  provisionalSums: 6_800_000,

  // ── Construction programme – the contractor's, approved at site handover ──────────────────
  // Dates are ISO here; the programme document prints them day first with the weekday, the way an
  // MS Project export does ("Mon 21/09/26"), which is what the platform's date reader must read.
  programmeRef: "RVG-001/PRG/01 Rev 0",
  programme: PROGRAMME,

  // ── Practical completion ──────────────────────────────────────────────────────────────────
  // Two weeks after the contract date: a 21-day claim, 14 days awarded, leaves nothing late.
  practicalCompletionActual: "2029-10-02",
  defectsLiability: "90 calendar days",
  snags: [
    "Touch-up paint to stairwell walls, Blocks C and F",
    "Replace two cracked floor tiles, unit 114",
    "Re-seal three bathroom windows, Block H",
    "Complete landscaping to the western boundary strip",
  ],
  outstandingValue: 186_400,
};

/**
 * Plain grouped number, no currency. Grouping applies to the whole part only.
 *
 * The separator is U+00A0, as it is everywhere else in the platform (§7.7): an ordinary space
 * lets a figure wrap mid-number, and a contract sum broken across two lines is a different
 * number. Grouped by walking the digits rather than by a lookahead, because the whole part is
 * the only part that groups and a decimal comma must not attract separators of its own.
 */
export const number = (value, decimals = 0) => {
  const [whole, fraction] = value.toFixed(decimals).split(".");

  let grouped = "";
  for (let i = 0; i < whole.length; i++) {
    const fromEnd = whole.length - i;
    grouped += whole[i];
    if (fromEnd > 1 && (fromEnd - 1) % 3 === 0) grouped += " ";
  }

  return fraction ? `${grouped},${fraction}` : grouped;
};

/** South African convention throughout — space-grouped thousands, comma decimal (§7.7). */
export const money = (amount, decimals = 0) => `R ${number(amount, decimals)}`;

/**
 * Every relationship the corpus depends on, asserted.
 *
 * The generator calls this before writing anything. A corpus whose documents disagree is worse
 * than no corpus — it would teach a reader that the platform's carried figures are unreliable when
 * the fault was in the test data.
 */
export function verify() {
  const problems = [];
  const near = (a, b, label) => {
    if (Math.abs(a - b) > 0.005) problems.push(`${label}: ${a} != ${b}`);
  };

  near(sum(SCHEME.typologies.map((t) => t.units)), SCHEME.units, "typology units sum to unit count");
  near(sum(SCHEME.typologies.map((t) => t.units * t.area)), SCHEME.gfa, "typology areas sum to GFA");
  near(SCHEME.averageUnitArea, SCHEME.gfa / SCHEME.units, "average unit area is GFA over units");
  near(sum(SCHEME.elements.map((e) => e.amount)), SCHEME.constructionCost, "elements sum to construction cost");
  near(SCHEME.retentionLimit, (SCHEME.contractSum * SCHEME.retentionLimitPercent) / 100, "retention limit is 5% of the contract sum");
  near(SCHEME.varianceAgainstBudget, SCHEME.forecastFinalCost - SCHEME.contractSum, "variance is forecast less contract sum");
  near(SCHEME.contractSum, SCHEME.recommendedTender.corrected, "contract sum is the recommended tender");

  // The bill against the documents around it.
  const bySection = (name) => SCHEME.bill.find((s) => s.section === name)?.total ?? 0;
  near(bySection("Provisional sums"), SCHEME.provisionalSums, "the bill's provisional sums are the cost report's");
  near(bySection("Preliminaries and general"), SCHEME.elements.find((e) => e.label === "Preliminaries and general").amount, "preliminaries are the cost plan's");

  const vinyl = SCHEME.bill.flatMap((s) => s.items).find((i) => /^Vinyl tiles/.test(i.description));
  if (vinyl?.rate !== 385) problems.push(`the bill prices vinyl at ${vinyl?.rate}, where VO-04 omits it at 385`);

  // A measured bill lands near a Class 4 estimate, not on it. Measured work against elements 1–5.
  for (const [section, element] of [
    ["Earthworks and substructure", "Substructure"],
    ["Engineering services", "Engineering services"],
    ["External works", "External works"],
  ]) {
    const planned = SCHEME.elements.find((e) => e.label === element).amount;
    const off = Math.abs(bySection(section) - planned) / planned;
    if (off > 0.05) problems.push(`${section} is ${(off * 100).toFixed(1)}% from the cost plan's ${element}`);
  }
  const measured = sum(["Masonry and superstructure", "Roofing"].map(bySection));
  const superstructure = SCHEME.elements.find((e) => e.label === "Superstructure").amount;
  if (Math.abs(measured - superstructure) / superstructure > 0.05) {
    problems.push(`masonry and roofing together are more than 5% from the cost plan's superstructure`);
  }

  // Below the tender it was priced ahead of, and not absurdly so.
  const againstTender = SCHEME.billTotal / SCHEME.lowestTender.sum;
  if (againstTender > 1 || againstTender < 0.85) {
    problems.push(`the pre-tender estimate is ${(againstTender * 100).toFixed(1)}% of the lowest tender`);
  }

  if (SCHEME.units > SCHEME.permittedUnits) {
    problems.push(`the scheme proposes ${SCHEME.units} units where zoning permits ${SCHEME.permittedUnits}`);
  }

  // A round average unit area is what makes the demo's arithmetic checkable by hand.
  if (!Number.isInteger(SCHEME.averageUnitArea)) {
    problems.push(`average unit area is ${SCHEME.averageUnitArea}, which a reader cannot verify at a glance`);
  }

  return problems;
}
