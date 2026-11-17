/**
 * Benchmarks broken down by stage of work — November meeting.
 *
 * Raymond's words: the published guide gives "a generic rate per square metre for the different
 * types of housing, but it doesn't give me a sense in terms of what that breakdown looks like for a
 * multi-storey walk-up". For a boundary wall the work goes earthworks, concrete and formwork,
 * masonry, waterproofing, movement joints, precast, sundries. For a block of flats: clearing and
 * earthworks, retaining walls, foundations, then bricks and slabs floor by floor, then the roof, then
 * finishes, plumbing and drainage, electrical. "If they do excavation, what is a typical rate?"
 *
 * A high-rise is the same question with a framed structure: preliminaries, bulk earthworks, lateral
 * support, piling and foundations, the frame and the slabs floor by floor, stairs, walls, the
 * envelope, the roof, lifts, the services, finishes and external works. Each profile lists its
 * stages in the order the work is built, and the page shows every one of them – a stage nobody has
 * priced yet is a gap to see, not a row to drop.
 *
 * ── Where the typical rates come from ──────────────────────────────────────────────────────
 *
 * Not from the platform's imagination. The published guide does not break costs down this way, so
 * the figures here come from bills the practice has signed and the tenders priced against them – the
 * boundary wall's estimate and its five returns are exactly this kind of data. A published source per
 * stage can be added when one is chosen; until then the page says there is none.
 *
 * ── How an item finds its stage ────────────────────────────────────────────────────────────
 *
 * By words, in order: the item's own description first, then the section it sits under. The first
 * stage whose words match wins, so a more specific stage is listed before a general one ("movement
 * joints" before "masonry", "waterproofing" before "concrete"). An item nothing matches is a sundry,
 * never forced into a stage. Provisional and prime-cost sums are their own group: the bill fixed
 * them, nobody priced them, and they would distort every typical rate they touched.
 *
 * Pure: rows in, breakdown out.
 */

export interface Stage {
  key: string;
  label: string;
  /** Words that put an item in this stage – matched case-insensitively against whole words. */
  words: readonly string[];
}

export interface BenchmarkProfile {
  key: string;
  label: string;
  /** In matching priority – the specific before the general – not the order the work is built in. */
  stages: readonly Stage[];
  /** The order the work is built in, which is how the stages are shown. */
  sequence: readonly string[];
}

/** Fixed sums the bill sets; never part of a typical rate. */
export const FIXED_SUMS: Stage = { key: "fixed", label: "Provisional and prime-cost sums", words: ["provisional sum", "prime cost", "pc sum", "p.c. sum"] };
export const SUNDRIES = "sundries";

