/**
 * The rubric is one copy, and these are the tests that keep it one.
 *
 * Two ways a rubric rots, both silent:
 *
 *  - A check is added to `bill-rubric.ts` and the rubric page never hears about it, so the
 *    practice reads a standard that is narrower than the one being enforced.
 *  - A rule is written on the page that nothing enforces and nothing sends, so the practice reads
 *    a standard that is wider than the one being followed. That is the worse of the two: it is a
 *    document everyone believes in and nothing obeys.
 *
 * So the ids are checked in both directions, and the agent's prompt is checked to still carry the
 * rubric's exact words.
 */

import { describe, expect, it } from "vitest";

import { reviewAllowances, reviewBill, type Finding, type RubricItem } from "@/domain/bill-rubric";
import { allRules, FINDING_IDS, MEASURED_BILL, prose, RUBRICS } from "@/domain/rubric";
import { SYSTEM_FOR_TEST } from "@/lib/agent/measure-drawings";

/** The bill that prompted the rubric: enough of it to make every check fire at once. */
const item = (description: string, unit: string, quantity: number | null = 1, assumed = false): RubricItem => ({
  description,
  unit,
  quantity,
  assumed,
});

/* Every branch of `reviewBill`, driven from inputs rather than asserted from a list, so a new
   check appears here the moment it can fire. */
function everyFindingId(): Set<string> {
  const emitted = new Set<string>();
  const collect = (findings: readonly Finding[]) => findings.forEach((f) => emitted.add(f.id.split(":")[0]));

  // A bill with the companions missing: blinding, reinforcement, pier footings, lintels, DPC,
  // joints, brickforce, clearance, trench conditions, cart-away, steps, and an assumed figure.
  collect(
    reviewBill(
      [
        item("Strip footing concrete", "m3", 12),
        item("Brick piers", "no", 170),
        item("Openings through walling", "no", 82),
        item("One-brick walling in stock brick", "m2", 400),
        item("Excavate trench for strip footing", "m3", 20, true),
        item("Cement plaster to walling", "m2", 800),
        item("Two coats paint to plaster", "m2", 800),
      ],
      { slopingGround: true },
    ),
  );

  // The ones that only fire when the companion IS measured: the brickforce course rule, the DPC
  // measured in metres only, the unbulked cart-away, and the descriptions that say too little.
  collect(
    reviewBill([
      item("Strip footing concrete", "m3", 12),
      item("50 mm blinding under footings", "m3", 1),
      item("Y12 reinforcement to footings", "kg", 8140),
      item("Pier footing bases", "no", 170),
      item("Brick piers", "no", 170),
      item("Lintels over openings", "no", 82),
      item("One-brick walling in stock brick", "m2", 400),
      item("Brickforce to walling", "m", 830),
      item("Damp-proof course to walling", "m", 5894),
      item("Coping to walling", "m", 5894),
      item("Movement joints in walling", "m", 300),
      item("Cement plaster to walling", "m2", 800),
      item("Primer and two coats paint", "m2", 800),
      item("Site clearance over working width", "m2", 5000),
      item("Planking and strutting to trenches", "m2", 100),
      item("Excavate trench for strip footing", "m3", 245),
      item("Backfill to trenches with selected material", "m3", 132),
      item("Cart away surplus excavated material", "m3", 113),
      item("Foundation walling below ground", "m2", 200),
    ]),
  );

  // The boundary wall's second review: a free-standing wall in semi-face brick, stepped, with
  // stormwater openings, a DPC, unpainted caps and a query left in a description.
  collect(
    reviewBill([
      item("25 MPa concrete in strip footings to boundary wall", "m3", 187),
      item("Extra concrete in footing steps", "m3", 6),
      item("Brick piers", "no", 166),
      item("Semi-face brickwork, fair-faced both sides", "m2", 1400),
      item("Damp-proof course, 220 mm wide (Q13)", "m", 380),
      item("300 x 200 mm stormwater openings", "no", 82),
    ]),
  );
  collect(reviewAllowances({ preliminariesPct: 12, contingencyPct: 5, escalationPct: 0, billFindings: [{ id: "blinding", severity: "high", finding: "", matters: "", action: "" }] }));
  return emitted;
}

describe("the rubric and the checks are one list", () => {
  it("every finding the platform can raise has a rule in the rubric", () => {
    const declared = new Set<string>(allRules().flatMap((r) => r.ids ?? []));
    const emitted = everyFindingId();
    expect([...emitted].filter((id) => !declared.has(id)).sort()).toEqual([]);
  });

  it("every rule that claims a check names one the platform actually raises", () => {
    const emitted = everyFindingId();
    const claimed = allRules().flatMap((r) => r.ids ?? []);
    expect(claimed.filter((id) => !emitted.has(id)).sort()).toEqual([]);
  });

  it("FINDING_IDS is the same list, so the compiler catches a typo before a test does", () => {
    expect([...everyFindingId()].sort()).toEqual([...FINDING_IDS].sort());
  });
});

describe("the agent is given the rubric's own words", () => {
  it("the measuring prompt carries every rule of the three sections it is built from", () => {
    for (const section of MEASURED_BILL.sections.slice(0, 3)) {
      expect(SYSTEM_FOR_TEST).toContain(prose(section));
    }
  });

  it("no rule is sent with its reasoning attached", () => {
    // `because` is for the reader. A model given reasons argues with them.
    for (const rule of allRules()) {
      if (rule.because) expect(SYSTEM_FOR_TEST).not.toContain(rule.because);
    }
  });
});

describe("the rubric is readable as a document", () => {
  it("every output names where it is produced and where its rules came from", () => {
    for (const rubric of RUBRICS) {
      expect(rubric.source.length).toBeGreaterThan(40);
      expect(rubric.module.startsWith("/")).toBe(true);
      expect(rubric.sections.length).toBeGreaterThan(0);
    }
  });

  it("no two outputs share a slug, because the page routes on it", () => {
    expect(new Set(RUBRICS.map((r) => r.slug)).size).toBe(RUBRICS.length);
  });
});
