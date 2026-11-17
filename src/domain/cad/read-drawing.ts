/**
 * What a drawing measures – the concept-layout reader. PLATFORM.md §10.4, §10.5, §1.3.
 *
 * ── The division of labour ─────────────────────────────────────────────────────────────────
 *
 * This module **decides** every figure: areas, perimeters, lengths, counts, and whether a figure
 * the drawing prints agrees with the geometry around it. Nothing here asks a model anything. A
 * model's later job – "layer A-UNITS holds the units", "loop L4 is the courtyard" – is labelling,
 * and every label it proposes is checked against what this module measured, the same way
 * `drawing-takeoff.ts` checks a quote against the text it was given.
 *
 * ── Units are read, never assumed ──────────────────────────────────────────────────────────
 *
 * `$INSUNITS` says what one drawing unit is. Where the header is silent, areas are **null** and
 * the report says why – an architect's DXF in metres read as millimetres is a factor of a million,
 * and "units not stated" is a fact a QS can fix in one word, where a wrong default is a figure
 * nobody questions. A caller may state the units; the report then says the caller did.
 *
 * ── Every figure cites what it came from ───────────────────────────────────────────────────
 *
 * Each loop carries the handles of the entities it is made of. A handle is the entity's permanent
 * id in the file, so "54,0000 m² from LWPOLYLINE 2A1 on A-UNITS" can be opened and checked in any
 * CAD package – the geometric equivalent of a quoted passage.
 */

import type { Drawing, Entity, EntityKind, Point } from "./dxf";
import { networkFaces } from "./faces";
import { findLoops, flatten, lengthOf, loopArea, pointInPolygon, ringLength, type Junction, type Loop, type OpenChain } from "./geometry";
import { readFigure } from "@/domain/drawing-takeoff";

/** `$INSUNITS` codes this reader converts, as metres per drawing unit. The DXF reference lists more; they are refused, not guessed. */
const INSUNITS: Record<number, { name: string; metres: number }> = {
  1: { name: "inches", metres: 0.0254 },
  2: { name: "feet", metres: 0.3048 },
  4: { name: "millimetres", metres: 0.001 },
  5: { name: "centimetres", metres: 0.01 },
  6: { name: "metres", metres: 1 },
  14: { name: "decimetres", metres: 0.1 },
};

export type StatedUnits = "mm" | "cm" | "m";
const STATED: Record<StatedUnits, number> = { mm: 4, cm: 5, m: 6 };

/** §10.4: a calibration tolerance of 0,5%, "not 5%". The same bar for a printed area. */
export const AREA_TOLERANCE = 0.005;

/** Outlines per space beyond which nesting is not worked out – it compares every pair. */
export const MAX_NESTING = 4000;

/** Label × outline comparisons beyond which printed areas are not checked. */
export const MAX_LABEL_TESTS = 20_000_000;

export interface Units {
  /** The `$INSUNITS` code used, or null where none could be. */
  code: number | null;
  name: string;
  metresPerUnit: number | null;
  /** Who said so: the drawing's header, the caller, or nobody. */
  statedBy: "drawing" | "caller" | null;
}

export interface MeasuredLoop {
  id: string;
  layer: string;
  /** The block definition this loop sits in, or null for model space. */
  block: string | null;
  source: Loop["source"] | "region";
  handles: string[];
  /** m², rounded to four places at this boundary only. Null where the units are not known. */
  area: number | null;
  perimeter: number | null;
  /** Area less the loops directly inside it on the same layer – a courtyard comes off its building. */
  net: number | null;
  /** The loop on the same layer this one sits inside, if any. */
  inside: string | null;
  holes: string[];
}

export interface LayerSummary {
  name: string;
  counts: Partial<Record<EntityKind, number>>;
  /** Total linework length in m – lines, arcs, circles, polylines. Null where units are not known. */
  length: number | null;
  loops: number;
}

export interface BlockCount {
  name: string;
  inserts: number;
  layers: string[];
  handles: string[];
  /** Area of the block's outermost loop, in m², before insert scaling. Null if it has none, or units are unknown. */
  footprint: number | null;
  /** Footprint × |scaleX·scaleY| summed over every insert. */
  totalFootprint: number | null;
}

