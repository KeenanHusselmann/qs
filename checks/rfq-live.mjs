/**
 * Quotations, live – two real fee proposals filed, read, checked and compared (D1.3).
 *
 *     node checks/rfq-live.mjs [--show] [--out <folder>]
 *
 * Spends model credits, so it is not in `npm run check`. A fresh project; the RFQ for the Marshall
 * Dam engineering services started through the page; the two proposals filed through its upload;
 * both evaluated; and the findings the practice's own review of them made asserted on the page –
 * Lemken's subtotal leaving out the R9 000 000 bulk earthworks, MUTEC's total R440 out, MUTEC's
 * structural stage table not adding up, the scope each covers, the facts they disagree on. Then
 * the evaluation report issued and saved to `--out` (the proposals' folder where omitted).
 */

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

import { config } from "dotenv";
import postgres from "postgres";
import puppeteer from "puppeteer";

import { createProject, readEnv, signIn } from "./helpers.mjs";

config({ path: ".env.local", quiet: true });
const env = readEnv();
const BASE = "http://localhost:3000";
// The proposals live outside the repository – they are a client's. `--dir` or RFQ_PROPOSALS says
// where they are; the default is where they were when this check was written.
const dirAt = process.argv.indexOf("--dir");
const DIR = (dirAt > 0 ? process.argv[dirAt + 1] : process.env.RFQ_PROPOSALS) ?? "C:\\Users\\keena\\Downloads\\Mzilikazi-QS-Services\\Mzilikazi-QS-Services";
const FILES = ["J0140_01_000_Marshall Dam residence - fee proposal Rev 0.pdf", "Fees Proposal - Marshall Dam Development.pdf"].map((f) => join(DIR, f));
const show = process.argv.includes("--show");
const outAt = process.argv.indexOf("--out");
const OUT = outAt > 0 ? process.argv[outAt + 1] : DIR;

