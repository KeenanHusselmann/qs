/**
 * A document is named by its name, and can be opened.
 *
 * ── What this suite reproduces ─────────────────────────────────────────────────────────────
 *
 * The upload is made with a **path-shaped multipart filename**, which is not a contrivance: when a
 * file is chosen through a directory picker, Chrome puts the relative path in that parameter even
 * though `File.name` in the page is the bare name. Measured, both ways:
 *
 *     File.name             "poa.txt"
 *     Content-Disposition   filename="corpus/ANNEXURE A - POWER OF ATTORNEY/poa.txt"
 *
 * `request.formData()` reads back the second one, which is why every folder import was filed under
 * its whole path. `fd.append(name, blob, path)` sends exactly that, so this is the real case.
 *
 * The other half is the viewer: that it opens, that it is read-only, and that a document id cannot
 * be dragged across a project boundary by editing the URL.
 */

import postgres from "postgres";
import { readFileSync } from "node:fs";
import puppeteer from "puppeteer";
import { createProject, signIn, readEnv } from "./helpers.mjs";

const env = readEnv();

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const BASE = "http://localhost:3000";

/** The real shape of a Talani land-use submission, four folders deep. */
const IMPORT_PATH =
  "Talani QS - for Feasibility/02 March LAND USE SUBMISSION FOLDER FINAL/ANNEXURE A - POWER OF ATTORNEY/title-deed.pdf";

const pdfBase64 = readFileSync("./fixtures/title-deed.pdf").toString("base64");

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));

await signIn(page, env);

const name = "Viewer test " + Date.now();
await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
const { href } = await createProject(page, name);
const projectId = href.split("/").pop();

// ── File it the way a folder import does ──────────────────────────────────────────────────
const filed = await page.evaluate(
  async (id, path, b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const body = new FormData();
    body.append("file", new Blob([bytes], { type: "application/pdf" }), path);
    body.set("kind", "Title deed");
    const response = await fetch(`/api/projects/${id}/documents`, { method: "POST", body });
    return { status: response.status, ...(await response.json()) };
  },
  projectId,
  IMPORT_PATH,
  pdfBase64,
);

check("the folder import is accepted", filed.ok === true, `HTTP ${filed.status}`);
if (filed.warning) console.log("      warning:", filed.warning);

// ── 1. The name, not the path ─────────────────────────────────────────────────────────────
await page.goto(`${BASE}${href}/site`, { waitUntil: "networkidle0" });
const text = await page.$eval("main", (e) => e.innerText);

check("the row reads the document's name", text.includes("title-deed.pdf"));
check(
  "and not its import path",
  !text.includes("Talani QS - for Feasibility/02 March"),
  text.includes("Talani QS - for Feasibility/02 March") ? "the path is still on screen" : "",
);
check(
  "the folders it came from are kept as provenance",
  text.includes("ANNEXURE A - POWER OF ATTORNEY"),
);

// ── 2. The name is a link to the original ─────────────────────────────────────────────────
const link = await page.$$eval("main a[data-document-link]", (as) =>
  as.map((a) => ({ href: a.getAttribute("href"), text: a.textContent.trim(), target: a.target })),
);

check("the filename is a link", link.length > 0, `${link.length} found`);
// One entry per document. The passage and the filed list used to be separate blocks, so the only
// document filed against a criterion appeared twice — two links to one file read as two files.
check("named once, not once per block", link.length === 1, `${link.length} links to it`);
check("it is labelled with the name", link[0]?.text === "title-deed.pdf", link[0]?.text ?? "none");
check("it opens in a new tab", link[0]?.target === "_blank");
check(
  "it points at this project's document route",
  /^\/api\/projects\/[0-9a-f-]{36}\/documents\/[0-9a-f-]{36}\/title-deed\.pdf$/.test(link[0]?.href ?? ""),
  link[0]?.href ?? "none",
);
// Chrome titles a PDF tab from the last path segment, not from Content-Disposition. Without the
// name on the end, three open pieces of evidence are three tabs called 84b042e3-…
check("the name is what the tab will be called", link[0]?.href.endsWith("/title-deed.pdf"));

const documentUrl = BASE + link[0].href;
const documentId = link[0].href.split("/").slice(-2)[0];

// ── 3. It actually opens, as a PDF, inline ────────────────────────────────────────────────
const served = await page.evaluate(async (url) => {
  const response = await fetch(url);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    status: response.status,
    type: response.headers.get("content-type"),
    disposition: response.headers.get("content-disposition"),
    nosniff: response.headers.get("x-content-type-options"),
    length: bytes.length,
    magic: String.fromCharCode(...bytes.slice(0, 5)),
  };
}, documentUrl);

