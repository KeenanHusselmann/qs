import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import Link from "next/link";

import { bandsFor, compare, type Comparison } from "@/domain/benchmark";
import { formatMoney, money } from "@/domain/money";
import { BUILDING_RATE_CATEGORIES, BUILDING_RATES, displayBand, PUBLISHED_COST_DATE, PUBLISHED_COST_SOURCE, PUBLISHED_COST_URL } from "@/lib/published-cost-data";
import { setBenchmarkCategories } from "@/app/(app)/benchmarks/actions";

export interface BenchmarkedProject {
  id: string;
  name: string;
  href: string;
  client: string | null;
  /** Cents per m² of GFA. Null where the project has not signed enough to have one. */
  costPerM2: bigint | null;
  /** What is missing, where there is no figure — said, never left blank. */
  why: string;
}

const rands = (cents: number | bigint) => formatMoney(money(BigInt(cents)), { symbol: "R" });

/**
 * The practice's projects against what the market publishes — D1.1.
 *
 * ── Why the nearest band and not a verdict ─────────────────────────────────────────────────
 *
 * The platform does not know what kind of building a project is. A residential estate with a
 * clubhouse, retail and carports is three of the guide's lines at once, and picking one for the
 * reader would be the platform having an opinion about the design — wrong exactly where it
 * matters. So each project is shown against the bands its figure actually falls in, and where it
 * falls in none, against the one it misses by least. A quantity surveyor decides which line the
 * scheme belongs on.
 */
