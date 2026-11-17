/**
 * Drives the readiness view — PLATFORM.md §1.3.3.
 *
 * Throwaway check, same as the others. What it asserts is not "the page renders" but the specific
 * things the design research said this screen has to do: say what it is waiting for, keep blocking
 * and non-blocking apart, and state a fallback in the open rather than in a tooltip.
 */

import puppeteer from "puppeteer";
import { createProject, readEnv } from "./helpers.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";

const env = readEnv();

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

/** textContent has no whitespace between sibling spans; the gap is flexbox. */
const crumb = (page) =>
  page.$eval('nav[aria-label="Breadcrumb"]', (el) => el.textContent.trim().replace(/\s+/g, ""));

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

try {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
  await page.type("#email", env.DEV_USER_EMAIL);
  await page.type("#password", env.DEV_USER_PASSWORD);
  await Promise.all([page.click('button[type="submit"]'), page.waitForNavigation()]);

  // Readiness lives on a project now — there is no projectless view of it, because there is no
  // such thing as a process being ready in the abstract.
  // Through the shared helper, not inline. This block had its own copy of the creation flow and
  // broke the moment setup became three steps — one suite failing for a reason that had nothing
  // to do with readiness. There is one way to open a project in these suites.
  const name = `Readiness check ${Date.now()}`;
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
  const { href } = await createProject(page, name, BASE);

  // Readiness lives on the module that needs the inputs, not on the project's front page. The
  // overview used to carry every criterion of every process at once; it now says where each
  // module stands and links through. D1.1's criteria are the feasibility estimate's.
  await page.goto(`${BASE}${href}/feasibility`, { waitUntil: "networkidle0" });
  const main = await page.$eval("main", (el) => el.innerText);
  const lower = main.toLowerCase();

  // "Blocked — 3 required inputs are missing" named a state without naming the work. The bar
  // carries the same facts: how far through, and how many required are still outstanding.
  check("says how far through the step is", /0\/8/.test(main), main.match(/\d+\/\d+/)?.[0]);
  check("and how many required remain", /3 required still needed/i.test(main));
  check(
    "with a progress bar, not only a sentence",
    (await page.$$('[data-region="readiness"] [role="progressbar"]')).length === 1,
  );

  // Two kinds of gap, because the reader's next action differs.
  check(
    "keeps blocking and non-blocking apart",
    lower.includes("required") && lower.includes("optional"),
  );

  // §1.3's integrity rule: missing does not always mean stop, and what happens instead is stated.
  // It now sits behind a per-row disclosure — the page was fourteen paragraphs of prose otherwise —
  // so this reads textContent, which includes collapsed content, rather than rendered innerText.
  const all = await page.$eval("main", (el) => el.textContent ?? "");
  check("states what happens without it", all.includes("Without it:") && all.includes("WITHHELD"));
  check(
    "and it is reachable, not buried",
    (await page.$$('[data-region="readiness"] details')).length > 0,
  );

  // A criterion is a required input, not a required document — so it names what would satisfy it.
  // On the row now, beside the label, instead of a "Satisfied by:" line under every one of them.
  check("names what would satisfy each gap", main.includes("Market study"));

  // Configuration is in Settings. This screen is status.
  // Scoped to the readiness region: the page also carries the documents panel, whose kind
  // selector is part of filing rather than configuration.
  check(
    "readiness itself carries no configuration controls",
    (await page.$$('[data-region="readiness"] select')).length === 0,
  );

  // Actions sit beside the item that needs them.
  check(
    "offers upload beside a missing input",
    (await page.$$('[data-region="readiness"] button')).length > 0,
  );

  // The shell is one *nav* pane, not two competing ones. Counting <aside> stopped meaning that
  // when the checklist card arrived — it is an aside too, and rightly so. What must stay singular
  // is the navigation.
  /**
   * ---- The nav groups fold, and start folded ----
   *
   * A project's nav is twenty-two rows under six headings, and a QS working the feasibility
   * estimate has no use for eleven construction and close-out rows while they do it. All of it on
   * screen at once was the crowded board the stages were meant to fix, moved into the chrome.
   *
   * The group holding the current page opens itself, derived from the path rather than stored - a
   * remembered "open" set that had to be corrected on navigation would be a second source of truth
   * and would disagree the first time somebody arrived by URL. Asserted by navigating, not by
   * clicking.
   */
  const nav = () =>
    page.evaluate(() => ({
      groups: [...document.querySelectorAll("[data-nav-group]")].map((g) => ({
        heading: g.dataset.navGroup,
        open: g.dataset.open === "true",
      })),
      rows: document.querySelectorAll(
        'nav[aria-label="Project"] a, nav[aria-label="Project"] span[title]',
      ).length,
    }));

  await page.goto(`${BASE}${href}`, { waitUntil: "networkidle0" });
  const folded = await nav();
  check(
    "the project nav groups fold",
    folded.groups.length > 1,
    folded.groups.map((g) => g.heading).join(", "),
  );
  /*
    On the overview, one group is open: the one holding the step the overview says to do next
    (sidebar.tsx, "its group opens, like the current page's"). Everything else stays folded, so the
    nav is still a handful of rows – the ungrouped places plus that one group – not the whole chain.
  */
  const openOnOverview = folded.groups.filter((g) => g.open);
  check(
    "and start folded but for the next step's group, so the nav is a handful of rows",
    openOnOverview.length <= 1 && folded.rows > 0 && folded.rows <= 10,
    `${folded.rows} rows, open: ${openOnOverview.map((g) => g.heading).join(", ") || "none"}`,
  );

  await page.goto(`${BASE}${href}/feasibility`, { waitUntil: "networkidle0" });
  const onStep = await nav();
  const holding = onStep.groups.filter((g) => g.open);
  check(
    "the group holding the current page opens itself",
    holding.length === 1,
    holding.map((g) => g.heading).join(", ") || "none",
  );
  check(
    "and it is the one the step is actually in",
    /cost/i.test(holding[0]?.heading ?? ""),
    holding[0]?.heading,
  );
  // The step's own group replaces the next-step group rather than adding to it, so the count is
  // about the same; what matters is that the step's rows are the ones on screen.
  check("which puts the step's own rows on screen", onStep.rows >= 6, `${onStep.rows}`);

  // Opening one by hand is a preference and has to outlive a reload; the derived one is not stored.
  const other = onStep.groups.find((g) => !g.open)?.heading;
  await page.click(`[data-nav-group="${other}"]`);
  await page.waitForFunction(
    (h) => document.querySelector(`[data-nav-group="${h}"]`)?.dataset.open === "true",
    { timeout: 4000 },
    other,
  );
  await page.reload({ waitUntil: "networkidle0" });
  const after = await nav();
  check(
    "a group opened by hand survives a reload",
    after.groups.find((g) => g.heading === other)?.open === true,
    other,
  );
  check(
    "and the derived one is still open beside it",
    after.groups.filter((g) => g.open).length === 2,
    after.groups.filter((g) => g.open).map((g) => g.heading).join(", "),
  );

  check("one nav pane", (await page.$$("aside nav")).length === 1);

  // The project nav appears only once a project is open.
  check("project nav renders on a project", (await page.$('nav[aria-label="Project"]')) !== null);

  // ── Breadcrumb is derived, not hardcoded ────────────────────────────────────────────────
  await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  // The one front page since 16 Nov 2026 – "Dashboard" is a project place, where a cost per unit
  // means one scheme rather than an average over a portfolio.
  check("breadcrumb on Home", (await crumb(page)) === "Home", await crumb(page));

  await page.goto(`${BASE}/settings/criteria`, { waitUntil: "networkidle0" });
  check("breadcrumb nests under settings", (await crumb(page)) === "Settings/Criteria", await crumb(page));
  check("configuration lives in settings", page.url().includes("/settings/criteria"));
} finally {
  await browser.close();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
