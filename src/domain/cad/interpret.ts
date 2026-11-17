/**
 * What a concept layout says, once someone has said what its parts are – D1.1, PLATFORM.md §1.3.
 *
 * ── The division of labour, again ──────────────────────────────────────────────────────────
 *
 * `read-drawing.ts` measures every outline but cannot know that L1 is the site and UNIT-A is a
 * two-bedroom unit; layer names and labels say so, and reading those is what a model is for. So
 * the model **labels**: it gives each loop and block a role from a fixed list, quotes the drawing's
 * own words for a unit's name, and gives a reason. It states no figure.
 *
 * This module **decides**. A label naming a loop, block or layer that was not measured is refused.
 * A unit name whose quote is not on the drawing is refused. Two loops both labelled "site" is a
 * conflict, reported, not resolved. Any digit in a reason is removed – the same rule the advisor
 * keeps (`HAS_FIGURE` in `agent/advisor.ts`): a figure may reach a person only attached to where
 * it was measured. Every number in the schedule below is computed here from the measured report.
 *
 * Everything in the schedule is a **proposal**. A QS confirms the roles; only then is it a figure.
 */

import type { DrawingReport } from "./read-drawing";

export const LOOP_ROLES = ["site", "building_footprint", "courtyard", "amenity", "room", "unit", "other"] as const;
export type LoopRole = (typeof LOOP_ROLES)[number];

export const BLOCK_ROLES = ["unit_type", "symbol", "other"] as const;
export type BlockRole = (typeof BLOCK_ROLES)[number];

export interface LoopLabel {
  loop: string;
  role: LoopRole;
  reason: string;
}

export interface BlockLabel {
  block: string;
  role: BlockRole;
  /** The unit's name as printed on the drawing – "UNIT A". Null where the drawing names none. */
  name: string | null;
  reason: string;
}

export interface Interpretation {
  loops: LoopLabel[];
  blocks: BlockLabel[];
  /** Labels refused, each with why – counted and said, never dropped silently. */
  refused: { label: string; reason: string }[];
  /** Places the labels contradict each other. */
  conflicts: string[];
}

export interface ScheduleLine {
  label: string;
  /** m², or a ratio for coverage. Null where it cannot be computed – never nought. */
  value: number | null;
  unit: "m²" | "ratio" | "no";
  /** How it was worked, in words a QS can check: which loops, which inserts. */
  working: string;
  /** The entity handles it rests on. */
  handles: string[];
}

export interface ConceptSchedule {
  lines: ScheduleLine[];
  unitMix: { block: string; name: string | null; count: number; each: number | null; total: number | null; handles: string[] }[];
  /** Cross-checks between figures the drawing gives two ways. */
  checks: { label: string; agrees: boolean | null; detail: string }[];
}

/**
 * No figure in a model's words – the reason a label exists, never a number. A figure goes with
 * its unit ("2 400 m²" leaves nothing, not "m²"), and an id whose digits follow letters – L3,
 * UNIT-A1 – is a name, not a figure, so it stays: stripping it turned "outline L3 as" into "Las".
 */
