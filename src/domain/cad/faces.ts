/**
 * Enclosed regions of a line network – how a site plan's erven are found.
 *
 * ── Why closed loops were not enough ───────────────────────────────────────────────────────
 *
 * On a site development plan the erven are not drawn one closed outline each. Their boundaries
 * are a network: one line is the edge of two erven, a road reserve runs past ten of them, and
 * lines cross and end on each other. Measured on a real SDP (A0, 1:1250): 17 816 open chains and
 * 215 junctions, and not one erf boundary closed on its own. `findLoops` is right to refuse those
 * – which way round a junction goes is not its decision – so the regions have to be traced from
 * the network as a whole, the way CAD's own "pick a point inside" boundary command does it.
 *
 * ── How ────────────────────────────────────────────────────────────────────────────────────
 *
 * 1. Every segment on the chosen layers is split wherever another crosses it or ends on it.
 * 2. Ends are snapped together within the tolerance, so a plotter's hairline gaps close.
 * 3. Dead ends – a line that stops in the middle of an erf – are pruned; they bound nothing.
 * 4. Each region is walked by always taking the next edge clockwise at every node. That visits
 *    every enclosed face once, anticlockwise, so its shoelace area is positive; the one face
 *    walked clockwise is the outside of the whole network, and is dropped.
 *
 * The result is a set of regions that tile the network without overlapping, each with the
 * handles of every line that bounds it – so an erf's area cites its own boundary.
 */

import type { Entity, Point, Vertex } from "./dxf";
import { arcAsVertices, flatten } from "./geometry";

export interface Face {
  ring: Vertex[];
  /** m² once units are applied; drawing units² here. Always positive. */
  area: number;
  /** Every source entity with an edge on this face's boundary. */
  handles: string[];
  layer: string;
}

interface Segment {
  a: Point;
  b: Point;
  handle: string;
}

/** Segments from the linework – polylines edge by edge, arcs as short chords. */
function segmentsOf(entities: readonly Entity[]): Segment[] {
  const out: Segment[] = [];
  entities.forEach((e, index) => {
    const handle = e.handle ?? `#${index}`;
    const run = (pts: Point[], closed: boolean) => {
      for (let i = 0; i + 1 < pts.length; i++) out.push({ a: pts[i]!, b: pts[i + 1]!, handle });
      if (closed && pts.length > 2) out.push({ a: pts[pts.length - 1]!, b: pts[0]!, handle });
    };
    if (e.kind === "line") out.push({ a: e.start, b: e.end, handle });
    else if (e.kind === "polyline") run(e.vertices.some((v) => v.bulge !== 0) ? flatten(e.vertices, 8) : e.vertices, e.closed);
    else if (e.kind === "arc") {
      const [s, end] = arcAsVertices(e);
      const pts = flatten([s, { ...end, bulge: 0 }], 12);
      run([...pts, end], false);
    }
  });
  return out.filter((s) => Number.isFinite(s.a.x + s.a.y + s.b.x + s.b.y) && Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) > 0);
}

/** Where segment p crosses or touches segment q, as a fraction along p – or null. */
function crossing(p: Segment, q: Segment, tol: number): number | null {
  const rx = p.b.x - p.a.x, ry = p.b.y - p.a.y;
  const sx = q.b.x - q.a.x, sy = q.b.y - q.a.y;
  const denom = rx * sy - ry * sx;
  const lenP = Math.hypot(rx, ry), lenQ = Math.hypot(sx, sy);
  if (Math.abs(denom) < 1e-12 * lenP * lenQ) return null; // parallel: overlapping runs are left to snapping
  const qpx = q.a.x - p.a.x, qpy = q.a.y - p.a.y;
  const t = (qpx * sy - qpy * sx) / denom;
  const u = (qpx * ry - qpy * rx) / denom;
  // Within the segments, allowing the tolerance at each end so a T-junction drawn a hair short still meets.
  const tt = tol / lenP, tu = tol / lenQ;
  if (t < -tt || t > 1 + tt || u < -tu || u > 1 + tu) return null;
  return Math.min(1, Math.max(0, t));
}

export interface FaceOptions {
  /** Snap distance in drawing units. */
  tolerance: number;
  /** Most segments to work on – the splitting compares neighbours through a grid, but a budget still applies. */
  maxSegments?: number;
}

export interface FaceResult {
  faces: Face[];
  segments: number;
  /** Set when the budget stopped the work, with why. */
  truncated: string | null;
}

