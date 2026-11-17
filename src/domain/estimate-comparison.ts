/**
 * Estimate comparison – two or more cost estimates for the same works, element by element.
 *
 * ── Where this comes from ──────────────────────────────────────────────────────────────────
 *
 * The practice's memorandum MPS/MD/MEMO-04: two engineers' internal civil estimates for the same
 * estate, one a set of round-number allowances for 1 000 units made before the survey, the other
 * measured off concept drawings for 1 100 units. Neither had been prepared or checked by a QS. The
 * memo sets them side by side by element, shows the quantities and rates behind each figure, puts
 * both on one unit count, finds where the gap actually sits, and adds a third column – one of the
 * estimates with stated corrections applied – as the planning figure. And it says, in terms, that
 * the common cost of works should come from this platform.
 *
 * So the shape is the memo's:
 *
 *  - an estimate is a column: lines by element (quantity × rate, or a lump sum), its own unit
 *    count, P&G and contingency as percentages
 *  - a derived estimate starts as a copy of another's lines and carries **corrections**, each with
 *    a reference, an element, an amount and the reason – the memo's Table 3
 *  - the comparison puts every estimate on the same common unit count, and says where the gap
 *    between two of them sits: by element, and in the markups
 *  - clarifications are the observations that go back to the estimate's author
 *
 * ── The two things a total hides ───────────────────────────────────────────────────────────
 *
 * Coincidence and allowance. Two estimates can agree on roads within a million rand while being
 * built entirely differently – 35 000 m² at R1 350 against 54 029 m² split between carriageway and
 * parking – and an estimate made of lump sums can look as firm as a measured one. So the page shows
 * how each element was built (its quantities, its all-in rate, its share of lump sums) beside the
 * money, and says when a quarter of an estimate is allowances rather than measurement.
 *
 * Pure: no database. Money through `money.ts`, rounded once per line.
 */

import {
  applyPercent,
  extend,
  money,
  parseMoney,
  parsePercent,
  parseQuantity,
  parseRate,
  perUnit,
  quantity,
  sum,
  type Money,
} from "@/domain/money";

export const CLARIFICATION_STATUSES = ["Open", "Answered", "Closed"] as const;
export type ClarificationStatus = (typeof CLARIFICATION_STATUSES)[number];

/** One line of an estimate: a measured quantity at a rate, a lump sum, or both. Decimal strings. */
export interface EstimateLine {
  id?: string;
  position: number;
  element: string;
  description: string;
  quantity: string | null;
  unit: string | null;
  rate: string | null;
  /** Rand, decimal string. An allowance or a provisional sum with no quantity behind it. */
  lumpSum: string | null;
}

/** A stated change to an estimate – "earthworks volume doubled", with what it adds and why. */
export interface Correction {
  id?: string;
  position: number;
  ref: string;
  element: string;
  description: string;
  /** Rand, decimal string; negative takes money out. */
  amount: string;
  basis: string | null;
}

export interface Estimate {
  id?: string;
  position: number;
  name: string;
  preparedBy: string | null;
  dated: string | null;
  /** How it was made – "allowances, before the survey", "measured off the concept drawings". */
  basis: string | null;
  /** The unit count it was made for. Decimal string; null where it does not say. */
  units: string | null;
  /** Preliminaries and general, on direct works. Fraction, "0.1200". */
  preliminaries: string;
  /** Contingency, on direct works plus P&G. Fraction. */
  contingency: string;
  /** The estimate this one was derived from, by id. Null for an estimate as received. */
  derivedFrom: string | null;
  lines: EstimateLine[];
  corrections: Correction[];
}

export interface Clarification {
  id?: string;
  number: number;
  /** Which estimate it goes back to, by name. */
  estimate: string | null;
  observation: string;
  evidence: string | null;
  consequence: string | null;
  response: string | null;
  status: ClarificationStatus;
}

export interface Comparison {
  title: string;
  subject: string | null;
  /** The elements in the order the comparison reads them. Lines in others are appended after. */
  elements: string[];
  /** The one unit count every estimate is also divided by, so per-unit figures compare. */
  commonUnits: string | null;
  unitLabel: string;
  /** A second contingency to test the totals at – the memo's "with a 20% contingency". Fraction. */
  alternativeContingency: string | null;
  estimates: Estimate[];
  clarifications: Clarification[];
}

