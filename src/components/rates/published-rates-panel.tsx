"use client";

/**
 * Published cost data on the Cost Data screen — building rates and tender escalation.
 *
 * The same argument as the published factors panel beside it: a firm should be able to see every
 * figure the platform would use on its behalf, and decide what authority to give it. So the basis
 * travels with the rates rather than sitting in a footnote — these are whole-building rates on the
 * SAPOA construction area, excluding VAT, parking, site infrastructure and fees, current to a
 * stated date — and each range is shown as the guide prints it. A midpoint would be a figure
 * nobody published.
 */

import { useMemo, useState } from "react";

import { Panel } from "@/components/shell/panel";
import {
  BUILDING_RATES,
  BUILDING_RATE_BASIS,
  BUILDING_RATE_CATEGORIES,
  PUBLISHED_COST_SOURCE,
  PUBLISHED_COST_URL,
  displayBand,
} from "@/lib/published-cost-data";

export function PublishedRatesPanel() {
  const [category, setCategory] = useState<string>("All");
  const shown = useMemo(() => (category === "All" ? BUILDING_RATES : BUILDING_RATES.filter((r) => r.category === category)), [category]);

  return (
    <div id="published" className="flex flex-col gap-4">
      <Panel title="Published building cost rates" count={`${BUILDING_RATES.length} rates`}>
        <p className="t-sm max-w-[85ch] text-[var(--n-600)]">
          Cost per unit by building type, from <strong>{PUBLISHED_COST_SOURCE}</strong> – a check before there is a
          design, not bill rates.{" "}
          <a href={PUBLISHED_COST_URL} target="_blank" rel="noreferrer" className="font-medium text-[var(--a-700)] underline underline-offset-2">
            The guide
          </a>
          .
        </p>
        <ul className="t-xs mt-2 flex max-w-[95ch] list-disc flex-col gap-0.5 pl-5 text-[var(--n-600)]">
          {BUILDING_RATE_BASIS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {["All", ...BUILDING_RATE_CATEGORIES].map((c) => (
            <button
              key={c}
              type="button"
              data-category={c}
              onClick={() => setCategory(c)}
              aria-pressed={category === c}
              className={`t-xs rounded-[var(--r-full)] border px-2.5 py-1 ${
                category === c ? "border-[var(--n-800)] bg-[var(--n-800)] text-white" : "border-[var(--n-200)] text-[var(--n-700)] hover:bg-[var(--n-50)]"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="mt-3 overflow-x-auto">
          <table data-region="published-rates" className="w-full border-collapse">
            <thead>
              <tr className="border-b border-[var(--n-200)] bg-[var(--n-50)]">
                <th className="t-xs px-3 py-2 text-left font-semibold tracking-[0.03em] text-[var(--n-600)] uppercase">Category</th>
                <th className="t-xs px-3 py-2 text-left font-semibold tracking-[0.03em] text-[var(--n-600)] uppercase">Item</th>
                <th className="t-xs px-3 py-2 text-left font-semibold tracking-[0.03em] text-[var(--n-600)] uppercase">Per</th>
                <th className="t-xs px-3 py-2 text-right font-semibold tracking-[0.03em] text-[var(--n-600)] uppercase">Rate, excl. VAT</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={`${r.category}|${r.item}`} className="border-b border-[var(--n-100)] align-top">
                  <td className="t-xs px-3 py-1.5 text-[var(--n-500)]">{r.category}</td>
                  <td className="t-sm px-3 py-1.5 text-[var(--n-800)]">
                    {r.item}
                    {r.note && <span className="t-xs block text-[var(--n-500)]">{r.note}</span>}
                  </td>
                  <td className="t-sm px-3 py-1.5 text-[var(--n-600)]">{r.unit}</td>
                  <td className="num t-sm total-row px-3 py-1.5 text-right text-[var(--n-800)]">{displayBand(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
