/**
 * The drawing reader, in a browser – a local side tool, not a route in the app.
 *
 *     npx tsx scripts/cad-viewer.mts            → http://localhost:4317
 *
 * ── Why a side tool ────────────────────────────────────────────────────────────────────────
 *
 * This is a spike. A route in the app would be a serverless function (README: the function count
 * is a constraint that has bitten twice), a page in the nav, and a promise that the feature
 * exists. This is none of those: one Node process on a laptop, the same `domain/cad` code the app
 * would use, and nothing written anywhere. Open a DXF – or the sample – and see what it measures.
 *
 * ── DeepSeek ───────────────────────────────────────────────────────────────────────────────
 *
 * "Interpret" sends the measured digest to DeepSeek through the platform's own client, with the
 * key from `.env.local`. It costs a fraction of a cent and only runs when the button is pressed.
 * The drawing itself is not sent – only what was measured from it (see `lib/cad/interpret-drawing`).
 */

import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { parseEnv } from "node:util";

import { DxfUnreadable, parseDxf, type Drawing } from "../src/domain/cad/dxf";
import { readDrawing, type DrawingReport, type StatedUnits } from "../src/domain/cad/read-drawing";
import { readPdfDrawing } from "../src/lib/cad/read-pdf";
import { renderSvg } from "../src/domain/cad/render";
import { ModelUnavailable } from "../src/lib/agent/deepseek";
import { interpretDrawing } from "../src/lib/cad/interpret-drawing";
import { guardRequest, securityHeaders } from "../src/lib/cad/local-guard";

/**
 * The DeepSeek key, and only the key. `.env.local` also holds the database URL and the Blob
 * store's token; a side tool that loaded the whole file would carry credentials it never uses,
 * into a process that parses files from strangers.
 */
if (!process.env.DEEPSEEK_API_KEY) {
  try {
    const key = parseEnv(readFileSync(".env.local", "utf8")).DEEPSEEK_API_KEY;
    if (key) process.env.DEEPSEEK_API_KEY = key;
  } catch {
    // No .env.local: the reader works; only Interpret will say the model is not switched on.
  }
}

/** 0 asks the system for a free port – the live check does, so it never collides with a leftover run. */
const PORT = Number(process.env.CAD_VIEWER_PORT ?? 4317);
let port = PORT;
/** Loopback only. Never 0.0.0.0: the key behind Interpret would be anyone's on the same network. */
const HOST = "127.0.0.1";
const MAX_BYTES = 64 * 1024 * 1024;
const SAMPLE = "fixtures/cad/concept-layout.dxf";

async function body(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BYTES) throw new DxfUnreadable("The drawing is over the 64 MB limit.");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

interface Measured {
  kind: "dxf" | "pdf";
  drawing: Drawing;
  report: DrawingReport;
  scale: { value: number | null; reason: string } | null;
}

/**
 * The last drawing read, kept so clicking a row does not re-read an A0 PDF (five seconds each
 * time). One entry, keyed by the file's hash and the options it was read with: a different file or
 * a different pen choice is a different reading.
 */
let cached: { key: string; measured: Measured } | null = null;

function optionsFrom(url: URL) {
  const regions = (url.searchParams.get("regions") ?? "").split("|").map((s) => s.trim()).filter((s) => s && s.length <= 200).slice(0, 10);
  const snap = Number(url.searchParams.get("snap"));
  const scale = Number(url.searchParams.get("scale"));
  return {
    units: unitsFrom(url),
    regions,
    snap: snap > 0 && snap <= 20 ? snap : undefined,
    scale: Number.isInteger(scale) && scale >= 1 && scale <= 100_000 ? scale : undefined,
  };
}

