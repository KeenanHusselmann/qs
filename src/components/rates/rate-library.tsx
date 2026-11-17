/**
 * The rate library — PLATFORM.md §4.5, §4.8, §6.3.
 *
 * ── The reference design, in this platform's colours ───────────────────────────────────────
 *
 * The layout is taken from the Mzilikazi prototype's Rate Library screen: a KPI band over a
 * searchable table, filters for trade and region, and the columns a QS reads — trade, description,
 * unit, rate, region, effective date, source. That screen answers the right question, which is
 * *"what do we price this at, and who says so"*.
 *
 * What is **not** taken is its palette. The prototype is blue; this platform's accent is the green
 * sampled from the practice's own mark, and §7.1 #5 gives colour exactly one meaning. Four
 * differently-tinted KPI cards would spend the palette on making cards look distinct from each
 * other, and then amber here would mean "attention" in one place and "the third card" in another.
 *
 * Nor is its data model: the prototype scopes rates to a project and stores them as
 * `numeric(18,2)`. See `drizzle/0018_rates.sql` for why this is firm-level and why the rate carries
 * its own precision.
 *
 * ── Why the whole library is held in the client ────────────────────────────────────────────
 *
 * Search, filter and tab are all narrowing of one list, and a round trip per keystroke against a
 * table a practice reads all day is the §7.9 budget spent on nothing — the whole library is a few
 * thousand rows of short text. When it stops being that, the search moves to SQL and this comment
 * is the note that says why it did.
 */

"use client";

import { SimulatedRatesControl } from "@/components/rates/simulated-rates-control";
import { SIMULATED_RATES, SIMULATED_SOURCE } from "@/lib/simulated-rates";
import { useMemo, useState } from "react";
import { AlertTriangle, Database, MapPin, TrendingUp, Calendar, Search, SlidersHorizontal } from "lucide-react";

import { Panel } from "@/components/shell/panel";
import { RateImportPanel } from "@/components/rates/rate-import-panel";
import { FactorPanel } from "@/components/rates/factor-panel";
import { PublishedRatesPanel } from "@/components/rates/published-rates-panel";
import { ESCALATION_BASIS, PUBLISHED_COST_SOURCE, TENDER_ESCALATION, displayChange } from "@/lib/published-cost-data";
import type { ResourceFactor } from "@/lib/factors";
import { AssumptionRow } from "@/components/settings/assumption-row";
import type { AssumptionSpec } from "@/lib/assumption-set";
import { KpiTile } from "@/components/home/kpi-tile";
import { formatDate } from "@/lib/dates";
import {
  REGIONS,
  TRADES,
  displayRate,
  escalation,
  historyOf,
  itemKey,
  ratesInForce,
  type LibraryRate,
} from "@/lib/rates";

/** The tabs, and what each is a view *of*. Every one is the same rows, narrowed or grouped. */
const TABS = [
  { id: "current", label: "Current rates" },
  { id: "regional", label: "Regional analysis" },
  { id: "trends", label: "Trends & escalation" },
  /*
    The practice's own financial assumptions, moved here off the Settings page.

    They belong with the rate library because they are the same kind of thing: **what the practice's
    numbers are**, as against what the platform does with them. Settings is where somebody is
    administered; a prime lending rate is not an administrative preference, it is a figure a report
    is printed on and a gate is decided by.

    A tab rather than a route, because every route is a serverless function and the Cost Data area
    gets one between all of it.
  */
  { id: "assumptions", label: "Assumptions" },
  /*
    What a unit of work *consumes*, as against what it costs.

    Here rather than in its own route for the reason every tab on this page is here, and beside the
    rates because the two answer halves of one question: the factor says how much, the rate says
    what that costs. A take-off reads both.
  */
  { id: "factors", label: "Factors" },
  /*
    What a guide says a building of each kind costs, as against what this practice has priced.

    Beside the library rather than inside it because the two are different kinds of figure and the
    difference must stay visible: one is the practice's, filed and defensible; the other is
    published, indicative, and a range. A tab keeps both a click apart without letting either be
    mistaken for the other.
  */
  { id: "published", label: "Published rates" },
  { id: "import", label: "Import" },
] as const;

