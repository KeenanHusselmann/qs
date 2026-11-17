/**
 * The gate in front of the take-off.
 *
 * A take-off is arithmetic presented as fact — an order figure a QS may act on. So a half-filled
 * request must produce nothing at all rather than a confident answer over a quantity nobody stated.
 * These are the cases where "plausible" would be worse than "I could not work that out".
 *
 * The arithmetic itself is held in `domain/take-off.test.ts` against hand-worked examples; this is
 * only about what is allowed to reach it.
 */

import { describe, expect, it } from "vitest";

import { readTakeOffQuestion, readTakeOffRequest, takeOffFrom } from "@/lib/agent/resource-take-off";
import type { LibraryRate } from "@/lib/rates";
import type { ResourceFactor } from "@/lib/factors";

describe("a take-off request the platform will act on", () => {
  it("reads a complete one", () => {
    expect(
      readTakeOffRequest({ work: "One-brick wall in stock brick", unit: "m2", quantity: "240" }),
    ).toEqual({ work: "One-brick wall in stock brick", unit: "m2", quantity: "240" });
  });

  it("takes a decimal, and a comma as the decimal mark", () => {
    // A South African writes 12,5 and the arithmetic downstream parses a full stop.
    expect(readTakeOffRequest({ work: "Concrete", unit: "m3", quantity: "12,5" })?.quantity).toBe(
      "12.5",
    );
    expect(readTakeOffRequest({ work: "Concrete", unit: "m3", quantity: "12.5" })?.quantity).toBe(
      "12.5",
    );
  });

  it("and a figure written with a thousands separator", () => {
    expect(readTakeOffRequest({ work: "Wall", unit: "m2", quantity: "1 234" })?.quantity).toBe(
      "1234",
    );
  });

  it("trims the words without emptying them", () => {
    expect(readTakeOffRequest({ work: "  Wall  ", unit: " m2 ", quantity: "10" })).toEqual({
      work: "Wall",
      unit: "m2",
      quantity: "10",
    });
  });
});

describe("what it refuses, and why refusing beats guessing", () => {
  it("refuses a request with no quantity", () => {
    // The alternative is an order for some number of bricks the reader never asked about.
    expect(readTakeOffRequest({ work: "Wall", unit: "m2" })).toBeNull();
    expect(readTakeOffRequest({ work: "Wall", unit: "m2", quantity: "" })).toBeNull();
  });

  it("refuses a quantity that is not a figure", () => {
    for (const quantity of ["some", "a few", "240 m2", "1e6", "NaN", "twelve"]) {
      expect(readTakeOffRequest({ work: "Wall", unit: "m2", quantity })).toBeNull();
    }
  });

  it("refuses a negative one, because there is no minus twelve square metres of wall", () => {
    // It would come back as negative orders, which read like a credit note.
    expect(readTakeOffRequest({ work: "Wall", unit: "m2", quantity: "-12" })).toBeNull();
  });

  it("refuses work or a unit it was not given", () => {
    expect(readTakeOffRequest({ unit: "m2", quantity: "240" })).toBeNull();
    expect(readTakeOffRequest({ work: "Wall", quantity: "240" })).toBeNull();
    expect(readTakeOffRequest({ work: "   ", unit: "m2", quantity: "240" })).toBeNull();
  });

  it("refuses anything that is not a request at all", () => {
    for (const raw of [null, undefined, "take off some bricks", 240, [], true]) {
      expect(readTakeOffRequest(raw)).toBeNull();
    }
  });

  it("caps a unit rather than carrying a sentence into a column heading", () => {
    const long = readTakeOffRequest({
      work: "Wall",
      unit: "square metres of walling measured net",
      quantity: "1",
    });
    expect(long?.unit.length).toBeLessThanOrEqual(20);
  });
});

