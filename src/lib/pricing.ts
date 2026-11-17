/**
 * Pricing — PLATFORM.md §4.8, over the rows §4.7 produced.
 *
 * ── Pricing is a lens on the bill, not a step of its own ───────────────────────────────────
 *
 * There is no `runs` row here, no field set, no signature. The rows are `run_items`; the signature
 * is the bill's; the freeze that already governs them governs this. A second run for pricing would
 * be a second approved answer to "what does this item cost", with nothing downstream able to say
 * which of the two a total was summed from — and the bill's own gate already refuses a signature
 * while any item has no rate, so a bill that is signed is a bill that is priced.
 *
 * ── Then why is it a screen at all, and not just the bill grid? ────────────────────────────
 *
 * Because §4.8 asks for two things the bill grid cannot carry without becoming something else: a
 * **rate build-up behind a row**, and **bulk application** — "nobody prices 4,000 items one at a
 * time". Both are about the rate column and nothing else, and putting a selection model, a bulk bar
 * and a component editor onto the most important screen in the app (§4.7) would crowd out the thing
 * that screen is for, which is reading the bill.
 *
 * §2.5 says one path per task, and that is honoured where it matters: **there is one write path.**
 * A single rate corrected here goes through `correctCell` in `bill-actions.ts`, the same server
 * action the grid calls, so the two screens cannot come to disagree about what a correction is.
 *
 * ── What is here, and what is in the database ──────────────────────────────────────────────
 *
 * This file is the contract — the wire types both sides need, and the derivations that must give
 * one answer wherever they are asked. Money crosses as **strings** of minor units for the reason
 * `bill.ts` records: a `bigint` cannot be serialised into a client component, and a `number` is how
 * a costing system starts quietly disagreeing with itself.
 */

import { workingRow, type BillRow, type WireRate } from "@/lib/agent/bill";
import { readPercent, readQuantity, readRate } from "@/domain/amount";
import {
  buildUpRate,
  money,
  parsePercent,
  parseQuantity,
  percent,
  percentToNumeric,
  formatPercent,
  formatQuantity,
  formatRate,
  quantityToNumeric,
  rate,
  sum,
  type Money,
} from "@/domain/money";

/** §4.8's five kinds of component. The domain's own list; nothing here invents a sixth. */
export const COMPONENT_KINDS = ["labour", "material", "plant", "subcontract", "other"] as const;

export type ComponentKind = (typeof COMPONENT_KINDS)[number];

export const COMPONENT_KIND_LABEL: Readonly<Record<ComponentKind, string>> = {
  labour: "Labour",
  material: "Material",
  plant: "Plant",
  subcontract: "Subcontract",
  other: "Other",
};

/**
 * One line of a build-up, as it crosses to the client.
 *
 * The quantity is per **one unit of the bill item** — 0,35 t of cement in a cubic metre of concrete,
 * not in the whole substructure. That is the whole reason the sum is a rate and not an amount, and
 * it is the one thing about this table a reader can get wrong.
 */
export interface BuildUpComponent {
  id: string;
  seq: number;
  kind: ComponentKind;
  description: string | null;
  /** `numeric(18,4)` as a string — "0.3500". Never a `number`. */
  quantity: string | null;
  rate: WireRate | null;
}

export interface BuildUp {
  id: string;
  itemId: string;
  /** `numeric(6,4)` as the decimal fraction — "0.0500" is 5%. */
  wasteRate: string;
  markupRate: string;
  /** §4.8's plug: the QS's standing statement that they are not using the computed rate. */
  plug: WireRate | null;
  by: string;
  components: BuildUpComponent[];
}

/** The build-up worked out — the column a QS would write on paper, not just its answer. */
export interface ComputedBuildUp {
  /** Each component's cost per unit, in minor units. Null where the component is incomplete. */
  lines: (string | null)[];
  net: string;
  waste: string;
  markup: string;
  /** What the components come to. */
  computed: WireRate;
  /**
   * Components missing a quantity or a rate. They contribute **nothing** — not nought — and are
   * counted out loud, because a rate quietly short by one line is the confident wrong number §5
   * exists to prevent.
   */
  incomplete: number;
  /** What is actually applied to the bill row: the plug where there is one, else the computed rate. */
  applied: WireRate;
  plugged: boolean;
}

const asWireRate = (unitRate: { value: bigint; precision: number }): WireRate => ({
  value: unitRate.value.toString(),
  precision: unitRate.precision,
});

