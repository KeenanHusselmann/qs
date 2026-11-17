/**
 * Design review – a draft bill read line by line against the design that should govern it.
 *
 * ── Where this comes from ──────────────────────────────────────────────────────────────────
 *
 * The practice's own working paper for the Marshall Dam boundary wall: three draft bills from an
 * outside QS (Option A, Option B, Max Brick), mapped item by item against the architect's,
 * engineer's, land surveyor's and geotechnical documents. Seven sheets, and this file is the
 * arithmetic and the judgement those sheets carry:
 *
 *  - Sources        a register of every document read, each with a short reference (A1, E2, G1)
 *  - Parameters     the headline figures side by side, one column per discipline and per option
 *  - Item mapping   every bill item, its quantity per option, the governing design reference, a
 *                   status from a fixed key, a finding and a recommended action
 *  - Comparison     where the options' quantities differ, against the recommended base
 *  - Queries        numbered questions to the engineer, architect, surveyor, QS and client
 *  - Estimate       every item priced per option, adjustments the design needs that the bills
 *                   do not carry (each tied to a query), contingency, VAT and cost per metre
 *
 * ── What this will not do ──────────────────────────────────────────────────────────────────
 *
 * Decide anything. A status is the reviewer's reading of one item against one document, a query
 * stays open until somebody answers it, and the estimate is a budget figure pending priced tenders.
 * The workbook says all three things about itself, and the platform does not get to say less.
 *
 * Pure: no database, no clock. Money is exact integer arithmetic through `money.ts`, the same as
 * every bill in the product, so a review's total agrees with the bill it becomes.
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
  type Percent,
} from "@/domain/money";

// ── The status key ────────────────────────────────────────────────────────────────────────

/**
 * The workbook's status key, in its own words and order. A fixed key, because the summary counts
 * by it and a free-text status would be counted as many things as there were spellings.
 */