describe("the working the reader is shown", () => {
  const method = {
    wastePercent: 5,
    components: [
      { kind: "material" as const, description: "Stock brick", unit: "no", quantity: "104" },
      { kind: "material" as const, description: "Mortar", unit: "m3", quantity: "0.045" },
      { kind: "labour" as const, description: "Bricklayer", unit: "hour", quantity: "1.2" },
    ],
  };

  const rate = (over: Partial<LibraryRate> & Pick<LibraryRate, "description" | "unit" | "rate">): LibraryRate => ({
    id: over.description,
    trade: null,
    ratePrecision: 2,
    region: null,
    source: "Supplier quote",
    effectiveDate: "2026-01-01",
    createdBy: "qs@mzilikazi.co.za",
    ...over,
  });

  const library: LibraryRate[] = [
    rate({ description: "Stock brick", unit: "no", rate: 18500n, ratePrecision: 4 }),
    rate({ description: "Bricklayer", unit: "hour", rate: 8500n, source: "Labour rates 2026" }),
  ];

  const request = { work: "One-brick wall in stock brick", unit: "m2", quantity: "240" };
  const flat = (s: string) => s.replace(/\s/gu, " ");

  it("leads with the figure somebody acts on", () => {
    const result = takeOffFrom(method, request, library);
    // 104 × 240 = 24 960, +5% = 26 208 — and bricks are bought whole.
    expect(flat(result.findings[0]!.value)).toBe("26 208 no");
  });

  it("shows the whole working beside every figure, so none of them is an assertion", () => {
    const result = takeOffFrom(method, request, library);
    const brick = flat(result.findings[0]!.from);

    // The factor, the quantity, the allowance, the money, and where the rate came from.
    expect(brick).toContain("104/m² × 240 m²");
    expect(brick).toContain("+5% waste");
    // The rate with its R and its unit, and what it comes to — never the total alone.
    expect(brick).toContain("R 1,85/no = R 48 484,80");
    expect(brick).toContain("Supplier quote");
    expect(brick).toContain("2026-01-01");
  });

  it("says plainly where the library prices nothing, instead of leaving a blank", () => {
    const result = takeOffFrom(method, request, library);
    expect(result.findings[1]!.from).toContain("no rate in the library prices this");
  });

  it("marks a total partial when it is, and names how much of it is missing", () => {
    const result = takeOffFrom(method, request, library);
    const total = result.findings.at(-1)!;

    expect(total.label).toBe("Estimated cost, partial");
    // 48 484,80 + 24 480,00 — the mortar contributes nothing rather than a nought.
    expect(flat(total.value)).toBe("R 72 964,80");
    expect(total.from).toContain("1 of 3 resources have no rate");
  });

  it("and offers no total at all when nothing could be priced", () => {
    const result = takeOffFrom(method, request, []);
    /*
      A cost line reading R 0,00 would be a figure, and a wrong one. Three unpriced resources is
      not a job that costs nothing — §1.3, the gap is stated by its absence being explained on
      every line rather than by a nought standing in for it.
    */
    expect(result.findings.some((f) => f.label.startsWith("Estimated cost"))).toBe(false);
    expect(result.findings).toHaveLength(3);
  });

  it("names the work and the quantity in the title, so the answer says what it answered", () => {
    expect(flat(takeOffFrom(method, request, library).title)).toBe(
      "One-brick wall in stock brick — 240,00 m²",
    );
  });
});

