"use client";

/**
 * The charts a quantity surveyor's report actually uses.
 *
 * ── Chosen from the profession, not from a chart gallery ───────────────────────────────────
 *
 * An earlier pass here reached for a treemap, a funnel and a radial gauge. They were legible and
 * they were wrong: none of the three appears in a cost report, an elemental cost analysis or a
 * development appraisal, and a QS reading a treemap has to translate an area back into the rate
 * they actually think in. The forms below are the ones the discipline standardised on.
 *
 *   Cost bars   Elemental cost analysis. A horizontal bar per element with its rate beside it —
 *               a QS reads R/m², so the rate belongs in the chart, not behind a hover.
 *   Tornado     Sensitivity. Variables ranked by how far they move the answer, widest at the top.
 *               RICS is explicit that residual appraisals are hostage to small input changes, so
 *               this is the chart that says *which* input, and it is the one a financier opens on.
 *   S-curve     Cumulative cost against cumulative revenue over the programme. The canonical
 *               construction chart; the gap between the curves is the funding requirement, drawn.
 *
 * ── Restraint, because the surface is a document ───────────────────────────────────────────
 *
 * §7 is tables-not-cards, borders-not-shadows, black text. Apex's defaults are the opposite —
 * fat bars, drop shadows, saturated fills — so nearly every option below is turning something
 * off. Thin marks, hairline grid, ink in the text tokens, one hue.
 */

import { BASE_OPTIONS, INK, ReactApexChart, type ApexOptions } from "./apex";

/** Money arrives in minor units; an axis reads in millions. */
const millions = (value: number) => {
  const m = value / 100 / 1e6;
  return `R ${Math.abs(m) >= 10 ? m.toFixed(0) : m.toFixed(1)}m`;
};

// ── Elemental cost analysis ───────────────────────────────────────────────────────────────

export interface Element {
  label: string;
  /** Minor units. */
  amount: number;
  shown: string;
  /** The rate a QS actually compares — R/m². Omitted where no area is signed. */
  rate?: string;
}

