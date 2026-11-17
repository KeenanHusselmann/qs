/**
 * Areas, lengths and closed loops from drawing geometry – PLATFORM.md §10, §5.
 *
 * ── The arithmetic, and why it is exact enough to defend ───────────────────────────────────
 *
 * A closed outline's area is the shoelace sum over its vertices, plus, for every curved segment,
 * the circular segment between the chord and the arc. DXF stores a curved polyline segment as a
 * **bulge** b = tan(θ/4), θ the arc's included angle, positive when the arc runs anticlockwise
 * from its start vertex to its end. So with c the chord length:
 *
 *     θ = 4·atan|b|      r = c / (2·sin(θ/2))      segment = r²·(θ − sin θ) / 2
 *
 * and the signed area is shoelace + Σ sign(b)·segment. That is closed-form – no arc is chopped
 * into straight pieces to be measured – so a semicircular bay window on a 2 m chord adds π/2 m²
 * exactly, not 1,569 m² from a 16-sided approximation.
 *
 * ── Loops that were drawn as loose lines ───────────────────────────────────────────────────
 *
 * Architects do not always draw a room as one closed polyline. Often it is four LINEs that happen
 * to meet. `findLoops` joins LINEs, ARCs and open polylines end to end – within a snap tolerance,
 * because plotting and typed coordinates leave hairline gaps – and reports three outcomes, never
 * a guess: a closed loop (measured), an open chain (not measured, with the size of its gap), or a
 * junction where three or more pieces meet (not measured: which way round the room goes is a
 * judgement, and this code does not make judgements).
 */

import type { Entity, Point, Vertex } from "./dxf";

const TAU = Math.PI * 2;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** The circular segment between a chord and its arc, signed by the bulge's direction. */
function bulgeSegment(a: Point, b: Point, bulge: number): number {
  if (bulge === 0) return 0;
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  if (chord === 0) return 0;
  const theta = 4 * Math.atan(Math.abs(bulge));
  const r = chord / (2 * Math.sin(theta / 2));
  return Math.sign(bulge) * ((r * r * (theta - Math.sin(theta))) / 2);
}

/** Length of a segment, straight or curved. */
export function segmentLength(a: Point, b: Point, bulge: number): number {
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  if (bulge === 0 || chord === 0) return chord;
  const theta = 4 * Math.atan(Math.abs(bulge));
  return (chord / (2 * Math.sin(theta / 2))) * theta;
}

/** Signed area of a closed ring – positive when it runs anticlockwise. Vertex i's bulge shapes segment i → i+1. */
export function signedArea(ring: readonly Vertex[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    sum += (a.x * b.y - b.x * a.y) / 2 + bulgeSegment(a, b, a.bulge);
  }
  return sum;
}

export function ringLength(ring: readonly Vertex[], closed: boolean): number {
  let sum = 0;
  const n = closed ? ring.length : ring.length - 1;
  for (let i = 0; i < n; i++) sum += segmentLength(ring[i]!, ring[(i + 1) % ring.length]!, ring[i]!.bulge);
  return sum;
}

/** An ARC's anticlockwise sweep, in radians, from its start angle to its end angle. */
function arcSweep(startAngle: number, endAngle: number): number {
  const s = ((endAngle - startAngle) % 360 + 360) % 360;
  return rad(s === 0 ? 360 : s);
}

/** An ARC as two vertices joined by a bulge, start to end – the form every ring uses. */
export function arcAsVertices(arc: { center: Point; radius: number; startAngle: number; endAngle: number }): [Vertex, Point] {
  const at = (deg: number): Point => ({ x: arc.center.x + arc.radius * Math.cos(rad(deg)), y: arc.center.y + arc.radius * Math.sin(rad(deg)) });
  return [{ ...at(arc.startAngle), bulge: Math.tan(arcSweep(arc.startAngle, arc.endAngle) / 4) }, at(arc.endAngle)];
}

/** A circle as a closed ring of two semicircles – bulge 1 is a half turn. */
export function circleRing(center: Point, radius: number): Vertex[] {
  return [
    { x: center.x + radius, y: center.y, bulge: 1 },
    { x: center.x - radius, y: center.y, bulge: 1 },
  ];
}

