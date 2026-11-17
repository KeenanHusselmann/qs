import { describe, expect, it } from "vitest";

import { reviewAllowances, reviewBill, type RubricItem } from "@/domain/bill-rubric";

/**
 * The boundary-wall bill as the platform measured it, and as the review found it.
 *
 * Fifteen items, five sections, R2 263 392,85 of measured work – and the review's finding was that
 * every figure added up while R476 000 of work was never measured. These are those fifteen items,
 * so the rubric is tested against the bill that taught us what it is for.
 */
const measured: RubricItem[] = [
  { section: "Earthworks", description: "Excavate trench for strip footing in firm soil", unit: "m3", quantity: 203.29, assumed: true },
  { section: "Earthworks", description: "Backfill to trenches with selected excavated material", unit: "m3", quantity: 90.35 },
  { section: "Earthworks", description: "Cart away surplus excavated material", unit: "m3", quantity: 112.94 },
  { section: "Concrete", description: "15 MPa concrete in strip footings", unit: "m3", quantity: 67.76, assumed: true },
  { section: "Masonry", description: "Foundation walling, 230 mm, in cement bricks", unit: "m2", quantity: 196.42 },
  { section: "Masonry", description: "One-brick walling in superstructure", unit: "m2", quantity: 1_017.12 },
  { section: "Masonry", description: "460 x 500 mm brick columns", unit: "no", quantity: 165 },
  { section: "Masonry", description: "Brickforce to openings", unit: "m", quantity: 830.3 },
  { section: "Masonry", description: "Movement joints in walling", unit: "m", quantity: 210.7 },
  { section: "Masonry", description: "Damp-proof course, 230 mm wide", unit: "m", quantity: 491.05 },
  { section: "Masonry", description: "300 x 200 mm stormwater openings", unit: "no", quantity: 83 },
  { section: "Precast", description: "Precast concrete coping, 360 mm wide", unit: "m", quantity: 491.05 },
  { section: "Finishes", description: "Cement plaster to walls", unit: "m2", quantity: 2_034.24 },
  { section: "Finishes", description: "Cement plaster to columns", unit: "m2", quantity: 776.16 },
  { section: "Finishes", description: "Two coats exterior acrylic paint to walls", unit: "m2", quantity: 2_810.4 },
];

const ids = (items: RubricItem[], context = {}) => reviewBill(items, context).map((f) => f.id);

describe("the bill rubric, over the bill that prompted it", () => {
  it("names the work that was left out", () => {
    const found = ids(measured);
    // The five that cost the most, in the review's own order of consequence.
    expect(found).toContain("blinding");
    expect(found).toContain("reinforcement");
    expect(found).toContain("pier-footings");
    expect(found).toContain("lintels");
    expect(found).toContain("pier-caps");
  });

  it("reads the cart-away as unbulked, from the figures themselves", () => {
    const bulking = reviewBill(measured).find((f) => f.id === "bulking")!;
    // 203,29 less 90,35 is 112,94 exactly – the tell-tale that nothing was bulked.
    expect(bulking.finding).toMatch(/112\.94 m³/);
    expect(bulking.action).toMatch(/bulking factor/);
  });

  it("puts the missing work first and the wording second", () => {
    const review = reviewBill(measured);
    expect(review[0]!.severity).toBe("high");
    const severities = review.map((f) => f.severity);
    expect(severities.indexOf("low")).toBeGreaterThan(severities.lastIndexOf("high"));
  });

  it("says what a description does not say", () => {
    const found = ids(measured);
    // "15 MPa concrete" states its grade; the foundation walling does not say it belongs below ground.
    expect(found.some((id) => id.startsWith("below-dpc-spec"))).toBe(true);
    expect(found.some((id) => id.startsWith("plaster-spec"))).toBe(true);
    expect(found.some((id) => id.startsWith("joint-spec"))).toBe(true);
    expect(found.some((id) => id.startsWith("grade:"))).toBe(false);
  });

  /**
   * Below the damp course, the durability class is what makes a unit right: SANS 227's NFX, or
   * engineering units. The check once passed "NFP" (the plaster brick), "imperial" (a size),
   * "solid" (a shape) and "class II" (the mortar), none of which says it.
   */
  it("asks for a unit fit for the damp below DPC, not a size, shape, strength or mortar", () => {
    const belowDpc = (description: string) =>
      ids([{ description, unit: "m2", quantity: 196.42 }]).some((id) => id.startsWith("below-dpc-spec"));

    for (const vague of [
      "Foundation walling, 230 mm, in NFP clay bricks",
      "Foundation walling in imperial bricks",
      "Foundation walling, solid cement bricks",
      "Foundation walling in 14 MPa bricks, class II mortar, below ground",
    ]) {
      expect(belowDpc(vague), vague).toBe(true);
    }

    for (const fit of [
      "Foundation walling, 230 mm, in NFX clay bricks, class II mortar",
      "Substructure walling in engineering bricks",
      "Foundation walling in cement bricks suitable for moist exposure below DPC",
    ]) {
      expect(belowDpc(fit), fit).toBe(false);
    }
  });

  it("carries the assumed figures through as a finding of their own", () => {
    const assumed = reviewBill(measured).find((f) => f.id === "assumed")!;
    expect(assumed.severity).toBe("high");
    expect(assumed.finding).toMatch(/2 items rest on a figure nobody read/);
  });

  it("asks about the primer, the brickforce rule and the site it is on", () => {
    const found = ids(measured, { slopingGround: true });
    expect(found).toContain("primer");
    expect(found).toContain("brickforce-rule");
    expect(found).toContain("site-clearance");
    expect(found).toContain("steps");
  });
});

