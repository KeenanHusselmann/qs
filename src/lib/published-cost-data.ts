/**
 * Published South African cost data — building rates and tender escalation, as a guide prints them.
 *
 * ── Why these are in code, like the published factors ──────────────────────────────────────
 *
 * `published-factors.ts` sets the rule and its reasoning applies here word for word: a figure the
 * platform ships must be **structurally** distinguishable from a figure the practice vouched for.
 * A row seeded into `rates` would be editable, withdrawable, and in a year indistinguishable from a
 * rate somebody priced work at. Here the origin cannot be faked — it is in the source, attributed,
 * and nothing writes it to a table.
 *
 * It also answers the other question, which had been left as "load the simulated rates onto
 * production". Those rows say `Simulated test data – not a supplier quote`, and putting them in a
 * practice's live library would be the worst version of this: invented figures wearing the
 * platform's authority, in the one table a QS is entitled to trust. They stay in development.
 *
 * ── Ranges stay ranges ─────────────────────────────────────────────────────────────────────
 *
 * The guide prints most rates as a range, because that is what the data supports: a low-rise office
 * park is R11 300 to R13 900 per m² depending on specification, shape, storeys and services. The
 * midpoint of that is a number nobody published. `published-factors.ts` refuses to ship a midpoint
 * of a wide range for exactly this reason, and so does this: `low` and `high` are both carried, and
 * they are equal only where the guide itself prints one figure.
 *
 * ── What the rates are, and are not ────────────────────────────────────────────────────────
 *
 * They are *approximate inclusive building cost rates* — the whole building at that specification,
 * including appropriate building services, on the SAPOA construction area. They are not bill rates:
 * nothing here prices a cubic metre of concrete, and the library is where a practice's own item
 * rates belong. Their use is the order-of-magnitude check a QS makes before there is a design —
 * what a scheme of this kind costs per m², and whether an estimate in front of them is in the
 * region of it.
 *
 * Every figure below was read from the guide's own tables (pages 56–63 and 89 of the 2025/26
 * edition). Where the guide qualifies a table, the qualification travels with it as a note rather
 * than being dropped.
 */

import { formatMoney, money } from "@/domain/money";

/** The attribution every figure here carries, as a reader sees it. */
export const PUBLISHED_COST_SOURCE = "AECOM Africa Property & Construction Cost Guide 2025/26 (36th edition)";

/** Where to find it, so a reader can check the figure rather than take it. */
export const PUBLISHED_COST_URL = "https://www.asaqs.co.za/news/712133/AECOM-Cost-Guide-202526.htm";

/** What the rates are current to — a price is a fact about a date (§6.3). */
export const PUBLISHED_COST_DATE = "2025-07-01";

/**
 * The guide's own basis, in its own terms. Carried because a rate without it is not a rate: it
 * decides whether the figure in front of a QS is comparable to the one on the screen.
 */
export const BUILDING_RATE_BASIS = [
  "Approximate inclusive building cost rates, current to 1 July 2025, and indicative only.",
  "Excluding VAT, site infrastructure development, parking, future escalation, loss of interest and professional fees.",
  "Including the cost of appropriate building services, for example air-conditioning.",
  "Areas are the construction area as defined in SAPOA's Method for Measuring Floor Areas in Buildings (second edition).",
  "Based on data from Gauteng where possible; costs in parts of the Western Cape and KwaZulu-Natal, and in upper-class residential areas, are generally higher.",
] as const;

/** The units the guide prices in. A building is per m²; a hotel is per key; a prison is per inmate. */
export type PublishedUnit = "m²" | "key" | "seat" | "site" | "no" | "bay" | "m" | "inmate" | "pitch" | "unit" | "theatre";

export interface PublishedRate {
  /** The guide's own table – "Offices", "Retail", "Air-conditioning installation". */
  category: string;
  /** The line as the guide words it. */
  item: string;
  unit: PublishedUnit;
  /** Cents. `low` and `high` are equal where the guide prints a single figure. */
  low: number;
  high: number;
  /** The guide's qualification of this line, where it makes one. */
  note?: string;
}

