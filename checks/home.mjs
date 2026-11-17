/**
 * The dashboard — PLATFORM.md §4.3, §14, and §1.3.1's rule that a figure must trace.
 *
 *     npm run check:home
 *
 * ── What this proves ───────────────────────────────────────────────────────────────────────
 *
 * That every tile on Home (`/`) is one of exactly two things and never a third: a figure read out of
 * `output_*` on a run whose `signed_at is not null`, or a **stated absence** naming the step that
 * would supply it, with a link to that step. §14 lists demo-driven development as a way this project
 * fails and the dashboard was deliberately empty for that reason, so the assertion that matters most here
 * is the negative one — that nothing renders a plausible number from unsigned data.
 *
 * It also proves the third state a money figure can be in, which is the one this platform is
 * arranged around: a figure that **was** signed and that `readAmount` refused to read. "R42 000
 * 000,00 excluding VAT" is qualified, and a total that silently dropped it would be short by a
 * project. The screen has to say so, in the reader's own words.
 *
 * ── Why it archives the rest of the list, and puts it back ─────────────────────────────────
 *
 * The KPI band is a roll-up across the working list, so "nothing is signed" is only observable when
 * this suite owns the list. Every other live project is archived for the duration and restored to
 * the status it held, in `finally` — archiving is reversible and is already what §6.3 calls
 * "finished work out of the working list", where a delete would not be.
 *
 * Two consequences worth knowing before running it. It **refuses a remote database**, for the reason
 * `clean-test-projects.mjs` gives: the production connection string and the development one differ
 * by a hostname, and a housekeeping step in a test is the last place that difference should be
 * discovered. And it must not run *concurrently* with another suite — for the half-minute it holds
 * the list, anything else reading `/projects` sees an empty one. Serial is how `npm run check` runs
 * everything anyway.
 *
 * The parked list is written to `.parked-projects.json` before the first UPDATE, because `finally`
 * is not a guarantee: a run killed by a signal never reaches it, and the list it leaves behind looks
 * to the next reader like every project has vanished. The next run restores from that file first.
 *
 * ── Why the runs are seeded ────────────────────────────────────────────────────────────────
 *
 * A real run costs DeepSeek credits and this runs many times a day. §1.3's "no seed data" rule is
 * about a project's figures being invented; fixtures for a test are fixtures. What this cannot show
 * is that the *route* writes rows of this shape — that is `checks/run-live.mjs`.
 *
 * The field sets are read out of `run.ts` rather than copied here, so the suite cannot go on passing
 * against a spec that has moved.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import { config } from "dotenv";
import postgres from "postgres";
import puppeteer from "puppeteer";

import { createProject, readEnv, signIn, watchConsole } from "./helpers.mjs";

config({ path: ".env.local", quiet: true });
const env = readEnv();

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const BASE = "http://localhost:3000";

/**
 * Whitespace folded, including the non-breaking space `formatMoney` groups thousands with.
 *
 * §7.7 writes money as `R 1 234 567,89` and the separator is U+00A0 on purpose — an ordinary space
 * lets a figure wrap mid-number inside a table cell. An assertion typed with ordinary spaces would
 * never match without this, and would look like a formatting bug rather than a test bug.
 */
const flat = (text) => (text ?? "").replace(/\s+/g, " ").trim();

/** A field set, parsed from its source the way `checks/signoff.mjs` parses the feasibility one. */
const specsOf = (name, expected) => {
  const source = readFileSync("src/lib/agent/run.ts", "utf8");
  const start = source.indexOf(`export const ${name}`);
  if (start < 0) throw new Error(`${name} is not declared in run.ts`);

  // Bounded at the end of the array. `signoff.mjs` records what happens without that bound: it read
  // every field set in the file and seeded 87 fields into a ten-field run.
  const array = source.slice(start, source.indexOf("\n];", start));
  const specs = [
    ...array.matchAll(/id: "([^"]+)",\s*\n\s*label: "([^"]+)",[\s\S]*?required: (true|false),/g),
  ].map(([, id, label, required]) => ({ id, label, required: required === "true" }));

  check(`${name} was parsed from run.ts`, specs.length === expected, `${specs.length} fields`);
  if (specs.length !== expected) process.exit(1);

  return specs;
};

