"use server";

/**
 * Read a filed drawing – the drawing reader (`domain/cad`) inside the app, PLATFORM.md §10.
 *
 * The same reader the local viewer and the MCP server use, pointed at a drawing already filed on
 * the project instead of a file on a laptop. It measures and reports; **it writes nothing** – no
 * take-off, no bill row, no stored reading. A QS looks at what was measured and what it was measured
 * from, and anything carried onward is carried by a person (§10.5: every extracted quantity is a
 * proposal, accepted by a human).
 *
 * ── Why server actions, and not a route ────────────────────────────────────────────────────
 *
 * A route is a serverless function and the project is at Vercel's cap (see the note on
 * `projects/[id]/[module]/page.tsx`). Actions live in the page's own function, so this costs none.
 *
 * ── Why the file is read again for Interpret ───────────────────────────────────────────────
 *
 * The page holds a report, and could send it back. It is not trusted to: the concept schedule is
 * the platform's arithmetic over what the platform measured, and a report that came back from a
 * browser is a claim about a drawing, not a measurement of one. Reading again costs seconds on an
 * A0 sheet and one press of a button.
 */

import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db/client";
import { documents } from "@/db/schema";
import { DxfUnreadable, parseDxf, type Drawing } from "@/domain/cad/dxf";
import { readDrawing, type DrawingReport, type StatedUnits } from "@/domain/cad/read-drawing";
import { renderSvg } from "@/domain/cad/render";
import { requireSession } from "@/lib/auth";
import { ModelUnavailable } from "@/lib/agent/deepseek";
import { interpretDrawing, type InterpretedDrawing } from "@/lib/cad/interpret-drawing";
import { readPdfDrawing } from "@/lib/cad/read-pdf";
import { isReadableDrawing } from "@/lib/cad/readable";
import { isSpatial } from "@/lib/ingest/document-class";
import { MAX_UPLOAD_BYTES } from "@/lib/ingest/limits";
import { locate, read } from "@/lib/ingest/storage";
import { forProject } from "@/lib/egress/scope";

export interface DrawingReadOptions {
  /** DXF units, where the drawing does not state them. */
  units?: StatedUnits;
  /** A PDF's scale, 1:n, where the sheet does not print one. */
  scale?: number;
  /** Pens (PDF) or layers (DXF) traced as a boundary network – erven on a site plan. */
  regions?: string[];
  /** Gaps in that network closed up to this many metres. */
  snap?: number;
}

/**
 * The report as the page needs it. Less the drawing's text, which the page never shows; and only
 * the first of the open chains and junctions, with how many there are. A 120 000-segment test
 * sheet had five hundred junctions – 1.6 MB of handles – and the page lists twelve.
 */
export type ShownReport = Omit<DrawingReport, "texts" | "open" | "junctions"> & {
  open: DrawingReport["open"];
  openCount: number;
  junctions: DrawingReport["junctions"];
  junctionCount: number;
};

/** Listed of each, on the page. */
const LISTED = 12;

/**
 * What one reading may return, picture and report together. Vercel caps a function's response at
 * 4.5 MB; this leaves room for the encoding around it. Measured on a test sheet of some 120 000
 * segments – the size of a plotted A1 (§10.1) – the compact picture is about 3 MB – drawn one element per shape it was 14.
 */
const RESPONSE_LIMIT = 4_000_000;

export type DrawingReadOutcome =
  | {
      ok: true;
      kind: "dxf" | "pdf";
      name: string;
      scale: { value: number | null; reason: string } | null;
      report: ShownReport;
      svg: string;
      /** What the picture could not draw faithfully. */
      pictureNotes: string[];
    }
  | { ok: false; reason: string };

export type DrawingInterpretOutcome = ({ ok: true } & InterpretedDrawing) | { ok: false; reason: string };

/**
 * The options, as the local viewer bounds them. They arrive from a browser, so each is checked
 * rather than typed: a pen name is drawing text, a scale of 0 divides by nothing.
 */
function bounded(options: DrawingReadOptions) {
  const units = options.units === "mm" || options.units === "cm" || options.units === "m" ? options.units : undefined;
  const regions = Array.isArray(options.regions)
    ? options.regions.filter((s): s is string => typeof s === "string" && s.trim().length > 0 && s.length <= 200).map((s) => s.trim()).slice(0, 10)
    : [];
  const snap = typeof options.snap === "number" && options.snap > 0 && options.snap <= 20 ? options.snap : undefined;
  const scale = typeof options.scale === "number" && Number.isInteger(options.scale) && options.scale >= 1 && options.scale <= 100_000 ? options.scale : undefined;
  return { units, regions, snap, scale };
}

class NotReadable extends Error {}

/**
 * The drawing's bytes, scoped to the project in the query – a document id from another project
 * must not resolve here (§1.3.2), which the `where` clause prevents rather than a later check.
 * The recorded storage location is tried first and the derived one after, as `openDocument` does,
 * because a recorded location can go stale.
 */
