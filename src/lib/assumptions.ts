/**
 * Reading the practice's assumptions, and the history behind each one.
 *
 * ── The current value is the newest effective row ──────────────────────────────────────────
 *
 * Not the newest row. A practice can set a rate today that takes effect at the start of next
 * month, and a report printed this afternoon must still use the one in force this afternoon.
 * Ordering by `effective_from` and breaking ties on `created_at` is what makes that true — the tie
 * matters because two changes on the same day are ordinary, and the later keystroke is the one
 * that was meant.
 *
 * ── Defaults are a fallback, not a seed ────────────────────────────────────────────────────
 *
 * An unset assumption falls back to the platform's own figure rather than being written into the
 * table on first read. Seeding would make every default look like a decision the practice took,
 * and the settings page's whole job is to show which figures are theirs and which are still ours.
 */

import { desc, lte, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { assumptions } from "@/db/schema";
import {
  ASSUMPTION_SPECS,
  DEFAULT_ASSUMPTIONS,
  type AssumptionKey,
  type Assumptions,
} from "@/lib/assumption-set";

export interface AssumptionInForce {
  key: AssumptionKey;
  value: number;
  /** True where nobody has set it and the platform's own figure is standing in. */
  isDefault: boolean;
  effectiveFrom: string | null;
  setBy: string | null;
  note: string | null;
}

/** Today, as the date column holds it. */
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Every assumption, with what is in force and where it came from.
 *
 * One query for the whole table rather than ten. A practice's settings are a handful of rows and
 * ten round trips to answer one page would be the wrong shape however small each one is.
 */
export async function assumptionsInForce(): Promise<AssumptionInForce[]> {
  const rows = await db
    .select()
    .from(assumptions)
    .where(lte(assumptions.effectiveFrom, today()))
    .orderBy(desc(assumptions.effectiveFrom), desc(assumptions.createdAt));

  const newest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (!newest.has(row.key)) newest.set(row.key, row);

  return ASSUMPTION_SPECS.map((spec) => {
    const row = newest.get(spec.key);
    const parsed = row ? Number(row.value) : Number.NaN;

    /*
      A stored value that will not parse falls back to the default rather than poisoning a report.

      It should not happen — the form validates before writing — but the alternative to falling
      back is NaN reaching the affordability envelope, and a ceiling of NaN would render as
      "R NaN" on a cover rather than failing anywhere anybody would notice.
    */
    if (!row || !Number.isFinite(parsed)) {
      return {
        key: spec.key,
        value: DEFAULT_ASSUMPTIONS[spec.key],
        isDefault: true,
        effectiveFrom: null,
        setBy: null,
        note: null,
      };
    }

    return {
      key: spec.key,
      value: parsed,
      isDefault: false,
      effectiveFrom: row.effectiveFrom,
      setBy: row.setBy,
      note: row.note,
    };
  });
}

/** The set, as the engines take it. */
export async function currentAssumptions(): Promise<Assumptions> {
  const inForce = await assumptionsInForce();

  return inForce.reduce<Assumptions>(
    (set, row) => ({ ...set, [row.key]: row.value }),
    { ...DEFAULT_ASSUMPTIONS },
  );
}

/**
 * What a key has been set to over time, newest first.
 *
 * Including rows dated in the future, which the settings page shows separately — a change somebody
 * scheduled is a thing they need to be able to see and reverse before it lands.
 */
export async function historyOf(key: AssumptionKey) {
  return db
    .select({
      value: assumptions.value,
      effectiveFrom: assumptions.effectiveFrom,
      setBy: assumptions.setBy,
      note: assumptions.note,
    })
    .from(assumptions)
    .where(sql`${assumptions.key} = ${key}`)
    .orderBy(desc(assumptions.effectiveFrom), desc(assumptions.createdAt))
    .limit(8);
}
