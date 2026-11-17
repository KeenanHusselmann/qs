/**
 * The elemental cost plan, revised from the bill – D1.1 Cost Plan Revision.
 *
 *     node checks/elemental-plan.mjs
 *
 * A draft bill is seeded – three elements' worth of priced items, one unpriced, one element given by
 * the measuring agent – and the rest is driven through the Cost Plan page: the element totals and
 * the build-up to the total including VAT, the typical allowances said to be typical, setting them,
 * a per-metre figure from the plan's measure, moving an item to another element, and issuing the
 * plan and reading the PDF back.
 */

import { inflateSync } from "node:zlib";

import { config } from "dotenv";
import postgres from "postgres";
import puppeteer from "puppeteer";

import { createProject, readEnv, signIn, watchConsole } from "./helpers.mjs";

config({ path: ".env.local", quiet: true });
const env = readEnv();
const BASE = "http://localhost:3000";

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const sql = postgres(env.DATABASE_URL, { max: 1 });
const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1200 });
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));
const consoleErrors = watchConsole(page);
const text = (s) => page.$eval(s, (e) => e.innerText.replace(/ /g, " "));
const setValue = (selector, value) =>
  page.$eval(
    selector,
    (el, v) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    value,
  );

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
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
  const { href } = await createProject(page, "Elemental plan " + Date.now(), BASE, 2);
  const projectId = href.split("/").pop();

  await page.goto(`${BASE}${href}/cost-plan`, { waitUntil: "networkidle0" });
  check("without a bill there is no plan from it", !(await page.$('[data-region="elemental-plan"]')));
  check("and the step is off stage for a project started at design", Boolean(await page.$('[data-region="off-stage"]')));

  // A draft bill: a heading and priced items in three elements, one unpriced.
  const [run] = await sql`insert into runs (project_id, module, status, input_tokens, output_tokens, created_by) values (${projectId}, '/bill', 'review', 0, 0, ${env.DEV_USER_EMAIL}) returning id`;
  const [heading] = await sql`insert into run_items (run_id, seq, row_type, override_description, override_by, override_at, quantity_source) values (${run.id}, 100, 'heading', 'Boundary wall', ${env.DEV_USER_EMAIL}, now(), 'takeoff') returning id`;
  const ids = {};
  for (const [seq, desc, unit, qty, rate] of [
    [200, "Excavate trench for strip footing", "m3", "203.2900", 18500n],
    [300, "Concrete strip footing", "m3", "67.7600", 245000n],
    [400, "One-brick walling in superstructure", "m2", "1017.1200", 69000n],
    [500, "Cement plaster to both faces of walling", "m2", "2034.2400", 16500n],
    [600, "Precast concrete coping", "m", "491.0500", null],
  ]) {
    const [r] = await sql`insert into run_items (run_id, seq, parent_id, row_type, override_description, override_unit, override_quantity, override_rate, override_rate_precision, override_by, override_at, quantity_source)
      values (${run.id}, ${seq}, ${heading.id}, 'item', ${desc}, ${unit}, ${qty}, ${rate}, ${rate === null ? null : 2}, ${env.DEV_USER_EMAIL}, now(), 'takeoff') returning id`;
    ids[desc] = r.id;
  }
  // The agent measured the coping as superstructure; the rest are grouped by their words.
  await sql`insert into bill_elements (run_item_id, element, set_by) values (${ids["Precast concrete coping"]}, 'superstructure', 'agent')`;

  // 203,29 × 185 = 37 608,65 · 67,76 × 2 450 = 166 012,00 · 1 017,12 × 690 = 701 812,80 · 2 034,24 × 165 = 335 649,60
  await page.goto(`${BASE}${href}/cost-plan`, { waitUntil: "networkidle0" });
  check("the cost plan is built from the bill", Boolean(await page.$('[data-region="elemental-plan"]')));
  check("and says it is from a draft", /draft bill/.test(await text('[data-region="plan-source"]')));
  check("the off-stage notice gives way to the plan", !(await page.$('[data-region="off-stage"]')));
  check("and the document-reading run folds away beneath it", Boolean(await page.$('[data-region="folded-run"]')));
  const rows = await page.$$eval("[data-element]", (r) => r.map((e) => [e.getAttribute("data-element"), e.innerText.replace(/ /g, " ").replace(/\s+/g, " ")]));
  const el = Object.fromEntries(rows);
  check("substructure is the excavation and the footing", /R 203 620,65/.test(el.substructure ?? ""), el.substructure);
  check("superstructure is the walling, with the unpriced coping counted", /R 701 812,80/.test(el.superstructure ?? "") && /1 unpriced/.test(el.superstructure ?? ""), el.superstructure);
  check("finishes is the plaster", /R 335 649,60/.test(el.finishes ?? ""), el.finishes);
  check("the measured work is their sum", /R 1 241 083,05/.test(await text('[data-region="plan-net"]')));
  check("the typical allowances are said to be typical", Boolean(await page.$('[data-region="plan-typical"]')));
  // 12% P&G 148 929,97 · 5% contingency 69 500,65 · excl 1 459 513,67 · VAT 218 927,05 · incl 1 678 440,72
  check("the total excluding VAT builds up from them", /R 1 459 513,67/.test(await text('[data-region="plan-excl"]')), await text('[data-region="plan-excl"]'));
  check("and the total including VAT", /R 1 678 440,72/.test(await text('[data-region="plan-incl"]')));
  check("an unpriced item is said, not taken as nought", /1 item is not priced/.test(await text('[data-region="elemental-plan"]')));

  // ── Element quantities and rates ───────────────────────────────────────────────────────
  const euq = async (id) => (await text(`[data-euq="${id}"]`)).replace(/\s+/g, " ");
  const eur = async (id) => (await text(`[data-eur="${id}"]`)).replace(/\s+/g, " ");
  // Substructure: the footing carries most of its cost – 203 620,65 over 67,76 m³ = 3 005,03
  check("substructure's quantity is its footing, in m³", /67,76 m³/.test(await euq("substructure")) && /concrete strip footing/.test(await euq("substructure")), await euq("substructure"));
  check("and its element rate is its cost over it", /R 3 005,03 per m³/.test(await eur("substructure")), await eur("substructure"));
  check("superstructure's is its walling, at R 690,00 per m²", /1 017,12 m²/.test(await euq("superstructure")) && /R 690,00 per m²/.test(await eur("superstructure")), `${await euq("superstructure")} · ${await eur("superstructure")}`);
  check("finishes' is its plaster, at R 165,00 per m²", /2 034,24 m²/.test(await euq("finishes")) && /R 165,00 per m²/.test(await eur("finishes")));

  await page.click('[data-element="substructure"] button');
  await page.waitForSelector('[data-euq-form="substructure"]', { timeout: 5000 });
  await setValue('[data-euq-form="substructure"] input[name="euq"]', "491,05");
  await setValue('[data-euq-form="substructure"] input[name="euq-unit"]', "m");
  await setValue('[data-euq-form="substructure"] input[name="euq-label"]', "length of wall");
  await page.click('[data-euq-form="substructure"] [data-action="set-euq"]');
  await page.waitForFunction(() => /491,05 m/.test(document.querySelector('[data-euq="substructure"]')?.innerText ?? ""), { timeout: 15000 });
  // 203 620,65 over 491,05 m = 414,66
  check("a QS can set an element's quantity instead", /length of wall/.test(await euq("substructure")) && /R 414,66 per m/.test(await eur("substructure")), `${await euq("substructure")} · ${await eur("substructure")}`);
  await page.waitForSelector('[data-euq-form="substructure"] [data-action="reset-euq"]', { timeout: 5000 });
  await page.click('[data-euq-form="substructure"] [data-action="reset-euq"]');
  await page.waitForFunction(() => /67,76/.test(document.querySelector('[data-euq="substructure"]')?.innerText ?? ""), { timeout: 15000 });
  check("and go back to the measured item", /concrete strip footing/.test(await euq("substructure")));
  await page.click('[data-element="substructure"] button');

  // ── Set the allowances and the measure ──────────────────────────────────────────────────
  await setValue('[data-region="plan-allowances"] input[name="preliminaries"]', "10");
  await setValue('[data-region="plan-allowances"] input[name="contingency"]', "7,5");
  await setValue('[data-region="plan-allowances"] input[name="measureLabel"]', "m of boundary wall");
  await setValue('[data-region="plan-allowances"] input[name="measureValue"]', "491,05");
  await page.click('[data-action="save-allowances"]');
  await page.waitForFunction(() => !document.querySelector('[data-region="plan-typical"]'), { timeout: 15000 });
  // 10% 124 108,31 · 7,5% of 1 365 191,36 = 102 389,35 · excl 1 467 580,71 · VAT 220 137,11 · incl 1 687 717,82
  check("setting the allowances recomputes the plan", /R 1 467 580,71/.test(await text('[data-region="plan-excl"]')), await text('[data-region="plan-excl"]'));
  check("and gives the cost per metre of wall", /R 2 988,66 per m of boundary wall/.test(await text('[data-region="plan-totals"]')), (await text('[data-region="plan-totals"]')).replace(/\s+/g, " ").slice(0, 200));

  await setValue('[data-region="plan-allowances"] input[name="vat"]', "150");
  await page.click('[data-action="save-allowances"]');
  await page.waitForFunction(() => /between 0% and 30%/.test(document.querySelector('[data-region="plan-allowances"]')?.innerText ?? ""), { timeout: 10000 });
  check("an impossible VAT rate is refused in words", true);
  await setValue('[data-region="plan-allowances"] input[name="vat"]', "15");

  // ── Move an item to another element ───────────────────────────────────────────────────
  await page.click('[data-element="superstructure"] button');
  await page.waitForSelector('select[data-move]', { timeout: 5000 });
  const moveRef = await page.$eval('[data-element="superstructure"] ~ tr select[data-move]', (s) => s.getAttribute("data-move"));
  await page.select(`select[data-move="${moveRef}"]`, "external");
  await page.waitForSelector('[data-element="external"]', { timeout: 15000 });
  const assigned = await sql`select element, set_by from bill_elements where run_item_id = ${ids["One-brick walling in superstructure"]} or run_item_id = ${ids["Precast concrete coping"]}`;
  check("an item moved to another element stays moved, by whom", assigned.some((a) => a.element === "external" && a.set_by === env.DEV_USER_EMAIL), JSON.stringify(assigned));
  check("and the element totals follow it", /R 1 241 083,05/.test(await text('[data-region="plan-net"]')));

  // ── Issue it ──────────────────────────────────────────────────────────────────────────
  await page.click('[data-action="issue-elemental-plan"]');
  await page.waitForSelector('[data-action="download-elemental-plan"]', { timeout: 20000 });
  const pdfHref = await page.$eval('[data-action="download-elemental-plan"]', (a) => a.getAttribute("href"));
  const pdf = pdfText(await page.evaluate(async (h) => [...new Uint8Array(await (await fetch(h)).arrayBuffer())], pdfHref));
  check("the issued plan names itself and its basis", /Elemental Cost Plan/.test(pdf) && /draft Bill of Quantities/.test(pdf));
  check("it carries the elements and the totals", /Substructure/.test(pdf) && /Finishes/.test(pdf) && /1 467 580,71/.test(pdf) && /1 687 717,82/.test(pdf), pdf.match(/[\d ]+,\d\d/g)?.slice(0, 6).join(" | "));
  check("and the cost per metre", /per m of boundary wall/.test(pdf));
  check("with each element's quantity and rate", /67,76 m³/.test(pdf) && /3 005,03/.test(pdf) && /Quantity of concrete strip footing/.test(pdf));
  const [issued] = await sql`select kind, signed_run_ids from issued_documents where project_id = ${projectId} and kind = 'elemental_cost_plan'`;
  check("it is on the issued register, resting on no signed step", issued && issued.signed_run_ids.length === 0);

  check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));
} finally {
  await browser.close();
  await sql.end();
}

console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} failed.`);
process.exit(fails ? 1 : 0);