const FEASIBILITY_SPECS = specsOf("FEASIBILITY_FIELDS", 11);
const COST_PLAN_SPECS = specsOf("COST_PLAN_FIELDS", 13);

/** The one required field the seeded estimate leaves unanswered, so the gate has something to name. */
const GAP = FEASIBILITY_SPECS.find((spec) => spec.id === "absorption");

/** The scheme, and the arithmetic a QS could check by hand. */
const UNITS = "1 046";
const UNIT_AREA = "48 m²";
const TOTAL = "R186 420 000,00";

/** Elements that deliberately do **not** sum to the total, so `reconcile` has a difference to find. */
const ELEMENTS = {
  "cp-substructure": "R24 000 000,00",
  "cp-superstructure": "R92 000 000,00",
  "cp-finishes": "R18 000 000,00",
  "cp-services": "R21 000 000,00",
  "cp-external-works": "R12 000 000,00",
  "cp-preliminaries": "R14 500 000,00",
  "cp-contingency": "R4 000 000,00",
};

/**
 * Local only, and not by convention — by refusal.
 *
 * This is the one suite that changes rows it did not create: it archives the working list so the
 * roll-up has nothing in it, and puts it back afterwards. Against a remote database that would take
 * a practice's live projects off their own dashboard for as long as it ran, and a crash in between
 * would leave them there.
 */
const { hostname } = new URL(env.DATABASE_URL);
if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) {
  console.error(
    `Refusing to run against ${hostname}: this suite archives every project on the list and ` +
      "restores them afterwards, which is only ever acceptable on a local database.",
  );
  process.exit(1);
}

const sql = postgres(env.DATABASE_URL, { max: 1 });

/**
 * Where the parked list is written down before anything is archived.
 *
 * `finally` is not a guarantee. A run killed by a signal — `node checks/home.mjs | head`, which
 * closes the pipe and kills the process, is the way this was found — never reaches it, and what it
 * leaves behind is a project list that looks empty. That is indistinguishable from data loss to
 * whoever opens the app next.
 *
 * So the intent is recorded on disk before the first UPDATE and removed after the last one, and the
 * next run puts back anything an interrupted one left. §13.4: never lose a user's work, and a
 * project list nobody can see is lost enough.
 */
const PARKED_FILE = ".parked-projects.json";

async function unpark(rows) {
  for (const project of rows) {
    await sql`update projects set status = ${project.status} where id = ${project.id}`;
  }
  rmSync(PARKED_FILE, { force: true });
}

if (existsSync(PARKED_FILE)) {
  const left = JSON.parse(readFileSync(PARKED_FILE, "utf8"));
  console.log(`  (restoring ${left.length} projects an interrupted run left parked)`);
  await unpark(left);
}

/** Read the whole dashboard in one pass — the tiles, the trace table, the flags and the sign-offs. */
const readHome = (page) =>
  page.evaluate(() => {
    const tile = (element) => ({
      label: element.dataset.kpi,
      state: element.dataset.figure,
      href: element.getAttribute("href"),
      text: (element.textContent ?? "").replace(/\s+/g, " ").trim(),
    });

    const region = (name) => document.querySelector(`[data-region="${name}"]`);

    return {
      tiles: [...document.querySelectorAll("[data-kpi]")].map(tile),
      projects: [...(region("projects")?.querySelectorAll("tr[data-project]") ?? [])].map((row) => ({
        id: row.dataset.project,
        text: (row.textContent ?? "").replace(/\s+/g, " ").trim(),
        links: [...row.querySelectorAll("a")].map((a) => a.getAttribute("href")),
      })),
      flags: [...(region("attention")?.querySelectorAll("li[data-flag]") ?? [])].map((li) => ({
        kind: li.dataset.flag,
        text: (li.textContent ?? "").replace(/\s+/g, " ").trim(),
        href: li.querySelector("a")?.getAttribute("href"),
      })),
      attention: (region("attention")?.textContent ?? "").replace(/\s+/g, " ").trim(),
      signatures: (region("signatures")?.textContent ?? "").replace(/\s+/g, " ").trim(),
      body: document.body.innerText.replace(/\s+/g, " ").trim(),
    };
  });

const tileOf = (home, label) => home.tiles.find((t) => t.label === label);

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1400 });
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));

// React warnings are console errors, not exceptions, so `pageerror` never sees them.
const consoleErrors = watchConsole(page);

