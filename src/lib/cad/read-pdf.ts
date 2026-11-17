/**
 * A plotted PDF drawing, read for its geometry – the PDF front end to `domain/cad`.
 *
 * pdf.js does the PDF parsing (it is already how the platform reads documents, through unpdf);
 * `domain/cad/pdf-geometry.ts` turns its operator list into entities; `read-drawing.ts` measures
 * them exactly as it measures a DXF. Nothing here guesses a scale: it is read from the sheet or
 * given by the caller, and the report says which.
 */

import { chooseScale, pdfPageToDrawing, statedScales, type PdfDrawingStats, type PdfOpCodes, type PdfTextItem } from "@/domain/cad/pdf-geometry";
import { readDrawing, type DrawingReport } from "@/domain/cad/read-drawing";
import type { Drawing } from "@/domain/cad/dxf";

export interface PdfDrawingRead {
  drawing: Drawing;
  report: DrawingReport;
  stats: PdfDrawingStats;
  page: number;
  pages: number;
  /** The paper size in millimetres. */
  sheet: { width: number; height: number };
  scale: { value: number | null; statedBy: "sheet" | "caller" | null; printed: number[]; reason: string };
  /** Outlines with a curve in them – their areas rest on flattened curves, not exact arcs. */
  curvedLoops: string[];
}

const OP_NAMES = [
  "save",
  "restore",
  "transform",
  "setLineWidth",
  "constructPath",
  "paintFormXObjectBegin",
  "paintFormXObjectEnd",
  "setStrokeRGBColor",
  "setFillRGBColor",
  "stroke",
  "closeStroke",
  "fill",
  "eoFill",
  "fillStroke",
  "eoFillStroke",
  "closeFillStroke",
  "closeEOFillStroke",
  "endPath",
] as const satisfies readonly (keyof PdfOpCodes)[];

export async function readPdfDrawing(bytes: Uint8Array, options: { page?: number; scale?: number; regionLayers?: string[]; snapMetres?: number } = {}): Promise<PdfDrawingRead> {
  const { getDocumentProxy, getResolvedPDFJS } = await import("unpdf");
  const { OPS } = (await getResolvedPDFJS()) as unknown as { OPS: Record<string, number> };
  const codes = Object.fromEntries(
    OP_NAMES.map((name) => {
      const code = OPS[name];
      // Read from the library, never hard-coded: a renumbered operator would otherwise read silently wrong.
      if (typeof code !== "number") throw new Error(`The PDF library has no "${name}" operator – its format has changed.`);
      return [name, code];
    }),
  ) as unknown as PdfOpCodes;

  // A copy, because pdf.js takes ownership of what it is given.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const pageNumber = options.page ?? 1;
  if (pageNumber < 1 || pageNumber > pdf.numPages) throw new RangeError(`The drawing has ${pdf.numPages} page(s); there is no page ${pageNumber}.`);
  const page = await pdf.getPage(pageNumber);
  const [x0, y0, x1, y1] = page.view as [number, number, number, number];
  const ops = await page.getOperatorList();
  const text = await page.getTextContent();
  const texts: PdfTextItem[] = text.items.flatMap((t) => ("str" in t ? [{ str: t.str, transform: t.transform as number[], height: t.height }] : []));

  const printed = statedScales(texts);
  const chosen = options.scale ? { scale: options.scale, reason: `Scale 1:${options.scale} was stated by the caller.` } : chooseScale(printed);

  const { drawing, stats, curvedHandles } = pdfPageToDrawing(ops, codes, texts, { scale: chosen.scale, page: pageNumber });
  drawing.notes.push(chosen.reason);
  if (printed.length === 0 && texts.length === 0) {
    drawing.notes.push("The sheet has no text layer – its lettering is drawn as strokes (§10.1). Labels and a scale need OCR, which this reader does not do yet.");
  }
  const report = readDrawing(drawing, options.regionLayers?.length ? { regions: { layers: options.regionLayers, snapMetres: options.snapMetres } } : {});
  if (options.regionLayers?.length && options.snapMetres) report.notes.push(`Boundary gaps up to ${options.snapMetres} m were closed when tracing regions.`);
  const curvedLoops = report.loops.filter((l) => l.handles.some((h) => curvedHandles.has(h))).map((l) => l.id);
  if (curvedLoops.length) report.notes.push(`${curvedLoops.length} outline(s) include curves, measured as short chords – close, not exact.`);

  return {
    drawing,
    report,
    stats,
    page: pageNumber,
    pages: pdf.numPages,
    sheet: { width: Math.round((x1 - x0) * (25.4 / 72)), height: Math.round((y1 - y0) * (25.4 / 72)) },
    scale: { value: chosen.scale, statedBy: options.scale ? "caller" : chosen.scale ? "sheet" : null, printed, reason: chosen.reason },
    curvedLoops,
  };
}
