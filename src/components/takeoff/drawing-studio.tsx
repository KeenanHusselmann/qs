"use client";

/**
 * Measure on the drawing – the sheet on the left, the dimension sheets beside it.
 *
 * The page is drawn by PDF.js (through `unpdf`, already used to read PDFs on the server), so a scan
 * renders as well as a CAD plot. Marks are clicked over it in the sheet's own coordinates; each one
 * finished becomes a dimension line on the chosen item through `addMarkedDimension`, which works the
 * figure again from the points. A line that came from a mark can be shown on the drawing again.
 *
 * Four tools, as the reviews of the desktop tools ask: length, area, count, and setting the scale.
 * Backspace takes the last point back, Escape drops the shape, Enter finishes it.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Hash, Minus, Pentagon, Ruler, ZoomIn, ZoomOut } from "lucide-react";

import { addMarkedDimension } from "@/app/(app)/projects/[id]/takeoff-actions";
import { dimensionsFor } from "@/domain/dimensions";
import { calibrate, measureMark, metresPerUnitAtScale, PDF_POINT_METRES, type Mark, type MarkKind } from "@/domain/drawing-marks";
import type { TakeoffItemView } from "@/lib/takeoff";

type Tool = MarkKind | "scale";
type Point = [number, number];
type Pdf = Awaited<ReturnType<typeof import("unpdf").getDocumentProxy>>;

const fmt = (n: number, dp = 2) => n.toLocaleString("en-ZA", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const field = "t-sm h-8 rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] px-2 text-[var(--n-800)]";

export function DrawingStudio({
  projectId,
  drawings,
  items,
  focus,
}: {
  projectId: string;
  drawings: readonly { id: string; name: string }[];
  items: readonly TakeoffItemView[];
  /** A line asked to be shown on the drawing – its mark is opened and highlighted. */
  focus: { lineId: string; mark: Mark } | null;
}) {
  const router = useRouter();
  const pdfs = useMemo(() => drawings.filter((d) => d.name.toLowerCase().endsWith(".pdf")), [drawings]);
  const [documentId, setDocumentId] = useState(pdfs[0]?.id ?? "");
  const [page, setPage] = useState(1);
  // What was loaded, keyed to the drawing it belongs to – a switch shows "opening" until it lands.
  const [loaded, setLoaded] = useState<{ id: string; pdf: Pdf | null; error: string | null } | null>(null);
  const pdf = loaded?.id === documentId ? loaded.pdf : null;
  const loadError = loaded?.id === documentId ? loaded.error : null;
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const canvas = useRef<HTMLCanvasElement>(null);

  const [tool, setTool] = useState<Tool>("length");
  const [points, setPoints] = useState<Point[]>([]);
  // A sheet's scale: set here, or the scale its last mark was measured at.
  const sheet = `${documentId}:${page}`;
  const [scales, setScales] = useState<Record<string, number>>({});
  const remembered = useMemo(
    () =>
      items
        .flatMap((i) => i.lines)
        .map((l) => l.mark)
        .filter((m): m is Mark => Boolean(m) && m!.documentId === documentId && m!.page === page)
        .at(-1)?.metresPerUnit ?? null,
    [items, documentId, page],
  );
  const metresPerUnit = scales[sheet] ?? remembered;
  const setMetresPerUnit = (value: number) => setScales((all) => ({ ...all, [sheet]: value }));
  const [scaleText, setScaleText] = useState("100");
  const [calibrateMetres, setCalibrateMetres] = useState("");
  const [itemId, setItemId] = useState(items[0]?.id ?? "");
  const [finished, setFinished] = useState<Mark | null>(null);
  const [extra, setExtra] = useState({ width: "", depth: "", location: "", deduct: false });
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  const item = items.find((i) => i.id === itemId) ?? null;

  // A line shown from its sheet opens its drawing, page and item – applied when the request changes,
  // during render, which is React's way of adjusting state to a prop.
  const [seenFocus, setSeenFocus] = useState(focus);
  if (focus !== seenFocus) {
    setSeenFocus(focus);
    if (focus) {
      setDocumentId(focus.mark.documentId);
      setPage(focus.mark.page);
      setScales((all) => ({ ...all, [`${focus.mark.documentId}:${focus.mark.page}`]: focus.mark.metresPerUnit }));
      const owner = items.find((i) => i.lines.some((l) => l.id === focus.lineId));
      if (owner) setItemId(owner.id);
    }
  }

  // Load the chosen PDF.
  useEffect(() => {
    const doc = pdfs.find((d) => d.id === documentId);
    if (!doc) return;
    let cancelled = false;
    (async () => {
      try {
        // A literal same-origin path, so the egress check can see it never leaves this site.
        const response = await fetch(`/api/projects/${projectId}/documents/${doc.id}/${encodeURIComponent(doc.name)}`);
        if (!response.ok) throw new Error(`The drawing could not be opened (HTTP ${response.status}).`);
        const { getDocumentProxy } = await import("unpdf");
        const proxy = await getDocumentProxy(new Uint8Array(await response.arrayBuffer()));
        if (!cancelled) setLoaded({ id: doc.id, pdf: proxy, error: null });
      } catch (error) {
        if (!cancelled) setLoaded({ id: doc.id, pdf: null, error: error instanceof Error ? error.message : "The drawing could not be opened." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [documentId, pdfs, projectId]);

  // Draw the page.
  // Measure the page first: the canvas is only mounted once its size is known, so measuring and
  // drawing cannot be one effect that waits for the canvas – it would wait forever.
  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    (async () => {
      const p = await pdf.getPage(Math.min(page, pdf.numPages));
      const base = p.getViewport({ scale: 1 });
      if (!cancelled) setSize({ w: base.width, h: base.height });
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf, page]);

  useEffect(() => {
    if (!pdf || !size || !canvas.current) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    (async () => {
      const p = await pdf.getPage(Math.min(page, pdf.numPages));
      if (cancelled || !canvas.current) return;
      const viewport = p.getViewport({ scale: zoom * (window.devicePixelRatio || 1) });
      const c = canvas.current!;
      c.width = viewport.width;
      c.height = viewport.height;
      task = p.render({ canvas: c, canvasContext: c.getContext("2d")!, viewport });
      await task.promise.catch(() => undefined);
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, page, zoom, size]);

  const reset = useCallback(() => {
    setPoints([]);
    setFinished(null);
    setRefusal(null);
  }, []);

  const finish = useCallback(() => {
    if (tool === "scale" || metresPerUnit === null) return;
    const needed = tool === "length" ? 2 : tool === "area" ? 3 : 1;
    if (points.length < needed) return;
    setFinished({ documentId, page, kind: tool, points, metresPerUnit });
  }, [tool, points, metresPerUnit, documentId, page]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "Escape") reset();
      if (e.key === "Backspace") setPoints((p) => p.slice(0, -1));
      if (e.key === "Enter") finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finish, reset]);

  const click = (e: React.MouseEvent<SVGSVGElement>) => {
    if (finished) return;
    const box = e.currentTarget.getBoundingClientRect();
    const point: Point = [(e.clientX - box.left) / zoom, (e.clientY - box.top) / zoom];
    if (tool === "scale" && points.length >= 2) return setPoints([point]);
    setPoints((p) => [...p, point]);
  };

  const applyScale = () => {
    if (tool === "scale") {
      const m = Number(calibrateMetres.replace(",", "."));
      const s = points.length === 2 ? calibrate(points[0]!, points[1]!, m) : null;
      if (!s) return setRefusal("Click two points a known distance apart, then give that distance in metres.");
      setMetresPerUnit(s);
      setTool("length");
      return reset();
    }
    const n = Number(scaleText.replace(/^1\s*:\s*/, ""));
    if (!Number.isFinite(n) || n <= 0) return setRefusal("The scale is the number after 1: – 100 for 1:100.");
    setMetresPerUnit(metresPerUnitAtScale(n));
    setRefusal(null);
  };

  const save = () =>
    startSave(async () => {
      if (!finished || !item) return;
      const outcome = await addMarkedDimension(projectId, item.id, { mark: finished, ...extra });
      if (!outcome.ok) return setRefusal(outcome.reason);
      setExtra({ width: "", depth: "", location: "", deduct: false });
      reset();
      router.refresh();
    });

  const marksHere = items.flatMap((i) =>
    i.lines.filter((l) => l.mark && l.mark.documentId === documentId && l.mark.page === page).map((l) => ({ line: l, mark: l.mark!, mine: i.id === itemId })),
  );
  const wanted = item ? dimensionsFor(item.unit) : null;
  const live = metresPerUnit && tool !== "scale" && points.length > 0 ? measureMark({ kind: tool, points, metresPerUnit }) : null;
  const unitOf = (k: MarkKind) => (k === "length" ? "m" : k === "area" ? "m²" : "no");

  if (pdfs.length === 0) {
    return <p className="t-sm px-4 py-3 text-[var(--n-600)]">File a PDF drawing on this project to measure on it.</p>;
  }

  const tools: { key: Tool; label: string; icon: typeof Ruler }[] = [
    { key: "length", label: "Length", icon: Minus },
    { key: "area", label: "Area", icon: Pentagon },
    { key: "count", label: "Count", icon: Hash },
    { key: "scale", label: "Set scale", icon: Ruler },
  ];

  return (
    <div data-region="drawing-studio" className="flex min-w-0 flex-col">
      {/* Which drawing, which item */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--n-100)] px-3 py-2">
        <select aria-label="Drawing" value={documentId} onChange={(e) => { setDocumentId(e.target.value); setPage(1); reset(); }} className={`${field} max-w-[16rem]`}>
          {pdfs.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        {pdf && pdf.numPages > 1 && (
          <select aria-label="Sheet" value={page} onChange={(e) => { setPage(Number(e.target.value)); reset(); }} className={field}>
            {Array.from({ length: pdf.numPages }, (_, i) => (
              <option key={i + 1} value={i + 1}>Sheet {i + 1}</option>
            ))}
          </select>
        )}
        <span className="t-xs text-[var(--n-500)]">into</span>
        <select aria-label="Item" data-region="studio-item" value={itemId} onChange={(e) => { setItemId(e.target.value); reset(); }} className={`${field} min-w-0 flex-1`}>
          {items.length === 0 && <option value="">Add an item first</option>}
          {items.map((i) => (
            <option key={i.id} value={i.id}>{i.number}. {i.description.slice(0, 50)} ({i.unit})</option>
          ))}
        </select>
      </div>

      {/* Tools and scale */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--n-100)] px-3 py-2">
        {tools.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            data-tool={key}
            aria-pressed={tool === key}
            onClick={() => { setTool(key); reset(); }}
            className={`t-sm flex h-8 items-center gap-1 rounded-[var(--r-md)] border px-2 ${tool === key ? "border-[var(--a-500)] bg-[var(--a-50)] text-[var(--a-700)]" : "border-[var(--n-200)] text-[var(--n-700)] hover:bg-[var(--n-50)]"}`}
          >
            <Icon aria-hidden size={13} /> {label}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-[var(--n-200)]" />
        <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.25, z / 1.25))} className="text-[var(--n-600)] hover:text-[var(--n-800)]"><ZoomOut size={15} /></button>
        <span className="num t-xs w-10 text-center text-[var(--n-500)]">{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(6, z * 1.25))} className="text-[var(--n-600)] hover:text-[var(--n-800)]"><ZoomIn size={15} /></button>
        <span className="ml-auto t-xs text-[var(--n-600)]" data-region="studio-scale">
          {metresPerUnit ? `Scale 1:${Math.round(metresPerUnit / PDF_POINT_METRES).toLocaleString("en-ZA")}` : "Scale not set"}
        </span>
      </div>

      {(tool === "scale" || !metresPerUnit) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--n-100)] bg-[var(--n-25)] px-3 py-2">
          {tool === "scale" ? (
            <>
              <span className="t-sm text-[var(--n-700)]">Click two points a known distance apart, then:</span>
              <input aria-label="Known distance in metres" value={calibrateMetres} onChange={(e) => setCalibrateMetres(e.target.value)} placeholder="metres" inputMode="decimal" className={`${field} num w-24`} />
            </>
          ) : (
            <>
              <span className="t-sm text-[var(--n-700)]">Sheet scale 1:</span>
              <input aria-label="Sheet scale" data-input="sheet-scale" value={scaleText} onChange={(e) => setScaleText(e.target.value)} inputMode="numeric" className={`${field} num w-20`} />
            </>
          )}
          <button type="button" data-action="set-scale" onClick={applyScale} className="t-sm h-8 rounded-[var(--r-md)] bg-[var(--n-800)] px-3 font-medium text-white hover:bg-[var(--n-900)]">
            Set scale
          </button>
        </div>
      )}

      {/* The sheet */}
      <div className="relative max-h-[70vh] overflow-auto bg-[var(--n-100)]">
        {loadError && <p role="alert" className="t-sm p-4 text-[var(--err-700)]">{loadError}</p>}
        {!pdf && !loadError && <p className="t-sm p-4 text-[var(--n-500)]">Opening the drawing…</p>}
        {size && (
          <div className="relative" style={{ width: size.w * zoom, height: size.h * zoom }}>
            <canvas ref={canvas} className="absolute inset-0 h-full w-full bg-white" />
            <svg
              data-region="studio-canvas"
              viewBox={`0 0 ${size.w} ${size.h}`}
              className={`absolute inset-0 h-full w-full ${metresPerUnit || tool === "scale" ? "cursor-crosshair" : "cursor-not-allowed"}`}
              onClick={(e) => (metresPerUnit || tool === "scale") && click(e)}
              onDoubleClick={finish}
            >
              {marksHere.map(({ line, mark, mine }) => (
                <Shape key={line.id} mark={mark} tone={focus?.lineId === line.id ? "focus" : mine ? "mine" : "other"} zoom={zoom} />
              ))}
              {points.length > 0 && <Shape mark={{ kind: tool === "scale" ? "length" : tool, points }} tone="draft" zoom={zoom} />}
            </svg>
          </div>
        )}
      </div>

      {/* What is being measured, and where it goes */}
      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--n-100)] px-3 py-2" data-region="studio-status">
        {finished && item ? (
          <>
            <span className="num t-sm font-semibold text-[var(--n-800)]">
              {fmt(measureMark(finished), finished.kind === "count" ? 0 : 2)} {unitOf(finished.kind)}
            </span>
            {finished.kind === "length" && wanted !== null && wanted >= 2 && (
              <input aria-label="Height or width" value={extra.width} onChange={(e) => setExtra({ ...extra, width: e.target.value })} placeholder="× height / width" inputMode="decimal" className={`${field} num w-32`} />
            )}
            {wanted === 3 && finished.kind !== "count" && (
              <input aria-label="Depth" value={extra.depth} onChange={(e) => setExtra({ ...extra, depth: e.target.value })} placeholder="× depth" inputMode="decimal" className={`${field} num w-24`} />
            )}
            <input aria-label="Where" value={extra.location} onChange={(e) => setExtra({ ...extra, location: e.target.value })} placeholder="Where (e.g. grid 1–4)" className={`${field} w-44`} />
            <label className="t-xs flex items-center gap-1 text-[var(--n-600)]">
              <input type="checkbox" checked={extra.deduct} onChange={(e) => setExtra({ ...extra, deduct: e.target.checked })} className="accent-[var(--a-500)]" /> deduct
            </label>
            <button type="button" data-action="save-mark" disabled={saving} onClick={save} className="t-sm h-8 rounded-[var(--r-md)] bg-[var(--a-500)] px-3 font-medium text-white hover:bg-[var(--a-600)] disabled:opacity-50">
              {saving ? "Adding…" : `Add to ${item.number}`}
            </button>
            <button type="button" onClick={reset} className="t-sm text-[var(--n-500)] hover:text-[var(--n-800)]">Discard</button>
          </>
        ) : (
          <span className="t-sm text-[var(--n-600)]">
            {!metresPerUnit && tool !== "scale"
              ? "Set the scale first."
              : tool === "scale"
                ? "Click two points on a known dimension."
                : live !== null
                  ? `${fmt(live, tool === "count" ? 0 : 2)} ${unitOf(tool)} so far – double-click or Enter to finish, Backspace to undo a point.`
                  : tool === "count"
                    ? "Click each one, then Enter."
                    : `Click the ${tool === "area" ? "outline's corners" : "points along it"}, then double-click or Enter.`}
          </span>
        )}
        {refusal && <p role="alert" className="t-sm w-full text-[var(--err-700)]">{refusal}</p>}
      </div>
    </div>
  );
}

/** A mark drawn over the sheet. Stroke widths are divided by the zoom so lines stay hairlines. */
function Shape({ mark, tone, zoom }: { mark: Pick<Mark, "kind" | "points">; tone: "draft" | "mine" | "other" | "focus"; zoom: number }) {
  const colour = { draft: "#d97706", mine: "#2563eb", other: "#94a3b8", focus: "#dc2626" }[tone];
  const w = (tone === "focus" ? 3 : 2) / zoom;
  const pts = mark.points.map((p) => p.join(",")).join(" ");
  if (mark.kind === "count") {
    return <g>{mark.points.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={5 / zoom} fill={colour} fillOpacity={0.6} stroke={colour} strokeWidth={w} />)}</g>;
  }
  return (
    <g data-mark-tone={tone}>
      {mark.kind === "area" ? (
        <polygon points={pts} fill={colour} fillOpacity={tone === "other" ? 0.08 : 0.18} stroke={colour} strokeWidth={w} />
      ) : (
        <polyline points={pts} fill="none" stroke={colour} strokeWidth={w} />
      )}
      {mark.points.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={2.5 / zoom} fill={colour} />)}
    </g>
  );
}