/** Projects taken out of the working list for the duration, and put back in `finally`. */
let parked = [];

try {
  await signIn(page, env);

  // Read the statuses before changing them. Restoring everything to `estimating` afterwards would
  // quietly rewrite the status of any real project on the machine this ran against, and a
  // housekeeping step in a test is the last place that should be discovered.
  parked = await sql`
    select id, status from projects where deleted_at is null and status <> 'archived'`;

  if (parked.length > 0) {
    // Written down first: the file is the record of what to put back, and it has to exist before
    // there is anything to put back rather than after.
    writeFileSync(PARKED_FILE, JSON.stringify(parked), "utf8");
    await sql`
      update projects set status = 'archived' where id in ${sql(parked.map((p) => p.id))}`;
  }

  console.log(`  (${parked.length} other projects parked for the duration)`);

  // ── An empty list is a surface too ──────────────────────────────────────────────────────
  //
  // §7.5: "Every list gets one. No blank canvases anywhere in the product." A dashboard is the most
  // tempting place in any product to break that rule, because a dashboard with nothing on it looks
  // broken rather than empty.
  await page.goto(`${BASE}/?view=executive`, { waitUntil: "networkidle0" });
  const blank = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").trim());

  check("with no projects the dashboard says what would fill it", /Nothing to summarise yet/i.test(blank), blank.slice(0, 120));
  check(
    "stating that its figures come from signatures rather than from anywhere else",
    /comes from a run somebody has signed off/i.test(blank),
  );
  check("and offering the way in", blank.includes("Open Projects"));
  check("without showing a tile of noughts", !/R 0,00/.test(blank));

  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
  const scheme = await createProject(page, "Dashboard " + Date.now());
  const schemeId = scheme.href.split("/").pop();

  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
  const qualified = await createProject(page, "Qualified total " + Date.now());
  const qualifiedId = qualified.href.split("/").pop();

  // ── Nothing signed: every money tile states its absence ─────────────────────────────────
  //
  // The whole point of the screen. §1.3.1 — a figure that cannot be traced is worse than a gap,
  // because it survives review looking checked — so a tile with nothing behind it must not render
  // a number, and must not render nought either. A scheme that costs nothing and a scheme nobody
  // has costed are different facts.
  await page.goto(`${BASE}/?view=executive`, { waitUntil: "networkidle0" });
  let home = await readHome(page);

  check("the dashboard has four tiles", home.tiles.length === 4, home.tiles.map((t) => t.label).join(", "));

  /*
    ── The QS view: the work first, the figures one click away (17 Nov 2026) ──────────────────

    QS staff open Home to find their next job, not the practice's value and rates per m². So the
    default view drops the KPI band, projects-by-stage and the table's money columns; everything
    above stays on the executive view, which is what the rest of this suite reads.
  */
  await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  const qs = await page.evaluate(() => ({
    tiles: document.querySelectorAll("[data-kpi]").length,
    table: document.querySelector('[data-region="projects"]')?.getAttribute("data-view") ?? null,
    headers: [...document.querySelectorAll('[data-region="projects"] th')].map((th) => th.textContent?.trim()),
    stages: Boolean(document.querySelector('[data-region="progress"]')),
    attention: Boolean(document.querySelector('[data-region="attention"]')),
    current: document.querySelector('[data-region="home-view"] [aria-current="page"]')?.getAttribute("data-view") ?? null,
  }));
  check("Home opens on the QS view", qs.current === "qs", String(qs.current));
  check("with no KPI tiles", qs.tiles === 0, `${qs.tiles} tiles`);
  check("a projects table without money columns", qs.table === "qs" && !qs.headers.some((h) => /value|cost per/i.test(h ?? "")), qs.headers.join(" | "));
  check("no projects-by-stage panel", !qs.stages);
  check("and what needs attention still there", qs.attention);
  await page.click('[data-region="home-view"] [data-view="executive"]');
  await page.waitForFunction(() => document.querySelectorAll("[data-kpi]").length === 4, { timeout: 15000 });
  check("the executive view is one click away, with its four tiles", true);

  const money = ["Total project value", "Cost per unit", "Cost per m² GFA"];
  check(
    "with nothing signed, no money tile shows a figure",
    money.every((label) => tileOf(home, label)?.state === "absent"),
    money.map((label) => `${label}=${tileOf(home, label)?.state}`).join(", "),
  );
  check(
    "and none of them shows a nought standing in for one",
    !money.some((label) => /R 0,00/.test(tileOf(home, label)?.text ?? "")),
  );

  const valueTile = tileOf(home, "Total project value");
  check(
    "the value tile says which document would establish it",
    /signed cost plan total or a signed bill/i.test(valueTile.text),
    valueTile.text.slice(0, 120),
  );

  const perUnitTile = tileOf(home, "Cost per unit");
  check(
    "the cost-per-unit tile names the step that supplies its divisor",
    /unit count signed on the Feasibility Estimate/i.test(perUnitTile.text),
    perUnitTile.text.slice(0, 130),
  );
  check(
    "and links to that step rather than nowhere",
    perUnitTile.href === `/projects/${schemeId}/feasibility` || perUnitTile.href === "#projects",
    `${perUnitTile.href}`,
  );

  const perM2Tile = tileOf(home, "Cost per m² GFA");
  check(
    "the cost-per-m² tile names the average unit area as well",
    /average unit area/i.test(perM2Tile.text),
    perM2Tile.text.slice(0, 130),
  );

  const before = home.projects.find((row) => row.id === schemeId);
  check("the project is on the trace table", Boolean(before), home.projects.length + " rows");
  check(
    "its value reads as not signed off, with the reason",
    /Not signed off/.test(before.text) && /Cost Plan has not been run/.test(before.text),
    before.text.slice(0, 160),
  );
  check(
    "and offers the step that would settle it",
    before.links.includes(`/projects/${schemeId}/cost-plan`),
    before.links.join(" "),
  );
  check(
    "the two derived columns are a dash, never a zero",
    (before.text.match(/—/g) ?? []).length === 2 && !/R 0,00/.test(before.text),
    before.text.slice(-80),
  );
  check("progress counts the steps that can be signed", /0 of \d+ steps/.test(before.text), before.text.slice(-60));

  check(
    "nothing is flagged on an untouched project",
    tileOf(home, "Needs attention").text.includes("0"),
    tileOf(home, "Needs attention").text.slice(0, 90),
  );
  check(
    "and the working section says so in words",
    /Nothing outstanding/i.test(home.attention),
    home.attention.slice(0, 90),
  );
  check("no sign-off is claimed", /No step on any project has been signed off/i.test(home.signatures));

  // ── A finished run nobody has signed ────────────────────────────────────────────────────
  //
  // Two things become true at once, and both are findings a person can act on: the run cannot be
  // signed while a required figure is unanswered, and the step below it cannot start until somebody
  // signs. Neither is invented for this page — `blockingFields` and `upstreamPending` already decide
  // both, on the step's own screen.
  const [estimate] = await sql`
    insert into runs (project_id, module, status, input_tokens, output_tokens, created_by)
    values (${schemeId}, '/feasibility', 'review', 4210, 880, ${env.DEV_USER_EMAIL})
    returning id`;

  for (const [seq, spec] of FEASIBILITY_SPECS.entries()) {
    const value =
      spec.id === GAP.id
        ? null
        : spec.id === "units"
          ? UNITS
          : spec.id === "unit-area"
            ? UNIT_AREA
            : `${spec.id} value`;

    await sql`
      insert into run_fields (
        run_id, field_id, seq, label, proposed_state, proposed_value, proposed_confidence,
        source_document, source_excerpt
      ) values (
        ${estimate.id}, ${spec.id}, ${seq}, ${spec.label},
        ${value === null ? "not_found" : "found"}, ${value}, ${value === null ? 0 : 0.9},
        ${value === null ? null : "brief.txt"},
        ${value === null ? null : `the passage ${spec.id} was read from`}
      )`;
  }

  await page.goto(`${BASE}/?view=executive`, { waitUntil: "networkidle0" });
  home = await readHome(page);

  check(
    "an unsigned run still leaves every money tile absent",
    money.every((label) => tileOf(home, label)?.state === "absent"),
    money.map((label) => `${label}=${tileOf(home, label)?.state}`).join(", "),
  );
  check(
    "even though its figures are on the page it came from",
    !home.body.includes("1 046"),
    "the unit count leaked into the dashboard before anybody approved it",
  );

  const fieldFlag = home.flags.find((flag) => flag.kind === "fields");
  check("a finished run that cannot be signed is flagged", Boolean(fieldFlag), home.flags.map((f) => f.kind).join(", "));
  check("naming the figure that is missing", fieldFlag?.text.includes(GAP.label), fieldFlag?.text.slice(0, 140));
  check(
    "and linking to the step that would answer it",
    fieldFlag?.href === `/projects/${schemeId}/feasibility`,
    `${fieldFlag?.href}`,
  );

  const waitingFlag = home.flags.find((flag) => flag.kind === "signature");
  check("a signature something below is waiting on is flagged", Boolean(waitingFlag));
  check(
    "saying which step is held up by it",
    /Cost Plan cannot start until it is/i.test(waitingFlag?.text ?? ""),
    waitingFlag?.text.slice(0, 150),
  );

  // ── The signature ───────────────────────────────────────────────────────────────────────
  //
  // Outputs first, the run stamped last: the freeze trigger refuses any write to a row whose run is
  // signed, so stamping first would lock the outputs out of their own sign-off.
  await sql`
    update run_fields
       set override_value = '96 units per annum', override_by = ${env.DEV_USER_EMAIL}, override_at = now()
     where run_id = ${estimate.id} and field_id = ${GAP.id}`;

  await sql`
    update run_fields set output_value = coalesce(override_value, proposed_value)
     where run_id = ${estimate.id}`;

  await sql`
    update runs set signed_by = ${env.DEV_USER_EMAIL}, signed_at = now() where id = ${estimate.id}`;

  // ── And the cost plan on top of it ──────────────────────────────────────────────────────
  const [plan] = await sql`
    insert into runs (project_id, module, status, created_by)
    values (${schemeId}, '/cost-plan', 'review', ${env.DEV_USER_EMAIL})
    returning id`;

  for (const [seq, spec] of COST_PLAN_SPECS.entries()) {
    const value =
      spec.id === "cp-total"
        ? TOTAL
        : (ELEMENTS[spec.id] ??
          (spec.id === "cp-units"
            ? UNITS
            : spec.id === "cp-unit-area"
              ? UNIT_AREA
              : spec.id === "cp-escalation"
                ? null
                : `${spec.id} value`));

    if (value === null) continue;

    await sql`
      insert into run_fields (
        run_id, field_id, seq, label, proposed_state, proposed_value, proposed_confidence,
        source_document, source_excerpt, carried_via
      ) values (
        ${plan.id}, ${spec.id}, ${seq}, ${spec.label}, 'found', ${value}, 0.9,
        'cost plan.xlsx', ${`the passage ${spec.id} was read from`},
        ${spec.id.startsWith("cp-unit") || spec.id === "cp-erf" ? "/feasibility" : null}
      )`;
  }

  await sql`update run_fields set output_value = proposed_value where run_id = ${plan.id}`;
  await sql`update runs set signed_by = ${env.DEV_USER_EMAIL}, signed_at = now() where id = ${plan.id}`;

  await page.goto(`${BASE}/?view=executive`, { waitUntil: "networkidle0" });
  home = await readHome(page);

  // ── The figures, and the arithmetic a QS could check by hand ────────────────────────────
  const value = tileOf(home, "Total project value");
  check("the value tile now carries a signed figure", value.state === "signed", value.state);
  check("which is the total the cost plan signed", flat(value.text).includes("R 186 420 000,00"), flat(value.text).slice(0, 110));
  check(
    "and clicking it reaches the signed run it came from",
    value.href === `/projects/${schemeId}/cost-plan`,
    `${value.href}`,
  );

  const perUnitNow = tileOf(home, "Cost per unit");
  // R186 420 000,00 over 1 046 units = R178 221,7973… → R178 221,80
  check(
    "cost per unit divides the signed total by the signed unit count",
    flat(perUnitNow.text).includes("R 178 221,80"),
    flat(perUnitNow.text).slice(0, 110),
  );
  check("stating the unit count it divided by", flat(perUnitNow.text).includes("1 046 units"));

  const perM2Now = tileOf(home, "Cost per m² GFA");
  // 1 046 × 48 m² = 50 208 m²; R186 420 000,00 over that = R3 712,9541… → R3 712,95
  check(
    "cost per m² divides by unit count × average unit area",
    flat(perM2Now.text).includes("R 3 712,95"),
    flat(perM2Now.text).slice(0, 120),
  );
  check("stating the area it divided by", flat(perM2Now.text).includes("50 208 m²"));

  const row = home.projects.find((r) => r.id === schemeId);
  check("the trace table carries the same total", flat(row.text).includes("R 186 420 000,00"));
  check("and says which document it came from", /Cost Plan/.test(row.text), row.text.slice(0, 170));
  check(
    "with a link to that signed run",
    row.links.includes(`/projects/${schemeId}/cost-plan`),
    row.links.join(" "),
  );
  check(
    "the scheme's shape sits under its name",
    flat(row.text).includes("1 046 units") && flat(row.text).includes("50 208 m² GFA"),
    flat(row.text).slice(0, 170),
  );
  check("two steps now count as signed", /2 of \d+ steps/.test(row.text), row.text.slice(-70));

  check(
    "the sign-offs list names the steps and who froze them",
    /Cost Plan/.test(home.signatures) &&
      /Feasibility Estimate/.test(home.signatures) &&
      home.signatures.includes(env.DEV_USER_EMAIL),
    home.signatures.slice(0, 160),
  );

  // ── A signed step whose parts do not make its whole ─────────────────────────────────────
  const reconciliation = home.flags.find((flag) => flag.kind === "reconciliation");
  check("a total that disagrees with its elements is flagged", Boolean(reconciliation), home.flags.map((f) => f.kind).join(", "));
  check(
    "with both figures and the difference between them",
    flat(reconciliation?.text ?? "").includes("R 185 500 000,00") &&
      flat(reconciliation?.text ?? "").includes("R 920 000,00"),
    flat(reconciliation?.text ?? "").slice(0, 200),
  );
  check(
    "and it does not decide which one is wrong",
    /Correcting either is a correction on the step/i.test(reconciliation?.text ?? ""),
  );
  check(
    "the signature flags are gone now that both steps are signed",
    !home.flags.some((flag) => flag.kind === "signature"),
    home.flags.map((f) => f.kind).join(", "),
  );

  // ── A signed figure the reader refused ──────────────────────────────────────────────────
  //
  // The third state, and the one §5 exists for. "R42 000 000,00 excluding VAT" is a qualified
  // figure: the qualifier changes what it means, so `readAmount` refuses rather than guessing. It is
  // approved data all the same, and a total that dropped it silently would be short by a project.
  const [qualifiedPlan] = await sql`
    insert into runs (project_id, module, status, created_by)
    values (${qualifiedId}, '/cost-plan', 'review', ${env.DEV_USER_EMAIL})
    returning id`;

  await sql`
    insert into run_fields (run_id, field_id, seq, label, proposed_state, proposed_value, proposed_confidence)
    values (${qualifiedPlan.id}, 'cp-total', 0, 'Total construction cost', 'found',
            'R42 000 000,00 excluding VAT', 0.9)`;

  await sql`update run_fields set output_value = proposed_value where run_id = ${qualifiedPlan.id}`;
  await sql`
    update runs set signed_by = ${env.DEV_USER_EMAIL}, signed_at = now() where id = ${qualifiedPlan.id}`;

  await page.goto(`${BASE}/?view=executive`, { waitUntil: "networkidle0" });
  home = await readHome(page);

  const withRefusal = tileOf(home, "Total project value");
  check(
    "a refused figure is not added into the total",
    flat(withRefusal.text).includes("R 186 420 000,00") && !flat(withRefusal.text).includes("R 228 420 000,00"),
    flat(withRefusal.text).slice(0, 130),
  );
  check(
    "the tile says one signed total could not be read",
    /could not be read/i.test(withRefusal.text),
    flat(withRefusal.text).slice(0, 200),
  );
  check(
    "and gives the reader's own reason for refusing it",
    /qualifies this figure/i.test(withRefusal.text),
    flat(withRefusal.text).slice(0, 220),
  );

  const refusedRow = home.projects.find((r) => r.id === qualifiedId);
  check(
    "the project's row states the refusal rather than a blank",
    /qualifies this figure/i.test(refusedRow?.text ?? ""),
    flat(refusedRow?.text ?? "").slice(0, 180),
  );
  check(
    "and does not call a signed step unsigned",
    !/Not signed off/.test(refusedRow?.text ?? ""),
    flat(refusedRow?.text ?? "").slice(0, 120),
  );

  // ── A bill row with no measure ──────────────────────────────────────────────────────────
  const [bill] = await sql`
    insert into runs (project_id, module, status, created_by)
    values (${schemeId}, '/bill', 'review', ${env.DEV_USER_EMAIL})
    returning id`;

  const [heading] = await sql`
    insert into run_items (run_id, seq, row_type, proposed_description)
    values (${bill.id}, 100, 'heading', 'Substructure') returning id`;

  await sql`
    insert into run_items (run_id, seq, parent_id, row_type, proposed_description, proposed_unit,
                           proposed_quantity, proposed_rate, proposed_rate_precision)
    values (${bill.id}, 200, ${heading.id}, 'item', 'Strip footings in 25 MPa/19mm concrete',
            'm3', '1250.0000', 185000, 2)`;

  await sql`
    insert into run_items (run_id, seq, parent_id, row_type, proposed_description, proposed_unit,
                           proposed_quantity)
    values (${bill.id}, 300, ${heading.id}, 'item', 'Surface beds 100mm thick', 'm2', '840.0000')`;

  await page.goto(`${BASE}/?view=executive`, { waitUntil: "networkidle0" });
  home = await readHome(page);

  const rowFlag = home.flags.find((flag) => flag.kind === "rows");
  check("an unpriced bill row is flagged", Boolean(rowFlag), home.flags.map((f) => f.kind).join(", "));
  check(
    "naming the row and what it is short of",
    /Surface beds/.test(rowFlag?.text ?? "") && /a rate/.test(rowFlag?.text ?? ""),
    rowFlag?.text.slice(0, 160),
  );
  check(
    "and linking to the bill it is on",
    rowFlag?.href === `/projects/${schemeId}/bill`,
    `${rowFlag?.href}`,
  );

  const flagsTile = tileOf(home, "Needs attention");
  check(
    "the attention tile counts exactly what is listed below it",
    flagsTile.text.includes(String(home.flags.length)),
    `tile "${flagsTile.text.slice(0, 60)}" against ${home.flags.length} listed`,
  );
  check("and it is not a figure with nothing behind it", home.flags.length > 0);

  // ── The draft bill's rows never reach the total ─────────────────────────────────────────
  check(
    "an unsigned bill contributes nothing to the value",
    flat(tileOf(home, "Total project value").text).includes("R 186 420 000,00"),
    flat(tileOf(home, "Total project value").text).slice(0, 110),
  );

  // ── A test project stays out of the firm's figures (audit C5) ───────────────────────────
  //
  // One TEST project at R0,24/m² was feeding the practice's cost per unit. Marked as a test, the
  // scheme above drops out of Home's tiles and table, and stays on Projects with the word on it.
  await sql`update projects set is_test = true where id = ${schemeId}`;
  await page.goto(`${BASE}/?view=executive`, { waitUntil: "networkidle0" });
  const withoutTest = await readHome(page);
  check(
    "a test project's signed total leaves the firm's value",
    !flat(tileOf(withoutTest, "Total project value")?.text ?? "").includes("186 420 000"),
    flat(tileOf(withoutTest, "Total project value")?.text ?? "").slice(0, 110),
  );
  check("and its row leaves Home's table", !withoutTest.projects.some((p) => p.id === schemeId));
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
  const listed = await page.evaluate(
    (id) => document.querySelector(`a[href="/projects/${id}"]`)?.closest("tr")?.querySelector("[data-test-project]")?.textContent ?? null,
    schemeId,
  );
  check("but it is still listed on Projects, marked Test", listed === "Test", `${listed}`);
  await sql`update projects set is_test = false where id = ${schemeId}`;

  check(
    "no React warnings on any screen this visited",
    consoleErrors.length === 0,
    consoleErrors.join(" | ").slice(0, 220),
  );
} finally {
  // Put the working list back exactly as it was, whatever happened above. The suite's own two
  // projects carry an epoch in their names and are removed by `npm run clean:test-projects`, as
  // every other suite's are.
  await unpark(parked);

  await browser.close();
  await sql.end();
}

console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} failed.`);
process.exit(fails ? 1 : 0);
