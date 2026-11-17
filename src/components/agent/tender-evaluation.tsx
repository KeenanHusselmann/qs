/**
 * The tenders against our estimate, and between each other – November meeting.
 *
 * Below the row-by-row comparison: each tenderer's rates against the QS's own priced bill (like for
 * like, over the items both priced), the lines more than a quarter out, and the collusion indicators.
 * Everything here is derived on every render from the signed bill and the returns (§6.5); nothing is
 * stored, so a corrected rate changes the finding at once.
 */

import { FileSpreadsheet, ShieldAlert, ShieldCheck } from "lucide-react";

import { againstEstimate, collusionIndicators, sameScopeTotals, VARIANCE_FLAG } from "@/domain/tender-evaluation";
import type { BillRow } from "@/lib/agent/bill";
import type { TenderReturn } from "@/lib/agent/tender";
import { evaluationInputs } from "@/lib/tender-evaluation";

const pct = (v: number | null) => (v === null ? "–" : `${v >= 0 ? "+" : "−"}${(Math.abs(v) * 100).toFixed(1).replace(".", ",")}%`);
const R = (x: number) => `R ${x.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function TenderEvaluation({ projectId, rows, returns }: { projectId: string; rows: readonly BillRow[]; returns: readonly TenderReturn[] }) {
  if (returns.length === 0) return null;
  const { items, tenders } = evaluationInputs(rows, returns);
  const { lines, tenderers } = againstEstimate(items, tenders);
  const { indicators, groups } = collusionIndicators(items, tenders);
  const scope = sameScopeTotals(items, tenders);
  const misleading = scope.length > 1 && scope[0]!.headlineRank !== 1 ? scope.find((r) => r.headlineRank === 1) : undefined;
  const flagged = lines.filter((l) => l.cells.some((c) => c.flag === "high" || c.flag === "low"));
  const pairs = (tenders.length * (tenders.length - 1)) / 2;

  return (
    <section data-region="tender-evaluation" className="mt-6 rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-0)]">
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--n-100)] px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="t-base font-semibold text-[var(--n-800)]">Against our estimate, and between tenderers</h2>
          <p className="t-sm mt-0.5 text-[var(--n-500)]">
            Each tender read line by line against the rates in the signed bill, and every pair of tenderers checked for rates that are a constant multiple of each other.
          </p>
        </div>
        <a
          href={`/projects/${projectId}/report/pdf?document=tender-evaluation`}
          data-action="tender-evaluation-workbook"
          className="t-sm inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--n-300)] bg-[var(--n-0)] px-2.5 font-medium text-[var(--n-700)] hover:bg-[var(--n-50)]"
        >
          <FileSpreadsheet aria-hidden size={14} /> Evaluation workbook
        </a>
      </header>

      <table data-region="against-estimate" className="w-full">
        <thead>
          <tr className="t-xs border-b border-[var(--n-100)] text-left text-[var(--n-500)] uppercase">
            <th className="px-4 py-2 font-semibold">Tenderer</th>
            <th className="px-4 py-2 text-right font-semibold">Their rates</th>
            <th className="px-4 py-2 text-right font-semibold">Our estimate</th>
            <th className="px-4 py-2 text-right font-semibold">Against it</th>
            <th className="px-4 py-2 text-right font-semibold">Lines over / under {Math.round(VARIANCE_FLAG * 100)}%</th>
            <th className="px-4 py-2 text-right font-semibold">Unpriced</th>
          </tr>
        </thead>
        <tbody>
          {tenderers.map((t) => (
            <tr key={t.id} data-evaluated={t.tenderer} className="t-sm border-b border-[var(--n-50)] last:border-b-0">
              <td className="px-4 py-2 font-medium text-[var(--n-800)]">{t.tenderer}</td>
              <td className="num px-4 py-2 text-right">{R(t.extended)}</td>
              <td className="num px-4 py-2 text-right text-[var(--n-600)]">{R(t.estimate)}</td>
              <td className={`num px-4 py-2 text-right font-medium ${t.variance !== null && Math.abs(t.variance) > 0.1 ? "text-[var(--warn-700)]" : "text-[var(--n-800)]"}`}>{pct(t.variance)}</td>
              <td className="num px-4 py-2 text-right">{t.high} / {t.low}</td>
              <td className="num px-4 py-2 text-right">{t.unpriced}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="t-xs border-t border-[var(--n-100)] px-4 py-2 text-[var(--n-500)]">
        Like for like: each total covers only the items both the tenderer and the estimate priced.
      </p>

      {/*
        The comparison an award turns on: every tender over the whole bill, its gaps priced at what the
        others charged. The filled amount is shown, never hidden in the total – it is our assumption
        about their price, not their price.
      */}
      <div data-region="same-scope" className="border-t border-[var(--n-200)]">
        <div className="px-4 pt-3">
          <h3 className="t-sm font-semibold text-[var(--n-800)]">Compared on the same scope</h3>
          {misleading ? (
            <p data-region="rank-changes" className="t-sm mt-1 font-medium text-[var(--warn-700)]">
              {misleading.tenderer} is lowest on its own prices, but {scope[0]!.tenderer} is lowest once every tender covers the whole bill.
            </p>
          ) : (
            <p className="t-sm mt-1 text-[var(--n-600)]">Pricing the gaps does not change who is lowest.</p>
          )}
        </div>
        <table className="mt-2 w-full">
          <thead>
            <tr className="t-xs border-b border-[var(--n-100)] text-left text-[var(--n-500)] uppercase">
              <th className="px-4 py-2 font-semibold">Rank</th>
              <th className="px-4 py-2 font-semibold">Tenderer</th>
              <th className="px-4 py-2 text-right font-semibold">Their prices</th>
              <th className="px-4 py-2 text-right font-semibold">Gaps priced</th>
              <th className="px-4 py-2 text-right font-semibold">Same-scope total</th>
            </tr>
          </thead>
          <tbody>
            {scope.map((r) => (
              <tr key={r.id} data-scope={r.tenderer} className="t-sm border-b border-[var(--n-50)] last:border-b-0">
                <td className="num px-4 py-2 text-[var(--n-600)]">
                  {r.rank}
                  {r.rank !== r.headlineRank && <span className="t-xs ml-1 text-[var(--warn-700)]">(was {r.headlineRank})</span>}
                </td>
                <td className="px-4 py-2 font-medium text-[var(--n-800)]">{r.tenderer}</td>
                <td className="num px-4 py-2 text-right">{R(r.headline)}</td>
                <td className="num px-4 py-2 text-right text-[var(--n-600)]">
                  {r.filledItems === 0 ? "–" : `${R(r.filled)} · ${r.filledItems} ${r.filledItems === 1 ? "item" : "items"}`}
                </td>
                <td className="num px-4 py-2 text-right font-medium text-[var(--n-800)]">{R(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="t-xs border-t border-[var(--n-100)] px-4 py-2 text-[var(--n-500)]">
          Their rates × our quantities. Gaps are priced at the other tenderers&rsquo; median (or our estimate) and shown separately.
          {scope.some((r) => r.unfillable > 0) && " Items nobody priced and the estimate has no rate for are left out of every total."}
        </p>
      </div>

      <div data-region="collusion" className="border-t border-[var(--n-200)] px-4 py-3">
        {indicators.length === 0 ? (
          <p className="t-sm inline-flex items-start gap-1.5 text-[var(--n-700)]">
            <ShieldCheck aria-hidden size={15} className="mt-0.5 shrink-0 text-[var(--ok-700)]" />
            No pair of tenderers prices at a constant multiple of the other – {pairs} {pairs === 1 ? "pair" : "pairs"} checked over {items.length} items.
          </p>
        ) : (
          <>
            <h3 className="t-sm inline-flex items-center gap-1.5 font-semibold text-[var(--err-700)]">
              <ShieldAlert aria-hidden size={15} /> Collusion indicators
            </h3>
            <ul className="mt-1.5 flex flex-col gap-1">
              {indicators.map((i) => (
                <li key={`${i.base.id}-${i.other.id}`} data-indicator={i.kind} className="t-sm text-[var(--n-800)]">
                  {i.kind === "identical"
                    ? `${i.other.tenderer} and ${i.base.tenderer} quote identical rates`
                    : `${i.other.tenderer}'s rates are ${i.base.tenderer}'s plus ${pct(i.factor - 1).slice(1)}`}{" "}
                  <span className="text-[var(--n-500)]">– on {i.matching} of {i.compared} items compared</span>
                </li>
              ))}
            </ul>
            {groups.map((g) => (
              <p key={g.join()} className="t-sm mt-1.5 text-[var(--n-700)]">
                Priced from one source: <strong>{g.join(", ")}</strong>.
              </p>
            ))}
            <p className="t-xs mt-2 max-w-[90ch] text-[var(--n-500)]">
              An indicator, not a finding – one supplier&rsquo;s list can explain it. Investigate before acting: collusive tendering is prohibited (Competition Act s4(1)(b)(iii)).
            </p>
          </>
        )}
      </div>

      {flagged.length > 0 && (
        <details data-region="flagged-lines" className="border-t border-[var(--n-200)]">
          <summary className="t-sm cursor-pointer px-4 py-2.5 font-medium text-[var(--n-700)]">
            {flagged.length} {flagged.length === 1 ? "line" : "lines"} priced more than {Math.round(VARIANCE_FLAG * 100)}% away from the estimate by at least one tenderer
          </summary>
          <table className="w-full">
            <tbody>
              {flagged.map(({ item, cells }) => (
                <tr key={item.id} className="t-sm border-t border-[var(--n-50)]">
                  <td className="w-16 px-4 py-1.5 text-[var(--n-500)]">{item.ref}</td>
                  <td className="px-2 py-1.5 text-[var(--n-800)]">{item.description}</td>
                  <td className="px-4 py-1.5 text-right">
                    {cells
                      .filter((c) => c.flag === "high" || c.flag === "low")
                      .map((c) => `${tenders.find((t) => t.id === c.tendererId)?.tenderer} ${pct(c.variance)}`)
                      .join(" · ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}
