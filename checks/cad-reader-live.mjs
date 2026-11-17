#!/usr/bin/env node
/**
 * The drawing reader, driven in a visible browser – watch it work, and assert what it shows.
 *
 *     node checks/cad-reader-live.mjs                 (opens a browser window, asks DeepSeek once)
 *     node checks/cad-reader-live.mjs --no-model      (everything but the DeepSeek step – free)
 *     node checks/cad-reader-live.mjs --hold 30       (leave the window open 30 s at the end)
 *     HEADLESS=1 node checks/cad-reader-live.mjs      (no window)
 *
 * ── Why "-live" and outside `npm run check` ────────────────────────────────────────────────
 *
 * The gate never spends money (checks/advisor.mjs says why). This presses Interpret, which asks
 * DeepSeek – a fraction of a cent, but a third party all the same – so it lives beside
 * `check:run-live` and `check:measure-live`, run on purpose. With --no-model it spends nothing.
 *
 * It starts its own viewer (`scripts/cad-viewer.mts`) on a spare port and stops it afterwards,
 * so nothing needs to be running first. Every figure it asserts was worked by hand in
 * `scripts/make-cad-fixture.mts`; the model's labels are asserted only through the schedule the
 * platform computes from them, because the model's words are allowed to vary and the figures are not.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import puppeteer from "puppeteer";

const arg = (name, fallback = null) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};
const NO_MODEL = process.argv.includes("--no-model");
const HOLD = Number(arg("hold", "8")) * 1000;
const HEADLESS = process.env.HEADLESS === "1";
// 0: the viewer takes whatever port is free and says which.
const PORT = Number(arg("port", "0"));
// Outside the repository: screenshots are evidence for whoever ran it, not files to commit.
const SHOTS = arg("shots", path.join(tmpdir(), "qs-cad-reader"));
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
let passes = 0;
const check = (label, ok, detail = "") => {
  if (ok) passes++;
  else failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};
/** `--record demo.mp4`: a captioned video of the run, via ffmpeg (Puppeteer's screencast needs it on PATH). */
const RECORD = arg("record");
if (RECORD && !/\.(mp4|webm)$/i.test(RECORD)) {
  console.error("--record needs a path ending in .mp4 or .webm");
  process.exit(1);
}
const RAW_RECORDING = RECORD ? RECORD.replace(/\.mp4$/i, ".raw.webm") : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * A recording needs the pauses even without a window: a video of a run at full speed shows
 * nothing. And the screencast only receives a frame when the page repaints, so a still screen –
 * a caption being read, the closing card – would be dropped from the video. While recording, a
 * one-pixel ticker in the corner keeps the frames coming.
 */
const pause = async (ms) => {
  if (HEADLESS && !RECORD) return;
  // Every pause comes after the page exists; `page` is read only here, at call time.
  if (!RECORD) return sleep(ms);
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await page
      .evaluate(() => {
        let tick = document.getElementById("demo-tick");
        if (!tick) {
          tick = document.createElement("div");
          tick.id = "demo-tick";
          Object.assign(tick.style, { position: "fixed", right: "0", bottom: "0", width: "1px", height: "1px", zIndex: "10000" });
          document.body.append(tick);
        }
        tick.style.background = tick.style.background === "rgb(255, 255, 255)" ? "rgb(250, 250, 250)" : "rgb(255, 255, 255)";
      })
      .catch(() => {});
    await sleep(100);
  }
};

// ── Start the viewer ─────────────────────────────────────────────────────────────────────────
const viewer = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["tsx", "scripts/cad-viewer.mts"], {
  env: { ...process.env, CAD_VIEWER_PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"],
  shell: process.platform === "win32",
});
viewer.stderr.on("data", (d) => process.stderr.write(`  [viewer] ${d}`));

/**
 * Synchronous on purpose. `npx` on Windows is a shell wrapping node, so killing the child leaves
 * the server running; taskkill /T takes the tree. Run asynchronously, the script exited before
 * taskkill had, and the next run found the port taken.
 */
