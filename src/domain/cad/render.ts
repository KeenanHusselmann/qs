/**
 * A drawing as SVG, with what a figure came from picked out – PLATFORM.md §1.3, §10.5.
 *
 * A passage proves a figure read from a document because a reader can see the words. An area
 * measured off geometry needs the same: the outline it was measured from, drawn in place, so a QS
 * can look and say "yes, that is the building" or "no, that loop is the site boundary". That is
 * all this is for – it is a picture of the evidence, not a drawing tool, and it draws nothing the
 * file does not contain.
 *
 * DXF's y axis points up and SVG's points down, so every y is negated; an anticlockwise arc in the
 * drawing is then drawn with SVG's sweep flag 0.
 */

import type { Drawing, Entity, Point, Vertex } from "./dxf";
import { arcAsVertices, circleRing } from "./geometry";

export interface RenderOptions {
  /** Entity handles to pick out – a loop's `handles`, or a block insert's. */
  highlight?: readonly string[];
  /** Output width in px; height follows the drawing's proportions. */
  width?: number;
  /**
   * The compact picture, for a page that highlights in the browser. Only shapes one of these
   * handles picks keep an element and a `data-h` of their own; everything else is drawn as one
   * merged path, and coordinates are rounded to a tenth of an output pixel.
   *
   * A plotted A1 sheet is some 120 000 segments (PLATFORM.md §10.1 counted 117 756), nearly all of
   * them the strokes of its lettering. Drawn one element each, with their attributes repeated, a
   * test sheet of that size came to 14 MB – far past what a function may return. None of that
   * lettering is ever picked, so it does not need to be an element.
   *
   * Omitted, the picture is drawn as before: one element per shape, each tagged.
   */
  pickable?: ReadonlySet<string>;
}

export interface Rendered {
  svg: string;
  /** What could not be drawn faithfully, said rather than drawn wrongly. */
  notes: string[];
}

interface Placement {
  at: Point;
  base: Point;
  sx: number;
  sy: number;
  rotation: number;
}

const IDENTITY: Placement = { at: { x: 0, y: 0 }, base: { x: 0, y: 0 }, sx: 1, sy: 1, rotation: 0 };