const R = (rands: number) => rands * 100;
/** A range as the guide prints it; one figure where it prints one. */
const band = (category: string, item: string, unit: PublishedUnit, low: number, high = low, note?: string): PublishedRate => ({
  category,
  item,
  unit,
  low: R(low),
  high: R(high),
  ...(note ? { note } : {}),
});

export const BUILDING_RATES: readonly PublishedRate[] = [
  // ── Offices, parking and retail (p56) ────────────────────────────────────────────────────
  band("Offices", "Low-rise office park development with standard specification", "m²", 11_300, 13_900, "Office rates exclude parking and include tenant allowances – carpets, wallpaper, louvre drapes, partitions, lighting, air-conditioning and electrical reticulation"),
  band("Offices", "Low-rise prestigious office park development", "m²", 14_600, 21_700),
  band("Offices", "High-rise tower block with standard specification", "m²", 16_400, 21_700),
  band("Offices", "High-rise prestigious tower block", "m²", 21_700, 27_400),

  band("Parking", "Parking on grade, including integral landscaping", "m²", 800, 1_000),
  band("Parking", "Structured parking", "m²", 5_500, 6_100),
  band("Parking", "Parking in semi-basement", "m²", 6_100, 8_300),
  band("Parking", "Parking in basement", "m²", 6_500, 11_300),

  band("Retail", "Local convenience centres, not exceeding 5 000 m²", "m²", 11_100, 14_600, "Retail rates include the cost of tenant requirements and the specifications of national chain stores, and vary considerably with the tenant mix and store sizes"),
  band("Retail", "Neighbourhood centres, 5 000 – 12 000 m²", "m²", 12_100, 16_100),
  band("Retail", "Community centres, 12 000 – 25 000 m²", "m²", 13_300, 17_100),
  band("Retail", "Minor regional centres, 25 000 – 50 000 m²", "m²", 14_100, 18_100),
  band("Retail", "Regional centres, 50 000 – 100 000 m²", "m²", 15_000, 18_100),
  band("Retail", "Super regional centres, exceeding 100 000 m²", "m²", 16_400, 21_200),

  // ── Industrial and residential (p57) ─────────────────────────────────────────────────────
  band("Industrial", "Industrial warehouse – steel frame, steel cladding and roof sheeting (light-duty)", "m²", 5_800, 7_400, "Including office and change facilities within the structure area, architect or engineer designed"),
  band("Industrial", "Industrial warehouse – steel frame, brickwork to ceiling, steel cladding above and roof sheeting (heavy-duty)", "m²", 6_500, 9_300),
  band("Industrial", "Administration offices, ablution and change room block", "m²", 10_500, 13_400),
  band("Industrial", "Cold storage facilities", "m²", 19_600, 27_900),

  band("Residential", "Site services to a low-cost housing stand (250 – 350 m²)", "site", 71_000, 114_000),
  // The guide also prints a fully subsidised (RDP) housing rate. It is left out on purpose: the
  // practice's schemes are not RDP housing, and the platform does not present that context.
  // Re-transcribing a later edition should leave it out again.
  band("Residential", "Low-cost housing", "m²", 4_300, 7_400),
  band("Residential", "Simple low-rise apartment block", "m²", 10_300, 14_300),
  band("Residential", "Duplex townhouse – economic", "m²", 10_300, 14_700),
  band("Residential", "Prestige apartment block", "m²", 20_000, 30_000),

  // ── Hotels, studios, student housing and private dwellings (p58) ─────────────────────────
  band("Hotels", "Budget", "key", 890_000, 1_400_000, "Hotel rates include allowances for furniture, fittings and equipment (FF&E)"),
  band("Hotels", "Mid-scale (3-star)", "key", 1_401_000, 2_100_000),
  band("Hotels", "Upper-scale (4-star)", "key", 2_101_000, 3_000_000),
  band("Hotels", "Luxury (5-star)", "key", 3_001_000, 4_000_000),

  band("Studios", "Studios – dancing, art exhibitions and the like", "m²", 19_500, 28_000),
  band("Student residential", "High-rise tower block with standard specification", "m²", 16_000, 17_500, "Including allowances for furniture, fittings and equipment (FF&E)"),

  band("Private dwelling houses", "Economic", "m²", 7_920),
  band("Private dwelling houses", "Standard", "m²", 9_850),
  band("Private dwelling houses", "Middle-class", "m²", 11_830),
  band("Private dwelling houses", "Luxury", "m²", 16_350),
  band("Private dwelling houses", "Exclusive", "m²", 26_450),
  band("Private dwelling houses", "Exceptional (“super luxury”)", "m²", 38_000, 80_000),
  band("Private dwelling houses", "Out buildings – standard", "m²", 7_400),
  band("Private dwelling houses", "Out buildings – luxury", "m²", 10_400),

  band("Residential ancillaries", "Carport (shaded) – single", "no", 6_300),
  band("Residential ancillaries", "Carport (shaded) – double", "no", 12_800),
  band("Residential ancillaries", "Carport (covered) – single", "no", 10_000),
  band("Residential ancillaries", "Carport (covered) – double", "no", 19_500),
  band("Residential ancillaries", "Swimming pool, not exceeding 50 kl", "no", 135_000),
  band("Residential ancillaries", "Swimming pool, exceeding 50 kl and not exceeding 100 kl", "no", 240_000),
  band("Residential ancillaries", "Tennis court – standard", "no", 710_000),
  band("Residential ancillaries", "Tennis court – floodlit", "no", 880_000),

  // ── Conference, retirement, schools, hospitals, stadiums (p59) ───────────────────────────
  band("Conference centres", "Conference centre to international standards", "m²", 36_000, 46_000),

  band("Retirement centres", "Dwelling houses – middle-class", "m²", 11_600),
  band("Retirement centres", "Dwelling houses – luxury", "m²", 16_400),
  band("Retirement centres", "Apartment block – middle-class", "m²", 12_000),
  band("Retirement centres", "Apartment block – luxury", "m²", 18_600),
  band("Retirement centres", "Community centre – middle-class", "m²", 15_800),
  band("Retirement centres", "Community centre – luxury", "m²", 23_000),
  band("Retirement centres", "Frail care", "m²", 18_600),

  band("Schools", "Primary school", "m²", 9_300, 10_700),
  band("Schools", "Secondary school", "m²", 11_100, 11_900),

  band("Hospitals", "District hospital", "m²", 39_000, 39_000, "Hospital rates exclude allowances for furniture, fittings and equipment (FF&E)"),

  band("Stadiums", "Stadium to PSL standards", "seat", 48_000, 74_000),
  band("Stadiums", "Stadium to FIFA standards", "seat", 110_000, 146_000),
  band("Stadiums", "Stadium pitch to FIFA standards", "pitch", 32_000_000, 37_000_000),

  // ── Prisons and airport infrastructure (p60–61) ──────────────────────────────────────────
  band("Prisons", "1 000 inmate prison", "inmate", 830_000, 880_000),
  band("Prisons", "500 inmate prison", "inmate", 855_000, 990_000),
  band("Prisons", "High / maximum security prison", "inmate", 1_300_000, 1_750_000),

  band("Airport infrastructure", "Apron stand – Code F (85 m × 80 m = 6 800 m²)", "m²", 7_800, 7_800, "Airport rates include associated infrastructure and exclude future escalation, loss of interest, professional fees, VAT and ACSA direct costs"),
  band("Airport infrastructure", "Apron stand – Code E (80 m × 65 m = 5 200 m²)", "m²", 8_300),
  band("Airport infrastructure", "Apron stand – Code C (56 m × 40 m = 2 240 m²)", "m²", 10_500),
  band("Airport infrastructure", "Taxi lane – Code F (101 m wide)", "m", 262_000),
  band("Airport infrastructure", "Taxi lane – Code E (85 m wide)", "m", 219_000),
  band("Airport infrastructure", "Taxi lane – Code C (49 m wide)", "m", 130_000),
  band("Airport infrastructure", "Service road (10 m wide)", "m", 26_200),
  band("Airport infrastructure", "Dual carriage service road (15 m wide)", "m", 33_000),
  band("Airport infrastructure", "Taxi way – Code F (70 m wide)", "m", 195_000),
  band("Airport infrastructure", "Runway – Code F (3 885 m × 60 m = 233 100 m²)", "m", 439_000),
  band("Airport infrastructure", "Structured parking", "bay", 268_000, 268_000, "Excluding bulk earthworks"),
  band("Airport infrastructure", "Basement parking", "bay", 402_000, 402_000, "Excluding bulk earthworks"),
  band("Airport infrastructure", "Perimeter walls with perimeter intrusion detection (PIDS)", "m", 12_200),
  band("Airport infrastructure", "Terminal buildings", "m²", 43_000, 43_000, "Excluding baggage and X-ray systems, air bridges, seating and aircraft docking systems"),
  band("Airport infrastructure", "Telescopic air bridge", "unit", 16_000_000),
  band("Airport infrastructure", "Aircraft docking system", "unit", 2_300_000),

  // ── Building services (p62–63) ───────────────────────────────────────────────────────────
  band("Electrical installation", "Offices – standard installation", "m²", 1_100, 1_600),
  band("Electrical installation", "Offices – sophisticated installation", "m²", 1_600, 2_000),
  band("Electrical installation", "UPS, substations and standby generators to office buildings", "m²", 750, 950),
  band("Electrical installation", "Residential", "m²", 950, 1_600),
  band("Electrical installation", "Shopping centres", "m²", 1_600, 2_050),
  band("Electrical installation", "Hotels", "m²", 1_700, 2_250),
  band("Electrical installation", "Hospitals", "m²", 2_200, 3_200),

  band("Electronic installation", "Offices – standard installation", "m²", 500, 750, "Electronic installation includes access control, CCTV, public address, fire detection, data, WiFi, CATV, PABX and the building management system"),
  band("Electronic installation", "Offices – sophisticated installation", "m²", 750, 1_100),
  band("Electronic installation", "Residential", "m²", 450, 750),
  band("Electronic installation", "Shopping centres", "m²", 1_000, 1_350),
  band("Electronic installation", "Hotels", "m²", 950, 1_350),
  band("Electronic installation", "Hospitals", "m²", 1_000, 1_500),

  band("Fire protection installation", "Sprinkler system to offices, including hydrants and hose reels", "m²", 450, 600, "Excluding void sprinklers"),

  band("Air-conditioning installation", "Ventilation to parking and service areas", "m²", 450, 750),
  band("Air-conditioning installation", "Offices – console units", "m²", 1_200, 1_700),
  band("Air-conditioning installation", "Offices – console / split units", "m²", 1_350, 2_150),
  band("Air-conditioning installation", "Offices – package units", "m²", 2_000, 2_900),
  band("Air-conditioning installation", "Offices – central plant", "m²", 2_450, 3_700),
  band("Air-conditioning installation", "Residential – split units", "m²", 1_350, 2_100),
  band("Air-conditioning installation", "Shopping centres – split units", "m²", 1_600, 2_200),
  band("Air-conditioning installation", "Shopping centres – package units", "m²", 2_000, 2_900),
  band("Air-conditioning installation", "Shopping centres – evaporative cooling", "m²", 1_250, 1_800),
  band("Air-conditioning installation", "Hotels – public areas", "m²", 2_400, 3_700),
  band("Air-conditioning installation", "Hospitals – central plant", "m²", 3_200, 5_000),
  band("Air-conditioning installation", "Hotels – console units", "key", 30_500, 40_500),
  band("Air-conditioning installation", "Hotels – split units", "key", 41_500, 62_000),
  band("Air-conditioning installation", "Hotels – central plant", "key", 83_000, 121_000),
  band("Air-conditioning installation", "Hospitals – operating theatres", "theatre", 910_000, 1_500_000, "Printed beneath the hotels per-key table in the guide; read as per operating theatre"),
];

