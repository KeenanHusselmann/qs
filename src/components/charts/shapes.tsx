"use client";

/**
 * The chart forms this platform draws, one per shape of question.
 *
 * ── Form before colour, and a different form per question ──────────────────────────────────
 *
 * Every chart here started as "what is the data's job?", and the answers are genuinely different,
 * so the shapes are too. Rendering all of them as donuts — which is where this file started —
 * spends the same encoding on five unrelated questions and answers none of them well. The worst
 * case was a portfolio holding one project: a donut of a single slice is a ring, and a ring
 * carries no information at all.
 *
 *   Waterfall  a build-up. The question is not "what is the split" but "how do we get from this
 *              number to that one", and a waterfall is the only form that draws the steps.
 *   Funnel     a pipeline. Ordered stages that things move through, in order.
 *
 * A treemap and a radial gauge lived here too. Both were legible and neither is a chart the
 * construction discipline uses — see `qs-charts.tsx`, which holds the forms that are.
 *
 * ── One hue, still ─────────────────────────────────────────────────────────────────────────
 *
 * §7.1 #5 — colour means exactly one thing — so none of these introduces a categorical palette.
 * Magnitude charts use the sequential ramp in `apex.tsx` (measured: worst adjacent pair ΔE 10.9
 * under protanopia, lightness strictly monotonic). Amber appears only where amber already means
 * what it means everywhere else on the platform: look at this one.
 */

import { BASE_OPTIONS, INK, RAMP, ReactApexChart, type ApexOptions } from "./apex";

export interface Datum {
  label: string;
  value: number;
  /** The figure as the reader should see it — formatted, with its unit. */
  shown: string;
}

/**
 * How an axis labels itself.
 *
 * A string rather than a formatter function, because these charts are mounted from server
 * components and React cannot serialise a function across that boundary — passing one throws at
 * render, which is exactly how this was found. The mapping lives in `axisLabel` below, on the
 * client side where it belongs.
 */
export type AxisFormat = "money" | "count";

/** Money arrives in minor units, so an axis in millions divides by both. */
export function axisLabel(format: AxisFormat, value: number): string {
  if (format === "count") return String(Math.round(value));
  const millions = value / 100 / 1e6;
  return millions >= 10 || millions <= -10
    ? `R ${millions.toFixed(0)}m`
    : `R ${millions.toFixed(1)}m`;
}

// ── Waterfall ─────────────────────────────────────────────────────────────────────────────

/**
 * How you get from one number to another.
 *
 * A development cost build-up is not a split, it is a journey: construction, then what a
 * construction cost plan excludes, arriving at the total. A donut of the same figures answers
 * "what share is fees" and hides the thing a reader actually came for, which is *how much the
 * total is above the number they already knew*.
 *
 * Apex has no waterfall type. It is a stacked bar whose lower series is transparent — the
 * standard construction, and the reason the base series has no colour and no tooltip.
 */