async function bytesOf(projectId: string, documentId: string): Promise<{ name: string; bytes: Uint8Array }> {
  const [document] = await db
    .select({ filename: documents.filename, kind: documents.kind, storageLocation: documents.storageLocation, byteSize: documents.byteSize })
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.projectId, projectId), isNull(documents.deletedAt)))
    .limit(1);
  if (!document) throw new NotReadable("That drawing is not filed on this project, or it has been withdrawn.");
  if (!isSpatial(document.kind)) throw new NotReadable(`${document.filename} is not filed as a drawing.`);
  if (!isReadableDrawing(document.filename)) throw new NotReadable(`${document.filename} is not a PDF or DXF – the reader takes a PDF plotted from CAD, or an ASCII DXF.`);
  if (Number(document.byteSize) > MAX_UPLOAD_BYTES) throw new NotReadable(`${document.filename} is over the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit.`);

  let failure: unknown = null;
  for (const location of [document.storageLocation, await locate(documentId, document.filename)]) {
    if (!location) continue;
    try {
      return { name: document.filename, bytes: await read(location) };
    } catch (error) {
      failure = error;
    }
  }
  if (failure) console.error(`drawing-actions: ${documentId} could not be read from storage`, failure);
  throw new NotReadable(
    failure
      ? `${document.filename} is filed, but its stored copy could not be read.`
      : `The original of ${document.filename} was not retained, so there is nothing to measure.`,
  );
}

interface Measured {
  kind: "dxf" | "pdf";
  name: string;
  drawing: Drawing;
  report: DrawingReport;
  scale: { value: number | null; reason: string } | null;
}

async function measure(projectId: string, documentId: string, options: DrawingReadOptions): Promise<Measured> {
  const { name, bytes } = await bytesOf(projectId, documentId);
  const o = bounded(options);
  // Told apart by content, not by name: a PDF renamed .dxf is still a PDF.
  if (bytes.byteLength >= 5 && new TextDecoder("latin1").decode(bytes.subarray(0, 5)) === "%PDF-") {
    const r = await readPdfDrawing(bytes, { scale: o.scale, regionLayers: o.regions, snapMetres: o.snap });
    return { kind: "pdf", name, drawing: r.drawing, report: r.report, scale: { value: r.scale.value, reason: r.scale.reason } };
  }
  const drawing = parseDxf(new TextDecoder("utf-8").decode(bytes));
  const report = readDrawing(drawing, { units: o.units, ...(o.regions.length ? { regions: { layers: o.regions, snapMetres: o.snap } } : {}) });
  return { kind: "dxf", name, drawing, report, scale: null };
}

/** A refusal in words for the page; the cause, where there is one worth having, for the log. */
function refusal(error: unknown, documentId: string): { ok: false; reason: string } {
  if (error instanceof NotReadable || error instanceof DxfUnreadable) return { ok: false, reason: error.message };
  if (error instanceof ModelUnavailable) {
    if (error.detail) console.error(`drawing-actions(${documentId}): ${error.detail}`);
    return { ok: false, reason: error.message };
  }
  console.error(`drawing-actions(${documentId})`, error);
  return { ok: false, reason: "The reader failed on this drawing. The details are in the server log." };
}

export async function readFiledDrawing(projectId: string, documentId: string, options: DrawingReadOptions = {}): Promise<DrawingReadOutcome> {
  await requireSession();
  try {
    const m = await measure(projectId, documentId, options);
    // Field by field, so a field added to the report later is not sent to the browser by default.
    const r = m.report;
    const report: ShownReport = {
      version: r.version,
      units: r.units,
      layers: r.layers,
      loops: r.loops,
      blocks: r.blocks,
      areaChecks: r.areaChecks,
      skipped: r.skipped,
      notes: r.notes,
      open: r.open.slice(0, LISTED),
      openCount: r.open.length,
      junctions: r.junctions.slice(0, LISTED),
      junctionCount: r.junctions.length,
    };

    // Every handle a row on the page can pick: outlines, block inserts, and the labels checked against them.
    const pickable = new Set<string>([
      ...m.report.loops.flatMap((l) => l.handles),
      ...m.report.blocks.flatMap((b) => b.handles),
      ...m.report.areaChecks.flatMap((c) => (c.textHandle ? [c.textHandle] : [])),
    ]);
    const picture = renderSvg(m.drawing, { width: 1400, pickable });
    if (picture.svg.length + JSON.stringify(report).length > RESPONSE_LIMIT) {
      return {
        ok: true,
        kind: m.kind,
        name: m.name,
        scale: m.scale,
        report,
        svg: "",
        pictureNotes: [...picture.notes, `The picture of this drawing is too large to send (${(picture.svg.length / 1e6).toFixed(1)} MB). The figures are measured in full without it; the local viewer (scripts/cad-viewer.mts) can draw it.`],
      };
    }
    return { ok: true, kind: m.kind, name: m.name, scale: m.scale, report, svg: picture.svg, pictureNotes: picture.notes };
  } catch (error) {
    return refusal(error, documentId);
  }
}

export async function interpretFiledDrawing(projectId: string, documentId: string, options: DrawingReadOptions = {}): Promise<DrawingInterpretOutcome> {
  await requireSession();
  try {
    const m = await measure(projectId, documentId, options);
    return { ok: true, ...(await forProject(projectId, () => interpretDrawing(m.report))) };
  } catch (error) {
    return refusal(error, documentId);
  }
}
