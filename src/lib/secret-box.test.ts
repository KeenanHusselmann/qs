import { beforeAll, describe, expect, it } from "vitest";

import { open, seal } from "./secret-box";

beforeAll(() => {
  process.env.SESSION_SECRET ??= "a-test-session-secret-that-is-long-enough-123";
});

describe("secret box", () => {
  it("opens what it sealed", () => expect(open(seal("JBSWY3DPEHPK3PXP", "totp"), "totp")).toBe("JBSWY3DPEHPK3PXP"));
  it("never seals the same value the same way", () => expect(seal("x", "totp")).not.toBe(seal("x", "totp")));
  it("does not contain the plain text", () => expect(seal("JBSWY3DPEHPK3PXP", "totp")).not.toContain("JBSWY3DPEHPK3PXP"));
  it("refuses a tampered value rather than opening it wrong", () => {
    const sealed = seal("JBSWY3DPEHPK3PXP", "totp").split(".");
    sealed[3] = Buffer.from("tampered").toString("base64url");
    expect(() => open(sealed.join("."), "totp")).toThrow();
  });
  it("keys differ by purpose", () => expect(() => open(seal("x", "totp"), "other")).toThrow());
});
