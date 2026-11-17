/**
 * Reading a DXF drawing – PLATFORM.md §10.5: "DWG/DXF/IFC are strictly better inputs than PDF".
 *
 * ── Why a reader of our own ────────────────────────────────────────────────────────────────
 *
 * A plotted PDF gives us strokes and we reconstruct walls by inference (§10.2–10.3). A DXF gives
 * us the objects themselves – a closed polyline is a room outline, a block insert is a unit, a
 * layer says which is which. ASCII DXF is a public, line-based format: alternating lines of a
 * group code and a value. It needs no library, the same way `.xlsx` is read without one
 * (`lib/ingest/xlsx.ts`), and it keeps the arithmetic in tested code that a QS can be shown.
 *
 * The approach follows what CADCraft's MCP server exposes (inspect, query entities, find text,
 * closed loops – MIT OR Apache-2.0), rebuilt here from the format's public reference rather than
 * copied, because this platform's rule is that a figure is computed by code we own and test.
 *
 * ── What is read, and what is counted instead ──────────────────────────────────────────────
 *
 * LINE, ARC, CIRCLE, LWPOLYLINE, 2D POLYLINE, TEXT, MTEXT and INSERT, in model space and inside
 * block definitions. Everything else – hatches, splines, dimensions, 3D meshes – is **counted by
 * name in `skipped`**, never silently dropped: a drawing that measured nothing because its walls
 * were splines must say so, not report an empty layer as though it were empty.
 *
 * Binary DXF is refused with a reason rather than misread.
 */

export interface Point {
  x: number;
  y: number;
}

/** A polyline vertex. `bulge` shapes the segment from this vertex to the next: 0 is straight. */
export interface Vertex extends Point {
  bulge: number;
}

interface Base {
  /** The entity's handle – its permanent id in the file, and what a figure cites as its source. */
  handle: string | null;
  layer: string;
}

export type Entity =
  | (Base & { kind: "line"; start: Point; end: Point })
  | (Base & { kind: "arc"; center: Point; radius: number; startAngle: number; endAngle: number })
  | (Base & { kind: "circle"; center: Point; radius: number })
  | (Base & { kind: "polyline"; vertices: Vertex[]; closed: boolean })
  | (Base & { kind: "text"; text: string; at: Point; height: number })
  | (Base & { kind: "insert"; block: string; at: Point; scaleX: number; scaleY: number; rotation: number });

export type EntityKind = Entity["kind"];

export interface Drawing {
  /** `$ACADVER` – "AC1027" is AutoCAD 2013. Null where the header does not say. */
  version: string | null;
  /** `$INSUNITS` – what one drawing unit is. Null where the header does not say. */
  insunits: number | null;
  /** Layers declared in the LAYER table, plus any an entity uses without declaring. */
  layers: string[];
  /** Model-space entities. */
  entities: Entity[];
  /** Named block definitions. Anonymous blocks (`*Model_Space`, `*D12`…) are left out. */
  blocks: Record<string, Entity[]>;
  /** Each block's base point – the point of the block that lands on an INSERT's position. */
  blockBase: Record<string, Point>;
  /** Entities not read, counted by DXF type – "HATCH": 14. */
  skipped: Record<string, number>;
  /** Anything else a reader should know about how the file was read. */
  notes: string[];
}

export class DxfUnreadable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DxfUnreadable";
  }
}

type Pair = readonly [code: number, value: string];

/** A DXF record: an entity, a table entry or a structural marker, with its group pairs. */
interface DxfRecord {
  type: string;
  pairs: Pair[];
}

function toPairs(text: string): Pair[] {
  if (text.startsWith("AutoCAD Binary DXF")) {
    throw new DxfUnreadable("This is a binary DXF. Re-save it from the CAD package as an ASCII DXF and file that instead.");
  }
  const lines = text.split(/\r\n|\r|\n/);
  const pairs: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const raw = lines[i]!.trim();
    if (raw === "" && i + 2 >= lines.length) break; // a trailing newline
    // `Number("")` is 0, which would read a blank line as the start of a record.
    const code = raw === "" ? NaN : Number(raw);
    if (!Number.isInteger(code)) {
      throw new DxfUnreadable(`Line ${i + 1} should be a group code and reads ${JSON.stringify(raw.slice(0, 40))}. The file is not an ASCII DXF, or it is damaged.`);
    }
    pairs.push([code, lines[i + 1]!.trim()]);
  }
  return pairs;
}

