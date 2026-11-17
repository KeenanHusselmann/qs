/**
 * Notifications – the bell, and the email behind it (round-3 testing).
 *
 *     node checks/notifications.mjs
 *
 * A colleague is on the books; the signed-in QS issues a document on the project, which the
 * colleague is told about and the QS is not (nobody is told about their own action). A sign-off the
 * colleague made reaches the QS: opening the bell finds it, counts it, opens it where it lives and
 * marks it read. With no email service on this deployment, every notification records why it was
 * not emailed, and the bell says so; the email switch is kept per person.
 *
 * Work-item notifications (assigned, comment, due) went with Project Management on 16 Nov 2026. A
 * stored one of those kinds is no longer shown – asserted below, because it would open a dead page.
 */

import { config } from "dotenv";
import postgres from "postgres";
import puppeteer from "puppeteer";

import { createProject, readEnv, signIn, watchConsole } from "./helpers.mjs";

config({ path: ".env.local", quiet: true });
const env = readEnv();
const BASE = "http://localhost:3000";
const ME = env.DEV_USER_EMAIL.toLowerCase();
const COLLEAGUE = "thandi.notify@mzilikazi.co.za";

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const sql = postgres(env.DATABASE_URL, { max: 1 });
const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));
const consoleErrors = watchConsole(page);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
/** Notifications are written after the response – give them a moment to land. */
const toldTo = async (who, projectId, kind, tries = 50) => {
  for (let i = 0; i < tries; i++) {
    const rows = await sql`select * from notifications where recipient = ${who} and project_id = ${projectId} and kind = ${kind} order by created_at desc`;
    if (rows.length) return rows;
    await pause(300);
  }
  return [];
};

try {
  await sql`insert into users (email, name, password_hash) select ${COLLEAGUE}, 'Thandi Notify', 'not-a-login' where not exists (select 1 from users where lower(email) = ${COLLEAGUE})`;
  await sql`delete from notifications where recipient in (${ME}, ${COLLEAGUE})`;
  await sql`delete from notification_settings where recipient = ${ME}`;

  await signIn(page, env);
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
  const { href } = await createProject(page, "Notifications " + Date.now(), BASE, 2);
  const projectId = href.split("/").pop();

  /*
    The colleague is on the project's team. Work items used to put them there; with the board gone, a
    run of theirs does (`projectTeam` reads who started or signed a run).
  */
  await sql`insert into runs (project_id, module, status, input_tokens, output_tokens, created_by)
            values (${projectId}, '/feasibility', 'review', 0, 0, ${COLLEAGUE})`;

  // ── Issued ───────────────────────────────────────────────────────────────────────────────
  await page.goto(`${BASE}${href}/report`, { waitUntil: "networkidle0" });
  await page.$$eval("button", (bs) => bs.find((b) => /issue the viability report/i.test(b.innerText))?.click());
  await page.waitForSelector('[role="status"]', { timeout: 60000 });
  const issued = await toldTo(COLLEAGUE, projectId, "issued");
  check("the project team is told a document was issued", issued.length === 1 && /issued the QS Viability Report/i.test(issued[0].title), issued[0]?.title);
  check("the person who issued it is not told", (await toldTo(ME, projectId, "issued", 3)).length === 0);
  check("with no email service, the row says why it was not emailed", /not configured/.test(issued[0]?.email_error ?? ""), issued[0]?.email_error);

  // ── Something for me, found by the bell ──────────────────────────────────────────────────
  // A colleague's sign-off on this project, as `toldSignedOff` writes it; and beside it a retired
  // kind – an old work-item deadline – which must not be shown, because its page no longer exists.
  await sql`insert into notifications (recipient, actor, project_id, kind, title, href)
            values (${ME}, ${COLLEAGUE}, ${projectId}, 'signed', 'Thandi Notify signed off the Feasibility Estimate', ${`/projects/${projectId}/feasibility`}),
                   (${ME}, ${COLLEAGUE}, ${projectId}, 'due', '#2 Send the cost plan is due tomorrow', ${`/projects/${projectId}/work?item=2`})`;
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
  await page.click('[data-action="notifications"]');
  await page.waitForSelector('[data-region="notifications"] [data-notification]', { timeout: 20000 });
  const items = await page.$$eval('[data-region="notifications"] [data-notification]', (l) => l.map((e) => [e.getAttribute("data-notification"), e.innerText.replace(/\s+/g, " ")]));
  check("opening the bell finds the sign-off", items.some(([k, t]) => k === "signed" && /signed off the Feasibility Estimate/.test(t)), items.map((i) => i[1]).join(" | ").slice(0, 200));
  check("and does not show a retired work-item deadline", !items.some(([k]) => k === "due"), items.map((i) => i[0]).join(", "));
  check("and counts it as unread", /\d+ unread/.test(await page.$eval('[data-region="notifications"] header', (e) => e.innerText)));
  check("it says email is not set up on this platform", Boolean(await page.$('[data-region="notifications-email-off"]')));

  await page.click('[data-action="notifications-email"]');
  const t0 = Date.now();
  let setting;
  for (let i = 0; i < 40 && setting?.email !== false; i++) {
    [setting] = await sql`select email from notification_settings where recipient = ${ME}`;
    if (setting?.email !== false) await pause(250);
  }
  console.log(`    email switch saved in ${Date.now() - t0} ms`);
  check("turning email off is kept for this person", setting?.email === false);

  const mine = await page.$(`[data-region="notifications"] [data-notification="signed"] a[href="/projects/${projectId}/feasibility"]`);
  await mine.click();
  await page.waitForFunction((p) => location.pathname === `/projects/${p}/feasibility`, { timeout: 30000 }, projectId);
  check("a notification opens where the thing is", true);
  const [seen] = await sql`select read_at from notifications where recipient = ${ME} and kind = 'signed' and project_id = ${projectId}`;
  check("and is marked read as it does", seen?.read_at !== null);

  await sql`update notifications set read_at = null where recipient = ${ME}`;
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
  await page.click('[data-action="notifications"]');
  await page.waitForSelector('[data-region="notifications"] [data-notification]', { timeout: 20000 });
  const before = await page.$eval('[data-action="notifications"]', (b) => b.getAttribute("aria-label"));
  await page.click('[data-action="notifications-read-all"]');
  await page.waitForFunction(() => !document.querySelector('[data-region="notifications-count"]'), { timeout: 10000 });
  check("mark all read clears the count", /unread/.test(before ?? ""), before);

  check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));
} finally {
  await browser.close();
  await sql.end();
}

console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} failed.`);
process.exit(fails ? 1 : 0);
