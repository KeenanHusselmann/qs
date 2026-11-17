/**
 * Password storage — §13.1.
 *
 * The properties worth asserting about a password hash are the ones whose absence is invisible: a
 * hash that never verifies fails loudly on the first sign-in, but a hash that verifies *the wrong
 * password*, or that is the same for two people with the same password, fails silently for as long
 * as nobody looks.
 */

import { describe, expect, it } from "vitest";

import { hashPassword, MIN_PASSWORD, refuse, verifyPassword } from "@/lib/users";

const PASSWORD = "correct horse battery staple";

describe("hashing a password", () => {
  it("verifies the password it was made from", async () => {
    expect(await verifyPassword(PASSWORD, await hashPassword(PASSWORD))).toBe(true);
  });

  it("refuses a different one", async () => {
    expect(await verifyPassword("something else entirely", await hashPassword(PASSWORD))).toBe(false);
  });

  it("refuses one that is merely close", async () => {
    const stored = await hashPassword(PASSWORD);
    expect(await verifyPassword(PASSWORD + " ", stored)).toBe(false);
    expect(await verifyPassword(PASSWORD.slice(0, -1), stored)).toBe(false);
    expect(await verifyPassword(PASSWORD.toUpperCase(), stored)).toBe(false);
  });

  it("never stores the password itself", async () => {
    const stored = await hashPassword(PASSWORD);
    expect(stored).not.toContain(PASSWORD);
    expect(stored).not.toContain("correct");
  });

  /**
   * Per-row salt. Without it, two people who chose the same password have the same hash — which
   * tells anybody reading the table that they did, and lets one rainbow table cover both.
   */
  it("gives two people with the same password different hashes", async () => {
    expect(await hashPassword(PASSWORD)).not.toBe(await hashPassword(PASSWORD));
  });

  it("carries its own parameters, so the cost can be raised later", async () => {
    const [scheme, n, r, p] = (await hashPassword(PASSWORD)).split("$");
    expect(scheme).toBe("scrypt");
    expect(Number(n)).toBeGreaterThanOrEqual(16384);
    expect(Number(r)).toBeGreaterThan(0);
    expect(Number(p)).toBeGreaterThan(0);
  });

  /**
   * A hash somebody edited by hand should fail to authenticate, not crash the login route for
   * everybody else — which is what an exception in a server action would do.
   */
  it("treats a malformed hash as a failure rather than throwing", async () => {
    for (const bad of ["", "not-a-hash", "scrypt$$$$", "bcrypt$1$2$3$4$5", "scrypt$x$8$1$aa$bb"]) {
      await expect(verifyPassword(PASSWORD, bad)).resolves.toBe(false);
    }
  });
});

describe("which passwords are allowed", () => {
  it("accepts a long passphrase", () => {
    expect(refuse(PASSWORD)).toBeNull();
  });

  it("refuses one shorter than the minimum", () => {
    expect(refuse("x".repeat(MIN_PASSWORD - 1))).toMatch(/at least/);
  });

  it("accepts one exactly at the minimum", () => {
    expect(refuse("x".repeat(MIN_PASSWORD))).toBeNull();
  });

  /**
   * No character-class rule, on purpose. "Password1!" satisfies every such rule ever written and is
   * among the first guesses; a long phrase fails them and is stronger. The rule would teach the
   * wrong habit while measuring the wrong thing.
   */
  it("does not demand a symbol, a digit or a capital", () => {
    expect(refuse("aaaaaaaaaaaaaaaaaaaa")).toBeNull();
  });
});