export const PROFILES: readonly BenchmarkProfile[] = [
  {
    key: "boundary-wall",
    label: "Boundary wall",
    sequence: ["earthworks", "concrete", "masonry", "waterproofing", "joints", "precast"],
    stages: [
      { key: "earthworks", label: "Earthworks – clearing, levelling, excavation, backfill", words: ["clearance", "clearing", "levelling", "excavate", "excavation", "trench", "backfill", "filling", "fill material", "compact", "compaction", "cart away", "earthworks"] },
      { key: "joints", label: "Movement joints", words: ["movement joint", "expansion joint", "control joint", "joint filler", "sealant"] },
      { key: "waterproofing", label: "Waterproofing", words: ["waterproof", "waterproofing", "damp-proof", "damp proof", "dpc", "dpm", "membrane", "bituminous", "tanking"] },
      { key: "precast", label: "Precast", words: ["precast", "pre-cast", "coping", "copings"] },
      { key: "concrete", label: "Concrete and formwork", words: ["concrete", "formwork", "shuttering", "reinforcement", "rebar", "mesh", "footing", "footings", "foundation", "foundations", "blinding"] },
      { key: "masonry", label: "Masonry", words: ["brick", "bricks", "brickwork", "block", "blockwork", "masonry", "pier", "piers", "brickforce", "mortar"] },
    ],
  },
  {
    key: "walk-up-flats",
    label: "Walk-up flats (multi-storey)",
    sequence: ["preliminaries", "earthworks", "retaining", "foundations", "brickwork", "slabs", "roof", "finishes", "plumbing", "electrical"],
    stages: [
      { key: "preliminaries", label: "Preliminaries and site establishment", words: ["preliminaries", "preliminary", "site establishment", "establishment", "site camp", "site office", "site offices", "hoarding", "tower crane", "scaffold", "scaffolding", "insurances", "contract guarantee"] },
      { key: "earthworks", label: "Site clearance and earthworks", words: ["clearance", "clearing", "levelling", "excavate", "excavation", "trench", "backfill", "filling", "fill material", "compact", "compaction", "cart away", "earthworks"] },
      { key: "retaining", label: "Retaining and supporting walls", words: ["retaining", "gabion", "terramesh", "embankment", "slope"] },
      { key: "foundations", label: "Foundations", words: ["foundation", "foundations", "footing", "footings", "strip", "pile", "piles", "raft", "blinding"] },
      { key: "roof", label: "Roof", words: ["roof", "roofing", "roof tiles", "truss", "trusses", "purlin", "purlins", "roof sheeting", "fascia", "gutter", "gutters", "downpipe", "downpipes"] },
      // Electrical before plumbing: "25 mm PVC conduit pipe" is wiring, and "pipe" would claim it.
      { key: "electrical", label: "Electrical", words: ["electrical", "electric", "wiring", "conduit", "socket", "sockets", "light", "lights", "lighting", "db board", "distribution board", "cable"] },
      { key: "plumbing", label: "Plumbing, drainage and sewage", words: ["plumbing", "drainage", "drain", "sewer", "sewage", "manhole", "pipe", "pipes", "geyser", "sanitary", "basin", "wc", "shower", "water supply"] },
      { key: "finishes", label: "Finishes", words: ["plaster", "screed", "paint", "painting", "tiling", "floor finish", "skirting", "glazing", "window", "windows", "door", "doors", "ironmongery", "joinery", "cupboard", "cupboards", "ceiling", "ceilings", "tiles", "tile"] },
      { key: "slabs", label: "Superstructure – concrete slabs", words: ["slab", "slabs", "suspended", "beam", "beams", "column", "columns", "concrete", "formwork", "reinforcement", "rebar"] },
      { key: "brickwork", label: "Superstructure – brickwork", words: ["brick", "bricks", "brickwork", "block", "blockwork", "masonry", "brickforce", "lintel", "lintels"] },
    ],
  },
  {
    key: "high-rise",
    label: "High-rise (framed, multi-storey)",
    sequence: ["preliminaries", "earthworks", "lateral", "foundations", "frame", "slabs", "stairs", "walls", "envelope", "roof", "lifts", "plumbing", "electrical", "mechanical", "finishes", "external"],
    /*
      Matching priority, specific before general. Lateral support before earthworks, because
      "soil nailing to the basement excavation" is support, not digging. Foundations and slabs come before the frame
      because the frame's words include plain "concrete" and "reinforcement" – "concrete in pile caps"
      is foundations and "formwork to suspended slabs" is a slab, and only what is left is frame.
      The frame's own "lift core" comes before Lifts for the same reason. Windows and glazing are the
      envelope here, not finishes: on a framed tower they are the façade.
    */
    stages: [
      { key: "preliminaries", label: "Preliminaries and site establishment", words: ["preliminaries", "preliminary", "site establishment", "establishment", "site camp", "site office", "site offices", "hoarding", "tower crane", "scaffold", "scaffolding", "insurances", "contract guarantee"] },
      { key: "lateral", label: "Lateral support and retaining", words: ["lateral support", "shoring", "soil nail", "soil nailing", "ground anchor", "ground anchors", "retaining", "gabion", "contiguous pile wall", "diaphragm wall"] },
      { key: "earthworks", label: "Site clearance and bulk earthworks", words: ["clearance", "clearing", "levelling", "excavate", "excavation", "bulk excavation", "trench", "backfill", "filling", "fill material", "compact", "compaction", "cart away", "earthworks"] },
      { key: "external", label: "External works", words: ["external works", "paving", "paved", "kerb", "kerbs", "landscaping", "planting", "fencing", "fence", "gate", "gates", "parking", "asphalt", "road", "roads"] },
      { key: "roof", label: "Roof and waterproofing", words: ["roof", "roofing", "waterproof", "waterproofing", "membrane", "torch-on", "flashing", "flashings", "parapet", "parapets", "gutter", "gutters", "downpipe", "downpipes"] },
      { key: "envelope", label: "External envelope – façade, cladding and windows", words: ["facade", "façade", "cladding", "curtain wall", "curtain walling", "window", "windows", "glazing", "shopfront", "louvre", "louvres"] },
      { key: "mechanical", label: "Mechanical – HVAC and ventilation", words: ["hvac", "air conditioning", "air-conditioning", "ventilation", "extraction", "mechanical", "ducting", "duct"] },
      { key: "electrical", label: "Electrical", words: ["electrical", "electric", "wiring", "conduit", "socket", "sockets", "light", "lights", "lighting", "db board", "distribution board", "cable", "generator", "standby"] },
      { key: "plumbing", label: "Plumbing, drainage and fire", words: ["plumbing", "drainage", "drain", "sewer", "sewage", "manhole", "pipe", "pipes", "geyser", "sanitary", "basin", "wc", "shower", "water supply", "fire hose", "hose reel", "sprinkler", "sprinklers", "hydrant", "hydrants"] },
      { key: "finishes", label: "Finishes", words: ["plaster", "screed", "paint", "painting", "tiling", "floor finish", "skirting", "door", "doors", "ironmongery", "joinery", "cupboard", "cupboards", "ceiling", "ceilings", "tiles", "tile"] },
      { key: "stairs", label: "Stairs and balustrades", words: ["stair", "stairs", "staircase", "staircases", "balustrade", "balustrades", "handrail", "handrails"] },
      { key: "foundations", label: "Piling and foundations", words: ["pile", "piles", "piling", "pile cap", "pile caps", "raft", "foundation", "foundations", "footing", "footings", "ground beam", "ground beams", "blinding"] },
      { key: "slabs", label: "Upper floors – suspended slabs", words: ["slab", "slabs", "suspended", "post-tensioned", "post tensioned", "flat slab"] },
      { key: "frame", label: "Structural frame – columns, core and beams", words: ["column", "columns", "core wall", "core walls", "shear wall", "shear walls", "lift core", "lift shaft", "beam", "beams", "structural steel", "steel frame", "concrete", "formwork", "reinforcement", "rebar"] },
      { key: "lifts", label: "Lifts", words: ["lift", "lifts", "elevator", "elevators", "escalator", "escalators"] },
      { key: "walls", label: "Walls – brick and block infill, partitions", words: ["brick", "bricks", "brickwork", "block", "blockwork", "masonry", "brickforce", "lintel", "lintels", "partition", "partitions", "drywall"] },
    ],
  },
];