const stopViewer = () => {
  if (process.platform === "win32" && viewer.pid) spawnSync("taskkill", ["/pid", String(viewer.pid), "/T", "/F"], { stdio: "ignore" });
  else viewer.kill();
};

let actualPort;
try {
  actualPort = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The viewer did not start within 60 s.")), 60_000);
    viewer.stdout.on("data", (d) => {
      const ready = /ready on http:\/\/localhost:(\d+)/.exec(String(d));
      if (!ready) return;
      clearTimeout(timer);
      resolve(Number(ready[1]));
    });
    viewer.on("exit", (code) => reject(new Error(`The viewer exited with ${code} before it was ready.`)));
  });
} catch (e) {
  stopViewer();
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
const BASE = `http://localhost:${actualPort}`;
console.log(`Drawing reader at ${BASE}${HEADLESS ? "" : " — watch the browser window"}\n`);

/**
 * Puppeteer's own Chrome when it has been downloaded, otherwise the Chrome installed on the
 * machine – a version bump empties the download cache, and a check that cannot start says
 * nothing about the thing it checks.
 */
async function launch() {
  const options = { headless: HEADLESS, slowMo: HEADLESS ? 0 : 60, defaultViewport: { width: 1600, height: 1000 }, args: ["--window-size=1600,1080"] };
  try {
    return await puppeteer.launch(options);
  } catch (e) {
    if (!/Could not find Chrome/.test(String(e))) throw e;
    return puppeteer.launch({ ...options, channel: "chrome" });
  }
}

let browser;
try {
  browser = await launch();
} catch (e) {
  stopViewer();
  console.error(`The browser would not start: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
  process.exit(1);
}
const page = await browser.newPage();
page.setDefaultTimeout(90_000);
page.on("pageerror", (e) => check("no script error on the page", false, String(e).slice(0, 160)));

const textOf = (sel) => page.$eval(sel, (e) => e.innerText.replace(/ /g, " "));
const rowText = (testid) => textOf(`[data-testid="${testid}"]`);
const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });

/**
 * Captions, for the recording only: a banner along the bottom saying what is being shown, and
 * a card at the start and end. Injected through DevTools, so the page's CSP is not loosened and
 * the page under test is unchanged when nothing is being recorded.
 */
async function overlay(kind, title, detail = "") {
  if (!RECORD) return;
  await page
    .evaluate(
      (kind, title, detail) => {
        document.getElementById("demo-overlay")?.remove();
        if (kind === "none") return;
        const el = document.createElement("div");
        el.id = "demo-overlay";
        const card = kind === "card";
        Object.assign(el.style, card
          ? { position: "fixed", inset: "0", background: "rgba(20,24,30,0.94)", color: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "14px", zIndex: "9999", font: "500 34px Inter, system-ui, sans-serif", textAlign: "center", padding: "40px" }
          : { position: "fixed", left: "50%", bottom: "28px", transform: "translateX(-50%)", maxWidth: "1100px", background: "rgba(20,24,30,0.92)", color: "#fff", borderLeft: "8px solid #8dc63f", borderRadius: "8px", padding: "14px 22px", zIndex: "9999", font: "600 20px Inter, system-ui, sans-serif", boxShadow: "0 8px 24px rgba(0,0,0,.25)" });
        const head = document.createElement("div");
        head.textContent = title;
        const sub = document.createElement("div");
        sub.textContent = detail;
        Object.assign(sub.style, { font: card ? "400 20px Inter, system-ui, sans-serif" : "400 16px Inter, system-ui, sans-serif", color: "#d8dce3", marginTop: card ? "0" : "4px", whiteSpace: "pre-line" });
        el.append(head, sub);
        document.body.append(el);
      },
      kind,
      title,
      detail,
    )
    .catch(() => {});
}

const step = async (n, title, detail) => {
  console.log(`${n}. ${title}`);
  await overlay("banner", `${n}. ${title}`, detail);
};

let recorder = null;

try {
  await page.goto(BASE, { waitUntil: "networkidle0" });
  if (RECORD) {
    // Recorded as WebM, then converted below: Puppeteer's MP4 is VP9, which Windows' own player,
    // PowerPoint and Teams will not play. H.264 plays everywhere a demo gets sent.
    recorder = await page.screencast({ path: RAW_RECORDING, format: "webm" });
    await overlay("card", "QS Platform · Drawing Reader", "An automated test of the concept-layout reader\nEvery figure checked against an answer worked out by hand");
    await pause(4000);
    await overlay("none");
  }
  await pause(1200);

  await step(1, "Load the sample concept layout", "An ASCII DXF: site, Block A with six units, a clubhouse, a store and a fence.");
  await page.click('[data-testid="load-sample"]');
  await page.waitForSelector('[data-testid="loops"]');
  check("the units are read from the drawing, not assumed", /millimetres\s+stated by the drawing/.test(await rowText("units")));
  check("seven closed outlines are found", (await page.$$('[data-testid="loops"] tbody tr')).length === 7);
  check("the drawing is rendered", (await page.$('[data-testid="canvas"] svg')) !== null);
  await shot("1-loaded");
  await pause(2000);

  await step(2, "Pick each outline – see exactly what it was measured from", "Areas are computed from the geometry, never typed. The green outline is the evidence.");
  const expected = [
    ["L1", "A-SITE", /2 400,00/],
    ["L2", "A-FOOTPRINT", /351,00/],
    ["L3", "A-CLUB", /96,00\s+84,00/],
    ["L5", "A-WALL", /26,28/],
  ];
  for (const [id, layer, area] of expected) {
    await page.click(`[data-testid="loop-${id}"]`);
    await page.waitForFunction((label) => document.querySelector("#picked")?.textContent?.includes(label), {}, id);
    const row = await rowText(`loop-${id}`);
    check(`${id} on ${layer} measures as worked by hand`, row.includes(layer) && area.test(row), row.replace(/\s+/g, " "));
    check(`${id} is picked out on the drawing`, (await page.$$eval('[data-testid="canvas"] path[stroke="#4a7722"]', (p) => p.length)) > 0);
    await shot(`2-${id}`);
    await pause(1600);
  }
  check("the store's loose walls and bay were joined, and say so", (await rowText("loop-L5")).includes("joined lines"));

  await step(3, "Printed areas, checked against the geometry", "Unit B is labelled 65,0 m² but measures 67,5 m² – the reader catches it.");
  const checks = await textOf('[data-testid="checks"]');
  // Count the badges, not the word: "disagrees" contains "agrees".
  check("five printed areas agree", (await page.$$('[data-testid="checks"] .badge.ok')).length === 5);
  check("Unit B's printed 65,0 m² is caught – it measures 67,5", /UNIT B[\s\S]*65,00\s+67,50\s+disagrees/.test(checks));
  const wrongRow = await page.$$eval('[data-testid="checks"] tbody tr', (rows) => rows.findIndex((r) => r.innerText.includes("disagrees")));
  await page.click(`[data-testid="check-${wrongRow}"]`);
  await page.evaluate(() => document.querySelector('[data-testid="checks"]').scrollIntoView({ block: "center" }));
  await shot("3-disagreement");
  await pause(2200);

  await step(4, "Blocks – a unit drawn once, inserted many times", "Unit A × 4 and Unit B × 2, counted from the inserts, each with its footprint.");
  check("Unit A: 4 inserts of 54 m²", /UNIT-A\s+4\s+54,00\s+216,00/.test(await rowText("block-UNIT-A")));
  check("Unit B: 2 inserts of 67,5 m²", /UNIT-B\s+2\s+67,50\s+135,00/.test(await rowText("block-UNIT-B")));
  await page.click('[data-testid="block-UNIT-A"]');
  await page.evaluate(() => document.querySelector('[data-testid="blocks"]').scrollIntoView({ block: "center" }));
  await shot("4-unit-a");
  await pause(1800);

  await step(5, "What was not measured is said, not hidden", "The hatch is counted as not read; the fence is open by 2 m, so it has no area.");
  await page.evaluate(() => document.querySelector('[data-testid="not-measured"]').scrollIntoView({ block: "center" }));
  await pause(2400);
  const notMeasured = await rowText("not-measured");
  check("the hatch is counted as not read", /1 × HATCH/.test(notMeasured));
  check("the open fence is reported with its 2 m gap", /A-FENCE[\s\S]*gap 2,00 m/.test(notMeasured));

  if (NO_MODEL) {
    console.log("6. DeepSeek – skipped (--no-model)");
  } else {
    await step(6, "DeepSeek labels the parts – the platform computes every figure", "The model says which outline is the site and which blocks are units. It states no number.");
    await page.evaluate(() => document.querySelector('[data-testid="interpret"]').scrollIntoView({ block: "center" }));
    await page.click('[data-testid="interpret"]');
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="interpretation"]');
      return el && (el.querySelector('[data-testid="schedule"]') || el.querySelector(".error"));
    });
    const err = await page.$('[data-testid="interpretation"] .error');
    if (err) {
      check("DeepSeek answered", false, await page.$eval('[data-testid="interpretation"] .error', (e) => e.innerText));
    } else {
      const schedule = await textOf('[data-testid="schedule"]');
      check("site area is the measured 2 400 m²", /Site area[\s\S]*2 400,00 m²/.test(schedule), "depends on the model labelling L1 the site");
      check("building footprint is the measured 351 m²", /Building footprint[\s\S]*351,00 m²/.test(schedule));
      check("coverage is computed: 351 ÷ 2 400 = 14,6%", /14,6%/.test(schedule));
      check("six units, from block inserts", /Units[\s\S]*\b6\b/.test(schedule));
      const scheduleChecks = await textOf('[data-testid="schedule-checks"]');
      check("units are cross-checked against the footprint", /Units against footprint/.test(scheduleChecks));
      const labels = await textOf('[data-testid="labels"]');
      check("no figure appears in the model's own words", !/\d/.test(labels.replace(/\bL\d+\b/g, "").replace(/UNIT-?[AB]/g, "")), labels.replace(/\s+/g, " ").slice(0, 200));
      console.log(`     ${(await textOf('[data-testid="interpretation"] p.muted:last-child')).trim()}`);
    }
    await page.evaluate(() => document.querySelector('[data-testid="interpretation"]').scrollIntoView({ block: "start" }));
    await shot("6-interpretation");
    await pause(3500);
    // Down to the model's own words and what was refused, so the video shows the checks too.
    await page.evaluate(() => document.querySelector('[data-testid="labels"]')?.scrollIntoView({ block: "center" }));
    await overlay("banner", "6. What the model said each part is", "Ids it never measured are refused; any figure in its words is removed.");
    await pause(3500);
  }

  if (RECORD) {
    await overlay("card", failures === 0 ? `All ${passes} checks passed` : `${failures} of ${passes + failures} checks failed`, "Concept layout read from DXF · areas checked against hand-worked figures\nDeepSeek labels the parts; the platform computes and cross-checks every figure");
    await pause(4500);
  }
  await pause(HOLD);
} catch (e) {
  check("the walk-through completed", false, e instanceof Error ? e.message : String(e));
  await shot("failure").catch(() => {});
} finally {
  if (recorder) {
    await pause(1200); // frames for the closing card before the encoder is closed
    await recorder.stop().catch((e) => console.error(`The recording could not be finished: ${e instanceof Error ? e.message : e}`));
  }
  await browser.close();
  stopViewer();
}

if (RECORD && existsSync(RAW_RECORDING)) {
  if (RAW_RECORDING === RECORD) {
    console.log(`Recording: ${RECORD}`);
  } else {
    const ffmpeg = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", RAW_RECORDING, "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", RECORD], { stdio: "inherit" });
    if (ffmpeg.status === 0) {
      unlinkSync(RAW_RECORDING);
      console.log(`Recording: ${RECORD}`);
    } else {
      console.error(`ffmpeg could not convert the recording; the WebM is kept at ${RAW_RECORDING}`);
    }
  }
}

console.log(`\nScreenshots in ${SHOTS}`);
console.log(failures === 0 ? "All checks passed." : `${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
