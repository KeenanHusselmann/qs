/**
 * Opening a document before deciding what it is.
 *
 * The files a folder import cannot classify are exactly the ones whose names say nothing:
 * `Sheet-Project Site.pdf`, a bare drawing number. Asking a QS to choose a kind for a document they
 * cannot see is asking them to guess, and a guess filed as a kind satisfies a criterion with the
 * wrong document (§1.3).
 *
 * Nothing has been uploaded at this point, so the link cannot point at the platform. It points at
 * the browser's own copy of the file — which is the part worth asserting, because a link that
 * renders but opens nothing looks identical on screen.
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
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

// The contents are the assertion: opening the link must yield exactly this.
const CONTENTS = `STORMWATER LAYOUT SHEET ${Date.now()}\nThis is what the drawing actually says.`;
writeFileSync(`${TMP}/2500041-CT-001-A1-revE.txt`, CONTENTS);

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));

await signIn(page, env);
await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
const { href } = await createProject(page, "Preview " + Date.now());

await page.goto(`${BASE}${href}/corpus`, { waitUntil: "networkidle0" });

// A name with nothing in it to classify — the case this exists for.
await page.evaluate((body) => {
  const input = document.querySelector('input[type="file"]');
  const transfer = new DataTransfer();
  transfer.items.add(new File([body], "2500041-CT-001-A1-revE.txt", { type: "text/plain" }));
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}, CONTENTS);

await page.waitForFunction(`document.body.innerText.includes("2500041-CT-001-A1-revE.txt")`, { timeout: 20000 });

const link = await page.$$eval("main a[data-preview]", (as) =>
  as.map((a) => ({ href: a.getAttribute("href"), text: a.textContent.trim(), target: a.target })),
);

check("the queued file's name is a link", link.length === 1, `${link.length} found`);
check("labelled with the filename", link[0]?.text === "2500041-CT-001-A1-revE.txt", link[0]?.text ?? "none");
check("opening in a new tab, so the queue is not lost", link[0]?.target === "_blank");
check(
  "pointing at the browser's own copy, since nothing is uploaded yet",
  link[0]?.href.startsWith("blob:"),
  link[0]?.href.slice(0, 40) ?? "none",
);

// The part that matters: it opens, and it is the document.
const opened = await page.evaluate(async (url) => {
  const response = await fetch(url);
  return { ok: response.ok, body: await response.text() };
}, link[0].href);

check("the link resolves to the file", opened.ok);
check("and it is the document itself", opened.body === CONTENTS, `${opened.body.length} of ${CONTENTS.length} bytes`);

// It is still unclassified — the link is what lets a person decide, not a substitute for deciding.
const unplaced = await page.$eval("main", (e) => e.innerText);
check("the row still asks for a kind", /Choose a kind/.test(unplaced));

// Removing the row releases the handle rather than leaking it.
await page.$$eval("main button", (bs) => bs.find((b) => /^Remove /.test(b.getAttribute("aria-label") ?? ""))?.click());
await page.waitForFunction(() => !document.querySelector("main a[data-preview]"), { timeout: 10000 });
const afterRemoval = await page.evaluate(async (url) => {
  try {
    const r = await fetch(url);
    return r.ok ? "still resolves" : "revoked";
  } catch {
    return "revoked";
  }
}, link[0].href);
check("removing the row releases the file handle", afterRemoval === "revoked", afterRemoval);

await browser.close();
console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} failed.`);
process.exit(fails ? 1 : 0);
