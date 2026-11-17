/**
 * The practice's assumptions — the figures the platform assumes on its behalf.
 *
 * ── They moved off Settings ────────────────────────────────────────────────────────────────
 *
 * They live under **Rate Library → Assumptions** now, with the rest of the practice's cost data.
 * A prime lending rate is not an administrative preference: it sets an affordability ceiling,
 * decides six gates and prints a verdict on a client's report, so it belongs beside the rates a
 * bill is priced from. Settings keeps who may sign in.
 *
 * The suite kept its name because what it asserts has not changed.
 *
 * ── What is worth asserting ────────────────────────────────────────────────────────────────
 *
 * That a change *reaches the report*. A settings page whose values are stored and never read is
 * the worst possible version of this: it tells a practice its figures are in force while every
 * report is still printed on the platform's. So this sets a value and then reads the affordability
 * envelope on a real project to confirm it moved.
 *
 * And the guard, because a prime rate a hundred times too large fails nothing downstream — it
 * produces a ceiling near zero, every scheme fails Gate 1, and the report is confident and wrong.
 */

import postgres from "postgres";
import puppeteer from "puppeteer";

import { createProject, readEnv, signIn, watchConsole } from "./helpers.mjs";

const BASE = "http://localhost:3000";
const env = readEnv();

let fails = 0;
const check = (what, ok, detail = "") => {
  if (!ok) fails += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  — ${detail}` : ""}`);
};

const sql = postgres(env.DATABASE_URL, { max: 1 });
const browser = await puppeteer.launch({ headless: "new" });
const page = await browser.newPage();
const reactErrors = watchConsole(page);

/** Clearing before typing: the field carries the current value, and typing appends to it. */
const setField = async (key, value) => {
  const selector = `[data-assumption="${key}"] input[name="value"]`;
  await page.$eval(selector, (el) => {
    el.value = "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.type(selector, value);
  await page.click(`[data-assumption="${key}"] [data-action="set-assumption"]`);

  return page
    .waitForSelector(`[data-assumption="${key}"] [role="status"], [data-assumption="${key}"] [role="alert"]`, {
      timeout: 20000,
    })
    .then((el) => el.evaluate((e) => e.textContent ?? ""))
    .catch(() => "");
};

try {
  await signIn(page, env);

  /*
    The tab is clicked rather than deep-linked. It is client state, so there is no URL that opens
    it — and driving it the way a reader does is the point: an assumption nobody can reach is an
    assumption nobody sets, whatever the database holds.
  */
  const openAssumptions = async () => {
    await page.goto(`${BASE}/rates`, { waitUntil: "networkidle0" });
    await page.evaluate(() => {
      [...document.querySelectorAll('[role="tab"]')]
        .find((b) => b.textContent?.trim() === "Assumptions")
        ?.click();
    });
    await page.waitForSelector('[data-region="assumptions-lending"]', { timeout: 10000 });
  };

  await openAssumptions();

  check("the assumptions are reachable from the rate library", page.url().includes("/rates"));

  check(
    "it groups the figures by what they decide",
    (await page.$('[data-region="assumptions-lending"]')) !== null &&
      (await page.$('[data-region="assumptions-funding"]')) !== null,
  );

  // Nine unexplained numbers invite an idle edit. Each says what it moves.
  const moves = await page.$eval('[data-assumption="primeRatePa"]', (el) => el.innerText);
  check("each says what changing it moves", /price ceiling/i.test(moves), moves.split("\n")[1] ?? "");

  // ── The guard ───────────────────────────────────────────────────────────────────────────
  const typo = await setField("primeRatePa", "1175");
  check("a decimal in the wrong place is refused", /outside the range/i.test(typo), typo.slice(0, 80));
  check(
    "and the refusal says why it matters, not just that it is invalid",
    /fails no gate|confidently wrong/i.test(typo),
  );

  // ── A change that reaches the report ────────────────────────────────────────────────────
  /*
    This suite makes the project it reads.

    It used to look for "Ridgeview Gardens", the seeded demonstration corpus, because the
    affordability envelope only appears where an income band has been signed and the first project
    in the list is whatever a preceding suite happened to create. That worked on a developer's
    machine and failed on CI every time: the corpus is seeded by `scripts/seed-test-project.mjs`,
    which drives real agent runs, and a runner has neither the key nor any business spending
    credits to satisfy an assertion. The gate has been red since 7 September for this one reason.

    So the band is seeded here, in SQL, the way `chain.mjs` seeds the step above it. One signed
    field is all section 2 needs, and it makes the assertion say the same thing on every machine.
  */
  // `createProject` drives the dialog on the projects list, so it has to be looking at it.
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
  const { href: project } = await createProject(page, `Settings ${Date.now()}`, BASE, 1);
  const projectId = project.split("/").pop();
  const [run] = await sql`
    insert into runs (project_id, module, status, created_by, signed_by, signed_at)
    values (${projectId}, '/feasibility', 'review', ${env.DEV_USER_EMAIL}, ${env.DEV_USER_EMAIL}, now())
    returning id`;
  await sql`
    insert into run_fields (
      run_id, field_id, seq, label, proposed_state, proposed_value, proposed_confidence,
      source_document, source_excerpt, output_value
    ) values (
      ${run.id}, 'income-band', 1, 'Target household income band', 'found',
      'R 8 000 to R 30 000 per month', 0.9, 'brief.txt',
      'households earning between R8 000 and R30 000 per month', 'R 8 000 to R 30 000 per month'
    )`;

  await openAssumptions();
  const saved = await setField("instalmentToIncomePct", "25");
  check("a valid change is accepted", /Now 25%/.test(saved), saved.slice(0, 70));
  check("and says every report from here on uses it", /every report/i.test(saved));

  await openAssumptions();
  const row = await page.$eval('[data-assumption="instalmentToIncomePct"]', (el) => el.innerText);
  check("the row now names who set it, not the platform", /Set by/.test(row), row.split("\n").at(-1) ?? "");

  /*
    The assertion this suite exists for.

    A stored value nothing reads would leave a practice believing its figures are in force while
    every report is still printed on ours.
  */
  await page.goto(`${BASE}${project}/report`, { waitUntil: "networkidle0" });
  const report = await page.evaluate(() => document.body.innerText);
  check(
    "and the report states the practice's figure rather than the platform's",
    /25% of income/.test(report),
    (report.match(/Bond assumptions[^\n]{0,60}/) ?? [])[0] ?? "no bond row",
  );

  // Put it back, so the next run starts where this one did.
  await openAssumptions();
  await setField("instalmentToIncomePct", "30");

  check("no React warnings on any screen this visited", reactErrors.length === 0, reactErrors[0] ?? "");
} finally {
  await browser.close();
  await sql.end();
}

console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} failed.`);
process.exit(fails ? 1 : 0);
