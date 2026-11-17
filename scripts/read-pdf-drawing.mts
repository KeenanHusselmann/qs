/**
 * Measure a plotted PDF drawing from the terminal – the PDF front end of the CAD reader.
 *
 *     npx tsx scripts/read-pdf-drawing.mts <drawing.pdf> [--page 1] [--scale 1250] [--svg out.svg] [--json out.json]
 *
 * Prints what the sheet measures: the scale and where it came from, the pens (layers) the
 * outlines were drawn with, and every printed area checked against the outline it sits in.
 * Reads only; writes only the files named with --svg and --json.
 */

import { readFileSync, writeFileSync } from "node:fs";

import { renderSvg } from "../src/domain/cad/render";
import { readPdfDrawing } from "../src/lib/cad/read-pdf";

const arg = (name: string) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const file = process.argv[2];
if (!file || file.startsWith("--")) {
  console.error("Which drawing? npx tsx scripts/read-pdf-drawing.mts <drawing.pdf> [--page n] [--scale n] [--svg out.svg] [--json out.json]");
  process.exit(1);
}

const started = performance.now();
// --regions "stroke #000000 0.84pt": the pen(s) whose lines are the erf boundaries, comma-separated.
const regionLayers = arg("regions")?.split(",").map((s) => s.trim()).filter(Boolean);
const read = await readPdfDrawing(new Uint8Array(readFileSync(file)), {
  page: arg("page") ? Number(arg("page")) : undefined,
  scale: arg("scale") ? Number(arg("scale")) : undefined,
  regionLayers,
  snapMetres: arg("snap") ? Number(arg("snap")) : undefined,
});
const { report, stats } = read;

console.log(`\n${file}`);
console.log(`  page ${read.page} of ${read.pages}, ${read.sheet.width} × ${read.sheet.height} mm sheet, read in ${Math.round(performance.now() - started)} ms`);
console.log(`  scale: ${read.scale.value ? `1:${read.scale.value}` : "unknown"} – ${read.scale.reason}`);
console.log(`  paths ${stats.paths} · subpaths ${stats.subpaths} · closed ${stats.closed} · curved ${stats.curved} · unpainted ${stats.unpainted} · specks ${stats.specks}`);
console.log(`  closed outlines measured: ${report.loops.length} · open chains ${report.open.length} · junctions ${report.junctions.length} · labels ${report.texts.length}`);

const byLayer = new Map<string, number>();
for (const l of report.loops) byLayer.set(l.layer, (byLayer.get(l.layer) ?? 0) + 1);
console.log("  outlines by pen (the PDF's stand-in for CAD layers):");
for (const [layer, n] of [...byLayer].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`    ${String(n).padStart(6)}  ${layer}`);

const agree = report.areaChecks.filter((c) => c.agrees === true);
const disagree = report.areaChecks.filter((c) => c.agrees === false);
const unchecked = report.areaChecks.filter((c) => c.agrees === null);
console.log(`\n  printed areas: ${report.areaChecks.length} · agree ${agree.length} · disagree ${disagree.length} · not checked ${unchecked.length}`);
const show = (c: (typeof report.areaChecks)[number]) => {
  const loop = report.loops.find((l) => l.id === c.loop);
  console.log(`    ${c.agrees === true ? "AGREES   " : c.agrees === false ? "DISAGREES" : "–        "} ${JSON.stringify(c.text).padEnd(22)} printed ${String(c.stated ?? "?").padStart(9)} m²  measured ${String(c.computed ?? "–").padStart(11)}  ${loop ? `${loop.id} on ${loop.layer}` : ""}  ${c.agrees === null ? c.reason : ""}`);
};
for (const c of [...agree, ...disagree, ...unchecked].slice(0, 60)) show(c);
if (report.notes.length) console.log(`\n  notes:\n${report.notes.map((n) => `    - ${n}`).join("\n")}`);

const svgOut = arg("svg");
if (svgOut) {
  const highlight = agree.flatMap((c) => report.loops.find((l) => l.id === c.loop)?.handles ?? []);
  writeFileSync(svgOut, renderSvg(read.drawing, { highlight, width: 2400 }).svg);
  console.log(`\n  drawing with agreeing outlines picked out: ${svgOut}`);
}
const jsonOut = arg("json");
if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({ sheet: read.sheet, scale: read.scale, stats, report }, null, 1));
  console.log(`  full report: ${jsonOut}`);
}
