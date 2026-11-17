import { describe, expect, it } from "vitest";

import { canOpen, isLate, openingRegister, unacknowledged, type Receipt } from "./tender-room";

const closing = "2026-05-14T12:00:00+02:00";

describe("the closing time", () => {
  it("decides lateness to the minute", () => {
    expect(isLate("2026-05-14T11:59:00+02:00", closing)).toBe(false);
    expect(isLate("2026-05-14T12:00:00+02:00", closing)).toBe(false);
    expect(isLate("2026-05-14T12:01:00+02:00", closing)).toBe(true);
    expect(isLate(null, closing)).toBe(false);
  });

  it("allows opening only at or after it, and only once", () => {
    expect(canOpen(closing, null, new Date("2026-05-14T09:00:00Z"))).toMatchObject({ ok: false });
    expect(canOpen(closing, null, new Date("2026-05-14T10:00:00Z"))).toEqual({ ok: true });
    expect(canOpen(closing, "2026-05-14T10:05:00Z", new Date("2026-05-15T10:00:00Z"))).toMatchObject({ ok: false, reason: expect.stringMatching(/opened already/) });
  });
});

describe("the opening register", () => {
  const r = (company: string, receivedAt: string | null, sum: bigint | null, acknowledged: number[] = [1, 2], declined = false): Receipt => ({
    inviteeId: company,
    company,
    receivedAt,
    sum,
    declined,
    acknowledged,
  });

  const register = openingRegister(
    [
      r("Umhlanga Builders", "2026-05-14T11:40:00+02:00", 47_120_000_000n),
      r("Ridgeview Builders", "2026-05-14T10:15:00+02:00", 46_744_000_000n, [1]),
      r("Late & Co", "2026-05-14T12:20:00+02:00", 40_000_000_000n),
      r("Quiet Construction", null, null),
      r("Busy Contractors", null, null, [], true),
      r("No Figure Ltd", "2026-05-13T16:00:00+02:00", null),
    ],
    closing,
    [1, 2],
  );

  it("opens the on-time sums lowest first", () => {
    expect(register.opened.map((o) => [o.rank, o.company])).toEqual([
      [1, "Ridgeview Builders"],
      [2, "Umhlanga Builders"],
    ]);
  });

  it("flags a return from a tenderer who has not acknowledged every addendum", () => {
    expect(register.opened[0]?.missingAddenda).toEqual([2]);
    expect(register.opened[1]?.missingAddenda).toEqual([]);
  });

  it("keeps a late tender out of the opening however low it is", () => {
    expect(register.late.map((x) => x.company)).toEqual(["Late & Co"]);
    expect(register.opened.some((o) => o.company === "Late & Co")).toBe(false);
  });

  it("records the declined, the silent and the return with no sum apart", () => {
    expect(register.declined.map((x) => x.company)).toEqual(["Busy Contractors"]);
    expect(register.noReturn.map((x) => x.company)).toEqual(["Quiet Construction"]);
    expect(register.noSum.map((x) => x.company)).toEqual(["No Figure Ltd"]);
  });

  it("lists the addenda a tenderer is missing", () => {
    expect(unacknowledged([1, 2, 3], [2])).toEqual([1, 3]);
  });
});
