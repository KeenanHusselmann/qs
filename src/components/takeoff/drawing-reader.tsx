"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ScanSearch } from "lucide-react";

import {
  interpretFiledDrawing,
  readFiledDrawing,
  type DrawingInterpretOutcome,
  type DrawingReadOptions,
  type DrawingReadOutcome,
} from "@/app/(app)/projects/[id]/drawing-actions";
import type { StatedUnits } from "@/domain/cad/read-drawing";
import { isReadableDrawing } from "@/lib/cad/readable";

/**
 * Read a drawing – the drawing reader (`domain/cad`) on a filed drawing, PLATFORM.md §10.
 *
 * It measures the drawing's closed outlines, traces erven from a boundary pen, counts blocks and
 * checks every printed area against the outline it sits in – then shows, for any figure, the
 * linework it was measured from. Nothing is saved: it is evidence to look at, and what a QS takes
 * from it into a sheet they take by hand (§10.5, the manual path always exists).
 *
 * The picture is drawn once per reading. Picking a row highlights in the browser, by the handles
 * `renderSvg` writes onto each shape, because reading an A0 sheet again for every click would cost
 * five seconds a time.
 */

const ROWS = 150;

const fmt = (n: number | null | undefined, dp = 2) =>
  n === null || n === undefined ? "–" : Number(n).toLocaleString("en-ZA", { minimumFractionDigits: dp, maximumFractionDigits: dp });

type Read = Extract<DrawingReadOutcome, { ok: true }>;
type Picked = { handles: readonly string[]; label: string; key: string } | null;

