/**
 * Cash Flow – D1.7.
 *
 *     node checks/cash-flow.mjs
 *
 * ── What this proves ───────────────────────────────────────────────────────────────────────
 *
 * That the page is a lens over three signatures and nothing else: with no contract it phases
 * nothing and says why; with a signed contract, a signed programme and two signed valuations it
 * phases the contract sum over the baseline, turns the certificates into monthly draws, and
 * re-forecasts the remainder – and every column sums to what it should.
 *
 * The signatures are seeded in SQL, as `checks/chain.mjs` seeds a signed estimate: a real
 * contract run reads documents through the model and costs money, and what this page does with a
 * signed figure is the same whether a model or a fixture produced it.
 */

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

const text = async (selector) => page.$eval(selector, (e) => e.innerText.replace(/ /g, " "));

/** A signed field run with its output values – the shape every field step leaves behind. */
async function signedFields(projectId, module, fields) {
  const [run] = await sql`
    insert into runs (project_id, module, status, input_tokens, output_tokens, created_by, signed_by, signed_at)
    values (${projectId}, ${module}, 'review', 100, 50, ${env.DEV_USER_EMAIL}, ${env.DEV_USER_EMAIL}, now())
    returning id`;
  let seq = 0;
  for (const [id, label, value] of fields) {
    await sql`
      insert into run_fields (run_id, field_id, seq, label, proposed_state, proposed_value, proposed_confidence, source_document, source_excerpt, output_value)
      values (${run.id}, ${id}, ${seq++}, ${label}, 'found', ${value}, 0.9, 'contract.pdf', ${`the passage ${id} was read from`}, ${value})`;
  }
  return run.id;
}

