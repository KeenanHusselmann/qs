/**
 * Evaluating tenders against the estimate, and looking for collusion — November meeting.
 *
 * Raymond's own process on the boundary wall, which the platform is to follow: build the bill and
 * estimate first; compare every tenderer's pricing against it line by line; score the bids; and look
 * for anomalies. On that tender the check found three bidders who had taken one bidder's prices and
 * added about 12% to every rate – collusive tendering, which the Competition Act (s4(1)(b)(iii))
 * prohibits outright.
 *
 * ── Why this is arithmetic, not a model ────────────────────────────────────────────────────
 *
 * A uniform uplift is a fact about ratios: tenderer B's rate divided by tenderer A's comes out at the
 * same figure, item after item. That is computed exactly and reproduced by anyone with the bill, and
 * an accusation of collusion has to be reproducible. A model asked "do these look colluded?" would
 * give a plausible answer nobody could check.
 *
 * ── An indicator, never a finding ──────────────────────────────────────────────────────────
 *
 * Two contractors pricing from the same supplier's list can match on materials honestly. What this
 * reports is a pattern strong enough to investigate – how many items, at what factor – and the words
 * on screen say so. Items every tenderer priced identically are left out of the comparison: those
 * are almost always provisional and prime-cost sums the bill fixed, and they would make every
 * tenderer look like every other.
 *
 * Pure. Rates are numbers in rands here: this is analysis of ratios, not money that is paid, and the
 * money layer's integers would add nothing but conversions.
 */

export interface EvaluationItem {
  id: string;
  ref: string;
  description: string;
  unit: string | null;
  quantity: number | null;
  /** The QS's own rate – the estimate every tender is read against. Null where the bill is unpriced. */
  estimateRate: number | null;
}

export interface EvaluationReturn {
  id: string;
  tenderer: string;
  /** Rate per bill item, in rands. Null or absent where the item was left unpriced. */
  rates: ReadonlyMap<string, number | null>;
}

/** Over or under the estimate by more than this is flagged on the line. */
export const VARIANCE_FLAG = 0.25;

export type LineFlag = "high" | "low" | "unpriced";

export interface LineCell {
  tendererId: string;
  rate: number | null;
  /** (rate − estimate) / estimate. Null where either is missing or the estimate is nought. */
  variance: number | null;
  flag: LineFlag | null;
}

export interface TendererAgainstEstimate {
  id: string;
  tenderer: string;
  /** Their rates times our quantities, over the items both they and we priced. */
  extended: number;
  /** Our rates times our quantities, over the same items – so the comparison is like for like. */
  estimate: number;
  variance: number | null;
  high: number;
  low: number;
  unpriced: number;
}

const variance = (value: number, against: number): number | null => (against > 0 ? (value - against) / against : null);

export function againstEstimate(
  items: readonly EvaluationItem[],
  returns: readonly EvaluationReturn[],
  flag = VARIANCE_FLAG,
): { lines: { item: EvaluationItem; cells: LineCell[] }[]; tenderers: TendererAgainstEstimate[] } {
  const lines = items.map((item) => ({
    item,
    cells: returns.map((r): LineCell => {
      const rate = r.rates.get(item.id) ?? null;
      if (rate === null) return { tendererId: r.id, rate, variance: null, flag: "unpriced" };
      const v = item.estimateRate === null ? null : variance(rate, item.estimateRate);
      return { tendererId: r.id, rate, variance: v, flag: v === null ? null : v > flag ? "high" : v < -flag ? "low" : null };
    }),
  }));

  const tenderers = returns.map((r, column): TendererAgainstEstimate => {
    let extended = 0;
    let estimate = 0;
    for (const { item, cells } of lines) {
      const rate = cells[column]!.rate;
      if (rate === null || item.estimateRate === null || item.quantity === null) continue;
      extended += rate * item.quantity;
      estimate += item.estimateRate * item.quantity;
    }
    const flags = lines.map((l) => l.cells[column]!.flag);
    return {
      id: r.id,
      tenderer: r.tenderer,
      extended,
      estimate,
      variance: variance(extended, estimate),
      high: flags.filter((f) => f === "high").length,
      low: flags.filter((f) => f === "low").length,
      unpriced: flags.filter((f) => f === "unpriced").length,
    };
  });

  return { lines, tenderers };
}

