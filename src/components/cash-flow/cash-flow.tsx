/**
 * Cash Flow – D1.7. The contract sum phased over the programme, against what has been certified.
 *
 * A lens like Pricing: no agent, nothing to sign, every figure derived from a signature somewhere
 * else and traceable to it. Three lines – forecast on the baseline, actual from certificates, and
 * the re-forecast over the current programme – and a table with the same three per month.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";

import { getProject } from "@/app/(app)/projects/actions";
import { CashFlowChart } from "@/components/cash-flow/cash-flow-chart";
import { expectedFinish, monthsApart } from "@/domain/construction-cash-flow";
import { formatMoney } from "@/domain/money";
import { requireSession } from "@/lib/auth";
import { cashFlowOf, loadCashFlowInputs } from "@/lib/cash-flow";
import { labelOf } from "@/lib/chain";
import { formatDate } from "@/lib/dates";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const rand = (minor: bigint) => `R ${formatMoney(minor as never)}`;

export async function CashFlowPage({ projectId }: { projectId: string }) {
  await requireSession();
  const project = await getProject(projectId);
  if (!project) notFound();

  const inputs = await loadCashFlowInputs(projectId);
  const { flow, why } = cashFlowOf(inputs);
  const finish = flow ? expectedFinish(flow) : null;
  const baselineFinish = inputs.programme?.baselineFinish ?? inputs.contract.completion;

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col px-8 py-6">
      <header>
        <h1 className="t-xl text-[var(--n-800)]">{labelOf("/cash-flow")}</h1>
        <p className="t-md mt-0.5 text-[var(--n-600)]">{project.name} · Construction & Delivery · D1.7</p>
      </header>

      {/* ── What it is built from, each a signature ─────────────────────────────────────── */}
      <section data-region="cash-flow-sources" className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Source
          label="Contract sum"
          value={inputs.contract.sum !== null ? rand(inputs.contract.sum) : "not signed"}
          note={inputs.contract.by ? `Contract signed by ${inputs.contract.by}` : "Sign the Contract step"}
          href={`/projects/${projectId}/contract`}
          ok={inputs.contract.sum !== null}
        />
        <Source
          label="Programme"
          value={inputs.programme ? `${inputs.programme.activities.length} activities to ${baselineFinish ? formatDate(baselineFinish) : "–"}` : "not signed"}
          note={inputs.programme ? `Baseline signed by ${inputs.programme.by}` : "Without it the forecast is an S-curve over the contract dates"}
          href={`/projects/${projectId}/programme`}
          ok={inputs.programme !== null}
        />
        <Source
          label="Certificates"
          value={inputs.certificates.length === 0 ? "none signed" : `${inputs.certificates.length} signed · ${rand(flow?.certified ?? 0n)} certified`}
          note={inputs.certificates.length === 0 ? "Each signed valuation is a month's actual" : `Latest period ${formatDate(inputs.certificates.at(-1)!.period)}`}
          href={`/projects/${projectId}/valuations`}
          ok={inputs.certificates.length > 0}
        />
      </section>

      {inputs.certificates.some((c) => c.unread.length > 0) && (
        <p role="alert" className="t-sm mt-3 text-[var(--warn-700)]">
          Some certified figures could not be read as money and were left out:{" "}
          {inputs.certificates.flatMap((c) => c.unread.map((u) => `certificate ${c.number ?? "?"} – ${u}`)).join("; ")}.
        </p>
      )}

      {!flow ? (
        <div data-region="cash-flow-empty" className="mt-6 rounded-[var(--r-lg)] border border-dashed border-[var(--n-200)] px-6 py-8 text-center">
          <p className="t-base font-medium text-[var(--n-800)]">Nothing to phase yet</p>
          <p className="t-sm mx-auto mt-1 max-w-[60ch] text-[var(--n-600)]">{why}</p>
        </div>
      ) : (
        <>
          {/* ── Where the money stands ───────────────────────────────────────────────────── */}
          <dl data-region="cash-flow-summary" className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 rounded-[var(--r-lg)] border border-[var(--n-200)] px-4 py-3 sm:grid-cols-4">
            <Stat label="Certified to date" value={rand(flow.certified)} note={flow.lastCertified ? `to ${monthLabel(flow.lastCertified)}` : "nothing yet"} />
            <Stat label="Remaining to certify" value={rand(flow.remaining)} note={`of ${rand(flow.contractSum)}`} />
            <Stat
              label="Expected completion of draw"
              value={finish ? formatDate(finish) : "–"}
              note={
                finish && baselineFinish
                  ? (() => {
                      const months = monthsApart(baselineFinish, finish);
                      return months === 0 ? "as the baseline" : `${Math.abs(months)} ${Math.abs(months) === 1 ? "month" : "months"} ${months > 0 ? "later than" : "earlier than"} the baseline`;
                    })()
                  : null
              }
            />
            <Stat label="Peak month" value={flow.peakMonth ? monthLabel(flow.peakMonth) : "–"} note={flow.peakMonth ? rand(flow.months.find((m) => m.month === flow.peakMonth)!.expected) : null} />
          </dl>

          <p className="t-sm mt-3 max-w-[80ch] text-[var(--n-600)]">
            {flow.basis === "programme"
              ? "Forecast: the contract sum spread over the signed baseline – each activity's value evenly over its days, activities without a value sharing the remainder pro rata to duration. Expected: what has been certified, then the remainder phased over the programme as it now stands."
              : "No programme is signed, so the forecast is an S-curve over the contract's dates. Sign the Programme step and the forecast follows the activities instead."}
          </p>

          <div className="mt-4 rounded-[var(--r-lg)] border border-[var(--n-200)] p-4">
            <CashFlowChart
              months={flow.months.map((m) => ({
                month: m.month,
                forecast: m.forecastCumulative.toString(),
                expected: m.expectedCumulative.toString(),
                actual: m.actualCumulative === null ? null : m.actualCumulative.toString(),
              }))}
              contractSum={flow.contractSum.toString()}
            />
          </div>

          {/* ── The months ──────────────────────────────────────────────────────────────── */}
          <div className="mt-4 overflow-x-auto rounded-[var(--r-lg)] border border-[var(--n-200)]">
            <table data-region="cash-flow-table" className="w-full border-collapse">
              <thead>
                <tr className="h-9 text-left">
                  {["Month", "Forecast", "Cumulative", "Certified", "Cumulative", "Variance", "Expected", "Cumulative"].map((h, i) => (
                    <th key={i} className={`t-xs border-b border-[var(--n-200)] px-3 font-semibold tracking-[0.03em] text-[var(--n-600)] uppercase ${i > 0 ? "text-right" : ""}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {flow.months.map((m) => (
                  <tr key={m.month} data-month={m.month} className={`border-b border-[var(--n-100)] last:border-0 ${m.month === flow.lastCertified ? "bg-[var(--n-25)]" : ""}`}>
                    <td className="t-sm px-3 py-1.5 whitespace-nowrap text-[var(--n-800)]">
                      {monthLabel(m.month)}
                      {m.certificate && <span className="t-xs ml-2 text-[var(--n-500)]">cert. {m.certificate}</span>}
                    </td>
                    <Cell v={m.forecast} />
                    <Cell v={m.forecastCumulative} muted />
                    <Cell v={m.actual} />
                    <Cell v={m.actualCumulative} muted />
                    <td className={`num t-sm px-3 py-1.5 text-right ${m.variance === null ? "text-[var(--n-400)]" : m.variance < 0n ? "text-[var(--warn-700)]" : "text-[var(--ok-700)]"}`}>
                      {m.variance === null ? "—" : formatMoney(m.variance as never, { accounting: true })}
                    </td>
                    <Cell v={m.expected} />
                    <Cell v={m.expectedCumulative} muted />
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="total-row">
                  <td className="t-sm px-3 py-2 font-semibold text-[var(--n-800)]">Total</td>
                  <Cell v={flow.contractSum} bold />
                  <td />
                  <Cell v={flow.certified} bold />
                  <td />
                  <td className="num t-sm px-3 py-2 text-right text-[var(--n-600)]">{flow.lastCertified ? formatMoney((flow.certified - (flow.months.find((m) => m.month === flow.lastCertified)?.forecastCumulative ?? 0n)) as never, { accounting: true }) : "—"}</td>
                  <Cell v={flow.contractSum} bold />
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="t-xs mt-3 text-[var(--n-500)]">
            Variance is certified less forecast, cumulative: in brackets where the draw is behind the forecast. A month’s certified figure is the certificate’s gross value of work executed
            with materials on site, less the certificate before it.
          </p>
        </>
      )}
    </div>
  );
}

function Source({ label, value, note, href, ok }: { label: string; value: string; note: string; href: string; ok: boolean }) {
  return (
    <Link href={href} className="group rounded-[var(--r-lg)] border border-[var(--n-200)] px-4 py-3 transition-colors hover:border-[var(--a-300)]" style={{ transitionDuration: "var(--m-fast)" }}>
      <span className="t-xs flex items-center gap-1 font-medium text-[var(--n-500)]">
        {label}
        <ArrowRight aria-hidden size={11} className="opacity-0 transition-opacity group-hover:opacity-100" />
      </span>
      <span className={`t-sm mt-0.5 block ${ok ? "text-[var(--n-800)]" : "text-[var(--warn-700)]"}`}>{value}</span>
      <span className="t-xs block text-[var(--n-500)]">{note}</span>
    </Link>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string | null }) {
  return (
    <div>
      <dt className="t-xs font-medium text-[var(--n-500)]">{label}</dt>
      <dd className="num t-sm mt-0.5 text-[var(--n-800)]">
        {value}
        {note && <span className="t-xs block font-normal text-[var(--n-500)]">{note}</span>}
      </dd>
    </div>
  );
}

function Cell({ v, muted = false, bold = false }: { v: bigint | null; muted?: boolean; bold?: boolean }) {
  return (
    <td className={`num t-sm px-3 py-1.5 text-right ${v === null ? "text-[var(--n-400)]" : muted ? "text-[var(--n-500)]" : "text-[var(--n-800)]"} ${bold ? "font-semibold" : ""}`}>
      {v === null ? "—" : formatMoney(v as never)}
    </td>
  );
}