/** Straight-line approximation of a ring, used only to ask "is this point inside" – never to measure. */
export function flatten(ring: readonly Vertex[], perArc = 16): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    out.push({ x: a.x, y: a.y });
    if (a.bulge === 0) continue;
    const theta = 4 * Math.atan(a.bulge); // signed: anticlockwise positive
    const chord = Math.hypot(b.x - a.x, b.y - a.y);
    if (chord === 0) continue;
    const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
    // The centre sits off the chord's midpoint, on the side the arc turns towards.
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const d = Math.sqrt(Math.max(r * r - (chord / 2) ** 2, 0)) * (Math.abs(theta) > Math.PI ? -1 : 1);
    const nx = -(b.y - a.y) / chord, ny = (b.x - a.x) / chord; // left normal
    const side = Math.sign(theta);
    const cx = mx + nx * d * side, cy = my + ny * d * side;
    const start = Math.atan2(a.y - cy, a.x - cx);
    for (let k = 1; k < perArc; k++) {
      const t = start + (theta * k) / perArc;
      out.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
    }
  }
  return out;
}

export function pointInPolygon(p: Point, poly: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Points of an open run, in order; vertex i's bulge shapes segment i → i+1, the last bulge is unused. */
type Run = Vertex[];

/** The same run walked the other way: the order reverses and every curve turns the other way. */
function reverseRun(run: Run): Run {
  const n = run.length;
  return run.map((_, k) => {
    const v = run[n - 1 - k]!;
    // Segment k of the reversed run is segment n-2-k of the original, walked backwards.
    const bulge = k < n - 1 ? -run[n - 2 - k]!.bulge : 0;
    return { x: v.x, y: v.y, bulge };
  });
}

export interface Loop {
  layer: string;
  /** Every entity the outline is made of – what a figure taken from it cites. */
  handles: string[];
  ring: Vertex[];
  source: "polyline" | "circle" | "chain";
}

export interface OpenChain {
  layer: string;
  handles: string[];
  /** Distance between the two loose ends, in drawing units. A small gap is usually a drafting slip. */
  gap: number;
}

export interface Junction {
  layer: string;
  handles: string[];
  /** How many pieces meet at the busiest point. */
  meeting: number;
}

export interface LoopSearch {
  loops: Loop[];
  open: OpenChain[];
  junctions: Junction[];
}

interface Piece {
  handle: string;
  layer: string;
  run: Run;
}

/** What can be joined end to end: lines, arcs and open polylines. */
function piecesOf(entities: readonly Entity[]): Piece[] {
  const out: Piece[] = [];
  entities.forEach((e, index) => {
    const handle = e.handle ?? `#${index}`;
    if (e.kind === "line") out.push({ handle, layer: e.layer, run: [{ ...e.start, bulge: 0 }, { ...e.end, bulge: 0 }] });
    else if (e.kind === "arc") {
      const [s, end] = arcAsVertices(e);
      out.push({ handle, layer: e.layer, run: [s, { ...end, bulge: 0 }] });
    } else if (e.kind === "polyline" && !e.closed && e.vertices.length >= 2) out.push({ handle, layer: e.layer, run: e.vertices.map((v) => ({ ...v })) });
  });
  return out;
}

/**
 * Closed outlines, from closed polylines and circles directly and from loose pieces joined end to
 * end on the same layer. `tolerance` is the snap distance in drawing units.
 */
export function findLoops(entities: readonly Entity[], tolerance: number): LoopSearch {
  const loops: Loop[] = [];
  entities.forEach((e, index) => {
    const handle = e.handle ?? `#${index}`;
    if (e.kind === "polyline" && e.closed && e.vertices.length >= 2) loops.push({ layer: e.layer, handles: [handle], ring: e.vertices.map((v) => ({ ...v })), source: "polyline" });
    if (e.kind === "circle" && e.radius > 0) loops.push({ layer: e.layer, handles: [handle], ring: circleRing(e.center, e.radius), source: "circle" });
  });

  const open: OpenChain[] = [];
  const junctions: Junction[] = [];
  if (!(tolerance > 0) || !Number.isFinite(tolerance)) throw new RangeError("The snap tolerance must be a positive number.");

  // Lists grow by push, never by copying: a layer of 100 000 wall segments copied on every
  // append is five billion element moves – a drawing that hangs the reader is a denial of service.
  const push = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };

  const byLayer = new Map<string, Piece[]>();
  for (const p of piecesOf(entities)) push(byLayer, p.layer, p);

  for (const [layer, pieces] of byLayer) {
    // Snap endpoints to shared nodes through a grid of tolerance-sized cells.
    const nodes: Point[] = [];
    const grid = new Map<string, number[]>();
    const cell = (v: number) => Math.floor(v / tolerance);
    const nodeAt = (p: Point): number => {
      const cx = cell(p.x), cy = cell(p.y);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (const id of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
            const n = nodes[id]!;
            if (Math.hypot(n.x - p.x, n.y - p.y) <= tolerance) return id;
          }
      nodes.push({ x: p.x, y: p.y });
      push(grid, `${cx},${cy}`, nodes.length - 1);
      return nodes.length - 1;
    };

    const ends = pieces.map((p) => [nodeAt(p.run[0]!), nodeAt(p.run[p.run.length - 1]!)] as const);
    const touching = new Map<number, number[]>(); // node -> piece indexes
    ends.forEach(([a, b], i) => {
      push(touching, a, i);
      push(touching, b, i);
    });

    // Connected components of pieces.
    const seen = new Set<number>();
    for (let startPiece = 0; startPiece < pieces.length; startPiece++) {
      if (seen.has(startPiece)) continue;
      const component: number[] = [];
      const stack = [startPiece];
      seen.add(startPiece);
      while (stack.length) {
        const i = stack.pop()!;
        component.push(i);
        for (const node of ends[i]!)
          for (const j of touching.get(node) ?? []) {
            if (seen.has(j)) continue;
            seen.add(j);
            stack.push(j);
          }
      }

      const nodeIds = [...new Set(component.flatMap((i) => [...ends[i]!]))];
      const degree = (n: number) => (touching.get(n) ?? []).length;
      const handles = component.map((i) => pieces[i]!.handle);
      // A reduce, not Math.max(...): spreading a large array overflows the call stack.
      const busiest = nodeIds.reduce((m, id) => Math.max(m, degree(id)), 0);

      if (busiest > 2) {
        junctions.push({ layer, handles, meeting: busiest });
        continue;
      }
      const loose = nodeIds.filter((n) => degree(n) === 1);
      if (loose.length > 0) {
        const [a, b] = loose.map((n) => nodes[n]!);
        open.push({ layer, handles, gap: a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0 });
        continue;
      }

      // Every node meets exactly two pieces: walk the cycle.
      const ring: Vertex[] = [];
      const order: string[] = [];
      let piece = component[0]!;
      let from = ends[piece]![0];
      const used = new Set<number>();
      while (!used.has(piece)) {
        used.add(piece);
        order.push(pieces[piece]!.handle);
        const [a, b] = ends[piece]!;
        const run = from === a ? pieces[piece]!.run : reverseRun(pieces[piece]!.run);
        ring.push(...run.slice(0, -1));
        const to = from === a ? b : a;
        const next = (touching.get(to) ?? []).find((j) => j !== piece) ?? piece;
        from = to;
        piece = next;
      }
      if (ring.length >= 2) loops.push({ layer, handles: order, ring, source: "chain" });
    }
  }

  return { loops, open, junctions };
}

export const loopArea = (loop: Loop): number => Math.abs(signedArea(loop.ring));

/** Total length of the linework on each layer – what a wall run is measured from. */
export function lengthOf(e: Entity): number {
  switch (e.kind) {
    case "line":
      return Math.hypot(e.end.x - e.start.x, e.end.y - e.start.y);
    case "arc":
      return e.radius * arcSweep(e.startAngle, e.endAngle);
    case "circle":
      return TAU * e.radius;
    case "polyline":
      return ringLength(e.vertices, e.closed);
    default:
      return 0;
  }
}