export interface AreaCheck {
  textHandle: string | null;
  block: string | null;
  text: string;
  stated: number | null;
  loop: string | null;
  computed: number | null;
  /** computed − stated, m². */
  difference: number | null;
  agrees: boolean | null;
  reason: string;
}

export interface TextItem {
  handle: string | null;
  layer: string;
  block: string | null;
  text: string;
  at: Point;
}

export interface DrawingReport {
  version: string | null;
  units: Units;
  layers: LayerSummary[];
  loops: MeasuredLoop[];
  blocks: BlockCount[];
  texts: TextItem[];
  areaChecks: AreaCheck[];
  open: (OpenChain & { block: string | null; gapMetres: number | null })[];
  junctions: (Junction & { block: string | null })[];
  skipped: Record<string, number>;
  notes: string[];
}

const round4 = (n: number) => Math.sign(n) * Math.round(Math.abs(n) * 1e4) / 1e4;

function unitsOf(drawing: Drawing, stated?: StatedUnits): Units {
  if (stated) {
    const code = STATED[stated];
    return { code, name: INSUNITS[code]!.name, metresPerUnit: INSUNITS[code]!.metres, statedBy: "caller" };
  }
  const known = drawing.insunits === null ? undefined : INSUNITS[drawing.insunits];
  if (known) return { code: drawing.insunits, name: known.name, metresPerUnit: known.metres, statedBy: "drawing" };
  return { code: drawing.insunits, name: drawing.insunits === null || drawing.insunits === 0 ? "not stated" : `unsupported ($INSUNITS ${drawing.insunits})`, metresPerUnit: null, statedBy: null };
}

/** An area label is a few words. Longer text is read only this far, so a hostile run of digits cannot make the pattern below backtrack for minutes. */
const LABEL_CHARS = 200;

/**
 * An area printed in words: "12,5 m²", "BEDROOM 1 234,5m2", "85 sqm", "ERF 101 G.R.4 1.89 Ha".
 * Exactly one, or none. `value` is always m²; `perUnit` is what one printed unit is in m², so the
 * rounding allowance can be worked in the unit the figure was printed in.
 *
 * A space groups thousands only before exactly three digits. Without that, "G.R.4 1.89 Ha" – an
 * erf's zoning then its area, as site plans print them – reads as "4 1.89", which is 41,89 ha.
 */