export function Waterfall({
  steps,
  total,
  caption,
  format,
  height = 280,
}: {
  /** In order. Each is added to the running total. */
  steps: readonly Datum[];
  total: Datum;
  format: AxisFormat;
  caption?: string;
  height?: number;
}) {
  const bases: number[] = [];
  const deltas: number[] = [];
  let running = 0;

  for (const step of steps) {
    bases.push(running);
    deltas.push(step.value);
    running += step.value;
  }

  // The total is drawn from zero — it is a resting bar, not another step.
  bases.push(0);
  deltas.push(total.value);

  const labels = [...steps.map((s) => s.label), total.label];
  const shown = [...steps.map((s) => s.shown), total.shown];

  const options: ApexOptions = {
    ...BASE_OPTIONS,
    chart: { ...BASE_OPTIONS.chart, type: "bar", stacked: true },
    /*
      No corner radius, and the reason is the whole complaint about this chart.

      `borderRadius: 3` with `borderRadiusApplication: "end"` rounds the top of a bar and leaves
      the bottom square. On the first and last bars, which stand on the axis, that reads as a bar.
      On the three floating steps in between it reads as a **fragment** — a slab with one finished
      edge and one cut one, which is exactly what somebody looking at it said: the middle bars look
      cut off.

      A waterfall step is a *delta drawn between two running totals*. Both of its edges are real
      and neither is an end, so neither is rounded.
    */
    plotOptions: {
      bar: {
        horizontal: false,
        columnWidth: "56%",
        borderRadius: 0,
        // Above the segment, not inside it. Apex centres a stacked label by default, which on the
        // two full-height bars printed the figure across the middle of the bar it belonged to.
        dataLabels: { position: "top" },
      },
    },

    /*
      No labels on the bars.

      They were tried twice. Apex places a stacked label at the segment centre, so on the two
      full-height bars the figure printed across the middle of its own fill; moving it above with
      `position: "top"` fixed those and left "Statutory and compliance" blank, because Apex
      suppresses a label it judges too large for its bar — which silences exactly the steps that
      need one. `hideOverflowingLabels` does not apply to a stacked series.

      A nine-pixel bar is the wrong place for a figure regardless. The values go in a list under
      the chart, the way `ElementalCost` does it: every step is shown, in the drawing order, at a
      size somebody can read, and the chart is left to do the one thing a chart is for.
    */
    dataLabels: { enabled: false },
    colors: ["transparent", INK.brand],
    xaxis: {
      categories: labels,
      /*
        `trim` was cutting "Statutory and compliance" to "Statutory and c…". A two-line label at a
        shallower angle fits the full name, and the axis is given the height to hold it.
      */
      labels: {
        style: { colors: INK.muted, fontSize: "11px" },
        trim: false,
        hideOverlappingLabels: false,
        rotate: -28,
        rotateAlways: true,
        maxHeight: 90,
      },
      axisBorder: { color: INK.grid },
      axisTicks: { color: INK.grid },
    },
    yaxis: { labels: { style: { colors: INK.muted, fontSize: "11px" }, formatter: (v) => axisLabel(format, v) } },
    tooltip: {
      ...BASE_OPTIONS.tooltip,
      shared: false,
      intersect: true,
      // The invisible base carries no meaning, so it carries no tooltip either.
      enabledOnSeries: [1],
      y: { formatter: (_v, opts) => shown[opts?.dataPointIndex ?? 0] ?? "" },
    },
    legend: { show: false },
  };

  return (
    <figure className="m-0">
      <ReactApexChart
        type="bar"
        height={height}
        options={options}
        series={[
          { name: "base", data: bases },
          { name: "amount", data: deltas },
        ]}
      />

      {/* The figures, in the drawing order, so the chart reads without hovering anything. */}
      <ul className="mt-1 flex flex-col gap-1">
        {labels.map((label, i) => (
          <li
            key={label}
            className={`flex items-baseline gap-2 ${
              i === labels.length - 1 ? "border-t border-[var(--n-100)] pt-1.5" : ""
            }`}
          >
            <span
              className={`t-sm min-w-0 flex-1 truncate ${
                i === labels.length - 1
                  ? "font-medium text-[var(--n-800)]"
                  : "text-[var(--n-700)]"
              }`}
            >
              {label}
            </span>
            <span
              className={`t-sm num shrink-0 ${
                i === labels.length - 1
                  ? "font-semibold text-[var(--n-900)]"
                  : "font-medium text-[var(--n-800)]"
              }`}
            >
              {shown[i]}
            </span>
          </li>
        ))}
      </ul>

      {caption && (
        <figcaption className="t-sm mt-2 border-t border-[var(--n-100)] pt-3 text-[var(--n-600)]">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

// ── Funnel ────────────────────────────────────────────────────────────────────────────────

/**
 * A pipeline — ordered stages, drawn in order.
 *
 * Projects by stage is not a part-to-whole question: the stages have a sequence, and the reader
 * wants to see where the work is sitting along it. A funnel keeps the order on the page, and
 * unlike a donut it still reads when a portfolio holds one project — the stage it is in is a bar
 * and the empty stages are visibly empty, which is itself the finding.
 */
export function Funnel({
  stages,
  caption,
  height = 300,
}: {
  stages: readonly Datum[];
  caption?: string;
  height?: number;
}) {
  const options: ApexOptions = {
    ...BASE_OPTIONS,
    chart: { ...BASE_OPTIONS.chart, type: "bar" },
    /*
      A plain horizontal bar, not Apex's `isFunnel`.

      The funnel taper draws a centred wedge, and on a portfolio sitting in one stage that is five
      zero-width wedges and one bar — the stages read as nothing at all. A bar per stage keeps the
      order, keeps the empty stages visibly empty, and does not pretend a distribution exists.
    */
    plotOptions: {
      bar: { horizontal: true, distributed: true, barHeight: "62%", borderRadius: 3 },
    },
    colors: [...RAMP],
    stroke: { width: 2, colors: [INK.surface] },
    dataLabels: {
      enabled: true,
      formatter: (_v, opts) => stages[opts?.dataPointIndex ?? -1]?.shown ?? "",
      style: { fontSize: "11px", fontWeight: 500, colors: [INK.primary] },
      dropShadow: { enabled: false },
      textAnchor: "start",
      offsetX: 6,
    },
    /*
      On a horizontal bar Apex puts the categories on the x axis and *renders* them down the left.
      Hiding `xaxis.labels` hid the stage names with them, which left six figures floating beside
      nothing. The value axis is what should be hidden here: the count is already on every bar.
    */
    xaxis: {
      categories: stages.map((s) => s.label),
      labels: { show: false },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: {
      labels: { show: true, style: { colors: INK.secondary, fontSize: "12px" }, maxWidth: 210 },
    },
    grid: { ...BASE_OPTIONS.grid, xaxis: { lines: { show: false } } },
    legend: { show: false },
    tooltip: { ...BASE_OPTIONS.tooltip, y: { formatter: (_v, opts) => stages[opts?.dataPointIndex ?? 0]?.shown ?? "" } },
  };

  return (
    <figure className="m-0">
      <ReactApexChart
        type="bar"
        height={height}
        options={options}
        series={[{ name: "Projects", data: stages.map((s) => s.value) }]}
      />

      {caption && (
        <figcaption className="t-sm mt-2 border-t border-[var(--n-100)] pt-3 text-[var(--n-600)]">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
