/**
 * The window that shows an import happening, and what became of it.
 *
 * A real import is forty to sixty files running for minutes, and the thing worth asserting is not
 * that a progress bar moves. It is that the dialog cannot be dismissed while documents are still
 * being written, that a file which failed is named rather than absorbed into a total, and that when
 * it finishes it says where the documents went — because "filed" is not the end of the story.
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import puppeteer from "puppeteer";
import { createProject, signIn, readEnv } from "./helpers.mjs";

const env = readEnv();

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const BASE = "http://localhost:3000";
const TMP = "./.e2e-tmp";
if (!existsSync(TMP)) mkdirSync(TMP);

// Three that will file, and one that cannot: an unknown kind is refused by the server, which is a
// real per-file failure rather than a contrived one.
const filler = "Founding conditions were assessed across the site with trial pits to refusal. ".repeat(40);
for (const n of ["alpha", "beta", "gamma", "doomed"]) writeFileSync(`${TMP}/${n}-report.txt`, `${n}\n${filler}`);

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1100 });
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));

await signIn(page, env);
await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
const { href } = await createProject(page, "Import window " + Date.now());

await page.goto(`${BASE}${href}/corpus`, { waitUntil: "networkidle0" });

// Drop four files on the folder input, the way the drop zone receives them.
await page.evaluate(async (names) => {
  const input = document.querySelector('input[type="file"]');
  const transfer = new DataTransfer();
  for (const name of names) {
    transfer.items.add(new File([`${name}\n${"Founding conditions were assessed. ".repeat(40)}`], name, { type: "text/plain" }));
  }
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}, [
  "alpha-report.txt",
  "beta-report.txt",
  "gamma-report.txt",
  "doomed-report.txt",
  // Files with no reader, so the dialog has something to explain. A spreadsheet that would not
  // open and a photograph are different situations and must not be reported as one.
  //
  // Deliberately `.xls`, not `.xlsx`: an .xlsx workbook is read now, and a suite asserting that
  // spreadsheets cannot be opened would be asserting something that stopped being true.
  "Bulk Infra Planning Cost Estimates Rev 4.xls",
  "Site photograph.jpg",
]);

await page.waitForFunction(`document.body.innerText.includes("alpha-report.txt")`, { timeout: 20000 });

// Give three of them a real kind, and leave the fourth pointed at one the server will refuse.
const kinds = await page.$$eval("select", (selects, chosen) => {
  let n = 0;
  for (const s of selects) {
    if (!s.querySelector('option[value="Geotechnical report"]')) continue;
    s.value = chosen;
    s.dispatchEvent(new Event("change", { bubbles: true }));
    n++;
  }
  return n;
}, "Geotechnical report");
check("the files are queued with a kind", kinds >= 4, `${kinds} rows`);

// Break exactly one, after the UI has accepted it — the server is what refuses an unknown kind.
await page.evaluate(() => {
  const rows = [...document.querySelectorAll("li")];
  const doomed = rows.find((r) => r.textContent?.includes("doomed-report.txt"));
  const select = doomed?.querySelector("select");
  if (select) {
    const option = document.createElement("option");
    option.value = "Not a kind anything reads";
    select.append(option);
    select.value = option.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
});

await page.$$eval("button", (bs) => bs.find((b) => /^File \d+ document/.test(b.textContent ?? ""))?.click());

// ── While it runs ─────────────────────────────────────────────────────────────────────────
await page.waitForFunction(() => document.querySelector("dialog[open]"), { timeout: 20000 });
check("a window opens as soon as filing starts", true);

const during = await page.evaluate(() => {
  const dialog = document.querySelector("dialog[open]");
  return {
    modal: dialog?.matches(":modal") ?? false,
    text: dialog?.innerText ?? "",
    doneDisabled: dialog?.querySelector("button")?.disabled ?? null,
    bar: Boolean(dialog?.querySelector('[role="progressbar"]')),
  };
});

check("it is modal, so the page underneath cannot be touched", during.modal);
check("it shows how far through the batch it is", during.bar);
check("and cannot be dismissed while documents are still being written", during.doneDisabled === true, `disabled=${during.doneDisabled}`);

// ── When it stops ─────────────────────────────────────────────────────────────────────────
await page.waitForFunction(
  () => /Import finished/.test(document.querySelector("dialog[open]")?.innerText ?? ""),
  { timeout: 120000 },
);

const after = await page.evaluate(() => {
  const dialog = document.querySelector("dialog[open]");
  return { text: dialog?.innerText ?? "", doneDisabled: dialog?.querySelector("button")?.disabled ?? null };
});

check("it says the import finished", /Import finished/.test(after.text));
check("it can be dismissed now", after.doneDisabled === false);
check("the one that failed is named, not absorbed into a total", /doomed-report\.txt/.test(after.text), after.text.replace(/\n+/g, " | ").slice(0, 150));
check("with the server's own reason", /is not a kind anything reads/i.test(after.text));
// Six queued, one refused: five land. The unreadable two are filed, so they count as landed.
check("and the ones that landed are counted", /5 documents are in the corpus/.test(after.text), (after.text.match(/\d+ documents are in the corpus/) ?? [""])[0]);
check("it says where the documents went", /Site & zoning|satisfies/i.test(after.text));

// ── What "filed but nothing could be read" actually means ─────────────────────────────────
//
// This was one line: "15 FILED BUT NOT SEARCHABLE". Searchable is the platform's word for its own
// index, it said nothing about what it cost a reader, it read as a failure when every one of those
// documents is filed and openable, and it collapsed unrelated situations into a single number.
check(
  "it does not describe its own index",
  !/searchable/i.test(after.text),
  (after.text.match(/[^\n]*searchable[^\n]*/i) ?? [""])[0],
);
check(
  "it says plainly that nothing in them could be read",
  /filed, but nothing in them could be read/i.test(after.text),
);
check(
  "and that they are kept and openable",
  /in the corpus and you can open them/i.test(after.text),
);

