/**
 * The concept-layout reader as an MCP server – the shape CADCraft and SolidCraft expose, on our code.
 *
 * ── What this is for ───────────────────────────────────────────────────────────────────────
 *
 * The video this spike came from shows an agent driving a CAD package through MCP. The part of
 * that worth having is not the drawing – this platform consumes drawings, never authors them
 * (§2.3) – it is that an agent can *ask a drawing questions*: what layers, which closed outlines,
 * how large, which labels disagree with the geometry. These tools answer exactly that, from
 * `domain/cad`, so a QS's own Claude or Codex gets the same figures the platform would.
 *
 * ── Read-only, and boxed in ────────────────────────────────────────────────────────────────
 *
 * Every tool reads. None writes a drawing. A path must sit inside one of the roots the server
 * was started with, end in `.dxf` and be under the platform's 64 MB document limit – so a prompt
 * cannot talk the agent into reading a file it was never pointed at.
 *
 * ── The protocol, by hand ──────────────────────────────────────────────────────────────────
 *
 * MCP over stdio is newline-delimited JSON-RPC 2.0: `initialize`, then `tools/list` and
 * `tools/call`. That is small enough to answer here without adding an SDK and a lockfile change
 * for a spike. This module is the handler only – pure, given its file access – so it is tested
 * without a process; `scripts/cad-mcp.mts` is the transport.
 */

import path from "node:path";

import { DxfUnreadable, parseDxf, type Drawing, type EntityKind } from "@/domain/cad/dxf";
import { readDrawing, type DrawingReport, type StatedUnits } from "@/domain/cad/read-drawing";
import { renderSvg } from "@/domain/cad/render";
import { readPdfDrawing } from "@/lib/cad/read-pdf";

export const SERVER_INFO = { name: "qs-cad-reader", version: "0.1.0" } as const;

/** Protocol revisions this handler speaks; a client asking for another is answered with the newest. */
export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;

const MAX_BYTES = 64 * 1024 * 1024;

export interface FileAccess {
  size(absolutePath: string): number;
  read(absolutePath: string): string;
  /** The file's bytes – for a PDF, which is binary. */
  readBytes(absolutePath: string): Uint8Array;
  /**
   * Where a path really points once links are followed. A symbolic link inside an allowed folder
   * can point anywhere, so confinement is checked on this, not on the path as written.
   */
  realpath(absolutePath: string): string;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: string | number | null; result: unknown }
  | { jsonrpc: "2.0"; id: string | number | null; error: { code: number; message: string } };

interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

class ToolError extends Error {}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

const TOOLS = [
  {
    name: "open_drawing",
    description:
      "Open a drawing – an ASCII DXF, or a PDF plotted from CAD – and measure it. Returns the units or scale, layer count, closed outlines found, blocks and anything not read. Call this first; the other tools read the drawing it opened. For a PDF, layers are pens (colour and weight); on a site plan, pass the pen of the erf boundaries as `regions` to trace each erf and check its printed area.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to a .dxf or .pdf file inside the server's allowed folders." },
        units: { type: "string", enum: ["mm", "cm", "m"], description: "DXF only, and only if the drawing does not state its units. Areas are withheld until units are known." },
        scale: { type: "number", description: "PDF only: 1:scale, when the sheet prints none or more than one." },
        page: { type: "number", description: "PDF only: which page, from 1." },
        regions: { type: "array", items: { type: "string" }, description: "Layers (for a PDF, pens such as \"stroke #b4a35c 0.60pt\") whose lines are a boundary network to trace regions from." },
        snap: { type: "number", description: "Metres: boundary gaps up to this are closed when tracing regions." },
      },
      required: ["path"],
    },
  },
  {
    name: "inspect_drawing",
    description: "Per-layer summary of the open drawing: entity counts, total linework length (m) and closed outlines per layer, plus what was skipped and why.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_loops",
    description:
      "Closed outlines with area (m²), perimeter (m), net area after courtyards, nesting, and the entity handles each was measured from. Filter by layer or minimum area.",
    inputSchema: { type: "object", properties: { layer: { type: "string" }, minArea: { type: "number", description: "m²" }, block: { type: "string", description: "A block name, or omit for model space and blocks alike." } } },
  },
  {
    name: "count_blocks",
    description: "Block inserts by name – a unit type drawn once and inserted many times – with each block's footprint (m²) and the total across inserts.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "check_areas",
    description: "Every area printed on the drawing (\"BEDROOM 12,0 m²\") compared with the closed outline the label sits in, within 0,5% or the printed rounding.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "find_text",
    description: "Text on the drawing, with layer, block and position. Filter by words it contains or by layer.",
    inputSchema: { type: "object", properties: { contains: { type: "string" }, layer: { type: "string" }, limit: { type: "number" } } },
  },
  {
    name: "query_entities",
    description: "Model-space entities with their handles and geometry, filtered by kind and layer, paged.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["line", "arc", "circle", "polyline", "text", "insert"] },
        layer: { type: "string" },
        limit: { type: "number" },
        offset: { type: "number" },
      },
    },
  },
  {
    name: "render",
    description: "The drawing as SVG, with the given loops (\"L3\") or entity handles picked out – the evidence for a figure, to show a person.",
    inputSchema: { type: "object", properties: { highlight: { type: "array", items: { type: "string" } }, width: { type: "number" } } },
  },
].map((t) => ({ ...t, annotations: READ_ONLY }));