export const profileOf = (key: string | null | undefined): BenchmarkProfile => PROFILES.find((p) => p.key === key) ?? PROFILES[0]!;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/*
  Whole words, and their plurals: "Movement joints" has to find "movement joint". Without the plural
  ending it fell through to sundries – caught by a unit test; the demo bill only matched because the
  same line also said "sealant".
*/
const matcher = (words: readonly string[]) => new RegExp(`(?<![a-z])(?:${words.map(escape).join("|")})(?:e?s)?(?![a-z])`, "i");

/** The stage an item belongs to: its own words first, then its section's, else sundries. */
export function stageOf(profile: BenchmarkProfile, item: { description: string; section: string | null; fixed?: boolean }): string {
  if (item.fixed || matcher(FIXED_SUMS.words).test(item.description)) return FIXED_SUMS.key;
  for (const text of [item.description, item.section ?? ""]) {
    for (const stage of profile.stages) if (matcher(stage.words).test(text)) return stage.key;
  }
  return SUNDRIES;
}

export interface PricedItem {
  id: string;
  description: string;
  section: string | null;
  unit: string | null;
  quantity: number | null;
  /** Rands per unit. */
  rate: number | null;
  /** A provisional or prime-cost sum by its row type, whatever its words. */
  fixed?: boolean;
}