try {
  await signIn(page, env);
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
  const { href } = await createProject(page, "Cash flow " + Date.now(), BASE, 4);
  const projectId = href.split("/").pop();

  // ── Nothing signed: nothing phased, and the reason ────────────────────────────────────────
  await page.goto(`${BASE}${href}/cash-flow`, { waitUntil: "networkidle0" });
  check("the page is reachable from the nav as a built step", (await page.$$eval("nav a", (as) => as.some((a) => a.getAttribute("href")?.endsWith("/cash-flow")))));
  const empty = await text('[data-region="cash-flow-empty"]').catch(() => "");
  check("with no contract it phases nothing and says so", /no signed contract sum/i.test(empty), empty.slice(0, 100));

  // ── A signed contract, and no programme: an S-curve, said to be one ───────────────────────
  await signedFields(projectId, "/contract", [
    ["ct-sum", "Contract sum", "R 1 200 000,00"],
    ["ct-signed", "Date signed", "1 September 2026"],
    ["ct-completion", "Practical completion date", "31 December 2026"],
  ]);
  await page.goto(`${BASE}${href}/cash-flow`, { waitUntil: "networkidle0" });
  const curve = await page.$eval("main", (e) => e.innerText);
  check("with a contract but no programme the forecast is an S-curve and says so", /S-curve/.test(curve) && Boolean(await page.$('[data-region="cash-flow-table"]')));
  const curveRows = await page.$$eval('[data-region="cash-flow-table"] tbody tr', (trs) => trs.length);
  check("over the contract's four months", curveRows === 4, `${curveRows}`);

  // ── A signed programme with values: the forecast follows the activities ───────────────────
  // Rows first, then the signature: the trigger refuses rows on a signed run, and a signed run
  // cannot be unsigned – the same order the action itself follows.
  const [prog] = await sql`
    insert into runs (project_id, module, status, input_tokens, output_tokens, created_by)
    values (${projectId}, '/programme', 'review', 0, 0, ${env.DEV_USER_EMAIL})
    returning id`;
  const activities = [
    ["Earthworks", "2026-09-01", "2026-09-30", 30000000n],
    ["Structure", "2026-10-01", "2026-11-30", null],
    ["Finishes", "2026-12-01", "2026-12-31", null],
  ];
  const ids = [];
  let seq = 100;
  for (const [name, start, finish, value] of activities) {
    const [row] = await sql`
      insert into programme_activities (run_id, seq, override_name, override_start, override_finish, override_by, override_at, value, output_name, output_start, output_finish, output_milestone)
      values (${prog.id}, ${seq}, ${name}, ${start}, ${finish}, ${env.DEV_USER_EMAIL}, now(), ${value}, ${name}, ${start}, ${finish}, false)
      returning id`;
    ids.push(row.id);
    seq += 100;
  }
  await sql`update runs set signed_by = ${env.DEV_USER_EMAIL}, signed_at = now() where id = ${prog.id}`;

  await page.goto(`${BASE}${href}/cash-flow`, { waitUntil: "networkidle0" });
  const forecast = await page.$$eval('[data-region="cash-flow-table"] tbody tr', (trs) =>
    trs.map((tr) => [...tr.querySelectorAll("td")].slice(0, 3).map((td) => td.innerText.replace(/ /g, " "))),
  );
  check("the forecast follows the programme: September is the earthworks value", forecast[0]?.[1] === "300 000,00", JSON.stringify(forecast[0]));
  check("and the cumulative reaches the contract sum", forecast.at(-1)?.[2] === "1 200 000,00", JSON.stringify(forecast.at(-1)));
  const summary = await text('[data-region="cash-flow-summary"]');
  check("nothing certified yet, all remaining", /Certified to date\s+R 0,00/.test(summary) && /R 1 200 000,00/.test(summary), summary.replace(/\n/g, " | ").slice(0, 160));

  // ── Two signed valuations: actuals, variance, and a re-forecast of the remainder ───────────
  await signedFields(projectId, "/valuations", [
    ["vl-number", "Certificate number", "1"],
    ["vl-period", "Valuation period end", "30 September 2026"],
    ["vl-work-executed", "Value of work executed", "R 230 000,00"],
    ["vl-materials", "Materials on site", "R 20 000,00"],
  ]);
  await signedFields(projectId, "/valuations", [
    ["vl-number", "Certificate number", "2"],
    ["vl-period", "Valuation period end", "31 October 2026"],
    ["vl-work-executed", "Value of work executed", "R 400 000,00"],
    ["vl-materials", "Materials on site", "R 20 000,00"],
  ]);
  // Finishes slipped a month.
  await sql`insert into programme_progress (activity_id, as_at, start, finish, percent, recorded_by) values (${ids[2]}, '2026-10-31', '2027-01-01', '2027-01-31', 0, ${env.DEV_USER_EMAIL})`;

  await page.goto(`${BASE}${href}/cash-flow`, { waitUntil: "networkidle0" });
  const rows = await page.$$eval('[data-region="cash-flow-table"] tbody tr', (trs) =>
    trs.map((tr) => ({ month: tr.dataset.month, cells: [...tr.querySelectorAll("td")].map((td) => td.innerText.replace(/ /g, " ").trim()) })),
  );
  const sep = rows.find((r) => r.month === "2026-09-01");
  const oct = rows.find((r) => r.month === "2026-10-01");
  check("a certificate's gross becomes the month's actual", sep?.cells[3] === "250 000,00" && oct?.cells[3] === "170 000,00", `${sep?.cells[3]} · ${oct?.cells[3]}`);
  check("the variance is certified less forecast, in brackets when behind", /^\(50 000,00\)$/.test(sep?.cells[5] ?? ""), sep?.cells[5]);
  check("the certificate number is on the row", /cert\. 2/.test(oct?.cells[0] ?? ""), oct?.cells[0]);
  // January is a real nought on the baseline – the programme had nothing there – and money on the expected line.
  check("the slipped finish adds a month to the expected line", rows.at(-1)?.month === "2027-01-01" && rows.at(-1)?.cells[1] === "0,00" && rows.at(-1)?.cells[6] !== "0,00", JSON.stringify(rows.at(-1)?.cells));
  const total = await page.$eval('[data-region="cash-flow-table"] tfoot tr', (tr) => [...tr.querySelectorAll("td")].map((td) => td.innerText.replace(/ /g, " ").trim()));
  check("the expected line sums to the contract sum, and certified to the last certificate", total[1] === "1 200 000,00" && total[3] === "420 000,00" && total[6] === "1 200 000,00", JSON.stringify(total));
  const after = await text('[data-region="cash-flow-summary"]');
  check("the summary says the draw now completes a month later than the baseline", /1 month later than the baseline/.test(after), after.replace(/\n/g, " | ").slice(0, 220));
  check("the chart is drawn from the same figures", Boolean(await page.$('[data-region="cash-flow-chart"] path[d^="M"]')));

  check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));
} finally {
  await browser.close();
  await sql.end();
}

console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} failed.`);
process.exit(fails ? 1 : 0);
