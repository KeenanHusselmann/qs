import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionToken, operatorLoginEnabled, readSessionToken, verifyCredentials } from "./session";

const SID = "0b5f3f0e-6a52-4c1f-9d55-2f7c2b8f6a10";

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters");
  vi.stubEnv("DEV_USER_EMAIL", "operator@example.com");
  vi.stubEnv("DEV_USER_PASSWORD", "operator-password");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("session token", () => {
  it("carries the session id through a round trip", () => {
    const session = readSessionToken(createSessionToken("qs@example.com", SID));
    expect(session).toMatchObject({ email: "qs@example.com", sid: SID });
  });

  it("refuses a correctly signed cookie from before server-side sessions, which has no row to revoke", () => {
    // Exactly what the old code issued: a valid signature over a payload with no sid.
    const now = Date.now();
    const payload = Buffer.from(
      JSON.stringify({ email: "qs@example.com", issued: now, expires: now + 86_400_000 }),
    ).toString("base64url");
    const signature = createHmac("sha256", process.env.SESSION_SECRET!).update(payload).digest("base64url");
    expect(readSessionToken(`${payload}.${signature}`)).toBeNull();
  });

  it("refuses a tampered token", () => {
    const token = createSessionToken("qs@example.com", SID);
    expect(readSessionToken(`${token.slice(0, -4)}AAAA`)).toBeNull();
  });

  it("refuses an expired token", () => {
    vi.useFakeTimers();
    try {
      const token = createSessionToken("qs@example.com", SID);
      vi.advanceTimersByTime(31 * 86_400_000);
      expect(readSessionToken(token)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("operator login", () => {
  it("is on in development, where it is how anybody signs in", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(operatorLoginEnabled()).toBe(true);
    expect(verifyCredentials("Operator@Example.com ", "operator-password")).toBe(true);
  });

  it("is off in a production build unless the deployment opts in", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(operatorLoginEnabled()).toBe(false);
    expect(verifyCredentials("operator@example.com", "operator-password")).toBe(false);
  });

  it("is the break-glass when OPERATOR_LOGIN=1 is set", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OPERATOR_LOGIN", "1");
    expect(verifyCredentials("operator@example.com", "operator-password")).toBe(true);
    expect(verifyCredentials("operator@example.com", "wrong")).toBe(false);
  });
});