type Tab = (typeof TABS)[number]["id"];

/** One assumption, already resolved against what the practice has set. Plain data, so the server
 *  can hand it straight to the client half. */
export interface AssumptionInForce {
  spec: AssumptionSpec;
  value: number;
  isDefault: boolean;
  effectiveFrom: string | null;
  setBy: string | null;
}

export function RateLibrary({
  rows,
  assumptions,
  factors,
}: {
  rows: readonly LibraryRate[];
  assumptions: readonly AssumptionInForce[];
  factors: readonly ResourceFactor[];
}) {
  const [tab, setTab] = useState<Tab>("current");
  const [query, setQuery] = useState("");
  const [trade, setTrade] = useState("");
  const [region, setRegion] = useState("");

  const inForce = useMemo(() => ratesInForce(rows), [rows]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return inForce
      .filter((r) => (trade === "" ? true : r.trade === trade))
      .filter((r) => (region === "" ? true : r.region === region))
      .filter(
        (r) =>
          needle === "" ||
          r.description.toLowerCase().includes(needle) ||
          (r.trade ?? "").toLowerCase().includes(needle) ||
          r.source.toLowerCase().includes(needle),
      )
      .sort((a, b) => (a.trade ?? "").localeCompare(b.trade ?? "") || a.description.localeCompare(b.description));
  }, [inForce, query, trade, region]);

  const yoy = useMemo(() => escalation(rows), [rows]);

  /*
    The provinces this library actually prices, not the nine that exist.

    "Regions 9" on the reference screen is the count of provinces *covered*, and counting the
    constant would print 9 on an empty library — a tile claiming national coverage the practice has
    not got. §1.3: never a figure nobody established.
  */
  const covered = new Set(inForce.map((r) => r.region).filter(Boolean));

  const newest = rows.reduce<string | null>(
    (latest, r) => (latest === null || r.effectiveDate > latest ? r.effectiveDate : latest),
    null,
  );

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col px-8 py-6">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="t-xl text-[var(--n-800)]">Rate Library</h1>
          {/* `--n-600`, not `--n-500`: on the `--n-50` canvas that measures 4,45:1 against §7.8's
              4,5. Same correction the module page headers took. */}
          <p className="t-md mt-0.5 text-[var(--n-600)]">
            The practice&rsquo;s own pricing — what a rate is, where it came from, and when it applied.
          </p>
        </div>
        {/* A labelled rate set for testing the advisor, pricing and take-off – loaded and withdrawn as one. */}
        <SimulatedRatesControl loaded={rows.filter((r) => r.source === SIMULATED_SOURCE).length} total={SIMULATED_RATES.length} />
      </header>

      {/*
        The band. Counted from the rows on file, never declared — an empty library reads as empty
        rather than as a library with nothing in it yet.
      */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile
          label="Rates in force"
          icon={Database}
          figure={inForce.length === 0 ? null : inForce.length.toLocaleString("en-ZA")}
          note={`${rows.length.toLocaleString("en-ZA")} prices on file across every date`}
          trace={{ href: "#current", label: "the table below" }}
          absent="Nothing priced yet"
        />
        <KpiTile
          label="Provinces covered"
          icon={MapPin}
          figure={covered.size === 0 ? null : `${covered.size} of ${REGIONS.length}`}
          note={
            covered.size === 0
              ? "No rate carries a region"
              : [...covered].sort().join(", ")
          }
          trace={{ href: "#regional", label: "regional analysis" }}
          absent="No region stated"
        />
        {/*
          Null until something has been priced twice a year apart. A library loaded once has no
          escalation to report, and 0% there would say prices held steady — a measurement nobody
          has taken.
        */}
        <KpiTile
          label="Escalation"
          icon={TrendingUp}
          figure={yoy === null ? null : `${yoy >= 0 ? "" : "−"}${Math.abs(yoy).toFixed(1)}%`}
          note="Mean year-on-year movement of items priced twice"
          trace={{ href: "#trends", label: "trends & escalation" }}
          absent="Not measurable yet"
          tone={yoy !== null && yoy > 0 ? "warn" : undefined}
        />
        <KpiTile
          label="Newest price"
          icon={Calendar}
          figure={newest === null ? null : formatDate(new Date(newest))}
          note="The most recent effective date on file"
          trace={{ href: "#current", label: "the table below" }}
          absent="Nothing on file"
        />
      </div>

      {/* ── Narrowing ────────────────────────────────────────────────────────────────────── */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <label className="relative min-w-[240px] flex-1">
          <Search
            aria-hidden
            size={14}
            strokeWidth={1.75}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--n-400)]"
          />
          <span className="sr-only">Search rates</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by description, trade or source…"
            className="t-base h-8 w-full rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] pr-3 pl-8 text-[var(--n-800)] placeholder:text-[var(--n-400)]"
          />
        </label>

        <Filter label="All trades" value={trade} onChange={setTrade} options={TRADES} />
        <Filter label="All regions" value={region} onChange={setRegion} options={REGIONS} />
      </div>

      {/* ── The tabs ─────────────────────────────────────────────────────────────────────── */}
      <div role="tablist" aria-label="Rate library views" className="mt-4 flex gap-1 border-b border-[var(--n-200)]">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            /* The active tab is named as well as coloured — §7.1 #5, never colour alone. The
               underline is the affordance; `aria-selected` is what a screen reader reads. */
            className={`t-base -mb-px border-b-2 px-3 py-2 font-medium transition-colors ${
              tab === t.id
                ? "border-[var(--a-500)] text-[var(--a-700)]"
                : "border-transparent text-[var(--n-600)] hover:text-[var(--n-800)]"
            }`}
            style={{ transitionDuration: "var(--m-fast)" }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {tab === "current" && <CurrentRates shown={shown} total={inForce.length} />}
        {tab === "regional" && <RegionalAnalysis rows={inForce} />}
        {tab === "trends" && <Trends rows={rows} />}
        {tab === "assumptions" && <Assumptions assumptions={assumptions} />}
        {tab === "factors" && <FactorPanel factors={factors} />}
        {tab === "published" && <PublishedRatesPanel />}
        {tab === "import" && <RateImportPanel />}
      </div>
    </div>
  );
}

