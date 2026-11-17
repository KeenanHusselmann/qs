#!/usr/bin/env node
/**
 * File a project's corpus – a real folder of client documents, filed the way a person files them.
 *
 *     node scripts/file-corpus.mjs --manifest <manifest.json> [--base https://…] [--bypass <secret>]
 *     node scripts/file-corpus.mjs --manifest <manifest.json> --dry
 *     node scripts/file-corpus.mjs --manifest … --base https://… --ask   (sign in as yourself)
 *     HEADLESS=0 node scripts/file-corpus.mjs --manifest …      (watch it work)
 *
 * ── Who it signs in as ─────────────────────────────────────────────────────────────────────
 *
 * By default, the development account in `.env.local` – which is the right answer for a local run
 * and the wrong one everywhere else. `--ask` prompts for an e-mail and password at the terminal
 * instead: typed, never echoed, never written to disk, never passed as an argument. That last part
 * is the point. A password on the command line is in the shell history, in the process list, and
 * in any log that records a command, and none of those are places a production password can be
 * taken back out of.
 *
 * ── Why it drives the browser rather than posting to the endpoint ──────────────────────────
 *
 * The filing endpoint takes a multipart body, and on production anything over Vercel's ~4.5 MB
 * edge limit never reaches it: the request is refused upstream. The browser knows this and hands a
 * large document to the blob store first, then files a pathname. That logic lives in the client,
 * so a script that posted directly would work on a laptop and fail on the site that matters –
 * exactly the class of bug this platform keeps finding late. So it drives the real import.
 *
 * ── The manifest says what each document is ────────────────────────────────────────────────
 *
 * The import screen guesses a kind from the folder a document sits in, and a person corrects the
 * guesses before anything is filed. That correction is what a manifest is: done once, in a file
 * somebody can read and argue with, and repeatable against another environment.
 *
 *     {
 *       "project": { "name": "Marshall Dam", "client": "…", "stage": 2 },
 *       "documents": [{ "file": "C:/…/Structural Design Report.docx", "kind": "Engineering services report" }]
 *     }
 *
 * Documents already filed under the same name are dropped from the batch before it is sent, so a
 * run after a partial failure files the rest rather than duplicating what landed.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { basename } from "node:path";

import puppeteer from "puppeteer";

import { createProject } from "../checks/helpers.mjs";
import { identityFor, signInOrExplain } from "./lib/sign-in.mjs";

const arg = (name, fallback = null) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};



const ASK = process.argv.includes("--ask");
// Watch it work. A headless run that is thinking looks exactly like one that has hung.
const SHOW = process.argv.includes("--show");
const BASE = arg("base", "http://localhost:3000").replace(/\/$/, "");
const BYPASS = arg("bypass", process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? null);
const DRY = process.argv.includes("--dry");
const manifestPath = arg("manifest");
if (!manifestPath) {
  console.error("Which corpus? Pass --manifest <file.json>.");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const wanted = manifest.documents ?? [];
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

const missing = wanted.filter((d) => !existsSync(d.file));
if (missing.length) {
  console.error(`In the manifest and not on disk:\n${missing.map((d) => `  ${d.file}`).join("\n")}`);
  process.exit(1);
}

console.log(`${wanted.length} documents, ${mb(wanted.reduce((sum, d) => sum + statSync(d.file).size, 0))}, for "${manifest.project.name}" on ${BASE}`);
for (const d of wanted) console.log(`  ${mb(statSync(d.file).size).padStart(9)}  ${d.kind.padEnd(30)} ${basename(d.file)}`);
if (DRY) process.exit(0);

/*
  Who to sign in as, settled before the browser opens.

  `signIn` wants the two keys `.env.local` carries, so an asked-for identity is handed over in the
  same shape rather than teaching every caller a second one. A production run never touches
  `.env.local` at all – there is nothing in it that applies to production, and reading it would
  only invite the dev account to be used by accident.
*/
const identity = await identityFor(BASE, { ask: ASK });

if (!identity.DEV_USER_EMAIL || !identity.DEV_USER_PASSWORD) {
  console.error("No e-mail and password to sign in with.");
  process.exit(1);
}
/*
  The length, and only the length.

  A password read from the keyboard is invisible by design, so when a sign-in is refused there is
  no way to tell a wrong password from one the terminal mangled on the way in. The count settles
  that at a glance and gives nothing away.
*/


const browser = await puppeteer.launch({ headless: !SHOW && process.env.HEADLESS !== "0", defaultViewport: { width: 1500, height: 1000 } });
const page = await browser.newPage();
page.setDefaultTimeout(180_000);
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 160)));
// Production bounces anything unauthenticated to Vercel SSO. The bypass header is the supported
// way past it, with Deployment Protection left on; the app's own login is still the second gate.
if (BYPASS) await page.setExtraHTTPHeaders({ "x-vercel-protection-bypass": BYPASS, "x-vercel-set-bypass-cookie": "true" });


