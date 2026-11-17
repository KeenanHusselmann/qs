/**
 * Pricing — PLATFORM.md §4.8.
 *
 * Two things are worth testing here and they are different in kind.
 *
 * The **state** of a row is what the whole screen is arranged around: §4.8's priced / unpriced /
 * overridden, and the count of unpriced is the number a QS works down. Getting it wrong does not
 * produce a wrong figure, it produces a screen that says a bill is finished when it is not.
 *
 * The **draft reader** is the paranoid half. `readBuildUpDraft` runs twice per edit — once in the
 * editor and once on the server — and the only reason that is safe is that it is one function. So
 * what is asserted is the property that makes it safe: the same strings in, the same figures out,
 * and a figure that cannot be read with certainty stored as nothing and named.
 */

import { describe, expect, it } from "vitest";

import {
  EMPTY_DRAFT,
  computeBuildUp,
  draftOf,
  priceState,
  pricingTally,
  readBuildUpDraft,
  type BuildUp,
  type BuildUpDraft,
} from "./pricing";
import type { BillRow, WireRate } from "./agent/bill";
import { formatMoney, formatRate, money, rate } from "@/domain/money";

const nb = (s: string) => s.replace(/ /g, " ");

const wire = (value: string, precision = 2): WireRate => ({ value, precision });

/** A bill row as the database hands it over, with only what these tests care about spelled out. */
const row = (over: Partial<BillRow> & { id: string }): BillRow => ({
  seq: 100,
  parentId: null,
  rowType: "item",
  itemRef: null,
  proposed: {
    description: "An item",
    unit: "m3",
    quantity: "1.0000",
    rate: null,
    quantityText: null,
    rateText: null,
    confidence: 0,
    note: null,
  },
  citation: null,
  override: null,
  quantitySource: "ai_derived",
  rateSource: "ai_derived",
  amount: null,
  output: null,
  omitted: null,
  ...over,
});

const corrected = (over: Partial<BillRow["override"]>) => ({
  description: null,
  unit: null,
  quantity: null,
  rate: null,
  reason: null,
  by: "qs@example.com",
  at: "2026-08-18T00:00:00.000Z",
  ...over,
});

const identity = { id: "b", itemId: "i", by: "qs@example.com" };

const buildUp = (over: Partial<BuildUp> = {}): BuildUp => ({
  id: "b",
  itemId: "i",
  wasteRate: "0",
  markupRate: "0",
  plug: null,
  by: "qs@example.com",
  components: [],
  ...over,
});

describe("what state a row is in (§4.8)", () => {
  it("is unpriced with no rate at all — which is the normal case for a drafted bill", () => {
    expect(priceState(row({ id: "a" }))).toBe("unpriced");
  });

  it("is priced when the rate is the one the documents gave", () => {
    const proposed = { ...row({ id: "a" }).proposed, rate: wire("185000") };
    expect(priceState(row({ id: "a", proposed }))).toBe("priced");
  });

  it("is overridden when a person put the rate there", () => {
    expect(priceState(row({ id: "a", override: corrected({ rate: wire("185000") }) }))).toBe(
      "overridden",
    );
  });

  it("is overridden even where the agent had proposed one — human wins, and it shows", () => {
    const proposed = { ...row({ id: "a" }).proposed, rate: wire("100000") };
    expect(
      priceState(row({ id: "a", proposed, override: corrected({ rate: wire("185000") }) })),
    ).toBe("overridden");
  });

  it("is unpriced again when a correction is reverted and there was nothing underneath", () => {
    // An override row with every figure null is what `writeOverrides` leaves behind before it
    // clears the attribution; the state must not read as priced because somebody once touched it.
    expect(priceState(row({ id: "a", override: corrected({ unit: "m2" }) }))).toBe("unpriced");
  });
});

describe("the count a QS works down (§4.8)", () => {
  const proposed = (over: Partial<BillRow["proposed"]>) => ({
    ...row({ id: "x" }).proposed,
    ...over,
  });

  const rows: BillRow[] = [
    row({ id: "h", rowType: "heading" }),
    row({ id: "1", proposed: proposed({ rate: wire("185000") }), amount: "185000" }),
    row({ id: "2" }),
    row({ id: "3", override: corrected({ rate: wire("31250") }), amount: "31250" }),
    // Struck out: not in the bill, so not in any of these numbers.
    row({ id: "4", omitted: { by: "qs@example.com", at: "2026-08-18T00:00:00.000Z" } }),
  ];

  it("counts items only — a heading carries no rate and a struck row is not in the bill", () => {
    expect(pricingTally(rows).items).toBe(3);
  });

  it("splits them the three ways §4.8 asks for", () => {
    const tally = pricingTally(rows);
    expect(tally.priced).toBe(1);
    expect(tally.overridden).toBe(1);
    expect(tally.unpriced).toBe(1);
    expect(tally.priced + tally.overridden + tally.unpriced).toBe(tally.items);
  });

  it("totals already-rounded amounts and never re-rounds them (§5.2)", () => {
    expect(formatMoney(pricingTally(rows).total)).toBe(nb("2 162,50"));
  });

  it("an unpriced row contributes nothing to the total rather than nought", () => {
    // The distinction is invisible in the sum and visible in the count, which is why both are here.
    expect(pricingTally([row({ id: "1" })]).total).toBe(money(0n));
    expect(pricingTally([row({ id: "1" })]).unpriced).toBe(1);
  });
});

