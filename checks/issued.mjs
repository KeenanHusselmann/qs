/**
 * Issuing a document, and the two registers that read it back — §4.11, §1.3.1, §6.1.
 *
 * ── What is actually at risk here ──────────────────────────────────────────────────────────
 *
 * Downloading a report generates it live, and that is right: a live document cannot contradict the
 * figures, because it is derived from them. Issuing is the other act — it says *this is what we
 * sent* — and the whole value of it is that the bytes never move again.
 *
 * So the assertion that matters is not that a row appears in a list. It is that the bytes handed
 * back months later are the **same bytes**, byte for byte, and that the signatures the document was
 * generated from are still named. A register that quietly re-generates on download would look
 * identical on screen and would have destroyed the only thing it was built for.
 *
 * ── Why the run is seeded ──────────────────────────────────────────────────────────────────
 *
 * Same reason `bill.mjs` seeds one: a real draft costs DeepSeek credits and this runs many times a
 * day. §1.3's "no seed data" is about what a *user* sees; a check's fixtures are the check.
 *
 * ── And why the refusal is checked ─────────────────────────────────────────────────────────
 *
 * `issueDocument` refuses when there is no bill, and refuses when the bytes cannot be kept. The
 * second is the one that matters most and is the one nobody would notice breaking: a row written
 * against storage that failed would leave the practice believing it had a copy of what it sent, and
 * finding out otherwise on the day it mattered. The first is checked here because it is reachable;
 * the second is asserted in the unit tests, where storage can be made to fail.
 */

import postgres from "postgres";
import puppeteer from "puppeteer";

import { createProject, readEnv, signIn, watchConsole } from "./helpers.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const BILL = "/bill";
const env = readEnv();
const sql = postgres(env.DATABASE_URL, { max: 1 });

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 250)));
watchConsole(page);

