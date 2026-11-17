/**
 * Benchmarks — the practice's figures against what the market publishes (D1.1).
 *
 * ── Why this exists ────────────────────────────────────────────────────────────────────────
 *
 * The practice's own mapping of the QS scope says it twice: an order-of-magnitude estimate and an
 * elemental cost plan are each something "the QS will create and we will compare to market /
 * industry standard". The platform already held the market figures — 108 rates out of the AECOM
 * guide with the BER and CPAP escalation beside them — and had nowhere that compared anything to
 * them. The comparison was a thing a reader did in their head.
 *
 * ── Firm-level, like the rate library ──────────────────────────────────────────────────────
 *
 * For the same reason: a benchmark is not a fact about one job. What a practice wants to see is
 * which of its schemes sit outside the published band, all on one page, which is a question about
 * the portfolio rather than about any project in it.
 */

import { BenchmarksView, type BenchmarkedProject } from "@/components/benchmarks/benchmarks-view";
import { requireSession } from "@/lib/auth";
import { loadPortfolio } from "@/lib/dashboard";
import { and, desc, eq, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { assumptions } from "@/db/schema";
import { BENCHMARK_CATEGORIES_KEY, DEFAULT_BENCHMARK_CATEGORIES, readCategories } from "@/lib/benchmark-categories";
import { nameOf } from "@/lib/signers";
import { profileOf } from "@/domain/benchmark-stages";
import { benchmarkCandidates, chosenProjects, stageSources } from "@/lib/benchmark-stage-data";
import { StageBenchmarks } from "@/components/benchmarks/stage-benchmarks";

/** The practice's choice of categories in force today, or the meeting's default where none is set. */
async function categoriesInForce(): Promise<{ categories: readonly string[]; setBy: string | null; setOn: string | null }> {
  const [row] = await db
    .select({ value: assumptions.value, setBy: assumptions.setBy, effectiveFrom: assumptions.effectiveFrom })
    .from(assumptions)
    .where(and(eq(assumptions.key, BENCHMARK_CATEGORIES_KEY), lte(assumptions.effectiveFrom, new Date().toISOString().slice(0, 10))))
    .orderBy(desc(assumptions.effectiveFrom), desc(assumptions.createdAt))
    .limit(1);
  const chosen = readCategories(row?.value);
  return chosen && row
    ? { categories: chosen, setBy: await nameOf(row.setBy), setOn: row.effectiveFrom }
    : { categories: DEFAULT_BENCHMARK_CATEGORIES, setBy: null, setOn: null };
}

export default async function BenchmarksPage({ searchParams }: PageProps<"/benchmarks">) {
  await requireSession();
  const [portfolio, chosen, query, candidates] = await Promise.all([loadPortfolio(), categoriesInForce(), searchParams, benchmarkCandidates()]);
  // By stage of work: the kind of work in the URL, the projects the practice put in it, their bills and tenders.
  const profile = profileOf(typeof query.profile === "string" ? query.profile : null);
  const inBenchmark = (await chosenProjects(profile.key)).filter((id) => candidates.some((c) => c.id === id));
  const sources = await stageSources(profile, inBenchmark, new Map(candidates.map((c) => [c.id, c.name])));

  /*
    Why a project has no figure, in its own words.

    A blank cell would read as "nothing to say"; these are two different absences and they send a
    reader to two different places. Missing the cost means signing a cost plan or pricing the bill;
    missing the area means the unit count and average unit area a project's inputs carry.
  */
  const projects: BenchmarkedProject[] = portfolio.projects.map((p) => ({
    id: p.id,
    name: p.name,
    href: p.href,
    client: p.client,
    costPerM2: p.costPerM2,
    why: !p.total.ok
      ? "no signed cost yet — sign a cost plan or price the bill"
      : p.gfa === null
        ? "no area to spread it over — the unit count and average unit area are not both signed"
        : "the area signed is nought",
  }));

  // The year the comparison is made in, not the year the guide was printed. `escalationFactor`
  // leaves the band alone where the index has nothing to say about a year, so this is safe beyond
  // the forecast.
  return (
    <BenchmarksView
      projects={projects}
      year={new Date().getFullYear()}
      categories={chosen}
      showAll={query.all === "1"}
      refusedEmpty={query.categories === "none"}
      byStage={<StageBenchmarks profile={profile} candidates={candidates} chosen={inBenchmark} sources={sources} />}
    />
  );
}