/**
 * Work out a build-up — the one statement of it, read by the editor and by the writer that applies
 * the result to the row.
 *
 * The arithmetic itself is `buildUpRate()` in `money.ts`, which is where §5.2's standing for a
 * third rounding site is argued. What is here is the boundary: turning the wire's strings into
 * money types, and deciding what an incomplete component means (nothing, and said so).
 */
export function computeBuildUp(buildUp: BuildUp): ComputedBuildUp {
  const usable = buildUp.components.filter(
    (component) => component.quantity !== null && component.rate !== null,
  );

  const worked = buildUpRate(
    usable.map((component) => ({
      quantity: parseQuantity(component.quantity!),
      rate: rate(BigInt(component.rate!.value), component.rate!.precision),
    })),
    parsePercent(buildUp.wasteRate),
    parsePercent(buildUp.markupRate),
  );

  // Back onto every component in order, so a screen can put a figure beside the line it belongs to
  // and a blank beside the line that has none.
  const costs = new Map(usable.map((component, index) => [component.id, worked.lines[index]]));

  return {
    lines: buildUp.components.map((component) => costs.get(component.id)?.toString() ?? null),
    net: worked.net.toString(),
    waste: worked.waste.toString(),
    markup: worked.markup.toString(),
    computed: asWireRate(worked.rate),
    incomplete: buildUp.components.length - usable.length,
    applied: buildUp.plug ?? asWireRate(worked.rate),
    plugged: buildUp.plug !== null,
  };
}

/** One component as the editor holds it — every figure exactly as somebody typed it. */
export interface ComponentDraft {
  kind: ComponentKind;
  description: string;
  quantity: string;
  rate: string;
}

/** A build-up as the editor holds it. Nothing here has been read as a number yet. */
export interface BuildUpDraft {
  waste: string;
  markup: string;
  /** §4.8's plug. Empty means the build-up's own answer stands. */
  plug: string;
  components: ComponentDraft[];
}

export const EMPTY_COMPONENT: ComponentDraft = {
  kind: "material",
  description: "",
  quantity: "",
  rate: "",
};

export const EMPTY_DRAFT: BuildUpDraft = {
  waste: "",
  markup: "",
  plug: "",
  components: [EMPTY_COMPONENT],
};

/** A draft read into figures, with every cell that could not be read named. */
export interface ReadDraft {
  /** What would be stored. A refused or empty figure is null, exactly as the column holds it. */
  buildUp: BuildUp;
  refusals: { at: string; reason: string }[];
}

/**
 * Read a typed build-up — the **one** place a draft becomes figures.
 *
 * Called twice per edit, deliberately: by the editor, so a QS sees the rate the moment they finish
 * typing rather than after a round trip, and by the server, which is the copy that decides. Both
 * run this, so the number on the screen and the number written to the row cannot differ — which is
 * the property that matters, and the reason this is here rather than in either of them.
 *
 * ── An empty figure and an unreadable one are different, and both store null ───────────────
 *
 * A QS types a description, then a quantity, then a rate. Refusing the component until all three
 * are there would make it impossible to type at all. So **empty** is simply incomplete: the
 * component contributes nothing, and `computeBuildUp` counts it out loud. **Unreadable** — `1,234`,
 * a rate with a qualifier on it — is also stored as null, and is additionally named in `refusals`,
 * because that one is a figure a person has to settle rather than one they have not reached yet.
 */
export function readBuildUpDraft(
  draft: BuildUpDraft,
  identity: { id: string; itemId: string; by: string },
): ReadDraft {
  const refusals: { at: string; reason: string }[] = [];

  // The bands are the database's own — `rate_build_ups_percentages_sane` — so the two statements of
  // what is acceptable cannot disagree.
  const waste = readPercent(draft.waste.trim() === "" ? "0" : draft.waste, { min: 0, max: 100 });
  if (!waste.ok) refusals.push({ at: "Waste", reason: waste.reason });

  const markup = readPercent(draft.markup.trim() === "" ? "0" : draft.markup, { min: 0, max: 100 });
  if (!markup.ok) refusals.push({ at: "Markup", reason: markup.reason });

  const plug = draft.plug.trim() === "" ? null : readRate(draft.plug);
  if (plug && !plug.ok) refusals.push({ at: "Plug", reason: plug.reason });

  const components = draft.components.map((component, index) => {
    const at = `Component ${index + 1}`;

    const quantity = component.quantity.trim() === "" ? null : readQuantity(component.quantity);
    if (quantity && !quantity.ok) refusals.push({ at: `${at} quantity`, reason: quantity.reason });

    const unitRate = component.rate.trim() === "" ? null : readRate(component.rate);
    if (unitRate && !unitRate.ok) refusals.push({ at: `${at} rate`, reason: unitRate.reason });

    return {
      // Positional, because a draft's components have no identity until they are stored — they are
      // replaced wholesale on every save (a build-up is five rows retyped in place, not a list).
      id: `${index}`,
      seq: index,
      kind: COMPONENT_KINDS.includes(component.kind) ? component.kind : ("other" as const),
      description: component.description.trim() || null,
      quantity: quantity?.ok ? quantityToNumeric(quantity.quantity) : null,
      rate:
        unitRate?.ok
          ? { value: unitRate.rate.value.toString(), precision: unitRate.rate.precision }
          : null,
    };
  });

  return {
    buildUp: {
      id: identity.id,
      itemId: identity.itemId,
      // A refused percentage falls back to nought in the column's own form, never to the text that
      // was refused: `percentToNumeric(0)` and not "0", so a value read back out is the value
      // written in.
      wasteRate: percentToNumeric(waste.ok ? waste.percent : percent(0n)),
      markupRate: percentToNumeric(markup.ok ? markup.percent : percent(0n)),
      plug: plug?.ok ? { value: plug.rate.value.toString(), precision: plug.rate.precision } : null,
      by: identity.by,
      components,
    },
    refusals,
  };
}

