/**
 * Simulated rates for testing – a South African rate set the advisor, pricing and take-off can be
 * exercised against before a practice has filed its own.
 *
 * ── Labelled on every row, and withdrawn as a set ──────────────────────────────────────────
 *
 * Every row's source says it is simulated and not a quote, so a figure from this set can never be
 * mistaken for a supplier's price wherever the platform shows its source (the advisor, the pricing
 * screen, a bill). The set is loaded and withdrawn by that source, as one act each, so testing data
 * leaves the library as cleanly as it arrived.
 *
 * The figures are plausible 2026 South African rates, rounded, for testing only.
 */

export const SIMULATED_SOURCE = "Simulated test data – not a supplier quote";
export const SIMULATED_DATE = "2026-09-01";

export interface SimulatedRate {
  trade: string;
  description: string;
  unit: string;
  /** Rand and cents as written, "3,20". */
  rate: string;
  region: string | null;
}

export const SIMULATED_RATES: readonly SimulatedRate[] = [
  // ── Bricks and blocks, per unit ──
  { trade: "Masonry", description: "Clay stock brick, NFP, 222 × 106 × 73 mm", unit: "no", rate: "3,20", region: null },
  { trade: "Masonry", description: "Clay stock brick, NFP, 222 × 106 × 73 mm", unit: "no", rate: "3,60", region: "Western Cape" },
  { trade: "Masonry", description: "Clay stock brick, NFP, 222 × 106 × 73 mm", unit: "no", rate: "3,40", region: "KwaZulu-Natal" },
  { trade: "Masonry", description: "Clay face brick, FBS, standard range", unit: "no", rate: "7,80", region: null },
  { trade: "Masonry", description: "Clay face brick, FBX, premium range", unit: "no", rate: "11,50", region: null },
  { trade: "Masonry", description: "Clay paving brick, 220 × 110 × 50 mm", unit: "no", rate: "4,90", region: null },
  { trade: "Masonry", description: "Cement brick, standard, 222 × 106 × 73 mm", unit: "no", rate: "2,60", region: null },
  { trade: "Masonry", description: "Cement maxi brick, 290 × 140 × 90 mm", unit: "no", rate: "5,40", region: null },
  { trade: "Masonry", description: "Concrete block, hollow, 390 × 190 × 140 mm", unit: "no", rate: "14,50", region: null },
  { trade: "Masonry", description: "Concrete block, hollow, 390 × 190 × 190 mm", unit: "no", rate: "18,90", region: null },
  // ── Walling, complete (bricks, mortar, labour, wastage) ──
  { trade: "Masonry", description: "Half-brick wall in stock brick, complete", unit: "m2", rate: "365,00", region: null },
  { trade: "Masonry", description: "One-brick wall in stock brick, complete", unit: "m2", rate: "685,00", region: null },
  { trade: "Masonry", description: "Half-brick face brick skin, FBS, complete", unit: "m2", rate: "540,00", region: null },
  { trade: "Masonry", description: "190 mm hollow concrete block wall, complete", unit: "m2", rate: "495,00", region: null },
  // ── Materials ──
  { trade: "Materials", description: "Cement, CEM II 42,5N, 50 kg bag", unit: "bag", rate: "118,00", region: null },
  { trade: "Materials", description: "Building sand", unit: "m3", rate: "520,00", region: null },
  { trade: "Materials", description: "Plaster sand", unit: "m3", rate: "560,00", region: null },
  { trade: "Materials", description: "19 mm crushed stone", unit: "m3", rate: "690,00", region: null },
  { trade: "Materials", description: "Ready-mix concrete, 25 MPa / 19 mm", unit: "m3", rate: "2 150,00", region: null },
  { trade: "Materials", description: "Ready-mix concrete, 30 MPa / 19 mm", unit: "m3", rate: "2 290,00", region: null },
  { trade: "Materials", description: "High-yield reinforcement, Y12, cut and bent", unit: "kg", rate: "22,50", region: null },
  { trade: "Materials", description: "Brickforce, 150 mm, galvanised", unit: "m", rate: "4,80", region: null },
  // ── Complete work, per unit of measurement – what a measured bill is priced against ──
  // Worded without sizes, so they are offered against any item that names the same work; the QS
  // reads the item beside the entry before taking it.
  { trade: "Earthworks", description: "Excavate trench for strip footing", unit: "m3", rate: "185,00", region: null },
  { trade: "Earthworks", description: "Backfill trench with selected excavated material", unit: "m3", rate: "145,00", region: null },
  { trade: "Earthworks", description: "Cart away surplus excavated material", unit: "m3", rate: "165,00", region: null },
  { trade: "Concrete", description: "Concrete in strip footing", unit: "m3", rate: "2 450,00", region: null },
  { trade: "Masonry", description: "Foundation walling in brick", unit: "m2", rate: "720,00", region: null },
  { trade: "Masonry", description: "One-brick walling in superstructure", unit: "m2", rate: "690,00", region: null },
  { trade: "Masonry", description: "Brick pier", unit: "no", rate: "1 650,00", region: null },
  { trade: "Masonry", description: "Brick column", unit: "no", rate: "1 650,00", region: null },
  { trade: "Masonry", description: "Brickforce laid in courses", unit: "m", rate: "12,50", region: null },
  { trade: "Masonry", description: "Damp-proof course", unit: "m", rate: "38,00", region: null },
  { trade: "Masonry", description: "Movement joint", unit: "m", rate: "95,00", region: null },
  { trade: "Masonry", description: "Stormwater opening", unit: "no", rate: "180,00", region: null },
  { trade: "Precast", description: "Precast concrete coping", unit: "m", rate: "240,00", region: null },
  { trade: "Finishes", description: "Cement plaster to walling", unit: "m2", rate: "165,00", region: null },
  { trade: "Finishes", description: "Acrylic paint, exterior", unit: "m2", rate: "95,00", region: null },
  // ── Labour ──
  { trade: "Labour", description: "Bricklayer", unit: "hour", rate: "95,00", region: null },
  { trade: "Labour", description: "Bricklayer's assistant", unit: "hour", rate: "45,00", region: null },
  { trade: "Labour", description: "General labourer", unit: "hour", rate: "38,00", region: null },
  { trade: "Labour", description: "Plasterer", unit: "hour", rate: "90,00", region: null },
];
