/**
 * Reading a proposed method — PLATFORM.md §4.8, §5.4.
 *
 * The claim this feature makes is that **no figure in a built-up rate came from the model**. These
 * are the assertions that make the claim true rather than hopeful: a component carrying money is
 * dropped, a quantity that is not a number is dropped, and a kind the platform does not have is
 * dropped. Everything the reader is shown got past all three.
 */

import { describe, expect, it } from "vitest";

import { readMethod } from "./build-up-method";

const usage = { input: 400, output: 120 };
const read = (json: unknown) => readMethod(json, usage);

const brick = {
  kind: "material",
  description: "Stock bricks",
  unit: "no",
  quantity: "104",
};

describe("reading a proposed method", () => {
  it("takes the resources and their quantities per unit", () => {
    const method = read({
      components: [brick, { kind: "labour", description: "Bricklayer", unit: "hour", quantity: "1.1" }],
      wastePercent: 5,
      note: "Assumes stretcher bond in class II mortar.",
    });

    expect(method.components).toHaveLength(2);
    expect(method.components[0]).toEqual({
      kind: "material",
      description: "Stock bricks",
      unit: "no",
      quantity: "104",
    });
    expect(method.wastePercent).toBe(5);
    expect(method.note).toBe("Assumes stretcher bond in class II mortar.");
  });

  /** §7.7 — a South African writes 0,025 and means twenty-five thousandths. */
  it("reads a comma decimal", () => {
    const method = read({ components: [{ ...brick, quantity: "0,025", unit: "m3" }] });
    expect(method.components[0]?.quantity).toBe("0.025");
  });

  describe("the rule the whole feature rests on", () => {
    /**
     * The ASAQS failure, refused at the boundary. A model that answers with a price has produced a
     * number with nothing behind it, and showing it beside genuine quantities would launder it.
     */
    it("drops a component that states money in its description", () => {
      for (const description of [
        "Stock bricks at R 4,50 each",
        "Bricklayer (ZAR 320 per day)",
        "Cement — cost per bag",
        "Sand, price delivered",
      ]) {
        expect(read({ components: [{ ...brick, description }] }).components).toEqual([]);
      }
    });

    it("drops a note that slips a figure in", () => {
      expect(read({ components: [brick], note: "Bricks are about R4,50 each in Gauteng." }).note).toBeNull();
    });

    /** A quantity is the one number the model may give. It still has to be a number. */
    it("drops a quantity that is not one", () => {
      for (const quantity of ["about 104", "", "-3", "0", "104 bricks", "1e3"]) {
        expect(read({ components: [{ ...brick, quantity }] }).components).toEqual([]);
      }
    });

    it("drops a kind this platform does not have", () => {
      expect(read({ components: [{ ...brick, kind: "overheads" }] }).components).toEqual([]);
    });

    it("drops a component with no description or no unit", () => {
      expect(read({ components: [{ ...brick, description: "" }] }).components).toEqual([]);
      expect(read({ components: [{ ...brick, unit: "" }] }).components).toEqual([]);
    });
  });

  describe("waste", () => {
    /** A decimal in the wrong place fails nothing downstream — it silently inflates every rate. */
    it("refuses a waste allowance outside a believable band", () => {
      expect(read({ components: [brick], wastePercent: 500 }).wastePercent).toBe(0);
      expect(read({ components: [brick], wastePercent: -5 }).wastePercent).toBe(0);
    });

    it("takes a believable one", () => {
      expect(read({ components: [brick], wastePercent: 7.4 }).wastePercent).toBe(7);
    });

    it("is nought where none was given", () => {
      expect(read({ components: [brick] }).wastePercent).toBe(0);
    });
  });

  /**
   * An item too vague to decompose is a real answer, and the honest one. §1.3 — a gap is stated,
   * never filled with something plausible.
   */
  it("accepts an empty method with a reason", () => {
    const method = read({
      components: [],
      note: "A provisional sum is not measurable work and cannot be built up.",
    });

    expect(method.components).toEqual([]);
    expect(method.note).toContain("provisional sum");
  });

  it("survives a reply that is not the shape asked for", () => {
    expect(read(null).components).toEqual([]);
    expect(read({ components: "no" }).components).toEqual([]);
    expect(read({ components: [null, 3, "x"] }).components).toEqual([]);
  });
});