/** A select that reads as a filter rather than as a required field. */
function Filter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
}) {
  return (
    <label>
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="t-base h-8 rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] px-2 text-[var(--n-800)]"
      >
        <option value="">{label}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function CurrentRates({ shown, total }: { shown: readonly LibraryRate[]; total: number }) {
  return (
    <div id="current">
      <Panel
        title="Current rates"
        count={shown.length === total ? `${total} in force` : `${shown.length} of ${total}`}
        flush
      >
        {shown.length === 0 ? (
          <Empty
            headline={total === 0 ? "No rates on file" : "Nothing matches those filters"}
            detail={
              total === 0
                ? "A rate library is built from what the practice already pays — a published guide, a supplier quote, or a rate a job was tendered at."
                : "Clear a filter, or search for the item rather than the trade."
            }
          />
        ) : (
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr className="border-b border-[var(--n-200)] bg-[var(--n-50)]">
                <Th className="w-[13%]">Trade</Th>
                <Th className="w-[30%]">Description</Th>
                <Th className="w-[7%]">Unit</Th>
                <Th className="w-[13%]" numeric>
                  Rate
                </Th>
                <Th className="w-[13%]">Region</Th>
                <Th className="w-[11%]">From</Th>
                <Th className="w-[13%]">Source</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="border-b border-[var(--n-100)] last:border-0 hover:bg-[var(--n-25)]">
                  <Td>
                    {r.trade ? (
                      <span className="t-xs rounded-[var(--r-sm)] bg-[var(--n-100)] px-1.5 py-0.5 text-[var(--n-700)]">
                        {r.trade}
                      </span>
                    ) : (
                      /* Unclassified is a fact, said in words. §6.9 — a classification is a
                         dimension, not a gate, so a rate without one is not an error. */
                      <span className="t-xs text-[var(--n-400)]">Unclassified</span>
                    )}
                  </Td>
                  <Td className="text-[var(--n-800)]">{r.description}</Td>
                  <Td>{r.unit}</Td>
                  <Td numeric className="font-medium text-[var(--n-800)]">
                    {displayRate(r)}
                  </Td>
                  <Td>{r.region ?? <span className="text-[var(--n-400)]">Not stated</span>}</Td>
                  <Td>{formatDate(new Date(r.effectiveDate))}</Td>
                  <Td>{r.source}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

/**
 * What the library covers, province by province.
 *
 * Counts and a median rather than a mean: one imported guide can carry a thousand rates for one
 * province and three for another, and an average across items of different units is a number with
 * no meaning. The count is the honest measure of coverage.
 */
function RegionalAnalysis({ rows }: { rows: readonly LibraryRate[] }) {
  const byRegion = REGIONS.map((region) => ({
    region,
    rates: rows.filter((r) => r.region === region),
  }));

  const unstated = rows.filter((r) => r.region === null);

  return (
    <div id="regional" className="flex flex-col gap-4">
      <Panel title="Coverage by province" count={`${byRegion.filter((b) => b.rates.length > 0).length} of ${REGIONS.length}`} flush>
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr className="border-b border-[var(--n-200)] bg-[var(--n-50)]">
              <Th className="w-[34%]">Province</Th>
              <Th className="w-[16%]" numeric>
                Rates
              </Th>
              <Th className="w-[50%]">Trades priced</Th>
            </tr>
          </thead>
          <tbody>
            {byRegion.map(({ region, rates: priced }) => (
              <tr key={region} className="border-b border-[var(--n-100)] last:border-0">
                <Td className="text-[var(--n-800)]">{region}</Td>
                <Td numeric>
                  {priced.length === 0 ? (
                    <span className="text-[var(--n-400)]">None</span>
                  ) : (
                    priced.length.toLocaleString("en-ZA")
                  )}
                </Td>
                <Td>
                  {priced.length === 0 ? (
                    <span className="text-[var(--n-400)]">Nothing priced here yet</span>
                  ) : (
                    [...new Set(priced.map((r) => r.trade ?? "Unclassified"))].sort().join(", ")
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {unstated.length > 0 && (
        <Panel title="No region stated" count={String(unstated.length)} tone="warn">
          <p className="t-sm text-[var(--n-600)]">
            These rates carry no province, so they apply everywhere and can&rsquo;t be compared regionally.
          </p>
        </Panel>
      )}
    </div>
  );
}

/** Every item that has been priced more than once, and what it did. */
function Trends({ rows }: { rows: readonly LibraryRate[] }) {
  const repriced = useMemo(() => {
    const seen = new Set<string>();
    const out: { item: LibraryRate; history: LibraryRate[] }[] = [];

    for (const row of rows) {
      const key = itemKey(row);
      if (seen.has(key)) continue;
      seen.add(key);

      const history = historyOf(rows, row);
      if (history.length > 1) out.push({ item: row, history });
    }

    return out;
  }, [rows]);

  return (
    <div id="trends" className="flex flex-col gap-4">
      <Panel title="Items priced more than once" count={String(repriced.length)} flush>
        {repriced.length === 0 ? (
          <Empty
            headline="Nothing has been repriced yet"
            detail="A trend needs two prices for the same item at different dates. File next quarter's guide and this fills itself in."
          />
        ) : (
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr className="border-b border-[var(--n-200)] bg-[var(--n-50)]">
                <Th className="w-[38%]">Description</Th>
                <Th className="w-[14%]">Region</Th>
                <Th className="w-[16%]" numeric>
                  Was
                </Th>
                <Th className="w-[16%]" numeric>
                  Now
                </Th>
                <Th className="w-[16%]" numeric>
                  Movement
                </Th>
              </tr>
            </thead>
            <tbody>
              {repriced.map(({ item, history }) => {
                const now = history[0]!;
                const was = history.at(-1)!;
                const scale = (r: LibraryRate) => Number(r.rate) / 10 ** r.ratePrecision;
                const move = ((scale(now) - scale(was)) / scale(was)) * 100;

                return (
                  <tr key={item.id} className="border-b border-[var(--n-100)] last:border-0">
                    <Td className="text-[var(--n-800)]">{item.description}</Td>
                    <Td>{item.region ?? <span className="text-[var(--n-400)]">Not stated</span>}</Td>
                    <Td numeric>{displayRate(was)}</Td>
                    <Td numeric className="font-medium text-[var(--n-800)]">
                      {displayRate(now)}
                    </Td>
                    {/* Amber for a rise, because on a cost plan that is the direction that needs
                        attention. The sign is in the text, so nothing rests on the colour. */}
                    <Td numeric className={move > 0 ? "text-[var(--warn-700)]" : "text-[var(--ok-700)]"}>
                      {move > 0 ? "+" : "−"}
                      {Math.abs(move).toFixed(1)}%
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
      {/*
        What building costs have done, and are forecast to do.

        A repricing trend above is this practice's own evidence and covers the items it has priced;
        this is the industry's, and covers the years nobody here has priced anything in. A cost plan
        carries an escalation allowance, and the figure to put in it is a published one or a guess.
      */}
      <Panel title="Tender price escalation" count={`${TENDER_ESCALATION.length} years`}>
        <p className="t-sm max-w-[85ch] text-[var(--n-600)]">
          From <strong>{PUBLISHED_COST_SOURCE}</strong>. BER tracks tender prices, CPAP input costs. The last column is
          BER ÷ CPAP: falling is a buyer&rsquo;s market.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table data-region="escalation" className="w-full border-collapse">
            <thead>
              <tr className="border-b border-[var(--n-200)] bg-[var(--n-50)]">
                <Th>Year</Th>
                <Th className="text-right">BER index</Th>
                <Th className="text-right">BER change</Th>
                <Th className="text-right">CPAP index</Th>
                <Th className="text-right">CPAP change</Th>
                <Th className="text-right">Tender market</Th>
              </tr>
            </thead>
            <tbody>
              {TENDER_ESCALATION.map((e) => (
                <tr key={e.year} data-year={e.year} className="border-b border-[var(--n-100)]">
                  <td className="t-sm px-3 py-1.5 text-[var(--n-800)]">
                    {e.year}
                    {e.forecast && <span className="t-xs ml-2 text-[var(--warn-700)]">forecast</span>}
                  </td>
                  <td className="num t-sm px-3 py-1.5 text-right">{(e.berIndex / 10).toFixed(1).replace(".", ",")}</td>
                  <td className="num t-sm px-3 py-1.5 text-right">{displayChange(e.berChange)}</td>
                  <td className="num t-sm px-3 py-1.5 text-right">{(e.cpapIndex / 10).toFixed(1).replace(".", ",")}</td>
                  <td className="num t-sm px-3 py-1.5 text-right">{displayChange(e.cpapChange)}</td>
                  <td className="num t-sm px-3 py-1.5 text-right">{(e.tenderMarketIndicator / 1000).toFixed(2).replace(".", ",")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="t-xs mt-2 max-w-[95ch] text-[var(--n-500)]">{ESCALATION_BASIS}</p>
      </Panel>
    </div>
  );
}

/**
 * The practice's own financial assumptions — PLATFORM.md §2.6, §6.3.
 *
 * Moved here from Settings. They are not preferences: these ten figures set an affordability
 * ceiling, pass or fail six gates and print a verdict on a client's report, which makes them cost
 * data and not administration. Settings is where a person is given or refused access.
 *
 * The warning stays with them, because it is the only surface that can say it: a practice that has
 * set nothing gets a report full of "stated assumptions" it never stated.
 */
function Assumptions({ assumptions }: { assumptions: readonly AssumptionInForce[] }) {
  const unset = assumptions.filter((a) => a.isDefault).length;
  const groups = ["Lending", "Market", "Funding"] as const;

  const note: Readonly<Record<(typeof groups)[number], string>> = {
    Lending: "What a household can borrow — and therefore the price ceiling every cost is tested against.",
    Market: "What prices and timing do while the scheme is being sold.",
    Funding: "What the development finance costs, and what return counts as a return.",
  };

  return (
    <div id="assumptions" className="flex flex-col gap-4">
      {unset > 0 && (
        <div
          data-region="assumptions-unset"
          className="rounded-[var(--r-lg)] border border-[var(--warn-500)] bg-[var(--warn-50)] px-4 py-3"
        >
          <p className="t-sm flex items-center gap-1.5 font-medium text-[var(--warn-700)]">
            <AlertTriangle aria-hidden size={13} strokeWidth={2} />
            {unset} of {assumptions.length} figures are still the platform&rsquo;s, not the
            practice&rsquo;s
          </p>
          <p className="t-sm mt-1 text-[var(--n-700)]">
            Reports are being printed on them now, described as stated assumptions. They are
            defensible defaults and they are not yours until you set them.
          </p>
        </div>
      )}

      {groups.map((group) => {
        const inGroup = assumptions.filter((a) => a.spec.group === group);
        if (inGroup.length === 0) return null;

        return (
          <section
            key={group}
            data-region={`assumptions-${group.toLowerCase()}`}
            className="overflow-hidden rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-0)]"
          >
            <div className="flex items-baseline gap-2 border-b border-[var(--n-200)] bg-[var(--n-50)] px-4 py-2.5">
              <SlidersHorizontal aria-hidden size={14} strokeWidth={2} className="text-[var(--a-700)]" />
              <h2 className="t-base font-semibold text-[var(--n-800)]">{group}</h2>
              <span className="t-sm ml-2 min-w-0 flex-1 truncate text-[var(--n-500)]">
                {note[group]}
              </span>
            </div>

            {inGroup.map((a) => (
              <AssumptionRow
                key={a.spec.key}
                spec={a.spec}
                value={a.value}
                isDefault={a.isDefault}
                effectiveFrom={a.effectiveFrom}
                setBy={a.setBy}
              />
            ))}
          </section>
        );
      })}

      <p className="t-sm max-w-[86ch] text-[var(--n-500)]">
        A change is kept as history, not overwritten – but it moves every report generated from now on.
      </p>
    </div>
  );
}

/** §7.5 — every list gets one. No blank canvases anywhere. */
function Empty({ headline, detail }: { headline: string; detail: string }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="t-base font-medium text-[var(--n-700)]">{headline}</p>
      <p className="t-sm mx-auto mt-1 max-w-[46ch] text-[var(--n-500)]">{detail}</p>
    </div>
  );
}

function Th({
  children,
  className = "",
  numeric,
}: {
  children: React.ReactNode;
  className?: string;
  numeric?: boolean;
}) {
  return (
    <th
      scope="col"
      className={`t-sm px-3 py-2 font-semibold tracking-[0.03em] text-[var(--n-600)] uppercase ${
        numeric ? "text-right" : "text-left"
      } ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
  numeric,
}: {
  children: React.ReactNode;
  className?: string;
  numeric?: boolean;
}) {
  return (
    <td
      className={`t-base px-3 py-2 align-top text-[var(--n-600)] ${
        numeric ? "num text-right" : ""
      } ${className}`}
    >
      {children}
    </td>
  );
}
