/**
 * Design cost control – the detailed estimate against the Cost Plan's targets (D1.1-SP-003).
 *
 *     node checks/cost-control.mjs
 *
 * A signed Cost Plan and a draft bill are seeded, and the rest is driven through the Cost Control
 * page: the empty state before either exists, the check line by line, an element over its target and
 * one the bill has not measured, a reason typed against a line, "proceed" refused on an estimate over
 * budget, a revised budget approved and the check held to it, and the cost report issued and read
 * back from the register.
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
const attr = (s, a) => page.$eval(s, (e, name) => e.getAttribute(name), a);

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
  const { href } = await createProject(page, "Cost control " + Date.now(), BASE, 1);
  const projectId = href.split("/").pop();

  // ── Nothing to check yet ───────────────────────────────────────────────────────────────
  await page.goto(`${BASE}${href}/cost-control`, { waitUntil: "networkidle0" });
  check("the step is in the nav", await page.$$eval("nav a", (as) => as.some((a) => a.getAttribute("href")?.endsWith("/cost-control"))));
  check("without a cost plan or a bill it says what it needs", /sign the Cost Plan/.test(await text('[data-region="cost-missing"]')) && /draft the Bill of Quantities/.test(await text('[data-region="cost-missing"]')));

  // ── A signed cost plan: the targets ────────────────────────────────────────────────────
  const [plan] = await sql`
    insert into runs (project_id, module, status, input_tokens, output_tokens, created_by, signed_by, signed_at)
    values (${projectId}, '/cost-plan', 'review', 100, 50, ${env.DEV_USER_EMAIL}, ${env.DEV_USER_EMAIL}, now())
    returning id`;
  let seq = 0;
  for (const [id, label, value] of [
    ["cp-total", "Total construction cost", "R 1 400 000"],
    ["cp-substructure", "Substructure", "R 150 000"],
    ["cp-superstructure", "Superstructure", "R 700 000"],
    ["cp-finishes", "Finishes and fittings", "R 330 000"],
    ["cp-services", "Engineering services", "R 50 000"],
    ["cp-preliminaries", "Preliminaries and general", "R 150 000"],
    ["cp-contingency", "Contingency", "R 70 000"],
  ]) {
    await sql`
      insert into run_fields (run_id, field_id, seq, label, proposed_state, proposed_value, proposed_confidence, source_document, source_excerpt, output_value)
      values (${plan.id}, ${id}, ${seq++}, ${label}, 'found', ${value}, 0.9, 'cost plan.pdf', ${`the passage ${id} was read from`}, ${value})`;
  }

  // ── A draft bill: the detailed estimate ────────────────────────────────────────────────
  const [bill] = await sql`insert into runs (project_id, module, status, input_tokens, output_tokens, created_by) values (${projectId}, '/bill', 'review', 0, 0, ${env.DEV_USER_EMAIL}) returning id`;
  const [heading] = await sql`insert into run_items (run_id, seq, row_type, override_description, override_by, override_at, quantity_source) values (${bill.id}, 100, 'heading', 'Boundary wall', ${env.DEV_USER_EMAIL}, now(), 'takeoff') returning id`;
  for (const [s, desc, unit, qty, rate] of [
    [200, "Excavate trench for strip footing", "m3", "203.2900", 18500n],
    [300, "Concrete strip footing", "m3", "67.7600", 245000n],
    [400, "One-brick walling in superstructure", "m2", "1017.1200", 69000n],
    [500, "Cement plaster to both faces of walling", "m2", "2034.2400", 16500n],
    [600, "Precast concrete coping", "m", "491.0500", null],
  ]) {
    await sql`insert into run_items (run_id, seq, parent_id, row_type, override_description, override_unit, override_quantity, override_rate, override_rate_precision, override_by, override_at, quantity_source)
      values (${bill.id}, ${s}, ${heading.id}, 'item', ${desc}, ${unit}, ${qty}, ${rate}, ${rate === null ? null : 2}, ${env.DEV_USER_EMAIL}, now(), 'takeoff')`;
  }

  /*
    Worked by hand, with the typical allowances (12% P&G, 5% contingency):
      substructure 37 608,65 + 166 012,00 = 203 620,65 against 150 000 – over by 53 620,65 (35,7%)
      superstructure 701 812,80 against 700 000 – within; the coping is unpriced
      finishes 335 649,60 against 330 000 – within
      services: a target of 50 000 and nothing in the bill – not measured
      P&G 148 929,97 against 150 000, contingency 69 500,65 against 70 000 – within
      detailed 1 459 513,67 against 1 400 000 – over by 59 513,67 (4,3%)
  */
  await page.goto(`${BASE}${href}/cost-control`, { waitUntil: "networkidle0" });
  check("the check runs once both exist", Boolean(await page.$('[data-region="cost-lines"]')));
  check("and says the bill is a draft", /draft bill/.test(await text('[data-region="cost-sources"]')));
  check("the estimate is over budget", (await attr('[data-region="cost-verdict"]', "data-verdict")) === "over-budget");
  check("by the amount the figures give", /R 1 459 513,67/.test(await text('[data-total="Detailed estimate"]')) && /\+R 59 513,67/.test(await text('[data-total="Movement"]')), await text('[data-total="Movement"]'));
  check("substructure is over its target", (await attr('[data-line="substructure"]', "data-status")) === "over" && /\+R 53 620,65/.test(await text('[data-line="substructure"]')), await text('[data-line="substructure"]'));
  check("superstructure is within it, with its unpriced item said", (await attr('[data-line="superstructure"]', "data-status")) === "within" && /1 not priced/.test(await text('[data-line="superstructure"]')));
  check("services are not measured – not a saving", (await attr('[data-line="services"]', "data-status")) === "not-measured" && /not in the bill/.test(await text('[data-line="services"]')));
  check("the findings name the overrun and the gap", /Substructure is R 53 620,65 \(35,7%\) over/.test(await text('[data-region="cost-findings"]')) && /Engineering services has a target/.test(await text('[data-region="cost-findings"]')));

  // ── Why it moved ───────────────────────────────────────────────────────────────────────
  await page.type('textarea[data-note="substructure"]', "Pier footings enlarged on the engineer's signed detail");
  await page.click("h1");
  await page.waitForFunction(() => document.querySelector('textarea[data-note="substructure"]')?.parentElement?.innerText.includes(","), { timeout: 15000 });
  const [note] = await sql`select note, set_by from cost_movement_notes where project_id = ${projectId} and line = 'substructure'`;
  check("a reason typed against a line is kept, by whom", note?.note === "Pier footings enlarged on the engineer's signed detail" && note.set_by === env.DEV_USER_EMAIL, JSON.stringify(note));

  // ── The client's decision ──────────────────────────────────────────────────────────────
  await page.click('[data-region="cost-decision"] input[value="proceed"]');
  await page.click('[data-action="record-decision"]');
  await page.waitForSelector('[data-region="cost-decision"] [role="status"]', { timeout: 15000 });
  check("proceeding on an estimate over budget is refused, with what to do", /approve a revised budget instead/.test(await text('[data-region="cost-decision"] [role="status"]')));
  check("and nothing is recorded", (await sql`select count(*)::int as n from cost_decisions where project_id = ${projectId}`)[0].n === 0);

  await page.click('[data-region="cost-decision"] input[value="revise-budget"]');
  await page.waitForSelector('[data-region="cost-decision"] input[name="revisedBudget"]', { timeout: 5000 });
  await page.type('[data-region="cost-decision"] input[name="revisedBudget"]', "R 1 500 000");
  await page.type('[data-region="cost-decision"] textarea[name="note"]', "The client accepts the larger footings the engineer signed.");
  await page.click('[data-action="record-decision"]');
  await page.waitForFunction(() => document.querySelector('[data-region="cost-verdict"]')?.getAttribute("data-verdict") === "incomplete", { timeout: 15000 });
  const [decided] = await sql`select decision, revised_budget, detailed, verdict, cost_plan_run_id, bill_run_id from cost_decisions where project_id = ${projectId}`;
  check("a revised budget is recorded with the figures it was made on", decided?.decision === "revise-budget" && String(decided.revised_budget) === "150000000" && String(decided.detailed) === "145951367" && decided.verdict === "over-budget" && decided.cost_plan_run_id === plan.id && decided.bill_run_id === bill.id, JSON.stringify(decided));
  check("the check is now held to it", /Revised budget/i.test(await text('[data-region="cost-control"]')) && /R 1 500 000,00/.test(await text('[data-total="Revised budget"]')));
  // Under the revised budget – but services are unmeasured and the coping unpriced, so not a saving.
  check("and under it, but incomplete rather than within", /not complete, so that is not yet a saving/.test(await text('[data-region="cost-control"]')));
  check("the decision is in the history, in force", /in force/.test(await text('[data-region="cost-decisions"] [data-decision="revise-budget"]')));

  // ── The cost report ────────────────────────────────────────────────────────────────────
  await page.click('[data-action="issue-cost-report"]');
  await page.waitForSelector('[data-action="download-cost-report"]', { timeout: 20000 });
  const pdfHref = await page.$eval('[data-action="download-cost-report"]', (a) => a.getAttribute("href"));
  const pdf = pdfText(await page.evaluate(async (h) => [...new Uint8Array(await (await fetch(h)).arrayBuffer())], pdfHref));
  check("the issued report names itself and the budget it holds to", /Cost Report/.test(pdf) && /Revised budget/i.test(pdf) && /1 500 000,00/.test(pdf), pdf.slice(0, 200));
  check("it carries the reason under its line, and the decision", /Pier footings enlarged/.test(pdf) && /Approve a revised budget/.test(pdf));
  const [issued] = await sql`select signed_run_ids from issued_documents where project_id = ${projectId} and kind = 'cost_report'`;
  check("it is on the register, resting on the signed cost plan", Boolean(issued) && issued.signed_run_ids.includes(plan.id) && !issued.signed_run_ids.includes(bill.id), JSON.stringify(issued));

  check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));
} finally {
  await browser.close();
  await sql.end();
}

console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} failed.`);
process.exit(fails ? 1 : 0);
