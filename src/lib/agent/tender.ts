/**
 * Comparing tenders against the bill they were invited on — PLATFORM.md §1.4 (D1.3), §5.2, §6.5.
 *
 * ── What a comparison is, and why it needs the rows ────────────────────────────────────────
 *
 * `/tender-analysis` could already record what a tender came to: eight fields read out of an
 * adjudication report somebody else had written. That is a summary of a comparison, not a
 * comparison — and it cannot answer the question the QS is actually being paid for, which is
 * **whether the number on the form is the number the rates produce**.
 *
 * A tenderer writes a sum on the front of a tender. Their own rates, extended against our
 * quantities, produce another. The two differ often enough that reconciling them is a named task in
 * the process model (`ta-arithmetic`, *"why a corrected sum differs from what was submitted"*), and
 * it is arithmetic no summary can carry: you need every row.
 *
 * ── Nothing here is stored ─────────────────────────────────────────────────────────────────
 *
 * §6.5. The extension of one rate is stored, because the database computes it once at the single
 * rounding point (§5.2, `tender_prices_extend`). Everything above that — a tenderer's total, the
 * difference from their stated sum, which is lowest, how each compares to our bill — is derived on
 * every read from figures that are already rounded. A stored "lowest tender" is a second answer to
 * a question with one, and it goes stale the moment a rate is corrected.
 */

import { money, sum, type Money } from "@/domain/money";

/** A rate as it crosses to the client — minor units unparsed, as everywhere else (§5.1). */
export interface WirePrice {
  itemId: string;
  /** Null where the tenderer left the item unpriced, which is not the same as pricing it at nought. */
  rate: { value: string; precision: number } | null;
  amount: string | null;
}

export interface TenderReturn {
  id: string;
  tenderer: string;
  /** What they wrote on the form, uncorrected. Null until somebody enters it. */
  statedSum: string | null;
  receivedAt: string | null;
  prices: WirePrice[];
}

/**
 * One tenderer's column, as the comparison reads it.
 *
 * `extended` is the sum of the rows they priced. `stated` is what they said. `difference` is the
 * arithmetic correction, and it is the reason this module exists.
 */
export interface TenderColumn {
  id: string;
  tenderer: string;
  /** Their own rates against our quantities, summed. */
  extended: Money;
  stated: Money | null;
  /** `extended − stated`. Null where nothing was stated to compare against. */
  difference: Money | null;
  /** Items they left unpriced. A tender with holes is not comparable to one without. */
  unpriced: number;
  /** Against the bill's own total: positive is over, negative is under. */
  againstBill: Money;
}

/**
 * The comparison, derived.
 *
 * `items` is the count of priced rows in the signed bill — the denominator for "unpriced", so a
 * tenderer who quoted nine of twelve items reads as incomplete rather than as cheap.
 */
export function compareTenders(
  returns: readonly TenderReturn[],
  items: readonly string[],
  billTotal: Money,
): {
  columns: TenderColumn[];
  /** The lowest **extended** total among complete tenders. See `lowestOf` for why not stated. */
  lowest: string | null;
} {
  const columns = returns.map((entry): TenderColumn => {
    const priced = entry.prices.filter((p) => items.includes(p.itemId));
    const extended = sum(priced.map((p) => (p.amount ? money(BigInt(p.amount)) : money(0n))));
    const stated = entry.statedSum === null ? null : money(BigInt(entry.statedSum));

    return {
      id: entry.id,
      tenderer: entry.tenderer,
      extended,
      stated,
      difference: stated === null ? null : money(extended - stated),
      unpriced: items.length - priced.filter((p) => p.rate !== null).length,
      againstBill: money(extended - billTotal),
    };
  });

  return { columns, lowest: lowestOf(columns) };
}

/**
 * The lowest tender — **by what the rates produce, and only among complete ones**.
 *
 * Two decisions, both of which change who wins.
 *
 * By extended rather than stated, because the stated sum is the one that may be wrong: awarding on
 * a figure whose own arithmetic has not been checked is the mistake the arithmetic column exists to
 * prevent, and it would be perverse for this platform to then rank on it.
 *
 * Among complete ones, because a tenderer who priced nine of twelve items will always be "lowest"
 * and never be cheapest. An incomplete tender is not a low tender, it is an unfinished one, and the
 * comparison says so rather than crowning it.
 */
function lowestOf(columns: readonly TenderColumn[]): string | null {
  const complete = columns.filter((c) => c.unpriced === 0);
  if (complete.length === 0) return null;

  return complete.reduce((low, c) => (c.extended < low.extended ? c : low)).id;
}