for (const f of FILES) if (!existsSync(f)) throw new Error(`Missing ${f}. Pass --dir <folder>, or set RFQ_PROPOSALS.`);

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};
const setField = (page, selector, value) =>
  page.$eval(
    selector,
    (el, v) => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
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

const sql = postgres(env.DATABASE_URL, { max: 1 });
const browser = await puppeteer.launch({ headless: !show, defaultViewport: null, args: show ? ["--window-size=1500,1000"] : [], slowMo: show ? 25 : 0 });
const page = await browser.newPage();
if (!show) await page.setViewport({ width: 1440, height: 1200 });
page.setDefaultTimeout(60000);
const text = (s) => page.$eval(s, (e) => e.innerText.replace(/ /g, " "));

try {
  await signIn(page, env);
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
  const { href } = await createProject(page, "Marshall Dam engineering RFQ " + Date.now(), BASE, 2);
  const projectId = href.split("/").pop();
  console.log(`  project ${BASE}${href}/rfq`);

  await page.goto(`${BASE}${href}/rfq`, { waitUntil: "networkidle0" });
  await setField(page, 'input[name="title"]', "Civil and structural engineering services – Marshall Dam Development");
  await setField(
    page,
    'textarea[name="scope"]',
    ["Civil engineering design of internal services (roads, stormwater, water, sewer)", "Structural engineering design", "Construction monitoring and contract administration (ECSA stage 5)"].join("\n"),
  );
  await page.click('[data-action="save-rfq"]');
  await page.waitForSelector("[data-rfq]");

  const input = await page.$('input[data-action="file-quotations"]');
  await input.uploadFile(...FILES);
  await page.waitForFunction(() => document.querySelectorAll("[data-response]").length === 2, { timeout: 180000 });
  check("both proposals filed as responses", true);

  // Text extraction finishes shortly after filing; evaluate once both have text.
  for (let i = 0; i < 60; i++) {
    const [{ n }] = await sql`select count(distinct p.document_id)::int as n from passages p join documents d on d.id = p.document_id where d.project_id = ${projectId}`;
    if (n >= 2) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  const t = Date.now();
  await page.click('[data-action="evaluate-all"]');
  await page.waitForSelector('[data-region="rfq-recommendation"]', { timeout: 600000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-line-check]').length === 2 && !/Reading and checking/.test(document.body.innerText), { timeout: 600000 });
  console.log(`  evaluated in ${((Date.now() - t) / 1000).toFixed(0)}s`);

  const rows = await sql`select d.filename, r.result, r.input_tokens, r.output_tokens, r.error from rfq_responses r join documents d on d.id = r.document_id where r.rfq_id = (select id from rfqs where project_id = ${projectId})`;
  const lemken = rows.find((r) => /J0140/.test(r.filename))?.result;
  const mutec = rows.find((r) => /Fees Proposal/.test(r.filename))?.result;
  for (const r of rows) console.log(`  ${r.filename}: ${r.input_tokens} in / ${r.output_tokens} out${r.error ? ` – ${r.error}` : ""}`);

  const err = (r, re) => r?.lines.some((l) => l.verdict === "error" && re.test(l.label));
  check("Lemken: the subtotal leaves out the R9 000 000", Boolean(lemken?.lines.find((l) => l.verdict === "error" && Math.abs(l.computed - l.stated) === 900_000_000)), lemken?.errors.map((e) => e.label).join(" | "));
  check("Lemken: the lines under it change once corrected", lemken?.lines.some((l) => l.verdict === "consequential"));
  check("Lemken: the fee table shown only as an image is reported not checked", (lemken?.unseen ?? []).length > 0, (lemken?.unseen ?? []).join(" | "));
  check("MUTEC: the total is R440 out", Boolean(mutec?.lines.find((l) => l.verdict === "error" && Math.abs(l.computed - l.stated) === 44_000)), mutec?.errors.map((e) => e.label).join(" | "));
  check("MUTEC: the structural stage table does not add up", err(mutec, /stage|structural/i), mutec?.errors.map((e) => `${e.label} ${e.stated}/${e.computed}`).join(" | "));
  check("Lemken covers civil only; MUTEC all three", lemken?.scope.filter((s) => s.status === "included").length === 1 && mutec?.scope.filter((s) => s.status === "included").length === 3, `${lemken?.scope.map((s) => s.status)} / ${mutec?.scope.map((s) => s.status)}`);
  const headline = await text('[data-region="rfq-headline"]');
  check("the recommendation: MUTEC provisionally, as the scopes differ", /provisional/i.test(headline) && !/J0140|Lemken/.test(headline.split("provisionally")[0].split(".").pop() ?? ""), headline);
  const matrix = await text('[data-region="rfq-comparison"]');
  check("the facts they disagree on are shown", /Site extent/i.test(matrix));
  check("like for like on the civil design", /Like for like/i.test(matrix));

  await page.click('[data-action="issue-rfq-report"]');
  await page.waitForSelector('[data-action="download-rfq-report"]', { timeout: 60000 });
  const pdfHref = await page.$eval('[data-action="download-rfq-report"]', (a) => a.getAttribute("href"));
  const bytes = Buffer.from(await page.evaluate(async (h) => [...new Uint8Array(await (await fetch(h)).arrayBuffer())], pdfHref));
  const pdf = pdfText(bytes);
  check("the report carries the recommendation and every line check", /Recommendation/.test(pdf) && /every price line checked/.test(pdf));
  const file = join(OUT, "Marshall Dam - Engineering RFQ - Platform evaluation of quotations.pdf");
  writeFileSync(file, bytes);
  console.log(`  report saved: ${file}`);
  if (show) await page.evaluate(() => document.querySelector('[data-region="rfq-recommendation"]')?.scrollIntoView({ block: "start" }));
  if (show) await new Promise((r) => setTimeout(r, 8000));
} finally {
  await browser.close();
  await sql.end();
}

console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} failed.`);
process.exit(fails ? 1 : 0);
