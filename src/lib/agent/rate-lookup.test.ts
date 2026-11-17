import { describe, expect, it } from "vitest";

import { rateLookup, readRateQuestion } from "./rate-lookup";
import type { LibraryRate } from "@/lib/rates";

const row = (description: string, rate: bigint, unit: string, region: string | null = null, trade = "Masonry"): LibraryRate => ({
  id: description + (region ?? ""),
  trade,
  description,
  unit,
  rate,
  ratePrecision: 2,
  region,
  source: "Simulated test data",
  effectiveDate: "2026-09-01",
  createdBy: "qs@example.com",
});

const library = [
  row("Clay stock brick, 222 × 106 × 73 mm", 320n, "no"),
  row("Clay face brick, standard", 780n, "no"),
  row("Clay stock brick, 222 × 106 × 73 mm", 360n, "no", "Western Cape"),
  row("Cement, 42,5N, 50 kg bag", 11800n, "bag", null, "Materials"),
  row("Bricklayer", 9500n, "hour", null, "Labour"),
];

describe("reading a price question", () => {
  it("reads the tester's question and its plainer forms", () => {
    expect(readRateQuestion("bricks cost zar")).toEqual(["brick"]);
    expect(readRateQuestion("What is the price of cement?")).toEqual(["cement"]);
    expect(readRateQuestion("how much does a face brick cost")).toEqual(["face", "brick"]);
  });

  it("leaves a take-off, and a question with no price word, to their own channels", () => {
    expect(readRateQuestion("How many bricks do I need for 240 m² of one-brick wall?")).toBeNull();
    expect(readRateQuestion("What is a bill of quantities?")).toBeNull();
  });
});

describe("looking the rates up", () => {
  it("answers what bricks cost with bricks, not with a brick pier or a cement plaster", () => {
    const more = [...library, row("Brick pier", 165000n, "no"), row("Cement plaster to walling", 16500n, "m2", null, "Finishes")];
    const bricks = rateLookup(["brick"], more);
    expect(bricks.findings.map((f) => f.label)).not.toContain("Brick pier");
    expect(bricks.findings.some((f) => f.label.startsWith("Clay stock brick"))).toBe(true);
    const cement = rateLookup(["cement"], more);
    expect(cement.findings.map((f) => f.label)).toEqual(["Cement, 42,5N, 50 kg bag"]);
  });

  it("lists every matching brick, the national rate before a province's, each with its source and date", () => {
    const out = rateLookup(["brick"], library);
    expect(out.findings.map((f) => f.label)).toEqual(["Clay face brick, standard", "Clay stock brick, 222 × 106 × 73 mm", "Clay stock brick, 222 × 106 × 73 mm"]);
    // Money carries a non-breaking space (§7.7); fold it to compare.
    expect(out.findings[1]?.value.replace(/ /g, " ")).toBe("R 3,20/no");
    expect(out.findings[1]?.from).toBe("Simulated test data · national · from 2026-09-01");
    expect(out.findings[2]?.from).toContain("Western Cape");
  });

  it("keeps the project's province and the national rates, and drops other provinces", () => {
    expect(rateLookup(["brick"], library, { region: "Gauteng" }).findings).toHaveLength(2);
  });

  it("ranks the rows matching more of the words first, and shows only those", () => {
    expect(rateLookup(["face", "brick"], library).findings.map((f) => f.label)).toEqual(["Clay face brick, standard"]);
  });

  it("says where to add a rate when nothing matches, rather than naming a price", () => {
    const out = rateLookup(["granite"], library);
    expect(out.findings).toEqual([]);
    expect(out.unavailable).toMatch(/no rate matching/);
  });
});
