/**
 * A plotted drawing's geometry, out of its PDF – PLATFORM.md §10.2: "we have the CAD geometry
 * itself, not an image of it."
 *
 * ── Why this matters more than the DXF reader ──────────────────────────────────────────────
 *
 * The DXF reader is the good case. PDF is what a practice actually receives (§10.5: "PDF is what
 * we can rely on receiving"). A drawing plotted from CAD to PDF keeps every line as a vector path
 * at its exact position, so the same geometry engine – loops, areas, courtyards, printed-area
 * checks – runs on it unchanged once the paths are turned into the entities `read-drawing.ts`
 * already measures.
 *
 * ── What a PDF does not carry, and how each gap is handled ─────────────────────────────────
 *
 * - **Layers.** A plot flattens them. Pen colour and weight survive (§10.2: "pen weight survives
 *   plotting as a proxy for CAD layer"), so each path's layer is named for its pen: "stroke
 *   #000000 0.50pt", "fill #8dc63f". Which pen is the erf boundary is a labelling question –
 *   exactly the kind the model is asked, and checked on.
 * - **Units and scale.** A PDF is in points on paper. Real size needs the drawing's scale. It is
 *   read from the sheet's own text ("1:1250") only when the sheet states exactly one; two scales
 *   (a plan and a locality inset) is ambiguous and the caller must say which. §10.4: a stated
 *   scale is a hint – the printed-area checks are what confirm it, and they are reported.
 * - **Curves.** Béziers are flattened to short chords. Unlike a DXF bulge this is approximate,
 *   so an outline with curves is marked as such rather than presented as exact.
 *
 * ── The operator list ──────────────────────────────────────────────────────────────────────
 *
 * pdf.js (as bundled in unpdf 1.8) hands over a page as parallel arrays of operator codes and
 * arguments. Paths arrive as `constructPath` with arguments `[paintOp, [pathData], minMax]`,
 * `pathData` a flat Float32Array of draw codes and coordinates in user space; the current
 * transform is built from `transform`, `save`/`restore` and form XObjects' matrices. The codes are
 * passed in rather than imported so this stays pure and testable without pdf.js.
 */

import type { Drawing, Entity, Point, Vertex } from "./dxf";

/** pdf.js operator codes this reader acts on – `OPS` from the bundled build. */
export interface PdfOpCodes {
  save: number;
  restore: number;
  transform: number;
  setLineWidth: number;
  constructPath: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
  setStrokeRGBColor: number;
  setFillRGBColor: number;
  stroke: number;
  closeStroke: number;
  fill: number;
  eoFill: number;
  fillStroke: number;
  eoFillStroke: number;
  closeFillStroke: number;
  closeEOFillStroke: number;
  endPath: number;
}

/** pdf.js `DrawOPS`: the codes inside a path's data array. Verified against unpdf 1.8's bundle. */
export const DRAW = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 } as const;

export interface PdfOperatorList {
  fnArray: ArrayLike<number>;
  argsArray: ArrayLike<unknown>;
}

/** A text item as `page.getTextContent()` returns it: the string and its transform in page space. */
export interface PdfTextItem {
  str: string;
  transform: number[];
  height?: number;
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** PDF's matrix product: `m` applied first, then `n`. */
const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];
const apply = (m: Matrix, x: number, y: number): Point => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
/** Six finite numbers, or null – a malformed matrix must not turn every coordinate into NaN. */
function asMatrix(v: unknown): Matrix | null {
  if (!Array.isArray(v) && !ArrayBuffer.isView(v)) return null;
  const a = Array.from(v as ArrayLike<unknown>).slice(0, 6).map(Number);
  return a.length === 6 && a.every(Number.isFinite) ? (a as Matrix) : null;
}

/** Points per millimetre on paper. */
const PT_PER_MM = 72 / 25.4;

/**
 * Entities taken from one page at most. A real A0 site plan gives about 30 000 once specks are
 * dropped; a file that would give millions is either not a drawing or built to exhaust the reader,
 * and either way the page is read up to the budget and the report says it stopped.
 */
export const MAX_PDF_ENTITIES = 400_000;

/** Scales printed on a sheet: "1:1250", "1 : 3000", "SCALE 1:100 @ A1". Distinct, in order of first mention. */
export function statedScales(texts: readonly PdfTextItem[]): number[] {
  const found: number[] = [];
  for (const t of texts) {
    for (const m of t.str.matchAll(/(?<![\d.,])1\s*:\s*(\d{1,3}(?:[  ]?\d{3})*|\d+)(?![\d.,])/g)) {
      const n = Number(m[1]!.replace(/[  ]/g, ""));
      // 1:1 to 1:100 000 – a drawing scale; anything else is a ratio in a note ("1:3 slope").
      if (n >= 1 && n <= 100_000 && !found.includes(n)) found.push(n);
    }
  }
  return found;
}

