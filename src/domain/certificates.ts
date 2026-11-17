/**
 * The arithmetic on a payment certificate and a certificate of practical completion.
 *
 * ── The stack a certificate prints, in the order it is added up ────────────────────────────
 *
 *     value of work executed
 *   + approved variations          ("beyond the contract bill" – added, not a subset)
 *   + dayworks
 *   + materials on site
 *   = gross valuation
 *   − retention                    (rate × gross, never more than the contract's limit)
 *   = net valuation
 *   − previously certified
 *   = amount due, excluding VAT
 *   + VAT at 15%
 *   = amount due
 *
 * Money is `bigint` minor units; the two multiplications – retention and VAT – each round once,
 * half away from zero, which is what a QS's calculator and Excel's ROUND do. A negative amount due
 * is printed as it is: an over-certification is corrected on the next certificate, never hidden.
 *
 * ── Practical completion releases half the retention ───────────────────────────────────────
 *
 * JBCC Principal Building Agreement: retention held is reduced by half at practical completion and
 * the balance released at final completion. A contract that says otherwise is typed in as the
 * release rate; the default is fifty per cent.
 */

import { money, sum, type Money } from "@/domain/money";

/** Percent is the scaled fraction `money.ts` holds: 10% is 1 000 at PERCENT_SCALE 4. */
const SCALE = 10_000n;

/** South African VAT, 15% since 1 April 2018. */
export const VAT_RATE = 1_500n;

const roundDiv = (numerator: bigint, denominator: bigint): bigint => {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (n * 2n + d) / (d * 2n);
  return negative ? -q : q;
};

/** The parts of a valuation, as signed. Null is "not stated", which contributes nothing. */
export interface ValuationParts {
  workExecuted: Money;
  variations: Money | null;
  dayworks: Money | null;
  materialsOnSite: Money | null;
}

/** The gross valuation: the one definition, used by the certificate and the cash flow alike. */
export function grossValuation(parts: ValuationParts): Money {
  return sum([parts.workExecuted, parts.variations ?? money(0n), parts.dayworks ?? money(0n), parts.materialsOnSite ?? money(0n)]);
}

export interface PaymentCertificate {
  gross: Money;
  /** Retention at the rate, before the limit. */
  retentionAtRate: Money;
  /** What is actually held – the lesser of the rate and the limit. */
  retention: Money;
  /** True where the limit bit – printed on the certificate, because it changes every month after. */
  limited: boolean;
  net: Money;
  previouslyCertified: Money;
  dueExVat: Money;
  vat: Money;
  due: Money;
}

export function paymentCertificate(input: {
  parts: ValuationParts;
  /** Scaled fraction – 10% is 1 000. */
  retentionRate: bigint;
  /** The most retention may ever be, in minor units, where the contract sets one. */
  retentionLimit: Money | null;
  previouslyCertified: Money;
  vatRate?: bigint;
}): PaymentCertificate {
  const gross = grossValuation(input.parts);
  const retentionAtRate = money(roundDiv(gross * input.retentionRate, SCALE));
  const limited = input.retentionLimit !== null && retentionAtRate > input.retentionLimit;
  const retention = limited ? input.retentionLimit! : retentionAtRate;
  const net = money(gross - retention);
  const dueExVat = money(net - input.previouslyCertified);
  const vat = money(roundDiv(dueExVat * (input.vatRate ?? VAT_RATE), SCALE));
  return { gross, retentionAtRate, retention, limited, net, previouslyCertified: input.previouslyCertified, dueExVat, vat, due: money(dueExVat + vat) };
}

export interface CompletionRelease {
  retentionHeld: Money;
  released: Money;
  stillHeld: Money;
}

/** What practical completion releases from the retention held on the last certificate. */
export function retentionReleasedAtCompletion(retentionHeld: Money, releaseRate: bigint = 5_000n): CompletionRelease {
  const released = money(roundDiv(retentionHeld * releaseRate, SCALE));
  return { retentionHeld, released, stillHeld: money(retentionHeld - released) };
}
