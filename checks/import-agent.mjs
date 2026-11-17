/**
 * The import agent, end to end, on documents that are actually different.
 *
 * The fixtures here are built to be the four cases: a reference map and a technical drawing that
 * text search cannot tell apart, a document filed twice, and two revisions of one sheet. Two of them
 * are generated as real PDFs with real content streams, because the whole claim is that the
 * measurement comes out of the file — asserting it against a hand-written number would test nothing.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import postgres from "postgres";
import puppeteer from "puppeteer";
import { createProject, signIn, readEnv } from "./helpers.mjs";

const env = readEnv();

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const BASE = "http://localhost:3000";
const TMP = "./.e2e-tmp";
if (!existsSync(TMP)) mkdirSync(TMP);

/**
 * A one-page PDF with `strokes` line segments in its content stream.
 *
 * This is how the difference is manufactured honestly: few strokes is a map placed on a page, many
 * is a drawing. The count that comes back out is pdf.js counting operators, not this number.
 */
function drawingPdf(strokes, label) {
  const ops = [`BT /F1 9 Tf 40 800 Td (${label}) Tj ET`];
  for (let i = 0; i < strokes; i++) {
    const x = 20 + (i % 500) * 1.1;
    const y = 40 + ((i * 7) % 700);
    ops.push(`${x.toFixed(1)} ${y.toFixed(1)} m ${(x + 9).toFixed(1)} ${(y + 5).toFixed(1)} l S`);
  }
  const content = ops.join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${String(o).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}

writeFileSync(`${TMP}/locality-map.pdf`, drawingPdf(40, "LOCALITY MAP - SITE SHOWN SHADED"));
writeFileSync(`${TMP}/services-layout-revA.pdf`, drawingPdf(120_000, "SERVICES LAYOUT REV A"));
writeFileSync(`${TMP}/services-layout-revE.pdf`, drawingPdf(120_000, "SERVICES LAYOUT REV E"));

const deed = readFileSync("./fixtures/brief.txt");
writeFileSync(`${TMP}/scheme-brief.txt`, deed);
writeFileSync(`${TMP}/scheme-brief-copy.txt`, deed);

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1200 });
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));

await signIn(page, env);
await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
const { href } = await createProject(page, "Import agent " + Date.now());
const projectId = href.split("/").pop();

/** File straight at the API, so the test is about the agent and not about a drop zone. */
async function file(path, name, kind) {
  const bytes = readFileSync(path).toString("base64");
  return page.evaluate(
    async (id, b64, filename, k) => {
      const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const body = new FormData();
      body.append("file", new Blob([raw]), filename);
      body.set("kind", k);
      const r = await fetch(`/api/projects/${id}/documents`, { method: "POST", body });
      return { status: r.status, ...(await r.json()) };
    },
    projectId,
    bytes,
    name,
    kind,
  );
}

console.log("\n  filing…");
await file(`${TMP}/locality-map.pdf`, "locality-map.pdf", "Locality map");
await file(`${TMP}/services-layout-revA.pdf`, "services-layout-revA.pdf", "Layout plan");
await file(`${TMP}/services-layout-revE.pdf`, "services-layout-revE.pdf", "Layout plan");
await file(`${TMP}/scheme-brief.txt`, "scheme-brief.txt", "Project brief");
await file(`${TMP}/scheme-brief-copy.txt`, "scheme-brief-copy.txt", "Project brief");

// ── The measurement reached the database ──────────────────────────────────────────────────
const db = postgres(env.DATABASE_URL);
let measured;
try {
  measured = await db`
    select filename, kind, drawing_ops, text_fingerprint
      from documents
     where project_id = ${projectId} and deleted_at is null
     order by created_at`;

  const map = measured.find((d) => d.filename === "locality-map.pdf");
  const sheet = measured.find((d) => d.filename === "services-layout-revE.pdf");
  const brief = measured.find((d) => d.filename === "scheme-brief.txt");

  check("a drawing's geometry is counted at ingest", map.drawing_ops > 0, `map ${map.drawing_ops} ops`);
  check(
    "and the technical drawing measures far larger",
    sheet.drawing_ops > map.drawing_ops * 50,
    `${sheet.drawing_ops} vs ${map.drawing_ops} ops`,
  );
  check("a text document is not counted for geometry", brief.drawing_ops === null);
  check("identical text produces one fingerprint", Boolean(brief.text_fingerprint));

  const copies = measured.filter((d) => d.text_fingerprint === brief.text_fingerprint);
  check("both copies of the brief share it", copies.length === 2, `${copies.length} documents`);
} finally {
  await db.end();
}

