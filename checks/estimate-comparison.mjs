/**
 * Estimate comparison – estimates for the same works, element by element, in a real browser.
 *
 *     node checks/estimate-comparison.mjs
 *
 * ── What this proves ───────────────────────────────────────────────────────────────────────
 *
 * That an engineer's cost model imports as its lines, with totals and markups left out and said
 * to be; that an estimate can also be entered line by line, with the ambiguous figure and the half
 * line refused; that every estimate is priced to the cent, P&G on direct works and contingency on
 * both, and put on the common unit count; that a corrected copy can be derived and a correction
 * moves exactly its element; that the gap between two estimates is taken apart; that the findings
 * name an estimate made of allowances and an element one estimate leaves out; that clarifications
 * refuse an empty answer; that it exports; and that withdrawing keeps the record.
 *
 * The figures are made up for this check – no client estimate is read.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ExcelJS from "exceljs";
import postgres from "postgres";
import puppeteer from "puppeteer";

import { createProject, readEnv, signIn, watchConsole } from "./helpers.mjs";

const BASE = "http://localhost:3000";
const env = readEnv();
const sql = postgres(env.DATABASE_URL, { max: 1 });

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`,
  );
};

// ── An engineer's cost model, in the usual shape ───────────────────────────────────────────
const dir = mkdtempSync(join(tmpdir(), "estimates-check-"));
const model = join(dir, "Civil cost model.xlsx");
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Cost model");
  [
    ["High-level civil cost estimate"],
    ["No", "Description", "Qty", "Unit", "Rate", "Amount"],
    ["1", "Earthworks"],
    ["1.1", "Bulk earthworks", 12000, "m3", 220, 2640000],
    ["2", "Roads"],
    ["2.1", "Roads", 3500, "m2", 1350, 4725000],
    ["2.2", "Kerbs, sidewalks and furniture", "", "", "", 2500000],
    ["3", "Sewer"],
    ["3.1", "Sewer reticulation", 300, "m", 3800, 1140000],
    ["3.2", "Connections allowance", "", "", "", 500000],
    ["", "Subtotal direct works", "", "", "", 11505000],
    ["", "Preliminary and General 10%", "", "", "", 1150500],
    ["", "Contingency 12%", "", "", "", 1518660],
    ["", "TOTAL excl. VAT", "", "", "", 14174160],
  ].forEach((r) => ws.addRow(r));
  await wb.xlsx.writeFile(model);
}

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1100 });
page.on("pageerror", (e) =>
  console.log("  [pageerror]", String(e).slice(0, 300)),
);
page.on("dialog", (d) => d.accept());
const consoleErrors = watchConsole(page);
const text = (selector) =>
  page.$eval(selector, (e) => e.innerText.replace(/ /g, " "));
const waitText = (re, timeout = 30000) =>
  page.waitForFunction(
    (src) => new RegExp(src).test(document.body.innerText.replace(/ /g, " ")),
    { timeout },
    re.source,
  );
/** Every act waits for the control it uses to be drawn and enabled: a click before then is lost. */
const ready = (selector) =>
  page.waitForFunction(
    (s) => {
      const el = document.querySelector(s);
      return el && !el.disabled;
    },
    { timeout: 30000 },
    selector,
  );
const press = async (selector) => {
  await ready(selector);
  await page.click(selector);
};
async function fill(form, values) {
  for (const [name, value] of Object.entries(values)) {
    const at = `${form} [name="${name}"]`;
    await ready(at);
    // Select the whole value, then delete it: a triple click selects one word of "1,234", not the field.
    await page.focus(at);
    await page.$eval(at, (el) => el.select());
    await page.keyboard.press("Backspace");
    if (value) await page.type(at, value);
  }
}
const poll = async (query, done) => {
  for (let i = 0; i < 60; i++) {
    const rows = await query();
    if (done(rows)) return rows;
    await new Promise((r) => setTimeout(r, 500));
  }
  return query();
};