function place(p: Point, t: Placement): Point {
  const x = (p.x - t.base.x) * t.sx, y = (p.y - t.base.y) * t.sy;
  const r = (t.rotation * Math.PI) / 180;
  return { x: t.at.x + x * Math.cos(r) - y * Math.sin(r), y: t.at.y + x * Math.sin(r) + y * Math.cos(r) };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = (v: number) => (Math.round(v * 1000) / 1000).toString();

/** A ring or run as SVG path data, arcs as true arcs. `t` places it; a mirror turns every arc the other way. */
function pathOf(vertices: readonly Vertex[], closed: boolean, t: Placement): string {
  const mirror = t.sx * t.sy < 0 ? -1 : 1;
  const pts = vertices.map((v) => place(v, t));
  let d = `M${n(pts[0]!.x)} ${n(-pts[0]!.y)}`;
  const segments = closed ? vertices.length : vertices.length - 1;
  for (let i = 0; i < segments; i++) {
    const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
    const bulge = vertices[i]!.bulge * mirror;
    if (bulge === 0) {
      // A closed path's last straight edge is drawn by Z.
      if (!(closed && i === segments - 1)) d += `L${n(b.x)} ${n(-b.y)}`;
      continue;
    }
    const theta = 4 * Math.atan(Math.abs(bulge));
    const chord = Math.hypot(b.x - a.x, b.y - a.y);
    const r = chord / (2 * Math.sin(theta / 2));
    d += `A${n(r)} ${n(r)} 0 ${theta > Math.PI ? 1 : 0} ${bulge > 0 ? 0 : 1} ${n(b.x)} ${n(-b.y)}`;
  }
  return closed ? `${d}Z` : d;
}

interface Drawn {
  d: string;
  handle: string | null;
  closed: boolean;
  points: Point[];
}

function draw(e: Entity, t: Placement): Drawn | null {
  switch (e.kind) {
    case "line": {
      const v: Vertex[] = [{ ...e.start, bulge: 0 }, { ...e.end, bulge: 0 }];
      return { d: pathOf(v, false, t), handle: e.handle, closed: false, points: v.map((p) => place(p, t)) };
    }
    case "arc": {
      const [s, end] = arcAsVertices(e);
      const v: Vertex[] = [s, { ...end, bulge: 0 }];
      return { d: pathOf(v, false, t), handle: e.handle, closed: false, points: v.map((p) => place(p, t)) };
    }
    case "circle": {
      const ring = circleRing(e.center, e.radius);
      const c = place(e.center, t), r = e.radius * Math.abs(t.sx);
      return { d: pathOf(ring, true, t), handle: e.handle, closed: true, points: [{ x: c.x - r, y: c.y - r }, { x: c.x + r, y: c.y + r }] };
    }
    case "polyline":
      if (e.vertices.length < 2) return null;
      return { d: pathOf(e.vertices, e.closed, t), handle: e.handle, closed: e.closed, points: e.vertices.map((p) => place(p, t)) };
    default:
      return null;
  }
}

/**
 * Shapes and labels drawn at most. A block of a hundred inserts of a block of a hundred inserts,
 * eight deep, is 10¹⁶ shapes from a file of a few kilobytes – the CAD form of a zip bomb. The
 * picture stops at the budget and says so.
 */
export const MAX_DRAWN = 200_000;

const finite = (p: Point) => Number.isFinite(p.x) && Number.isFinite(p.y);

export function renderSvg(drawing: Drawing, options: RenderOptions = {}): Rendered {
  const highlight = new Set(options.highlight ?? []);
  const noteSet = new Set<string>();
  const notes = { push: (s: string) => noteSet.add(s) };
  const shapes: (Drawn & { picked: boolean; keys: readonly string[] })[] = [];
  const labels: { text: string; at: Point; height: number; picked: boolean; keys: readonly string[] }[] = [];
  let budgetSpent = false;

  /**
   * `chain` is the handles a shape can be picked by: its own, and every insert it was placed
   * through. Written onto each shape as `data-h`, so a page can pick an outline out of a drawing it
   * already holds rather than reading an A0 sheet again – the same rule as `picked`, applied in the
   * browser. A handle with whitespace in it cannot be one token of that list and is left off; DXF
   * handles are hexadecimal and the PDF reader's are `p1:12.0`, so only a hostile file has one.
   */
  const pickable = options.pickable;
  const compact = pickable !== undefined;
  const visit = (entities: readonly Entity[], t: Placement, inheritedPick: boolean, depth: number, chain: readonly string[]) => {
    for (const e of entities) {
      if (shapes.length + labels.length >= MAX_DRAWN) {
        if (!budgetSpent) notes.push(`The drawing expands to more than ${MAX_DRAWN.toLocaleString("en-ZA")} shapes once its blocks are placed; only the first ${MAX_DRAWN.toLocaleString("en-ZA")} are drawn.`);
        budgetSpent = true;
        return;
      }
      const picked = inheritedPick || (e.handle !== null && highlight.has(e.handle));
      const own = e.handle !== null && !/\s/.test(e.handle) && (!pickable || pickable.has(e.handle));
      const keys = own ? [...chain, e.handle!] : chain;
      if (e.kind === "insert") {
        const body = drawing.blocks[e.block];
        if (!body) continue;
        if (depth > 8) {
          notes.push(`Block ${e.block} is nested more than eight deep and was not drawn.`);
          continue;
        }
        if (Math.abs(Math.abs(e.scaleX) - Math.abs(e.scaleY)) > 1e-9) {
          notes.push(`Block ${e.block} is inserted with unequal x and y scales; its arcs are drawn as if the scale were uniform.`);
        }
        const inner: Placement = { at: e.at, base: drawing.blockBase[e.block] ?? { x: 0, y: 0 }, sx: e.scaleX, sy: e.scaleY, rotation: e.rotation };
        if (depth > 0 && (Math.abs(Math.abs(t.sx) - Math.abs(t.sy)) > 1e-9 || t.sx * t.sy < 0)) {
          notes.push(`Block ${e.block} sits inside a mirrored or unequally scaled block; it may be drawn out of place.`);
        }
        visit(body, compose(inner, t), picked, depth + 1, keys);
        continue;
      }
      if (e.kind === "text") {
        const at = place(e.at, t);
        if (finite(at)) labels.push({ text: e.text, at, height: e.height * Math.abs(t.sx), picked, keys });
        continue;
      }
      const drawn = draw(e, t);
      // A shape whose placed coordinates overflowed would write NaN into the path.
      if (drawn && drawn.points.every(finite) && !drawn.d.includes("NaN") && !drawn.d.includes("Infinity")) shapes.push({ ...drawn, picked, keys });
    }
  };
  visit(drawing.entities, IDENTITY, false, 0, []);

  // Extents by a loop: Math.min(...xs) over a few hundred thousand points overflows the stack.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const extend = (p: Point) => {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (-p.y < minY) minY = -p.y;
    if (-p.y > maxY) maxY = -p.y;
  };
  for (const s of shapes) for (const p of s.points) extend(p);
  for (const l of labels) extend(l.at);
  if (minX === Infinity) return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><text x="8" y="24" font-size="10">Nothing drawable</text></svg>`, notes: [...noteSet] };
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const pad = span * 0.03;
  const w = maxX - minX + 2 * pad, h = maxY - minY + 2 * pad;
  const width = options.width ?? 1200;
  const stroke = span / 900;

  // `data-z` marks a closed shape, which a page fills when it picks it; `data-h` is the chain above.
  const tag = (keys: readonly string[], closed = false) => `${keys.length ? ` data-h="${esc(keys.join(" "))}"` : ""}${closed ? ` data-z=""` : ""}`;
  if (compact) {
    /*
      A tenth of an output pixel, in drawing units, as a number of decimal places: an A1 sheet in
      paper millimetres keeps one, a site plan in metres none. Rounded after the fact because the
      extents – and so the size of a pixel – are only known once every shape is placed.
    */
    const digits = Math.max(0, Math.min(6, Math.ceil(-Math.log10(w / width / 10))));
    // And no space before a minus sign, which path data does not need: most y values are negative.
    const round = (d: string) =>
      d
        .replace(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi, (m) => {
          const v = Number(m);
          return Number.isFinite(v) ? String(Number(v.toFixed(digits))) : m;
        })
        .replace(/ -/g, "-");
    // Joined in runs, so no one attribute value grows without bound.
    const merged: string[] = [];
    const plain = shapes.filter((s) => !s.picked && s.keys.length === 0);
    for (let i = 0; i < plain.length; i += 5000) merged.push(`<path d="${plain.slice(i, i + 5000).map((s) => round(s.d)).join("")}"/>`);
    const tagged = shapes.filter((s) => !s.picked && s.keys.length > 0).map((s) => `<path d="${round(s.d)}"${tag(s.keys, s.closed)}/>`);
    const body = [
      `<g fill="none" stroke="#838c99" stroke-width="${n(stroke)}">${merged.join("")}${tagged.join("")}</g>`,
      ...shapes.filter((s) => s.picked).map((s) => `<path d="${round(s.d)}" fill="${s.closed ? "#8dc63f" : "none"}" fill-opacity="0.28" stroke="#4a7722" stroke-width="${n(stroke * 3)}"${tag(s.keys, s.closed)}/>`),
      ...labels.map((l) => `<text x="${n(l.at.x)}" y="${n(-l.at.y)}" font-size="${n(l.height || span / 120)}" font-family="sans-serif" fill="${l.picked ? "#2e4b15" : "#282e37"}"${tag(l.keys)}>${esc(l.text)}</text>`),
    ];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${Math.round((width * h) / w)}" viewBox="${n(minX - pad)} ${n(minY - pad)} ${n(w)} ${n(h)}"><rect x="${n(minX - pad)}" y="${n(minY - pad)}" width="${n(w)}" height="${n(h)}" fill="#ffffff"/>${body.join("")}</svg>`;
    return { svg, notes: [...noteSet] };
  }

  const body = [
    ...shapes.filter((s) => !s.picked).map((s) => `<path d="${s.d}" fill="none" stroke="#838c99" stroke-width="${n(stroke)}"${tag(s.keys, s.closed)}/>`),
    ...shapes.filter((s) => s.picked).map((s) => `<path d="${s.d}" fill="${s.closed ? "#8dc63f" : "none"}" fill-opacity="0.28" stroke="#4a7722" stroke-width="${n(stroke * 3)}"${tag(s.keys, s.closed)}/>`),
    ...labels.map((l) => `<text x="${n(l.at.x)}" y="${n(-l.at.y)}" font-size="${n(l.height || span / 120)}" font-family="sans-serif" fill="${l.picked ? "#2e4b15" : "#282e37"}"${tag(l.keys)}>${esc(l.text)}</text>`),
  ];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${Math.round((width * h) / w)}" viewBox="${n(minX - pad)} ${n(minY - pad)} ${n(w)} ${n(h)}"><rect x="${n(minX - pad)}" y="${n(minY - pad)}" width="${n(w)}" height="${n(h)}" fill="#ffffff"/>${body.join("")}</svg>`;
  return { svg, notes: [...noteSet] };
}

/**
 * An insert placed inside another block. place(place(p, inner), outer) collapses to one placement
 * exactly when the outer scale is uniform and unmirrored – rotation and uniform scale commute. That
 * covers how blocks are nested in practice; the other case is reported by the caller, not hidden.
 */
function compose(inner: Placement, outer: Placement): Placement {
  const at = place(inner.at, outer);
  return { at, base: inner.base, sx: inner.sx * outer.sx, sy: inner.sy * outer.sy, rotation: inner.rotation + outer.rotation };
}
