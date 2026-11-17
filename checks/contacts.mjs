/**
 * The directory — PLATFORM.md §4.
 *
 * ── What is worth asserting here ───────────────────────────────────────────────────────────
 *
 * Not that a form saves a row. What makes this a platform feature rather than an address book is
 * the two things that connect it to the work: a client entry finds the projects that name it, and
 * the page says which clients are on a project but not on file. The second is a gap nothing else
 * would ever mention — a job runs perfectly well without a directory entry, which is exactly what
 * makes the omission invisible.
 *
 * The duplicate guard is here too, because the unique index would refuse a second entry either way
 * and the point is that a reader gets a sentence rather than a database error.
 */

import puppeteer from "puppeteer";

import { createProject, readEnv, signIn, watchConsole } from "./helpers.mjs";

const BASE = "http://localhost:3000";
const env = readEnv();

let fails = 0;
const check = (what, ok, detail = "") => {
  if (!ok) fails += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  — ${detail}` : ""}`);
};

const browser = await puppeteer.launch({ headless: "new" });
const page = await browser.newPage();
const reactErrors = watchConsole(page);

/** Unique per run, so a rerun does not trip its own duplicate guard. */
const ORG = `Directory Test Holdings ${Date.now()}`;

/** A client this run guarantees is on a project and not in the directory. */
const UNFILED_CLIENT = `Unfiled Client ${Date.now()}`;

try {
  await signIn(page, env);

  /*
    A project whose client nothing in the directory covers, so the gap has something to find.

    Created here rather than relying on one that exists: the canonical test project's client may
    or may not be on file depending on what ran before, and a check that passes or fails on that
    is asserting the order of the suite rather than the product.
  */
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
  await createProject(page, `Contacts ${Date.now()}`, BASE, 1, UNFILED_CLIENT);

  await page.goto(`${BASE}/contacts`, { waitUntil: "networkidle0" });
  check("the directory loads", page.url().includes("/contacts"));

  check(
    "it groups by what a contact is",
    (await page.$('[data-region="contacts-client"]')) !== null &&
      (await page.$('[data-region="contacts-supplier"]')) !== null,
  );

  // ── Filing ──────────────────────────────────────────────────────────────────────────────
  await page.type('input[name="organisation"]', ORG);
  await page.select('select[name="kind"]', "supplier");
  await page.type('input[name="person"]', "A. Buyer");
  await page.click('[data-action="file-contact"]');

  const filed = await page
    .waitForSelector('[role="status"]', { timeout: 20000 })
    .then((el) => el.evaluate((e) => e.textContent ?? ""))
    .catch(() => "");

  check("an entry can be filed", filed.includes(ORG), filed.slice(0, 70));

  await page.goto(`${BASE}/contacts`, { waitUntil: "networkidle0" });
  const suppliers = await page.$eval('[data-region="contacts-supplier"]', (el) => el.innerText);
  check("and appears under its own kind", suppliers.includes(ORG));
  check("carrying the person who answers there", suppliers.includes("A. Buyer"));

  // ── The duplicate guard ─────────────────────────────────────────────────────────────────
  await page.type('input[name="organisation"]', ORG);
  await page.select('select[name="kind"]', "supplier");
  await page.click('[data-action="file-contact"]');

  const refused = await page
    .waitForSelector('[role="alert"]', { timeout: 20000 })
    .then((el) => el.evaluate((e) => e.textContent ?? ""))
    .catch(() => "");

  // A sentence, not a constraint violation. The index would refuse it either way; the point is
  // that the reader is told why in words they can act on.
  check("a second entry for one organisation is refused", refused.includes("already filed"));
  check("and says why, rather than showing a database error", !/duplicate key|constraint/i.test(refused));

  // The same company is legitimately a client on one job and a contractor on another.
  await page.goto(`${BASE}/contacts`, { waitUntil: "networkidle0" });
  await page.type('input[name="organisation"]', ORG);
  await page.select('select[name="kind"]', "contractor");
  await page.click('[data-action="file-contact"]');

  const otherKind = await page
    .waitForSelector('[role="status"], [role="alert"]', { timeout: 20000 })
    .then((el) => el.evaluate((e) => e.textContent ?? ""))
    .catch(() => "");

  check("but the same organisation may hold two kinds", otherKind.includes("is filed"), otherKind.slice(0, 70));

  // ── The gap ─────────────────────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/contacts`, { waitUntil: "networkidle0" });
  const gap = await page.$('[data-region="clients-not-filed"]');
  const gapText = gap ? await gap.evaluate((e) => e.innerText) : "";

  check(
    "it names clients on a project with no directory entry",
    gapText.includes("not in the directory") && gapText.includes(UNFILED_CLIENT),
    gapText.split("\n")[0] ?? "",
  );
  check(
    "and says the projects are unaffected, so nobody reads it as a fault",
    gapText.includes("projects are unaffected"),
  );

  check("no React warnings on any screen this visited", reactErrors.length === 0, reactErrors[0] ?? "");
} finally {
  await browser.close();
}

console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} failed.`);
process.exit(fails ? 1 : 0);
