/**
 * The Rubric page – the standard every output document is held to.
 *
 *     node checks/rubric.mjs
 *
 * ── What this proves ───────────────────────────────────────────────────────────────────────
 *
 * That the rubric is reachable from the main menu rather than buried in a prompt; that every rule
 * says whether the platform proves it or only asks for it, which is the whole value of the page;
 * that a checked rule names the finding it raises, so a reader can tie a review comment back to
 * the rule behind it; and – the one that matters – that the rules on the page are the same objects
 * the measuring agent is given, not a second copy somebody will forget to update.
 *
 * The parity between the page and the checks is proved by `src/domain/rubric.test.ts`, which fails
 * the build. This suite proves the reader can actually get to it.
 */

import puppeteer from "puppeteer";

import { readEnv, signIn, watchConsole } from "./helpers.mjs";

const env = readEnv();
const BASE = "http://localhost:3000";

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1200 });
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));
const consoleErrors = watchConsole(page);

try {
  await signIn(page, env);

  // ── Found from Settings, not a page you have to know about ──────────────────────────────
  // It had its own row in the main menu until 16 Nov 2026; the reference pages are linked from
  // Settings now, so the menu stays the handful of places somebody opens every day.
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle0" });
  const linked = await page.$$eval('[data-region="reference"] a', (links) =>
    links.some((a) => a.getAttribute("href") === "/rubric" && /rubric/i.test(a.textContent ?? "")),
  );
  check("Settings links to the drafting rubric", linked);

  await page.goto(`${BASE}/rubric`, { waitUntil: "networkidle0" });
  check("it opens", (await page.$eval("h1", (h) => h.innerText)) === "Rubric");

  // ── Every output the platform produces, with its rules ──────────────────────────────────
  const rubrics = await page.$$eval("[data-rubric]", (sections) => sections.map((s) => s.getAttribute("data-rubric")));
  check("it carries the bill, the cost plan and the evaluation of quotations", rubrics.length >= 3, rubrics.join(", "));
  check("the measured bill is one of them", rubrics.includes("bill-of-quantities"), rubrics.join(", "));

  const rules = await page.$$eval("[data-rule]", (items) =>
    items.map((li) => ({
      checked: li.getAttribute("data-checked") === "true",
      text: li.innerText.replace(/\s+/g, " ").trim(),
    })),
  );
  check("it lists the rules", rules.length >= 30, `${rules.length} rules`);

  /*
    The distinction the page exists to make.

    A rule the platform proves afterwards and a rule it merely asks for are worth very different
    amounts, and a page that printed them alike would invite a practice to trust the second as far
    as the first. Both kinds have to be present, and each row has to say which it is.
  */
  const proved = rules.filter((r) => r.checked);
  check("some rules are proved by the platform", proved.length >= 15, `${proved.length} checked`);
  check("and some are only asked for, which it admits", rules.length - proved.length > 0, `${rules.length - proved.length} asked`);
  check("every row says which it is", rules.every((r) => /^(Checked|Asked)/.test(r.text)));

  // ── A checked rule names the finding it raises ──────────────────────────────────────────
  const named = await page.$$eval('[data-rule][data-checked="true"]', (items) =>
    items.every((li) => (li.querySelector('[data-region="finding-ids"]')?.textContent ?? "").trim().length > 0),
  );
  check("a checked rule names the finding it raises", named);

  // ── The rules a QS review paid for are here, in the QS's own words ──────────────────────
  const body = await page.$eval("main", (e) => e.innerText);
  check("the blinding under a footing", /Blinding under every footing/.test(body));
  check("the reinforcement, in kilograms", /REINFORCEMENT, in kilograms/.test(body));
  check("the lintel over every opening", /Lintels over every opening/.test(body));
  check("carting away bulked", /carting away BULKED/.test(body));
  check("which drawing wins where two differ", /The ENGINEER'S drawings and structural report govern/.test(body));
  check("and it says where the rules came from", /27 September 2026/.test(body));

  // ── It says what a finding is for, because that decides how it is read ──────────────────
  check("a finding is a question, never a correction", /a question, never a correction/i.test(body));

  check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));
} finally {
  await browser.close();
}

console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} failed.`);
process.exit(fails ? 1 : 0);
