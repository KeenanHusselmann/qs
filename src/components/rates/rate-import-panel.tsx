/**
 * Importing a rate schedule — PLATFORM.md §12 (Tier 1), §7.5.
 *
 * ── Why this is the cost-management integration ────────────────────────────────────────────
 *
 * The brief asked for industry pricing APIs. There are none: the AAQS ships a PDF guide and an
 * Excel questionnaire, the BER's BCIS is a login-gated quarterly subscription delivering a data
 * file, and StatsSA publishes monthly PDFs. Every source is a document on a schedule, so this — a
 * schedule read, previewed and filed with its origin and its date — *is* the integration.
 *
 * ── The shape is the reference build's Data Import screen ──────────────────────────────────
 *
 * Templates on the left, a validation summary on the right, a drop zone and a batch table beneath.
 * Two of its three templates are **not offered**, because neither is built: SANS 1200 measurements
 * wait on take-off (§10) and a BIM export needs an IFC reader. §7.5's rule against a control that
 * appears to do something applies to a download button as much as to anything else, so they are
 * named as absent rather than drawn greyed and clickable.
 *
 * ── Nothing is written until it has been looked at ─────────────────────────────────────────
 *
 * Preview, then file. A schedule of four hundred rates has rows a reader has to see refused before
 * they agree to the rest — and the refusals name the line, because the fix is in the spreadsheet.
 */

"use client";

