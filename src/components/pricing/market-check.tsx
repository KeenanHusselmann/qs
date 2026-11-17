/**
 * Rates against past tenders – on Pricing, under the grid, beside what the library could price.
 *
 * The practice's own question at pricing: "is this rate in line with what tenderers priced the same
 * item at on our other jobs?" `domain/market-check.ts` decides what counts as the same item and what
 * counts as out of line; this lists the items that are, furthest out first, each with the range it
 * was judged against. It changes nothing – a rate that is out of line may be right for this job, and
 * that is the QS's call.
 */

import { displayUnit } from "@/domain/money";
import { MARKET_FLAG, type MarketFinding } from "@/domain/market-check";

const R = (x: number) => `R ${x.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.round(Math.abs(x) * 100)}%`;

export function MarketCheck({ result }: { result: { findings: MarketFinding[]; pastRates: number } | null }) {
  return (
    <section data-region="market-check" className="overflow-hidden rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-0)]">
      <div className="flex flex-wrap items-baseline gap-2 border-b border-[var(--n-200)] bg-[var(--n-50)] px-4 py-2.5">
        <h2 className="t-base font-semibold text-[var(--n-800)]">Rates against past tenders</h2>
        {result && (
          <span className="t-sm text-[var(--n-500)]">
            {result.findings.length === 0 ? "Nothing out of line" : `${result.findings.length} out of line`}
          </span>
        )}
      </div>

      {!result ? (
        <p className="t-sm px-4 py-3 text-[var(--n-600)]">
          No past tenders to compare with yet. This check reads the tender returns on the practice&rsquo;s other projects with a signed bill.
        </p>
      ) : result.findings.length === 0 ? (
        <p className="t-sm px-4 py-3 text-[var(--n-600)]">
          Every rate with comparable items in past tenders is within {Math.round(MARKET_FLAG * 100)}% of what tenderers priced them at.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="t-xs border-b border-[var(--n-100)] text-left text-[var(--n-500)] uppercase">
                <th className="px-4 py-2 font-semibold">Item</th>
                <th className="px-4 py-2 text-right font-semibold">Our rate</th>
                <th className="px-4 py-2 text-right font-semibold">Past tenders</th>
                <th className="px-4 py-2 text-right font-semibold">Against the median</th>
              </tr>
            </thead>
            <tbody>
              {result.findings.map((f) => {
                const unit = `/${displayUnit(f.unit)}`;
                return (
                  <tr key={f.itemId} data-item={f.itemId} className="t-sm border-b border-[var(--n-50)] last:border-b-0">
                    <td className="px-4 py-2 text-[var(--n-800)]">
                      <span className="num mr-2 text-[var(--n-500)]">{f.ref}</span>
                      {f.description}
                    </td>
                    <td className="num whitespace-nowrap px-4 py-2 text-right font-medium">{R(f.ours)}{unit}</td>
                    <td className="num whitespace-nowrap px-4 py-2 text-right text-[var(--n-600)]">
                      {R(f.median)}{unit}
                      <span className="t-xs block">
                        {R(f.low)} – {R(f.high)} · {f.rates} rates, {f.projects} {f.projects === 1 ? "project" : "projects"}
                      </span>
                    </td>
                    <td className="num whitespace-nowrap px-4 py-2 text-right font-medium text-[var(--warn-700)]">{pct(f.variance)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="t-xs border-t border-[var(--n-100)] bg-[var(--n-25)] px-4 py-2 text-[var(--n-500)]">
        The same item means the same unit, the same specification numbers and closely matching words. Only tenderers&rsquo; rates count, never our own past estimates, and at least two are needed. Nothing here changes a rate.
      </p>
    </section>
  );
}