/**
 * Tender price escalation — what building costs have done, and what they are forecast to do.
 *
 * Two indices, because they answer different questions and a QS uses both. **BER** (Bureau for
 * Economic Research, Stellenbosch) is a *tender price* index: what contractors are charging, market
 * conditions included. **CPAP** (Statistics South Africa P0151, Work Group 181 for commercial and
 * industrial buildings) is a *cost* index: labour and materials. The gap between them is the market
 * — the contractor's mark-up, productivity and the availability of materials.
 *
 * **TMI** is BER deflated by CPAP, and reads as the tender climate: falling is a buyer's market,
 * rising says negotiation may beat tendering.
 *
 * 2026 onwards is a forecast, not a measurement, and is marked as one.
 *
 * Indices are tenths (1 457 = 145,7) and changes are basis points (660 = +6,60%), because this
 * file holds no floats (§5.1).
 */
export interface EscalationYear {
  year: number;
  /** January index, tenths, 2020 = 1 000. */
  berIndex: number;
  /** Year on year, basis points. Null for the base year. */
  berChange: number | null;
  cpapIndex: number;
  cpapChange: number | null;
  /** BER ÷ CPAP, thousandths (1 060 = 1,06). */
  tenderMarketIndicator: number;
  forecast: boolean;
}

export const TENDER_ESCALATION: readonly EscalationYear[] = [
  { year: 2020, berIndex: 1_000, berChange: null, cpapIndex: 1_000, cpapChange: null, tenderMarketIndicator: 1_000, forecast: false },
  { year: 2021, berIndex: 1_024, berChange: 240, cpapIndex: 1_060, cpapChange: 600, tenderMarketIndicator: 970, forecast: false },
  { year: 2022, berIndex: 1_081, berChange: 560, cpapIndex: 1_209, cpapChange: 1_410, tenderMarketIndicator: 890, forecast: false },
  { year: 2023, berIndex: 1_191, berChange: 1_010, cpapIndex: 1_284, cpapChange: 620, tenderMarketIndicator: 930, forecast: false },
  { year: 2024, berIndex: 1_367, berChange: 1_480, cpapIndex: 1_351, cpapChange: 520, tenderMarketIndicator: 1_010, forecast: false },
  { year: 2025, berIndex: 1_457, berChange: 660, cpapIndex: 1_378, cpapChange: 200, tenderMarketIndicator: 1_060, forecast: false },
  { year: 2026, berIndex: 1_509, berChange: 360, cpapIndex: 1_440, cpapChange: 450, tenderMarketIndicator: 1_050, forecast: true },
  { year: 2027, berIndex: 1_580, berChange: 470, cpapIndex: 1_507, cpapChange: 460, tenderMarketIndicator: 1_050, forecast: true },
  { year: 2028, berIndex: 1_669, berChange: 560, cpapIndex: 1_573, cpapChange: 440, tenderMarketIndicator: 1_060, forecast: true },
  { year: 2029, berIndex: 1_767, berChange: 590, cpapIndex: 1_642, cpapChange: 440, tenderMarketIndicator: 1_080, forecast: true },
];

