/**
 * Published cost data on the Cost Data screen — building rates and tender escalation.
 *
 *     node checks/published-rates.mjs
 *
 * The figures live in code (`lib/published-cost-data.ts`) and are covered by unit tests; what this
 * proves is the half those cannot: that a QS can reach them, that they arrive attributed and with
 * the basis a rate is meaningless without, that a range is still a range on the screen, and that
 * nothing published has leaked into the practice's own library — which is the one thing about this
 * data that would actually do harm.
 */

import { config } from "dotenv";
import postgres from "postgres";
import puppeteer from "puppeteer";

import { readEnv, signIn, watchConsole } from "./helpers.mjs";

config({ path: ".env.local", quiet: true });
const env = readEnv();
const BASE = "http://localhost:3000";

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const sql = postgres(env.DATABASE_URL, { max: 1 });
const started = new Date();
const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1200 });
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 200)));
const consoleErrors = watchConsole(page);
const text = (s) => page.$eval(s, (e) => e.innerText.replace(/[  ]/g, " "));
const openTab = async (label, region) => {
  await page.goto(`${BASE}/rates`, { waitUntil: "networkidle0" });
  await page.evaluate((l) => {
    [...document.querySelectorAll('[role="tab"]')].find((b) => b.textContent?.trim() === l)?.click();
  }, label);
  await page.waitForSelector(region, { timeout: 10000 });
};

try {
  await signIn(page, env);

  // ── The building rates ──────────────────────────────────────────────────────────────────
  await openTab("Published rates", '[data-region="published-rates"]');
  const table = await text('[data-region="published-rates"]');
  check("a QS can reach the published rates from the rate library", table.length > 0);
  check(
    "the office rate is the guide's range, not a midpoint",
    /Low-rise office park development with standard specification[\s\S]*?R 11 300,00 – R 13 900,00/.test(table),
    (table.match(/R 11 300,00[^\n]*/) ?? ["not found"])[0],
  );
  check("a single published figure stays single", /Middle-class\nm²\nR 11 830,00/.test(table) || /R 11 830,00/.test(table));
  check("rates that are not per m² carry their own unit", /R 890 000,00 – R 1 400 000,00/.test(table) && /key/.test(table));

  const panel = await text('[data-region="published"], #published');
  check("it says whose figures these are", /AECOM Africa Property & Construction Cost Guide 2025\/26/.test(panel));
  check(
    "and the basis a rate is meaningless without",
    /current to 1 July 2025/.test(panel) && /Excluding VAT/.test(panel) && /SAPOA/.test(panel),
    panel.split("\n").find((l) => /current to 1 July/.test(l)) ?? "",
  );
  check("the categories filter the table", await page.$('[data-category="Hotels"]') !== null);
  await page.click('[data-category="Hotels"]');
  const hotels = await text('[data-region="published-rates"]');
  check("and filtering shows that category alone", /Budget/.test(hotels) && !/Low-rise office park/.test(hotels));

  // ── The escalation ──────────────────────────────────────────────────────────────────────
  await openTab("Trends & escalation", '[data-region="escalation"]');
  const escalation = await text('[data-region="escalation"]');
  // The headers are uppercased by CSS, and `innerText` reports what is rendered – so match either.
  check("the tender price escalation is on the trends tab", /BER index/i.test(escalation) && /CPAP/i.test(escalation), escalation.split("\n").slice(0, 2).join(" / "));
  check("with the published figures for this year", /145,7/.test(escalation) && /\+6,60%/.test(escalation), escalation.split("\n").find((l) => /145,7/.test(l)) ?? "");
  check("and a forecast is marked as one", /2026[\s\S]{0,40}forecast/.test(await text('[data-year="2026"]')) || /forecast/.test(escalation));

  // ── Benchmarks: only the categories the practice prices (November meeting) ─────────────
  const bandCategories = () => page.$$eval('[data-region="published-bands"] tbody tr td:first-child', (tds) => [...new Set(tds.map((t) => t.textContent.trim()))]);
  await page.goto(`${BASE}/benchmarks`, { waitUntil: "networkidle0" });
  let benchmarked = await bandCategories();
  check(
    "benchmarks compare against the practice's categories, not airports or private dwellings",
    benchmarked.includes("Residential") && !benchmarked.includes("Airport infrastructure") && !benchmarked.includes("Private dwelling houses"),
    benchmarked.join(", "),
  );
  await page.click('[data-region="benchmark-categories"] summary');
  await page.click('input[name="category"][value="Industrial"]');
  await Promise.all([page.click('[data-action="save-benchmark-categories"]'), page.waitForNavigation({ waitUntil: "networkidle0" })]);
  benchmarked = await bandCategories();
  check("a category the practice adds is compared against, and says who chose it", benchmarked.includes("Industrial") && /Chosen by/.test(await text('[data-region="benchmark-categories"]')));
  await page.goto(`${BASE}/benchmarks?all=1`, { waitUntil: "networkidle0" });
  check("and the whole guide is still one click away", (await bandCategories()).includes("Airport infrastructure"));

  // By stage of work: each kind of work the practice builds has its own breakdown, built from its
  // own signed bills and tenders – and says how to start one when it has none.
  await page.goto(`${BASE}/benchmarks?profile=walk-up-flats#by-stage`, { waitUntil: "networkidle0" });
  const byStage = await text('[data-region="stage-benchmarks"]');
  check("benchmarks break down by stage of work, per kind of work", /By stage of work/.test(byStage) && /Boundary wall/.test(byStage) && /Walk-up flats/.test(byStage));
  check("and a kind with no projects yet says how its benchmark is built", /No walk-up flats/.test(byStage) || /Superstructure/.test(byStage), byStage.split("\n").slice(0, 3).join(" | "));

  // ── The safeguard ───────────────────────────────────────────────────────────────────────
  const [leaked] = await sql`select count(*)::int as n from rates where source ilike '%AECOM%' and deleted_at is null`;
  check("nothing published has been written into the practice's own library", leaked.n === 0, `${leaked.n} rows`);

  check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));
} finally {
  // The benchmark choice this suite saved, so a local run leaves the practice's setting as it was.
  await sql`delete from assumptions where key = 'benchmark.categories' and created_at >= ${started}`.catch(() => {});
  await browser.close();
  await sql.end();
}

console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} failed.`);
process.exit(fails ? 1 : 0);
