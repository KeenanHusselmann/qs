/**
 * Quotations – an RFQ, its responses checked and compared, and a recommendation (D1.3).
 *
 *     node checks/rfq.mjs
 *
 * The RFQ is started through the page; two responses are seeded with results the platform's own
 * checker made (`fixtures/rfq-results.mts` – no model call), and the rest is driven through the
 * page: the recommendation and its rule, the corrected price beside the stated one, the arithmetic
 * error in the line check, a respondent whose name is not in its text named by the QS, a decision
 * against the recommendation refused without a reason and recorded with one, and the evaluation
 * report issued and read back.
 */

import { execFileSync } from "node:child_process";
import { inflateRawSync, inflateSync } from "node:zlib";

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

const fixture = JSON.parse(execFileSync("npx", ["tsx", "checks/fixtures/rfq-results.mts"], { encoding: "utf8", shell: true }));

const sql = postgres(env.DATABASE_URL, { max: 1 });
const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1200 });
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));
const consoleErrors = watchConsole(page);
const text = (s) => page.$eval(s, (e) => e.innerText.replace(/ /g, " "));
const setField = (selector, value) =>
  page.$eval(
    selector,
    (el, v) => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    value,
  );

/** One entry of a zip (an .xlsx is a zip of XML), as text. */
function inflateEntry(zip, name) {
  const target = Buffer.from(name);
  for (let at = 0; (at = zip.indexOf("PK", at)) >= 0; at += 4) {
    const nameLength = zip.readUInt16LE(at + 26);
    const extraLength = zip.readUInt16LE(at + 28);
    const start = at + 30;
    if (!zip.subarray(start, start + nameLength).equals(target)) continue;
    const body = zip.subarray(start + nameLength + extraLength);
    try {
      return inflateRawSync(body, { finishFlush: 2 }).toString("utf8");
    } catch {
      return "";
    }
  }
  return "";
}

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
  const { href } = await createProject(page, "Quotations " + Date.now(), BASE, 2);
  const projectId = href.split("/").pop();

  await page.goto(`${BASE}${href}/rfq`, { waitUntil: "networkidle0" });
  check("the step is in the navigation", Boolean(await page.$(`a[href="${href}/rfq"]`)));
  check("with no RFQ, the page offers to start one", Boolean(await page.$('[data-region="rfq-form"]')));
  check("with the usual requirements filled in", /Professional indemnity insurance/.test(await page.$eval('textarea[name="requirements"]', (t) => t.value)));

  await setField('input[name="title"]', "Civil and structural engineering services");
  await setField('textarea[name="scope"]', fixture.scope.join("\n"));
  await setField('textarea[name="requirements"]', fixture.requirements.join("\n"));
  await page.click('[data-action="save-rfq"]');
  await page.waitForSelector("[data-rfq]", { timeout: 15000 });
  const [rfq] = await sql`select id, scope, requirements from rfqs where project_id = ${projectId} and deleted_at is null`;
  check("the RFQ is kept with its scope and requirements", rfq && rfq.scope.length === 2 && rfq.requirements.length === 2);
  check("and says it has no responses yet", /No responses yet/.test(await text('[data-region="rfq-responses"]')));

  // Two responses, as the checker left them.
  for (const [name, result] of [
    ["Alpha fee proposal.pdf", fixture.alpha],
    ["Beta quotation.pdf", fixture.beta],
  ]) {
    const [d] = await sql`insert into documents (project_id, filename, kind) values (${projectId}, ${name}, 'Quotation') returning id`;
    await sql`insert into rfq_responses (rfq_id, document_id, result, evaluated_at, input_tokens, output_tokens, created_by) values (${rfq.id}, ${d.id}, ${sql.json(result)}, now(), 0, 0, ${env.DEV_USER_EMAIL})`;
  }
  await page.goto(`${BASE}${href}/rfq`, { waitUntil: "networkidle0" });

  check("both responses are listed", (await page.$$("[data-response]")).length === 2);
  const headline = await text('[data-region="rfq-headline"]');
  check("the response covering the whole scope is recommended", /Alpha Consulting Engineers/.test(headline), headline);
  check("provisionally, as the two price different scopes", /provisional/i.test(headline) || /not comparable|different scope/i.test(await text('[data-region="rfq-recommendation"]')));
  const alphaTotal = await text('[data-corrected="Alpha Consulting Engineers"]');
  check("the price is shown with its arithmetic corrected, and by how much", /R 650 000,00/.test(alphaTotal) && /R 10 000,00 on the stated price/.test(alphaTotal), alphaTotal);
  check("the line check marks the total that does not add up", Boolean(await page.$('[data-line-check="Alpha Consulting Engineers"] tr[data-verdict="error"]')));
  const clar = await text('[data-region="rfq-clarifications"]');
  check("the clarifications ask Alpha about its total and Beta about structural", /Alpha Consulting Engineers/.test(clar) && /Beta quotation/.test(clar) && /structural/i.test(clar), clar.slice(0, 300));
  check("a respondent whose name is not in its text is marked to be named", /name it here/.test(await text('[data-response="Beta quotation"]')));

  /*
    The rest of a submission.

    A firm sends its price in one document and its registrations in another. Attached to the
    response they are read together; filed as responses of their own they would be respondents
    with no price, and the ranking would compare a submission with parts of itself.
  */
  const [extra] = await sql`insert into documents (project_id, filename, kind) values (${projectId}, 'Alpha technical proposal.pdf', 'Quotation') returning id`;
  await sql`insert into passages (document_id, project_id, seq, page, body) values (${extra.id}, ${projectId}, 1, 1, 'Alpha Consulting Engineers is registered with ECSA, number 20100276.')`;
  await page.reload({ waitUntil: "networkidle0" });
  await page.select('select[aria-label="Add a response already filed"]', extra.id).catch(() => {});
  await page.goto(`${BASE}${href}/rfq`, { waitUntil: "networkidle0" });
  const alphaId = (await sql`select r.id from rfq_responses r join documents d on d.id = r.document_id where r.rfq_id = ${rfq.id} and d.filename like 'Alpha fee%'`)[0].id;
  await sql`insert into rfq_response_documents (response_id, document_id, created_by) values (${alphaId}, ${extra.id}, ${env.DEV_USER_EMAIL}) on conflict do nothing`;
  await page.goto(`${BASE}${href}/rfq`, { waitUntil: "networkidle0" });
  check("a supporting document is shown against the response it belongs to", /Alpha technical proposal\.pdf/.test(await text('[data-response="Alpha Consulting Engineers"]')));
  check("and says it is read with the priced document", /read with the priced document/.test(await text('[data-region="supporting"]')));
  /*
    Read without a `.catch`, on purpose.

    This swallowed a missing selector and returned []. `!\[\].some(...)` is true, so the assertion
    below passed by finding nothing at all - and went on passing after the picker was renamed,
    which is the precise shape of a test that has stopped testing. If the control is gone the
    suite should say so.
  */
  const offered = await page.$$eval('select[aria-label="Add a response already filed"] option', (os) => os.map((o) => o.textContent ?? ""));
  check("the attached proposal is no longer offered as a response of its own", !offered.some((o) => /technical proposal/.test(o)), offered.join(" | ") || "the picker is empty, which is also not offering it");

  /*
    ── One firm's submission, never another's ────────────────────────────────────────────────

    Setting up a real RFQ, three competing engineering proposals were attached to one another as
    supporting documents: the picker offered every filed document, and a script took it at its
    word. A response read together with a rival's fee is an evaluation of neither - the reader is
    shown one firm's name over two firms' money, and the prices are the whole point.

    Asserted on both halves, because the picker is a convenience and the rule is not.
  */
  // A document that is neither a response nor already attached, so the picker actually renders -
  // an empty picker would pass the assertion below by having nothing to offer at all.
  await sql`insert into documents (project_id, filename, kind) values (${projectId}, 'Alpha programme.pdf', 'Draft programme')`;
  await page.goto(`${BASE}${href}/rfq`, { waitUntil: "networkidle0" });

  const attachable = await page.$$eval(
    '[data-response="Alpha Consulting Engineers"] select[data-action="attach-filed"] option',
    (os) => os.map((o) => o.textContent ?? ""),
  );
  check("the supporting picker offers what is filed", attachable.some((o) => /Alpha programme/.test(o)), attachable.join(" | "));
  check("but never another response to the same RFQ", !attachable.some((o) => /Beta quotation/.test(o)), attachable.join(" | "));



  // The QS names it.
  const nameInput = '[data-response="Beta quotation"] input[aria-label="Respondent"]';
  await page.focus(nameInput);
  await setField(nameInput, "Beta Engineering (Pty) Ltd");
  await page.$eval(nameInput, (el) => el.blur());
  await page.waitForFunction(() => document.querySelector('[data-response="Beta Engineering (Pty) Ltd"]'), { timeout: 15000 });
  const [named] = await sql`select supplier from rfq_responses where rfq_id = ${rfq.id} and supplier is not null`;
  check("the name is kept", named?.supplier === "Beta Engineering (Pty) Ltd");
  check("and the recommendation speaks it", /Beta Engineering \(Pty\) Ltd/.test(await text('[data-region="rfq-clarifications"]')));

  // Deciding against the recommendation needs a reason.
  const betaId = (await sql`select id from rfq_responses where rfq_id = ${rfq.id} and supplier is not null`)[0].id;
  await page.select('[data-region="rfq-decision"] select[name="decision"]', betaId);
  await page.click('[data-action="decide"]');
  await page.waitForSelector('[data-region="rfq-decision"] [role="alert"]', { timeout: 10000 });
  check("a decision against the recommendation is refused without a reason", !(await sql`select decided_at from rfqs where id = ${rfq.id}`)[0].decided_at);
  await setField('[data-region="rfq-decision"] input[name="reason"]', "Structural to be let separately");
  await page.click('[data-action="decide"]');
  await page.waitForFunction(() => /against the recommendation/.test(document.querySelector('[data-region="rfq-decision"]')?.innerText ?? ""), { timeout: 15000 });
  const [decided] = await sql`select decided_response_id, decision_reason from rfqs where id = ${rfq.id}`;
  check("and recorded with one", decided.decided_response_id === betaId && decided.decision_reason === "Structural to be let separately");

  // The evaluation report.
  await page.click('[data-action="issue-rfq-report"]');
  await page.waitForSelector('[data-action="download-rfq-report"]', { timeout: 20000 });
  const pdfHref = await page.$eval('[data-action="download-rfq-report"]', (a) => a.getAttribute("href"));
  const pdf = pdfText(await page.evaluate(async (h) => [...new Uint8Array(await (await fetch(h)).arrayBuffer())], pdfHref));
  check("the report names itself, the RFQ and the respondents", /Evaluation of quotations/.test(pdf) && /Civil and structural engineering services/.test(pdf) && /Alpha Consulting Engineers/.test(pdf) && /Beta Engineering/.test(pdf));
  check("it carries the stated and corrected prices and the recommendation", /660 000,00/.test(pdf) && /650 000,00/.test(pdf) && /Recommendation/.test(pdf));
  check("the decision against the recommendation, with its reason", /against the recommendation/.test(pdf) && /Structural to be let separately/.test(pdf));
  const [issued] = await sql`select kind, signed_run_ids from issued_documents where project_id = ${projectId}`;
  check("and it is in the issued register", issued?.kind === "rfq_evaluation");

  /*
    The comparative workbook: the same findings in the sheet the QS works in afterwards.

    Both issue buttons are disabled while either is working, so the click has to wait for the
    report above to finish or it lands on a disabled button and does nothing — which is exactly
    how this failed on CI at thirty seconds while passing here every time. Waiting for the button
    rather than for a longer timeout is the difference between a fix and a plaster.
  */
  await page.waitForFunction(() => document.querySelector('[data-action="issue-rfq-workbook"]')?.disabled === false, { timeout: 60000 });
  await page.click('[data-action="issue-rfq-workbook"]');
  await page.waitForFunction(() => /Comparative evaluation/.test(document.querySelector('[data-action="download-rfq-report"]')?.textContent ?? ""), { timeout: 120000 });
  const bookHref = await page.$eval('[data-action="download-rfq-report"]', (a) => a.getAttribute("href"));
  const book = await page.evaluate(async (h) => {
    const response = await fetch(h);
    return { type: response.headers.get("content-type"), bytes: [...new Uint8Array(await response.arrayBuffer())] };
  }, bookHref);
  const bytes = Buffer.from(book.bytes);
  check(
    "the workbook downloads as a workbook, not as a PDF",
    book.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" && bytes.subarray(0, 2).toString() === "PK",
    `${book.type}, ${bytes.length} bytes`,
  );
  // A zip of XML: the sheet names are in xl/workbook.xml, which is stored deflated.
  const names = inflateEntry(bytes, "xl/workbook.xml");
  check("holding the sheets these responses support", /Fee Recalculation/.test(names) && /Gaps and Anomalies/.test(names) && /Clarifications/.test(names), (names.match(/name="[^"]+"/g) ?? []).join(" "));
  const [workbookRow] = await sql`select kind from issued_documents where project_id = ${projectId} and kind = 'rfq_comparison'`;
  check("and it is in the register as its own kind", Boolean(workbookRow));

  check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
  await sql.end();
}

console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} failed.`);
process.exit(fails ? 1 : 0);
