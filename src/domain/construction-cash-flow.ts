/**
 * The construction cash flow – D1.7: the contract sum phased over the programme, against what has
 * been certified.
 *
 * ── Three lines, each from a different signed fact ─────────────────────────────────────────
 *
 *   forecast   the contract sum phased over the **baseline** programme – what was expected on the
 *              day the site was handed over, and what a funder was told.
 *   actual     what the valuations have certified, month by month – a certificate's gross value
 *              is cumulative, so a month's draw is the difference from the one before.
 *   expected   the remaining sum phased over the **current** programme from the last certificate
 *              on – the re-forecast a cost report carries. Behind the last certificate it is the
 *              actual; ahead of it, the current dates scaled to what is left to certify.
 *
 * Every figure is `bigint` minor units and the remainders are carried, so each line sums exactly:
 * forecast and expected to the contract sum, actual to the last certificate. No figure is
 * invented – where the programme is not signed there is no phasing and the caller says so.
 *
 * ── Why an S-curve is the fallback and not the method ──────────────────────────────────────
 *
 * `scurveWeights` in `cashflow.ts` phases a feasibility over a duration when nothing finer is
 * known, and it is right for a feasibility. On a job with a signed programme it is a guess beside
 * a fact: a programme that front-loads earthworks and back-loads finishes does not draw on a
 * textbook curve, and the difference is a funder's peak. So the curve is offered only where there
 * is no programme, and it says so on the line.
 */

import { daysFrom, monthOf, nextMonth, plusDays } from "@/domain/date-reading";
import { scurveWeights } from "@/domain/cashflow";
import { money, sum, type Money } from "@/domain/money";
import { currentDates, phaseByMonth, shareValues, type Activity, type Progress } from "@/domain/programme";

/** A signed valuation, as this needs it. */
export interface Certified {
  /** The certificate's own number, for the row. */
  number: string | null;
  /** The valuation period's end, ISO. */
  period: string;
  /** Cumulative gross value of work executed, materials on site included, minor units. */
  gross: Money;
}

export interface CashFlowMonth {
  month: string;
  forecast: Money;
  forecastCumulative: Money;
  /** Null for a month with no certificate. */
  actual: Money | null;
  actualCumulative: Money | null;
  expected: Money;
  expectedCumulative: Money;
  /** Actual minus forecast, cumulative – positive is ahead of the forecast draw. Null until certified. */
  variance: Money | null;
  certificate: string | null;
}

export interface CashFlow {
  months: CashFlowMonth[];
  contractSum: Money;
  certified: Money;
  remaining: Money;
  /** Which programme the forecast came from – said on the page, never implied. */
  basis: "programme" | "s-curve";
  /** The month of the last certificate, or null. */
  lastCertified: string | null;
  /** How far the expected finish has moved against the forecast, in months of draw. */
  peakMonth: string | null;
}

/** A month a certificate's period end falls in. */
const certMonth = (c: Certified) => monthOf(c.period);

/** Cumulative certificates into monthly draws. Two certificates in one month are one draw. */
function actualsByMonth(certificates: readonly Certified[]): Map<string, { draw: Money; cumulative: Money; number: string | null }> {
  const sorted = [...certificates].sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
  const out = new Map<string, { draw: Money; cumulative: Money; number: string | null }>();
  let previous = 0n;
  for (const c of sorted) {
    const month = certMonth(c);
    const draw = c.gross - previous;
    const already = out.get(month);
    out.set(month, {
      draw: money((already?.draw ?? 0n) + draw),
      cumulative: c.gross,
      number: c.number ?? already?.number ?? null,
    });
    previous = c.gross;
  }
  return out;
}

/** Every month from the first to the last, inclusive, in order. */
function monthsBetween(first: string, last: string): string[] {
  const months: string[] = [];
  for (let m = first; m <= last; m = nextMonth(m)) months.push(m);
  return months;
}

/**
 * Phase `total` over `weights` to the cent – the last month takes the remainder.
 */
function phaseByWeights(total: Money, months: readonly string[], weights: readonly number[]): Map<string, Money> {
  const out = new Map<string, Money>();
  const sumWeights = weights.reduce((a, b) => a + b, 0);
  let placed = 0n;
  months.forEach((m, i) => {
    const amount =
      i === months.length - 1 || sumWeights === 0
        ? i === months.length - 1
          ? total - placed
          : money(0n)
        : money(BigInt(Math.floor((Number(total) * weights[i]) / sumWeights)));
    out.set(m, money(amount));
    placed += amount;
  });
  return out;
}