// The two are different situations with different answers, so they are counted separately.
check(
  "a spreadsheet is named as one that would not open",
  /spreadsheets? that would not open/i.test(after.text),
  (after.text.match(/\d+ Spreadsheets[^\n]*/i) ?? ["absent"])[0],
);
check(
  "an image is named as carrying no text",
  /images?, which carr(y|ies) no text/i.test(after.text),
  (after.text.match(/\d+ Images[^\n]*/i) ?? ["absent"])[0],
);
check(
  "and each says what it means for the work",
  /will not satisfy a requirement on their own/i.test(after.text),
);

// Closing it returns to the page, with the corpus review showing what landed.
await page.evaluate(() => [...document.querySelectorAll("dialog[open] button")].find((b) => /Done/.test(b.textContent ?? ""))?.click());
await page.waitForFunction(() => !document.querySelector("dialog[open]"), { timeout: 10000 });
const page_text = await page.$eval("main", (e) => e.innerText);
check("closing it leaves the corpus listed on the page", /alpha-report\.txt/.test(page_text));

// ── Retrying touches only what failed ─────────────────────────────────────────────────────
//
// Re-running the whole batch to fix two of fifty-nine re-uploads fifty-seven documents that are
// already filed. What matters is the number of requests it makes, not that a button exists.
check("a retry appears for the one that did not file", Boolean(await page.$("[data-retry-failed]")));
check("and says how many", /Retry 1 that failed/.test(page_text), (page_text.match(/Retry[^\n]*/) ?? ["absent"])[0]);

// Give the refused row a kind the server accepts, so the retry has something that can succeed.
await page.evaluate(() => {
  const row = [...document.querySelectorAll("li")].find((r) => r.textContent?.includes("doomed-report.txt"));
  const select = row?.querySelector("select");
  if (select) {
    select.value = "Geotechnical report";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
});

const filings = [];
page.on("request", (r) => {
  if (r.method() === "POST" && /\/documents$/.test(new URL(r.url()).pathname)) filings.push(r.url());
});

await page.$eval("[data-retry-failed]", (b) => b.click());
await page.waitForFunction(
  () => /Import finished/.test(document.querySelector("dialog[open]")?.innerText ?? ""),
  { timeout: 60000 },
);

check("the retry files only the one that failed", filings.length === 1, `${filings.length} uploaded`);

const retried = await page.evaluate(() => document.querySelector("dialog[open]")?.innerText ?? "");
check(
  "and it lands this time",
  /1\/1/.test(retried) && !/DID NOT FILE/.test(retried),
  retried.replace(/\n+/g, " | ").slice(0, 80),
);

await browser.close();
console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} failed.`);
process.exit(fails ? 1 : 0);