export const ESCALATION_BASIS =
  "BER (Bureau for Economic Research, Stellenbosch University) tender price index and the CPAP formula index published by Statistics South Africa (P0151, Work Group 181 – commercial and industrial buildings), January to January. 2026 onwards is the guide's forecast.";

/** The categories in the order the guide prints them – what a picker offers. */
export const BUILDING_RATE_CATEGORIES: readonly string[] = [...new Set(BUILDING_RATES.map((r) => r.category))];

/** "R 11 300,00 – R 13 900,00", or one figure where the guide prints one. */
export function displayBand(r: Pick<PublishedRate, "low" | "high">): string {
  const low = formatMoney(money(BigInt(r.low)), { symbol: "R" });
  return r.low === r.high ? low : `${low} – ${formatMoney(money(BigInt(r.high)), { symbol: "R" })}`;
}

/** "+6,60%", as the guide prints the year-on-year change. */
export function displayChange(basisPoints: number | null): string {
  if (basisPoints === null) return "–";
  return `${basisPoints >= 0 ? "+" : "−"}${(Math.abs(basisPoints) / 100).toFixed(2).replace(".", ",")}%`;
}

/** The escalation a cost plan should carry for a year, as a percentage – the guide's own figure. */
export function escalationFor(year: number): EscalationYear | null {
  return TENDER_ESCALATION.find((e) => e.year === year) ?? null;
}