describe("the practice's factors against the model's method", () => {
  const method = {
    wastePercent: 5,
    components: [
      { kind: "material" as const, description: "Stock brick", unit: "no", quantity: "104" },
      { kind: "labour" as const, description: "Bricklayer", unit: "hour", quantity: "1.2" },
    ],
  };

  const row = (over: Partial<ResourceFactor> = {}): ResourceFactor => ({
    id: crypto.randomUUID(),
    work: "One-brick wall in stock brick",
    workUnit: "m2",
    kind: "labour",
    resource: "Bricklayer",
    resourceUnit: "hour",
    quantity: "1.4500",
    wasteRate: null,
    region: null,
    source: "Our own output records",
    effectiveDate: "2026-01-01",
    ...over,
  });

  /** Every row in this suite is one the practice filed; the published origin has its own suite. */
  const mine = (over: Partial<ResourceFactor> = {}) => ({
    row: row(over),
    origin: "practice" as const,
  });

  const request = { work: "One-brick wall in stock brick", unit: "m2", quantity: "240" };
  const flat = (s: string) => s.replace(/\s/gu, " ");
  const find = (r: ReturnType<typeof takeOffFrom>, label: string) =>
    r.findings.find((f) => f.label === label)!;

  it("overrides the method's figure with the practice's own", () => {
    const result = takeOffFrom(method, request, [], {}, [mine()]);
    // 1,45 × 240 = 348, not the model's 1,2 × 240 = 288.
    expect(flat(find(result, "Bricklayer").value)).toBe("348,00 hour");
  });

  /*
    The bug this suite exists for.

    Held factors replaced the method wholesale at first, so a practice that had recorded only its
    labour — the figures worth recording, since those are the unstable ones — got a take-off of a
    bricklayer and no bricks. It looked complete. Not recording a material factor is the *normal*
    case, because geometry fixes it and the model gets it right.
  */
  it("keeps every resource the method proposed that the practice has not recorded", () => {
    const result = takeOffFrom(method, request, [], {}, [mine()]);
    expect(result.findings.map((f) => f.label)).toContain("Stock brick");
    expect(flat(find(result, "Stock brick").value)).toBe("26 208 no");
  });

  it("adds a resource the practice holds that the method never proposed", () => {
    // The firm has written it down, so the firm knows about it; the model forgetting is not a
    // reason to leave it out of what somebody orders.
    const result = takeOffFrom(method, request, [], {}, [
      mine({ kind: "plant", resource: "Concrete mixer", resourceUnit: "hour", quantity: "0.0800" }),
    ]);
    expect(flat(find(result, "Concrete mixer").value)).toBe("19,20 hour");
    expect(result.findings.map((f) => f.label)).toContain("Stock brick");
  });

  it("says on every line which of the two it used", () => {
    const result = takeOffFrom(method, request, [], {}, [mine()]);
    expect(find(result, "Bricklayer").from).toContain("the practice's factor");
    expect(find(result, "Bricklayer").from).toContain("Our own output records");
    // Unmarked would read as authoritative by default, which is the opposite of the truth.
    expect(find(result, "Stock brick").from).toContain("proposed, not the practice's own");
  });

  it("applies the factor's own waste allowance rather than the method's", () => {
    const result = takeOffFrom(method, request, [], {}, [
      mine({ kind: "material", resource: "Stock brick", resourceUnit: "no", quantity: "104.0000", wasteRate: "0.1000" }),
    ]);
    // 104 × 240 × 1,10 = 27 456, not the method's 5% giving 26 208.
    expect(flat(find(result, "Stock brick").value)).toBe("27 456 no");
    expect(find(result, "Stock brick").from).toContain("+10% waste");
  });

  it("and falls back to the method's where the factor states none", () => {
    const result = takeOffFrom(method, request, [], {}, [
      mine({ kind: "material", resource: "Stock brick", resourceUnit: "no", quantity: "104.0000", wasteRate: null }),
    ]);
    expect(flat(find(result, "Stock brick").value)).toBe("26 208 no");
    expect(find(result, "Stock brick").from).toContain("+5% waste");
  });

  it("does not match a resource held in a different unit", () => {
    // "Cement" in kilograms and in pockets are two inputs, and one must not silently answer for
    // the other. Both survive, neither overrides.
    const result = takeOffFrom(method, request, [], {}, [
      mine({ kind: "material", resource: "Stock brick", resourceUnit: "pallet", quantity: "0.2000" }),
    ]);
    const bricks = result.findings.filter((f) => f.label === "Stock brick");
    expect(bricks).toHaveLength(2);
  });
});