export function networkFaces(entities: readonly Entity[], layer: string, options: FaceOptions): FaceResult {
  const tol = options.tolerance;
  if (!(tol > 0)) throw new RangeError("The snap tolerance must be a positive number.");
  const segs = segmentsOf(entities);
  const max = options.maxSegments ?? 60_000;
  if (segs.length > max) return { faces: [], segments: segs.length, truncated: `${segs.length} segments on ${layer} is more than ${max}; regions were not traced.` };

  // 1. Split at crossings, comparing only segments that share a grid cell.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, total = 0;
  for (const s of segs) {
    minX = Math.min(minX, s.a.x, s.b.x);
    maxX = Math.max(maxX, s.a.x, s.b.x);
    minY = Math.min(minY, s.a.y, s.b.y);
    maxY = Math.max(maxY, s.a.y, s.b.y);
    total += Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
  }
  const cellSize = Math.max(total / Math.max(segs.length, 1), (Math.max(maxX - minX, maxY - minY) || 1) / 2000, tol * 4);
  const cells = new Map<string, number[]>();
  segs.forEach((s, i) => {
    const x0 = Math.floor((Math.min(s.a.x, s.b.x) - tol) / cellSize), x1 = Math.floor((Math.max(s.a.x, s.b.x) + tol) / cellSize);
    const y0 = Math.floor((Math.min(s.a.y, s.b.y) - tol) / cellSize), y1 = Math.floor((Math.max(s.a.y, s.b.y) + tol) / cellSize);
    for (let cx = x0; cx <= x1; cx++)
      for (let cy = y0; cy <= y1; cy++) {
        const key = `${cx},${cy}`;
        const list = cells.get(key);
        if (list) list.push(i);
        else cells.set(key, [i]);
      }
  });
  const cuts: number[][] = segs.map(() => [0, 1]);
  const tested = new Set<number>();
  for (const list of cells.values()) {
    for (let x = 0; x < list.length; x++)
      for (let y = x + 1; y < list.length; y++) {
        const i = list[x]!, j = list[y]!;
        const key = i < j ? i * segs.length + j : j * segs.length + i;
        if (tested.has(key)) continue;
        tested.add(key);
        const t = crossing(segs[i]!, segs[j]!, tol);
        if (t !== null) cuts[i]!.push(t);
        const u = crossing(segs[j]!, segs[i]!, tol);
        if (u !== null) cuts[j]!.push(u);
      }
  }

  // 2. Snap the pieces' ends to shared nodes.
  const nodes: Point[] = [];
  const grid = new Map<string, number[]>();
  const cell = (v: number) => Math.floor(v / tol);
  const nodeAt = (p: Point): number => {
    const cx = cell(p.x), cy = cell(p.y);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const id of grid.get(`${cx + dx},${cy + dy}`) ?? []) if (Math.hypot(nodes[id]!.x - p.x, nodes[id]!.y - p.y) <= tol) return id;
    nodes.push({ x: p.x, y: p.y });
    const key = `${cx},${cy}`;
    const list = grid.get(key);
    if (list) list.push(nodes.length - 1);
    else grid.set(key, [nodes.length - 1]);
    return nodes.length - 1;
  };
  const edgeHandle = new Map<string, string>();
  const adjacency = new Map<number, Set<number>>();
  const link = (u: number, v: number, handle: string) => {
    if (u === v) return;
    const key = u < v ? `${u}-${v}` : `${v}-${u}`;
    if (!edgeHandle.has(key)) edgeHandle.set(key, handle);
    if (!adjacency.has(u)) adjacency.set(u, new Set());
    if (!adjacency.has(v)) adjacency.set(v, new Set());
    adjacency.get(u)!.add(v);
    adjacency.get(v)!.add(u);
  };
  segs.forEach((s, i) => {
    const ts = [...new Set(cuts[i]!)].sort((a, b) => a - b);
    let prev = nodeAt(s.a);
    for (const t of ts.slice(1)) {
      const next = nodeAt({ x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t });
      link(prev, next, s.handle);
      prev = next;
    }
  });

  // 3. Prune dead ends until none are left.
  const queue = [...adjacency.keys()].filter((n) => adjacency.get(n)!.size <= 1);
  while (queue.length) {
    const n = queue.pop()!;
    const around = adjacency.get(n);
    if (!around) continue;
    for (const m of around) {
      adjacency.get(m)?.delete(n);
      if ((adjacency.get(m)?.size ?? 0) <= 1) queue.push(m);
    }
    adjacency.delete(n);
  }

  // 4. Walk every face, taking the next edge clockwise at each node.
  const order = new Map<number, number[]>();
  for (const [n, around] of adjacency) {
    const p = nodes[n]!;
    order.set(n, [...around].sort((a, b) => Math.atan2(nodes[a]!.y - p.y, nodes[a]!.x - p.x) - Math.atan2(nodes[b]!.y - p.y, nodes[b]!.x - p.x)));
  }
  const visited = new Set<string>();
  const faces: Face[] = [];
  for (const [start, around] of order) {
    for (const first of around) {
      if (visited.has(`${start}>${first}`)) continue;
      const ring: number[] = [];
      let u = start, v = first, guard = 0;
      while (!visited.has(`${u}>${v}`) && guard++ < 1_000_000) {
        visited.add(`${u}>${v}`);
        ring.push(u);
        // At v, the edge back to u; the next face edge is the one just before it, anticlockwise order.
        const list = order.get(v)!;
        const back = list.indexOf(u);
        const w = list.at((back - 1 + list.length) % list.length)!;
        u = v;
        v = w;
      }
      if (ring.length < 3) continue;
      let area = 0;
      for (let k = 0; k < ring.length; k++) {
        const a = nodes[ring[k]!]!, b = nodes[ring[(k + 1) % ring.length]!]!;
        area += (a.x * b.y - b.x * a.y) / 2;
      }
      if (area <= tol * tol) continue; // the outside of the network walks clockwise: negative
      const handles = new Set<string>();
      for (let k = 0; k < ring.length; k++) {
        const a = ring[k]!, b = ring[(k + 1) % ring.length]!;
        const h = edgeHandle.get(a < b ? `${a}-${b}` : `${b}-${a}`);
        if (h) handles.add(h);
      }
      faces.push({ ring: ring.map((n) => ({ ...nodes[n]!, bulge: 0 })), area, handles: [...handles], layer });
    }
  }
  return { faces, segments: segs.length, truncated: null };
}