export const withoutFigures = (s: string) =>
  s
    .replace(/(?<![\p{L}\d-])\d+(?:[  ]\d{3})*(?:[.,]\d+)?(?:\s?(?:m²|m2|m³|m3|sqm|mm|cm|m|km|ha|%))?(?![\p{L}\d])/gu, "")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .replace(/\(\s+/g, "(")
    .replace(/\s{2,}/g, " ")
    .trim();

const round4 = (n: number) => Math.sign(n) * Math.round(Math.abs(n) * 1e4) / 1e4;

/** Check a model's labelling against what was measured. `reply` is untrusted JSON. */
export function checkLabels(reply: unknown, report: DrawingReport): Interpretation {
  const refused: Interpretation["refused"] = [];
  const conflicts: string[] = [];
  const body = (reply && typeof reply === "object" ? reply : {}) as { loops?: unknown; blocks?: unknown };
  const texts = report.texts.map((t) => t.text.replace(/\s+/g, " "));

  const loops: LoopLabel[] = [];
  for (const raw of Array.isArray(body.loops) ? body.loops : []) {
    const r = raw as Partial<Record<keyof LoopLabel, unknown>>;
    const id = String(r.loop ?? "");
    if (!report.loops.some((l) => l.id === id)) {
      refused.push({ label: `loop ${id || "(none)"}`, reason: "No outline with that id was measured." });
      continue;
    }
    if (!(LOOP_ROLES as readonly string[]).includes(String(r.role))) {
      refused.push({ label: `loop ${id}`, reason: `"${String(r.role)}" is not one of the roles a loop may have.` });
      continue;
    }
    if (loops.some((l) => l.loop === id)) {
      conflicts.push(`${id} was labelled twice; the first label is kept.`);
      continue;
    }
    loops.push({ loop: id, role: r.role as LoopRole, reason: withoutFigures(String(r.reason ?? "")) });
  }

  const blocks: BlockLabel[] = [];
  for (const raw of Array.isArray(body.blocks) ? body.blocks : []) {
    const r = raw as Partial<Record<keyof BlockLabel, unknown>>;
    const name = String(r.block ?? "");
    if (!report.blocks.some((b) => b.name === name)) {
      refused.push({ label: `block ${name || "(none)"}`, reason: "No block with that name is inserted in the drawing." });
      continue;
    }
    if (!(BLOCK_ROLES as readonly string[]).includes(String(r.role))) {
      refused.push({ label: `block ${name}`, reason: `"${String(r.role)}" is not one of the roles a block may have.` });
      continue;
    }
    let unitName = typeof r.name === "string" && r.name.trim() !== "" ? r.name.replace(/\s+/g, " ").trim() : null;
    if (unitName !== null && !texts.some((t) => t.includes(unitName!))) {
      refused.push({ label: `name "${unitName}" for ${name}`, reason: "Those words are not on the drawing, so the name is not used." });
      unitName = null;
    }
    blocks.push({ block: name, role: r.role as BlockRole, name: unitName, reason: withoutFigures(String(r.reason ?? "")) });
  }

  const sites = loops.filter((l) => l.role === "site");
  if (sites.length > 1) conflicts.push(`${sites.map((s) => s.loop).join(" and ")} are all labelled the site; the site area is not given until one is chosen.`);

  return { loops, blocks, refused, conflicts };
}

/** The figures a feasibility estimate needs from a concept layout, computed from confirmed-or-proposed roles. */
export function conceptSchedule(report: DrawingReport, labels: Interpretation): ConceptSchedule {
  const loop = (id: string) => report.loops.find((l) => l.id === id)!;
  const withRole = (role: LoopRole) => labels.loops.filter((l) => l.role === role).map((l) => loop(l.loop));

  const sites = withRole("site");
  const site = sites.length === 1 ? sites[0]! : null;
  const footprints = withRole("building_footprint");
  const footprintArea = footprints.length && footprints.every((f) => f.net !== null) ? round4(footprints.reduce((s, f) => s + f.net!, 0)) : null;

  const lines: ScheduleLine[] = [
    {
      label: "Site area",
      value: site?.area ?? null,
      unit: "m²",
      working: site ? `${site.id} on ${site.layer}` : sites.length > 1 ? "More than one outline is labelled the site." : "No outline is labelled the site.",
      handles: site?.handles ?? [],
    },
    {
      label: "Building footprint",
      value: footprintArea,
      unit: "m²",
      working: footprints.length ? footprints.map((f) => `${f.id} (${f.net} m² net)`).join(" + ") : "No outline is labelled a building footprint.",
      handles: footprints.flatMap((f) => f.handles),
    },
    {
      label: "Site coverage",
      value: site?.area && footprintArea !== null ? round4(footprintArea / site.area) : null,
      unit: "ratio",
      working: "Building footprint ÷ site area.",
      handles: [],
    },
  ];
  for (const amenity of withRole("amenity")) {
    lines.push({ label: `Amenity – ${amenity.layer}`, value: amenity.net, unit: "m²", working: `${amenity.id} net of ${amenity.holes.length ? amenity.holes.join(", ") : "nothing"}`, handles: amenity.handles });
  }

  const unitMix = labels.blocks
    .filter((b) => b.role === "unit_type")
    .map((b) => {
      const counted = report.blocks.find((x) => x.name === b.block)!;
      return { block: b.block, name: b.name, count: counted.inserts, each: counted.footprint, total: counted.totalFootprint, handles: counted.handles };
    });
  const unitCount = unitMix.reduce((s, u) => s + u.count, 0);
  lines.push({ label: "Units", value: unitMix.length ? unitCount : null, unit: "no", working: unitMix.map((u) => `${u.name ?? u.block} × ${u.count}`).join(" + ") || "No block is labelled a unit type.", handles: unitMix.flatMap((u) => u.handles) });

  const checks: ConceptSchedule["checks"] = [];
  const unitsArea = unitMix.length && unitMix.every((u) => u.total !== null) ? round4(unitMix.reduce((s, u) => s + u.total!, 0)) : null;
  if (unitsArea !== null && footprintArea !== null) {
    const diff = round4(unitsArea - footprintArea);
    checks.push({
      label: "Units against footprint",
      agrees: Math.abs(diff) <= 0.005 * footprintArea,
      detail: `Unit footprints sum to ${unitsArea} m² against a building footprint of ${footprintArea} m²${diff === 0 ? "." : `, ${Math.abs(diff)} m² ${diff > 0 ? "over" : "under"}.`}`,
    });
  }
  const disagreeing = report.areaChecks.filter((c) => c.agrees === false);
  checks.push({
    label: "Printed areas",
    agrees: report.areaChecks.length ? disagreeing.length === 0 : null,
    detail: report.areaChecks.length ? `${report.areaChecks.length - disagreeing.length} of ${report.areaChecks.length} printed areas agree with the geometry.` : "The drawing prints no areas to check against.",
  });

  return { lines, unitMix, checks };
}
