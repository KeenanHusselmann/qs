/**
 * Design review – a draft bill mapped against the design, in a real browser.
 *
 *     node checks/design-review.mjs
 *
 * ── What this proves ───────────────────────────────────────────────────────────────────────
 *
 * That the practice's review workbook imports as it is kept – sources, item mapping, queries and
 * a priced estimate, found by their headings – and that its counts and totals are recomputed rather
 * than copied; that the review raises what a spreadsheet cannot check about itself (an item resting
 * on a superseded drawing, a quantity with no rate); that a reviewer can mark an item, answer a
 * query and price an item in place, with the ambiguous figure and the empty answer refused; that
 * it exports back to the same seven sheets; and that withdrawing keeps the record.
 *
 * The workbook is made here, in the shape of the real one – no client document is read.
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
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

// ── A review workbook, in the practice's shape ──────────────────────────────────────────────
const dir = mkdtempSync(join(tmpdir(), "review-check-"));
const file = join(dir, "Boundary wall - QS BOQ vs Design Mapping.xlsx");
{
  const wb = new ExcelJS.Workbook();
  const sheet = (name, rows) => rows.forEach((r) => wb.getWorksheet(name)?.addRow(r) ?? wb.addWorksheet(name).addRow(r));
  sheet("Read Me", [
    ["Boundary Wall - QS BOQ vs Design Mapping"],
    ["Check practice | Draft for internal review"],
    ["Recommended base", "", "Option B follows the architect and engineer intent most closely."],
  ]);
  sheet("Sources", [
    ["Ref", "Discipline", "Document", "Date", "Status / revision", "Relevance / notes", "Location"],
    ["E1", "Structural Engineer", "Structural design report", "14 Jul 2026", "For construction support", "NW wall only", "Drive"],
    ["A1", "Architect", "Boundary wall plans", "16 Sep 2026", "Construction drawing", "", ""],
    ["A3", "Architect", "Boundary wall Rev 6", "9 Sep 2026", "Superseded concept", "Shows the gates", ""],
  ]);
  sheet("QS Item Mapping", [
    ["Ref", "Bill", "Item (B)", "Item (A)", "QS description (abridged)", "Unit", "Qty Option A", "Qty Option B", "Design source", "Design requirement", "Status", "Finding", "Recommended action"],
    ["P1", "Preliminaries", "1", "1", "Contract data, security, insurances", "Item", 1, 1, "n/a", "-", "Standard", "Contract item.", "None"],
    ["P9", "Preliminaries", "9", "9", "Temporary access along wall line", "Item", 1, 1, "A3", "Access 2 gates", "Query", "Portion 24 not on the drawings.", "Confirm access route."],
    ["C5", "Concrete", "5", "5", "Y12 reinforcement @ 200 each way", "kg", 8141.17, 8141.17, "E1 7.1", "Y12 @ 200", "Discrepancy", "Three bars measured; four needed.", "Re-measure at four bars."],
    ["M3", "Masonry", "3", "3", "Superstructure walls DPC to coping", "m2", 1153.97, 1153.97, "A1 note 4, E1 6.1", "2500 max", "Aligned", "-", "None"],
    ["PT3", "Paintwork", "7", "7", "Prime and two coats to copings", "m", 844.65, 844.65, "None", "Not specified", "QS addition", "Not on drawings.", "Architect to confirm."],
  ]);
  sheet("Queries Tracker", [
    ["No", "Topic", "Query", "Raised to", "Affects", "Priority", "Source reference", "Response", "Status"],
    ["Q1", "Engineering scope", "Does the NW wall design apply to the N and SW walls?", "Engineer", "All options", "High", "E1 clause 3", "", "Open"],
    ["Q2", "Coping paint", "Are the precast copings painted?", "Architect", "All options", "Low", "E2", "", "Open"],
  ]);
  sheet("Cost Estimate", [
    ["Cost Estimate"],
    ["KEY ASSUMPTIONS"],
    ["Wall length (m)", "", "", "", 491.05],
    ["Contingency", "", "", "", 0.1],
    ["VAT", "", "", "", 0.15],
    ["Profit and attendance on provisional sums", "", "", "", 0.075],
    ["SUMMARY (R, excl. VAT)"],
    ["Ref", "Bill", "QS item", "Description", "Unit", "Qty A", "Qty B", "Rate A", "Rate B", "Amount A", "Amount B", "Rate basis / notes"],
    ["P1", "Preliminaries", "1", "Contract data", "Item", 1, 1, 35000, 35000, "", "", "Guarantee and insurances"],
    ["P9", "Preliminaries", "9", "Temporary access", "Item", 1, 1, 25000, 25000, "", "", ""],
    ["C5", "Concrete", "5", "Y12 reinforcement", "kg", 8141.17, 8141.17, 27.5, 27.5, "", "", "Cut, bend and fix"],
    ["M3", "Masonry", "3", "Superstructure walls", "m2", 1153.97, 1153.97, 1180, 720, "", "", "A: face brick; B: stock brick"],
    // PT3 deliberately unpriced in Option B – the review has to say so.
    ["PT3", "Paintwork", "7", "Copings", "m", 844.65, 844.65, 40, "", "", "", ""],
    ["RECOMMENDED ADJUSTMENTS"],
    ["ADJ1", "Adjustments", "Q1", "Fourth bar per layer", "kg", 1074.43, 1074.43, 27.5, 27.5, "", "", "Four bars needed"],
  ]);
  await wb.xlsx.writeFile(file);
}

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1100 });
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));
page.on("dialog", (d) => d.accept());
const consoleErrors = watchConsole(page);
// Money groups with U+00A0 (§7.7); written as an escape so nobody deletes an invisible character.
const text = (selector) => page.$eval(selector, (e) => e.innerText.replace(/ /g, " "));
const waitText = (re, timeout = 30000) => page.waitForFunction((src) => new RegExp(src).test(document.body.innerText.replace(/ /g, " ")), { timeout }, re.source);

try {
  await signIn(page, env);
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
  const { href } = await createProject(page, "Review " + Date.now(), BASE, 2);
  const projectId = href.split("/").pop();

  await page.goto(`${BASE}${href}/review`, { waitUntil: "networkidle0" });
  check("Design Review is a working page, offering the import first", Boolean(await page.$('[data-form="import-review"]')));
  check("and it is in the project's navigation", await page.$$eval("nav a", (as) => as.some((a) => /Design Review/.test(a.textContent ?? ""))));

  // ── Import ──
  const upload = await page.$('[data-form="import-review"] input[type="file"]');
  await upload.uploadFile(file);
  await page.click('[data-action="import-review"]');
  await page.waitForSelector('[data-region="review-summary"]', { timeout: 60000 });

  const summary = await text('[data-region="review-summary"]');
  check("the import counts items by the status key", /Aligned 1/.test(summary) && /Discrepancy 1/.test(summary) && /QS addition 1/.test(summary), summary.split("\n").slice(0, 3).join(" / "));
  check("and its open queries, high priority among them", /2 queries open/.test(summary) && /1 high priority/.test(summary));
  check("Option B is read as the recommended base", /option b\s*· base/i.test(await text('[data-region="review-totals"]')));

  /*
    Option B, recomputed from the rows: 35 000 + 25 000 + 223 882,18 + 830 858,40 = 1 114 740,58
    billed (PT3 unpriced in B), + 29 546,83 adjustment = 1 144 287,41, + 10% = 1 258 716,15.
  */
  const totals = await text('[data-region="review-totals"]');
  check("the total is recomputed from the rows, not copied", /R 1 258 716,15/.test(totals), totals.split("\n").slice(0, 3).join(" / "));
  check("and per metre of wall", /R 2 563,32/.test(totals));

  const findings = await text('[data-region="review-findings"]');
  check("an item resting on a superseded drawing is raised", /superseded \(A3\): P9/.test(findings), findings.split("\n")[0]);
  check("a quantity with no rate is raised for the option it is missing from", /Option B: 1 item carries a quantity and no rate[^\n]*PT3/.test(findings));

  // ── Mark an item ──
  await page.click('[data-review-item="PT3"]');
  await page.waitForSelector('[data-form="mark-item"]');
  await page.select('[data-form="mark-item"] select[name="status"]', "Query");
  await page.click('[data-form="mark-item"] textarea[name="finding"]');
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.type('[data-form="mark-item"] textarea[name="finding"]', "Engineer calls for off-shutter finish; painting not specified.");
  await page.click('[data-action="save-item"]');
  await page.waitForSelector('[data-review-item="PT3"][data-status="Query"]', { timeout: 20000 });
  check("an item is marked in place, with its finding", /off-shutter/.test(await text('[data-review-item="PT3"]')));

  // ── Queries ──
  await page.click('[data-tab="queries"]');
  await page.waitForSelector('[data-query="1"]');
  await page.select('[data-query="1"] select', "Answered");
  await page.click('[data-query="1"] [data-action="save-query"]');
  await waitText(/Write the response before marking the query answered/);
  check("a query marked answered with nothing written is refused", true);
  // The button is disabled until the refused save has settled; a click before then does nothing.
  await page.waitForFunction(() => !document.querySelector('[data-query="1"] [data-action="save-query"]')?.disabled, { timeout: 20000 });
  await page.type('[data-query="1"] textarea', "Engineer confirms by email 3 Nov: the NW design applies to all walls.");
  await page.select('[data-query="1"] select', "Answered");
  await page.click('[data-query="1"] [data-action="save-query"]');
  await waitText(/Q1 is answered/);
  const [q1] = await sql`select q.status, q.answered_by from review_queries q join design_reviews r on r.id = q.review_id where r.project_id = ${projectId} and q.number = 1`;
  check("a response answers the query, and records who", q1?.status === "Answered" && Boolean(q1?.answered_by));

  // Every step waits for what it acts on: on a slower runner the answer above is still refreshing
  // the list when the next click lands, and a click on a form not yet drawn is simply lost.
  await page.waitForFunction(() => !document.querySelector('[data-action="add-query"]')?.disabled, { timeout: 20000 });
  await page.click('[data-action="add-query"]');
  await page.waitForSelector('[data-form="add-query"] textarea[name="query"]', { timeout: 20000 });
  await page.type('[data-form="add-query"] textarea[name="query"]', "Confirm gate positions at Access 1 and 2.");
  await page.waitForFunction(() => !document.querySelector('[data-action="save-new-query"]')?.disabled, { timeout: 20000 });
  await page.click('[data-action="save-new-query"]');
  let q3 = [];
  for (let i = 0; i < 40 && q3.length === 0; i++) {
    q3 = await sql`select q.query from review_queries q join design_reviews r on r.id = q.review_id where r.project_id = ${projectId} and q.number = 3`;
    if (q3.length === 0) await new Promise((r) => setTimeout(r, 500));
  }
  check("a new query takes the next number", q3[0]?.query === "Confirm gate positions at Access 1 and 2.", `${q3.length} row(s) numbered 3`);
  await waitText(/Q3 is on the list/);

  // ── Price an item ──
  await page.click('[data-tab="estimate"]');
  await page.waitForSelector('[data-rate-row="PT3"]');
  const rateB = '[aria-label="Rate, PT3 Option B"]';
  await page.click(rateB);
  await page.type(rateB, "1,234");
  await page.click("h1");
  await waitText(/That rate could not be read/);
  check("a rate that reads two ways is refused, not guessed", true);
  // The cell is disabled while the refused save settles; typing into it then would be lost.
  await page.waitForFunction((sel) => !document.querySelector(sel)?.disabled && document.querySelector(sel)?.value === "", { timeout: 20000 }, rateB);
  await page.$eval(rateB, (el) => el.focus());
  await page.click(rateB, { clickCount: 3 });
  await page.type(rateB, "40");
  await page.click("h1");
  await waitText(/PT3 is rated at R 40\.00/);
  await page.goto(`${BASE}${href}/review`, { waitUntil: "networkidle0" });
  const after = (await page.$('[data-region="review-findings"]')) ? await text('[data-region="review-findings"]') : "";
  check("pricing the item clears the unpriced finding", !/no rate/.test(after));
  // 1 258 716,15 + 844,65 × 40 = 33 786,00 → billed +33 786,00, ×1.1 = +37 164,60.
  check("and the total moves by exactly its amount with contingency", /R 1 295 880,75/.test(await text('[data-region="review-totals"]')), (await text('[data-region="review-totals"]')).split("\n")[1]);

  // ── Export ──
  const reviewId = (await sql`select id from design_reviews where project_id = ${projectId}`)[0].id;
  const exported = await page.evaluate(async (url) => {
    const r = await fetch(url);
    return { status: r.status, type: r.headers.get("content-type"), bytes: Array.from(new Uint8Array(await r.arrayBuffer())) };
  }, `${BASE}${href}/report/pdf?document=design-review&review=${reviewId}`);
  check("it exports as a workbook", exported.status === 200 && /spreadsheetml/.test(exported.type ?? ""), `${exported.status} ${exported.type}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(exported.bytes));
  check(
    "in the practice's seven sheets",
    wb.worksheets.map((w) => w.name).join("|") === "Read Me|Sources|Design Parameters|QS Item Mapping|Option Comparison|Queries Tracker|Cost Estimate",
    wb.worksheets.map((w) => w.name).join(", "),
  );
  const qt = wb.getWorksheet("Queries Tracker");
  check("carrying the answer that was recorded", qt.getRow(2).getCell(8).value?.toString().includes("Engineer confirms") && qt.getRow(2).getCell(9).value === "Answered");

  // ── Withdraw ──
  await page.click('button[aria-label="Withdraw this review"]');
  await page.waitForFunction(() => !document.querySelector('[data-region="review-summary"]'), { timeout: 20000 });
  const [kept] = await sql`select count(*)::int as n from design_reviews where project_id = ${projectId} and deleted_at is not null`;
  check("a withdrawn review is kept on the record, not deleted", kept.n === 1);

  check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));
} finally {
  await browser.close();
  await sql.end();
}

console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} failed.`);
process.exit(fails ? 1 : 0);