export function DrawingReader({ projectId, drawings }: { projectId: string; drawings: readonly { id: string; name: string }[] }) {
  const readable = useMemo(() => drawings.filter((d) => isReadableDrawing(d.name)), [drawings]);
  const [documentId, setDocumentId] = useState(readable[0]?.id ?? "");
  const [units, setUnits] = useState<"" | StatedUnits>("");
  const [scale, setScale] = useState("");
  const [snap, setSnap] = useState("0.5");
  const [regions, setRegions] = useState<readonly string[]>([]);

  const [reading, startRead] = useTransition();
  const [interpreting, startInterpret] = useTransition();
  const [outcome, setOutcome] = useState<DrawingReadOutcome | null>(null);
  const [interpretation, setInterpretation] = useState<DrawingInterpretOutcome | null>(null);
  const [picked, setPicked] = useState<Picked>(null);
  /** The options the shown reading was made with – Interpret must ask about the same reading. */
  const [readWith, setReadWith] = useState<{ documentId: string; options: DrawingReadOptions } | null>(null);

  if (readable.length === 0) {
    return (
      <div data-region="drawing-reader" className="px-4 py-3">
        <p className="t-base font-medium text-[var(--n-800)]">Read a drawing</p>
        <p className="t-sm mt-0.5 max-w-[90ch] text-[var(--n-600)]">
          The drawings filed on this project are not PDFs or DXFs. File the PDF plotted from the CAD package to read its outlines and check its printed areas.
        </p>
      </div>
    );
  }

  const optionsWith = (pens: readonly string[]): DrawingReadOptions => ({
    ...(units ? { units } : {}),
    ...(scale.trim() ? { scale: Number(scale) } : {}),
    ...(snap.trim() ? { snap: Number(snap) } : {}),
    ...(pens.length ? { regions: [...pens] } : {}),
  });

  const run = (id: string, pens: readonly string[]) => {
    const options = optionsWith(pens);
    startRead(async () => {
      setPicked(null);
      setInterpretation(null);
      try {
        const out = await readFiledDrawing(projectId, id, options);
        setOutcome(out);
        if (out.ok) setReadWith({ documentId: id, options });
      } catch {
        // A function that died rather than answered – said, not left as a button that did nothing.
        setOutcome({ ok: false, reason: "The server stopped before it answered. Try again; if it keeps happening the server's log will say why." });
      }
    });
  };

  const togglePen = (pen: string) => {
    const next = regions.includes(pen) ? regions.filter((p) => p !== pen) : [...regions, pen];
    setRegions(next);
    run(documentId, next);
  };

  const interpret = () => {
    if (!readWith) return;
    startInterpret(async () => {
      setInterpretation(null);
      try {
        setInterpretation(await interpretFiledDrawing(projectId, readWith.documentId, readWith.options));
      } catch {
        setInterpretation({ ok: false, reason: "The server stopped before it answered. Try again; if it keeps happening the server's log will say why." });
      }
    });
  };

  const read = outcome?.ok ? outcome : null;
  const field = "t-sm h-8 rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] px-2 text-[var(--n-800)]";

  return (
    <div data-region="drawing-reader" className="px-4 py-3">
      <div className="flex flex-wrap items-start gap-3">
        <ScanSearch aria-hidden size={16} strokeWidth={1.75} className="mt-0.5 text-[var(--a-600)]" />
        <div className="min-w-0 flex-1">
          <p className="t-base font-medium text-[var(--n-800)]">Read a drawing</p>
          <p className="t-sm mt-0.5 max-w-[90ch] text-[var(--n-600)]">
            Measures the closed outlines on a filed PDF or DXF, traces erven from the pen their boundaries are drawn with, and checks every printed area
            against the outline it sits in. Pick any figure to see what it was measured from. Nothing is saved – carry what you accept into a sheet below.
          </p>

          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="flex min-w-[16rem] flex-col gap-0.5">
              <span className="t-xs text-[var(--n-500)]">Drawing</span>
              <select
                data-field="drawing"
                value={documentId}
                disabled={reading}
                onChange={(e) => {
                  setDocumentId(e.target.value);
                  setRegions([]);
                  setOutcome(null);
                  setInterpretation(null);
                  setPicked(null);
                }}
                className={field}
              >
                {readable.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex w-28 flex-col gap-0.5">
              <span className="t-xs text-[var(--n-500)]">PDF scale 1:</span>
              <input data-field="scale" type="number" min={1} max={100000} step={1} value={scale} placeholder="from sheet" onChange={(e) => setScale(e.target.value)} className={field} />
            </label>
            <label className="flex w-28 flex-col gap-0.5">
              <span className="t-xs text-[var(--n-500)]">DXF units</span>
              <select data-field="units" value={units} onChange={(e) => setUnits(e.target.value as "" | StatedUnits)} className={field}>
                <option value="">from drawing</option>
                <option value="mm">mm</option>
                <option value="cm">cm</option>
                <option value="m">m</option>
              </select>
            </label>
            <label className="flex w-32 flex-col gap-0.5">
              <span className="t-xs text-[var(--n-500)]">Close gaps up to (m)</span>
              <input data-field="snap" type="number" min={0.01} max={20} step={0.1} value={snap} onChange={(e) => setSnap(e.target.value)} className={field} />
            </label>
          </div>
        </div>
        <button
          type="button"
          data-action="read-drawing"
          disabled={reading || !documentId}
          onClick={() => run(documentId, regions)}
          className="t-base flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--n-800)] px-3 font-medium text-white hover:bg-[var(--n-900)] disabled:opacity-50"
        >
          <ScanSearch aria-hidden size={13} strokeWidth={2.25} />
          {reading ? "Reading…" : read ? "Read again" : "Read the drawing"}
        </button>
      </div>

      {reading && <p className="t-sm mt-2 text-[var(--n-500)]">Reading – an A0 sheet takes a few seconds.</p>}
      {outcome && !outcome.ok && (
        <p role="alert" className="t-sm mt-2 text-[var(--err-700)]">
          {outcome.reason}
        </p>
      )}

      {read && (
        <div data-region="drawing-reading" className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="flex max-h-[80vh] min-w-0 flex-col gap-3 overflow-auto pr-1">
            <Summary read={read} />
            {read.kind === "pdf" && <Pens read={read} regions={regions} disabled={reading} onToggle={togglePen} />}
            <Loops read={read} picked={picked} onPick={setPicked} />
            <Checks read={read} picked={picked} onPick={setPicked} />
            <Blocks read={read} picked={picked} onPick={setPicked} />
            <Interpret outcome={interpretation} pending={interpreting} onInterpret={interpret} picked={picked} onPick={setPicked} />
            <NotMeasured read={read} />
          </div>
          <div className="min-w-0 lg:sticky lg:top-4 lg:self-start">
            <div className="rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-0)]">
              <div className="t-sm flex flex-wrap items-center gap-2 border-b border-[var(--n-100)] px-3 py-2">
                <span className="font-medium text-[var(--n-800)]">{read.name}</span>
                {picked ? (
                  <>
                    <span data-region="drawing-picked" className="text-[var(--n-500)]">
                      · showing {picked.label}
                    </span>
                    <button type="button" onClick={() => setPicked(null)} className="t-xs ml-auto text-[var(--a-700)] underline underline-offset-2">
                      Clear
                    </button>
                  </>
                ) : (
                  <span className="text-[var(--n-500)]">· pick a row to see what it was measured from</span>
                )}
              </div>
              {read.svg ? (
                <Picture svg={read.svg} picked={picked} />
              ) : (
                <p className="t-sm px-3 py-10 text-center text-[var(--n-500)]">No picture for this drawing – see &ldquo;Not measured, and why&rdquo;.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The drawing, with whatever is picked out.
 *
 * The SVG is set once per reading and then only re-classed. It comes from `renderSvg`, which
 * escapes every piece of drawing text and writes numbers into paths – the same guarantee the local
 * viewer relies on to place it as markup.
 */
const PICTURE_CSS = `
[data-cad-picture] svg { display:block; max-width:100%; height:auto; }
[data-cad-picture] path.cad-on { stroke:#4a7722; stroke-width:2.5px; vector-effect:non-scaling-stroke; }
[data-cad-picture] path.cad-on[data-z] { fill:#8dc63f; fill-opacity:.28; }
[data-cad-picture] text.cad-on { fill:#2e4b15; font-weight:700; }
`;

function Picture({ svg, picked }: { svg: string; picked: Picked }) {
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (holder.current) holder.current.innerHTML = svg;
  }, [svg]);

  useEffect(() => {
    const root = holder.current?.querySelector("svg");
    if (!root) return;
    const wanted = new Set(picked?.handles ?? []);
    const on: Element[] = [];
    for (const el of root.querySelectorAll("[data-h]")) {
      const hit = wanted.size > 0 && (el.getAttribute("data-h") ?? "").split(" ").some((h) => wanted.has(h));
      el.classList.toggle("cad-on", hit);
      if (hit) on.push(el);
    }
    // Drawn last, so the picked outline is not hidden under the linework around it.
    for (const el of on) root.appendChild(el);
  }, [picked, svg]);

  return (
    <>
      <style>{PICTURE_CSS}</style>
      <div ref={holder} data-cad-picture="" data-region="drawing-picture" className="overflow-auto p-2" />
    </>
  );
}

function Section({ title, count, children, region }: { title: string; count?: string; children: React.ReactNode; region: string }) {
  return (
    <section data-region={region} className="rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-0)] px-3 py-2.5">
      <h3 className="t-sm mb-1.5 flex items-center gap-2 font-medium text-[var(--n-800)]">
        {title}
        {count !== undefined && <span className="font-normal text-[var(--n-500)]">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

const th = "t-xs px-1.5 py-1 text-left font-medium text-[var(--n-500)]";
const thn = `${th} text-right`;
const td = "px-1.5 py-1 align-top border-t border-[var(--n-100)]";
const tdn = `${td} text-right tabular-nums`;

function Badge({ tone, children }: { tone: "ok" | "bad" | "warn" | "info"; children: React.ReactNode }) {
  const cls = {
    ok: "bg-[var(--ok-50)] text-[var(--ok-700)]",
    bad: "bg-[var(--err-50)] text-[var(--err-700)]",
    warn: "bg-[var(--warn-50)] text-[var(--warn-700)]",
    info: "bg-[var(--n-100)] text-[var(--n-700)]",
  }[tone];
  return <span className={`t-xs inline-block whitespace-nowrap rounded-full px-2 py-px ${cls}`}>{children}</span>;
}

/** A row that picks its linework out of the picture. */
function PickRow({ pick, picked, onPick, children, region }: { pick: NonNullable<Picked>; picked: Picked; onPick: (p: Picked) => void; children: React.ReactNode; region?: string }) {
  const on = picked?.key === pick.key;
  return (
    <tr
      data-pick={region}
      aria-selected={on}
      tabIndex={0}
      onClick={() => onPick(on ? null : pick)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick(on ? null : pick);
        }
      }}
      className={`cursor-pointer hover:bg-[var(--n-50)] ${on ? "bg-[var(--a-50)] shadow-[inset_3px_0_0_var(--a-500)]" : ""}`}
    >
      {children}
    </tr>
  );
}

function Summary({ read }: { read: Read }) {
  const r = read.report;
  const inserts = r.blocks.reduce((s, b) => s + b.inserts, 0);
  return (
    <Section region="drawing-summary" title={read.kind === "pdf" ? "Scale" : "Units"}>
      <p className="t-sm text-[var(--n-700)]">
        {read.kind === "pdf" ? (
          <>
            <span className="font-medium text-[var(--n-800)]">{read.scale?.value ? `1:${read.scale.value}` : "Not known"}</span>{" "}
            <span className="text-[var(--n-500)]">{read.scale?.reason}</span>
          </>
        ) : (
          <>
            <span className="font-medium text-[var(--n-800)]">{r.units.name}</span>{" "}
            <span className="text-[var(--n-500)]">{r.units.statedBy ? `stated by the ${r.units.statedBy}` : "not stated – areas withheld"}</span>
          </>
        )}
      </p>
      <p className="t-sm mt-1 text-[var(--n-500)]">
        {r.loops.length} closed outlines · {inserts} block inserts · {r.areaChecks.filter((c) => c.agrees === true).length} of {r.areaChecks.length} printed areas agree
      </p>
    </Section>
  );
}

/** For a PDF the layers are pens. The erf boundaries are one of them; choosing it traces the erven. */
function Pens({ read, regions, disabled, onToggle }: { read: Read; regions: readonly string[]; disabled: boolean; onToggle: (pen: string) => void }) {
  const pens = read.report.layers
    .filter((l) => /^(stroke|fill) /.test(l.name))
    .sort((a, b) => (b.length ?? 0) - (a.length ?? 0))
    .slice(0, 14);
  if (pens.length === 0) return null;
  return (
    <Section region="drawing-pens" title="Pens" count="the PDF's stand-in for CAD layers">
      <p className="t-xs mb-1.5 text-[var(--n-500)]">Pick the pen the erf boundaries are drawn with. Its lines are traced into regions, and each printed area is checked against the region it sits in.</p>
      <table className="t-sm w-full">
        <thead>
          <tr>
            <th className={th}>Pen</th>
            <th className={thn}>Pieces</th>
            <th className={thn}>Length m</th>
            <th className={thn}>Closed</th>
            <th className={th} />
          </tr>
        </thead>
        <tbody>
          {pens.map((p) => {
            const on = regions.includes(p.name);
            const colour = /#[0-9a-f]{6}/i.exec(p.name)?.[0];
            return (
              <tr key={p.name}>
                <td className={td}>
                  {colour && <span aria-hidden className="mr-1.5 inline-block size-2.5 rounded-sm align-middle" style={{ background: colour }} />}
                  {p.name}
                </td>
                <td className={tdn}>{Object.values(p.counts).reduce((s, n) => s + (n ?? 0), 0)}</td>
                <td className={tdn}>{fmt(p.length, 0)}</td>
                <td className={tdn}>{p.loops}</td>
                <td className={td}>
                  <button
                    type="button"
                    data-action="trace-pen"
                    data-pen={p.name}
                    disabled={disabled}
                    onClick={() => onToggle(p.name)}
                    className={`t-xs h-6 rounded-[var(--r-md)] border px-2 disabled:opacity-50 ${on ? "border-[var(--a-600)] bg-[var(--a-600)] text-white" : "border-[var(--n-200)] text-[var(--n-700)]"}`}
                  >
                    {on ? "Tracing ✓" : "Trace regions"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Section>
  );
}

function Loops({ read, picked, onPick }: { read: Read; picked: Picked; onPick: (p: Picked) => void }) {
  const loops = read.report.loops;
  // An A0 sheet has thousands of outlines: traced regions first, then the largest, and say how many are not listed.
  const ordered = [...loops].sort((a, b) => ((a.source === "region") !== (b.source === "region") ? (a.source === "region" ? -1 : 1) : (b.area ?? 0) - (a.area ?? 0)));
  const hidden = Math.max(0, ordered.length - ROWS);
  return (
    <Section region="drawing-loops" title="Closed outlines" count={String(loops.length)}>
      <table className="t-sm w-full">
        <thead>
          <tr>
            <th className={th}>Id</th>
            <th className={th}>Layer</th>
            <th className={thn}>Area m²</th>
            <th className={thn}>Net m²</th>
            <th className={thn}>Perim. m</th>
            <th className={th}>From</th>
          </tr>
        </thead>
        <tbody>
          {ordered.slice(0, ROWS).map((l) => (
            <PickRow key={l.id} region="loop" pick={{ key: `loop:${l.id}`, label: l.id, handles: l.handles }} picked={picked} onPick={onPick}>
              <td className={`${td} font-medium`}>{l.id}</td>
              <td className={td}>
                {l.layer} {l.block && <Badge tone="info">{l.block}</Badge>}
                {l.inside && <div className="t-xs text-[var(--n-500)]">inside {l.inside}</div>}
              </td>
              <td className={tdn}>{fmt(l.area)}</td>
              <td className={tdn}>{fmt(l.net)}</td>
              <td className={tdn}>{fmt(l.perimeter)}</td>
              <td className={td}>
                <Badge tone={l.source === "chain" ? "warn" : l.source === "region" ? "ok" : "info"}>
                  {l.source === "chain" ? "joined lines" : l.source === "region" ? "traced region" : l.source}
                </Badge>
              </td>
            </PickRow>
          ))}
          {hidden > 0 && (
            <tr>
              <td colSpan={6} className={`${td} t-xs text-[var(--n-500)]`}>
                {hidden} smaller outlines not listed.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Section>
  );
}

function Checks({ read, picked, onPick }: { read: Read; picked: Picked; onPick: (p: Picked) => void }) {
  const r = read.report;
  const order = (agrees: boolean | null) => (agrees === true ? 0 : agrees === false ? 1 : 2);
  const shown = r.areaChecks.map((c, i) => ({ c, i })).sort((a, b) => order(a.c.agrees) - order(b.c.agrees)).slice(0, ROWS);
  return (
    <Section region="drawing-checks" title="Printed areas against the geometry" count={`${r.areaChecks.filter((c) => c.agrees === true).length} of ${r.areaChecks.length} agree`}>
      {r.areaChecks.length === 0 ? (
        <p className="t-sm text-[var(--n-500)]">No area is printed on this drawing, so there is nothing to check the outlines against.</p>
      ) : (
        <table className="t-sm w-full">
          <thead>
            <tr>
              <th className={th}>Label</th>
              <th className={thn}>Printed</th>
              <th className={thn}>Measured</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {shown.map(({ c, i }) => {
              const loop = r.loops.find((l) => l.id === c.loop);
              const handles = [...(loop?.handles ?? []), ...(c.textHandle ? [c.textHandle] : [])];
              return (
                <PickRow key={i} region="check" pick={{ key: `check:${i}`, label: c.loop ?? "the label", handles }} picked={picked} onPick={onPick}>
                  <td className={td}>
                    {c.text.replace(/\n/g, " ")} {c.block && <Badge tone="info">{c.block}</Badge>}
                    <div className="t-xs text-[var(--n-500)]">{c.reason}</div>
                  </td>
                  <td className={tdn}>{fmt(c.stated)}</td>
                  <td className={tdn}>{fmt(c.computed)}</td>
                  <td className={td}>
                    {c.agrees === true ? <Badge tone="ok">agrees</Badge> : c.agrees === false ? <Badge tone="bad">disagrees</Badge> : <Badge tone="warn">not checked</Badge>}
                  </td>
                </PickRow>
              );
            })}
          </tbody>
        </table>
      )}
    </Section>
  );
}

function Blocks({ read, picked, onPick }: { read: Read; picked: Picked; onPick: (p: Picked) => void }) {
  const blocks = read.report.blocks;
  if (blocks.length === 0) return null;
  return (
    <Section region="drawing-blocks" title="Blocks" count={String(blocks.length)}>
      <table className="t-sm w-full">
        <thead>
          <tr>
            <th className={th}>Block</th>
            <th className={thn}>Inserts</th>
            <th className={thn}>Each m²</th>
            <th className={thn}>Total m²</th>
          </tr>
        </thead>
        <tbody>
          {blocks.map((b) => (
            <PickRow key={b.name} region="block" pick={{ key: `block:${b.name}`, label: b.name, handles: b.handles }} picked={picked} onPick={onPick}>
              <td className={`${td} font-medium`}>{b.name}</td>
              <td className={tdn}>{b.inserts}</td>
              <td className={tdn}>{fmt(b.footprint)}</td>
              <td className={tdn}>{fmt(b.totalFootprint)}</td>
            </PickRow>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function Interpret({
  outcome,
  pending,
  onInterpret,
  picked,
  onPick,
}: {
  outcome: DrawingInterpretOutcome | null;
  pending: boolean;
  onInterpret: () => void;
  picked: Picked;
  onPick: (p: Picked) => void;
}) {
  const role = (r: string) => <Badge tone="info">{r.replace(/_/g, " ")}</Badge>;
  return (
    <Section region="drawing-interpret" title="What each part is">
      <p className="t-xs mb-1.5 text-[var(--n-500)]">
        Asks the model what each outline and block is – site, footprint, unit type – from what was measured: ids, layers, blocks and labels, never the drawing itself.
        Every figure below is the platform&rsquo;s arithmetic, never the model&rsquo;s.
      </p>
      <button
        type="button"
        data-action="interpret-drawing"
        disabled={pending}
        onClick={onInterpret}
        className="t-sm flex h-7 items-center rounded-[var(--r-md)] border border-[var(--n-200)] px-2.5 font-medium text-[var(--n-800)] hover:bg-[var(--n-50)] disabled:opacity-50"
      >
        {pending ? "Asking…" : outcome?.ok ? "Ask again" : "Interpret"}
      </button>
      {outcome && !outcome.ok && (
        <p role="alert" className="t-sm mt-2 text-[var(--err-700)]">
          {outcome.reason}
        </p>
      )}
      {outcome?.ok && (
        <div data-region="drawing-schedule" className="mt-2 flex flex-col gap-2">
          <p className="t-xs font-medium text-[var(--n-700)]">
            Concept schedule <Badge tone="warn">proposed – confirm the roles</Badge>
          </p>
          <table className="t-sm w-full">
            <tbody>
              {outcome.schedule.lines.map((l, i) => (
                <PickRow key={i} region="schedule" pick={{ key: `schedule:${i}`, label: l.label, handles: l.handles }} picked={picked} onPick={onPick}>
                  <td className={td}>
                    {l.label}
                    <div className="t-xs text-[var(--n-500)]">{l.working}</div>
                  </td>
                  <td className={`${tdn} font-medium`}>
                    {l.value === null ? "–" : l.unit === "ratio" ? `${fmt(l.value * 100, 1)}%` : l.unit === "no" ? l.value : `${fmt(l.value)} m²`}
                  </td>
                </PickRow>
              ))}
            </tbody>
          </table>
          {outcome.schedule.unitMix.length > 0 && (
            <table className="t-sm w-full">
              <thead>
                <tr>
                  <th className={th}>Unit</th>
                  <th className={thn}>No.</th>
                  <th className={thn}>Each m²</th>
                  <th className={thn}>Total m²</th>
                </tr>
              </thead>
              <tbody>
                {outcome.schedule.unitMix.map((u) => (
                  <PickRow key={u.block} region="unit" pick={{ key: `unit:${u.block}`, label: u.name ?? u.block, handles: u.handles }} picked={picked} onPick={onPick}>
                    <td className={td}>{u.name ?? u.block}</td>
                    <td className={tdn}>{u.count}</td>
                    <td className={tdn}>{fmt(u.each)}</td>
                    <td className={tdn}>{fmt(u.total)}</td>
                  </PickRow>
                ))}
              </tbody>
            </table>
          )}
          {outcome.schedule.checks.length > 0 && (
            <ul className="t-sm flex list-disc flex-col gap-0.5 pl-5 text-[var(--n-700)]">
              {outcome.schedule.checks.map((c, i) => (
                <li key={i}>
                  {c.agrees === true ? <Badge tone="ok">agrees</Badge> : c.agrees === false ? <Badge tone="bad">check</Badge> : null} {c.label}: {c.detail}
                </li>
              ))}
            </ul>
          )}
          <details className="t-sm text-[var(--n-700)]">
            <summary className="cursor-pointer text-[var(--n-600)]">What the model said each part is</summary>
            <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5">
              {outcome.interpretation.loops.map((l) => (
                <li key={`l:${l.loop}`}>
                  <span className="font-medium">{l.loop}</span> {role(l.role)} <span className="text-[var(--n-500)]">{l.reason}</span>
                </li>
              ))}
              {outcome.interpretation.blocks.map((b) => (
                <li key={`b:${b.block}`}>
                  <span className="font-medium">{b.block}</span> {role(b.role)} {b.name ? `“${b.name}”` : null} <span className="text-[var(--n-500)]">{b.reason}</span>
                </li>
              ))}
            </ul>
          </details>
          {(outcome.interpretation.refused.length > 0 || outcome.interpretation.conflicts.length > 0) && (
            <div className="t-sm text-[var(--warn-700)]">
              <p>Refused or contradictory:</p>
              <ul className="mt-0.5 flex list-disc flex-col gap-0.5 pl-5">
                {outcome.interpretation.refused.map((r, i) => (
                  <li key={`r:${i}`}>
                    {r.label} – {r.reason}
                  </li>
                ))}
                {outcome.interpretation.conflicts.map((c, i) => (
                  <li key={`c:${i}`}>{c}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="t-xs text-[var(--n-500)]">
            {outcome.usage.input} tokens in, {outcome.usage.output} out.
          </p>
        </div>
      )}
    </Section>
  );
}

function NotMeasured({ read }: { read: Read }) {
  const r = read.report;
  const items = [
    ...Object.entries(r.skipped).map(([k, v]) => `${v} × ${k} – not read`),
    ...r.open.map((o) => `Open chain on ${o.layer} (${o.handles.slice(0, 6).join(", ")}${o.handles.length > 6 ? ", …" : ""}), gap ${fmt(o.gapMetres)} m – not measured`),
    ...(r.openCount > r.open.length ? [`…and ${r.openCount - r.open.length} more open chains`] : []),
    ...r.junctions.map((j) => `${j.meeting} pieces meet on ${j.layer} – not measured`),
    ...(r.junctionCount > r.junctions.length ? [`…and ${r.junctionCount - r.junctions.length} more junctions`] : []),
    ...r.notes,
    ...read.pictureNotes,
  ];
  if (items.length === 0) return null;
  return (
    <Section region="drawing-not-measured" title="Not measured, and why">
      <ul className="t-sm flex list-disc flex-col gap-0.5 pl-5 text-[var(--n-700)]">
        {items.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
    </Section>
  );
}
