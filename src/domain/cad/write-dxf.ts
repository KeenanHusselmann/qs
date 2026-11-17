/**
 * A minimal ASCII DXF writer – for tests and the sample fixture only.
 *
 * The platform consumes drawings and never authors them (PLATFORM.md §2.3). This exists because
 * the repository holds no real DXF, and a reader is only proven against drawings whose answers
 * were worked out by hand: a 10 × 5 m rectangle is 50 m² whatever the code thinks. Writing them
 * here keeps every test's geometry readable in the test itself.
 *
 * Output is the subset `parseDxf` reads – enough to round-trip, not a file AutoCAD has been shown.
 */

export interface DxfLayer {
  name: string;
}

export type DxfShape =
  | { type: "LINE"; layer: string; handle?: string; from: [number, number]; to: [number, number] }
  | { type: "ARC"; layer: string; handle?: string; center: [number, number]; radius: number; start: number; end: number }
  | { type: "CIRCLE"; layer: string; handle?: string; center: [number, number]; radius: number }
  | { type: "LWPOLYLINE"; layer: string; handle?: string; points: [number, number, number?][]; closed: boolean }
  | { type: "POLYLINE"; layer: string; handle?: string; points: [number, number, number?][]; closed: boolean }
  | { type: "TEXT"; layer: string; handle?: string; at: [number, number]; height: number; text: string }
  | { type: "MTEXT"; layer: string; handle?: string; at: [number, number]; height: number; text: string }
  | { type: "INSERT"; layer: string; handle?: string; block: string; at: [number, number]; scale?: [number, number]; rotation?: number }
  | { type: "RAW"; lines: (string | number)[] };

export interface DxfSpec {
  insunits?: number | null;
  version?: string;
  layers?: string[];
  blocks?: { name: string; base?: [number, number]; shapes: DxfShape[] }[];
  entities: DxfShape[];
}

function shape(s: DxfShape): (string | number)[] {
  if (s.type === "RAW") return s.lines;
  const head = (type: string) => [0, type, ...(s.handle ? [5, s.handle] : []), 8, s.layer];
  switch (s.type) {
    case "LINE":
      return [...head("LINE"), 10, s.from[0], 20, s.from[1], 11, s.to[0], 21, s.to[1]];
    case "ARC":
      return [...head("ARC"), 10, s.center[0], 20, s.center[1], 40, s.radius, 50, s.start, 51, s.end];
    case "CIRCLE":
      return [...head("CIRCLE"), 10, s.center[0], 20, s.center[1], 40, s.radius];
    case "LWPOLYLINE":
      return [...head("LWPOLYLINE"), 90, s.points.length, 70, s.closed ? 1 : 0, ...s.points.flatMap(([x, y, b]) => [10, x, 20, y, ...(b ? [42, b] : [])])];
    case "POLYLINE":
      return [
        ...head("POLYLINE"),
        66,
        1,
        70,
        s.closed ? 1 : 0,
        ...s.points.flatMap(([x, y, b]) => [0, "VERTEX", 8, s.layer, 10, x, 20, y, ...(b ? [42, b] : [])]),
        0,
        "SEQEND",
      ];
    case "TEXT":
      return [...head("TEXT"), 10, s.at[0], 20, s.at[1], 40, s.height, 1, s.text];
    case "MTEXT":
      return [...head("MTEXT"), 10, s.at[0], 20, s.at[1], 40, s.height, 1, s.text];
    case "INSERT":
      return [...head("INSERT"), 2, s.block, 10, s.at[0], 20, s.at[1], 41, s.scale?.[0] ?? 1, 42, s.scale?.[1] ?? 1, 50, s.rotation ?? 0];
  }
}

export function writeDxf(spec: DxfSpec): string {
  const out: (string | number)[] = [0, "SECTION", 2, "HEADER", 9, "$ACADVER", 1, spec.version ?? "AC1027"];
  if (spec.insunits !== null && spec.insunits !== undefined) out.push(9, "$INSUNITS", 70, spec.insunits);
  out.push(0, "ENDSEC");
  out.push(0, "SECTION", 2, "TABLES", 0, "TABLE", 2, "LAYER", ...(spec.layers ?? []).flatMap((name) => [0, "LAYER", 2, name, 70, 0]), 0, "ENDTAB", 0, "ENDSEC");
  out.push(0, "SECTION", 2, "BLOCKS");
  for (const b of spec.blocks ?? []) {
    out.push(0, "BLOCK", 8, "0", 2, b.name, 70, 0, 10, b.base?.[0] ?? 0, 20, b.base?.[1] ?? 0);
    for (const s of b.shapes) out.push(...shape(s));
    out.push(0, "ENDBLK");
  }
  out.push(0, "ENDSEC");
  out.push(0, "SECTION", 2, "ENTITIES");
  for (const s of spec.entities) out.push(...shape(s));
  out.push(0, "ENDSEC", 0, "EOF");
  // Group codes right-aligned in three columns, as AutoCAD writes them – the parser must not care.
  return out.map((v, i) => (i % 2 === 0 ? String(v).padStart(3) : String(v))).join("\n") + "\n";
}

/** An axis-aligned rectangle as a closed LWPOLYLINE, anticlockwise from its lower-left corner. */
export const rect = (layer: string, x: number, y: number, w: number, h: number, handle?: string): DxfShape => ({
  type: "LWPOLYLINE",
  layer,
  handle,
  closed: true,
  points: [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ],
});
