/**
 * Payment certificates – issued documents.
 *
 *     node checks/certificates.mjs
 *
 * ── What this proves ───────────────────────────────────────────────────────────────────────
 *
 * That a signed valuation issues a payment certificate whose figures are the signed figures added
 * up in the order they print – gross, retention at the rate within the contract's limit, previously
 * certified, VAT, amount due – that the bytes sent are kept in the register, and that the same
 * certificate cannot be issued twice while the first is current. (The certificate of practical
 * completion went with the Handover step in the simplification of 16 Nov 2026.)
 *
 * The PDFs are opened and read – inflated and searched for the figures – because a certificate
 * that renders is not the same as a certificate that says the right thing.
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

/** Every text-showing operator's string, from every deflated content stream in a PDF. */
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
      for (const m of body.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)) out.push(m[1].replace(/\\([()\\])/g, "$1"));
    } catch {
      // not a deflated stream
    }
    at = end + 10;
  }
  return out.join("\n").replace(/\xa0/g, " ");
}

async function signedFields(projectId, module, fields) {
  const [run] = await sql`
    insert into runs (project_id, module, status, input_tokens, output_tokens, created_by, signed_by, signed_at)
    values (${projectId}, ${module}, 'review', 100, 50, ${env.DEV_USER_EMAIL}, ${env.DEV_USER_EMAIL}, now())
    returning id`;
  let seq = 0;
  for (const [id, label, value] of fields) {
    await sql`
      insert into run_fields (run_id, field_id, seq, label, proposed_state, proposed_value, proposed_confidence, source_document, source_excerpt, output_value)
      values (${run.id}, ${id}, ${seq++}, ${label}, 'found', ${value}, 0.9, 'doc.pdf', ${`the passage ${id} was read from`}, ${value})`;
  }
  return run.id;
}

const fetchPdf = (href) =>
  page.evaluate(async (h) => {
    const r = await fetch(h);
    return { status: r.status, type: r.headers.get("content-type"), bytes: [...new Uint8Array(await r.arrayBuffer())] };
  }, href);

try {
  await signIn(page, env);
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
  const { href } = await createProject(page, "Certificates " + Date.now(), BASE, 4);
  const projectId = href.split("/").pop();

  await signedFields(projectId, "/contract", [
    ["ct-form", "Contract form and edition", "JBCC Principal Building Agreement, edition 6.2"],
    ["ct-contractor", "Contractor", "Ridgeview Builders (Pty) Ltd"],
    ["ct-sum", "Contract sum", "R 1 200 000,00"],
    ["ct-retention", "Retention percentage", "10%"],
    ["ct-retention-limit", "Retention limit", "R 50 000,00"],
    ["ct-completion", "Practical completion date", "30 April 2027"],
    ["ct-penalty", "Penalty for late completion", "R 4 200,00 per calendar day"],
  ]);
  await signedFields(projectId, "/valuations", [
    ["vl-number", "Certificate number", "1"],
    ["vl-period", "Valuation period end", "30 September 2026"],
    ["vl-work-executed", "Value of work executed", "R 230 000,00"],
    ["vl-materials", "Materials on site", "R 20 000,00"],
  ]);
  // Certificate 2 states no "previously certified": it is the net of certificate 1, and says so.
  await signedFields(projectId, "/valuations", [
    ["vl-number", "Certificate number", "2"],
    ["vl-period", "Valuation period end", "31 October 2026"],
    ["vl-work-executed", "Value of work executed", "R 400 000,00"],
    ["vl-variations", "Approved variations included", "R 15 000,00"],
    ["vl-dayworks", "Dayworks", "R 5 000,00"],
    ["vl-materials", "Materials on site", "R 30 000,00"],
  ]);

  // ── Issued from the signed valuation ──────────────────────────────────────────────────────
  await page.goto(`${BASE}${href}/valuations`, { waitUntil: "networkidle0" });
  check("a signed valuation offers its payment certificate", Boolean(await page.$('[data-action="issue-certificate"]')));
  await page.click('[data-action="issue-certificate"]');
  await page.waitForSelector('[data-action="download-certificate"]', { timeout: 20000 });
  check("issuing keeps it and offers the copy sent", /Payment certificate issued/.test(await page.$eval('[data-region="issue-certificate"]', (e) => e.innerText)));

  const link = await page.$eval('[data-action="download-certificate"]', (a) => a.getAttribute("href"));
  const pdf = await fetchPdf(link);
  check("the download is the PDF", pdf.status === 200 && pdf.type === "application/pdf", `${pdf.status} ${pdf.type}`);
  const text = pdfText(pdf.bytes);
  /*
    Certificate 2 by hand: 400 000 + 15 000 + 5 000 + 30 000 = 450 000 gross. Retention at 10% is
    45 000, within the 50 000 limit. Certificate 1's net was 250 000 − 25 000 = 225 000. Due before
    VAT 450 000 − 45 000 − 225 000 = 180 000; VAT 27 000; due 207 000.
  */
  const has = (s) => text.includes(s);
  check("it is certificate 2 for the period to 31 Oct 2026", has("No. 2 · valuation to 31 Oct 2026"), text.slice(0, 200).replace(/\n/g, " | "));
  check("the parties come from the signed contract", has("Ridgeview Builders (Pty) Ltd") && has("JBCC Principal Building Agreement, edition 6.2"));
  check("gross is work executed, variations, dayworks and materials", has("R 450 000,00"));
  check("retention at the rate, within the limit", has("Less retention at 10%") && has("(R 45 000,00)"));
  check("previously certified is certificate 1's net, and says so", has("net of the certificate before") && has("(R 225 000,00)"));
  check("VAT and the amount due", has("R 180 000,00") && has("R 27 000,00") && has("R 207 000,00"));
  check("the certifier is named", /Certified by\n\S/.test(text));

  const [row] = await sql`select kind, signed_run_ids from issued_documents where project_id = ${projectId}`;
  check("the register records what it rests on – the one valuation", row?.kind === "payment_certificate" && row.signed_run_ids.length === 1);

  // ── And the payment certificate cannot be issued twice ────────────────────────────────────
  await page.goto(`${BASE}${href}/valuations`, { waitUntil: "networkidle0" });
  check("an issued certificate offers its download, not a second issue", Boolean(await page.$('[data-action="download-certificate"]')) && !(await page.$('[data-action="issue-certificate"]')));

  check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));
} finally {
  await browser.close();
  await sql.end();
}

console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} failed.`);
process.exit(fails ? 1 : 0);