export const ITEM_STATUSES = ["Aligned", "Discrepancy", "Error", "Gap", "Query", "QS addition", "Standard"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const STATUS_MEANS: Readonly<Record<ItemStatus, string>> = {
  Aligned: "The item matches the design information.",
  Discrepancy: "The item differs from the design information.",
  Error: "An arithmetic or measurement error in the bill.",
  Gap: "The design requires it and the bill does not measure it.",
  Query: "Design information unclear or conflicting; needs a response.",
  "QS addition": "Not required by the design; the QS's judgement.",
  Standard: "A standard contractual or preliminary item.",
};

/** The statuses that need somebody to act before the bill is relied on. */
export const NEEDS_ACTION: readonly ItemStatus[] = ["Discrepancy", "Error", "Gap", "Query"];

export const PARAMETER_STATUSES = ["Aligned", "Discrepancy", "Gap", "Query"] as const;

export const QUERY_STATUSES = ["Open", "Answered", "Closed"] as const;
export type QueryStatus = (typeof QUERY_STATUSES)[number];

export const QUERY_PRIORITIES = ["High", "Medium", "Low"] as const;
export type QueryPriority = (typeof QUERY_PRIORITIES)[number];

/** Read a status typed by hand or carried in from a workbook, case and spacing forgiven. */
export function readStatus<T extends string>(raw: string | null | undefined, key: readonly T[]): T | null {
  const wanted = (raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return key.find((s) => s.toLowerCase() === wanted) ?? null;
}

// ── The shapes ────────────────────────────────────────────────────────────────────────────

/** A bill option under review – "Option B", "Max Brick". `key` is stable; `label` is what is shown. */
export interface ReviewOption {
  key: string;
  label: string;
}

export interface ReviewSource {
  id?: string;
  ref: string;
  discipline: string | null;
  document: string;
  dated: string | null;
  status: string | null;
  notes: string | null;
  location: string | null;
}

export interface ReviewParameter {
  id?: string;
  position: number;
  parameter: string;
  /** One value per column heading, in `columns` order. */
  values: Record<string, string>;
  status: string | null;
  consequence: string | null;
}

/**
 * One bill item, across every option.
 *
 * Quantities and rates are decimal strings – "1473.1500", "35000.00" – keyed by option. Null is
 * "not in this option" (the workbook's n/a), which is a different fact from a quantity of nought.
 */
export interface ReviewItem {
  id?: string;
  position: number;
  ref: string;
  bill: string;
  itemNumbers: Record<string, string>;
  description: string;
  unit: string | null;
  quantities: Record<string, string | null>;
  designSource: string | null;
  requirement: string | null;
  status: ItemStatus | null;
  finding: string | null;
  action: string | null;
  rates: Record<string, string | null>;
  rateBasis: string | null;
}

export interface ReviewQuery {
  id?: string;
  number: number;
  topic: string | null;
  query: string;
  raisedTo: string | null;
  affects: string | null;
  priority: QueryPriority | null;
  sourceRef: string | null;
  response: string | null;
  status: QueryStatus;
}

/** Something the design needs that the bills do not carry, priced, and tied to the query behind it. */
export interface ReviewAdjustment {
  id?: string;
  position: number;
  ref: string;
  queryNumber: number | null;
  description: string;
  unit: string | null;
  quantities: Record<string, string | null>;
  rates: Record<string, string | null>;
  basis: string | null;
}

/**
 * The estimate's key assumptions, as the workbook's yellow cells hold them.
 *
 * Percentages are decimal fractions ("0.10" is 10%), as `numeric(6,4)` and the workbook both write
 * them. The main dimension is what the cost is divided by – 491.05 m of wall – with its own unit,
 * because a boundary wall is costed per metre and a block of flats per unit or per m².
 */
export interface ReviewAssumptions {
  mainQuantity: string | null;
  mainUnit: string | null;
  contingency: string;
  vat: string;
  profitAndAttendance: string;
  rangeLow: string;
  rangeHigh: string;
  contractWeeks: number | null;
  /** A figure to compare against – an internal cost plan, an earlier estimate. Rand, decimal string. */
  comparisonAmount: string | null;
  comparisonLabel: string | null;
}

export const DEFAULT_ASSUMPTIONS: ReviewAssumptions = {
  mainQuantity: null,
  mainUnit: "m",
  contingency: "0.1000",
  vat: "0.1500",
  profitAndAttendance: "0.0750",
  rangeLow: "-0.1000",
  rangeHigh: "0.1500",
  contractWeeks: null,
  comparisonAmount: null,
  comparisonLabel: null,
};

export interface Review {
  title: string;
  /** What was reviewed – "Ronmar draft bills, Sep 2026". */
  subject: string | null;
  options: ReviewOption[];
  /** The recommended base option's key, against which the others are compared. */
  baseOption: string | null;
  recommendation: string | null;
  limitations: string | null;
  parameterColumns: string[];
  assumptions: ReviewAssumptions;
  sources: ReviewSource[];
  parameters: ReviewParameter[];
  items: ReviewItem[];
  queries: ReviewQuery[];
  adjustments: ReviewAdjustment[];
}

// ── Counts – the Read Me sheet's COUNTIFs ─────────────────────────────────────────────────

export interface StatusCount {
  status: ItemStatus;
  count: number;
}

export function statusCounts(items: readonly Pick<ReviewItem, "status">[]): { counts: StatusCount[]; unmarked: number; total: number } {
  const counts = ITEM_STATUSES.map((status) => ({ status, count: items.filter((i) => i.status === status).length }));
  return { counts, unmarked: items.filter((i) => i.status === null).length, total: items.length };
}

export function queryCounts(queries: readonly Pick<ReviewQuery, "status" | "priority">[]) {
  return {
    open: queries.filter((q) => q.status === "Open").length,
    answered: queries.filter((q) => q.status === "Answered").length,
    closed: queries.filter((q) => q.status === "Closed").length,
    highOpen: queries.filter((q) => q.status === "Open" && q.priority === "High").length,
  };
}

// ── Option comparison ─────────────────────────────────────────────────────────────────────

export interface ComparisonRow {
  ref: string;
  description: string;
  unit: string | null;
  /** Per option: the quantity as written, or null where the option does not carry the item. */
  quantities: Record<string, string | null>;
  /** Per option other than the base: the difference from the base, and as a fraction of it. */
  against: Record<string, { difference: string | null; fraction: number | null }>;
}

/** A quantity in ten-thousandths, or null for n/a. Unreadable text is treated as n/a, never as nought. */
function scaledQuantity(raw: string | null | undefined): bigint | null {
  if (raw === null || raw === undefined || raw.trim() === "") return null;
  try {
    return parseQuantity(raw);
  } catch {
    return null;
  }
}

const formatScaled4 = (scaled: bigint): string => {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const text = `${abs / 10000n}.${(abs % 10000n).toString().padStart(4, "0")}`.replace(/\.?0+$/, "");
  return negative ? `-${text}` : text;
};

/**
 * The items whose quantities are not the same in every option – the Option Comparison sheet.
 *
 * Against the base option because that is the question the review answers: Option B is the
 * recommendation, so what does choosing Max Brick instead add or remove? An item one option does
 * not carry at all is a difference too (Option A's face-brick cleaning), and is listed.
 */
export function optionComparison(items: readonly ReviewItem[], options: readonly ReviewOption[], baseKey: string | null): ComparisonRow[] {
  const base = options.find((o) => o.key === baseKey) ?? options[0];
  if (!base || options.length < 2) return [];

  return items.flatMap((item) => {
    const scaled = options.map((o) => scaledQuantity(item.quantities[o.key]));
    const first = scaled[0];
    const same = scaled.every((q) => q === first);
    if (same) return [];

    const baseQty = scaledQuantity(item.quantities[base.key]);
    const against: ComparisonRow["against"] = {};
    for (const o of options) {
      if (o.key === base.key) continue;
      const q = scaledQuantity(item.quantities[o.key]);
      if (q === null || baseQty === null) {
        against[o.key] = { difference: null, fraction: null };
        continue;
      }
      against[o.key] = {
        difference: formatScaled4(q - baseQty),
        // A ratio for display only – it is printed as a percentage and never summed or stored.
        fraction: baseQty === 0n ? null : Number(q - baseQty) / Number(baseQty),
      };
    }
    return [{ ref: item.ref, description: item.description, unit: item.unit, quantities: item.quantities, against }];
  });
}

// ── The estimate ──────────────────────────────────────────────────────────────────────────

const PRELIMINARIES = /^prelim/i;
const PROVISIONAL = /^provisional/i;

export interface BillTotal {
  bill: string;
  amount: Money;
  /** Profit and attendance carried on provisional sums, inside `amount`. Nought elsewhere. */
  profitAndAttendance: Money;
}

export interface OptionEstimate {
  option: ReviewOption;
  bills: BillTotal[];
  preliminaries: Money;
  /** Measured work: every bill except preliminaries and provisional sums. */
  measured: Money;
  billed: Money;
  adjustments: Money;
  adjusted: Money;
  contingency: Money;
  totalExVat: Money;
  vat: Money;
  totalIncVat: Money;
  /** Total excl. VAT per main unit – R/m of wall. Null where the main quantity is not set. */
  perMainUnit: Money | null;
  /** Preliminaries over measured work, for display. Null where nothing is measured. */
  preliminariesShare: number | null;
  rangeLow: Money;
  rangeHigh: Money;
  /** Total excl. VAT less the comparison figure. Null where there is none. */
  againstComparison: Money | null;
  /** Items that carry a quantity in this option and no rate – what the total does not include. */
  unpriced: string[];
}

function amountOf(qty: string | null | undefined, rate: string | null | undefined): Money | null {
  const q = scaledQuantity(qty);
  if (q === null || rate === null || rate === undefined || rate.trim() === "") return null;
  try {
    // A rate keeps the places it was written to (§5.1: bricks and fixings carry four), never fewer than two.
    const places = Math.min(4, Math.max(2, (/[.,](\d+)$/.exec(rate.trim())?.[1].length ?? 0)));
    return extend(quantity(q), parseRate(rate, places));
  } catch {
    return null;
  }
}

const pct = (raw: string): Percent => parsePercent(raw);

/** `amount × (1 + fraction)`, for the accuracy band – the fraction may be negative. */
function plusPercent(amount: Money, fraction: string): Money {
  return money(amount + applyPercent(amount, pct(fraction)));
}

/**
 * Each option priced: bills, preliminaries, adjustments, contingency, VAT, cost per metre, range.
 *
 * The workbook's own order of operations, which is also the order a QS reads a summary in:
 *
 *     billed      = Σ bills (preliminaries, measured work, provisional sums with P&A)
 *     adjusted    = billed + recommended adjustments
 *     total excl. = adjusted + contingency on adjusted
 *     total incl. = total excl. + VAT on total excl.
 *
 * Every line amount is rounded once, in `extend`; nothing after it re-rounds a sum.
 */
export function estimate(review: Pick<Review, "options" | "items" | "adjustments" | "assumptions">): OptionEstimate[] {
  const a = review.assumptions;
  const main = scaledQuantity(a.mainQuantity);

  return review.options.map((option) => {
    const order: string[] = [];
    const byBill = new Map<string, Money[]>();
    const unpriced: string[] = [];

    for (const item of review.items) {
      const qty = item.quantities[option.key];
      if (scaledQuantity(qty) === null) continue;
      const amount = amountOf(qty, item.rates[option.key]);
      if (amount === null) {
        unpriced.push(item.ref);
        continue;
      }
      if (!byBill.has(item.bill)) {
        byBill.set(item.bill, []);
        order.push(item.bill);
      }
      byBill.get(item.bill)!.push(amount);
    }

    const bills: BillTotal[] = order.map((bill) => {
      const base = sum(byBill.get(bill)!);
      // Profit and attendance on provisional sums, as the bills carry it: a percentage on each sum.
      const pa = PROVISIONAL.test(bill) ? applyPercent(base, pct(a.profitAndAttendance)) : money(0n);
      return { bill, amount: money(base + pa), profitAndAttendance: pa };
    });

    const preliminaries = sum(bills.filter((b) => PRELIMINARIES.test(b.bill)).map((b) => b.amount));
    const measured = sum(bills.filter((b) => !PRELIMINARIES.test(b.bill) && !PROVISIONAL.test(b.bill)).map((b) => b.amount));
    const billed = sum(bills.map((b) => b.amount));
    const adjustments = sum(
      review.adjustments.map((adj) => amountOf(adj.quantities[option.key], adj.rates[option.key])).filter((m): m is Money => m !== null),
    );
    const adjusted = money(billed + adjustments);
    const contingency = applyPercent(adjusted, pct(a.contingency));
    const totalExVat = money(adjusted + contingency);
    const vat = applyPercent(totalExVat, pct(a.vat));

    let comparison: Money | null = null;
    if (a.comparisonAmount) {
      try {
        comparison = parseMoney(a.comparisonAmount);
      } catch {
        comparison = null;
      }
    }

    return {
      option,
      bills,
      preliminaries,
      measured,
      billed,
      adjustments,
      adjusted,
      contingency,
      totalExVat,
      vat,
      totalIncVat: money(totalExVat + vat),
      perMainUnit: main !== null && main > 0n ? perUnit(totalExVat, quantity(main)) : null,
      preliminariesShare: measured > 0n ? Number(preliminaries) / Number(measured) : null,
      rangeLow: plusPercent(totalExVat, a.rangeLow),
      rangeHigh: plusPercent(totalExVat, a.rangeHigh),
      againstComparison: comparison === null ? null : money(totalExVat - comparison),
      unpriced,
    };
  });
}

// ── What a reviewer would ask before this is issued ───────────────────────────────────────

export interface ReviewFinding {
  id: string;
  severity: "high" | "medium" | "low";
  finding: string;
  action: string;
}

/** Source references cited in free text – "E1 7.1 and 7.3, G1 4.3" cites E1 and G1. */
export function citedRefs(text: string | null, known: readonly string[]): string[] {
  if (!text) return [];
  return known.filter((ref) => new RegExp(`(^|[^A-Za-z0-9])${ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![0-9])`).test(text));
}

const SUPERSEDED = /supersed/i;

/**
 * The checks the practice's own process applies, and which a spreadsheet cannot apply to itself.
 *
 *  - an item resting on a document the register marks superseded
 *  - a design reference to a document the register does not hold
 *  - an item that needs action with no finding written against it
 *  - an option with quantities that carry no rate, so its total is short
 *  - high-priority queries still open
 *
 * Questions, not corrections: each says what was seen and what to do about it.
 */
export function reviewFindings(review: Review): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const refs = review.sources.map((s) => s.ref).filter(Boolean);
  const superseded = review.sources.filter((s) => SUPERSEDED.test(s.status ?? "")).map((s) => s.ref);

  const onSuperseded = review.items.filter((i) => citedRefs(i.designSource, superseded).length > 0);
  if (onSuperseded.length > 0) {
    findings.push({
      id: "superseded-source",
      severity: "medium",
      finding: `${onSuperseded.length} item${onSuperseded.length === 1 ? " cites" : "s cite"} a document the register marks superseded (${[...new Set(onSuperseded.flatMap((i) => citedRefs(i.designSource, superseded)))].join(", ")}): ${onSuperseded.map((i) => i.ref).join(", ")}.`,
      action: "Confirm each against the current revision, or record why the superseded drawing still governs.",
    });
  }

  if (refs.length > 0) {
    const tokens = /\b([A-Z]{1,3}\d{1,2})\b/g;
    const unknown = new Set<string>();
    for (const item of review.items) {
      for (const m of (item.designSource ?? "").matchAll(tokens)) if (!refs.includes(m[1])) unknown.add(m[1]);
    }
    if (unknown.size > 0) {
      findings.push({
        id: "unknown-source",
        severity: "low",
        finding: `Design references not in the sources register: ${[...unknown].sort().join(", ")}.`,
        action: "Add the document to the register, or correct the reference.",
      });
    }
  }

  const silent = review.items.filter((i) => i.status !== null && NEEDS_ACTION.includes(i.status) && !(i.finding ?? "").replace(/^-$/, "").trim());
  if (silent.length > 0) {
    findings.push({
      id: "no-finding",
      severity: "medium",
      finding: `${silent.length} item${silent.length === 1 ? " is" : "s are"} marked for action with no finding written: ${silent.map((i) => i.ref).join(", ")}.`,
      action: "Say what differs from the design, so the QS can act on it without re-reading the drawings.",
    });
  }

  const unmarked = review.items.filter((i) => i.status === null);
  if (unmarked.length > 0) {
    findings.push({
      id: "unmarked",
      severity: "low",
      finding: `${unmarked.length} item${unmarked.length === 1 ? " has" : "s have"} no status yet: ${unmarked.slice(0, 12).map((i) => i.ref).join(", ")}${unmarked.length > 12 ? " …" : ""}.`,
      action: "Map each against the design before the review is issued.",
    });
  }

  for (const e of estimate(review)) {
    if (e.unpriced.length > 0) {
      findings.push({
        id: `unpriced-${e.option.key}`,
        severity: "medium",
        finding: `${e.option.label}: ${e.unpriced.length} item${e.unpriced.length === 1 ? " carries" : "s carry"} a quantity and no rate, so its total leaves ${e.unpriced.length === 1 ? "it" : "them"} out: ${e.unpriced.slice(0, 12).join(", ")}${e.unpriced.length > 12 ? " …" : ""}.`,
        action: "Price them, or mark the item n/a in this option if it does not belong to it.",
      });
    }
  }

  const high = review.queries.filter((q) => q.status === "Open" && q.priority === "High");
  if (high.length > 0) {
    findings.push({
      id: "high-queries",
      severity: "high",
      finding: `${high.length} high-priority quer${high.length === 1 ? "y is" : "ies are"} open: ${high.map((q) => `Q${q.number}`).join(", ")}.`,
      action: "The estimate rests on their answers. Say so wherever the figure is reported.",
    });
  }

  const order = { high: 0, medium: 1, low: 2 } as const;
  return findings.sort((x, y) => order[x.severity] - order[y.severity]);
}