// ── Reading figures ───────────────────────────────────────────────────────────────────────

const has = (s: string | null | undefined): s is string =>
  s !== null && s !== undefined && s.trim() !== "";

function q(raw: string | null | undefined): bigint | null {
  if (!has(raw)) return null;
  try {
    return parseQuantity(raw);
  } catch {
    return null;
  }
}

function rand(raw: string | null | undefined): Money | null {
  if (!has(raw)) return null;
  try {
    return parseMoney(raw);
  } catch {
    return null;
  }
}

/** quantity × rate + lump sum. Null where the line carries neither – it is unpriced, not nought. */
export function lineAmount(
  line: Pick<EstimateLine, "quantity" | "rate" | "lumpSum">,
): { measured: Money; lump: Money } | null {
  const qty = q(line.quantity);
  const lump = rand(line.lumpSum);
  let measured: Money | null = null;
  if (qty !== null && has(line.rate)) {
    try {
      const places = Math.min(
        4,
        Math.max(2, /[.,](\d+)$/.exec(line.rate.trim())?.[1].length ?? 0),
      );
      measured = extend(quantity(qty), parseRate(line.rate, places));
    } catch {
      measured = null;
    }
  }
  if (measured === null && lump === null) return null;
  return { measured: measured ?? money(0n), lump: lump ?? money(0n) };
}

// ── One estimate, priced ──────────────────────────────────────────────────────────────────

export interface ElementFigure {
  element: string;
  amount: Money;
  /** The part that is quantity × rate. */
  measured: Money;
  /** The part that is lump sums and allowances. */
  lumpSums: Money;
  /** Corrections applied to this element, inside `amount`. */
  corrections: Money;
  /**
   * The element's all-in rate per its main unit – R/m of sewer including manholes and connections.
   * The main unit is the unit of the element's first measured line; null where nothing is measured.
   */
  allIn: { unit: string; quantity: string; rate: Money } | null;
  lines: number;
}

export interface PricedEstimate {
  estimate: Estimate;
  elements: ElementFigure[];
  direct: Money;
  preliminaries: Money;
  contingency: Money;
  total: Money;
  /** Total at the comparison's alternative contingency, where one is set. */
  alternativeTotal: Money | null;
  perUnitOwn: Money | null;
  perUnitCommon: Money | null;
  lumpSums: Money;
  /** Lump sums over direct works, for display. */
  lumpShare: number | null;
  /** Lines with neither a priced quantity nor a lump sum. */
  unpriced: EstimateLine[];
}

/** Every element any estimate carries, in the comparison's order and then as they appear. */
export function elementOrder(
  c: Pick<Comparison, "elements" | "estimates">,
): string[] {
  const order = [...c.elements];
  for (const e of c.estimates) {
    for (const l of e.lines)
      if (!order.includes(l.element)) order.push(l.element);
    for (const x of e.corrections)
      if (!order.includes(x.element)) order.push(x.element);
  }
  return order;
}

const fmt4 = (scaled: bigint) => {
  const neg = scaled < 0n;
  const abs = neg ? -scaled : scaled;
  return `${neg ? "-" : ""}${abs / 10000n}.${(abs % 10000n).toString().padStart(4, "0")}`;
};

