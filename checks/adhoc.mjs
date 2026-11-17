/**
 * Ad hoc requests, in a real browser (November meeting).
 *
 * "Here's the input, this is what I need": opened from beside Add project, from the floating quick
 * action and from the landing page's card; listed on the Ad hoc requests page, where every way back points; shown
 * with its own few modules and none of the service chain; kept out of every project figure.
 */

import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import postgres from "postgres";
import puppeteer from "puppeteer";

import { readEnv, signIn, watchConsole } from "./helpers.mjs";

const BASE = "http://localhost:3000";
const env = readEnv();
const sql = postgres(env.DATABASE_URL, { max: 1 });

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

// A 13-digit epoch in the name, so `clean-test-projects` removes it like every suite's project.
const NAME = `Steel schedule ${Date.now()}`;
const dir = mkdtempSync(join(tmpdir(), "adhoc-check-"));
const input = join(dir, "engineer-notes.txt");
writeFileSync(input, "Retaining wall: Y12 bars at 200 centres both ways, 2.4 m high. Carports: 152x152x23 H-section columns.");

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const consoleErrors = watchConsole(page);
const text = (selector) => page.$eval(selector, (e) => e.innerText);

try {
  await signIn(page, env);

  // ── Where it starts ────────────────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  check("the landing page carries the ad hoc requests card", Boolean(await page.$('[data-region="adhoc-requests"] [data-action="new-adhoc"]')));

  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
  check("Projects offers it beside Add project", Boolean(await page.$('[data-action="new-adhoc"][data-trigger="button"]')));
  check("and every other page has the quick action", Boolean(await page.$('[data-region="adhoc-quick-action"] [data-action="new-adhoc"]')));

  // ── Opening one, with an input ─────────────────────────────────────────────────────────────
  await page.click('[data-region="adhoc-quick-action"] [data-action="new-adhoc"]');
  await page.waitForSelector('dialog[data-region="new-adhoc"][open]');
  check("nothing can be opened without saying what is needed", await page.$eval('[data-action="create-adhoc"]', (b) => b.disabled));
  await page.type('dialog[data-region="new-adhoc"] input[name="name"]', NAME);
  await page.type('dialog[data-region="new-adhoc"] textarea[name="request"]', "Steel tonnage and specification for the retaining walls and carports, for Richard's supplier meeting.");
  await page.type('dialog[data-region="new-adhoc"] input[name="requestedBy"]', "Richard");
  const [chooser] = await Promise.all([page.waitForFileChooser(), page.click('dialog[data-region="new-adhoc"] label:has(input[type="file"])')]);
  await chooser.accept([input]);
  await page.waitForSelector('[data-region="adhoc-inputs"] select');
  // Choose a kind where the guess left none – a file nothing knows the kind of is a file nothing finds.
  const kind = await page.$eval('[data-region="adhoc-inputs"] select', (s) => s.value || s.options[1].value);
  await page.select('[data-region="adhoc-inputs"] select', kind);
  await Promise.all([page.click('[data-action="create-adhoc"]'), page.waitForFunction(() => /\/projects\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 30_000 })]);

  const [row] = await sql`select id, kind, request, requested_by, stages from projects where name = ${NAME}`;
  check("it is stored as an ad hoc request", row?.kind === "adhoc", row?.kind);
  check("with what was asked and who asked", /retaining walls/.test(row?.request ?? "") && row?.requested_by === "Richard");
  const [{ n: filed }] = await sql`select count(*)::int as n from documents where project_id = ${row.id} and deleted_at is null`;
  check("and its input filed against it", filed === 1, String(filed));

  // ── Its own page, and only its own modules ─────────────────────────────────────────────────
  await page.waitForSelector('[data-region="adhoc-overview"]');
  // The dialog lives in the top bar, which survives navigation: it must close on arrival.
  await page.waitForFunction(() => !document.querySelector('dialog[data-region="new-adhoc"]')?.open, { timeout: 5000 }).catch(() => {});
  check("the dialog closes once the request is open", !(await page.$eval('dialog[data-region="new-adhoc"]', (d) => d.open).catch(() => false)));
  check("its front page is the request", /Steel tonnage/.test(await text('[data-region="adhoc-request"]')));
  check("with the input listed", /engineer-notes\.txt/.test(await text('[data-region="adhoc-overview"] [data-region="adhoc-inputs"]')));
  const nav = await page.$$eval('aside nav[aria-label="Ad hoc request"] a', (as) => as.map((a) => new URL(a.href).pathname.split("/").slice(3).join("/")));
  check("the sidebar shows its modules and none of the chain", nav.includes("take-off") && nav.includes("corpus") && !nav.includes("feasibility") && !nav.includes("bill"), nav.join(","));
  check("and leads back to the ad hoc requests", Boolean(await page.$('aside a[href="/my-work#adhoc"]')));

  await page.goto(`${BASE}/projects/${row.id}/feasibility`, { waitUntil: "networkidle0" });
  check("a step of the chain reached by URL says it is not part of the request", /Not part of an ad hoc request/.test(await page.$eval("main", (m) => m.innerText)));

  // ── The assistant's way back ───────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/projects/${row.id}`, { waitUntil: "networkidle0" });
  const assistantLink = await page.$('[data-action="adhoc-requests"]');
  check("the assistant carries a fixed way back to the ad hoc requests", assistantLink !== null && (await assistantLink.evaluate((a) => a.getAttribute("href"))) === "/my-work#adhoc");

  // ── Listed apart from projects ─────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/my-work`, { waitUntil: "networkidle0" });
  check("the Ad hoc requests page lists it", Boolean(await page.$(`[data-region="adhoc-requests"] [data-adhoc="${row.id}"]`)));
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
  check("and the project list does not", !(await page.$eval("main", (m) => m.innerText)).includes(NAME));

  // ── Answered, and kept ─────────────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/projects/${row.id}`, { waitUntil: "networkidle0" });
  await page.click('[data-action="answer-adhoc"]');
  await page.waitForSelector('[data-action="reopen-adhoc"]', { timeout: 15_000 });
  const [after] = await sql`select closed_at, closed_by, deleted_at from projects where id = ${row.id}`;
  check("marking it answered records who and when, and removes nothing", after.closed_at !== null && after.closed_by === env.DEV_USER_EMAIL && after.deleted_at === null);

  check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));
} finally {
  await browser.close();
  await sql.end();
}

console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} failed.`);
process.exit(fails ? 1 : 0);