/** A stored build-up, back into the form the editor types into. */
export function draftOf(buildUp: BuildUp): BuildUpDraft {
  return {
    waste: formatTypedPercent(buildUp.wasteRate),
    markup: formatTypedPercent(buildUp.markupRate),
    plug: buildUp.plug === null ? "" : formatWireRate(buildUp.plug),
    components:
      buildUp.components.length === 0
        ? [EMPTY_COMPONENT]
        : buildUp.components.map((component) => ({
            kind: component.kind,
            description: component.description ?? "",
            quantity: component.quantity === null ? "" : formatQuantity(parseQuantity(component.quantity)),
            rate: component.rate === null ? "" : formatWireRate(component.rate),
          })),
  };
}

const formatTypedPercent = (numeric: string) => {
  const value = formatPercent(parsePercent(numeric));
  return value === "0" ? "" : value;
};

export const formatWireRate = (wire: WireRate) =>
  formatRate(rate(BigInt(wire.value), wire.precision));

/**
 * §4.8's three states — "the whole bill with priced / unpriced (amber) / overridden state".
 *
 * `unpriced` is the one that matters: a bill drafted from a specification arrives with a
 * description and no rate on most of its rows, and the count of those is the number a QS is working
 * down. §7.2 gives it amber, which is that palette's one meaning — "attention / unpriced / due
 * soon" — and §7.1 #5 requires the word beside the colour.
 *
 * `priced` means the rate is the one the documents gave and nobody has touched it. `overridden`
 * means a person put it there: typed, pasted, bulk-applied or built up. Which of those it was is
 * `rateSource`, not this — the two answer different questions and collapsing them would lose the
 * one a reviewer asks first.
 */
export type PriceState = "priced" | "overridden" | "unpriced";

export const PRICE_STATE_LABEL: Readonly<Record<PriceState, string>> = {
  priced: "Priced",
  overridden: "Overridden",
  unpriced: "Unpriced",
};

export function priceState(row: BillRow): PriceState {
  if (workingRow(row).rate === null) return "unpriced";
  return row.override?.rate ? "overridden" : "priced";
}

/** Where a rate came from, in the reader's words. One list, so no surface invents its own. */
export const RATE_SOURCE_LABEL: Readonly<Record<string, string>> = {
  ai_derived: "Read from the documents",
  manual: "Entered by hand",
  imported: "Pasted from a spreadsheet",
  build_up: "Built up",
  library: "From the rate library",
  rate_set: "From a rate set",
  tender: "From a tender return",
};

/**
 * What the pricing screen counts — §4.8's "persistent unpriced count".
 *
 * Over `pricedRows`, so headings and struck rows are out by construction. The total is the bill's
 * own, summed from already-rounded amounts, and this does not re-round it (§5.2).
 */
export interface PricingTally {
  items: number;
  priced: number;
  overridden: number;
  unpriced: number;
  total: Money;
}

export function pricingTally(rows: readonly BillRow[]): PricingTally {
  const items = rows.filter((row) => row.rowType === "item" && !row.omitted);
  const by = (state: PriceState) => items.filter((row) => priceState(row) === state).length;

  return {
    items: items.length,
    priced: by("priced"),
    overridden: by("overridden"),
    unpriced: by("unpriced"),
    total: sum(
      items
        .map((row) => row.amount)
        .filter((amount): amount is string => amount !== null)
        .map((amount) => money(BigInt(amount))),
    ),
  };
}