/** Split the pair stream into records, each starting at a group 0. */
function toRecords(pairs: Pair[]): DxfRecord[] {
  const records: DxfRecord[] = [];
  let current: DxfRecord | null = null;
  for (const pair of pairs) {
    if (pair[0] === 0) {
      current = { type: pair[1], pairs: [] };
      records.push(current);
    } else if (current) {
      current.pairs.push(pair);
    }
  }
  return records;
}

const first = (r: DxfRecord, code: number): string | undefined => r.pairs.find((p) => p[0] === code)?.[1];
const num = (r: DxfRecord, code: number, fallback = 0): number => {
  const v = first(r, code);
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const base = (r: DxfRecord): Base => ({ handle: first(r, 5) ?? null, layer: first(r, 8) ?? "0" });
const point = (r: DxfRecord, xCode = 10): Point => ({ x: num(r, xCode), y: num(r, xCode + 10) });

/**
 * Text as a person reads it. MTEXT carries inline formatting (`\P` paragraph, `{\fArial;…}` font
 * switches) and both kinds carry `%%` control codes and `\U+00B2` escapes – the ² of "m²" is very
 * often written that way, and an area label that lost it would no longer read as an area.
 */
export function plainText(raw: string): string {
  return raw
    .replace(/\\U\+([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/%%[dD]/g, "°")
    .replace(/%%[pP]/g, "±")
    .replace(/%%[cC]/g, "⌀")
    .replace(/%%%/g, "%")
    .replace(/\\P/g, "\n")
    .replace(/\\~/g, " ")
    .replace(/\\[fFHCAWQTp][^;]*;/g, "")
    .replace(/\\[LlOoKkNn]/g, "")
    .replace(/[{}]/g, "")
    .replace(/\\\\/g, "\\")
    .trim();
}

/**
 * LWPOLYLINE: vertices as repeated 10/20 pairs, each optionally followed by its 42 bulge. Null
 * where a coordinate is not a finite number – a damaged or hostile file must not put NaN or
 * Infinity into an area.
 */
function lwpolyline(r: DxfRecord): Entity | null {
  const vertices: Vertex[] = [];
  for (const [code, value] of r.pairs) {
    if (code === 10) vertices.push({ x: Number(value), y: 0, bulge: 0 });
    else if (code === 20 && vertices.length) vertices[vertices.length - 1]!.y = Number(value);
    else if (code === 42 && vertices.length) vertices[vertices.length - 1]!.bulge = Number(value);
  }
  if (!vertices.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.bulge))) return null;
  return { ...base(r), kind: "polyline", vertices, closed: (num(r, 70) & 1) === 1 };
}

const POLYLINE_3D = 8 | 16 | 64; // 3D polyline, 3D mesh, polyface mesh

/**
 * Interpret one section's records as entities. POLYLINE is the old form – a header record, then
 * VERTEX records, then SEQEND – so it consumes the records after it.
 */
function readEntities(records: DxfRecord[], skipped: Record<string, number>, notes: Set<string>): Entity[] {
  const out: Entity[] = [];
  const skip = (type: string) => (skipped[type] = (skipped[type] ?? 0) + 1);

  for (let i = 0; i < records.length; i++) {
    const r = records[i]!;
    if (first(r, 67) === "1") {
      notes.add("Entities in paper space (layouts) are not read – only model space and blocks.");
      skip(`${r.type} (paper space)`);
      continue;
    }
    switch (r.type) {
      case "LINE":
        out.push({ ...base(r), kind: "line", start: point(r, 10), end: point(r, 11) });
        break;
      case "ARC":
        out.push({ ...base(r), kind: "arc", center: point(r), radius: num(r, 40), startAngle: num(r, 50), endAngle: num(r, 51) });
        break;
      case "CIRCLE":
        out.push({ ...base(r), kind: "circle", center: point(r), radius: num(r, 40) });
        break;
      case "LWPOLYLINE": {
        const polyline = lwpolyline(r);
        if (polyline) out.push(polyline);
        else skip("LWPOLYLINE (unreadable coordinates)");
        break;
      }
      case "POLYLINE": {
        const flags = num(r, 70);
        const vertices: Vertex[] = [];
        let j = i + 1;
        for (; j < records.length && records[j]!.type === "VERTEX"; j++) {
          const v = records[j]!;
          vertices.push({ ...point(v), bulge: num(v, 42) });
        }
        if (records[j]?.type === "SEQEND") j++;
        i = j - 1;
        if (flags & POLYLINE_3D) {
          skip("POLYLINE (3D or mesh)");
          break;
        }
        out.push({ ...base(r), kind: "polyline", vertices, closed: (flags & 1) === 1 });
        break;
      }
      case "TEXT":
        out.push({ ...base(r), kind: "text", text: plainText(first(r, 1) ?? ""), at: point(r), height: num(r, 40) });
        break;
      case "MTEXT": {
        // Long MTEXT is split across 3-groups, with the final chunk in group 1.
        const chunks = r.pairs.filter((p) => p[0] === 3).map((p) => p[1]);
        const text = plainText([...chunks, first(r, 1) ?? ""].join(""));
        out.push({ ...base(r), kind: "text", text, at: point(r), height: num(r, 40) });
        break;
      }
      case "INSERT":
        out.push({
          ...base(r),
          kind: "insert",
          block: first(r, 2) ?? "",
          at: point(r),
          scaleX: num(r, 41, 1),
          scaleY: num(r, 42, 1),
          rotation: num(r, 50),
        });
        break;
      case "VERTEX":
      case "SEQEND":
        break;
      default:
        skip(r.type);
    }
  }
  return out;
}

/** Records between `0 SECTION / 2 <name>` and `0 ENDSEC`. */
function section(records: DxfRecord[], name: string): DxfRecord[] {
  const start = records.findIndex((r) => r.type === "SECTION" && first(r, 2) === name);
  if (start < 0) return [];
  const end = records.findIndex((r, i) => i > start && r.type === "ENDSEC");
  return records.slice(start + 1, end < 0 ? undefined : end);
}

/** `$NAME` header variables: a 9-group names the variable, the next pair is its value. */
function headerValue(pairs: Pair[], name: string): string | null {
  const at = pairs.findIndex((p) => p[0] === 9 && p[1] === name);
  return at >= 0 && pairs[at + 1] ? pairs[at + 1]![1] : null;
}

export function parseDxf(text: string): Drawing {
  const pairs = toPairs(text.replace(/^﻿/, ""));
  const records = toRecords(pairs);
  if (!records.some((r) => r.type === "SECTION")) {
    throw new DxfUnreadable("The file has no DXF sections. It is not a DXF drawing.");
  }

  const skipped: Record<string, number> = {};
  const notes = new Set<string>();

  const insunitsRaw = headerValue(pairs, "$INSUNITS");
  const insunits = insunitsRaw === null ? null : Number(insunitsRaw);

  const layers = new Set<string>(section(records, "TABLES").filter((r) => r.type === "LAYER").map((r) => first(r, 2) ?? "0"));

  const blocks: Record<string, Entity[]> = {};
  const blockBase: Record<string, Point> = {};
  const blockRecords = section(records, "BLOCKS");
  for (let i = 0; i < blockRecords.length; i++) {
    if (blockRecords[i]!.type !== "BLOCK") continue;
    const name = first(blockRecords[i]!, 2) ?? "";
    const at = point(blockRecords[i]!);
    const end = blockRecords.findIndex((r, j) => j > i && r.type === "ENDBLK");
    const body = blockRecords.slice(i + 1, end < 0 ? undefined : end);
    i = end < 0 ? blockRecords.length : end;
    if (name === "" || name.startsWith("*")) continue;
    blocks[name] = readEntities(body, skipped, notes);
    blockBase[name] = at;
  }

  const entities = readEntities(section(records, "ENTITIES"), skipped, notes);
  for (const e of [...entities, ...Object.values(blocks).flat()]) layers.add(e.layer);

  return {
    version: headerValue(pairs, "$ACADVER"),
    insunits: insunits !== null && Number.isFinite(insunits) ? insunits : null,
    layers: [...layers].sort(),
    entities,
    blocks,
    blockBase,
    skipped,
    notes: [...notes],
  };
}
