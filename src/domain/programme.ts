/**
 * The construction programme's arithmetic – D2.5, and the base the cash flow (D1.7) phases over.
 *
 * ── Baseline and current are two facts, and both are kept ──────────────────────────────────
 *
 * A programme is signed once, and that signature is the **baseline**: the dates the contractor
 * was held to on the day the site was handed over. Progress is then a new fact every month – where
 * an activity actually stands as at a date – and never a correction of the baseline. Slippage is
 * the difference between the two, and it is the figure a principal agent reports, a recovery
 * programme answers, and an extension of time is argued against. A programme that let the
 * baseline move would have no slippage to report, which is exactly what a contractor behind
 * programme would prefer.
 *
 * ── Value on an activity is what turns a programme into a cash flow ────────────────────────
 *
 * Every activity may carry a value – a QS's share of the contract sum for that work. Those that
 * do not share what is left of the contract sum pro rata to their duration, which is the honest
 * default: a four-week activity is worth twice a two-week one until somebody says otherwise. The
 * phasing spreads each activity's value evenly over its calendar days, so a month's forecast is
 * the sum of the days of every activity that fall in it. Money is `bigint` minor units and the
 * remainder of every division is carried, so the months sum exactly to the contract sum (§5.2 –
 * one rounding point, and it is here).
 *
 * Nothing in this file knows about the database, a model or a screen.
 */

import { daysFrom, monthOf, nextMonth, plusDays } from "@/domain/date-reading";
import { money, sum, type Money } from "@/domain/money";

/** One activity as this file needs it: dates, whether it is a milestone, and what it is worth. */
export interface Activity {
  id: string;
  name: string;
  /** ISO dates. A milestone has start = finish. */
  start: string;
  finish: string;
  milestone: boolean;
  /** Minor units, or null where the activity's share is to be derived. */
  value: Money | null;
}

/** Where an activity stands as at a date. */
export interface Progress {
  activityId: string;
  asAt: string;
  /** The current dates – null where progress was recorded without moving them. */
  start: string | null;
  finish: string | null;
  /** 0–100. */
  percent: number;
}

/** Calendar days an activity occupies, inclusive. A milestone occupies one. */
export function durationDays(activity: Pick<Activity, "start" | "finish">): number {
  return Math.max(1, daysFrom(activity.start, activity.finish) + 1);
}

/** The programme's own span – earliest start to latest finish. */
export function span(activities: readonly Pick<Activity, "start" | "finish">[]): { start: string; finish: string } | null {
  if (activities.length === 0) return null;
  let start = activities[0].start;
  let finish = activities[0].finish;
  for (const a of activities) {
    if (a.start < start) start = a.start;
    if (a.finish > finish) finish = a.finish;
  }
  return { start, finish };
}

/**
 * The activity as it currently stands: the latest progress record's dates where it has them,
 * the baseline's where it does not.
 */
export function currentDates(activity: Activity, progress: Progress | null): { start: string; finish: string } {
  return {
    start: progress?.start ?? activity.start,
    finish: progress?.finish ?? activity.finish,
  };
}

/** Days the current finish is later than the baseline finish. Negative is early. */
export function slippageDays(activity: Activity, progress: Progress | null): number {
  return daysFrom(activity.finish, currentDates(activity, progress).finish);
}

/**
 * Where an activity *should* stand as at a date on the baseline, in whole per cent – the figure
 * progress is judged against. Elapsed days over duration, clamped.
 */
export function plannedPercent(activity: Pick<Activity, "start" | "finish">, asAt: string): number {
  if (asAt < activity.start) return 0;
  if (asAt >= activity.finish) return 100;
  const elapsed = daysFrom(activity.start, asAt) + 1;
  return Math.min(100, Math.max(0, Math.round((elapsed / durationDays(activity)) * 100)));
}