export function BenchmarksView({
  projects,
  year,
  categories,
  showAll = false,
  refusedEmpty = false,
  byStage,
}: {
  projects: readonly BenchmarkedProject[];
  year: number;
  /** The categories the practice benchmarks against, and who chose them (null: the default). */
  categories: { categories: readonly string[]; setBy: string | null; setOn: string | null };
  /** `?all=1` – see the whole guide for once, without changing the practice's choice. */
  showAll?: boolean;
  /** The last save ticked nothing, and was refused. */
  refusedEmpty?: boolean;
  /** Benchmarks by stage of work (`stage-benchmarks.tsx`), rendered by the page and placed here. */
  byStage?: ReactNode;
}) {
  const withFigures = projects.filter((p) => p.costPerM2 !== null);
  /*
    Only the categories the practice prices (November meeting). A block of flats offered an airport
    terminal as its nearest band is noise that hides the comparison that matters.
  */
  const relevant = showAll ? BUILDING_RATES : BUILDING_RATES.filter((r) => categories.categories.includes(r.category));

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-6 px-8 py-6">
      <header>
        <h1 className="t-xl text-[var(--n-800)]">Benchmarks</h1>
        <p className="t-md mt-1 max-w-[80ch] text-[var(--n-600)]">
          The practice&rsquo;s own figures against published bands, escalated to {year} on the guide&rsquo;s tender price index.
        </p>
      </header>

      {/* ── By stage of work first: what the practice actually prices, broken down ───────── */}
      {byStage}

      {/* ── Which categories apply ──────────────────────────────────────────────────────── */}
      <section data-region="benchmark-categories" className="rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-0)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="t-sm font-semibold text-[var(--n-800)]">
            {showAll ? `Showing every category in the guide (${BUILDING_RATE_CATEGORIES.length})` : `Compared against ${categories.categories.length} of ${BUILDING_RATE_CATEGORIES.length} categories`}
          </span>
          {!showAll && (
            <span className="flex flex-wrap gap-1.5">
              {categories.categories.map((c) => (
                <span key={c} data-category={c} className="t-xs rounded-full bg-[var(--a-50)] px-2 py-0.5 text-[var(--a-700)]">{c}</span>
              ))}
            </span>
          )}
          <Link href={showAll ? "/benchmarks" : "/benchmarks?all=1"} className="t-sm ml-auto text-[var(--a-700)] underline underline-offset-2">
            {showAll ? "Back to the practice's categories" : "Show every category"}
          </Link>
        </div>
        <p className="t-xs mt-1 text-[var(--n-500)]">
          {categories.setBy ? `Chosen by ${categories.setBy} from ${categories.setOn}.` : "The default from the November meeting – residential work, and the offices, retail and parking that come with it. Not airports, not private dwellings."}
        </p>
        {refusedEmpty && (
          <p role="alert" className="t-sm mt-2 text-[var(--err-700)]">Nothing was saved: with no category ticked there would be nothing to compare against.</p>
        )}
        <details className="mt-2">
          <summary className="t-sm cursor-pointer text-[var(--n-700)]">Change the categories the practice benchmarks against</summary>
          <form action={setBenchmarkCategories} className="mt-2 flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
              {BUILDING_RATE_CATEGORIES.map((c) => (
                <label key={c} className="t-sm flex items-center gap-2 text-[var(--n-700)]">
                  <input type="checkbox" name="category" value={c} defaultChecked={categories.categories.includes(c)} className="accent-[var(--a-500)]" />
                  {c}
                </label>
              ))}
            </div>
            <button type="submit" data-action="save-benchmark-categories" className="t-sm h-8 w-fit rounded-[var(--r-md)] bg-[var(--a-500)] px-3 font-medium text-white hover:bg-[var(--a-600)]">
              Save for the practice
            </button>
          </form>
        </details>
      </section>

      {/* ── The practice's projects ─────────────────────────────────────────────────────── */}
      <section
        data-region="benchmarked-projects"
        className="overflow-hidden rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-0)]"
      >
        <div className="flex items-center gap-2 border-b border-[var(--n-200)] bg-[var(--n-50)] px-4 py-2.5">
          <h2 className="t-base font-semibold text-[var(--n-800)]">Cost per m&sup2;, against the published bands</h2>
          <span className="t-sm num text-[var(--n-500)]">
            {withFigures.length} of {projects.length}
          </span>
        </div>

        {withFigures.length === 0 ? (
          /* §7.5 — an empty surface says what would fill it, and what its absence costs. */
          <p className="t-sm px-4 py-6 text-[var(--n-600)]">
            No project has a cost per m&sup2; yet. One appears once a project signs a cost and its area.
          </p>
        ) : (
          <ul className="flex flex-col">
            {withFigures.map((project) => {
              const rate = Number(project.costPerM2);
              const offered = bandsFor(rate, relevant, year, "m²");
              const within = offered.filter((o) => o.comparison.standing === "within");
              const nearest = offered[0];

              return (
                <li key={project.id} data-benchmark={project.name} className="border-b border-[var(--n-100)] px-4 py-3 last:border-b-0">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <Link href={project.href} className="t-base font-medium text-[var(--a-700)] underline decoration-[var(--n-300)] underline-offset-2 hover:decoration-[var(--a-700)]">
                      {project.name}
                    </Link>
                    {project.client && <span className="t-sm text-[var(--n-500)]">{project.client}</span>}
                    <span className="t-base num ml-auto font-semibold text-[var(--n-800)]">
                      {rands(rate)}/m&sup2;
                    </span>
                  </div>

                  {within.length > 0 ? (
                    <p className="t-sm mt-1 text-[var(--n-700)]">
                      Inside{" "}
                      <span className="font-medium">
                        {within.length} published {within.length === 1 ? "band" : "bands"}
                      </span>{" "}
                      &ndash; {within.slice(0, 3).map((o) => o.rate.item).join("; ")}
                      {within.length > 3 ? `; and ${within.length - 3} more` : ""}.
                    </p>
                  ) : nearest ? (
                    <p className="t-sm mt-1 text-[var(--n-700)]">
                      Inside no published band. Nearest is{" "}
                      <span className="font-medium">{nearest.rate.item}</span> at{" "}
                      {rands(nearest.comparison.low)} &ndash; {rands(nearest.comparison.high)},{" "}
                      <Standing c={nearest.comparison} />.
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {projects.length > withFigures.length && (
          <div className="border-t border-[var(--n-100)] bg-[var(--n-25)] px-4 py-2.5">
            <p className="t-xs text-[var(--n-500)]">
              {projects.length - withFigures.length} not compared, and why:{" "}
              {projects
                .filter((p) => p.costPerM2 === null)
                .slice(0, 4)
                .map((p) => `${p.name} — ${p.why}`)
                .join("; ")}
              {projects.length - withFigures.length > 4 ? "; …" : ""}
            </p>
          </div>
        )}
      </section>

      {/* ── The bands themselves ────────────────────────────────────────────────────────── */}
      <section data-region="published-bands" className="overflow-hidden rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-0)]">
        <div className="flex items-center gap-2 border-b border-[var(--n-200)] bg-[var(--n-50)] px-4 py-2.5">
          <h2 className="t-base font-semibold text-[var(--n-800)]">The published bands, escalated to {year}</h2>
        </div>
        <table className="w-full table-fixed">
          <thead>
            <tr className="border-b border-[var(--n-200)] text-left">
              <th className="t-xs w-[22%] px-4 py-2 font-semibold tracking-[0.06em] text-[var(--n-500)] uppercase">Category</th>
              <th className="t-xs w-[42%] px-4 py-2 font-semibold tracking-[0.06em] text-[var(--n-500)] uppercase">Item</th>
              <th className="t-xs w-[18%] px-4 py-2 text-right font-semibold tracking-[0.06em] text-[var(--n-500)] uppercase">As published</th>
              <th className="t-xs w-[18%] px-4 py-2 text-right font-semibold tracking-[0.06em] text-[var(--n-500)] uppercase">At {year}</th>
            </tr>
          </thead>
          <tbody>
            {relevant.filter((r) => r.unit === "m²").map((r) => {
              const c = compare(r.low, r, year);
              return (
                <tr key={`${r.category}-${r.item}`} className="border-b border-[var(--n-100)] last:border-b-0">
                  <td className="t-sm px-4 py-2 text-[var(--n-600)]">{r.category}</td>
                  <td className="t-sm px-4 py-2 text-[var(--n-800)]">{r.item}</td>
                  <td className="t-sm num px-4 py-2 text-right text-[var(--n-600)]">{displayBand(r)}</td>
                  <td className="t-sm num px-4 py-2 text-right font-medium text-[var(--n-800)]">
                    {c.low === c.high ? rands(c.low) : `${rands(c.low)} – ${rands(c.high)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <p className="t-sm max-w-[80ch] text-[var(--n-500)]">
        Rates from the{" "}
        <a href={PUBLISHED_COST_URL} target="_blank" rel="noopener noreferrer" className="text-[var(--a-700)] underline underline-offset-2">
          {PUBLISHED_COST_SOURCE}
        </a>
        , current at {PUBLISHED_COST_DATE}. Approximate whole-building rates – not bill rates.
      </p>
    </div>
  );
}

function Standing({ c }: { c: Comparison }) {
  if (c.standing === "within") {
    return (
      <span className="inline-flex items-center gap-1 text-[var(--ok-700)]">
        <Minus aria-hidden size={11} strokeWidth={2.5} /> within
      </span>
    );
  }
  const under = c.standing === "below";
  return (
    <span className={`inline-flex items-center gap-1 font-medium ${under ? "text-[var(--warn-700)]" : "text-[var(--err-700)]"}`}>
      {under ? <ArrowDown aria-hidden size={11} strokeWidth={2.5} /> : <ArrowUp aria-hidden size={11} strokeWidth={2.5} />}
      {rands(c.outside)}/m&sup2; {under ? "under it" : "over it"}
      {c.share !== null ? ` (${(c.share / 100).toFixed(1).replace(".", ",")}%)` : ""}
      {c.forecast ? ", on the guide's forecast" : ""}
    </span>
  );
}
