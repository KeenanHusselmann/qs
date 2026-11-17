import { describe, expect, it } from "vitest";

import { claimTotals, penaltyExposure, revisedCompletion } from "./claims";
import { money } from "./money";

describe("the completion date, moved by awards", () => {
  it("adds each award's calendar days in the order the awards were made", () => {
    const out = revisedCompletion("2027-04-30", [
      { claimNumber: 2, daysAwarded: 10, amountAwarded: null, awardedOn: "2026-12-01" },
      { claimNumber: 1, daysAwarded: 14, amountAwarded: null, awardedOn: "2026-11-01" },
      { claimNumber: 3, daysAwarded: 0, amountAwarded: money(5000n), awardedOn: "2026-12-15" },
    ]);
    expect(out.completion).toBe("2027-05-24");
    expect(out.daysAwarded).toBe(24);
    expect(out.steps.map((s) => [s.claimNumber, s.completion])).toEqual([
      [1, "2027-05-14"],
      [2, "2027-05-24"],
    ]);
  });

  it("counts the days but names no date where the contract has none", () => {
    const out = revisedCompletion(null, [{ claimNumber: 1, daysAwarded: 7, amountAwarded: null, awardedOn: "2026-11-01" }]);
    expect(out.completion).toBeNull();
    expect(out.daysAwarded).toBe(7);
  });
});

describe("penalty exposure", () => {
  it("is days late at the daily penalty, and nought when on time", () => {
    expect(penaltyExposure("2027-05-24", "2027-06-03", money(4_200_000n))).toEqual({ daysLate: 10, exposure: 42_000_000n });
    expect(penaltyExposure("2027-05-24", "2027-05-01", money(4_200_000n))).toEqual({ daysLate: 0, exposure: 0n });
  });

  it("names the days but no figure where the contract states no penalty", () => {
    expect(penaltyExposure("2027-05-24", "2027-06-03", null)).toEqual({ daysLate: 10, exposure: null });
  });
});

describe("what a register reports", () => {
  it("sums claimed against awarded, leaving withdrawn claims out and counting the open ones", () => {
    const totals = claimTotals([
      { status: "awarded", daysClaimed: 21, amountClaimed: money(100n), daysAwarded: 14, amountAwarded: money(60n) },
      { status: "lodged", daysClaimed: 10, amountClaimed: null, daysAwarded: null, amountAwarded: null },
      { status: "rejected", daysClaimed: 5, amountClaimed: money(40n), daysAwarded: 0, amountAwarded: money(0n) },
      { status: "withdrawn", daysClaimed: 99, amountClaimed: money(999n), daysAwarded: null, amountAwarded: null },
    ]);
    expect(totals).toEqual({ open: 1, daysClaimed: 36, amountClaimed: 140n, daysAwarded: 14, amountAwarded: 60n });
  });
});
