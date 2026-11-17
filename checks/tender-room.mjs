/**
 * The Tender Room – D1.3, from issue to opening.
 *
 *     node checks/tender-room.mjs
 *
 * A signed bill is seeded; the rest is driven through the page: start the tender, invite three
 * tenderers, issue it, issue an addendum and tick acknowledgements, record the returns, move the
 * closing time into the past so one return is late, open – and check that the on-time sums reached
 * Tender Analysis lowest first, the late one did not, the opening froze the record, and the bill for
 * pricing carries the quantities without a single rate.
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
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    value,
  );
/** A datetime-local value in South African time, `minutes` from now. */
const sast = (minutes) => new Date(Date.now() + minutes * 60_000 + 2 * 3_600_000).toISOString().slice(0, 16);

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
  const { href } = await createProject(page, "Tender room " + Date.now(), BASE, 3);
  const projectId = href.split("/").pop();

  await page.goto(`${BASE}${href}/tender`, { waitUntil: "networkidle0" });
  check("without a signed bill it says a tender is issued on one", Boolean(await page.$('[data-region="tender-no-bill"]')));

  // A signed bill: rows first, then the signature.
  const [run] = await sql`insert into runs (project_id, module, status, input_tokens, output_tokens, created_by) values (${projectId}, '/bill', 'review', 0, 0, ${env.DEV_USER_EMAIL}) returning id`;
  for (const [seq, desc, unit, qty, rate] of [[100, "Excavate trenches", "m3", "120.0000", 18500n], [200, "One-brick wall in stock brick", "m2", "860.0000", 68500n]]) {
    await sql`insert into run_items (run_id, seq, row_type, proposed_description, proposed_unit, proposed_quantity, proposed_rate, proposed_rate_precision, proposed_confidence,
                                     output_description, output_unit, output_quantity, output_rate, output_rate_precision)
              values (${run.id}, ${seq}, 'item', ${desc}, ${unit}, ${qty}, ${rate}, 2, 0.9, ${desc}, ${unit}, ${qty}, ${rate}, 2)`;
  }
  await sql`update run_items set output_amount = amount where run_id = ${run.id}`;
  await sql`update runs set signed_by = ${env.DEV_USER_EMAIL}, signed_at = now() where id = ${run.id}`;

  // ── Start, invite, issue ──────────────────────────────────────────────────────────────────
  await page.goto(`${BASE}${href}/tender`, { waitUntil: "networkidle0" });
  await setValue('[data-region="start-tender"] input[name="closingAt"]', sast(60 * 24));
  await page.click('[data-action="start-tender"]');
  await page.waitForSelector('[data-region="tenderers"]', { timeout: 15000 });
  check("a tender starts on the signed bill, as a draft", /Draft – not yet issued/.test(await text('[data-region="tender-position"]')));

  for (const company of ["Ridgeview Builders", "Umhlanga Construction", "Late & Sons"]) {
    await page.$eval('input[aria-label="Or type a company"]', (el) => el.focus());
    await page.type('input[aria-label="Or type a company"]', company);
    await page.click('[data-action="add-tenderer"]');
    await page.waitForFunction((c) => document.querySelector(`[data-tenderer="${c}"]`), { timeout: 10000 }, company);
  }
  check("three tenderers invited", (await page.$$("[data-tenderer]")).length === 3);

  await page.click('[data-action="issue-tender"]');
  await page.waitForFunction(() => /Issued – open for tenders/.test(document.querySelector('[data-region="tender-position"]')?.innerText ?? ""), { timeout: 15000 });
  check("issued, open for tenders", true);

  // ── The bill for pricing has no rates ─────────────────────────────────────────────────────
  await page.click('[data-action="issue-tender-bill"]');
  await page.waitForSelector('[data-action="download-tender_bill"]', { timeout: 20000 });
  const billHref = await page.$eval('[data-action="download-tender_bill"]', (a) => a.getAttribute("href"));
  const billText = pdfText(await page.evaluate(async (h) => [...new Uint8Array(await (await fetch(h)).arrayBuffer())], billHref));
  check("the bill for pricing carries the quantities", /Excavate trenches/.test(billText) && /860,00/.test(billText));
  check("and not one rate, amount or nought total", !/685,00|185,00|589 100|22 200|0,00/.test(billText) && /.{8,}/.test(billText), billText.match(/[0-9 ]+,\d\d/g)?.slice(0, 8).join(" | "));

  // ── An addendum and its acknowledgements ──────────────────────────────────────────────────
  await page.type('input[aria-label="Addendum subject"]', "Revised door schedule");
  await page.type('textarea[aria-label="What the addendum changes"]', "Door D4 becomes a 1 000 mm fire door.");
  await page.click('[data-action="issue-addendum"]');
  await page.waitForSelector('[data-addendum="1"]', { timeout: 15000 });
  await page.click('[data-ack="Umhlanga Construction|1"]');
  await page.waitForFunction(() => document.querySelector('[data-ack="Umhlanga Construction|1"]')?.checked, { timeout: 10000 });
  check("an addendum is issued and acknowledged per tenderer", true);

  // ── Returns ───────────────────────────────────────────────────────────────────────────────
  const record = async (company, minutesAgo, sum) => {
    await page.click(`[data-tenderer="${company}"] [data-action="record-return"]`);
    await page.waitForSelector('[data-region="record-return"]', { timeout: 10000 });
    await setValue('[data-region="record-return"] input[name="receivedAt"]', sast(-minutesAgo));
    await page.type('[data-region="record-return"] input[name="sum"]', sum);
    await page.click('[data-action="save-return"]');
    await page.waitForFunction(() => !document.querySelector('[data-region="record-return"]'), { timeout: 10000 });
    // The row shows the sum once the page has refreshed with it.
    await page.waitForFunction((c, v) => document.querySelector(`[data-tenderer="${c}"]`)?.innerText.replace(/ /g, " ").includes(v), { timeout: 10000 }, company, sum);
  };
  await record("Umhlanga Construction", 50, "R 1 285 400,00");
  await record("Ridgeview Builders", 40, "R 1 262 900,00");
  await record("Late & Sons", 5, "R 999 000,00");
  check("each return shows its time and sum", /R 1 262 900,00/.test(await text('[data-tenderer="Ridgeview Builders"]')));
  check("a return without every addendum acknowledged says so", /addendum 1 not acknowledged/.test(await text('[data-tenderer="Ridgeview Builders"]')));

  // Opening before the closing time is refused.
  const openDisabled = await page.$eval('[data-action="open-tenders"]', (b) => b.disabled);
  check("tenders cannot be opened before the closing time", openDisabled);

  // The closing time passes – between the second and the third return.
  await sql`update tenders set closing_at = now() - interval '20 minutes' where project_id = ${projectId}`;
  await page.reload({ waitUntil: "networkidle0" });
  check("the tender now reads closed, ready to open", /Closed – ready to open/.test(await text('[data-region="tender-position"]')));
  check("the late return is flagged", /late – will not be opened/.test(await text('[data-tenderer="Late & Sons"]')));

  await page.click('[data-action="open-tenders"]');
  await page.waitForSelector('[data-region="tender-opened"]', { timeout: 15000 });
  const opened = await page.$$eval("[data-opened]", (rows) => rows.map((r) => r.innerText.replace(/ /g, " ").replace(/\s+/g, " ").trim()));
  check("opened lowest first, the late tender not among them", opened.length === 2 && /^1 Ridgeview Builders/.test(opened[0]) && /^2 Umhlanga/.test(opened[1]), opened.join(" | "));

  const returns = await sql`select tenderer, stated_sum from tender_returns where project_id = ${projectId} and deleted_at is null order by stated_sum`;
  check("the on-time sums are returns for Tender Analysis", returns.length === 2 && returns[0].tenderer === "Ridgeview Builders" && String(returns[0].stated_sum) === "126290000", JSON.stringify(returns));
  const frozen = await sql`update tender_invitees set tender_sum = 1 where company = 'Ridgeview Builders'`.then(() => null).catch((e) => e.message);
  check("the opening froze the record", /frozen/.test(frozen ?? ""), (frozen ?? "no error").slice(0, 80));

  await page.click('[data-action="issue-opening-record"]');
  await page.waitForSelector('[data-action="download-opening-record"]', { timeout: 20000 });
  const recHref = await page.$eval('[data-action="download-opening-record"]', (a) => a.getAttribute("href"));
  const rec = pdfText(await page.evaluate(async (h) => [...new Uint8Array(await (await fetch(h)).arrayBuffer())], recHref));
  check("the record of tenders opened lists the sums and the late tender", /Record of Tenders Opened/.test(rec) && /R 1 262 900,00/.test(rec) && /Late & Sons/.test(rec) && /not opened/.test(rec));

  await page.goto(`${BASE}${href}/tender-analysis`, { waitUntil: "networkidle0" });
  check("Tender Analysis shows the tenderers", /Ridgeview Builders/.test(await page.$eval("main", (e) => e.innerText)));

  check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));
} finally {
  await browser.close();
  await sql.end();
}

console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} failed.`);
process.exit(fails ? 1 : 0);
