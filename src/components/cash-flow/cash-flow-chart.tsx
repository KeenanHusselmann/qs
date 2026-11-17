/**
 * Cumulative draw against the contract sum – forecast, expected, and what has been certified.
 *
 * One scale for all three lines, gridlines at round rand values, the contract sum as the ceiling.
 * Drawn in SVG from the figures the table shows, so the picture and the column cannot disagree.
 * Money arrives as decimal strings of minor units: a `bigint` does not cross the client boundary.
 */

const W = 960;
const H = 280;
const PAD = { top: 16, right: 24, bottom: 34, left: 72 };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A round step for the gridlines – 1, 2, 5 × 10^n rand – with four to six lines. */
function step(maxRand: number): number {
  const raw = maxRand / 5;
  const power = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  const unit = raw / power;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power;
}

const short = (rand: number) => (rand >= 1_000_000 ? `R ${(rand / 1_000_000).toLocaleString("en-ZA", { maximumFractionDigits: 1 })}m` : rand >= 1_000 ? `R ${Math.round(rand / 1_000)}k` : `R ${rand}`);

export function CashFlowChart({
  months,
  contractSum,
}: {
  months: readonly { month: string; forecast: string; expected: string; actual: string | null }[];
  contractSum: string;
}) {
  const toRand = (minor: string) => Number(BigInt(minor)) / 100;
  const ceiling = Math.max(toRand(contractSum), ...months.map((m) => Math.max(toRand(m.forecast), toRand(m.expected), m.actual ? toRand(m.actual) : 0)));
  const grid = step(ceiling);
  const top = Math.ceil(ceiling / grid) * grid;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (months.length === 1 ? innerW / 2 : (i / (months.length - 1)) * innerW);
  const y = (rand: number) => PAD.top + innerH - (rand / top) * innerH;

  const path = (pick: (m: (typeof months)[number]) => string | null) => {
    const points = months.flatMap((m, i) => {
      const v = pick(m);
      return v === null ? [] : [`${x(i).toFixed(1)},${y(toRand(v)).toFixed(1)}`];
    });
    return points.length > 0 ? `M ${points.join(" L ")}` : "";
  };

  const gridlines: number[] = [];
  for (let v = 0; v <= top; v += grid) gridlines.push(v);

  // Month labels thin out so they never overlap: every nth, n from the count.
  const every = Math.max(1, Math.ceil(months.length / 12));

  return (
    <svg data-region="cash-flow-chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Cumulative draw: forecast, expected and certified" className="block">
      {gridlines.map((v) => (
        <g key={v}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--n-200)" strokeWidth={1} />
          <text x={PAD.left - 8} y={y(v) + 4} fontSize={11} textAnchor="end" fill="var(--n-600)" style={{ fontFamily: "inherit" }}>
            {short(v)}
          </text>
        </g>
      ))}
      <line x1={PAD.left} x2={W - PAD.right} y1={y(toRand(contractSum))} y2={y(toRand(contractSum))} stroke="var(--n-400)" strokeWidth={1} strokeDasharray="3 3" />
      <text x={W - PAD.right} y={y(toRand(contractSum)) - 5} fontSize={11} textAnchor="end" fill="var(--n-600)" style={{ fontFamily: "inherit" }}>
        contract sum
      </text>

      <path d={path((m) => m.forecast)} fill="none" stroke="var(--n-400)" strokeWidth={2} />
      <path d={path((m) => m.expected)} fill="none" stroke="var(--a-500)" strokeWidth={2} strokeDasharray="6 4" />
      <path d={path((m) => m.actual)} fill="none" stroke="var(--a-700)" strokeWidth={2.5} />
      {months.map((m, i) => m.actual !== null && <circle key={m.month} cx={x(i)} cy={y(toRand(m.actual))} r={3.5} fill="var(--a-700)" />)}

      {months.map((m, i) =>
        i % every === 0 || i === months.length - 1 ? (
          <text key={m.month} x={x(i)} y={H - 12} fontSize={11} textAnchor="middle" fill="var(--n-600)" style={{ fontFamily: "inherit" }}>
            {MONTHS[Number(m.month.slice(5, 7)) - 1]} {m.month.slice(2, 4)}
          </text>
        ) : null,
      )}

      <g transform={`translate(${PAD.left + 8}, ${PAD.top + 6})`} fontSize={11} fill="var(--n-700)" style={{ fontFamily: "inherit" }}>
        <line x1={0} x2={18} y1={4} y2={4} stroke="var(--n-400)" strokeWidth={2} />
        <text x={24} y={8}>forecast (baseline)</text>
        <line x1={130} x2={148} y1={4} y2={4} stroke="var(--a-500)" strokeWidth={2} strokeDasharray="6 4" />
        <text x={154} y={8}>expected (current programme)</text>
        <line x1={320} x2={338} y1={4} y2={4} stroke="var(--a-700)" strokeWidth={2.5} />
        <text x={344} y={8}>certified</text>
      </g>
    </svg>
  );
}
