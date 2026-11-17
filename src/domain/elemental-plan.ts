/**
 * The elemental cost plan, from a measured bill – D1.1 "Cost Plan Revision". PLATFORM.md §5.
 *
 * ── Why the bill feeds the plan ────────────────────────────────────────────────────────────
 *
 * A cost plan made before the design is an estimate by element from rates per m². Once the design
 * is detailed and measured, the bill *is* the better estimate, and the plan is revised from it: each
 * measured item belongs to an element – substructure, superstructure, finishes, services – and the
 * element's cost is the sum of its items. What the plan adds on top of the measured work is what a
 * bill of measured items does not carry: preliminaries, a contingency, escalation to the tender
 * date, and VAT.
 *
 * ── Exact, in cents ────────────────────────────────────────────────────────────────────────
 *
 * Every figure is `Money` (bigint cents) and every allowance a `Percent` (bigint, four places on the
 * fraction), applied with `applyPercent` – rounded once, half away from nought. The shares are
 * basis points of the net measured cost, for display only.
 */

import { applyPercent, divideRounded, money, perUnit, sum, ZERO_MONEY, type Money, type Percent, type Quantity } from "@/domain/money";

export const ELEMENTS = [
  { id: "substructure", label: "Substructure", covers: "Excavation, foundations and footings, foundation walling, backfill, surface beds, damp-proofing at ground level" },
  { id: "superstructure", label: "Superstructure", covers: "Walls, columns and piers, frames, floors, roofs, openings, copings and caps" },
  { id: "finishes", label: "Finishes", covers: "Plaster, paint, screeds, tiling, ceilings and other applied finishes" },
  { id: "fittings", label: "Fittings", covers: "Joinery, cupboards, ironmongery and built-in fittings" },
  { id: "services", label: "Services", covers: "Electrical, plumbing and drainage, mechanical and fire services" },
  { id: "external", label: "External works", covers: "Paving, roads, fencing, landscaping and site works outside the building" },
  { id: "preliminaries", label: "Preliminaries and general", covers: "The contractor's site establishment and time-related costs, where the bill measures them" },
  { id: "provisional", label: "Provisional and prime cost sums", covers: "Sums the bill carries for work not yet designed or chosen" },
] as const;

export type ElementId = (typeof ELEMENTS)[number]["id"];

export const isElement = (value: string): value is ElementId => ELEMENTS.some((e) => e.id === value);

/**
 * A bill description run into a sentence – "of concrete strip footing, 15 MPa" – with only its first
 * letter lowered. Lowering the whole of it prints "15 mpa" and "class ii"; an opening acronym
 * ("DPC to walls") is left as it is.
 */
export const inSentence = (description: string): string =>
  /^\S*[A-Z]\S*[A-Z]/.test(description) ? description : description.charAt(0).toLowerCase() + description.slice(1);

/*
  The words each element is recognised by, tried in this order. Order matters: "damp-proof course
  in foundation walling" is substructure before it is anything else, and "provisional sum for
  electrical" is a provisional sum before it is services.
*/
const RULES: readonly [ElementId, RegExp][] = [
  ["provisional", /\b(provisional sum|prime cost|p\.?c\.? sum|contingenc)/i],
  ["preliminaries", /\b(preliminar|p\s*&\s*g|site establishment|contract insurance)/i],
  ["substructure", /\b(excavat|backfill|cart(ing)? away|footing|foundation|surface bed|ground slab|blinding|hardcore|soil poison|pile|piling|below (ground|ngl)|damp[- ]proof)/i],
  ["services", /\b(electric|plumbing|drainage|sanitary|water supply|sewer|hvac|mechanical|fire (hose|detection|protection)|conduit|light fitting|luminaire|socket)/i],
  ["finishes", /\b(plaster|paint|screed|tiling|tiles?\b|ceiling|skirting|render|finish|glaze|carpet|vinyl)/i],
  ["fittings", /\b(joinery|cupboard|ironmongery|counter|built-in|shelving|vanity)/i],
  ["external", /\b(paving|road|parking|kerb|landscap|fenc|clear vu|palisade|gate|external works|site works|stormwater channel)/i],
];

/**
 * The element a bill row belongs to, from its words – for rows nobody has assigned. The measuring
 * agent assigns its own items, and a QS can reassign any row; this is only the starting guess, and
 * the page says which rows it guessed.
 */
export function classifyElement(description: string, section: string | null = null): ElementId {
  for (const [element, words] of RULES) if (words.test(description)) return element;
  if (section) for (const [element, words] of RULES) if (words.test(section)) return element;
  return "superstructure";
}