async function measure(req: IncomingMessage, url: URL): Promise<Measured> {
  const bytes = await body(req);
  const options = optionsFrom(url);
  const key = createHash("sha256").update(bytes).update(JSON.stringify(options)).digest("hex");
  if (cached?.key === key) return cached.measured;
  let measured: Measured;
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") {
    const read = await readPdfDrawing(new Uint8Array(bytes), { scale: options.scale, regionLayers: options.regions, snapMetres: options.snap });
    measured = { kind: "pdf", drawing: read.drawing, report: read.report, scale: { value: read.scale.value, reason: read.scale.reason } };
  } else {
    const drawing = parseDxf(bytes.toString("utf8"));
    const report = readDrawing(drawing, { units: options.units, ...(options.regions.length ? { regions: { layers: options.regions, snapMetres: options.snap } } : {}) });
    measured = { kind: "dxf", drawing, report, scale: null };
  }
  cached = { key, measured };
  return measured;
}

const send = (res: ServerResponse, status: number, type: string, payload: string, extra: Record<string, string> = {}) => {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra });
  res.end(payload);
};
const json = (res: ServerResponse, status: number, value: unknown) => send(res, status, "application/json; charset=utf-8", JSON.stringify(value));

const unitsFrom = (url: URL): StatedUnits | undefined => {
  const u = url.searchParams.get("units");
  return u === "mm" || u === "cm" || u === "m" ? u : undefined;
};

const server = createServer(async (req, res) => {
  const verdict = guardRequest({ method: req.method ?? "GET", host: req.headers.host, origin: req.headers.origin }, port);
  if (!verdict.allowed) {
    console.error(`refused ${req.method} ${req.url} – host ${req.headers.host ?? "none"}, origin ${req.headers.origin ?? "none"}`);
    return json(res, 403, { error: verdict.reason });
  }
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  try {
    if (req.method === "GET" && url.pathname === "/") {
      const nonce = randomBytes(16).toString("base64");
      return send(res, 200, "text/html; charset=utf-8", PAGE.replace("__NONCE__", nonce), securityHeaders(nonce));
    }
    if (req.method === "GET" && url.pathname === "/api/sample") return json(res, 200, { name: "concept-layout.dxf", dxf: readFileSync(SAMPLE, "utf8") });

    if (req.method === "POST" && url.pathname === "/api/read") {
      const { kind, drawing, report, scale } = await measure(req, url);
      return json(res, 200, { kind, scale, report, render: renderSvg(drawing, { width: 1400 }) });
    }
    if (req.method === "POST" && url.pathname === "/api/render") {
      const { drawing } = await measure(req, url);
      const highlight = (url.searchParams.get("highlight") ?? "").split(",").filter(Boolean).slice(0, 5000);
      return json(res, 200, renderSvg(drawing, { highlight, width: 1400 }));
    }
    if (req.method === "POST" && url.pathname === "/api/interpret") {
      const { report } = await measure(req, url);
      return json(res, 200, await interpretDrawing(report));
    }
    return json(res, 404, { error: "Not found" });
  } catch (e) {
    if (e instanceof DxfUnreadable) return json(res, 422, { error: e.message });
    if (e instanceof ModelUnavailable) {
      console.error(`model: ${e.detail ?? e.message}`);
      return json(res, 503, { error: e.message });
    }
    console.error(e);
    return json(res, 500, { error: "The reader failed on this drawing. The details are in the terminal." });
  }
});

server.listen(PORT, HOST, () => {
  const address = server.address();
  if (address && typeof address === "object") port = address.port;
  console.log(`Drawing reader ready on http://localhost:${port} (this machine only)`);
});

const PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Drawing Reader · QS Platform</title>
<style>
  :root {
    --n-0:#fff; --n-50:#f7f8fa; --n-100:#eceef2; --n-200:#d8dce3; --n-400:#838c99; --n-500:#5a6371; --n-600:#3f4753; --n-800:#1a1f26;
    --a-50:#f1f7e9; --a-500:#4a7722; --a-700:#2e4b15; --brand-500:#8dc63f; --brand-600:#536e23;
    --ok-50:#e9f7ef; --ok-700:#166638; --warn-50:#fdf4e3; --warn-700:#8a5f0e; --err-50:#fdeceb; --err-700:#9c2d27;
    --blue-50:#eef4fb; --blue-700:#1e4f86;
  }
  * { box-sizing: border-box; }
  body { margin:0; font:13px/1.45 Inter, system-ui, sans-serif; color:var(--n-800); background:var(--n-50); }
  header { display:flex; align-items:center; gap:12px; padding:10px 20px; background:var(--n-0); border-bottom:1px solid var(--n-200); }
  .mark { width:10px; height:28px; background:var(--brand-500); border-radius:2px; }
  header h1 { font-size:15px; margin:0; font-weight:600; }
  header .sub { color:var(--n-500); }
  header .tag { margin-left:auto; font-size:11px; padding:2px 8px; border-radius:999px; background:var(--warn-50); color:var(--warn-700); }
  main { display:grid; grid-template-columns: minmax(420px, 520px) 1fr; gap:16px; padding:16px 20px; height: calc(100vh - 50px); }
  .col { overflow:auto; display:flex; flex-direction:column; gap:12px; padding-bottom:24px; }
  section { background:var(--n-0); border:1px solid var(--n-200); border-radius:8px; padding:12px 14px; }
  section h2 { font-size:13px; margin:0 0 8px; font-weight:600; display:flex; align-items:center; gap:8px; }
  section h2 .count { color:var(--n-500); font-weight:400; }
  .row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  button { font:inherit; border:1px solid var(--n-200); background:var(--n-0); border-radius:6px; padding:6px 12px; cursor:pointer; }
  button.primary { background:var(--brand-600); border-color:var(--brand-600); color:#fff; }
  button.model { background:var(--blue-700); border-color:var(--blue-700); color:#fff; }
  button:disabled { opacity:.5; cursor:default; }
  select { font:inherit; padding:5px; border-radius:6px; border:1px solid var(--n-200); }
  table { width:100%; border-collapse:collapse; font-variant-numeric: tabular-nums; }
  th, td { text-align:left; padding:5px 6px; border-bottom:1px solid var(--n-100); vertical-align:top; }
  th { font-weight:500; color:var(--n-500); font-size:12px; }
  td.num, th.num { text-align:right; }
  tbody tr.pick { cursor:pointer; }
  tbody tr.pick:hover { background:var(--n-50); }
  tbody tr.on { background:var(--a-50); box-shadow: inset 3px 0 0 var(--a-500); }
  .badge { display:inline-block; font-size:11px; padding:1px 7px; border-radius:999px; white-space:nowrap; }
  .ok { background:var(--ok-50); color:var(--ok-700); } .bad { background:var(--err-50); color:var(--err-700); } .warn { background:var(--warn-50); color:var(--warn-700); } .info { background:var(--blue-50); color:var(--blue-700); }
  .muted { color:var(--n-500); } .small { font-size:12px; }
  code { font: 11.5px ui-monospace, Consolas, monospace; color:var(--n-600); }
  .drawing { background:var(--n-0); border:1px solid var(--n-200); border-radius:8px; overflow:hidden; display:flex; flex-direction:column; }
  .drawing .bar { padding:8px 12px; border-bottom:1px solid var(--n-100); display:flex; gap:8px; align-items:center; }
  .drawing .canvas { flex:1; display:flex; align-items:center; justify-content:center; padding:12px; overflow:auto; }
  .drawing svg { max-width:100%; height:auto; }
  .empty { color:var(--n-400); text-align:center; padding:60px 20px; }
  .error { background:var(--err-50); color:var(--err-700); padding:8px 10px; border-radius:6px; }
  ul.plain { margin:0; padding-left:18px; }
</style>
</head>
<body>
<header>
  <div class="mark"></div>
  <h1>Drawing Reader</h1><span class="sub">QS Platform · concept layouts, measured from DXF or plotted PDF</span>
  <span class="tag">Spike – nothing is saved</span>
</header>
<main>
  <div class="col">
    <section>
      <h2>Drawing</h2>
      <div class="row">
        <button class="primary" data-testid="load-sample">Load sample</button>
        <button type="button" id="open-file">Open a DXF or PDF…</button>
        <input id="file" type="file" accept=".dxf,.pdf" hidden>
        <span class="muted small">DXF units if not stated:</span>
        <select id="units"><option value="">from drawing</option><option>mm</option><option>cm</option><option>m</option></select>
      </div>
      <div class="row" style="margin-top:8px">
        <span class="muted small">PDF scale 1:</span><input id="scale" type="number" min="1" max="100000" placeholder="from sheet" style="width:96px" data-testid="scale">
        <span class="muted small">Close boundary gaps up to</span><input id="snap" type="number" min="0.01" max="20" step="0.1" value="0.5" style="width:64px" data-testid="snap"><span class="muted small">m</span>
      </div>
      <p id="status" class="muted small" data-testid="status" style="margin:8px 0 0">Open an ASCII DXF or a PDF plotted from CAD, or load the sample concept layout.</p>
    </section>
    <div id="results"></div>
  </div>
  <div class="drawing">
    <div class="bar"><strong id="title">No drawing</strong><span id="picked" class="muted small"></span></div>
    <div class="canvas" id="canvas" data-testid="canvas"><div class="empty">The drawing appears here. Pick a row to see what it was measured from.</div></div>
  </div>
</main>
<script nonce="__NONCE__">
/*
 * Everything a drawing supplies – layer and block names, handles, label text – is written by
 * whoever drew it, so every value placed in HTML goes through esc(), numbers included. The SVG
 * comes from renderSvg, which escapes its own text and writes only numbers into paths.
 */
const $ = (s) => document.querySelector(s);
let dxf = null, report = null, name = "", kind = "dxf", scaleInfo = null;
/** Pens (for a PDF) or layers traced as a boundary network – erven on a site plan. */
let regions = [];
const fmt = (n, dp = 2) => n === null || n === undefined ? "–" : Number(n).toLocaleString("en-ZA", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const params = (extra = {}) => {
  const q = new URLSearchParams();
  if ($("#units").value) q.set("units", $("#units").value);
  if ($("#scale").value) q.set("scale", $("#scale").value);
  if (regions.length) q.set("regions", regions.join("|"));
  if ($("#snap").value) q.set("snap", $("#snap").value);
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  return "?" + q.toString();
};

async function post(path, extra = {}) {
  const res = await fetch(path + params(extra), { method: "POST", body: dxf });
  const out = await res.json();
  if (!res.ok) throw new Error(out.error || res.statusText);
  return out;
}

async function load(bytes, fileName, keepRegions = false) {
  if (!keepRegions) regions = [];
  dxf = bytes; name = fileName;
  $("#status").textContent = "Reading " + fileName + "… (an A0 PDF takes a few seconds)";
  try {
    const out = await post("/api/read");
    report = out.report; kind = out.kind; scaleInfo = out.scale;
    $("#title").textContent = fileName;
    $("#canvas").innerHTML = out.render.svg;
    renderReport();
    $("#status").textContent = "Read " + fileName + ": " + report.loops.length + " closed outlines, " + report.blocks.reduce((s, b) => s + b.inserts, 0) + " block inserts. " +
      (kind === "pdf" ? (scaleInfo && scaleInfo.reason ? scaleInfo.reason : "") : "Units " + report.units.name + ".");
  } catch (e) {
    $("#status").innerHTML = '<span class="error">' + esc(e.message) + "</span>";
  }
}

async function pick(handles, label, row) {
  document.querySelectorAll("tr.on").forEach((r) => r.classList.remove("on"));
  if (row) row.classList.add("on");
  const out = await post("/api/render", { highlight: handles.join(",") });
  $("#canvas").innerHTML = out.svg;
  $("#picked").textContent = label ? "· showing " + label + " (" + handles.join(", ") + ")" : "";
}

function renderReport() {
  const r = report;
  // An A0 sheet has thousands of outlines: regions first, then the largest, and say how many are not listed.
  const ROWS = 150;
  const ordered = [...r.loops].sort((a, b) => (a.source === "region") !== (b.source === "region") ? (a.source === "region" ? -1 : 1) : (b.area || 0) - (a.area || 0));
  const hiddenLoops = Math.max(0, ordered.length - ROWS);
  const loops = ordered.slice(0, ROWS).map((l) => '<tr class="pick" data-testid="loop-' + esc(l.id) + '" data-handles="' + esc(l.handles.join(",")) + '" data-label="' + esc(l.id) + '">' +
    "<td><strong>" + esc(l.id) + "</strong></td><td>" + esc(l.layer) + (l.block ? ' <span class="badge info">' + esc(l.block) + "</span>" : "") +
    (l.inside ? '<div class="muted small">inside ' + esc(l.inside) + "</div>" : "") + "</td>" +
    '<td class="num">' + fmt(l.area) + '</td><td class="num">' + fmt(l.net) + '</td><td class="num">' + fmt(l.perimeter) + "</td>" +
    '<td><span class="badge ' + (l.source === "chain" ? "warn" : l.source === "region" ? "ok" : "info") + '">' + (l.source === "chain" ? "joined lines" : l.source === "region" ? "traced region" : esc(l.source)) + "</span></td></tr>").join("") +
    (hiddenLoops ? '<tr><td colspan="6" class="muted small">' + esc(hiddenLoops) + " smaller outlines not listed.</td></tr>" : "");

  // For a PDF the layers are pens. The erf boundaries are one of them; choosing it traces the erven.
  const pens = kind === "pdf" ? r.layers.filter((l) => /^(stroke|fill) /.test(l.name)).sort((a, b) => (b.length || 0) - (a.length || 0)).slice(0, 14) : [];
  const swatch = (name) => { const m = /#[0-9a-f]{6}/i.exec(name); return m ? '<span style="display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;background:' + m[0] + '"></span>' : ""; };
  const penRows = pens.map((p, i) => {
    const on = regions.includes(p.name);
    const pieces = Object.values(p.counts).reduce((s, n) => s + n, 0);
    return "<tr><td>" + swatch(p.name) + esc(p.name) + '</td><td class="num">' + esc(pieces) + '</td><td class="num">' + fmt(p.length, 0) + '</td><td class="num">' + esc(p.loops) + "</td>" +
      '<td><button type="button" class="' + (on ? "primary" : "") + '" data-testid="pen-' + i + '" data-pen="' + esc(p.name) + '">' + (on ? "Tracing ✓" : "Trace regions") + "</button></td></tr>";
  }).join("");

  const checkOrder = (c) => (c.agrees === true ? 0 : c.agrees === false ? 1 : 2);
  const shownChecks = [...r.areaChecks].map((c, i) => ({ c, i })).sort((a, b) => checkOrder(a.c) - checkOrder(b.c)).slice(0, ROWS);
  const checks = shownChecks.map(({ c, i }) => {
    const l = r.loops.find((x) => x.id === c.loop);
    const badge = c.agrees === true ? '<span class="badge ok">agrees</span>' : c.agrees === false ? '<span class="badge bad">disagrees</span>' : '<span class="badge warn">not checked</span>';
    return '<tr class="pick" data-testid="check-' + i + '" data-handles="' + esc((l ? l.handles : []).concat(c.textHandle ? [c.textHandle] : []).join(",")) + '" data-label="' + esc(c.loop || "label") + '">' +
      "<td>" + esc(c.text.replace(/\\n/g, " ")) + (c.block ? ' <span class="badge info">' + esc(c.block) + "</span>" : "") + '<div class="muted small">' + esc(c.reason) + "</div></td>" +
      '<td class="num">' + fmt(c.stated) + '</td><td class="num">' + fmt(c.computed) + "</td><td>" + badge + "</td></tr>";
  }).join("");

  const blocks = r.blocks.map((b) => '<tr class="pick" data-testid="block-' + esc(b.name) + '" data-handles="' + esc(b.handles.join(",")) + '" data-label="' + esc(b.name) + '">' +
    "<td><strong>" + esc(b.name) + '</strong></td><td class="num">' + esc(b.inserts) + '</td><td class="num">' + fmt(b.footprint) + '</td><td class="num">' + fmt(b.totalFootprint) + "</td></tr>").join("");

  const skipped = Object.entries(r.skipped).map(([k, v]) => "<li>" + esc(v) + " × " + esc(k) + " – not read</li>").join("");
  const LIST = 12;
  const open = r.open.slice(0, LIST).map((o) => "<li>Open chain on " + esc(o.layer) + " (" + esc(o.handles.slice(0, 6).join(", ")) + (o.handles.length > 6 ? ", …" : "") + "), gap " + fmt(o.gapMetres) + " m – not measured</li>").join("") +
    (r.open.length > LIST ? "<li>…and " + esc(r.open.length - LIST) + " more open chains</li>" : "");
  const junctions = r.junctions.slice(0, LIST).map((j) => "<li>" + esc(j.meeting) + " pieces meet on " + esc(j.layer) + " – not measured</li>").join("") +
    (r.junctions.length > LIST ? "<li>…and " + esc(r.junctions.length - LIST) + " more junctions</li>" : "");
  const notes = r.notes.map((n) => "<li>" + esc(n) + "</li>").join("");

  $("#results").innerHTML =
    (kind === "pdf"
      ? '<section data-testid="scale-info"><h2>Scale</h2>' + (scaleInfo && scaleInfo.value ? "1:" + esc(scaleInfo.value) : "unknown") + ' <span class="muted small">' + esc(scaleInfo ? scaleInfo.reason : "") + "</span></section>" +
        '<section><h2>Pens <span class="count">the PDF\\'s stand-in for CAD layers</span></h2><p class="muted small" style="margin:0 0 8px">Pick the pen the erf boundaries are drawn with. Its lines are traced into regions, and each printed area is checked against the region it sits in.</p><table data-testid="pens"><thead><tr><th>Pen</th><th class="num">Pieces</th><th class="num">Length m</th><th class="num">Closed</th><th></th></tr></thead><tbody>' + penRows + "</tbody></table></section>"
      : '<section data-testid="units"><h2>Units</h2>' + esc(r.units.name) + ' <span class="muted small">' + (r.units.statedBy ? "stated by the " + r.units.statedBy : "not stated – areas withheld") + "</span></section>") +
    '<section><h2>Closed outlines <span class="count">' + esc(r.loops.length) + '</span></h2><table data-testid="loops"><thead><tr><th>Id</th><th>Layer</th><th class="num">Area m²</th><th class="num">Net m²</th><th class="num">Perim. m</th><th>From</th></tr></thead><tbody>' + loops + "</tbody></table></section>" +
    '<section><h2>Printed areas against the geometry <span class="count">' + r.areaChecks.filter((c) => c.agrees === true).length + " of " + r.areaChecks.length + ' agree</span></h2><table data-testid="checks"><thead><tr><th>Label</th><th class="num">Printed</th><th class="num">Measured</th><th></th></tr></thead><tbody>' + checks + "</tbody></table></section>" +
    '<section><h2>Blocks <span class="count">' + r.blocks.length + '</span></h2><table data-testid="blocks"><thead><tr><th>Block</th><th class="num">Inserts</th><th class="num">Each m²</th><th class="num">Total m²</th></tr></thead><tbody>' + blocks + "</tbody></table></section>" +
    '<section><h2>Interpret with DeepSeek</h2><p class="muted small" style="margin:0 0 8px">Sends only what was measured – ids, layers, blocks, labels – and asks what each part is. Every figure below is computed here, never by the model.</p><button class="model" data-testid="interpret">Interpret</button><div id="interpretation" data-testid="interpretation" style="margin-top:10px"></div></section>' +
    ((skipped || open || junctions || notes) ? '<section data-testid="not-measured"><h2>Not measured, and why</h2><ul class="plain small">' + skipped + open + junctions + notes + "</ul></section>" : "");

  document.querySelectorAll("tr.pick").forEach((row) => row.addEventListener("click", () => pick(row.dataset.handles.split(",").filter(Boolean), row.dataset.label, row)));
  document.querySelectorAll("[data-pen]").forEach((b) => b.addEventListener("click", () => {
    const pen = b.dataset.pen;
    regions = regions.includes(pen) ? regions.filter((p) => p !== pen) : [...regions, pen];
    load(dxf, name, true);
  }));
  $('[data-testid="interpret"]').addEventListener("click", interpret);
}

async function interpret() {
  const btn = $('[data-testid="interpret"]'), out = $("#interpretation");
  btn.disabled = true; out.innerHTML = '<span class="muted">Asking DeepSeek what each part is…</span>';
  try {
    const { interpretation: it, schedule: s, usage } = await post("/api/interpret");
    const role = (r) => '<span class="badge info">' + esc(r.replace(/_/g, " ")) + "</span>";
    const lines = s.lines.map((l) => '<tr><td>' + esc(l.label) + '<div class="muted small">' + esc(l.working) + '</div></td><td class="num"><strong>' +
      (l.value === null ? "–" : l.unit === "ratio" ? fmt(l.value * 100, 1) + "%" : l.unit === "no" ? esc(l.value) : fmt(l.value) + " m²") + "</strong></td></tr>").join("");
    const mix = s.unitMix.map((u) => "<tr><td>" + esc(u.name || u.block) + '</td><td class="num">' + esc(u.count) + '</td><td class="num">' + fmt(u.each) + '</td><td class="num">' + fmt(u.total) + "</td></tr>").join("");
    const checks = s.checks.map((c) => "<li>" + (c.agrees === true ? '<span class="badge ok">agrees</span> ' : c.agrees === false ? '<span class="badge bad">check</span> ' : "") + esc(c.label) + ": " + esc(c.detail) + "</li>").join("");
    const labels = it.loops.map((l) => "<li><strong>" + esc(l.loop) + "</strong> " + role(l.role) + ' <span class="muted">' + esc(l.reason) + "</span></li>").join("") +
      it.blocks.map((b) => "<li><strong>" + esc(b.block) + "</strong> " + role(b.role) + (b.name ? " “" + esc(b.name) + "”" : "") + ' <span class="muted">' + esc(b.reason) + "</span></li>").join("");
    const refused = it.refused.map((r) => "<li>" + esc(r.label) + " – " + esc(r.reason) + "</li>").join("") + it.conflicts.map((c) => "<li>" + esc(c) + "</li>").join("");
    out.innerHTML =
      '<h2 style="font-size:12px;margin:4px 0">Concept schedule <span class="badge warn">proposed – a QS confirms the roles</span></h2><table data-testid="schedule"><tbody>' + lines + "</tbody></table>" +
      (mix ? '<h2 style="font-size:12px;margin:12px 0 4px">Unit mix</h2><table data-testid="unit-mix"><thead><tr><th>Unit</th><th class="num">No.</th><th class="num">Each m²</th><th class="num">Total m²</th></tr></thead><tbody>' + mix + "</tbody></table>" : "") +
      '<ul class="plain small" style="margin-top:10px" data-testid="schedule-checks">' + checks + "</ul>" +
      '<h2 style="font-size:12px;margin:12px 0 4px">What the model said each part is</h2><ul class="plain small" data-testid="labels">' + labels + "</ul>" +
      (refused ? '<h2 style="font-size:12px;margin:12px 0 4px">Refused</h2><ul class="plain small" data-testid="refused">' + refused + "</ul>" : "") +
      '<p class="muted small">DeepSeek: ' + esc(usage.input) + " tokens in, " + esc(usage.output) + " out.</p>";
  } catch (e) {
    out.innerHTML = '<div class="error">' + esc(e.message) + "</div>";
  } finally {
    btn.disabled = false;
  }
}

$('[data-testid="load-sample"]').addEventListener("click", async () => { const s = await (await fetch("/api/sample")).json(); load(s.dxf, s.name); });
$("#open-file").addEventListener("click", () => $("#file").click());
$("#file").addEventListener("change", async (e) => { const f = e.target.files[0]; if (f) load(await f.arrayBuffer(), f.name); });
$("#units").addEventListener("change", () => dxf && load(dxf, name, true));
$("#scale").addEventListener("change", () => dxf && load(dxf, name, true));
$("#snap").addEventListener("change", () => dxf && regions.length && load(dxf, name, true));
</script>
</body>
</html>`;