const text = (value: unknown): ToolResult => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v : undefined);
const numArg = (v: unknown, fallback: number, max: number): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(v, max) : fallback);

export function createCadServer(options: { roots: string[]; files: FileAccess }) {
  const roots = options.roots.map((r) => path.resolve(r));
  const realRoots = roots.map((r) => {
    try {
      return options.files.realpath(r);
    } catch {
      return r;
    }
  });
  let open: { path: string; drawing: Drawing; report: DrawingReport } | null = null;

  const within = (candidate: string, folders: string[]) =>
    folders.some((root) => {
      const rel = path.relative(root, candidate);
      return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
    });

  function allowed(requested: string): string {
    if (requested.includes("\0")) throw new ToolError("That path is not valid.");
    const abs = path.resolve(roots[0] ?? ".", requested);
    if (!within(abs, roots)) throw new ToolError(`${requested} is outside the folders this server may read.`);
    if (![".dxf", ".pdf"].includes(path.extname(abs).toLowerCase())) throw new ToolError(`${requested} is not a .dxf or .pdf file. DWG is not read: re-save it as an ASCII DXF, or plot it to PDF.`);
    let real: string;
    try {
      real = options.files.realpath(abs);
    } catch {
      throw new ToolError(`${requested} could not be found.`);
    }
    if (!within(real, realRoots)) throw new ToolError(`${requested} links to a file outside the folders this server may read.`);
    if (![".dxf", ".pdf"].includes(path.extname(real).toLowerCase())) throw new ToolError(`${requested} links to something that is not a .dxf or .pdf file.`);
    return real;
  }

  function current() {
    if (!open) throw new ToolError("No drawing is open. Call open_drawing first.");
    return open;
  }

  const handlers: Record<string, (args: Record<string, unknown>) => ToolResult | Promise<ToolResult>> = {
    async open_drawing(args) {
      const requested = str(args.path);
      if (!requested) throw new ToolError("path is required.");
      const abs = allowed(requested);
      let size: number;
      try {
        size = options.files.size(abs);
      } catch {
        throw new ToolError(`${requested} could not be found.`);
      }
      if (size > MAX_BYTES) throw new ToolError(`${requested} is ${(size / 1048576).toFixed(1)} MB, over the 64 MB limit.`);
      const units = str(args.units) as StatedUnits | undefined;
      if (units && !["mm", "cm", "m"].includes(units)) throw new ToolError("units must be mm, cm or m.");
      const regions = Array.isArray(args.regions) ? args.regions.filter((r): r is string => typeof r === "string" && r.length <= 200).slice(0, 10) : [];
      const snap = typeof args.snap === "number" && args.snap > 0 && args.snap <= 20 ? args.snap : undefined;
      let drawing: Drawing, report: DrawingReport;
      if (abs.toLowerCase().endsWith(".pdf")) {
        const scale = typeof args.scale === "number" && args.scale >= 1 && args.scale <= 100_000 ? args.scale : undefined;
        const page = typeof args.page === "number" && Number.isInteger(args.page) && args.page >= 1 ? args.page : undefined;
        try {
          ({ drawing, report } = await readPdfDrawing(options.files.readBytes(abs), { scale, page, regionLayers: regions, snapMetres: snap }));
        } catch (e) {
          if (e instanceof RangeError) throw new ToolError(e.message);
          throw new ToolError(`${requested} could not be read as a PDF drawing.`);
        }
      } else {
        drawing = parseDxf(options.files.read(abs));
        report = readDrawing(drawing, { units, ...(regions.length ? { regions: { layers: regions, snapMetres: snap } } : {}) });
      }
      open = { path: abs, drawing, report };
      return text({
        path: abs,
        version: report.version,
        units: report.units,
        layers: report.layers.length,
        entities: drawing.entities.length,
        loops: report.loops.length,
        blocks: report.blocks.map((b) => `${b.name} × ${b.inserts}`),
        areaChecks: { agree: report.areaChecks.filter((c) => c.agrees === true).length, disagree: report.areaChecks.filter((c) => c.agrees === false).length, unchecked: report.areaChecks.filter((c) => c.agrees === null).length },
        openChains: report.open.length,
        junctions: report.junctions.length,
        skipped: report.skipped,
        notes: report.notes,
      });
    },
    inspect_drawing() {
      const { report } = current();
      return text({ units: report.units, layers: report.layers.filter((l) => Object.keys(l.counts).length > 0 || l.loops > 0), skipped: report.skipped, openChains: report.open, junctions: report.junctions, notes: report.notes });
    },
    list_loops(args) {
      const { report } = current();
      const layer = str(args.layer), block = str(args.block);
      const min = typeof args.minArea === "number" ? args.minArea : null;
      return text(report.loops.filter((l) => (!layer || l.layer === layer) && (!block || l.block === block) && (min === null || (l.area ?? 0) >= min)));
    },
    count_blocks() {
      return text(current().report.blocks);
    },
    check_areas() {
      return text(current().report.areaChecks);
    },
    find_text(args) {
      const { report } = current();
      const contains = str(args.contains)?.toLowerCase(), layer = str(args.layer);
      return text(report.texts.filter((t) => (!contains || t.text.toLowerCase().includes(contains)) && (!layer || t.layer === layer)).slice(0, numArg(args.limit, 100, 1000)));
    },
    query_entities(args) {
      const { drawing } = current();
      const kind = str(args.kind) as EntityKind | undefined, layer = str(args.layer);
      const matching = drawing.entities.filter((e) => (!kind || e.kind === kind) && (!layer || e.layer === layer));
      const offset = numArg(args.offset, 0, Number.MAX_SAFE_INTEGER), limit = numArg(args.limit, 50, 500);
      return text({ total: matching.length, offset, entities: matching.slice(offset, offset + limit) });
    },
    render(args) {
      const { drawing, report } = current();
      const wanted = Array.isArray(args.highlight) ? args.highlight.filter((h): h is string => typeof h === "string") : [];
      // A loop id stands for the entities it was measured from.
      const handles = wanted.flatMap((h) => report.loops.find((l) => l.id === h)?.handles ?? [h]);
      const { svg, notes } = renderSvg(drawing, { highlight: handles, width: numArg(args.width, 1200, 4000) });
      return { content: [{ type: "text", text: svg }, ...(notes.length ? [{ type: "text" as const, text: notes.join("\n") }] : [])] };
    },
  };

  async function callTool(params: Record<string, unknown> | undefined): Promise<ToolResult> {
    const name = str(params?.name);
    const handler = name ? handlers[name] : undefined;
    if (!handler) return { content: [{ type: "text", text: `Unknown tool ${JSON.stringify(name)}.` }], isError: true };
    const args = params?.arguments && typeof params.arguments === "object" ? (params.arguments as Record<string, unknown>) : {};
    try {
      return await handler(args);
    } catch (e) {
      // A tool's own failure is a result the agent can read and act on, not a protocol error.
      if (e instanceof ToolError || e instanceof DxfUnreadable) return { content: [{ type: "text", text: e.message }], isError: true };
      throw e;
    }
  }

  /** Answer one message. Notifications get no answer, so null. */
  async function handle(message: unknown): Promise<JsonRpcResponse | null> {
    const req = message as Partial<JsonRpcRequest>;
    if (!req || typeof req !== "object" || req.jsonrpc !== "2.0" || typeof req.method !== "string") {
      return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } };
    }
    const isNotification = req.id === undefined;
    const id = req.id ?? null;
    const ok = (result: unknown): JsonRpcResponse | null => (isNotification ? null : { jsonrpc: "2.0", id, result });

    switch (req.method) {
      case "initialize": {
        const asked = str(req.params?.protocolVersion);
        const protocolVersion = asked && (PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : PROTOCOL_VERSIONS[0];
        return ok({
          protocolVersion,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
          instructions: "Read-only. open_drawing first, then list_loops, count_blocks and check_areas. Every area cites the entity handles it was measured from; quote them.",
        });
      }
      case "notifications/initialized":
      case "notifications/cancelled":
        return null;
      case "ping":
        return ok({});
      case "tools/list":
        return ok({ tools: TOOLS });
      case "tools/call":
        try {
          return ok(await callTool(req.params));
        } catch (e) {
          return isNotification ? null : { jsonrpc: "2.0", id, error: { code: -32603, message: e instanceof Error ? e.message : String(e) } };
        }
      default:
        return isNotification ? null : { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${req.method}` } };
    }
  }

  return { handle };
}