// ── And the screen says so ────────────────────────────────────────────────────────────────
await page.goto(`${BASE}${href}/corpus`, { waitUntil: "networkidle0" });
const screen = await page.$eval("main", (e) => e.innerText);

console.log("\n  ── what the agent proposes ───────────────────────────────────────────");
console.log(
  screen
    .split("\n")
    .slice(screen.split("\n").findIndex((l) => /what is in the corpus/i.test(l)))
    .filter((l) => l.trim())
    .map((l) => `  ${l}`)
    .join("\n"),
);
console.log("  ──────────────────────────────────────────────────────────────────────\n");

check("the review names the reference map", /locality-map\.pdf/.test(screen));
// The verdict is a group heading now, said once, rather than a badge repeated on every row.
check("and groups it under reference only", /may be reference only/i.test(screen));
check("with the yardstick stated once, not per row", (screen.match(/2 256 170/g) ?? []).length === 1,
  `${(screen.match(/2 256 170/g) ?? []).length} occurrences`);
check("citing the operation count", /drawing operations/.test(screen), (screen.match(/[\d ,]+ drawing operations[^\n]{0,60}/) ?? [""])[0].trim());
check("the earlier revision is grouped as superseded", /(has a later revision|have later revisions)/i.test(screen));
check("naming the sheet that replaces it", /replaced by services-layout-revE\.pdf/.test(screen));
check("the second copy of the brief is grouped as filed twice", /(is|are) filed twice/i.test(screen));
check("naming the one filed first", /identical to scheme-brief\.txt/.test(screen));

// The technical drawing must survive. Proposing that a QS archive the site's geometry is the one
// mistake this agent must not make.
const proposedNames = await page.$$eval("[data-archive] li", (rows) =>
  rows.map((r) => (r.textContent ?? "").slice(0, 40)),
);
check(
  "the technical drawing is not proposed for archiving",
  !proposedNames.some((n) => n.includes("services-layout-revE")),
  proposedNames.join(" | ") || "nothing proposed",
);

// ── Withdrawing is a human action, and it works ───────────────────────────────────────────
// One per document, not one per proposal. The review lists the whole corpus now — it used to show
// only the rows the agent objected to, which left nowhere to see what a project actually holds and
// nowhere to clear it. Five documents are filed above, so five is the number to expect.
const before = await page.$$eval("main button", (bs) => bs.filter((b) => /^Withdraw$/.test(b.textContent ?? "")).length);
check("every document offers a withdraw, and nothing withdraws itself", before === 5, `${before} buttons`);

await page.$$eval("main button", (bs) => bs.find((b) => /^Withdraw$/.test(b.textContent ?? ""))?.click());

/**
 * Wait for the **server** to have withdrawn it, not for the button to have changed its mind.
 *
 * This waited for the count of `Withdraw` buttons to drop, which it does in about 35 milliseconds —
 * because `setWithdrawing(id)` relabels that one button "Withdrawing…" and it stops matching. That
 * is the click being acknowledged, not the document being withdrawn. The suite then reloaded while
 * the action was still in flight, and against a production build the reload is fast enough to win:
 * the row came back, and `5 → 5` failed. Under `next dev` it passed on timing alone.
 *
 * `Delete all N` is rendered from the server's own `reviewed.length`, so it can only change once the
 * write has landed and the page has been re-rendered from it. That is the completion signal.
 */
await page.waitForFunction(
  (n) => document.body.innerText.includes(`Delete all ${n}`),
  { timeout: 15000 },
  before - 1,
);

await page.reload({ waitUntil: "networkidle0" });
const after = await page.$$eval("main button", (bs) => bs.filter((b) => /^Withdraw$/.test(b.textContent ?? "")).length);
check("withdrawing one removes it from the review", after === before - 1, `${before} → ${after}`);

await browser.close();
console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} failed.`);
process.exit(fails ? 1 : 0);
