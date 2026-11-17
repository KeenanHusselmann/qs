"use server";

/**
 * Setting which published categories the practice benchmarks against (November meeting).
 *
 * Appended as an assumption, never overwritten – the same rule `settings/actions.ts` gives: what the
 * practice compared against last quarter has to stay explainable after it changes its mind.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { db } from "@/db/client";
import { assumptions } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { BENCHMARK_CATEGORIES_KEY } from "@/lib/benchmark-categories";
import { BUILDING_RATE_CATEGORIES } from "@/lib/published-cost-data";
import { PROFILES } from "@/domain/benchmark-stages";
import { profileKey } from "@/lib/benchmark-stage-data";

export async function setBenchmarkCategories(form: FormData): Promise<void> {
  const session = await requireSession();
  const chosen = [...new Set(form.getAll("category").map(String))].filter((c) => BUILDING_RATE_CATEGORIES.includes(c));

  // Nothing ticked would benchmark against nothing; the page says so rather than saving it.
  if (chosen.length === 0) redirect("/benchmarks?categories=none");

  await db.insert(assumptions).values({
    key: BENCHMARK_CATEGORIES_KEY,
    value: JSON.stringify(chosen),
    effectiveFrom: new Date().toISOString().slice(0, 10),
    setBy: session.email,
    note: "Categories the practice benchmarks against",
  });

  revalidatePath("/benchmarks");
  redirect("/benchmarks");
}

/** Which projects a stage benchmark is built from – its boundary walls, its blocks of flats. */
export async function setBenchmarkProjects(form: FormData): Promise<void> {
  const session = await requireSession();
  const profile = String(form.get("profile") ?? "");
  if (!PROFILES.some((p) => p.key === profile)) redirect("/benchmarks");
  const ids = [...new Set(form.getAll("project").map(String))].filter((id) => /^[0-9a-f-]{36}$/i.test(id));

  await db.insert(assumptions).values({
    key: profileKey(profile),
    value: JSON.stringify(ids),
    effectiveFrom: new Date().toISOString().slice(0, 10),
    setBy: session.email,
    note: `Projects the ${profile} stage benchmark is built from`,
  });

  revalidatePath("/benchmarks");
  redirect(`/benchmarks?profile=${profile}#by-stage`);
}
