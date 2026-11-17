import { describe, expect, it } from "vitest";

import { benchmarkStages, breakdown, FIXED_SUMS, PROFILES, profileOf, SUNDRIES, spread, stageOf, type PricedItem } from "./benchmark-stages";

const wall = profileOf("boundary-wall");
const flats = profileOf("walk-up-flats");
const tower = profileOf("high-rise");
const at = (profile: typeof wall, description: string, section: string | null = null) => stageOf(profile, { description, section });

describe("stageOf – the boundary wall", () => {
  const cases: [string, string][] = [
    ["Site clearance along wall line", "earthworks"],
    ["Excavate trench for strip footing", "earthworks"],
    ["Backfill and compact in layers", "earthworks"],
    ["25 MPa concrete in strip footings", "concrete"],
    ["Formwork to sides of footings", "concrete"],
    ["Y12 reinforcement", "concrete"],
    ["One-brick wall in 14 MPa bricks", "masonry"],
    ["Brick piers 345 x 345 mm", "masonry"],
    ["Bituminous waterproofing to footing", "waterproofing"],
    ["Movement joints with sealant", "joints"],
    ["Precast concrete coping", "precast"],
    ["Clean down on completion", SUNDRIES],
  ];
  for (const [description, stage] of cases) it(`${description} → ${stage}`, () => expect(at(wall, description)).toBe(stage));

  it("finds a stage's words in the plural too", () => {
    expect(at(wall, "Movement joints at 6 m centres")).toBe("joints");
    expect(at(flats, "Timber trusses at 900 centres")).toBe("roof");
  });
  it("a brick strength in MPa does not make brickwork concrete", () => expect(at(wall, "One-brick wall in 14 MPa bricks")).toBe("masonry"));
  it("falls back to the section heading when the description says nothing", () => expect(at(wall, "Item 7", "Masonry")).toBe("masonry"));
  it("keeps provisional and prime-cost sums out of every stage", () => {
    expect(at(wall, "Provisional sum: electric fence")).toBe(FIXED_SUMS.key);
    expect(stageOf(wall, { description: "Electric fence", section: null, fixed: true })).toBe(FIXED_SUMS.key);
  });
});

describe("stageOf – walk-up flats", () => {
  const cases: [string, string][] = [
    ["Brickwork below ground level", "brickwork"],
    ["Excavate for foundations", "earthworks"],
    ["Concrete in strip foundations", "foundations"],
    ["Gabion retaining wall to embankment", "retaining"],
    ["150 mm suspended concrete slab", "slabs"],
    ["One-brick external walls", "brickwork"],
    ["Concrete roof tiles on battens", "roof"],
    ["Ceramic floor tiles", "finishes"],
    ["Two coats plaster to brickwork", "finishes"],
    ["25 mm PVC conduit pipe", "electrical"],
    ["110 mm uPVC sewer pipe", "plumbing"],
  ];
  for (const [description, stage] of cases) it(`${description} → ${stage}`, () => expect(at(flats, description)).toBe(stage));
});

describe("stageOf – high-rise", () => {
  const cases: [string, string][] = [
    ["Preliminaries and general", "preliminaries"],
    ["Tower crane: erect, maintain and dismantle", "preliminaries"],
    ["Bulk excavation in all materials", "earthworks"],
    ["Soil nailing to basement excavation", "lateral"],
    ["600 mm diameter auger piles", "foundations"],
    ["Concrete in pile caps", "foundations"],
    ["Formwork to soffits of suspended slabs", "slabs"],
    ["40 MPa concrete in columns", "frame"],
    ["Y16 reinforcement", "frame"],
    ["Concrete to lift core walls", "frame"],
    ["Plaster to lift core walls", "finishes"],
    ["Precast concrete staircase", "stairs"],
    ["One-brick infill walls", "walls"],
    ["Aluminium windows, glazed", "envelope"],
    ["Fibre-cement cladding to facade", "envelope"],
    ["Torch-on waterproofing to roof", "roof"],
    ["Passenger lifts, 13 persons", "lifts"],
    ["Fire hose reels", "plumbing"],
    ["Distribution board", "electrical"],
    ["Ducted air conditioning", "mechanical"],
    ["Ceramic floor tiles", "finishes"],
    ["Interlocking paving to parking", "external"],
  ];
  for (const [description, stage] of cases) it(`${description} → ${stage}`, () => expect(at(tower, description)).toBe(stage));
});

describe("every profile", () => {
  it("names the same stages in its build sequence as in its matching list", () => {
    for (const profile of PROFILES) {
      expect([...profile.sequence].sort(), profile.key).toEqual(profile.stages.map((s) => s.key).sort());
    }
  });
});

describe("breakdown and benchmarkStages", () => {
  const item = (id: string, description: string, unit: string, quantity: number, rate: number): PricedItem => ({ id, description, section: null, unit, quantity, rate });
  const estimate = [
    item("a", "Excavate trench for footing", "m3", 100, 200),
    item("b", "One-brick wall", "m2", 500, 600),
    item("c", "Brick piers", "no", 50, 1_000),
    item("d", "Provisional sum: electric fence", "sum", 1, 185_000),
  ];

  it("weights a stage's rate by quantity in its main unit, and keeps fixed sums out", () => {
    const { stages } = breakdown(wall, estimate);
    const masonry = stages.find((s) => s.stage === "masonry")!;
    // Masonry is R 300 000 of walling (m²) and R 50 000 of piers (no): the main unit is m², R 600/m².
    expect(masonry.amount).toBe(350_000);
    expect(masonry.unit).toBe("m2");
    expect(masonry.rate).toBe(600);
    expect(stages.find((s) => s.stage === FIXED_SUMS.key)!.rate).toBeNull();
  });

  it("gives each stage its share of the measured work and a range of rates across sources", () => {
    const dearer = estimate.map((i) => ({ ...i, rate: i.id === "d" ? i.rate : i.rate! * 1.1 }));
    const [earth, masonry] = benchmarkStages(wall, [breakdown(wall, estimate), breakdown(wall, dearer)]);
    expect(earth!.stage).toBe("earthworks");
    // R 20 000 of R 370 000 measured; the fixed sum is not measured work.
    expect(earth!.shares[0]).toBeCloseTo(20_000 / 370_000, 9);
    expect(spread(masonry!.rates)).toEqual({ low: 600, median: 630, high: 660, n: 2 });
  });

  it("shows the stages in the order the work is built, not the order words are matched", () => {
    const all = ["Site clearance", "Movement joints", "Bituminous waterproofing", "Precast coping", "Concrete footings", "One-brick wall"].map((d, i) => item(String(i), d, "m", 1, 100));
    expect(benchmarkStages(wall, [breakdown(wall, all)]).map((s) => s.stage)).toEqual(["earthworks", "concrete", "masonry", "waterproofing", "joints", "precast"]);
  });

  it("every profile shows every stage it can match, and nothing it cannot", () => {
    for (const p of [wall, flats]) expect([...p.sequence].sort()).toEqual(p.stages.map((s) => s.key).sort());
  });

  it("leaves an unpriced item out rather than pricing it at nought", () => {
    const { stages } = breakdown(wall, [item("x", "One-brick wall", "m2", 10, 600), { ...item("y", "One-brick wall", "m2", 10, 0), rate: null }]);
    expect(stages[0]!.items).toBe(1);
  });
});