describe("what the rubric does not do", () => {
  it("says nothing about a bill that has none of the work", () => {
    expect(reviewBill([])).toEqual([]);
  });

  it("does not ask for pier footings, caps or lintels where there are no piers or openings", () => {
    const simple: RubricItem[] = [
      { description: "25 MPa concrete in strip footings, reinforced", unit: "m3", quantity: 12 },
      { description: "50 mm blinding under footings", unit: "m3", quantity: 2 },
      { description: "Y12 reinforcement, cut, bent and fixed", unit: "kg", quantity: 900 },
      { description: "One-brick walling in superstructure", unit: "m2", quantity: 100 },
      { description: "Brickforce every fourth course", unit: "m", quantity: 400 },
      { description: "Damp-proof course, 230 mm wide, polyethylene", unit: "m", quantity: 40 },
      { description: "Movement joints with Jointex filler and polysulphide sealant", unit: "m", quantity: 20 },
    ];
    const found = ids(simple);
    for (const absent of ["pier-footings", "pier-caps", "lintels", "reinforcement", "blinding", "brickforce", "dpc", "movement-joints", "assumed"]) {
      expect(found, `${absent} should not be raised`).not.toContain(absent);
    }
  });

  it("takes the engineer's word that a footing is unreinforced", () => {
    const unreinforced: RubricItem[] = [
      { description: "15 MPa concrete in strip footings", unit: "m3", quantity: 8 },
      { description: "50 mm blinding under footings", unit: "m3", quantity: 1 },
    ];
    expect(ids(unreinforced, { reinforcedDesign: false })).not.toContain("reinforcement");
    expect(ids(unreinforced)).toContain("reinforcement");
  });
});

/**
 * The same wall, at its tender revision – the gaps the independent review of Rev 3 found, and the
 * bill once Rev 4 had put them right. Each new check is held to both: it fires on the gap, and it
 * is silent once the work is measured.
 */
