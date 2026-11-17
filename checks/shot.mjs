/**
 * Screenshot a page, signed in — for looking at what was built rather than asserting about it.
 *
 * Not a check: it asserts nothing and is never counted in the gate. It exists because a chart is
 * the one thing a passing test cannot verify — label collisions, a legend running off its panel
 * and a donut with two indistinguishable slices all pass every assertion I could write.
 *
 *   node checks/shot.mjs /            main.png
 *   node checks/shot.mjs /home        dashboard.png  1440
 */

import puppeteer from "puppeteer";

import { readEnv, signIn } from "./helpers.mjs";

const [, , path = "/", out = "shot.png", width = "1440", tall = "2600"] = process.argv;

const browser = await puppeteer.launch({ headless: "new" });
const page = await browser.newPage();

/*
  A tall viewport rather than `fullPage`.

  The shell makes `<main>` the only scroller (see checks/viewport.mjs), so the document itself
  never overflows and a full-page capture returns exactly the viewport. Growing the viewport is
  what actually reveals the page.
*/
await page.setViewport({ width: Number(width), height: Number(tall), deviceScaleFactor: 1 });
await signIn(page, readEnv());
await page.goto(`http://localhost:3000${path}`, { waitUntil: "networkidle0" });

// ApexCharts mounts on the client after hydration, so a screenshot taken at networkidle can
// catch the skeleton. Wait for a drawn series, and fall back rather than hang on a page with
// no chart on it.
await page
  .waitForSelector(".apexcharts-canvas", { timeout: 8000 })
  .then(() => new Promise((r) => setTimeout(r, 700)))
  .catch(() => {});

await page.screenshot({ path: out });
console.log(`${path} → ${out}`);

await browser.close();
