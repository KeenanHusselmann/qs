import { describe, expect, it } from "vitest";

import { complianceFlag, complianceSummary, DEFAULT_REQUIREMENTS } from "./compliance";

describe("the seeded register", () => {
  it("carries the South African list, each with its instrument, with unique keys", () => {
    expect(DEFAULT_REQUIREMENTS.length).toBeGreaterThanOrEqual(10);
    expect(new Set(DEFAULT_REQUIREMENTS.map((r) => r.key)).size).toBe(DEFAULT_REQUIREMENTS.length);
    expect(DEFAULT_REQUIREMENTS.every((r) => r.source.length > 0)).toBe(true);
    expect(DEFAULT_REQUIREMENTS.some((r) => r.key === "occupation-certificate" && r.source.includes("s. 14"))).toBe(true);
  });
});

describe("what needs attention", () => {
  const today = "2026-10-15";

  it("flags a requirement past the date it was needed by", () => {
    expect(complianceFlag({ status: "submitted", neededBy: "2026-10-01", expiresOn: null }, today)).toEqual({ kind: "overdue", days: 14 });
    expect(complianceFlag({ status: "required", neededBy: "2026-11-01", expiresOn: null }, today)).toBeNull();
  });

  it("flags an approval that has lapsed or is about to", () => {
    expect(complianceFlag({ status: "approved", neededBy: null, expiresOn: "2026-10-10" }, today)).toEqual({ kind: "expired", days: 5 });
    expect(complianceFlag({ status: "approved", neededBy: null, expiresOn: "2026-11-01" }, today)).toEqual({ kind: "expiring", days: 17 });
    expect(complianceFlag({ status: "approved", neededBy: "2026-01-01", expiresOn: null }, today)).toBeNull();
  });

  it("never flags what does not apply", () => {
    expect(complianceFlag({ status: "not_applicable", neededBy: "2026-01-01", expiresOn: null }, today)).toBeNull();
  });

  it("summarises applicable items only, an expired approval counting as not done", () => {
    expect(
      complianceSummary(
        [
          { status: "approved", neededBy: null, expiresOn: null },
          { status: "approved", neededBy: null, expiresOn: "2026-10-01" },
          { status: "required", neededBy: "2026-09-01", expiresOn: null },
          { status: "not_applicable", neededBy: null, expiresOn: null },
        ],
        today,
      ),
    ).toEqual({ applicable: 3, approved: 1, open: 1, attention: 2 });
  });
});