export interface CollusionIndicator {
  /** "uniform-uplift": B is A's rates times a factor. "identical": the same rates. */
  kind: "uniform-uplift" | "identical";
  base: { id: string; tenderer: string };
  other: { id: string; tenderer: string };
  /** B ÷ A, the median over the items compared. 1,12 is a 12% uplift. */
  factor: number;
  /** Items whose ratio sits on the factor, within rounding. */
  matching: number;
  /** Items both priced, excluding those every tenderer priced the same. */
  compared: number;
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/**
 * Pairs of tenderers whose rates are a constant multiple of each other – and the groups they form.
 *
 * A pair is reported when at least `minItems` items are compared and at least `share` of them sit on
 * the median ratio. "On" allows for rounding: rates are quoted to the cent, so a 12% uplift on a
 * R1,50 rate cannot land exactly, and the tolerance is the larger of half a percent and just over
 * half a cent.
 */
export function collusionIndicators(
  items: readonly EvaluationItem[],
  returns: readonly EvaluationReturn[],
  { minItems = 5, share = 0.8 }: { minItems?: number; share?: number } = {},
): { indicators: CollusionIndicator[]; groups: string[][] } {
  /*
    Sums the bill fixed – provisional and prime-cost sums – say nothing about who copied whom: every
    tenderer was given the figure. They are recognised by every tenderer pricing them at the bill's
    own figure. Not by tenderers merely agreeing with each other: with two tenderers who copied each
    other, *every* item agrees, and dropping those would throw away the evidence (a test caught it).
    Where the bill has no figure, agreement across three or more tenderers is taken as given.
  */
  const same = (x: number, y: number) => Math.abs(x - y) < 0.005;
  const informative = items.filter((item) => {
    const priced = returns.map((r) => r.rates.get(item.id) ?? null).filter((x): x is number => x !== null && x > 0);
    if (priced.length !== returns.length) return true;
    if (item.estimateRate !== null) return !priced.every((x) => same(x, item.estimateRate!));
    return !(priced.length >= 3 && priced.every((x) => same(x, priced[0]!)));
  });

  const indicators: CollusionIndicator[] = [];
  for (const a of returns) {
    for (const b of returns) {
      if (a.id === b.id) continue;
      const pairs = informative.flatMap((item) => {
        const ra = a.rates.get(item.id) ?? null;
        const rb = b.rates.get(item.id) ?? null;
        return ra !== null && rb !== null && ra > 0 && rb > 0 ? [[ra, rb] as const] : [];
      });
      if (pairs.length < minItems) continue;

      const factor = median(pairs.map(([ra, rb]) => rb / ra));
      const matching = pairs.filter(([ra, rb]) => Math.abs(rb - factor * ra) <= Math.max(0.005 * rb, 0.0051)).length;
      if (matching / pairs.length < share) continue;

      if (Math.abs(factor - 1) <= 0.001) {
        // Identical rates are one fact about two tenderers; report it once.
        if (a.id < b.id) indicators.push({ kind: "identical", base: { id: a.id, tenderer: a.tenderer }, other: { id: b.id, tenderer: b.tenderer }, factor, matching, compared: pairs.length });
      } else if (factor > 1) {
        // The reverse pair has the reciprocal factor; reporting only the uplift keeps one line per fact.
        indicators.push({ kind: "uniform-uplift", base: { id: a.id, tenderer: a.tenderer }, other: { id: b.id, tenderer: b.tenderer }, factor, matching, compared: pairs.length });
      }
    }
  }

  // Tenderers joined by any indicator are one group – three firms built off one price list are one finding.
  const parent = new Map(returns.map((r) => [r.id, r.id]));
  const find = (x: string): string => (parent.get(x) === x ? x : find(parent.get(x)!));
  for (const i of indicators) parent.set(find(i.other.id), find(i.base.id));
  const byRoot = new Map<string, string[]>();
  for (const r of returns) {
    if (!indicators.some((i) => i.base.id === r.id || i.other.id === r.id)) continue;
    byRoot.set(find(r.id), [...(byRoot.get(find(r.id)) ?? []), r.tenderer]);
  }

  indicators.sort((x, y) => y.matching / y.compared - x.matching / x.compared || y.compared - x.compared);
  return { indicators, groups: [...byRoot.values()].filter((g) => g.length > 1) };
}

/**
 * Price points under the PPPFA regulations: 80/20 (up to R50 million) or 90/10 (above).
 * Ps = W × (1 − (Pt − Pmin) / Pmin), and never below nought.
 */
export function pricePoints(total: number, lowest: number, weight: 80 | 90): number {
  if (lowest <= 0) return 0;
  return Math.max(0, weight * (1 - (total - lowest) / lowest));
}

/**
 * Every tender on the same scope – the comparison an award turns on.
 *
 * A tender that leaves items unpriced looks cheaper than it is: the work is still to be done, and it
 * comes back later as a claim or a variation. So each tenderer's own rates are extended over every
 * item, and an item they left unpriced is filled at the median rate of the tenderers who did price it
 * – or, if nobody did, at our estimate's rate. The filled amount is stated beside the total, never
 * folded in silently, because it is our assumption about their price and not their price.
 *
 * Items with no quantity are left out for every tenderer alike.
 */
export interface SameScopeTotal {
  id: string;
  tenderer: string;
  /** Their own rates times our quantities, over the items they priced. */
  headline: number;
  /** What their unpriced items come to at the fill-in rates. */
  filled: number;
  filledItems: number;
  /** Items nobody priced and the estimate has no rate for – not in any total. */
  unfillable: number;
  total: number;
  /** 1 is the lowest. */
  rank: number;
  headlineRank: number;
}

export function sameScopeTotals(items: readonly EvaluationItem[], returns: readonly EvaluationReturn[]): SameScopeTotal[] {
  const measured = items.filter((i) => i.quantity !== null && i.quantity > 0);
  const rows = returns.map((r) => {
    let headline = 0;
    let filled = 0;
    let filledItems = 0;
    let unfillable = 0;
    for (const item of measured) {
      const rate = r.rates.get(item.id) ?? null;
      if (rate !== null) {
        headline += rate * item.quantity!;
        continue;
      }
      const others = returns.filter((o) => o.id !== r.id).map((o) => o.rates.get(item.id) ?? null).filter((x): x is number => x !== null);
      const fill = others.length > 0 ? median(others) : item.estimateRate;
      if (fill === null) {
        unfillable += 1;
        continue;
      }
      filled += fill * item.quantity!;
      filledItems += 1;
    }
    return { id: r.id, tenderer: r.tenderer, headline, filled, filledItems, unfillable, total: headline + filled };
  });
  const rankBy = (key: "total" | "headline") => {
    const order = [...rows].sort((a, b) => a[key] - b[key]).map((r) => r.id);
    return (id: string) => order.indexOf(id) + 1;
  };
  const rank = rankBy("total");
  const headlineRank = rankBy("headline");
  return rows.map((r) => ({ ...r, rank: rank(r.id), headlineRank: headlineRank(r.id) })).sort((a, b) => a.rank - b.rank);
}