export function constructionCashFlow(input: {
  contractSum: Money;
  /** The signed baseline, with each activity's latest progress. Empty where no programme is signed. */
  activities: readonly Activity[];
  progressOf: (id: string) => Progress | null;
  certificates: readonly Certified[];
  /** For the S-curve fallback: the contract's own span, where the programme is not signed. */
  contractSpan?: { start: string; finish: string } | null;
}): CashFlow | null {
  const { contractSum, activities, progressOf, certificates } = input;
  const actuals = actualsByMonth(certificates);
  const certified = money([...actuals.values()].reduce((max, a) => (a.cumulative > max ? a.cumulative : max), 0n));
  const remaining = money(contractSum - certified);
  const lastCertified = [...actuals.keys()].sort().at(-1) ?? null;

  let forecastByMonth: Map<string, Money>;
  let expectedByMonth: Map<string, Money>;
  let basis: CashFlow["basis"];

  if (activities.length > 0) {
    basis = "programme";
    const { values } = shareValues(activities, contractSum);
    const valued = activities.map((a) => ({ id: a.id, start: a.start, finish: a.finish, value: values.get(a.id) ?? money(0n) }));
    forecastByMonth = new Map(phaseByMonth(valued).map((m) => [m.month, m.amount]));

    /*
      The re-forecast: the remaining sum over what is left of the current programme. What is left
      is every activity's current dates from the day after the last certificate's month – an
      activity that finished before it contributes nothing more, whatever its dates say.
    */
    const from = lastCertified ? nextMonth(lastCertified) : null;
    const remainingWork = activities.flatMap((a) => {
      const current = currentDates(a, progressOf(a.id));
      if (from && current.finish < from) return [];
      const start = from && current.start < from ? from : current.start;
      return [{ id: a.id, start, finish: current.finish, value: values.get(a.id) ?? money(0n) }];
    });
    const currentPhase = phaseByMonth(remainingWork);
    const currentTotal = sum(currentPhase.map((m) => m.amount));
    // Scaled so the months ahead sum to what is left to certify, remainder to the last month.
    expectedByMonth = new Map();
    let placed = 0n;
    currentPhase.forEach((m, i) => {
      const amount =
        i === currentPhase.length - 1 ? remaining - placed : currentTotal === 0n ? money(0n) : money((remaining * m.amount) / currentTotal);
      expectedByMonth.set(m.month, money(amount));
      placed += amount;
    });
    if (currentPhase.length === 0 && remaining !== 0n && lastCertified) {
      // Nothing left on the programme but money left on the contract: it lands in the month after
      // the last certificate rather than vanishing, and the page says so.
      expectedByMonth.set(nextMonth(lastCertified), remaining);
    }
  } else if (input.contractSpan) {
    basis = "s-curve";
    const months = monthsBetween(monthOf(input.contractSpan.start), monthOf(input.contractSpan.finish));
    forecastByMonth = phaseByWeights(contractSum, months, scurveWeights(months.length));
    const ahead = lastCertified ? months.filter((m) => m > lastCertified) : months;
    expectedByMonth = ahead.length > 0 ? phaseByWeights(remaining, ahead, scurveWeights(ahead.length)) : new Map();
    if (ahead.length === 0 && remaining !== 0n && lastCertified) expectedByMonth.set(nextMonth(lastCertified), remaining);
  } else {
    return null;
  }

  const all = [...new Set([...forecastByMonth.keys(), ...expectedByMonth.keys(), ...actuals.keys()])].sort();
  if (all.length === 0) return null;
  const months = monthsBetween(all[0], all.at(-1)!);

  let fc = 0n;
  let ac = 0n;
  let ec = 0n;
  let seenActual = false;
  const rows: CashFlowMonth[] = months.map((month) => {
    const forecast = forecastByMonth.get(month) ?? money(0n);
    fc += forecast;
    const actual = actuals.get(month) ?? null;
    if (actual) {
      ac = actual.cumulative;
      seenActual = true;
    }
    // Behind the last certificate the expected line *is* the actual; ahead of it, the re-forecast.
    const expected = lastCertified && month <= lastCertified ? (actual?.draw ?? money(0n)) : (expectedByMonth.get(month) ?? money(0n));
    ec += expected;
    return {
      month,
      forecast,
      forecastCumulative: money(fc),
      actual: actual?.draw ?? null,
      actualCumulative: actual ? actual.cumulative : seenActual && lastCertified && month < lastCertified ? money(ac) : null,
      expected,
      expectedCumulative: money(ec),
      variance: actual ? money(actual.cumulative - fc) : null,
      certificate: actual?.number ?? null,
    };
  });

  const peak = rows.reduce<CashFlowMonth | null>((best, r) => (best === null || r.expected > best.expected ? r : best), null);

  return {
    months: rows,
    contractSum,
    certified,
    remaining,
    basis,
    lastCertified,
    peakMonth: peak?.month ?? null,
  };
}

/** The finish the expected line implies – the last month with money in it. */
export function expectedFinish(flow: CashFlow): string | null {
  const last = [...flow.months].reverse().find((m) => m.expected > 0n);
  return last ? plusDays(nextMonth(last.month), -1) : null;
}

/** Months between two finishes, signed. */
export const monthsApart = (a: string, b: string): number => Math.round(daysFrom(a, b) / 30.44);
