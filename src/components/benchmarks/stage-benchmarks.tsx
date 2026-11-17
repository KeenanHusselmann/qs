/**
 * Benchmarks by stage of work – November meeting.
 *
 * "If they do excavation, what is a typical rate? If they do foundations, the walls, roofs,
 * electrical – what's the typical rate?" For each kind of work the practice builds, each stage's
 * share of the cost and its typical rate per unit, from the bills it has signed and the tenders
 * priced against them – and our estimate against the market, stage by stage.
 */

import Link from "next/link";

import { benchmarkStages, FIXED_SUMS, PROFILES, spread, SUNDRIES, type BenchmarkProfile } from "@/domain/benchmark-stages";
import { displayUnit } from "@/domain/money";
import type { StageSource } from "@/lib/benchmark-stage-data";
import { setBenchmarkProjects } from "@/app/(app)/benchmarks/actions";

const R = (x: number) => `R ${x.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")}%`;
const signed = (x: number) => `${x >= 0 ? "+" : "−"}${pct(Math.abs(x))}`;

export function StageBenchmarks({
  profile,
  candidates,
  chosen,
  sources,
}: {
  profile: BenchmarkProfile;
  candidates: readonly { id: string; name: string }[];
  chosen: readonly string[];
  sources: readonly StageSource[];
}) {
  const stages = benchmarkStages(profile, sources);
  const estimates = sources.filter((s) => s.kind === "estimate");
  const tenders = sources.filter((s) => s.kind === "tender");
  const ours = benchmarkStages(profile, estimates);
  const market = benchmarkStages(profile, tenders);
  const labelOf = new Map([...profile.stages.map((s) => [s.key, s.label] as const), [SUNDRIES, "Sundries"], [FIXED_SUMS.key, FIXED_SUMS.label]]);
  // The build sequence, every stage of it; sundries only where something fell there.
  const rows = [
    ...profile.sequence.map((key) => ({ key, label: labelOf.get(key) ?? key, data: stages.find((x) => x.stage === key) ?? null })),
    ...stages.filter((x) => x.stage === SUNDRIES).map((x) => ({ key: SUNDRIES, label: "Sundries – items no stage's words matched", data: x })),
  ];

  return (
    <section id="by-stage" data-region="stage-benchmarks" className="scroll-mt-4 overflow-hidden rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-0)]">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--n-200)] bg-[var(--n-50)] px-4 py-2.5">
        <h2 className="t-base font-semibold text-[var(--n-800)]">By stage of work</h2>
        <nav aria-label="Kind of work" className="flex gap-1">
          {PROFILES.map((p) => (
            <Link
              key={p.key}
              href={`/benchmarks?profile=${p.key}#by-stage`}
              aria-current={p.key === profile.key ? "page" : undefined}
              data-profile={p.key}
              className={`t-sm rounded-full px-2.5 py-0.5 ${p.key === profile.key ? "bg-[var(--a-500)] text-white" : "text-[var(--n-700)] hover:bg-[var(--n-100)]"}`}
            >
              {p.label}
            </Link>
          ))}
        </nav>
        <span className="t-sm ml-auto text-[var(--n-500)]">
          {estimates.length} signed {estimates.length === 1 ? "bill" : "bills"} · {tenders.length} {tenders.length === 1 ? "tender" : "tenders"}
        </span>
      </div>

      {/*
        Every stage of the work, in the order it is built – step 1 to the last – whether or not a bill
        has priced it yet. A stage with nothing in it is a gap the reader should see; dropping the row
        made a benchmark built from one boundary wall look like a complete breakdown.
      */}
      {sources.length === 0 && (
        <p className="t-sm border-b border-[var(--n-100)] px-4 py-3 text-[var(--n-600)]">
          No {profile.label.toLowerCase()} is in this benchmark yet. Choose its projects at the foot of this panel.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="t-xs border-b border-[var(--n-100)] text-left text-[var(--n-500)] uppercase">
              <th className="w-10 px-4 py-2 text-right font-semibold">#</th>
              <th className="px-4 py-2 font-semibold">Stage</th>
              <th className="px-4 py-2 text-right font-semibold">Share of the work</th>
              <th className="px-4 py-2 text-right font-semibold">Typical rate</th>
              <th className="px-4 py-2 text-right font-semibold">Range</th>
              <th className="px-4 py-2 text-right font-semibold">Our estimate</th>
              <th className="px-4 py-2 text-right font-semibold">Tenders (median)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, label, data }, index) => {
              const share = data ? spread(data.shares) : null;
              const rate = data ? spread(data.rates) : null;
              const est = data ? spread(ours.find((o) => o.stage === key && o.unit === data.unit)?.rates ?? []) : null;
              const mkt = data ? spread(market.find((m) => m.stage === key && m.unit === data.unit)?.rates ?? []) : null;
              const unit = data?.unit ? `/${displayUnit(data.unit)}` : "";
              return (
                <tr key={key} data-stage={key} data-priced={Boolean(data)} className="t-sm border-b border-[var(--n-50)] last:border-b-0">
                  <td className="num px-4 py-2 text-right text-[var(--n-500)]">{key === SUNDRIES ? "" : index + 1}</td>
                  <td className={`px-4 py-2 ${data ? "text-[var(--n-800)]" : "text-[var(--n-500)]"}`}>
                    {label}
                    {!data && sources.length > 0 && <span className="t-xs block text-[var(--n-400)]">Nothing priced in this stage yet</span>}
                  </td>
                  <td className="num whitespace-nowrap px-4 py-2 text-right">{share ? pct(share.median) : "–"}</td>
                  <td className="num whitespace-nowrap px-4 py-2 text-right font-medium text-[var(--n-800)]">{rate ? `${R(rate.median)}${unit}` : "–"}</td>
                  <td className="num whitespace-nowrap px-4 py-2 text-right text-[var(--n-600)]">{rate && rate.n > 1 ? `${R(rate.low)} – ${R(rate.high)} · ${rate.n} sources` : rate ? "one source" : "–"}</td>
                  <td className="num whitespace-nowrap px-4 py-2 text-right">{est ? `${R(est.median)}${unit}` : "–"}</td>
                  <td className="num whitespace-nowrap px-4 py-2 text-right">
                    {mkt ? `${R(mkt.median)}${unit}` : "–"}
                    {est && mkt && est.median > 0 && (
                      <span className={`t-xs block ${Math.abs(mkt.median / est.median - 1) > 0.15 ? "text-[var(--warn-700)]" : "text-[var(--n-500)]"}`}>
                        {signed(mkt.median / est.median - 1)} on ours
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-2 border-t border-[var(--n-100)] bg-[var(--n-25)] px-4 py-3">
        <p className="t-xs max-w-[100ch] text-[var(--n-500)]">
          Each stage&rsquo;s cost per its main unit (excavation per m&sup3;, walling per m&sup2;), from our signed bills and tenderers&rsquo; rates. Provisional and PC sums excluded. All stage figures are the practice&rsquo;s own.
        </p>

        {estimates.map((e) => (
          <details key={e.project.id} data-region="stage-items">
            <summary className="t-sm cursor-pointer text-[var(--n-700)]">What went into each stage – {e.project.name}</summary>
            <ul className="mt-1.5 flex flex-col gap-1">
              {Object.entries(e.itemsByStage ?? {}).map(([stage, items]) => (
                <li key={stage} className="t-xs text-[var(--n-600)]">
                  <span className="font-semibold text-[var(--n-800)]">{labelOf.get(stage) ?? stage}:</span> {items.join("; ")}
                </li>
              ))}
            </ul>
          </details>
        ))}

        <details data-region="stage-projects" open={chosen.length === 0}>
          <summary className="t-sm cursor-pointer text-[var(--n-700)]">Choose the projects this {profile.label.toLowerCase()} benchmark is built from</summary>
          {candidates.length === 0 ? (
            <p className="t-sm mt-2 text-[var(--n-600)]">No project has a signed bill yet. A benchmark needs one – it is where the stages and their quantities come from.</p>
          ) : (
            <form action={setBenchmarkProjects} className="mt-2 flex flex-col gap-2">
              <input type="hidden" name="profile" value={profile.key} />
              <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
                {candidates.map((p) => (
                  <label key={p.id} className="t-sm flex items-center gap-2 text-[var(--n-700)]">
                    <input type="checkbox" name="project" value={p.id} defaultChecked={chosen.includes(p.id)} className="accent-[var(--a-500)]" />
                    {p.name}
                  </label>
                ))}
              </div>
              <button type="submit" data-action="save-stage-projects" className="t-sm h-8 w-fit rounded-[var(--r-md)] bg-[var(--a-500)] px-3 font-medium text-white hover:bg-[var(--a-600)]">
                Build the benchmark from these
              </button>
            </form>
          )}
        </details>
      </div>
    </section>
  );
}
