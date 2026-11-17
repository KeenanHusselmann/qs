/**
 * Clearing the corpus, and the pages that were reading it.
 *
 * The half worth testing is not that the button empties a list. It is that a document withdrawn on
 * The corpus is gone from **Site & zoning, Project inputs and the feasibility estimate too**, and
 * that the requirements it satisfied go back to needing a document. Four views of one corpus: one
 * of them disagreeing with the others is worse than all four being wrong together, because then a
 * reader has to work out which page is lying.
 */

import postgres from "postgres";
import puppeteer from "puppeteer";
import { createProject, fileAgainst, signIn, readEnv } from "./helpers.mjs";

const env = readEnv();

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const BASE = "http://localhost:3000";

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1100 });
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));

await signIn(page, env);
await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
const { href } = await createProject(page, "Clear corpus " + Date.now());
const projectId = href.split("/").pop();

// ── A corpus spread across three different steps ──────────────────────────────────────────
await page.goto(`${BASE}${href}/site`, { waitUntil: "networkidle0" });
await fileAgainst(page, "Site location and extent", "./fixtures/title-deed.pdf");
await page.waitForFunction(`document.body.innerText.includes("title-deed.pdf")`, { timeout: 20000 });

await page.goto(`${BASE}${href}/feasibility`, { waitUntil: "networkidle0" });
await fileAgainst(page, "Project brief and concept parameters", "./fixtures/brief.txt");
await page.waitForFunction(`document.body.innerText.includes("brief.txt")`, { timeout: 20000 });

/** What each step shows, and how much of it is still outstanding. */
const survey = async () => {
  const seen = {};
  for (const [step, path] of [["site", "/site"], ["feasibility", "/feasibility"], ["corpus", "/corpus"]]) {
    await page.goto(`${BASE}${href}${path}`, { waitUntil: "networkidle0" });
    const text = await page.$eval("main", (e) => e.innerText);
    seen[step] = {
      documents: ["title-deed.pdf", "brief.txt"].filter((n) => text.includes(n)),
      outstanding: Number(text.match(/(\d+) required still needed/)?.[1] ?? -1),
    };
  }
  return seen;
};

const before = await survey();
check("Site & zoning holds the title deed", before.site.documents.includes("title-deed.pdf"));
check("the feasibility estimate holds the brief", before.feasibility.documents.includes("brief.txt"));
check(
  "the corpus screen lists everything, not only what is flagged",
  before.corpus.documents.length === 2,
  before.corpus.documents.join(", ") || "nothing listed",
);

/**
 * The reason on each row has to be true.
 *
 * A correlated subquery here once returned zero characters for every document, because Drizzle
 * rendered both sides of `passages.document_id = documents.id` unqualified and it became
 * `passages.document_id = passages.id`. No error — just the agent telling a QS that a brief it had
 * read perfectly well could not be read and might need OCR. Nothing about the page looked broken.
 */
await page.goto(`${BASE}${href}/corpus`, { waitUntil: "networkidle0" });
const reasons = await page.$eval("[data-region='corpus']", (e) => e.innerText);
check(
  "a document that was read is not reported as unreadable",
  !/nothing could be read/i.test(reasons),
  (reasons.match(/[^\n]*nothing could be read[^\n]*/i) ?? [""])[0],
);
check(
  "and its row cites what was actually read",
  /[\d,]+ characters/.test(reasons),
  (reasons.match(/[\d,]+ characters[^\n]*/) ?? ["no measurement shown"])[0],
);

// ── Clear it, from the one screen that owns the corpus ────────────────────────────────────
await page.goto(`${BASE}${href}/corpus`, { waitUntil: "networkidle0" });

const guarded = await page.$eval("[data-region='corpus'] button[type=submit]", (b) => b.disabled);
check("the clear-all button refuses until the phrase is typed", guarded === true);

await page.type("#clear-corpus", "remove all");
await page.waitForFunction(
  () => !document.querySelector("[data-region='corpus'] button[type=submit]")?.disabled,
  { timeout: 5000 },
);
await page.click("[data-region='corpus'] button[type=submit]");

await page.waitForFunction(() => /documents deleted/i.test(document.body.innerText), { timeout: 30000 });
const said = await page.$eval("main", (e) => e.innerText);
check("it says how many it deleted", /2 documents deleted/.test(said), (said.match(/\d+ documents? deleted/) ?? ["nothing said"])[0]);
check("and that the files went too", /with their stored files/i.test(said));

// ── And every step that was reading them agrees ───────────────────────────────────────────
const after = await survey();

check("the title deed is gone from Site & zoning", !after.site.documents.includes("title-deed.pdf"));
check("the brief is gone from the feasibility estimate", !after.feasibility.documents.includes("brief.txt"));
check("the corpus screen is empty", after.corpus.documents.length === 0, after.corpus.documents.join(", "));

// The point of withdrawing is that the requirement goes back to needing a document. A corpus that
// empties while the checklist stays ticked is the worst of both.
check(
  "Site & zoning needs its documents again",
  after.site.outstanding > before.site.outstanding,
  `${before.site.outstanding} → ${after.site.outstanding} outstanding`,
);
check(
  "and so does the feasibility estimate",
  after.feasibility.outstanding > before.feasibility.outstanding,
  `${before.feasibility.outstanding} → ${after.feasibility.outstanding} outstanding`,
);

check("no document links remain on the page", !(await page.$("main a[data-document-link]")));

// The point of deleting rather than withdrawing: the rows and the bytes are actually gone.
const db = postgres(env.DATABASE_URL);
try {
  const [rows] = await db`select count(*)::int as n from documents where project_id = ${projectId}`;
  const [text] = await db`select count(*)::int as n from passages where project_id = ${projectId}`;
  check("no document rows survive, withdrawn or otherwise", rows.n === 0, `${rows.n} rows`);
  check("and nothing read out of them survives either", text.n === 0, `${text.n} passages`);
} finally {
  await db.end();
}

await browser.close();
console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} failed.`);
process.exit(fails ? 1 : 0);