try {
  await signIn(page, env);
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
  const { href } = await createProject(
    page,
    "Estimates " + Date.now(),
    BASE,
    2,
  );
  const projectId = href.split("/").pop();

  await page.goto(`${BASE}${href}/estimates`, { waitUntil: "networkidle0" });
  check(
    "Estimate Comparison is a working page, offering to start one",
    Boolean(await page.$('[data-form="start-comparison"]')),
  );
  check(
    "and it is in the project's navigation",
    await page.$$eval("nav a", (as) =>
      as.some((a) => /Estimate Comparison/.test(a.textContent ?? "")),
    ),
  );

  await fill('[data-form="start-comparison"]', {
    title: "Internal civils – engineers' estimates",
    elements: "Earthworks, Roads, Sewer",
    commonUnits: "110",
  });
  await press('[data-action="start-comparison"]');
  await page.waitForSelector('[data-region="comparison-heading"]', {
    timeout: 30000,
  });
  check("a comparison is started", true);

  // ── An estimate from its cost model ──
  await ready('[data-action="open-add-estimate"]');
  await press('[data-action="open-add-estimate"]');
  await fill('[data-form="add-estimate"]', {
    name: "Allowances",
    units: "100",
    preliminaries: "10",
    contingency: "12",
  });
  await (
    await page.$('[data-form="add-estimate"] input[type="file"]')
  ).uploadFile(model);
  await press('[data-action="add-estimate"]');
  await page.waitForSelector('[data-estimate="Allowances"]', {
    timeout: 60000,
  });
  const status = await text('[role="status"]');
  check(
    "the cost model imports as its lines",
    /with 5 lines/.test(status),
    status.split("\n")[0],
  );
  check(
    "its totals are left out and said to be",
    /total rows? (was|were) left out/.test(status),
  );
  check(
    "and its P&G and contingency are not read as lines",
    /markups are the estimate's percentages/.test(status),
  );

  // ── An estimate entered by hand ──
  await ready('[data-action="open-add-estimate"]');
  await press('[data-action="open-add-estimate"]');
  await fill('[data-form="add-estimate"]', {
    name: "Measured",
    units: "110",
    preliminaries: "12",
    contingency: "15",
  });
  await press('[data-action="add-estimate"]');
  await page.waitForSelector('[data-estimate="Measured"]', { timeout: 30000 });

  const measuredLine = '[data-estimate="Measured"] [data-form="add-line"]';
  await fill(measuredLine, {
    element: "Earthworks",
    description: "Platforms and road formation",
    quantity: "4407.4",
    unit: "m3",
    rate: "1,234",
  });
  await press(`${measuredLine} [data-action="add-line"]`);
  await waitText(
    /Not added – rate: "1,234" could be a thousands separator or a decimal comma/,
  );
  check("a rate that reads two ways is refused, not guessed", true);
  await fill(measuredLine, { rate: "" });
  await press(`${measuredLine} [data-action="add-line"]`);
  await waitText(/needs both a quantity and a rate/);
  check("a quantity with no rate is refused rather than added unpriced", true);
  await fill(measuredLine, { rate: "95" });
  await press(`${measuredLine} [data-action="add-line"]`);
  await waitText(/The line is added/);
  await page.waitForSelector(
    '[data-estimate="Measured"] [data-line="Platforms and road formation"]',
    { timeout: 30000 },
  );
  await fill(measuredLine, {
    element: "Sewer",
    description: "160 mm pipe",
    quantity: "193.1",
    unit: "m",
    rate: "2500",
  });
  await press(`${measuredLine} [data-action="add-line"]`);
  await page.waitForSelector(
    '[data-estimate="Measured"] [data-line="160 mm pipe"]',
    { timeout: 30000 },
  );
  check("an estimate is entered line by line", true);

  /*
    Allowances: direct 11 505 000,00; P&G 10% 1 150 500,00; contingency 12% of 12 655 500 = 1 518 660,00;
    total 14 174 160,00 – R14.17m, R141 741,60 on its own 100 units, R128 856,00 on the common 110.
    Measured: 4407.4 × 95 + 193.1 × 2500 = 901 453,00; P&G 12% 108 174,36; 15% of 1 009 627,36 =
    151 444,10; total 1 161 071,46.
  */
  const summary = await text('[data-region="comparison-summary"]');
  check(
    "each estimate is priced, P&G on direct works and contingency on both",
    /14,17/.test(summary) && /1,16/.test(summary),
    summary.split("\n").find((l) => /Total excl/.test(l)),
  );
  check(
    "and put on the common unit count beside its own",
    /R 141 741,60/.test(summary) && /R 128 856,00/.test(summary),
  );
  check(
    "the estimate made of allowances says how much is lump sums",
    /26%/.test(summary),
  );

  // ── A corrected copy ──
  await ready('[data-estimate="Measured"] [data-action="derive-estimate"]');
  await press('[data-estimate="Measured"] [data-action="derive-estimate"]');
  await page.waitForSelector(
    '[data-estimate="Measured, stress-tested"] [data-form="add-correction"]',
    { timeout: 30000 },
  );
  const derived = await poll(
    () =>
      sql`select e.derived_from, count(l.id)::int as lines from comparison_estimates e left join comparison_lines l on l.estimate_id = e.id join estimate_comparisons c on c.id = e.comparison_id where c.project_id = ${projectId} and e.name = 'Measured, stress-tested' group by e.derived_from`,
    (r) => r.length > 0,
  );
  check(
    "a derived estimate copies the lines and records where it came from",
    derived[0]?.lines === 2 && Boolean(derived[0]?.derived_from),
  );

  const corr =
    '[data-estimate="Measured, stress-tested"] [data-form="add-correction"]';
  await fill(corr, {
    element: "Earthworks",
    description: "Volume doubled to reconcile platforms with road levels",
    amount: "952000",
    basis: "",
  });
  await press(`${corr} [data-action="add-correction"]`);
  await page.waitForSelector(
    '[data-estimate="Measured, stress-tested"] [data-correction="A"]',
    { timeout: 30000 },
  );
  // 1 853 453,00 direct; 222 414,36 P&G; 311 380,10 contingency; 2 387 247,46.
  const after = await text('[data-region="comparison-summary"]');
  check(
    "a correction moves its element by exactly its amount",
    /2,39/.test(after),
    after.split("\n").find((l) => /Total excl/.test(l)),
  );
  const findings = await text('[data-region="comparison-findings"]');
  check(
    "a correction with no stated basis is raised",
    /correction A has no stated basis/.test(findings),
  );
  check(
    "an estimate made largely of allowances is raised",
    /Allowances: 26% of direct works is lump sums/.test(findings),
  );
  check(
    "an element one estimate leaves out is raised",
    /Roads is carried by Allowances and not by Measured/.test(findings),
  );

  // ── The gap ──
  const gap = await text('[data-region="comparison-gap"]');
  const first = await page.$eval(
    '[data-region="comparison-gap"] [data-gap-part]',
    (e) => e.dataset.gapPart,
  );
  // Allowances less Measured: roads (7 225 000) is the largest part, carried by one estimate only.
  check(
    "the gap between two estimates is taken apart, largest part first",
    /Where the gap sits/.test(gap) && first === "Roads",
    first,
  );

  // ── Clarifications ──
  await fill('[data-form="add-clarification"]', {
    observation: "One sewer connection per block",
    evidence: "Report 7.4",
    consequence: "Connections understated",
  });
  await press('[data-action="add-clarification"]');
  await page.waitForSelector('[data-clarification="1"]', { timeout: 30000 });
  await page.select('[data-clarification="1"] select', "Answered");
  await ready('[data-clarification="1"] button[type="submit"]');
  await press('[data-clarification="1"] button[type="submit"]');
  await waitText(/Write the response before marking it answered/);
  check(
    "a clarification marked answered with nothing written is refused",
    true,
  );
  await ready('[data-clarification="1"] button[type="submit"]');
  await page.type(
    '[data-clarification="1"] textarea',
    "Engineer: three connections per block in Rev 1.",
  );
  await page.select('[data-clarification="1"] select', "Answered");
  await press('[data-clarification="1"] button[type="submit"]');
  const answered = await poll(
    () =>
      sql`select x.status from comparison_clarifications x join estimate_comparisons c on c.id = x.comparison_id where c.project_id = ${projectId}`,
    (r) => r[0]?.status === "Answered",
  );
  check("and answered with one", answered[0]?.status === "Answered");

  // ── Export ──
  const comparisonId = (
    await sql`select id from estimate_comparisons where project_id = ${projectId}`
  )[0].id;
  const exported = await page.evaluate(async (url) => {
    const r = await fetch(url);
    return {
      status: r.status,
      type: r.headers.get("content-type"),
      bytes: Array.from(new Uint8Array(await r.arrayBuffer())),
    };
  }, `${BASE}${href}/report/pdf?document=estimate-comparison&comparison=${comparisonId}`);
  check(
    "it exports as a workbook",
    exported.status === 200 && /spreadsheetml/.test(exported.type ?? ""),
    `${exported.status} ${exported.type}`,
  );
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(exported.bytes));
  check(
    "with a summary, a sheet per estimate, the gap and the clarifications",
    wb.worksheets.map((w) => w.name).join("|") ===
      "Summary|Allowances|Measured|Measured, stress-tested|Gap|Clarifications",
    wb.worksheets.map((w) => w.name).join(", "),
  );

  // ── Withdraw ──
  await ready('button[aria-label="Withdraw this comparison"]');
  await press('button[aria-label="Withdraw this comparison"]');
  const kept = await poll(
    () =>
      sql`select count(*)::int as n from estimate_comparisons where project_id = ${projectId} and deleted_at is not null`,
    (r) => r[0].n === 1,
  );
  check(
    "a withdrawn comparison is kept on the record, not deleted",
    kept[0].n === 1,
  );

  check(
    "no console errors",
    consoleErrors.length === 0,
    consoleErrors.slice(0, 2).join(" | "),
  );
} finally {
  await browser.close();
  await sql.end();
}

console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} failed.`);
process.exit(fails ? 1 : 0);