export function priceEstimate(
  estimate: Estimate,
  order: readonly string[],
  c: Pick<Comparison, "commonUnits" | "alternativeContingency">,
): PricedEstimate {
  const unpriced: EstimateLine[] = [];
  const elements: ElementFigure[] = order.map((element) => {
    const lines = estimate.lines.filter((l) => l.element === element);
    const measured: Money[] = [];
    const lumps: Money[] = [];
    let mainUnit: string | null = null;
    let mainQty = 0n;
    for (const line of lines) {
      const a = lineAmount(line);
      if (a === null) {
        unpriced.push(line);
        continue;
      }
      measured.push(a.measured);
      lumps.push(a.lump);
      const qty = q(line.quantity);
      if (qty !== null && has(line.unit) && a.measured !== 0n) {
        mainUnit ??= line.unit.trim();
        if (line.unit.trim() === mainUnit) mainQty += qty;
      }
    }
    const corrections = sum(
      estimate.corrections
        .filter((x) => x.element === element)
        .map((x) => rand(x.amount) ?? money(0n)),
    );
    const m = sum(measured);
    const l = sum(lumps);
    const amount = money(m + l + corrections);
    return {
      element,
      amount,
      measured: m,
      lumpSums: l,
      corrections,
      allIn:
        mainUnit && mainQty > 0n
          ? {
              unit: mainUnit,
              quantity: fmt4(mainQty),
              rate: perUnit(money(m + l), quantity(mainQty)),
            }
          : null,
      lines: lines.length,
    };
  });

  const direct = sum(elements.map((e) => e.amount));
  const preliminaries = applyPercent(
    direct,
    parsePercent(estimate.preliminaries),
  );
  const contingency = applyPercent(
    money(direct + preliminaries),
    parsePercent(estimate.contingency),
  );
  const total = money(direct + preliminaries + contingency);
  const alternativeTotal = has(c.alternativeContingency)
    ? money(
        direct +
          preliminaries +
          applyPercent(
            money(direct + preliminaries),
            parsePercent(c.alternativeContingency),
          ),
      )
    : null;
  const own = q(estimate.units);
  const common = q(c.commonUnits);
  const lumpSums = sum(elements.map((e) => e.lumpSums));

  return {
    estimate,
    elements,
    direct,
    preliminaries,
    contingency,
    total,
    alternativeTotal,
    perUnitOwn: own !== null && own > 0n ? perUnit(total, quantity(own)) : null,
    perUnitCommon:
      common !== null && common > 0n ? perUnit(total, quantity(common)) : null,
    lumpSums,
    lumpShare: direct > 0n ? Number(lumpSums) / Number(direct) : null,
    unpriced,
  };
}

export function priceAll(c: Comparison): PricedEstimate[] {
  const order = elementOrder(c);
  return c.estimates.map((e) => priceEstimate(e, order, c));
}

// ── Where the gap sits ────────────────────────────────────────────────────────────────────

export interface GapPart {
  label: string;
  /** b − a. */
  difference: Money;
}

export interface Gap {
  from: string;
  to: string;
  total: Money;
  /** By element, then P&G and contingency, largest first by size. */
  parts: GapPart[];
}

/**
 * The difference between two estimates, taken apart – the memo's "the R67.0m gap is not in roads".
 *
 * The parts add to the total exactly: every element, then P&G, then contingency. Sorted by size
 * so the first lines are the answer to "where is the difference", and an element where the two
 * agree sinks to the bottom however large it is.
 */
export function gapBetween(a: PricedEstimate, b: PricedEstimate): Gap {
  const parts: GapPart[] = a.elements.map((ea, i) => ({
    label: ea.element,
    difference: money(b.elements[i].amount - ea.amount),
  }));
  parts.push({
    label: "Preliminaries and general",
    difference: money(b.preliminaries - a.preliminaries),
  });
  parts.push({
    label: "Contingency",
    difference: money(b.contingency - a.contingency),
  });
  const abs = (m: bigint) => (m < 0n ? -m : m);
  parts.sort((x, y) =>
    abs(y.difference) > abs(x.difference)
      ? 1
      : abs(y.difference) < abs(x.difference)
        ? -1
        : 0,
  );
  return {
    from: a.estimate.name,
    to: b.estimate.name,
    total: money(b.total - a.total),
    parts,
  };
}

// ── What a QS would say before using any of them ──────────────────────────────────────────