export function ElementalCost({
  elements,
  caption,
}: {
  elements: readonly Element[];
  caption?: string;
}) {
  const sorted = [...elements].sort((a, b) => b.amount - a.amount);
  const total = sorted.reduce((a, e) => a + e.amount, 0);

  const options: ApexOptions = {
    ...BASE_OPTIONS,
    chart: { ...BASE_OPTIONS.chart, type: "bar" },
    plotOptions: { bar: { horizontal: true, barHeight: "52%", borderRadius: 2 } },
    colors: [INK.brand],
    xaxis: {
      categories: sorted.map((e) => e.label),
      labels: {
        style: { colors: INK.muted, fontSize: "11px" },
        formatter: (v) => millions(Number(v)),
      },
      axisBorder: { color: INK.grid },
      axisTicks: { color: INK.grid },
    },
    yaxis: { labels: { style: { colors: INK.secondary, fontSize: "12px" }, maxWidth: 190 } },
    grid: { ...BASE_OPTIONS.grid, yaxis: { lines: { show: false } } },
    tooltip: {
      ...BASE_OPTIONS.tooltip,
      y: {
        formatter: (_v, opts) => {
          const element = sorted[opts?.dataPointIndex ?? 0];
          if (!element) return "";
          const share = total > 0 ? ((element.amount / total) * 100).toFixed(1) : "0";
          return `${element.shown} · ${share}%${element.rate ? ` · ${element.rate}` : ""}`;
        },
      },
    },
  };

  return (
    <figure className="m-0">
      <ReactApexChart
        type="bar"
        height={Math.max(200, sorted.length * 32 + 56)}
        options={options}
        series={[{ name: "Cost", data: sorted.map((e) => e.amount) }]}
      />

      {caption && (
        <figcaption className="t-sm mt-2 border-t border-[var(--n-100)] pt-3 text-[var(--n-600)]">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

// ── Tornado ───────────────────────────────────────────────────────────────────────────────

export interface Lever {
  variable: string;
  range: string;
  /** Minor units. Negative is the adverse end. */
  low: number;
  high: number;
}

/**
 * Which assumption the answer is hostage to.
 *
 * Bars run left and right of the base case, sorted widest first, which is where the name comes
 * from. The reader's question is not "what is the NPV" — it is "what do I have to be right
 * about", and the top bar answers it.
 */
export function Tornado({
  levers,
  caption,
  baseLabel,
}: {
  levers: readonly Lever[];
  caption?: string;
  /** What zero on the axis means, named. */
  baseLabel: string;
}) {
  const options: ApexOptions = {
    ...BASE_OPTIONS,
    chart: { ...BASE_OPTIONS.chart, type: "bar", stacked: true },
    plotOptions: { bar: { horizontal: true, barHeight: "54%", borderRadius: 2 } },
    /* Amber is the adverse side — the same meaning it carries everywhere else on the platform. */
    colors: [INK.warn, INK.brand],
    xaxis: {
      categories: levers.map((l) => `${l.variable} ${l.range}`),
      labels: {
        style: { colors: INK.muted, fontSize: "11px" },
        formatter: (v) => millions(Number(v)),
      },
      axisBorder: { color: INK.grid },
      axisTicks: { color: INK.grid },
    },
    yaxis: { labels: { style: { colors: INK.secondary, fontSize: "12px" }, maxWidth: 220 } },
    grid: { ...BASE_OPTIONS.grid, yaxis: { lines: { show: false } } },
    legend: {
      show: true,
      position: "top",
      horizontalAlign: "left",
      fontSize: "12px",
      markers: { size: 6 },
      labels: { colors: INK.secondary },
    },
    tooltip: {
      ...BASE_OPTIONS.tooltip,
      shared: false,
      y: { formatter: (v) => millions(Number(v)) },
    },
    annotations: {
      xaxis: [
        {
          x: 0,
          borderColor: INK.secondary,
          label: {
            text: baseLabel,
            // Apex rotates an x-axis annotation label by default, which turned "Base case" into
            // a vertical sliver reading "case" across the middle of the bars.
            orientation: "horizontal",
            position: "top",
            offsetY: -4,
            style: { background: INK.primary, color: "#ffffff", fontSize: "11px" },
          },
        },
      ],
    },
  };

  return (
    <figure className="m-0">
      <ReactApexChart
        type="bar"
        height={Math.max(220, levers.length * 46 + 96)}
        options={options}
        series={[
          { name: "Adverse", data: levers.map((l) => l.low) },
          { name: "Favourable", data: levers.map((l) => l.high) },
        ]}
      />

      {caption && (
        <figcaption className="t-sm mt-2 border-t border-[var(--n-100)] pt-3 text-[var(--n-600)]">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

// ── S-curve ───────────────────────────────────────────────────────────────────────────────

/**
 * Cumulative cost against cumulative revenue — the construction chart.
 *
 * The vertical gap between the two curves *is* the funding requirement, so a reader sees both the
 * peak and when it closes without reading a figure. The dashed rule marks the deepest point,
 * because that is the number a financier is actually sizing.
 */
export function SCurve({
  cost,
  revenue,
  caption,
  height = 300,
}: {
  /** Cumulative, in minor units, by month. */
  cost: readonly number[];
  revenue: readonly number[];
  caption?: string;
  height?: number;
}) {
  const options: ApexOptions = {
    ...BASE_OPTIONS,
    chart: { ...BASE_OPTIONS.chart, type: "area" },
    colors: [INK.warn, INK.brand],
    stroke: { curve: "smooth", width: 2 },
    fill: {
      type: "gradient",
      gradient: { shadeIntensity: 0, opacityFrom: 0.16, opacityTo: 0.02, stops: [0, 100] },
    },
    markers: { size: 0, hover: { size: 5 } },
    xaxis: {
      /*
        String categories, deliberately.

        The peak annotation addresses a category by value, and with numeric categories a
        `String(41)` never matches — Apex silently falls back to the first one, so the dashed rule
        marking a R575m peak sat on month zero. Keeping both sides strings makes the match exact.
      */
      categories: cost.map((_, i) => String(i)),
      tickAmount: 10,
      labels: {
        style: { colors: INK.muted, fontSize: "11px" },
        formatter: (v) => `m${v}`,
        hideOverlappingLabels: true,
      },
      axisTicks: { show: false },
      axisBorder: { color: INK.grid },
      tooltip: { enabled: false },
    },
    yaxis: {
      labels: { style: { colors: INK.muted, fontSize: "11px" }, formatter: (v) => millions(v) },
    },
    legend: {
      show: true,
      position: "top",
      horizontalAlign: "left",
      fontSize: "12px",
      markers: { size: 6 },
      labels: { colors: INK.secondary },
    },
    tooltip: {
      ...BASE_OPTIONS.tooltip,
      shared: true,
      x: { formatter: (v) => `Month ${v}` },
      y: { formatter: (v) => millions(v) },
    },
    /*
      No peak marker, deliberately.

      Both of Apex's annotation forms put it on month zero here — the x-axis rule never matched a
      category once 127 of them were thinned to ten rendered ticks, and the point annotation
      resolved to index 0 whether given the category string or the index. A marker reading "Peak
      R575m" sitting on the first month is not a cosmetic defect: it is a wrong figure in a
      confident place, which is the exact failure §1.3.1 names.

      The caption carries the peak and the month it falls in, and the curve shows the shape. That
      is the whole fact, in a place it is right.
    */
  };

  return (
    <figure className="m-0">
      <ReactApexChart
        type="area"
        height={height}
        options={options}
        series={[
          { name: "Cumulative cost", data: [...cost] },
          { name: "Cumulative revenue", data: [...revenue] },
        ]}
      />

      {caption && (
        <figcaption className="t-sm mt-2 border-t border-[var(--n-100)] pt-3 text-[var(--n-600)]">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