export function statedArea(text: string): { value: number | null; printed: string; perUnit: number } | null {
  const found = [...text.slice(0, LABEL_CHARS).matchAll(/(?<![\d.,])(\d{1,3}(?:[ \u00a0]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)\s*(m²|m2|m\^2|sq\.?\s?m|ha|hectares?)(?![a-z0-9²])/gi)];
  if (found.length !== 1) return null;
  const printed = found[0]![1]!.trim();
  const perUnit = /^h/i.test(found[0]![2]!) ? 10_000 : 1;
  const figure = readFigure(printed);
  return { value: figure === null ? null : round4(figure * perUnit), printed, perUnit };
}

/** Decimal places as printed – "12,0" is 1 – so a figure rounded for print is not called wrong. */
const placesIn = (printed: string) => {
  const m = /[.,](\d+)$/.exec(printed.replace(/[\s ]/g, ""));
  return m ? m[1]!.length : 0;
};

interface Space {
  block: string | null;
  entities: readonly Entity[];
}

export interface ReadOptions {
  units?: StatedUnits;
  /** Layers whose linework is a boundary network – erven on a site plan – to trace regions from. */
  regions?: { layers: string[]; /** Snap distance in metres for the network – drafting gaps up to this are closed, and the report says so. */ snapMetres?: number };
}

export function readDrawing(drawing: Drawing, options: ReadOptions = {}): DrawingReport {
  const units = unitsOf(drawing, options.units);
  const f = units.metresPerUnit;
  const notes = [...drawing.notes];
  if (f === null) notes.push(`Drawing units are ${units.name}, so no area or length is given. State the units (mm, cm or m) to measure it.`);

  // Snap loose ends within 1 mm. With units unknown there is no millimetre to snap to, so a
  // thousandth of a drawing unit – tight enough not to join what was drawn apart.
  const tolerance = f === null ? 1e-3 : 0.001 / f;

  const spaces: Space[] = [{ block: null, entities: drawing.entities }, ...Object.entries(drawing.blocks).map(([block, entities]) => ({ block, entities }))];

  const loops: MeasuredLoop[] = [];
  const rings = new Map<string, { areaDu: number; poly: Point[] }>();
  const open: DrawingReport["open"] = [];
  const junctions: DrawingReport["junctions"] = [];

  for (const space of spaces) {
    const found = findLoops(space.entities, tolerance);
    const measured = found.loops.map((loop) => ({ loop, areaDu: loopArea(loop), poly: flatten(loop.ring) }));
    const ids = measured.map((_, i) => `L${loops.length + i + 1}`);

    // Nesting: the smallest larger loop on the same layer that contains this one's first vertex.
    // Every loop against every other is quadratic, so past a budget it is not attempted – said,
    // not silently skipped – rather than letting one drawing hang the reader.
    const nestable = measured.length <= MAX_NESTING;
    if (!nestable) notes.push(`${measured.length} outlines in ${space.block ? `block ${space.block}` : "model space"} – too many to work out which sit inside which, so net areas equal gross areas.`);
    const parentOf = measured.map((m, i) => {
      if (!nestable) return -1;
      let best = -1;
      measured.forEach((other, j) => {
        if (j === i || other.loop.layer !== m.loop.layer || other.areaDu <= m.areaDu) return;
        if (!pointInPolygon(m.loop.ring[0]!, other.poly)) return;
        if (best < 0 || other.areaDu < measured[best]!.areaDu) best = j;
      });
      return best;
    });

    measured.forEach((m, i) => {
      const holes = measured.flatMap((_, j) => (parentOf[j] === i ? [j] : []));
      const netDu = m.areaDu - holes.reduce((s, j) => s + measured[j]!.areaDu, 0);
      loops.push({
        id: ids[i]!,
        layer: m.loop.layer,
        block: space.block,
        source: m.loop.source,
        handles: m.loop.handles,
        area: f === null ? null : round4(m.areaDu * f * f),
        perimeter: f === null ? null : round4(ringLength(m.loop.ring, true) * f),
        net: f === null ? null : round4(netDu * f * f),
        inside: parentOf[i]! >= 0 ? ids[parentOf[i]!]! : null,
        holes: holes.map((j) => ids[j]!),
      });
      rings.set(ids[i]!, m);
    });

    open.push(...found.open.map((o) => ({ ...o, block: space.block, gapMetres: f === null ? null : round4(o.gap * f) })));
    junctions.push(...found.junctions.map((j) => ({ ...j, block: space.block })));
  }

  // Regions of a boundary network – erven on a site plan, whose boundaries are shared lines
  // rather than one closed outline each. Which layers form that network is a labelling decision
  // (a person's, or the model's, checked), so it is asked for, never guessed here.
  const regionLayers = options.regions?.layers ?? [];
  for (const layer of regionLayers) {
    const result = networkFaces(
      drawing.entities.filter((e) => e.layer === layer),
      layer,
      // Plotted networks meet less exactly than CAD linework: snap at 10 mm of real size.
      { tolerance: f === null ? 1e-2 : (options.regions?.snapMetres ?? 0.01) / f },
    );
    if (result.truncated) notes.push(result.truncated);
    if (result.faces.length === 0 && !result.truncated) notes.push(`No enclosed regions on ${layer}.`);
    result.faces.forEach((face) => {
      const id = `R${loops.filter((l) => l.source === "region").length + 1}`;
      const area = f === null ? null : round4(face.area * f * f);
      loops.push({ id, layer, block: null, source: "region", handles: face.handles, area, perimeter: f === null ? null : round4(ringLength(face.ring, true) * f), net: area, inside: null, holes: [] });
      rings.set(id, { areaDu: face.area, poly: face.ring });
    });
  }

  // Layers – model space only; a block's contents are counted where it is inserted.
  const layers: LayerSummary[] = drawing.layers.map((name) => {
    const on = drawing.entities.filter((e) => e.layer === name);
    const counts: Partial<Record<EntityKind, number>> = {};
    for (const e of on) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
    const lengthDu = on.reduce((s, e) => s + lengthOf(e), 0);
    return { name, counts, length: f === null ? null : round4(lengthDu * f), loops: loops.filter((l) => l.block === null && l.layer === name).length };
  });

  // Blocks – a unit drawn once and inserted forty times is forty units.
  const inserts = drawing.entities.filter((e): e is Extract<Entity, { kind: "insert" }> => e.kind === "insert");
  const blocks: BlockCount[] = [...new Set(inserts.map((i) => i.block))].sort().map((name) => {
    const of = inserts.filter((i) => i.block === name);
    const outer = loops.filter((l) => l.block === name && l.inside === null).sort((a, b) => (b.area ?? 0) - (a.area ?? 0))[0];
    const footprint = outer?.area ?? null;
    return {
      name,
      inserts: of.length,
      layers: [...new Set(of.map((i) => i.layer))].sort(),
      handles: of.map((i, k) => i.handle ?? `#${k}`),
      footprint,
      totalFootprint: footprint === null ? null : round4(of.reduce((s, i) => s + footprint * Math.abs(i.scaleX * i.scaleY), 0)),
    };
  });
  const missing = blocks.filter((b) => !(b.name in drawing.blocks)).map((b) => b.name);
  if (missing.length) notes.push(`Inserted but not defined in the file: ${missing.join(", ")}. Counted, not measured.`);

  // Text, and the cross-check §10.5 asks for: a printed area against the loop it sits in.
  const texts: TextItem[] = [];
  const areaChecks: AreaCheck[] = [];
  const labelCount = spaces.reduce((s, sp) => s + sp.entities.filter((e) => e.kind === "text").length, 0);
  const checkable = labelCount * loops.length <= MAX_LABEL_TESTS;
  if (!checkable) notes.push(`${labelCount} labels against ${loops.length} outlines is too many comparisons, so printed areas were not checked.`);
  for (const space of spaces) {
    for (const e of space.entities) {
      if (e.kind !== "text") continue;
      texts.push({ handle: e.handle, layer: e.layer, block: space.block, text: e.text, at: e.at });
      const stated = checkable ? statedArea(e.text) : null;
      if (!stated) continue;
      const base = { textHandle: e.handle, block: space.block, text: e.text, stated: stated.value };
      if (stated.value === null) {
        areaChecks.push({ ...base, loop: null, computed: null, difference: null, agrees: null, reason: `"${stated.printed}" could be a thousands separator or a decimal, so it is not compared.` });
        continue;
      }
      // With a boundary network named, a printed area is checked against its regions only: a label
      // sitting inside a building or a hatch inside the erf must not be compared with that instead.
      const around = loops
        .filter((l) => l.block === space.block && (regionLayers.length === 0 || l.source === "region") && pointInPolygon(e.at, rings.get(l.id)!.poly))
        .sort((a, b) => rings.get(a.id)!.areaDu - rings.get(b.id)!.areaDu)[0];
      if (!around) {
        areaChecks.push({ ...base, loop: null, computed: null, difference: null, agrees: null, reason: "The label is not inside any closed outline." });
        continue;
      }
      if (around.net === null) {
        areaChecks.push({ ...base, loop: around.id, computed: null, difference: null, agrees: null, reason: "Units are not stated, so there is no area to compare." });
        continue;
      }
      const difference = round4(around.net - stated.value);
      // Within 0,5%, or within the rounding of the figure as printed: "12,0" covers 11,95 to 12,05.
      // "1.89 Ha" covers 1,885 to 1,895 ha – 50 m² either way – so rounding is worked in the printed unit.
      const allowance = Math.max(AREA_TOLERANCE * stated.value, 0.5 * 10 ** -placesIn(stated.printed) * stated.perUnit);
      const agrees = Math.abs(difference) <= allowance + 1e-9;
      areaChecks.push({
        ...base,
        loop: around.id,
        computed: around.net,
        difference,
        agrees,
        reason: agrees ? `Agrees with ${around.id} within ${round4(allowance)} m².` : `${around.id} measures ${around.net} m², ${difference > 0 ? "more" : "less"} than printed by ${Math.abs(difference)} m².`,
      });
    }
  }

  return {
    version: drawing.version,
    units,
    layers,
    loops,
    blocks,
    texts,
    areaChecks,
    open,
    junctions,
    skipped: drawing.skipped,
    notes,
  };
}
