import { describe, expect, it } from "vitest";

import { BUILDING_RATE_CATEGORIES } from "./published-cost-data";
import { DEFAULT_BENCHMARK_CATEGORIES, readCategories } from "./benchmark-categories";

describe("benchmark categories", () => {
  it("defaults to categories the guide actually has – a typo would benchmark against nothing", () => {
    for (const c of DEFAULT_BENCHMARK_CATEGORIES) expect(BUILDING_RATE_CATEGORIES).toContain(c);
  });

  it("leaves out what the meeting said does not apply", () => {
    expect(DEFAULT_BENCHMARK_CATEGORIES).not.toContain("Airport infrastructure");
    expect(DEFAULT_BENCHMARK_CATEGORIES).not.toContain("Private dwelling houses");
  });

  it("reads a stored choice, keeping only categories that still exist", () => {
    expect(readCategories(JSON.stringify(["Offices", "Hotels", "Not a category", "Offices"]))).toEqual(["Offices", "Hotels"]);
  });

  it("falls back to the default for anything unreadable or empty", () => {
    expect(readCategories(null)).toBeNull();
    expect(readCategories("not json")).toBeNull();
    expect(readCategories("[]")).toBeNull();
    expect(readCategories(JSON.stringify(["Nothing real"]))).toBeNull();
    expect(readCategories(JSON.stringify({ Offices: true }))).toBeNull();
  });
});