export interface PlanRow {
  id: string;
  description: string;
  element: ElementId;
  /** Null where the row is not priced – it is counted, never taken as nought. */
  amount: Money | null;
  quantity?: Quantity | null;
  unit?: string | null;
}

/** An element quantity a QS set, in place of the principal measured item's. */
export interface ElementQuantity {
  quantity: Quantity;
  unit: string;
  label: string;
}

export interface Allowances {
  preliminaries: Percent;
  contingency: Percent;
  escalation: Percent;
  vat: Percent;
}

export interface ElementLine {
  id: ElementId;
  label: string;
  amount: Money;
  items: number;
  unpriced: number;
  /** Basis points of the net measured cost – 2 530 is 25,30%. */
  share: number;
  /** Cost per unit of the plan's measure – per m of wall, per m² of floor – where one is given. */
  perMeasure: Money | null;
  /**
   * The element unit quantity and rate – ASAQS's EUQ and EUR. The quantity is the element's
   * principal measured item (the one carrying most of its cost) unless a QS set another; the rate is
   * the element's whole cost over it. Null where nothing in the element is both measured and priced.
   */
  quantity: { value: Quantity; unit: string; basis: string; set: boolean } | null;
  rate: Money | null;
}

export interface ElementalPlan {
  elements: ElementLine[];
  /** The measured work, priced: the sum of every element. */
  net: Money;
  preliminaries: Money;
  contingency: Money;
  escalation: Money;
  excludingVat: Money;
  vat: Money;
  includingVat: Money;
  perMeasure: { excludingVat: Money; includingVat: Money } | null;
  unpriced: number;
}

/**
 * The item an element's quantity is taken from: the priced, measured item carrying most of its cost.
 * Walling is the quantity of a superstructure of walls and piers, the footing of a substructure – the
 * item a QS would quote the element's rate against.
 */
export function principalItem(rows: readonly PlanRow[]): PlanRow | null {
  let best: PlanRow | null = null;
  for (const r of rows) {
    if (r.amount === null || !r.quantity || r.quantity <= 0n || !r.unit) continue;
    if (!best || r.amount > best.amount!) best = r;
  }
  return best;
}

export function elementalPlan(
  rows: readonly PlanRow[],
  allowances: Allowances,
  measure: Quantity | null = null,
  quantities: ReadonlyMap<ElementId, ElementQuantity> = new Map(),
): ElementalPlan {
  const net = sum(rows.flatMap((r) => (r.amount === null ? [] : [r.amount])));
  const per = (amount: Money) => (measure && measure > 0n ? perUnit(amount, measure) : null);

  const elements = ELEMENTS.map((e) => {
    const mine = rows.filter((r) => r.element === e.id);
    const amount = sum(mine.flatMap((r) => (r.amount === null ? [] : [r.amount])));
    const set = quantities.get(e.id);
    const principal = set ? null : principalItem(mine);
    const quantity = set
      ? { value: set.quantity, unit: set.unit, basis: set.label, set: true }
      : principal
        ? { value: principal.quantity!, unit: principal.unit!, basis: principal.description, set: false }
        : null;
    return {
      id: e.id,
      label: e.label,
      amount,
      items: mine.length,
      unpriced: mine.filter((r) => r.amount === null).length,
      share: net > 0n ? Number(divideRounded(amount * 10_000n, net)) : 0,
      perMeasure: per(amount),
      quantity,
      rate: quantity ? perUnit(amount, quantity.value) : null,
    };
  }).filter((e) => e.items > 0);

  // Preliminaries on the measured work that is not itself preliminaries – a bill that measures its
  // own preliminaries is not charged them twice.
  const billedPrelims = elements.find((e) => e.id === "preliminaries")?.amount ?? ZERO_MONEY;
  const preliminaries = applyPercent(money(net - billedPrelims), allowances.preliminaries);
  const contingency = applyPercent(money(net + preliminaries), allowances.contingency);
  const escalation = applyPercent(money(net + preliminaries + contingency), allowances.escalation);
  const excludingVat = money(net + preliminaries + contingency + escalation);
  const vat = applyPercent(excludingVat, allowances.vat);
  const includingVat = money(excludingVat + vat);

  return {
    elements,
    net,
    preliminaries,
    contingency,
    escalation,
    excludingVat,
    vat,
    includingVat,
    perMeasure: measure && measure > 0n ? { excludingVat: perUnit(excludingVat, measure), includingVat: perUnit(includingVat, measure) } : null,
    unpriced: rows.filter((r) => r.amount === null).length,
  };
}