/** Slopes and gradients are ratios that look like scales: "batter 1:3", "fall 1:40". */
const isSlope = (n: number) => n <= 50;

export interface PdfReadOptions {
  /** 1:scale. Null leaves the geometry in paper millimetres and the areas withheld. */
  scale: number | null;
  page: number;
  /** Bézier chords per curve. */
  curveSteps?: number;
}

export interface PdfDrawingStats {
  paths: number;
  subpaths: number;
  closed: number;
  curved: number;
  /** Clipping paths and invisible paths – drawn by nothing, so not geometry. */
  unpainted: number;
  /** Specks smaller than a quarter of a millimetre on paper – dots, not outlines. */
  specks: number;
  /** True when the page held more than `MAX_PDF_ENTITIES` and reading stopped there. */
  truncated: boolean;
}

/**
 * The page as a `Drawing` in real millimetres (so `$INSUNITS` 4 applies) when the scale is
 * known, or in paper millimetres with units unstated when it is not.
 */
export function pdfPageToDrawing(ops: PdfOperatorList, codes: PdfOpCodes, texts: readonly PdfTextItem[], options: PdfReadOptions): { drawing: Drawing; stats: PdfDrawingStats; curvedHandles: Set<string> } {
  const steps = Math.max(2, options.curveSteps ?? 8);
  // Points → real millimetres: points to paper mm, then up by the scale.
  const toMm = (1 / PT_PER_MM) * (options.scale ?? 1);
  const stats: PdfDrawingStats = { paths: 0, subpaths: 0, closed: 0, curved: 0, unpainted: 0, specks: 0, truncated: false };
  const curvedHandles = new Set<string>();
  const entities: Entity[] = [];
  const layers = new Set<string>();

  let ctm: Matrix = IDENTITY;
  let lineWidth = 1;
  let strokeColor = "#000000";
  let fillColor = "#000000";
  const stack: { ctm: Matrix; lineWidth: number; strokeColor: string; fillColor: string }[] = [];
  const push = () => stack.push({ ctm, lineWidth, strokeColor, fillColor });
  const pop = () => {
    const s = stack.pop();
    if (s) ({ ctm, lineWidth, strokeColor, fillColor } = s);
  };

  const painted = new Map<number, "stroke" | "fill" | "both">([
    [codes.stroke, "stroke"],
    [codes.closeStroke, "stroke"],
    [codes.fill, "fill"],
    [codes.eoFill, "fill"],
    [codes.fillStroke, "both"],
    [codes.eoFillStroke, "both"],
    [codes.closeFillStroke, "both"],
    [codes.closeEOFillStroke, "both"],
  ]);
  const closesOnPaint = new Set([codes.closeStroke, codes.closeFillStroke, codes.closeEOFillStroke]);

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i]!;
    const args = (ops.argsArray[i] ?? []) as unknown[];
    if (fn === codes.save) push();
    else if (fn === codes.restore) pop();
    else if (fn === codes.transform) {
      const m = asMatrix(args);
      if (m) ctm = multiply(m, ctm);
    } else if (fn === codes.paintFormXObjectBegin) {
      push();
      const m = asMatrix(args[0]);
      if (m) ctm = multiply(m, ctm);
    } else if (fn === codes.paintFormXObjectEnd) pop();
    else if (fn === codes.setLineWidth) {
      const w = Number(args[0]);
      if (Number.isFinite(w) && w >= 0) lineWidth = w;
    } else if (fn === codes.setStrokeRGBColor) {
      if (typeof args[0] === "string") strokeColor = args[0].toLowerCase();
    } else if (fn === codes.setFillRGBColor) {
      if (typeof args[0] === "string") fillColor = args[0].toLowerCase();
    } else if (fn === codes.constructPath) {
      stats.paths++;
      const paintOp = Number(args[0]);
      const mode = painted.get(paintOp);
      if (!mode) {
        stats.unpainted++;
        continue;
      }
      const data = (args[1] as unknown[] | undefined)?.[0] as ArrayLike<number> | undefined;
      if (!data || typeof data.length !== "number") continue;

      // The pen this path was drawn with, as the layer it stands for. Width in page units.
      const scaleOfCtm = Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2])) || 1;
      const widthPt = Math.round(lineWidth * scaleOfCtm * 100) / 100;
      const layer = mode === "stroke" ? `stroke ${strokeColor} ${widthPt.toFixed(2)}pt` : `fill ${fillColor}`;

      let sub: Point[] = [];
      let subClosed = false;
      let subCurved = false;
      let subIndex = 0;
      const flush = () => {
        if (sub.length >= 2) {
          stats.subpaths++;
          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
          for (const p of sub) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
          }
          if (Math.max(maxX - minX, maxY - minY) < 0.25 * PT_PER_MM) {
            stats.specks++;
          } else if (entities.length >= MAX_PDF_ENTITIES) {
            stats.truncated = true;
          } else {
            const first = sub[0]!, last = sub[sub.length - 1]!;
            const meets = Math.hypot(first.x - last.x, first.y - last.y) < 1e-3;
            // A filled path is a region whether or not it was closed explicitly – fill closes it.
            const closed = subClosed || meets || closesOnPaint.has(paintOp) || mode !== "stroke";
            const pts = closed && meets ? sub.slice(0, -1) : sub;
            const handle = `p${options.page}:${i}.${subIndex}`;
            const vertices: Vertex[] = pts.map((p) => ({ x: p.x * toMm, y: p.y * toMm, bulge: 0 }));
            if (closed && vertices.length >= 3) {
              stats.closed++;
              entities.push({ kind: "polyline", handle, layer, vertices, closed: true });
            } else if (vertices.length === 2) {
              entities.push({ kind: "line", handle, layer, start: vertices[0]!, end: vertices[1]! });
            } else if (vertices.length > 2) {
              entities.push({ kind: "polyline", handle, layer, vertices, closed: false });
            }
            if (subCurved) {
              stats.curved++;
              curvedHandles.add(handle);
            }
            layers.add(layer);
          }
        }
        sub = [];
        subClosed = false;
        subCurved = false;
        subIndex++;
      };

      let cx = 0, cy = 0;
      for (let k = 0; k < data.length; ) {
        const code = data[k++]!;
        if (code === DRAW.moveTo) {
          flush();
          cx = data[k++]!;
          cy = data[k++]!;
          sub.push(apply(ctm, cx, cy));
        } else if (code === DRAW.lineTo) {
          cx = data[k++]!;
          cy = data[k++]!;
          sub.push(apply(ctm, cx, cy));
        } else if (code === DRAW.curveTo || code === DRAW.quadraticCurveTo) {
          const cubic = code === DRAW.curveTo;
          const c = Array.from({ length: cubic ? 6 : 4 }, () => data[k++]!);
          // A quadratic (control q, end e) is exactly the cubic with controls ⅔ of the way to q.
          const [x1, y1, x2, y2, x3, y3] = cubic
            ? c
            : [cx + (2 / 3) * (c[0]! - cx), cy + (2 / 3) * (c[1]! - cy), c[2]! + (2 / 3) * (c[0]! - c[2]!), c[3]! + (2 / 3) * (c[1]! - c[3]!), c[2]!, c[3]!];
          for (let s = 1; s <= steps; s++) {
            const t = s / steps, u = 1 - t;
            const x = u * u * u * cx + 3 * u * u * t * x1! + 3 * u * t * t * x2! + t * t * t * x3!;
            const y = u * u * u * cy + 3 * u * u * t * y1! + 3 * u * t * t * y2! + t * t * t * y3!;
            sub.push(apply(ctm, x, y));
          }
          cx = x3!;
          cy = y3!;
          subCurved = true;
        } else if (code === DRAW.closePath) {
          subClosed = true;
          flush();
        } else {
          // An unknown draw code means the format is not the one this reader was written against.
          throw new Error(`Unknown path draw code ${code} – the PDF library's path format has changed.`);
        }
      }
      flush();
    }
  }

  // Text, in the same page space and the same units as the geometry.
  for (const [k, t] of texts.entries()) {
    const str = t.str.trim();
    if (!str || !Array.isArray(t.transform) || t.transform.length < 6) continue;
    const at = { x: t.transform[4]! * toMm, y: t.transform[5]! * toMm };
    if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) continue;
    entities.push({ kind: "text", handle: `p${options.page}:t${k}`, layer: "text", text: str, at, height: (t.height ?? Math.abs(t.transform[3]!)) * toMm });
  }
  layers.add("text");

  const drawing: Drawing = {
    version: null,
    insunits: options.scale === null ? null : 4,
    layers: [...layers].sort(),
    entities,
    blocks: {},
    blockBase: {},
    skipped: {},
    notes: stats.truncated ? [`The page has more than ${MAX_PDF_ENTITIES.toLocaleString("en-ZA")} shapes; only the first ${MAX_PDF_ENTITIES.toLocaleString("en-ZA")} were read.`] : [],
  };
  return { drawing, stats, curvedHandles };
}

/** The scale to use from what a sheet states: one drawing scale, or null and why. */
export function chooseScale(scales: readonly number[]): { scale: number | null; reason: string } {
  const drawingScales = scales.filter((n) => !isSlope(n));
  if (drawingScales.length === 1) return { scale: drawingScales[0]!, reason: `Scale 1:${drawingScales[0]} is printed on the sheet.` };
  if (drawingScales.length === 0) return { scale: null, reason: "The sheet prints no scale, so areas are withheld. State the scale to measure it." };
  return { scale: null, reason: `The sheet prints more than one scale (${drawingScales.map((n) => `1:${n}`).join(", ")}) – a plan and an inset, usually – so areas are withheld until one is chosen.` };
}