check("the original is served", served.status === 200, `HTTP ${served.status}`);
check("as a PDF", served.type === "application/pdf", served.type ?? "none");
check(
  "to be opened in the tab rather than downloaded",
  served.disposition?.startsWith("inline;"),
  served.disposition ?? "none",
);
check(
  "under its own name, not its path",
  served.disposition?.includes('filename="title-deed.pdf"'),
  served.disposition ?? "none",
);
check("the declared type is not sniffed past", served.nosniff === "nosniff");
check("the bytes are the document", served.magic === "%PDF-", `${served.length} bytes, ${served.magic}`);

// The strongest form of "it opens": let the browser's own PDF viewer load it.
const opened = await browser.newPage();
const response = await opened.goto(documentUrl, { waitUntil: "domcontentloaded" });
check("a browser navigating to it gets the document", response.status() === 200, `HTTP ${response.status()}`);
await opened.close();

// ── 4. Read-only, by construction ─────────────────────────────────────────────────────────
const writes = await page.evaluate(async (url) => {
  const out = {};
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    out[method] = (await fetch(url, { method, body: method === "DELETE" ? undefined : "x" })).status;
  }
  return out;
}, documentUrl);

for (const [method, status] of Object.entries(writes)) {
  check(`${method} is refused — a document that can be edited is not evidence`, status === 405, `HTTP ${status}`);
}

// ── 5. A document id does not cross a project boundary ────────────────────────────────────
const other = "Other project " + Date.now();
await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
const { href: otherHref } = await createProject(page, other);
const otherId = otherHref.split("/").pop();

const crossed = await page.evaluate(
  async (id, doc) => ({
    named: (await fetch(`/api/projects/${id}/documents/${doc}/title-deed.pdf`)).status,
    // The bare form too — the name segment is optional, so both shapes must be scoped.
    bare: (await fetch(`/api/projects/${id}/documents/${doc}`)).status,
  }),
  otherId,
  documentId,
);
check("another project's URL does not resolve it", crossed.named === 404, `HTTP ${crossed.named}`);
check("nor does the same URL without the name", crossed.bare === 404, `HTTP ${crossed.bare}`);

// ── 6. And it is behind the session ───────────────────────────────────────────────────────
const anonymous = await browser.createBrowserContext();
const stranger = await anonymous.newPage();
const refused = await stranger.goto(documentUrl, { waitUntil: "domcontentloaded" });
check("a signed-out request is refused", refused.status() === 401, `HTTP ${refused.status()}`);
await anonymous.close();

// ── 6b. A stale recorded location still opens ─────────────────────────────────────────────
//
// The first version of this wrote `join(ROOT, key)` into the row, and moving the project from one
// drive to another broke every document filed before the move: the row named a path that no longer
// existed on a machine that still had the file. Locations are portable now, and a stale one is
// recovered from the document id rather than trusted — proved here by breaking one on purpose.
const db = postgres(env.DATABASE_URL);
try {
  const [before] = await db`select storage_location from documents where id = ${documentId}`;
  check(
    "a filed document records a portable location, not a drive letter",
    Boolean(before.storage_location) && !/^([a-z]:|\/|http)/i.test(before.storage_location),
    before.storage_location,
  );

  await db`update documents set storage_location = ${"C:\\gone\\nowhere.pdf"} where id = ${documentId}`;
  const recovered = await page.evaluate(
    async (url) => (await fetch(url)).status,
    documentUrl,
  );
  check("a stale recorded location is recovered, not reported broken", recovered === 200, `HTTP ${recovered}`);

  await db`update documents set storage_location = ${before.storage_location} where id = ${documentId}`;
} finally {
  await db.end();
}

// ── 7. The quote no longer competes with the filename ─────────────────────────────────────
await page.goto(`${BASE}${href}/site`, { waitUntil: "networkidle0" });

const citation = await page.evaluate(() => {
  const details = [...document.querySelectorAll('[data-region="readiness"] details')];
  const quote = details.find((d) => d.querySelector("summary")?.textContent.includes("“"));
  if (!quote) return null;
  const summary = quote.querySelector("summary");
  return {
    open: quote.open,
    lines: summary.getClientRects().length,
    // The line that shows the quote when closed, and the full passage when open.
    clamped: getComputedStyle(summary.querySelector("span")).textOverflow,
  };
});

check("the passage is behind a disclosure", citation !== null);
check("closed by default, so the document leads", citation?.open === false);
check("and trimmed to one line", citation?.lines === 1, `${citation?.lines} line(s)`);
check("with the overflow marked rather than cut", citation?.clamped === "ellipsis", citation?.clamped);

await browser.close();
console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} failed.`);
process.exit(fails ? 1 : 0);