export interface StageTotal {
  stage: string;
  amount: number;
  items: number;
  /** The unit carrying most of the stage's money, and the rate over it – a "typical rate" in R/unit. */
  unit: string | null;
  rate: number | null;
}

/**
 * One source broken down: what each stage comes to, and its rate per its main unit. The rate is the
 * stage's amount in that unit over the quantity in that unit – a weighted rate, so a large cheap
 * item and a small dear one are not averaged as equals.
 */
export function breakdown(profile: BenchmarkProfile, items: readonly PricedItem[]): { stages: StageTotal[]; total: number } {
  const groups = new Map<string, PricedItem[]>();
  for (const item of items) {
    if (item.quantity === null || item.rate === null) continue;
    const key = stageOf(profile, item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const stages = [...groups.entries()].map(([stage, list]): StageTotal => {
    const byUnit = new Map<string, { amount: number; quantity: number }>();
    for (const i of list) {
      const unit = (i.unit ?? "").trim().toLowerCase() || "item";
      const u = byUnit.get(unit) ?? { amount: 0, quantity: 0 };
      byUnit.set(unit, { amount: u.amount + i.quantity! * i.rate!, quantity: u.quantity + i.quantity! });
    }
    const [unit, main] = [...byUnit.entries()].sort((a, b) => b[1].amount - a[1].amount)[0]!;
    return {
      stage,
      amount: list.reduce((s, i) => s + i.quantity! * i.rate!, 0),
      items: list.length,
      unit: stage === FIXED_SUMS.key ? null : unit,
      rate: stage === FIXED_SUMS.key || main.quantity === 0 ? null : main.amount / main.quantity,
    };
  });
  return { stages, total: stages.reduce((s, x) => s + x.amount, 0) };
}

export interface StageBenchmark {
  stage: string;
  label: string;
  /** Share of the measured work (fixed sums excluded), per source. */
  shares: number[];
  /** Typical rate per the stage's main unit, per source that priced it in that unit. */
  unit: string | null;
  rates: number[];
}

const median = (xs: readonly number[]) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export const spread = (xs: readonly number[]) => (xs.length === 0 ? null : { low: Math.min(...xs), median: median(xs)!, high: Math.max(...xs), n: xs.length });

/**
 * Across sources: each stage's share of the work and its typical rate, as a range. The unit is the
 * one most sources priced the stage in; a source that priced it in another unit is left out of the
 * rate rather than mixed in (R/m³ and R/m² are not one number), but still counts towards the share.
 */
export function benchmarkStages(profile: BenchmarkProfile, sources: readonly { stages: StageTotal[]; total: number }[]): StageBenchmark[] {
  const label = new Map(profile.stages.map((s) => [s.key, s.label]));
  const order = [...profile.sequence.map((key) => [key, label.get(key) ?? key] as const), [SUNDRIES, "Sundries"] as const];
  return order.flatMap(([key, label]) => {
    const present = sources.map((src) => ({ src, s: src.stages.find((x) => x.stage === key) })).filter((x) => x.s);
    if (present.length === 0) return [];
    const measured = (src: { stages: StageTotal[] }) => src.stages.filter((x) => x.stage !== FIXED_SUMS.key).reduce((t, x) => t + x.amount, 0);
    const units = new Map<string, number>();
    for (const { s } of present) if (s!.unit) units.set(s!.unit, (units.get(s!.unit) ?? 0) + 1);
    const unit = [...units.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return [{
      stage: key,
      label,
      shares: present.map(({ src, s }) => (measured(src) > 0 ? s!.amount / measured(src) : 0)),
      unit,
      rates: present.filter(({ s }) => s!.unit === unit && s!.rate !== null).map(({ s }) => s!.rate!),
    }];
  });
}
