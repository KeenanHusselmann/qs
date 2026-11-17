"use server";

/**
 * Setting an assumption.
 *
 * ── Appended, never overwritten ────────────────────────────────────────────────────────────
 *
 * Every change is a row. The old value stays, because it is what the practice assumed when a
 * report was printed last month, and a settings table that overwrote would leave nothing to
 * explain why a figure that read one way in March reads another way in June.
 *
 * ── Bounded, because a decimal in the wrong place passes every gate ────────────────────────
 *
 * A prime rate of 1175% instead of 11,75% does not fail anywhere. It produces an affordability
 * ceiling near zero, every scheme fails Gate 1, and the report is confident and wrong. The bands
 * in `assumption-set.ts` are wide — this is not a judgement about which rate a practice should
 * use — but they catch the keystroke that would otherwise be caught by nobody.
 */

import { revalidatePath } from "next/cache";

import { db } from "@/db/client";
import { assumptions } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { ASSUMPTION_SPECS, fromInput, showAssumption } from "@/lib/assumption-set";

export interface SetOutcome {
  ok: boolean;
  reason?: string;
  /** What it now reads, for the confirmation. */
  shown?: string;
}

export async function setAssumption(form: FormData): Promise<SetOutcome> {
  const session = await requireSession();

  const key = String(form.get("key") ?? "");
  const spec = ASSUMPTION_SPECS.find((candidate) => candidate.key === key);
  if (!spec) return { ok: false, reason: "That is not a setting this platform holds." };

  const typed = String(form.get("value") ?? "").trim();
  if (typed.length === 0) return { ok: false, reason: `Enter a value for ${spec.label.toLowerCase()}.` };

  const value = fromInput(spec, typed);

  if (value === null) {
    const low = showAssumption(spec, spec.min);
    const high = showAssumption(spec, spec.max);
    return {
      ok: false,
      reason: `"${typed}" is outside the range this setting accepts — ${low} to ${high}. A decimal in the wrong place here fails no gate; it makes every answer confidently wrong.`,
    };
  }

  const effectiveFrom = String(form.get("effectiveFrom") ?? "").trim() || new Date().toISOString().slice(0, 10);
  const note = String(form.get("note") ?? "").trim();

  await db.insert(assumptions).values({
    key: spec.key,
    value: String(value),
    effectiveFrom,
    setBy: session.email,
    note: note.length > 0 ? note : null,
  });

  /*
    Every surface that reads a report, not just this page.

    The assumptions decide the affordability ceiling, the gates and the cash flow, so a change
    moves figures on the project overview, the report and the dashboard. Revalidating only the
    settings page would leave the rest showing the old answer until something else happened to
    refresh them — which is the worst version of this: two figures, both live, disagreeing.
  */
  revalidatePath("/settings");
  revalidatePath("/", "layout");

  return { ok: true, shown: showAssumption(spec, value) };
}
