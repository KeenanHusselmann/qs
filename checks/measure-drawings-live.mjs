/**
 * Measuring a detailed design into a priced bill – against the real model. **Not in `npm run check`**:
 * it spends credits, and it needs a drawing set on disk.
 *
 *     node checks/measure-drawings-live.mjs "<drawings.pdf>" ["<render.png>"]
 *     HEADLESS=0 node checks/measure-drawings-live.mjs …     (watch it in a visible window)
 *
 * The journey a QS makes with nothing but the designs: a project started at Design & Documentation,
 * the drawings filed, measured, the figures and working checked in Take-off, the bill priced from
 * the Rate Library, and the bill issued – and the issued PDF read back to show it carries
 * quantities, rates and a total that is not nought.
 */

import fs from "node:fs";
import { inflateSync } from "node:zlib";

import puppeteer from "puppeteer";

import { createProject, readEnv, signIn } from "./helpers.mjs";

const env = readEnv();
const BASE = "http://localhost:3000";
const [, , PDF, PNG] = process.argv;
if (!PDF || !fs.existsSync(PDF)) {
  console.log("Give the path of a drawing set (PDF) as the first argument.");
  process.exit(2);
}
const OUT = process.env.OUT ?? null;
const headless = process.env.HEADLESS !== "0";

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};
const pause = (ms) => new Promise((r) => setTimeout(r, headless ? Math.min(ms, 200) : ms));