try {
  await signInOrExplain(page, identity, BASE);

  // ── The project: the one that is there, or a new one ────────────────────────────────────
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
  let href = await page.evaluate((name) => {
    const link = [...document.querySelectorAll('a[href^="/projects/"]')].find((a) => a.textContent?.includes(name));
    const found = link?.getAttribute("href") ?? "";
    return /^\/projects\/[0-9a-f-]{36}$/.test(found) ? found : "";
  }, manifest.project.name);

  if (href) console.log(`\nProject exists: ${BASE}${href}`);
  else {
    ({ href } = await createProject(page, manifest.project.name, BASE, manifest.project.stage ?? 1, manifest.project.client ?? ""));
    console.log(`\nProject created: ${BASE}${href}`);
  }

  // ── What is already filed, so nothing is filed twice ────────────────────────────────────
  console.log("  reading what is already filed…");
  await page.goto(`${BASE}${href}/corpus`, { waitUntil: "networkidle0" });
  const already = await page.evaluate(() => document.body.innerText);
  const batch = wanted.filter((d) => !already.includes(basename(d.file)));
  const skipped = wanted.length - batch.length;
  if (skipped) console.log(`${skipped} already filed – leaving them alone.`);
  if (batch.length === 0) {
    console.log("Nothing left to file.");
    await browser.close();
    process.exit(0);
  }

  // ── The folder, as the browser hands it over ────────────────────────────────────────────
  const chooser = await page.$('input[type="file"][multiple]');
  if (!chooser) throw new Error("No import control on the corpus page.");

  /*
    The import takes a folder, and a browser driver cannot hand one over.

    `webkitdirectory` is what makes the picker offer directories, and Chrome's remote file-input
    API silently refuses to populate an input carrying it — no error, no files, no rows, just a
    wait that runs out two minutes later. Dropping the attribute for this one call hands the same
    files over as files. The screen is unchanged: it reads `webkitRelativePath || file.name`, so a
    flat handover simply has no folder to infer a kind from, which is why the manifest states every
    kind rather than correcting a guess.
  */
  await chooser.evaluate((el) => el.removeAttribute("webkitdirectory"));
  console.log(`  handing over ${batch.length} files…`);
  await chooser.uploadFile(...batch.map((d) => d.file));
  await page.waitForFunction((n) => document.querySelectorAll("[data-preview]").length >= n, { timeout: 120_000 }, batch.length);
  console.log(`\n${batch.length} documents read; setting each kind.`);

  // ── Each kind, as the manifest says – never the guess ───────────────────────────────────
  for (const entry of batch) {
    const name = basename(entry.file);
    const set = await page.evaluate(
      (fileName, kind) => {
        const link = [...document.querySelectorAll("[data-preview]")].find((a) => a.textContent?.trim() === fileName);
        const select = link?.closest("li")?.querySelector("select");
        if (!select) return "no row";
        if (![...select.options].some((o) => o.value === kind)) return `no such kind: ${kind}`;
        const native = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
        native.call(select, kind);
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return "ok";
      },
      name,
      entry.kind,
    );
    if (set !== "ok") console.log(`  ${name}: ${set}`);
  }

  const kinds = await page.$$eval("[data-preview]", (links) =>
    links.map((a) => ({ name: a.textContent?.trim() ?? "", kind: a.closest("li")?.querySelector("select")?.value ?? "" })),
  );
  const unset = kinds.filter((k) => !k.kind);
  if (unset.length) throw new Error(`No kind chosen for: ${unset.map((k) => k.name).join(", ")}`);

  // ── File them, and wait for the last one ────────────────────────────────────────────────
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((b) => /^File \d+ documents?$/.test(b.textContent?.trim() ?? ""));
    button?.click();
  });
  // Both waits, in order. Filing sets `busy` on the next render, so asking only whether "Filing…"
  // is absent would be answered "yes" by the frame before it ever starts, and the run would report
  // an empty corpus as a success.
  console.log("  filing – the large ones go to the blob store, so this takes a few minutes…");
  await page.waitForFunction(() => /Filing…/.test(document.body.innerText), { timeout: 60_000 });
  await page.waitForFunction(() => !/Filing…/.test(document.body.innerText), { timeout: 1_800_000 });
  await new Promise((r) => setTimeout(r, 2_000));

  await page.goto(`${BASE}${href}/corpus`, { waitUntil: "networkidle0" });
  const corpus = await page.evaluate(() => document.body.innerText);
  const landed = wanted.filter((d) => corpus.includes(basename(d.file)));
  const lost = wanted.filter((d) => !corpus.includes(basename(d.file)));

  console.log(`\n${landed.length} of ${wanted.length} documents are on the project.`);
  for (const d of landed) console.log(`  filed   ${basename(d.file)}  (${d.kind})`);
  for (const d of lost) console.log(`  MISSING ${basename(d.file)}`);
  console.log(`\n${BASE}${href}/corpus`);
  await browser.close();
  process.exit(lost.length ? 1 : 0);
} catch (error) {
  console.error(`\nStopped: ${error instanceof Error ? error.message : String(error)}`);
  await browser.close();
  process.exit(1);
}
