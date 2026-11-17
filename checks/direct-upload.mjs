/**
 * A document too big to send through the platform.
 *
 *     USE_BLOB_STORAGE=1 npm run dev        # in another terminal
 *     npm run check:direct
 *
 * **Not in `npm run check`.** It needs a real document store and writes to one, like `check:blob`
 * and `check:run-live`. It cleans up after itself.
 *
 * The size is not arbitrary. Vercel refuses a request body over about 4.5 MB at the edge, before
 * any handler runs — and the documents this platform exists for are bigger than that: 11.8 MB of
 * geotechnical report, 22.1 MB of market study. Those are the files that produced "Did not reach
 * the server", which was true and useless. This is over the line by enough to take the direct path
 * and small enough to run often.
 *
 * A local dev server has no edge in front of it, so the old route would succeed here. That is
 * exactly why the assertions below are about *how* the document arrived, not merely that it did.
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import postgres from "postgres";
import puppeteer from "puppeteer";
import { createProject, fileAgainst, signIn, readEnv } from "./helpers.mjs";

const env = readEnv();

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const BASE = "http://localhost:3000";
const TMP = "./.e2e-tmp";
if (!existsSync(TMP)) mkdirSync(TMP);

/** Readable prose, so "it was indexed" can be asserted and not just "it was stored". */
const marker = `TRIALPIT-${Date.now()}`;
const paragraph =
  "The geotechnical investigation records founding conditions across the site, with trial pits " +
  "taken to refusal and dolomite risk assessed as low. Allowable bearing pressure is 150 kPa. ";
const body = `${marker}\n${paragraph.repeat(30_000)}`;
const bytes = Buffer.byteLength(body);
writeFileSync(`${TMP}/geotech-report.txt`, body);

console.log(`\n  a ${(bytes / 1048576).toFixed(1)} MB document; the platform body limit is 4.5 MB\n`);

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));

/** Every request the browser makes, so the route it took can be asserted rather than assumed. */
const requests = [];
page.on("request", (r) => requests.push({ method: r.method(), url: r.url() }));

await signIn(page, env);
await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
const { href } = await createProject(page, "Direct upload " + Date.now());
const projectId = href.split("/").pop();

/**
 * Filed the way a QS files a document they have in hand: on the row that asks for it.
 *
 * Not through the folder drop zone, whose input is a directory picker and cannot be handed a single
 * file by a driver. Both surfaces call the same `fileDocument`, so the path under test is the same.
 */
await page.goto(`${BASE}${href}/site`, { waitUntil: "networkidle0" });

requests.length = 0;
await fileAgainst(page, "Geotechnical information", `${TMP}/geotech-report.txt`);

await page.waitForFunction(
  () =>
    /geotech-report\.txt/.test(document.body.innerText) ||
    /did not|refused|limit/i.test(document.body.innerText),
  { timeout: 300000 },
);

const screen = await page.$eval("main", (e) => e.innerText);
check(
  "the large document files",
  /geotech-report\.txt/.test(screen),
  (screen.match(/[^\n]*(did not|refused|limit)[^\n]*/i) ?? ["filed"])[0],
);

// ── It took the direct route, which is the whole point ────────────────────────────────────
/**
 * Which route it should have taken depends on whether this deployment has a store, so the suite
 * asks the same question the browser does rather than assuming.
 *
 * Both configurations are real. Production has a store and must not push 5 MB through a 4.5 MB
 * door; a laptop has none and no edge limit either, and the body path is the right answer there.
 * The outcome assertions below are identical for both — that is the point of one ingestion.
 */
const direct = await page.evaluate(
  async (id) => (await (await fetch(`/api/projects/${id}/documents/upload-url`)).json()).direct,
  projectId,
);
console.log(`  (this deployment ${direct ? "has" : "has no"} document store)\n`);

const askedForToken = requests.some((r) => r.method === "POST" && r.url.includes("/documents/upload-url"));
// The bytes leave for the store's own host, not for this application. `/api/blob/mpu` is the
// multipart endpoint a large file goes through.
const toStore = requests.filter((r) => /\/api\/blob\/|blob\.vercel-storage\.com/.test(r.url));
const toUs = requests.filter(
  (r) => r.method === "POST" && /\/api\/projects\/[^/]+\/documents$/.test(new URL(r.url).pathname),
);

if (direct) {
  check("the browser asked to be authorised for the store", askedForToken);
  check(
    "and sent the bytes to the store, not through the function",
    toStore.length > 0,
    toStore.map((r) => `${r.method} ${new URL(r.url).host}${new URL(r.url).pathname}`).join(" | ").slice(0, 130),
  );
} else {
  // The fallback. It failed silently once: the token route refused with a marker the client was
  // meant to recognise, `upload()` wrapped the error, the marker was lost, and nothing was filed.
  check("with no store, the browser does not try to upload to one", toStore.length === 0);
  check("and sends the body instead", toUs.length === 1, `${toUs.length} POST to /documents`);
}

// One call to file the document, either way — a pathname or a body, never both.
check("the platform is asked to file it exactly once", toUs.length === 1, `${toUs.length} POST to /documents`);

// ── And the platform holds a real, readable document ──────────────────────────────────────
const db = postgres(env.DATABASE_URL);
let stored;
try {
  const [row] = await db`
    select d.id, d.filename, d.byte_size, d.storage_location,
           (select count(*)::int from passages p where p.document_id = d.id) as passages
      from documents d
     where d.project_id = ${projectId}
       and d.filename = 'geotech-report.txt'
       and d.deleted_at is null`;

  check("it is filed under its own name", Boolean(row), row?.filename ?? "not filed");
  if (row) {
    stored = row.storage_location;
    check("at its full size", Number(row.byte_size) === bytes, `${row.byte_size} of ${bytes} bytes`);
    check("its original is retained", Boolean(row.storage_location), row.storage_location ?? "not kept");
    check("under its own key, not the handover area", !String(row.storage_location).startsWith("incoming/"), row.storage_location);
    check("and it was read and indexed", row.passages > 0, `${row.passages} passages`);

    // Proves the bytes that arrived are the bytes that were sent, rather than a truncated body.
    const [hit] = await db`
      select 1 as found from passages
       where document_id = ${row.id} and body like ${"%" + marker + "%"} limit 1`;
    check("the text that arrived is the text that was sent", Boolean(hit));
  }
} finally {
  await db.end();
}

// ── Leave the store as it was found ───────────────────────────────────────────────────────
if (stored && direct) {
  const { del, head } = await import("@vercel/blob");
  const token = env.BLOB_READ_WRITE_TOKEN;
  await del(stored, { token }).catch(() => {});
  const gone = await head(stored, { token }).then(() => false).catch(() => true);
  check("the check leaves nothing in the store", gone);
}

await browser.close();
console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} failed.`);
process.exit(fails ? 1 : 0);