try {
  await signIn(page, env);

  const name = "Issued " + Date.now();
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
  const { href } = await createProject(page, name);
  const projectId = href.split("/").filter(Boolean).pop();

  // ── The refusal, before there is anything to issue ────────────────────────────────────────
  await page.goto(`${BASE}${href}/report`, { waitUntil: "networkidle0" });
  await page.evaluate(() => {
    [...document.querySelectorAll("button")]
      .find((b) => /issue the bill/i.test(b.textContent ?? ""))
      ?.click();
  });
  await page
    .waitForFunction('document.body.innerText.includes("no bill to issue")', { timeout: 20000 })
    .catch(() => {});
  const refusal = await page.$eval("body", (el) => el.innerText);
  check(
    "issuing a bill that does not exist is refused, and says what to do",
    /no bill to issue/i.test(refusal) && /bill of quantities/i.test(refusal),
    refusal.match(/There is no bill[^\n]*/)?.[0] ?? "no refusal shown",
  );
  check(
    "and nothing was written to the register",
    (await sql`select count(*)::int as n from issued_documents where project_id = ${projectId}`)[0]
      .n === 0,
  );

  // ── A signed step and a bill to issue ─────────────────────────────────────────────────────
  const [signedRun] = await sql`
    insert into runs (project_id, module, status, signed_by, signed_at, created_by)
    values (${projectId}, '/feasibility', 'review', ${env.DEV_USER_EMAIL}, now(), ${env.DEV_USER_EMAIL})
    returning id`;
  await sql`
    insert into run_fields (run_id, field_id, seq, label, proposed_state, proposed_value, output_value)
    values (${signedRun.id}, 'erf', 1, 'Erf', 'found', 'Erf 180', 'Erf 180')`;

  const [billRun] = await sql`
    insert into runs (project_id, module, status, created_by)
    values (${projectId}, ${BILL}, 'review', ${env.DEV_USER_EMAIL})
    returning id`;
  await sql`
    insert into run_items (run_id, seq, row_type, proposed_description,
                           proposed_quantity, proposed_rate, proposed_rate_precision)
    values (${billRun.id}, 100, 'item', 'Mass concrete in foundations', '12.5000', 185000, 2),
           (${billRun.id}, 200, 'item', 'Brickwork in superstructure',  '48.0000', 92500, 2)`;

  // ── Issue it ──────────────────────────────────────────────────────────────────────────────
  await page.goto(`${BASE}${href}/report`, { waitUntil: "networkidle0" });
  await page.evaluate(() => {
    [...document.querySelectorAll("button")]
      .find((b) => /issue the bill/i.test(b.textContent ?? ""))
      ?.click();
  });
  await page.waitForFunction('document.body.innerText.includes("is issued and kept")', {
    timeout: 30000,
  });

  const [issued] = await sql`
    select id, kind, byte_size, issued_by, signed_run_ids, withdrawn_at
      from issued_documents where project_id = ${projectId}`;

  check("the bill is in the register", issued?.kind === "bill_of_quantities");
  check("attributed to whoever issued it", issued?.issued_by === env.DEV_USER_EMAIL);
  check(
    "and it names the signed run it was generated from",
    issued?.signed_run_ids?.length === 1 && issued.signed_run_ids[0] === signedRun.id,
    `${issued?.signed_run_ids?.length ?? 0} run(s)`,
  );

  // ── The whole point: the bytes do not move ────────────────────────────────────────────────
  const asIssued = async (id) =>
    page.evaluate(async (url) => {
      const response = await fetch(url);
      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      return {
        status: response.status,
        type: response.headers.get("content-type"),
        length: bytes.length,
        head: String.fromCharCode(...bytes.slice(0, 4)),
        // Not the length twice: a re-generation of the same bill would very likely match on
        // length and differ somewhere in the middle.
        sum: bytes.reduce((total, byte) => (total + byte) % 2147483647, 0),
      };
    }, `${href}/report/pdf?issued=${id}`);

  const first = await asIssued(issued.id);
  check("it downloads as a PDF", first.status === 200 && first.head === "%PDF", first.type ?? "");
  check(
    "of exactly the size that was stored",
    first.length === issued.byte_size,
    `${first.length} B served, ${issued.byte_size} B stored`,
  );

  /*
    Move the bill underneath it, then download again.

    This is the assertion the register exists for. If anything re-generates on download, the rate
    change lands in the served bytes and the checksum moves — and the practice's record of what it
    sent would have silently become a record of what it would send today.
  */
  await sql`update run_items set override_rate = 999900, override_rate_precision = 2,
                                 override_by = ${env.DEV_USER_EMAIL}, override_at = now(),
                                 override_reason = 'probe'
              where run_id = ${billRun.id} and seq = 100`;

  const second = await asIssued(issued.id);
  check(
    "and it is still byte-for-byte what was issued, after the bill moved",
    second.length === first.length && second.sum === first.sum,
    `${first.length} B/${first.sum} → ${second.length} B/${second.sum}`,
  );

  // ── Withdrawn, not deleted ────────────────────────────────────────────────────────────────
  await page.goto(`${BASE}${href}/report`, { waitUntil: "networkidle0" });
  await page.evaluate(() => {
    [...document.querySelectorAll("button")]
      .find((b) => /^withdraw$/i.test((b.textContent ?? "").trim()))
      ?.click();
  });
  await page.waitForFunction('document.body.innerText.includes("Withdrawn")', { timeout: 20000 });

  const [afterWithdrawal] = await sql`
    select withdrawn_at, withdrawn_by from issued_documents where id = ${issued.id}`;
  check(
    "withdrawing records who and when",
    afterWithdrawal.withdrawn_at !== null && afterWithdrawal.withdrawn_by === env.DEV_USER_EMAIL,
  );
  check(
    "the row is kept, not deleted",
    (await sql`select count(*)::int as n from issued_documents where id = ${issued.id}`)[0].n === 1,
  );

  const third = await asIssued(issued.id);
  check(
    "and a withdrawn document still downloads as it was sent",
    third.status === 200 && third.sum === first.sum,
    "a report that was sent cannot be unsent",
  );

} finally {
  await browser.close();
  await sql.end();
}

console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} failed.`);
process.exit(fails === 0 ? 0 : 1);