describe("the boundary wall's second review", () => {
  const gaps: RubricItem[] = [
    { section: "Concrete", description: "25 MPa / 19 mm concrete in strip footings", unit: "m3", quantity: 187.2 },
    { section: "Concrete", description: "50 mm 15 MPa blinding under footings", unit: "m3", quantity: 31.2 },
    { section: "Concrete", description: "Y12 reinforcement to footings", unit: "kg", quantity: 13_037 },
    { section: "Concrete", description: "Extra over footings for steps", unit: "m3", quantity: 4 },
    { section: "Masonry", description: "Pier footing bases 1000 x 1800 x 300 mm", unit: "no", quantity: 166 },
    { section: "Masonry", description: "Boundary wall in semi-face brick, fair-faced both sides", unit: "m2", quantity: 1_471 },
    { section: "Masonry", description: "Brick piers", unit: "no", quantity: 166 },
    { section: "Masonry", description: "Brickforce every fourth course to panels", unit: "m", quantity: 4_200 },
    { section: "Masonry", description: "Damp-proof course, 220 mm wide – deletion recommended (Q13)", unit: "m", quantity: 491 },
    { section: "Masonry", description: "300 x 200 mm stormwater openings", unit: "no", quantity: 82 },
    { section: "Precast", description: "Precast coping 330 mm wide", unit: "m", quantity: 381.5 },
    { section: "Precast", description: "Precast pier caps", unit: "no", quantity: 166 },
    { section: "Finishes", description: "Primer and two coats acrylic paint to walls", unit: "m2", quantity: 2_943 },
  ];

  it("finds each gap the review found", () => {
    const found = ids(gaps);
    for (const id of ["step-overlap", "pier-brickforce", "dpc-free-standing", "cap-finish", "clean-down", "scour"]) {
      expect(found, id).toContain(id);
    }
    expect(found).toContain("tender-notes:Damp-proof course, 220 mm wide – deletio");
    expect(found).toContain("size-spec:Brick piers");
    expect(found).toContain("size-spec:Precast pier caps");
  });

  it("puts the step overlap with the missing work, not with the wording", () => {
    expect(reviewBill(gaps).find((f) => f.id === "step-overlap")!.severity).toBe("high");
  });

  it("is silent once Rev 4 measured the work", () => {
    const rev4: RubricItem[] = [
      ...gaps.filter((i) => !/steps|Brick piers|Brickforce|Damp-proof|pier caps|paint/.test(i.description)),
      { description: "Extra concrete in step overlaps, 1000 mm overlap", unit: "m3", quantity: 20.5 },
      { description: "660 x 880 mm brick piers", unit: "no", quantity: 166 },
      { description: "Brickforce every fourth course to panels and into piers", unit: "m", quantity: 4_400 },
      { description: "Damp-proof course, 220 mm wide, to engineer's note 4", unit: "m", quantity: 491 },
      { description: "Precast pier caps 760 x 980 mm", unit: "no", quantity: 166 },
      { description: "Clean down and point semi-face brickwork, both faces", unit: "m2", quantity: 2_943 },
      { description: "Concrete splash apron at stormwater outlets", unit: "no", quantity: 82 },
      { description: "Primer and two coats acrylic paint to copings and caps", unit: "m2", quantity: 220 },
    ];
    const found = ids(rev4);
    for (const id of ["step-overlap", "pier-brickforce", "cap-finish", "clean-down", "scour"]) {
      expect(found, id).not.toContain(id);
    }
    expect(found.filter((id) => id.startsWith("size-spec") || id.startsWith("tender-notes"))).toEqual([]);
    // The engineer's DPC is still a question in a free-standing wall – asked, never removed.
    expect(found).toContain("dpc-free-standing");
  });
});

describe("a free-standing wall and its damp course", () => {
  const wall = (dpc: boolean): RubricItem[] => [
    { description: "One-brick walling in superstructure", unit: "m2", quantity: 100 },
    ...(dpc ? [{ description: "Damp-proof course, 230 mm wide, polyethylene", unit: "m", quantity: 40 }] : []),
  ];

  it("does not ask for a DPC that SANS 10400-K says a free-standing wall goes without", () => {
    expect(ids(wall(false), { freeStanding: true })).not.toContain("dpc");
    expect(ids(wall(false))).toContain("dpc");
  });

  it("asks the engineer to confirm one that is measured", () => {
    expect(ids(wall(true), { freeStanding: true })).toContain("dpc-free-standing");
    expect(ids(wall(true))).not.toContain("dpc-free-standing");
  });

  it("reads a boundary wall as free-standing from the bill's own words", () => {
    const bill: RubricItem[] = [{ section: "Boundary wall", description: "One-brick walling in superstructure", unit: "m2", quantity: 100 }];
    expect(ids(bill)).not.toContain("dpc");
  });
});

describe("stepped footings", () => {
  const footing: RubricItem[] = [
    { description: "25 MPa concrete in strip footings", unit: "m3", quantity: 10 },
    { description: "50 mm blinding under footings", unit: "m3", quantity: 1 },
  ];

  it("does not say nothing is measured for the steps when the steps are measured", () => {
    const stepped = [...footing, { description: "Extra concrete at footing steps, overlap 1000 mm", unit: "m3", quantity: 3 }];
    expect(ids(stepped, { slopingGround: true })).not.toContain("steps");
    expect(ids(footing, { slopingGround: true })).toContain("steps");
  });
});

describe("the allowances over the bill", () => {
  it("will not have five per cent over a bill with open questions", () => {
    const bill = reviewBill(measured);
    const found = reviewAllowances({ preliminariesPct: 12, contingencyPct: 5, escalationPct: 0, billFindings: bill });
    expect(found.map((f) => f.id)).toEqual(["contingency", "escalation", "preliminaries"]);
    expect(found[0]!.finding).toMatch(/5% over a bill with \d+ open questions/);
    expect(found[0]!.action).toMatch(/10%/);
  });

  it("leaves a settled plan alone, apart from what a percentage cannot carry", () => {
    const found = reviewAllowances({ preliminariesPct: 0, contingencyPct: 10, escalationPct: 6, rateBaseDate: "2026-07-01" });
    expect(found).toEqual([]);
  });
});
