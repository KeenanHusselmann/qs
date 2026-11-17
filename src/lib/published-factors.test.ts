/**
 * The platform's published factors.
 *
 * Two things are worth holding here, and neither is "the numbers are what the file says".
 *
 * **They must be derivable.** A published constant earns its place by being re-computable from a
 * stated geometry, and the derivation is re-done below from the brick dimensions rather than
 * copied. A figure that drifted from its own working would be exactly the plausible-looking
 * number this platform exists to refuse.
 *
 * **They must not creep.** The set is deliberately materials only, and deliberately short. The
 * assertions about what is *absent* are the ones that will fail first when somebody adds a
 * comfortable-looking labour constant, which is the moment to argue about it rather than after.
 */

import { describe, expect, it } from "vitest";

import { PUBLISHED_FACTORS, PUBLISHED_SOURCE } from "@/lib/published-factors";
import { factorsFor } from "@/lib/factors";

/**
 * The standard stock brick, in metres, with a 10 mm joint — the whole basis of the set.
 *
 * The width is not here because nothing published depends on it any more: it was the half-brick
 * wall thickness the withdrawn mortar figure was derived from.
 */
const L = 0.222;
const H = 0.073;
const J = 0.010;

const quantityOf = (work: string, resource: string) =>
  Number(PUBLISHED_FACTORS.find((f) => f.work === work && f.resource === resource)!.quantity);

describe("every published figure re-derives from the brick", () => {
  const faceWithJoints = (L + J) * (H + J);

  it("half-brick walling is one brick face per square metre", () => {
    // 1 ÷ (0,232 × 0,083) = 51,9
    expect(quantityOf("Half-brick wall in stock brick", "Stock brick")).toBeCloseTo(
      1 / faceWithJoints,
      1,
    );
  });

  it("one-brick walling is two", () => {
    expect(quantityOf("One-brick wall in stock brick", "Stock brick")).toBeCloseTo(
      2 / faceWithJoints,
      1,
    );
  });

  /*
    Mortar was derived — the wall volume less the bricks — and then withdrawn, so the assertion is
    that it is *absent*. It double-counted: the model decomposes mortar into cement and sand, a
    published "Mortar" line is the aggregate, neither overrides the other and the wall got its
    mortar twice. See the note in `published-factors.ts`.
  */
  it("publishes no mortar, because the model decomposes it and the two would both survive", () => {
    expect(PUBLISHED_FACTORS.some((f) => /mortar/i.test(f.resource))).toBe(false);
  });
});

describe("what the set deliberately does not contain", () => {
  /*
    The assertion that matters most in this file.

    Published South African output for a bricklayer is 350–500 bricks a day alone and 500–1 000
    with an assistant — 1,96 hours per m² of one-brick wall against 1,11, a factor of two, and both
    correct depending on the gang. A midpoint here would be invented precision wearing the
    platform's authority, which is worse than the model proposing one: the model's line at least
    says it is proposed.
  */
  it("has no labour or plant factor, because published output spans a factor of two", () => {
    expect(PUBLISHED_FACTORS.every((f) => f.kind === "material")).toBe(true);
  });

  it("states no waste allowance, because the geometry does not fix one", () => {
    // Cutting and breakage depend on the site and the plan. Null, so the method's own applies —
    // and null is not nought.
    expect(PUBLISHED_FACTORS.every((f) => f.wasteRate === null)).toBe(true);
  });

  it("claims no province, because geometry is not provincial", () => {
    expect(PUBLISHED_FACTORS.every((f) => f.region === null)).toBe(true);
  });

  it("attributes every row to the derivation a reader can check", () => {
    expect(PUBLISHED_FACTORS.every((f) => f.source === PUBLISHED_SOURCE)).toBe(true);
    expect(PUBLISHED_SOURCE).toMatch(/222/);
  });
});

describe("they reach a take-off through the same lookup a filed factor does", () => {
  it("matches work described in the reader's own words", () => {
    const found = factorsFor("one-brick wall in stock brick", "m2", PUBLISHED_FACTORS, {
      asAt: "2026-06-01",
    });
    expect(found.map((f) => f.resource)).toEqual(["Stock brick"]);
  });

  it("and does not answer for a wall of another thickness", () => {
    // `specificationHolds` gates on the numbers in the description, so "220mm" cannot be answered
    // by a set that says nothing about 220.
    expect(
      factorsFor("Brick wall 220mm thick", "m2", PUBLISHED_FACTORS, { asAt: "2026-06-01" }),
    ).toEqual([]);
  });

  it("is visible as at any ordinary date, rather than silently future-dated", () => {
    // `factorsFor` filters on `effectiveDate <= asAt`; a row dated ahead of today would be
    // invisible and the whole set would look like it was not wired up.
    const today = new Date().toISOString().slice(0, 10);
    expect(PUBLISHED_FACTORS.every((f) => f.effectiveDate <= today)).toBe(true);
  });
});
