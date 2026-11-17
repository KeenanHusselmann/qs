#!/usr/bin/env node
/**
 * Measure a project's filed drawings into its bill — D1.2.
 *
 *     node scripts/measure-drawings.mjs --manifest <manifest.json> [--base https://…] [--ask]
 *     node scripts/measure-drawings.mjs --manifest … --show     (watch it work)
 *
 * ── Why this exists beside the live check ──────────────────────────────────────────────────
 *
 * `checks/measure-drawings-live.mjs` creates a throwaway project, files one drawing into it and
 * asserts what comes back. That is the right shape for a check and the wrong one entirely for a
 * real project: it would leave a second Marshall Dam on the list, measured off one sheet, beside
 * the real one measured off twenty documents.
 *
 * This measures the project the manifest names, from the drawings already in its corpus, and
 * reports what came back rather than asserting it. What it finds is a quantity surveyor's to
 * judge — this is a way of pressing the button from a terminal, not a second opinion.
 *
 * ── It spends money ────────────────────────────────────────────────────────────────────────
 *
 * A drawing set is the longest read this platform makes, and on production it spends the
 * production key. Nothing here retries on its own: a measurement that failed half way is a
 * decision about whether to pay for it twice, and that belongs to whoever is watching.
 */

import { readFileSync } from "node:fs";

import puppeteer from "puppeteer";

import { identityFor, signInOrExplain } from "./lib/sign-in.mjs";

const arg = (name, fallback = null) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};

const BASE = arg("base", "http://localhost:3000").replace(/\/$/, "");
const ASK = process.argv.includes("--ask");
const SHOW = process.argv.includes("--show");
const manifestPath = arg("manifest");
if (!manifestPath) {
  console.error("Which project? Pass --manifest <file.json>.");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const identity = await identityFor(BASE, { ask: ASK });

const browser = await puppeteer.launch({ headless: !SHOW && process.env.HEADLESS !== "0", defaultViewport: { width: 1500, height: 1200 } });
const page = await browser.newPage();
page.setDefaultTimeout(180_000);
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 160)));

const text = (selector) => page.$eval(selector, (e) => e.innerText.replace(/ /g, " "));

try {
  await signInOrExplain(page, identity, BASE);

  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
  const href = await page.evaluate((name) => {
    const link = [...document.querySelectorAll('a[href^="/projects/"]')].find((a) => a.textContent?.includes(name));
    const found = link?.getAttribute("href") ?? "";
    return /^\/projects\/[0-9a-f-]{36}$/.test(found) ? found : "";
  }, manifest.project.name);
  if (!href) throw new Error(`No project called "${manifest.project.name}" on ${BASE}.`);

  console.log(`\n${BASE}${href}/bill`);
  await page.goto(`${BASE}${href}/bill`, { waitUntil: "networkidle0" });

  const offered = await page.$('[data-action="measure-drawings"]');
  if (!offered) {
    throw new Error("The bill does not offer to measure. Are there drawings filed on this project?");
  }

  /*
    Which sheets, where the caller named some.

    A reply has a length limit and a whole corpus runs past it, so a real project is measured
    element by element off the sheets that show that element. `--sheets` takes a comma-separated
    fragment of each filename, because a document id is not something anybody has to hand.
  */
  const sheets = arg("sheets");
  if (sheets) {
    const wanted = sheets.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    const picked = await page.evaluate((fragments) => {
      const boxes = [...document.querySelectorAll("[data-sheet]")];
      const names = boxes.map((b) => ({ box: b, name: b.closest("label")?.textContent?.trim() ?? "" }));
      for (const { box, name } of names) {
        const want = fragments.some((f) => name.toLowerCase().includes(f));
        if (box.checked !== want) box.click();
      }
      return names.filter(({ name }) => fragments.some((f) => name.toLowerCase().includes(f))).map(({ name }) => name);
    }, wanted);

    if (picked.length === 0) throw new Error(`No filed drawing matches ${wanted.join(", ")}.`);
    console.log(`  measuring only: ${picked.join("; ")}`);
  }

  console.log(`  ${await text('[data-region="measure-drawings"] p')}`);

  console.log("\n  measuring – a drawing set is the longest read this platform makes, so this runs for minutes…");
  const started = Date.now();
  await page.click('[data-action="measure-drawings"]');

  // Either an outcome or a refusal. Both are answers; only a hang is not.
  await page.waitForSelector('[data-region="measure-outcome"], [data-region="measure-drawings"] [role="alert"]', { timeout: 900_000 });

  const refused = await page.$('[data-region="measure-drawings"] [role="alert"]');
  if (refused) {
    console.log(`\n  refused after ${((Date.now() - started) / 1000).toFixed(0)}s: ${await text('[data-region="measure-drawings"] [role="alert"]')}`);
    await browser.close();
    process.exit(1);
  }

  console.log(`\n  measured in ${((Date.now() - started) / 1000).toFixed(0)}s\n`);
  console.log(await text('[data-region="measure-outcome"]'));

  /*
    What the drawings require and the measurement could not reach.

    Printed beside the total rather than left on the page, because an omission nobody is told
    about is the expensive kind: a bill missing its reinforcement adds up perfectly.
  */
  const gaps = await page.$('[data-region="measure-gaps"]');
  if (gaps) console.log(`\n${await text('[data-region="measure-gaps"]')}`);

  console.log(`\n${BASE}${href}/take-off  — the sheets and their working`);
  console.log(`${BASE}${href}/bill       — the rows it sent`);
  await browser.close();
} catch (error) {
  console.error(`\nStopped: ${error instanceof Error ? error.message : String(error)}`);
  await browser.close();
  process.exit(1);
}
