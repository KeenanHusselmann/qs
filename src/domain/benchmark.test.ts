import { describe, expect, it } from "vitest";

import { BASE_YEAR, bandsFor, compare, escalationFactor } from "@/domain/benchmark";
import { BUILDING_RATES } from "@/lib/published-cost-data";

/** The guide's low-rise office park, in cents: R11 300 to R13 900 per m². */
const OFFICE = { low: 1_130_000, high: 1_390_000 };
const R = (rands: number) => rands * 100;

describe("a figure against a published band", () => {
  it("sits within the band it is inside", () => {
    const c = compare(R(12_000), OFFICE, BASE_YEAR);
    expect(c.standing).toBe("within");
    expect(c.outside).toBe(0);
    expect(c.share).toBeNull();
  });

  it("is below, measured from the bottom edge and not from a midpoint", () => {
    const c = compare(R(10_000), OFFICE, BASE_YEAR);
    expect(c.standing).toBe("below");
    // R11 300 − R10 000. A midpoint comparison would have said R2 600, which nobody published.
    expect(c.outside).toBe(R(1_300));
    expect(c.share).toBe(Math.round((1_300 / 11_300) * 10_000));
  });

  it("is above, measured from the top edge", () => {
    const c = compare(R(15_000), OFFICE, BASE_YEAR);
    expect(c.standing).toBe("above");
    expect(c.outside).toBe(R(1_100));
  });

  it("sits within at either edge exactly", () => {
    expect(compare(OFFICE.low, OFFICE, BASE_YEAR).standing).toBe("within");
    expect(compare(OFFICE.high, OFFICE, BASE_YEAR).standing).toBe("within");
  });
});

describe("a rate is a fact about a date", () => {
  it("leaves the band as printed in the guide's own year", () => {
    const { factor, forecast } = escalationFactor(BASE_YEAR);
    expect(factor).toBe(1_000);
    expect(forecast).toBe(false);
    const c = compare(R(12_000), OFFICE, BASE_YEAR);
    expect(c.low).toBe(OFFICE.low);
    expect(c.high).toBe(OFFICE.high);
  });

  it("escalates the band forward, so a later estimate is not judged against older money", () => {
    const c = compare(R(12_000), OFFICE, 2028);
    expect(c.low).toBeGreaterThan(OFFICE.low);
    expect(c.high).toBeGreaterThan(OFFICE.high);
    expect(c.escalatedTo).toBe(2028);
  });

  it("and says when that escalation rests on a forecast", () => {
    // The guide marks 2026 onwards as forecast. A comparison that hid it would read as settled.
    expect(compare(R(12_000), OFFICE, 2028).forecast).toBe(true);
    expect(compare(R(12_000), OFFICE, 2024).forecast).toBe(false);
  });

  it("a figure inside the band today can be below it once the band escalates", () => {
    // The point of carrying the date at all.
    // R13 500 is inside the guide's 2025 band (R11 300 - R13 900). By 2029 the BER index has
    // carried that band to R13 707 - R16 861, and the same figure is under it.
    const rate = R(13_500);
    expect(compare(rate, OFFICE, BASE_YEAR).standing).toBe("within");
    expect(compare(rate, OFFICE, 2029).standing).toBe("below");
  });

  it("a year the index says nothing about leaves the band alone rather than guessing", () => {
    expect(escalationFactor(1999).factor).toBe(1_000);
    expect(escalationFactor(2099).factor).toBe(1_000);
  });
});

describe("which bands are offered", () => {
  const perM2 = BUILDING_RATES.filter((r) => r.unit === "m²");

  it("offers only bands in the same unit", () => {
    const offered = bandsFor(R(12_000), BUILDING_RATES, BASE_YEAR, "m²");
    expect(offered.length).toBe(perM2.length);
    expect(offered.every((o) => o.rate.unit === "m²")).toBe(true);
  });

  it("puts the bands that contain the figure first", () => {
    const offered = bandsFor(R(12_000), BUILDING_RATES, BASE_YEAR, "m²");
    const firstOutside = offered.findIndex((o) => o.comparison.standing !== "within");
    const lastWithin = offered.map((o) => o.comparison.standing).lastIndexOf("within");
    if (firstOutside !== -1 && lastWithin !== -1) expect(lastWithin).toBeLessThan(firstOutside);
  });

  it("names every band rather than picking one", () => {
    // Guessing which building type a scheme is would be the platform having an opinion about the
    // design - and wrong exactly where it matters, since an estate is several of these at once.
    const offered = bandsFor(R(12_000), BUILDING_RATES, BASE_YEAR, "m²");
    expect(new Set(offered.map((o) => o.rate.category)).size).toBeGreaterThan(1);
  });

  it("orders what is outside by how far outside it is", () => {
    const outside = bandsFor(R(12_000), BUILDING_RATES, BASE_YEAR, "m²")
      .filter((o) => o.comparison.standing !== "within")
      .map((o) => o.comparison.outside);
    expect([...outside].sort((a, b) => a - b)).toEqual(outside);
  });
});