export interface ComparisonFinding {
  id: string;
  severity: "high" | "medium" | "low";
  finding: string;
  action: string;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const LUMP_SHARE = 0.2;

export function comparisonFindings(
  c: Comparison,
  priced: readonly PricedEstimate[] = priceAll(c),
): ComparisonFinding[] {
  const out: ComparisonFinding[] = [];

  for (const p of priced) {
    if (p.lumpShare !== null && p.lumpShare >= LUMP_SHARE) {
      out.push({
        id: `lumps-${p.estimate.position}`,
        severity: "medium",
        finding: `${p.estimate.name}: ${pct(p.lumpShare)} of direct works is lump sums and allowances, not measurement.`,
        action:
          "Read its total as an allowance. Ask for the quantities behind the largest sums before it is relied on.",
      });
    }
    if (p.unpriced.length > 0) {
      out.push({
        id: `unpriced-${p.estimate.position}`,
        severity: "medium",
        finding: `${p.estimate.name}: ${p.unpriced.length} line${p.unpriced.length === 1 ? " has" : "s have"} no rate and no sum, so ${p.unpriced.length === 1 ? "it is" : "they are"} not in the total.`,
        action: "Price them, or remove them if they are not part of the works.",
      });
    }
    const silent = p.estimate.corrections.filter((x) => !has(x.basis));
    if (silent.length > 0) {
      out.push({
        id: `basis-${p.estimate.position}`,
        severity: "medium",
        finding: `${p.estimate.name}: correction${silent.length === 1 ? "" : "s"} ${silent.map((x) => x.ref).join(", ")} ${silent.length === 1 ? "has" : "have"} no stated basis.`,
        action:
          "Say what each correction rests on – a quantity, a rate, a drawing – or it is an opinion with a number on it.",
      });
    }
  }

  // Elements one estimate carries and another does not.
  const order = elementOrder(c);
  for (const element of order) {
    const carried = priced.filter(
      (p) => p.elements.find((e) => e.element === element)!.amount !== 0n,
    );
    const missing = priced.filter(
      (p) => p.elements.find((e) => e.element === element)!.amount === 0n,
    );
    if (carried.length > 0 && missing.length > 0) {
      out.push({
        id: `missing-${element}`,
        severity: "high",
        finding: `${element} is carried by ${carried.map((p) => p.estimate.name).join(", ")} and not by ${missing.map((p) => p.estimate.name).join(", ")}.`,
        action:
          "Establish whether it is excluded, included elsewhere or forgotten before the totals are compared.",
      });
    }
  }

  // Unit counts that differ: own per-unit figures are not comparable.
  const counts = [
    ...new Set(
      c.estimates
        .map((e) => (q(e.units) === null ? null : fmt4(q(e.units)!)))
        .filter((u): u is string => u !== null),
    ),
  ];
  if (counts.length > 1) {
    out.push({
      id: "units",
      severity: has(c.commonUnits) ? "low" : "high",
      finding: `The estimates are made for different unit counts (${c.estimates.map((e) => `${e.name} ${e.units ? Number(e.units).toLocaleString("en-ZA") : "not stated"}`).join(", ")}).`,
      action: has(c.commonUnits)
        ? `Per-unit figures are compared at the common ${Number(c.commonUnits).toLocaleString("en-ZA")} ${c.unitLabel}; each estimate's own figure is shown beside it.`
        : `Set a common ${c.unitLabel} count, or the per-unit figures compare different schemes.`,
    });
  }

  // Markups that differ: totals mix bases, so the direct works are the like-for-like figure.
  const contingencies = [...new Set(c.estimates.map((e) => e.contingency))];
  const prelims = [...new Set(c.estimates.map((e) => e.preliminaries))];
  if (contingencies.length > 1 || prelims.length > 1) {
    out.push({
      id: "markups",
      severity: "low",
      finding: `The estimates carry different markups (${c.estimates.map((e) => `${e.name}: P&G ${pct(Number(e.preliminaries))}, contingency ${pct(Number(e.contingency))}`).join("; ")}).`,
      action:
        "Compare direct works like for like; the difference in markups is shown as its own part of the gap.",
    });
  }

  const open = c.clarifications.filter((x) => x.status === "Open");
  if (open.length > 0) {
    out.push({
      id: "clarifications",
      severity: "low",
      finding: `${open.length} clarification${open.length === 1 ? " is" : "s are"} open: ${open.map((x) => `C${x.number}`).join(", ")}.`,
      action: "Any figure taken from these estimates rests on the answers.",
    });
  }

  const order2 = { high: 0, medium: 1, low: 2 } as const;
  return out.sort((x, y) => order2[x.severity] - order2[y.severity]);
}
