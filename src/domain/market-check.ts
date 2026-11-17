/**
 * Our rates against what tenderers priced the same items at on the practice's past jobs.
 *
 * ── Why the practice's own tenders, and not a published guide ──────────────────────────────
 *
 * A published guide gives whole-building rates per m², not a rate for "one-brick wall in 14 MPa
 * bricks". The practice already holds the item-level answer: every signed bill it has tendered,
 * with each tenderer's rate against our quantity. RLB's advice on AI-assisted rate checks is the
 * same – they are more reliable built on a QS's own historical tender data than on anything else.
 *
 * ── Comparable means the same item, strictly ──────────────────────────────────────────────
 *
 * The same unit (a rate per m² is not a rate per m³), a close description, and the same specification
 * numbers both ways – "25 MPa" against "30 MPa" is a different item however alike the words. Better
 * to compare fewer items than to compare the wrong ones: a flag raised against the wrong item is a
 * QS told their correct rate is wrong.
 *
 * ── Tenders only, and more than one ──────────────────────────────────────────────────────
 *
 * The market is what tenderers priced. Our own past estimates are not the market – comparing our rate
 * to our earlier rate checks consistency, not price. And a single tender rate is one contractor's
 * appetite on one day, so an item is checked only against at least two.
 *
 * Pure: items and past rates in, findings out.
 */

import { sameUnit, significantWords, similarity } from "@/lib/rate-match";

/** Out of line by more than this, either way, is flagged – the tender evaluation's own threshold. */
export const MARKET_FLAG = 0.25;
/** How alike two descriptions must be to be the same item – stricter than offering a library rate. */
export const MARKET_SIMILARITY = 0.75;
/** Fewer tender rates than this is not a market. */
export const MIN_TENDER_RATES = 2;

export interface CheckedItem {
  id: string;
  ref: string;
  description: string;
  unit: string | null;
  /** Our rate, in rands. Unpriced items are not checked. */
  rate: number | null;
}

export interface PastTenderRate {
  description: string;
  unit: string | null;
  /** The tenderer's rate, in rands. */
  rate: number;
  project: string;
}

export interface MarketFinding {
  itemId: string;
  ref: string;
  description: string;
  unit: string;
  ours: number;
  low: number;
  median: number;
  high: number;
  /** How many tender rates, and from how many past projects. */
  rates: number;
  projects: number;
  /** (ours − median) / median. */
  variance: number;
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** The numbers in a description – "25 MPa", "110 mm" – which must agree both ways. */
const numbers = (text: string): string => significantWords(text).filter((w) => /\d/.test(w)).sort().join(" ");

/** Whether a past item is the same item as ours. */
export function comparable(ours: { description: string; unit: string }, past: { description: string; unit: string }): boolean {
  return (
    sameUnit(ours.unit, past.unit) &&
    numbers(ours.description) === numbers(past.description) &&
    similarity(ours.description, past.description) >= MARKET_SIMILARITY
  );
}

/** The items whose rate is out of line with past tenders, the furthest out first. */
export function marketCheck(items: readonly CheckedItem[], past: readonly PastTenderRate[]): MarketFinding[] {
  const findings: MarketFinding[] = [];
  for (const item of items) {
    if (item.rate === null || item.rate <= 0 || !item.unit) continue;
    const unit = item.unit;
    const matches = past.filter((p) => p.unit && p.rate > 0 && comparable({ description: item.description, unit }, { description: p.description, unit: p.unit }));
    if (matches.length < MIN_TENDER_RATES) continue;
    const rates = matches.map((m) => m.rate);
    const mid = median(rates);
    const variance = (item.rate - mid) / mid;
    if (Math.abs(variance) <= MARKET_FLAG) continue;
    findings.push({
      itemId: item.id,
      ref: item.ref,
      description: item.description,
      unit,
      ours: item.rate,
      low: Math.min(...rates),
      median: mid,
      high: Math.max(...rates),
      rates: rates.length,
      projects: new Set(matches.map((m) => m.project)).size,
      variance,
    });
  }
  return findings.sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));
}
