import { describe, expect, it } from "vitest";

import { classifyElement, elementalPlan, inSentence, type PlanRow } from "@/domain/elemental-plan";
import { money, percent, quantity } from "@/domain/money";

const R = (rand: number) => money(BigInt(Math.round(rand * 100)));
const row = (description: string, element: PlanRow["element"], rand: number | null, qty: number | null = null, unit: string | null = null): PlanRow => ({
  id: description,
  description,
  element,
  amount: rand === null ? null : R(rand),
  quantity: qty === null ? null : quantity(BigInt(Math.round(qty * 10_000))),
  unit,
});
const allowances = { preliminaries: percent(1200n), contingency: percent(500n), escalation: percent(0n), vat: percent(1500n) };

describe("which element a bill row belongs to", () => {
  it("reads the Marshall Dam wall's items as a QS would group them", () => {
    expect(classifyElement("Excavate trench for strip footing in firm soil")).toBe("substructure");
    expect(classifyElement("Concrete strip footing to engineer's details")).toBe("substructure");
    expect(classifyElement("Foundation walling in 14 MPa bricks, class II mortar, below ground")).toBe("substructure");
    expect(classifyElement("Damp-proof course minimum 150 mm above NGL")).toBe("substructure");
    expect(classifyElement("230 mm one-brick walling in 14 MPa bricks, in superstructure")).toBe("superstructure");
    expect(classifyElement("460 x 500 mm brick piers")).toBe("superstructure");
    expect(classifyElement("50 mm precast concrete coping to boundary wall")).toBe("superstructure");
    expect(classifyElement("Smooth cement plaster to both faces of walling")).toBe("finishes");
    expect(classifyElement("Exterior-grade acrylic paint to plastered piers")).toBe("finishes");
  });

  it("puts a provisional sum before the trade it names", () => {
    expect(classifyElement("Provisional sum for electrical reticulation")).toBe("provisional");
    expect(classifyElement("Electrical installation to units")).toBe("services");
  });

  it("falls back to the section heading, then to superstructure", () => {
    expect(classifyElement("Item as described", "Preliminaries")).toBe("preliminaries");
    expect(classifyElement("Item as described")).toBe("superstructure");
  });
});

describe("a description run into a sentence", () => {
  it("lowers only its first letter, and leaves an acronym alone", () => {
    expect(inSentence("Concrete strip footing, 15 MPa, class II")).toBe("concrete strip footing, 15 MPa, class II");
    expect(inSentence("DPC to walls")).toBe("DPC to walls");
  });
});

describe("the elemental cost plan", () => {
  const rows = [
    row("Excavation", "substructure", 37_608.65),
    row("Concrete", "substructure", 166_012.0),
    row("Walling", "superstructure", 701_812.8),
    row("Plaster", "finishes", 335_649.6),
    row("Not yet priced", "finishes", null),
  ];

  it("sums each element and says what share of the measured work it is", () => {
    const plan = elementalPlan(rows, allowances);
    expect(plan.net).toBe(R(1_241_083.05));
    expect(plan.elements.map((e) => [e.id, e.amount, e.items])).toEqual([
      ["substructure", R(203_620.65), 2],
      ["superstructure", R(701_812.8), 1],
      ["finishes", R(335_649.6), 2],
    ]);
    expect(plan.elements.reduce((s, e) => s + e.share, 0)).toBe(10_000);
    expect(plan.unpriced).toBe(1);
    expect(plan.elements.find((e) => e.id === "finishes")!.unpriced).toBe(1);
  });

  it("adds preliminaries, contingency, escalation and VAT in the order they compound", () => {
    const plan = elementalPlan(rows, allowances);
    // 12% of 1 241 083,05 = 148 929,966 → 148 929,97
    expect(plan.preliminaries).toBe(R(148_929.97));
    // 5% of 1 390 013,02 = 69 500,651 → 69 500,65
    expect(plan.contingency).toBe(R(69_500.65));
    expect(plan.escalation).toBe(R(0));
    expect(plan.excludingVat).toBe(R(1_459_513.67));
    // 15% of 1 459 513,67 = 218 927,0505 → 218 927,05
    expect(plan.vat).toBe(R(218_927.05));
    expect(plan.includingVat).toBe(R(1_678_440.72));
  });

  it("does not charge preliminaries on preliminaries the bill already measures", () => {
    const plan = elementalPlan([row("Walling", "superstructure", 100_000), row("Site establishment", "preliminaries", 10_000)], allowances);
    expect(plan.preliminaries).toBe(R(12_000));
  });

  it("gives each element a unit quantity from its principal item, and a unit rate over it", () => {
    const measured = [
      row("Excavation", "substructure", 37_608.65, 203.29, "m3"),
      row("Concrete strip footing", "substructure", 166_012.0, 67.76, "m3"),
      row("One-brick walling", "superstructure", 701_812.8, 1017.12, "m2"),
      row("Brick piers", "superstructure", 268_950.0, 163, "no"),
      row("Plaster", "finishes", 335_649.6, 2034.24, "m2"),
    ];
    const plan = elementalPlan(measured, allowances);
    const sub = plan.elements.find((e) => e.id === "substructure")!;
    expect(sub.quantity).toEqual({ value: quantity(677_600n), unit: "m3", basis: "Concrete strip footing", set: false });
    // 203 620,65 over 67,76 m³
    expect(sub.rate).toBe(R(3_005.03));
    const sup = plan.elements.find((e) => e.id === "superstructure")!;
    expect(sup.quantity!.basis).toBe("One-brick walling");
    // 970 762,80 over 1 017,12 m²
    expect(sup.rate).toBe(R(954.42));
  });

  it("takes an element quantity a QS set instead", () => {
    const measured = [row("Concrete strip footing", "substructure", 166_012.0, 67.76, "m3")];
    const set = new Map([["substructure" as const, { quantity: quantity(4_910_500n), unit: "m", label: "length of wall" }]]);
    const sub = elementalPlan(measured, allowances, null, set).elements[0]!;
    expect(sub.quantity).toEqual({ value: quantity(4_910_500n), unit: "m", basis: "length of wall", set: true });
    expect(sub.rate).toBe(R(338.08));
  });

  it("has no element quantity where nothing in it is measured and priced", () => {
    expect(elementalPlan([row("Allowance", "provisional", 50_000)], allowances).elements[0]!.quantity).toBeNull();
  });

  it("gives a cost per unit of the plan's measure – per metre of wall", () => {
    const plan = elementalPlan(rows, allowances, quantity(4_910_500n));
    // 1 459 513,67 over 491,05 m
    expect(plan.perMeasure!.excludingVat).toBe(R(2_972.23));
    expect(plan.elements[0]!.perMeasure).toBe(R(414.66));
  });
});