/**
 * Each activity's share of the contract sum – its own value where one was given, otherwise a
 * pro-rata share of the remainder by duration. Milestones carry no value unless given one.
 *
 * The remainder of the division goes to the last unvalued activity, so the shares sum exactly to
 * the contract sum. Where the given values already exceed the sum, the unvalued activities get
 * nothing and `over` says by how much – reported, never silently absorbed.
 */
export function shareValues(
  activities: readonly Activity[],
  contractSum: Money,
): { values: Map<string, Money>; over: Money } {
  const values = new Map<string, Money>();
  const given = sum(activities.flatMap((a) => (a.value === null ? [] : [a.value])));
  const remainder = contractSum - given;
  const unvalued = activities.filter((a) => a.value === null && !a.milestone);
  const totalDays = unvalued.reduce((n, a) => n + durationDays(a), 0);

  for (const a of activities) if (a.value !== null) values.set(a.id, a.value);
  for (const a of activities) if (a.value === null && a.milestone) values.set(a.id, money(0n));

  if (remainder <= 0n || totalDays === 0) {
    for (const a of unvalued) values.set(a.id, money(0n));
    return { values, over: remainder < 0n ? money(-remainder) : money(0n) };
  }

  let handed = 0n;
  unvalued.forEach((a, i) => {
    const share =
      i === unvalued.length - 1
        ? remainder - handed
        : (remainder * BigInt(durationDays(a))) / BigInt(totalDays);
    values.set(a.id, money(share));
    handed += share;
  });
  return { values, over: money(0n) };
}

/** One month of a phased programme: the first of the month, and what falls in it. */
export interface MonthPhase {
  month: string;
  amount: Money;
  cumulative: Money;
}

/**
 * The contract sum phased over the programme, month by month.
 *
 * Each activity's value is spread evenly over its calendar days and every day is assigned to its
 * month. The per-activity remainder goes to the activity's last month, so an activity sums to its
 * value and the months sum to the contract sum. Dates may be the baseline's or the current ones –
 * the caller decides which programme it is phasing.
 */
export function phaseByMonth(
  activities: readonly (Pick<Activity, "id" | "start" | "finish"> & { value: Money })[],
): MonthPhase[] {
  const byMonth = new Map<string, bigint>();

  for (const a of activities) {
    const days = durationDays(a);
    const perDay = a.value / BigInt(days);
    let placed = 0n;
    let month = monthOf(a.start);
    const last = monthOf(a.finish);

    for (;;) {
      const from = a.start > month ? a.start : month;
      const to = month === last ? a.finish : plusDays(nextMonth(month), -1);
      const inMonth = daysFrom(from, to) + 1;
      const amount = month === last ? a.value - placed : perDay * BigInt(inMonth);
      byMonth.set(month, (byMonth.get(month) ?? 0n) + amount);
      placed += amount;
      if (month === last) break;
      month = nextMonth(month);
    }
  }

  const months = [...byMonth.keys()].sort();
  let cumulative = 0n;
  return months.map((month) => {
    const amount = byMonth.get(month) ?? 0n;
    cumulative += amount;
    return { month, amount: money(amount), cumulative: money(cumulative) };
  });
}

/**
 * Overall progress, weighted by value – the figure that means something on a cost report. A
 * duration-weighted fallback where nothing carries value, and null where there is nothing at all.
 */
export function overallPercent(
  activities: readonly Activity[],
  progressOf: (id: string) => Progress | null,
  values: ReadonlyMap<string, Money>,
): number | null {
  const weighed = activities.filter((a) => !a.milestone);
  if (weighed.length === 0) return null;
  const weightOf = (a: Activity) => {
    const v = values.get(a.id);
    return v !== undefined && v > 0n ? Number(v) : 0;
  };
  const useValue = weighed.some((a) => weightOf(a) > 0);
  let total = 0;
  let done = 0;
  for (const a of weighed) {
    const w = useValue ? weightOf(a) : durationDays(a);
    total += w;
    done += (w * (progressOf(a.id)?.percent ?? 0)) / 100;
  }
  return total === 0 ? null : Math.round((done / total) * 100);
}