const browser = await puppeteer.launch(headless ? { headless: true } : { headless: false, defaultViewport: null, args: ["--window-size=1440,960", "--window-position=40,20"] });
const page = await browser.newPage();
if (headless) await page.setViewport({ width: 1440, height: 1000 });
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));
let shot = 0;
const snap = async (name) => {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/${String(++shot).padStart(2, "0")}-${name}.png` });
};
/** A caption across the foot of the screen, so a recording explains itself. */
const caption = (step, text) =>
  page.evaluate(
    (step, text) => {
      let el = document.getElementById("__demo");
      if (!el) {
        el = document.createElement("div");
        el.id = "__demo";
        el.style.cssText = "position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483647;background:rgba(17,32,52,.94);color:#fff;font:600 17px/1.4 system-ui,sans-serif;padding:12px 18px;border-radius:10px;pointer-events:none";
        document.body.appendChild(el);
      }
      el.innerHTML = `<span style="color:#9fd36a;margin-right:10px">${step}</span>${text}`;
    },
    step,
    text,
  );
const go = (path) => page.goto(BASE + path, { waitUntil: "networkidle0" });
const text = (s) => page.$eval(s, (e) => e.innerText.replace(/ /g, " "));
async function upload(kind, file) {
  for (const r of await page.$$('[data-region="readiness"] li')) {
    if ((await r.evaluate((e) => e.innerText)).startsWith(kind + "\n")) {
      await r.evaluate((e) => e.scrollIntoView({ block: "center" }));
      await (await r.$("input[type=file]")).uploadFile(file);
      return;
    }
  }
  throw new Error("No upload row for " + kind);
}
function pdfText(bytes) {
  const raw = Buffer.from(bytes);
  const out = [];
  let at = 0;
  for (;;) {
    const start = raw.indexOf("stream\n", at);
    if (start < 0) break;
    const end = raw.indexOf("\nendstream", start);
    try {
      const body = inflateSync(raw.subarray(start + 7, end)).toString("latin1");
      for (const m of body.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)) out.push(m[1]);
    } catch {
      // not deflated
    }
    at = end + 10;
  }
  return out.join("\n").replace(/\xa0/g, " ");
}

try {
  await signIn(page, env);
  await go("/projects");
  /*
    Named with an epoch, like every other suite, so `clean-test-projects.mjs` can find it.

    It used to carry a readable clock time, which read better and was never cleaned up: the
    cleaner matches a 13-digit epoch and nothing else, deliberately, so a project named with a
    clock simply accumulated. Two of them were still on the list a week later, one of them called
    "Marshall Dam" beside a real client project of nearly the same name.
  */
  const name = "Marshall Dam Boundary Wall – measured " + Date.now();
  const { href } = await createProject(page, name, BASE, 2);

  // ── File the designs, and nothing else ────────────────────────────────────────────────────
  await go(`${href}/bill`);
  await caption("1", "A new project at Design & Documentation – file the drawings, and nothing else");
  // Wait for the file in the filed list – the project's own name shares its first words.
  const filed = (n) => page.waitForFunction((n) => document.querySelector('[data-region="readiness"]')?.innerText.includes(n), { timeout: 180000 }, n);
  await upload("Working drawings", PDF);
  await filed(PDF.split(/[\\/]/).pop());
  if (PNG) {
    await go(`${href}/bill`);
    await upload("Concept drawings", PNG);
    await filed(PNG.split(/[\\/]/).pop().slice(0, 40));
  }
  await go(`${href}/bill`);
  check("the bill offers to measure the filed drawings", Boolean(await page.$('[data-action="measure-drawings"]')));
  await page.$eval('[data-region="measure-drawings"]', (e) => e.scrollIntoView({ block: "center" }));
  await caption("2", "Drawings are measured, not read – press Measure the drawings");
  await pause(2500);
  await snap("measure-offered");

  // ── Measure ───────────────────────────────────────────────────────────────────────────────
  const started = Date.now();
  await page.click('[data-action="measure-drawings"]');
  await caption("2", "The agent reads the dimensions, sections and notes; the platform checks every figure and does the arithmetic…");
  await page.waitForSelector('[data-region="measure-outcome"], [data-region="measure-drawings"] [role="alert"]', { timeout: 420000 });
  const seconds = Math.round((Date.now() - started) / 1000);
  const alert = await page.$('[data-region="measure-drawings"] [role="alert"]');
  check("the drawings were measured", !alert, alert ? await alert.evaluate((e) => e.innerText) : `${seconds}s`);
  const outcome = alert ? "" : await text('[data-region="measure-outcome"]');
  console.log("\n  " + outcome.split("\n")[0] + "\n");
  const items = Number(/(\d+) items measured/.exec(outcome)?.[1] ?? 0);
  check("it measured the elements of the wall", items >= 10, `${items} items`);
  await page.waitForSelector('[data-region="bill"]', { timeout: 30000 });
  await page.$eval('[data-region="measure-drawings"]', (e) => e.scrollIntoView({ block: "start" }));
  await caption("3", `${items} items measured, each traced to the drawing or stated as an assumption – and in the bill with quantities`);
  await pause(3500);
  await snap("measured");

  const quantities = await page.$$eval('[data-region="bill"] tbody tr', (rows) => rows.map((r) => r.innerText.replace(/\s+/g, " ")).filter((t) => /\d/.test(t)).length);
  check("the bill carries the measured quantities", quantities >= 10, `${quantities} rows with figures`);
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollBy(0, 650));
    await pause(1500);
    await snap(`bill-rows-${i + 1}`);
  }

  // ── The working, in Take-off ──────────────────────────────────────────────────────────────
  await go(`${href}/take-off`);
  await page.$eval('[data-region="takeoff-figures"]', (e) => ((e.open = true), e.scrollIntoView({ block: "start" })));
  await caption("4", "Take-off – what the measurement rests on: figures read from the drawings (with the quote), worked out, or assumed");
  await pause(3500);
  await snap("figures");
  const figures = await page.$$eval("[data-figure]", (rows) => rows.map((r) => r.getAttribute("data-status")));
  check("every figure says how it is known", figures.length > 5 && figures.every((s) => ["read", "derived", "assumed"].includes(s)), `${figures.filter((s) => s === "read").length} read, ${figures.filter((s) => s === "derived").length} worked out, ${figures.filter((s) => s === "assumed").length} assumed`);
  await page.$eval("[data-takeoff]", (e) => e.scrollIntoView({ block: "start" }));
  await caption("4", "Each dimension sheet shows its working – the platform's arithmetic, not the model's");
  await pause(3000);
  await snap("sheets");
  check("the sheets show their working", (await page.$$('[data-region="line-working"]')).length >= items);

  // ── Rates ─────────────────────────────────────────────────────────────────────────────────
  await go("/rates");
  const load = (await page.$('[data-action="load-simulated-new"]')) ?? (await page.$('[data-action="load-simulated"]'));
  if (load) {
    await caption("5", "Rate Library – load the simulated test rates (labelled as test data, not supplier quotes)");
    await pause(1500);
    await load.click();
    await page.waitForFunction(() => /loaded/.test(document.querySelector('[data-region="simulated-rates"] [role="status"]')?.innerText ?? ""), { timeout: 20000 });
    await pause(1500);
    await snap("rates-loaded");
  }

  await go(`${href}/pricing`);
  await page.waitForSelector("button", { timeout: 10000 });
  const takeAll = await page.$('[data-action="take-all"]');
  const certain = await page.$$eval("button", (bs) => bs.find((b) => /^Price \d+ certain/.test(b.innerText))?.innerText ?? null);
  await caption("6", "Pricing – the Rate Library offers a rate for each measured item; take them");
  if (takeAll) await takeAll.evaluate((e) => e.scrollIntoView({ block: "center" }));
  await pause(2500);
  await snap("offers");
  if (certain) {
    await page.$$eval("button", (bs) => bs.find((b) => /^Price \d+ certain/.test(b.innerText))?.click());
    await page.waitForNetworkIdle();
  }
  for (let i = 0; i < 3; i++) {
    const again = await page.$('[data-action="take-all"]');
    if (!again) break;
    await again.click();
    await page.waitForNetworkIdle();
    await pause(1200);
  }
  await go(`${href}/bill`);
  const total = await text('[data-region="bill-total"]').catch(() => "");
  await page.$eval('[data-region="bill-total"]', (e) => e.scrollIntoView({ block: "center" })).catch(() => {});
  await caption("7", `The bill, measured and priced: ${total}`);
  await pause(3500);
  await snap("priced-total");
  check("the bill has a total that is not nought", /\d/.test(total) && !/^R?\s*0,00$/.test(total.trim()), total);

  // ── Issue it, and read the PDF back ───────────────────────────────────────────────────────
  await go(`${href}/report`);
  await page.$$eval("button", (bs) => bs.find((b) => /issue the bill/i.test(b.innerText))?.click());
  await page.waitForSelector('[role="status"]', { timeout: 60000 });
  await page.waitForFunction(() => [...document.querySelectorAll("a")].some((x) => /As issued/.test(x.innerText)), { timeout: 30000 });
  await caption("8", "Reports – the bill is issued as a PDF and kept on the register");
  await pause(2500);
  await snap("issued");
  const bytes = await page.evaluate(async () => {
    const a = [...document.querySelectorAll("a")].find((x) => /As issued/.test(x.innerText));
    return [...new Uint8Array(await (await fetch(a.getAttribute("href"))).arrayBuffer())];
  });
  const pdf = pdfText(bytes);
  const amounts = (pdf.match(/\d[\d ]*,\d\d/g) ?? []).filter((m) => !/^0,00$/.test(m));
  check("the issued bill carries rates and amounts", amounts.length >= 20, `${amounts.length} money figures`);
  // ── The elemental cost plan, revised from the bill ─────────────────────────────────────────
  await go(`${href}/cost-plan`);
  await page.waitForSelector('[data-region="elemental-plan"]', { timeout: 20000 });
  await page.$eval('[data-region="elemental-plan"]', (e) => e.scrollIntoView({ block: "start" }));
  await caption("9", "Cost Plan – the elemental cost plan, revised from the measured bill: each item in its element");
  await pause(3500);
  await snap("elemental-plan");
  const elements = await page.$$eval("[data-element]", (r) => r.map((e) => e.getAttribute("data-element")));
  check("the bill feeds an elemental cost plan", elements.includes("substructure") && elements.includes("superstructure") && elements.includes("finishes"), elements.join(", "));
  const net = await text('[data-region="plan-net"]');
  check("its measured work is the bill total", net.replace(/[^\d,]/g, "") === total.replace(/[^\d,]/g, ""), `${net} against ${total}`);
  await page.$eval('[data-region="plan-allowances"] input[name="measureLabel"]', (el) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "m of boundary wall"); el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.$eval('[data-region="plan-allowances"] input[name="measureValue"]', (el) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "491,05"); el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.$eval('[data-region="plan-allowances"]', (e) => e.scrollIntoView({ block: "center" }));
  await caption("9", "Allowances and the plan's measure – 491,05 m of boundary wall");
  await pause(2500);
  await page.click('[data-action="save-allowances"]');
  await page.waitForFunction(() => /per m of boundary wall/.test(document.querySelector('[data-region="plan-totals"]')?.innerText ?? ""), { timeout: 15000 });
  await page.$eval('[data-region="plan-totals"]', (e) => e.scrollIntoView({ block: "center" }));
  const planTotals = (await text('[data-region="plan-totals"]')).replace(/\s+/g, " ");
  await caption("9", "Measured work, total excluding and including VAT – and the cost per metre of wall");
  await pause(3500);
  await snap("elemental-totals");
  console.log(`\n  ${planTotals}\n`);
  await page.click('[data-action="issue-elemental-plan"]');
  await page.waitForSelector('[data-action="download-elemental-plan"]', { timeout: 30000 });
  const planBytes = await page.evaluate(async () => [...new Uint8Array(await (await fetch(document.querySelector('[data-action="download-elemental-plan"]').getAttribute("href"))).arrayBuffer())]);
  const planPdf = pdfText(planBytes);
  check("the elemental cost plan is issued with its elements and totals", /Elemental Cost Plan/.test(planPdf) && /Substructure/.test(planPdf) && /Total including VAT/.test(planPdf));

  if (OUT) {
    fs.writeFileSync(`${OUT}/Elemental Cost Plan – from the measured bill (as issued).pdf`, Buffer.from(planBytes));
    const saved = `${OUT}/Bill of Quantities – measured from the drawings (as issued).pdf`;
    fs.writeFileSync(saved, Buffer.from(bytes));
    if (!headless) {
      await page.goto("file:///" + saved.replace(/\\/g, "/").replace(/ /g, "%20"), { waitUntil: "load" });
      await pause(3000);
      await snap("pdf");
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press("PageDown");
        await pause(1800);
        await snap(`pdf-${i + 1}`);
      }
      await page.goto("file:///" + `${OUT}/Elemental Cost Plan – from the measured bill (as issued).pdf`.replace(/\\/g, "/").replace(/ /g, "%20"), { waitUntil: "load" });
      await pause(4000);
      await snap("plan-pdf");
    }
  }
  console.log(`\n  project: ${BASE}${href}`);
} finally {
  await browser.close();
}

console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} failed.`);
process.exit(fails ? 1 : 0);
