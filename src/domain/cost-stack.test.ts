import { describe, expect, it } from "vitest";

import { costStack, PROFESSIONAL_FEE_SCHEDULE, type CostStackInputs } from "./cost-stack";
import { money, type Money } from "./money";

const R = (rand: number): Money => money(BigInt(Math.round(rand * 100)));
const asRand = (amount: Money | null) => (amount === null ? null : Number(amount) / 100);

/** Ridgeview, as the platform has it signed. */
const RIDGEVIEW: CostStackInputs = {
  construction: R(466_600_000),
  constructionCarriesContingency: true,
  landValue: null,
  vatVendor: false,
  bulkContribution: R(42_300_000),
  units: 1_046,
  averageHomeValue: R(737_558),
  statedFeePercent: null,
};

describe("the fee schedule", () => {
  it("is v3's, and totals 10,15% — inside the 10–12% norm", () => {
    const total = PROFESSIONAL_FEE_SCHEDULE.reduce((sum, f) => sum + f.percent, 0);
    expect(total).toBeCloseTo(10.15, 10);
  });

  it("has a line for every discipline rather than one lump", () => {
    // A single "consultants 10%" line cannot be argued with. Thirteen can.
    expect(PROFESSIONAL_FEE_SCHEDULE).toHaveLength(13);
  });
});

describe("Ridgeview's build-up", () => {
  const stack = costStack(RIDGEVIEW);

  it("takes the construction cost as signed, not derived", () => {
    const build = stack.lines.find((l) => l.code === "B4");
    expect(build?.provenance).toBe("signed");
    expect(asRand(build!.amount)).toBe(466_600_000);
  });

  it("carries the bulk contribution separately, because the cost plan excludes it", () => {
    expect(asRand(stack.bulk)).toBe(42_300_000);
  });

  it("charges fees on construction plus bulk", () => {
    // 10,15% of R508 900 000.
    expect(asRand(stack.professionalFees)).toBeCloseTo(51_653_350, 0);
  });

  it("reports the fee percentage against the norm", () => {
    // Against construction alone, so it reads slightly above the schedule's 10,15%.
    expect(stack.feePercent).toBeCloseTo(11.07, 1);
    expect(stack.feesAboveNorm).toBe(false);
  });

  it("enrols every home with the NHBRC, at the scheme's own home value", () => {
    const nhbrc = stack.lines.find((l) => l.code === "B6.1");
    // R10 216,04 per home × 1 046.
    expect(asRand(nhbrc!.amount)).toBeCloseTo(10_685_977.84, 2);
    expect(nhbrc?.basis).toContain("1046 homes");
  });

  it("totals to construction + bulk + fees + statutory", () => {
    const expected =
      Number(stack.construction) +
      Number(stack.bulk) +
      Number(stack.professionalFees) +
      Number(stack.statutory);

    expect(Number(stack.totalDevelopmentCost)).toBe(expected);
  });

  it("is a bigint, never a float", () => {
    expect(typeof stack.totalDevelopmentCost).toBe("bigint");
  });
});

describe("counting the contingency once", () => {
  it("says so when the signed cost plan already carries it", () => {
    // Double-counting a contingency inflates a development cost by the one line nobody checks,
    // because everybody assumes it was included.
    const stack = costStack(RIDGEVIEW);
    expect(stack.notes.join(" ")).toMatch(/inside the signed construction cost and are not added again/);
  });

  it("does not invent one when the cost plan carries none", () => {
    const stack = costStack({ ...RIDGEVIEW, constructionCarriesContingency: false });
    expect(stack.notes.join(" ")).toMatch(/does not carry contingency/);
    expect(stack.notes.join(" ")).toMatch(/is not one this build-up should invent/);
  });

  it("does not change the total either way — B7 is never added here", () => {
    const withIt = costStack(RIDGEVIEW);
    const without = costStack({ ...RIDGEVIEW, constructionCarriesContingency: false });
    expect(without.totalDevelopmentCost).toBe(withIt.totalDevelopmentCost);
  });
});

describe("land", () => {
  it("is absent, and said to be, when nothing has been signed", () => {
    const stack = costStack(RIDGEVIEW);
    expect(stack.land).toBe(0n);
    expect(stack.notes.join(" ")).toMatch(/No land value has been signed/);
    expect(stack.lines.some((l) => l.code.startsWith("B1"))).toBe(false);
  });

  it("brings its transfer duty with it", () => {
    const stack = costStack({ ...RIDGEVIEW, landValue: R(12_000_000) });
    expect(asRand(stack.land)).toBe(12_000_000 + 1_113_236);

    const duty = stack.lines.find((l) => l.code === "B1.2");
    expect(duty?.basis).toMatch(/SARS transfer duty/);
    expect(duty?.provenance).toBe("derived");
  });

  it("charges a VAT vendor no duty, and says why", () => {
    const stack = costStack({ ...RIDGEVIEW, landValue: R(12_000_000), vatVendor: true });
    expect(asRand(stack.land)).toBe(12_000_000);
    expect(stack.lines.find((l) => l.code === "B1.2")?.basis).toMatch(/VAT-input recoverable/);
  });
});

describe("what it refuses to build", () => {
  it("returns no total at all when construction is unsigned", () => {
    // A build-up whose largest line is missing is not a smaller build-up; it is not a build-up.
    const stack = costStack({ ...RIDGEVIEW, construction: null });
    expect(stack.totalDevelopmentCost).toBeNull();
    expect(stack.notes.join(" ")).toMatch(/no development cost can be built up/);
  });

  it("says the NHBRC line needs a unit count and a home value", () => {
    const stack = costStack({ ...RIDGEVIEW, units: null });
    expect(stack.lines.some((l) => l.code === "B6.1")).toBe(false);
    expect(stack.notes.join(" ")).toMatch(/needs a signed unit count/);
  });
});

describe("provenance, which is the point of the module", () => {
  const stack = costStack({ ...RIDGEVIEW, landValue: R(12_000_000) });

  it("marks a signed figure as signed", () => {
    expect(stack.lines.find((l) => l.code === "B4")?.provenance).toBe("signed");
    expect(stack.lines.find((l) => l.code === "B1.1")?.provenance).toBe("signed");
  });

  it("marks a figure computed from a table as derived", () => {
    expect(stack.lines.find((l) => l.code === "B1.2")?.provenance).toBe("derived");
    expect(stack.lines.find((l) => l.code === "B6.1")?.provenance).toBe("derived");
  });

  it("marks a benchmark percentage as an assumption, not a figure", () => {
    // A development cost is a signed construction cost plus professional assumptions. Presenting
    // the assumptions as signed figures is the whole failure this platform exists to prevent.
    expect(stack.lines.find((l) => l.code === "B5.1")?.provenance).toBe("assumption");
    expect(stack.lines.find((l) => l.code === "B6.2")?.provenance).toBe("assumption");
  });

  it("gives every line a basis a reader can check", () => {
    for (const line of stack.lines) expect(line.basis.length).toBeGreaterThan(4);
  });

  it("uses the QS's own fee percentage where one was stated, as derived not assumed", () => {
    const stated = costStack({ ...RIDGEVIEW, statedFeePercent: 8.5 });
    const fee = stated.lines.find((l) => l.code === "B5.1");

    expect(fee?.provenance).toBe("derived");
    expect(fee?.basis).toMatch(/as stated by the QS/);
    expect(stated.professionalFees).toBeLessThan(costStack(RIDGEVIEW).professionalFees);
  });
});