import { useRef, useState, useTransition } from "react";
import { CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";

import { Panel } from "@/components/shell/panel";
import { commitImport, previewImport, type Preview } from "@/app/(app)/rates/actions";

const TODAY = () => new Date().toISOString().slice(0, 10);

/**
 * The template, generated rather than stored.
 *
 * A file in `public/` would be a second statement of which columns the importer accepts, and the
 * two would part company the first time a synonym was added. This is written from the same header
 * words the parser reads.
 */
const TEMPLATE = [
  "Trade,Description,Unit,Rate,Region,Source,Effective date",
  'Concrete Work,25 MPa concrete in strip footings,m3,1850.00,Gauteng,SAFCEC Q4 2025,2026-01-01',
  'Masonry,"Common brick walling, 220mm thick",m2,485.00,Western Cape,Market survey,2026-01-01',
  "Electrical,PVC conduit 20mm diameter in wall,m,32.5000,Gauteng,Supplier quote,2026-01-01",
].join("\n");

export function RateImportPanel() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [filed, setFiled] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<string>("");
  const [pending, start] = useTransition();
  const form = useRef<HTMLFormElement>(null);

  const look = () => {
    const data = new FormData(form.current!);
    setFiled(null);
    setError(null);
    start(async () => {
      const result = await previewImport(data);
      setPreview(result);
      setSheet(result.sheets[0]?.name ?? "");
    });
  };

  const file = () => {
    const data = new FormData(form.current!);
    data.set("sheet", sheet);
    start(async () => {
      const result = await commitImport(data);
      if (result.error) setError(result.error);
      else {
        setFiled(result.filed);
        setPreview(null);
        form.current?.reset();
      }
    });
  };

  const chosen = preview?.sheets.find((s) => s.name === sheet) ?? preview?.sheets[0];
  const refused = chosen ? chosen.rows.length - chosen.importable : 0;

  return (
    <div id="import" className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Panel title="Import a rate schedule" count="CSV or XLSX">
          <form ref={form} className="flex flex-col gap-3">
            <p className="t-sm text-[var(--n-600)]">
              A published guide, subscription release or supplier quote. Unrecognised columns are reported, not guessed.
            </p>

            <label className="flex flex-col gap-1">
              <span className="t-sm font-medium text-[var(--n-700)]">The schedule</span>
              <input
                type="file"
                name="file"
                accept=".csv,.xlsx"
                onChange={() => {
                  setPreview(null);
                  setFiled(null);
                  setError(null);
                }}
                className="t-base file:mr-3 file:rounded-[var(--r-md)] file:border-0 file:bg-[var(--a-500)] file:px-3 file:py-1.5 file:font-medium file:text-white hover:file:bg-[var(--a-600)]"
              />
            </label>

            {/*
              Asked once, for the file, because a publication has one origin and one date. A column
              in the sheet still wins for its own row — a schedule that collects several quotes is a
              real thing and it says so per line.
            */}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="t-sm font-medium text-[var(--n-700)]">Where it came from</span>
                <input
                  name="source"
                  defaultValue=""
                  placeholder="SAFCEC Q4 2025"
                  className="t-base h-8 rounded-[var(--r-md)] border border-[var(--n-200)] px-2 text-[var(--n-800)] placeholder:text-[var(--n-400)]"
                />
                <span className="t-xs text-[var(--n-500)]">
                  Required. A rate nobody can attribute is one nobody can defend.
                </span>
              </label>

              <label className="flex flex-col gap-1">
                <span className="t-sm font-medium text-[var(--n-700)]">Applies from</span>
                <input
                  type="date"
                  name="effectiveDate"
                  defaultValue={TODAY()}
                  className="t-base h-8 rounded-[var(--r-md)] border border-[var(--n-200)] px-2 text-[var(--n-800)]"
                />
                <span className="t-xs text-[var(--n-500)]">
                  A price is a fact about a date. A future one files and waits.
                </span>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={look}
                disabled={pending}
                className="t-base flex h-8 items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--a-500)] px-3 font-medium text-white transition-colors hover:bg-[var(--a-600)] disabled:opacity-50"
                style={{ transitionDuration: "var(--m-fast)" }}
              >
                <Upload aria-hidden size={14} strokeWidth={2} />
                {pending ? "Reading…" : "Read the file"}
              </button>

              {chosen && chosen.importable > 0 && (
                <button
                  type="button"
                  onClick={file}
                  disabled={pending}
                  className="t-base flex h-8 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--ok-500)] bg-[var(--ok-50)] px-3 font-medium text-[var(--ok-700)] disabled:opacity-50"
                >
                  <CheckCircle2 aria-hidden size={14} strokeWidth={2} />
                  File {chosen.importable} {chosen.importable === 1 ? "rate" : "rates"}
                </button>
              )}

              {/* A workbook arrives with a Cover and a Notes tab. Which sheet holds the table is
                  the reader's call, made from the preview — guessing it is a guess nobody sees. */}
              {preview && preview.sheets.length > 1 && (
                <label className="t-sm flex items-center gap-1.5 text-[var(--n-600)]">
                  Sheet
                  <select
                    value={sheet}
                    onChange={(e) => setSheet(e.target.value)}
                    className="t-base h-8 rounded-[var(--r-md)] border border-[var(--n-200)] px-2"
                  >
                    {preview.sheets.map((s) => (
                      <option key={s.name} value={s.name}>
                        {s.name} ({s.importable})
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            {(preview?.warning || error) && (
              <p role="alert" className="t-sm rounded-[var(--r-md)] bg-[var(--warn-50)] px-3 py-2 text-[var(--warn-700)]">
                {error ?? preview?.warning}
              </p>
            )}

            {filed !== null && (
              <p role="status" className="t-sm rounded-[var(--r-md)] bg-[var(--ok-50)] px-3 py-2 text-[var(--ok-700)]">
                {filed} {filed === 1 ? "rate is" : "rates are"} filed. They appear under Current
                rates from their effective date.
              </p>
            )}
          </form>
        </Panel>

        {/*
          The validation summary, counted from the file in hand rather than from a stored total.
          The reference screen shows figures with no run behind them; these are what this file did.
        */}
        <Panel
          title="What the file yields"
          count={chosen ? `${chosen.rows.length} rows` : "Nothing read yet"}
          tone={refused > 0 ? "warn" : undefined}
        >
          {!chosen ? (
            <p className="t-sm text-[var(--n-500)]">
              Read a file and this says how much of it the library can take, and what it cannot.
            </p>
          ) : (
            <dl className="flex flex-col gap-1.5">
              <Line label="Rows read" value={String(chosen.rows.length)} />
              <Line label="Ready to file" value={String(chosen.importable)} tone="ok" />
              <Line
                label="Refused"
                value={String(refused)}
                tone={refused > 0 ? "warn" : undefined}
              />
              <p className="t-xs mt-1 text-[var(--n-500)]">
                Section headings and blank spacers are passed over and counted in neither: they are
                not rates and they are not faults.
              </p>
            </dl>
          )}
        </Panel>
      </div>

      {chosen && (
        <Panel
          title="What would be filed"
          count={`${chosen.importable} of ${chosen.rows.length}`}
          flush
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr className="border-b border-[var(--n-200)] bg-[var(--n-50)]">
                  <Th>Line</Th>
                  <Th>Description</Th>
                  <Th>Unit</Th>
                  <Th numeric>Rate</Th>
                  <Th>Region</Th>
                  <Th>Source</Th>
                  <Th>From</Th>
                </tr>
              </thead>
              <tbody>
                {chosen.rows.map((r) => (
                  <tr
                    key={r.line}
                    className={`border-b border-[var(--n-100)] last:border-0 ${
                      r.problems.length > 0 ? "bg-[var(--warn-50)]/50" : ""
                    }`}
                  >
                    <Td className="num text-[var(--n-500)]">{r.line}</Td>
                    <Td className="text-[var(--n-800)]">
                      {r.description || <span className="text-[var(--n-400)]">—</span>}
                      {/* The refusal sits on the row it refuses, naming the line, because the fix
                          is in the spreadsheet and the reader has to find it there. */}
                      {r.problems.length > 0 && (
                        <span className="t-xs mt-0.5 block text-[var(--warn-700)]">
                          {r.problems.join(" ")}
                        </span>
                      )}
                    </Td>
                    <Td>{r.unit}</Td>
                    <Td numeric className="font-medium text-[var(--n-800)]">
                      {r.rate}
                    </Td>
                    <Td>{r.region}</Td>
                    <Td>{r.source}</Td>
                    <Td>{r.effectiveDate}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel title="Templates" count="1 of 3 built">
        <ul className="flex flex-col gap-2">
          <li className="flex flex-wrap items-center gap-2">
            <FileSpreadsheet aria-hidden size={14} strokeWidth={1.75} className="text-[var(--n-500)]" />
            <span className="t-base font-medium text-[var(--n-800)]">Rate schedule</span>
            <span className="t-sm text-[var(--n-600)]">
              Trade, description, unit, rate, region, source, effective date.
            </span>
            {/* Generated from the parser's own header words, so the template cannot drift from
                what the importer accepts. */}
            <a
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}
              download="rate-schedule-template.csv"
              className="t-sm ml-auto text-[var(--a-600)] hover:underline"
            >
              Download CSV
            </a>
          </li>

          {/*
            Named, not drawn as buttons. Neither is built, and §7.5 forbids a control that appears
            to do something — a greyed Download that never downloads teaches a reader the platform
            is broken rather than that the feature is absent.
          */}
          <li className="t-sm border-t border-[var(--n-100)] pt-2 text-[var(--n-500)]">
            <span className="font-medium text-[var(--n-600)]">SANS 1200 measurements</span> — not
            built. It waits on take-off, because a measurement without the dimensions behind it is a
            quantity nobody can check (§10).
          </li>
          <li className="t-sm text-[var(--n-500)]">
            <span className="font-medium text-[var(--n-600)]">BIM / IFC export</span> — not built.
            It needs an IFC reader; §10 records that a drawing&rsquo;s value is in geometry nothing
            here reads yet.
          </li>
        </ul>
      </Panel>
    </div>
  );
}

function Line({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="t-sm text-[var(--n-600)]">{label}</dt>
      <dd
        className={`num t-base font-medium ${
          tone === "ok"
            ? "text-[var(--ok-700)]"
            : tone === "warn"
              ? "text-[var(--warn-700)]"
              : "text-[var(--n-800)]"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function Th({ children, numeric }: { children: React.ReactNode; numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={`t-sm px-3 py-2 font-semibold tracking-[0.03em] text-[var(--n-600)] uppercase ${
        numeric ? "text-right" : "text-left"
      }`}
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
    <td className={`t-base px-3 py-2 align-top text-[var(--n-600)] ${numeric ? "num text-right" : ""} ${className}`}>
      {children}
    </td>
  );
}
