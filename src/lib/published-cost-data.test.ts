import { describe, expect, it } from "vitest";

import {
  BUILDING_RATES,
  BUILDING_RATE_CATEGORIES,
  TENDER_ESCALATION,
  displayBand,
  displayChange,
  escalationFor,
  PUBLISHED_COST_DATE,
  PUBLISHED_COST_SOURCE,
} from "@/lib/published-cost-data";

describe("published building rates", () => {
  it("carries the guide's own figures, not a rounding of them", () => {
    // Spot values read off the 2025/26 tables. If a later edition is transcribed over this file,
    // these are what should change – and a test that fails is the point.
    const find = (item: string) => BUILDING_RATES.find((r) => r.item === item);
    expect(find("Low-rise office park development with standard specification")).toMatchObject({ category: "Offices", unit: "m²", low: 1_130_000, high: 1_390_000 });
    expect(find("Super regional centres, exceeding 100 000 m²")).toMatchObject({ low: 1_640_000, high: 2_120_000 });
    expect(find("Low-cost housing")).toMatchObject({ low: 430_000, high: 740_000 });
    expect(find("Budget")).toMatchObject({ unit: "key", low: 89_000_000, high: 140_000_000 });
    expect(find("District hospital")).toMatchObject({ unit: "m²", low: 3_900_000, high: 3_900_000 });
    expect(find("Stadium pitch to FIFA standards")).toMatchObject({ unit: "pitch", low: 3_200_000_000, high: 3_700_000_000 });
  });

  it("carries no RDP context – the guide's RDP rate is left out on purpose", () => {
    expect(BUILDING_RATES.filter((r) => /\bRDP\b|reconstruction and development/i.test(`${r.category} ${r.item} ${r.note ?? ""}`))).toEqual([]);
  });

  it("keeps a range a range, and a single figure single", () => {
    const office = BUILDING_RATES.find((r) => r.item === "Low-rise office park development with standard specification")!;
    const dwelling = BUILDING_RATES.find((r) => r.item === "Middle-class" && r.category === "Private dwelling houses")!;
    // The thousands separator is `formatMoney`'s own – a non-breaking space – so compare on the text.
    const plain = (t: string) => t.replace(/[\s  ]/g, " ");
    expect(plain(displayBand(office))).toBe("R 11 300,00 – R 13 900,00");
    expect(plain(displayBand(dwelling))).toBe("R 11 830,00");
    // No midpoints anywhere: nothing in here is a figure the guide did not print.
    for (const r of BUILDING_RATES) expect(r.low).toBeLessThanOrEqual(r.high);
  });

  it("is whole rands, attributed, and free of duplicates", () => {
    expect(PUBLISHED_COST_SOURCE).toMatch(/AECOM/);
    expect(PUBLISHED_COST_DATE).toBe("2025-07-01");
    const seen = new Set<string>();
    for (const r of BUILDING_RATES) {
      expect(r.low % 100, `${r.item} is not whole rands`).toBe(0);
      expect(r.low).toBeGreaterThan(0);
      expect(r.item.trim()).toBe(r.item);
      const key = `${r.category}|${r.item}`;
      expect(seen.has(key), `${key} appears twice`).toBe(false);
      seen.add(key);
    }
    expect(BUILDING_RATES.length).toBeGreaterThan(90);
    expect(BUILDING_RATE_CATEGORIES).toContain("Offices");
    expect(BUILDING_RATE_CATEGORIES.length).toBe(new Set(BUILDING_RATE_CATEGORIES).size);
  });
});

describe("tender price escalation", () => {
  it("carries BER and CPAP as the guide prints them, and says which years are a forecast", () => {
    expect(escalationFor(2025)).toMatchObject({ berIndex: 1_457, berChange: 660, cpapIndex: 1_378, cpapChange: 200, forecast: false });
    expect(escalationFor(2026)).toMatchObject({ berIndex: 1_509, berChange: 360, forecast: true });
    expect(escalationFor(2020)!.berChange).toBeNull();
    expect(escalationFor(2019)).toBeNull();
    expect(displayChange(660)).toBe("+6,60%");
    expect(displayChange(null)).toBe("–");
  });

  it("moves with its own indices – each change is the year before, within a tenth", () => {
    for (let i = 1; i < TENDER_ESCALATION.length; i++) {
      const now = TENDER_ESCALATION[i]!;
      const before = TENDER_ESCALATION[i - 1]!;
      const implied = Math.round(((now.berIndex - before.berIndex) / before.berIndex) * 10_000);
      // The guide rounds its own percentages, so a tenth of a percent of slack is the whole test.
      expect(Math.abs(implied - now.berChange!), `BER ${now.year}: ${implied} against ${now.berChange}`).toBeLessThanOrEqual(10);
      const impliedCpap = Math.round(((now.cpapIndex - before.cpapIndex) / before.cpapIndex) * 10_000);
      expect(Math.abs(impliedCpap - now.cpapChange!), `CPAP ${now.year}`).toBeLessThanOrEqual(10);
      // TMI is BER over CPAP, to the nearest thousandth.
      const impliedTmi = Math.round((now.berIndex / now.cpapIndex) * 1_000);
      expect(Math.abs(impliedTmi - now.tenderMarketIndicator), `TMI ${now.year}`).toBeLessThanOrEqual(10);
    }
  });
});