describe("reading a typed build-up (§4.8, §5)", () => {
  const draft = (over: Partial<BuildUpDraft> = {}): BuildUpDraft => ({
    ...EMPTY_DRAFT,
    components: [],
    ...over,
  });

  it("reads the concrete build-up to the rate a QS would write down", () => {
    const read = readBuildUpDraft(
      draft({
        waste: "5",
        markup: "12",
        components: [
          { kind: "material", description: "Cement", quantity: "0,35", rate: "2 400,00" },
          { kind: "material", description: "Sand", quantity: "0,7", rate: "180,00" },
          { kind: "labour", description: "Placing", quantity: "2,5", rate: "85,00" },
        ],
      }),
      identity,
    );

    expect(read.refusals).toEqual([]);
    expect(formatRate(rate(BigInt(computeBuildUp(read.buildUp).computed.value), 2))).toBe(
      nb("1 385,92"),
    );
  });

  it("stores an empty figure as nothing, and counts the component as incomplete", () => {
    const read = readBuildUpDraft(
      draft({
        components: [
          { kind: "material", description: "Cement", quantity: "0,35", rate: "2 400,00" },
          { kind: "plant", description: "Mixer", quantity: "", rate: "" },
        ],
      }),
      identity,
    );

    expect(read.refusals).toEqual([]);
    const worked = computeBuildUp(read.buildUp);
    expect(worked.incomplete).toBe(1);
    expect(formatMoney(money(BigInt(worked.net)))).toBe("840,00");
    // The incomplete line has no cost beside it — not a nought that would read as free.
    expect(worked.lines[1]).toBeNull();
  });

  it("refuses a figure it cannot read with certainty, by name, and stores nothing for it", () => {
    const read = readBuildUpDraft(
      draft({
        components: [{ kind: "material", description: "Brick", quantity: "1,234", rate: "1,85" }],
      }),
      identity,
    );

    expect(read.refusals).toHaveLength(1);
    expect(read.refusals[0].at).toBe("Component 1 quantity");
    expect(read.refusals[0].reason).toMatch(/factor of a thousand/i);
    expect(read.buildUp.components[0].quantity).toBeNull();
    expect(computeBuildUp(read.buildUp).incomplete).toBe(1);
  });

  it("refuses a waste or markup outside the band the database also enforces", () => {
    const read = readBuildUpDraft(draft({ waste: "-5", markup: "150" }), identity);
    expect(read.refusals.map((r) => r.at)).toEqual(["Waste", "Markup"]);
    // A refused percentage falls back to nought rather than to whatever was typed.
    expect(read.buildUp.wasteRate).toBe("0.0000");
    expect(read.buildUp.markupRate).toBe("0.0000");
  });

  it("carries the plug through as the figure that gets applied — §4.8's flagged override", () => {
    const read = readBuildUpDraft(
      draft({
        plug: "1 500,00",
        components: [{ kind: "material", description: "Cement", quantity: "1", rate: "100,00" }],
      }),
      identity,
    );

    const worked = computeBuildUp(read.buildUp);
    expect(worked.plugged).toBe(true);
    expect(formatRate(rate(BigInt(worked.computed.value), 2))).toBe("100,00");
    expect(formatRate(rate(BigInt(worked.applied.value), 2))).toBe(nb("1 500,00"));
  });

  it("round-trips a stored build-up back into the form it was typed into", () => {
    const stored = buildUp({
      wasteRate: "0.0500",
      markupRate: "0.1200",
      plug: wire("150000"),
      components: [
        { id: "c1", seq: 0, kind: "material", description: "Cement", quantity: "0.3500", rate: wire("240000") },
      ],
    });

    const there = draftOf(stored);
    expect(there.waste).toBe("5");
    expect(there.markup).toBe("12");
    expect(there.plug).toBe(nb("1 500,00"));
    expect(there.components[0].quantity).toBe("0,35");

    const back = readBuildUpDraft(there, identity);
    expect(back.refusals).toEqual([]);
    expect(back.buildUp.wasteRate).toBe(stored.wasteRate);
    expect(back.buildUp.markupRate).toBe(stored.markupRate);
    expect(back.buildUp.plug).toEqual(stored.plug);
    expect(back.buildUp.components[0].quantity).toBe(stored.components[0].quantity);
    expect(back.buildUp.components[0].rate).toEqual(stored.components[0].rate);
  });

  it("gives a build-up with no components back as nought, not as a rate of nothing to apply", () => {
    const worked = computeBuildUp(readBuildUpDraft(draft(), identity).buildUp);
    expect(worked.computed.value).toBe("0");
    expect(worked.plugged).toBe(false);
    expect(worked.incomplete).toBe(0);
  });
});