describe("three origins, in order of authority", () => {
  const method = {
    wastePercent: 5,
    components: [
      { kind: "material" as const, description: "Stock brick", unit: "no", quantity: "104" },
      { kind: "labour" as const, description: "Bricklayer", unit: "hour", quantity: "1.2" },
    ],
  };
  const request = { work: "One-brick wall in stock brick", unit: "m2", quantity: "240" };
  const find = (r: ReturnType<typeof takeOffFrom>, label: string) =>
    r.findings.find((f) => f.label === label)!;

  const published = {
    row: {
      id: "published:x",
      work: "One-brick wall in stock brick",
      workUnit: "m2",
      kind: "material" as const,
      resource: "Stock brick",
      resourceUnit: "no",
      quantity: "103.9000",
      wasteRate: null,
      region: null,
      source: "Derived from standard stock brick",
      effectiveDate: "2026-01-01",
    },
    origin: "published" as const,
  };

  const filed = {
    ...published,
    row: { ...published.row, quantity: "110.0000", source: "Our own site records" },
    origin: "practice" as const,
  };

  it("labels a published factor as the platform's, and says how to displace it", () => {
    const from = find(takeOffFrom(method, request, [], {}, [published]), "Stock brick").from;
    expect(from).toContain("published");
    expect(from).toContain("Derived from standard stock brick");
    // §7.7 — the line says what to do next, not merely what it is.
    expect(from).toContain("file your own to override it");
  });

  it("still marks the model's own proposals as proposals beside it", () => {
    // Bricklayer is in neither the practice's set nor the published one.
    expect(find(takeOffFrom(method, request, [], {}, [published]), "Bricklayer").from).toContain(
      "proposed, not the practice's own",
    );
  });

  it("prefers the practice's figure over the published one", () => {
    /*
      The precedence that makes the published set safe to ship. A firm that has measured its own
      brick usage must never see the platform's derivation in place of it — the published figure is
      a floor under a new practice, not a ceiling over an experienced one.
    */
    const result = takeOffFrom(method, request, [], {}, [filed]);
    expect(find(result, "Stock brick").from).toContain("the practice's factor");
    expect(find(result, "Stock brick").from).toContain("Our own site records");
    expect(find(result, "Stock brick").from).not.toContain("published");
  });
});

describe("a take-off read from the question itself", () => {
  /**
   * Round-2 testing, N10: the suggested brick question was answered as general guidance because the
   * model did not ask for the take-off. The question's shape is fixed enough to read without it.
   */
  it("reads the suggested brick question", () => {
    expect(readTakeOffQuestion("How many bricks do I need for 240 m² of one-brick wall in stock brick?")).toEqual({
      work: "One-brick wall in stock brick",
      unit: "m2",
      quantity: "240",
    });
  });

  it("reads the other shapes the prompt gives as examples", () => {
    expect(readTakeOffQuestion("how much cement in 18 m3 of 25 MPa concrete")).toEqual({
      work: "25 MPa concrete",
      unit: "m3",
      quantity: "18",
    });
    expect(readTakeOffQuestion("litres of paint for 96 m2 of plastered wall, two coats")).toBeNull();
    expect(readTakeOffQuestion("how many litres of paint for 96 m2 of plastered wall, two coats")).toEqual({
      work: "Plastered wall, two coats",
      unit: "m2",
      quantity: "96",
    });
  });

  it("reads a grouped figure and a decimal one the way the bill does", () => {
    expect(readTakeOffQuestion("how many bricks for 1 250 m² of wall")?.quantity).toBe("1250");
    // A wall is measured to the whole square metre, so the comma can only be grouping.
    expect(readTakeOffQuestion("how many bricks for 1,250 m² of wall")?.quantity).toBe("1250");
    expect(readTakeOffQuestion("how much concrete for 12,5 m3 of strip footing")?.quantity).toBe("12.5");
  });

  it("does not read a rate question or one with no quantity", () => {
    expect(readTakeOffQuestion("How much does a brick cost per m²?")).toBeNull();
    expect(readTakeOffQuestion("How many bricks do I need for a one-brick wall?")).toBeNull();
  });
});
