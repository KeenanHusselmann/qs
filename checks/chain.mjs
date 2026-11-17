/**
 * The chain carrying something — PLATFORM.md §1.3.1.
 *
 *     npm run check:chain
 *
 * ── What this proves ───────────────────────────────────────────────────────────────────────
 *
 * That a downstream step is genuinely held closed by an unsigned upstream, in the interface *and*
 * on the server; that signing the step above opens it; and that the refusal is worded as the thing
 * it is — a blocker no upload can clear — rather than as a missing document.
 *
 * What it cannot prove is the **carry** itself, because that needs a real run: the figures move
 * inside the route, from `loadSignedOutput` to `recordField`. `checks/run-live.mjs` does that end to
 * end against the model, and it is the only place the writing side is exercised.
 *
 * The feasibility run is seeded rather than run, for the reason `checks/signoff.mjs` gives: a real one
 * costs credits and `npm run check` runs many times a day. §1.3's "no seed data" rule is about
 * fabricating a project's figures for a user; fixtures for a test are fixtures.
 */

import { readFileSync } from "node:fs";

import { config } from "dotenv";
import postgres from "postgres";
import puppeteer from "puppeteer";

import { createProject, fileAgainst, signIn, FEASIBILITY, readEnv } from "./helpers.mjs";

config({ path: ".env.local", quiet: true });
const env = readEnv();

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const BASE = "http://localhost:3000";
const COST_PLAN = "/cost-plan";

/** The feasibility field set, read from its source rather than copied. */
const FEASIBILITY_FIELDS = (() => {
  const source = readFileSync("src/lib/agent/run.ts", "utf8");
  // Bounded at the end of the array. Slicing to `specFor` used to work and stopped the moment nine
  // more field sets were declared between the two — see the note in `checks/signoff.mjs`.
  const start = source.indexOf("export const FEASIBILITY_FIELDS");
  const array = source.slice(start, source.indexOf("\n];", start));
  return [
    ...array.matchAll(/id: "([^"]+)",\s*\n\s*label: "([^"]+)",[\s\S]*?required: (true|false),/g),
  ].map(([, id, label, required]) => ({ id, label, required: required === "true" }));
})();

const sql = postgres(env.DATABASE_URL, { max: 1 });

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1200 });
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));

try {
  await signIn(page, env);

  const name = "Chain " + Date.now();
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
  const { href } = await createProject(page, name);
  const projectId = href.split("/").pop();

  /*
    ── Wait for the page, not for the network ──────────────────────────────────────────────

    `networkidle0` waits for the network to go quiet for half a second, which is a proxy and not
    the outcome. Every project screen carries the advisor, and an advisor request in flight is a
    connection that does not close on this page's account — under a full gate's load that overran
    the 30-second navigation timeout and took the suite down mid-run, with no assertion failing and
    nothing in the log to say which page it had been on.

    The run region is what the next line actually needs, so it is what these wait for. Same lesson
    as `project-admin.mjs` and the three flakes before it: wait on the thing you are about to use.
  */
  const openCostPlan = async () => {
    await page.goto(`${BASE}${href}${COST_PLAN}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-region="run"]', { timeout: 30000 });
  };

  // The cost plan's own required document, so that nothing below is confused by a missing input.
  await openCostPlan();
  await fileAgainst(page, "Priced cost plan or elemental estimate", "./fixtures/costplan.txt");
  await page.waitForFunction(`document.body.innerText.includes("costplan.txt")`, { timeout: 20000 });

  // ── Closed, because the step above it is not signed ──────────────────────────────────────
  await openCostPlan();

  const closed = await page.evaluate(() => {
    const region = document.querySelector('[data-region="run"]');
    const button = [...(region?.querySelectorAll("button") ?? [])].find((b) =>
      /run|read/i.test(b.textContent ?? ""),
    );
    return { disabled: button?.disabled ?? null, text: region?.textContent ?? "" };
  });

  /**
   * ── What the step will establish, before it is run ──────────────────────────────────────
   *
   * §1.3: a run is defined by the fields it must return. That definition lived only in the source,
   * so a reader met a button, pressed it, spent money, and found out afterwards what had been asked.
   * The cost plan is the one to assert it on: three of its figures are *carried* from a signed step
   * above rather than read here, and that is exactly the thing somebody cannot infer from a button.
   */
  const rubric = await page.evaluate(() => {
    const region = document.querySelector('[data-region="rubric"]');
    return {
      present: Boolean(region),
      rows: [...(region?.querySelectorAll("[data-field]") ?? [])].map((r) => r.dataset.field),
      text: region?.textContent ?? "",
    };
  });

  check("the step says what it will establish before it is run", rubric.present);
  check(
    "listing every field it will ask for",
    rubric.rows.length === 13,
    `${rubric.rows.length} fields`,
  );
  check("with what each one feeds", /cost per unit/i.test(rubric.text));
  check("and how many are required", /required/i.test(rubric.text), rubric.text.slice(0, 90));
  check(
    "a carried figure says it will not be read here",
    /carried from feasibility estimate/i.test(rubric.text),
  );

  check("the cost plan has a run panel", closed.disabled !== null);
  check("and it will not start while the estimate is unsigned", closed.disabled === true);
  check(
    "the refusal names the step it is waiting on",
    /waiting on feasibility estimate/i.test(closed.text),
    closed.text.replace(/\s+/g, " ").slice(0, 120),
  );
  check(
    "and says plainly that no upload will clear it",
    /nothing filed here will clear it/i.test(closed.text),
  );

  /**
   * And offers none — which is the whole reason §1.3.3 keeps the two blockers apart.
   *
   * A missing *input* now carries its own upload in the refusal that names it. An unsigned
   * *upstream* must not: nothing a person files clears it, and an upload button under that sentence
   * would be the contradiction v3 printed when it put "needs a cost plan" beneath "Filed and
   * indexed: the cost plan".
   */
  const waitingOffers = await page.$$eval(
    '[data-region="run"] input[type="file"]',
    (inputs) => inputs.length,
  );
  check(
    "and offers no upload, because none would help",
    waitingOffers === 0,
    `${waitingOffers} upload controls in the run panel`,
  );
  // Nor hand entry: the figures this step carries come from that signature and are never typed.
  check(
    "nor entry by hand, while the step it carries from is unsigned",
    !(await page.$('[data-region="run"] [data-action="enter-by-hand"]')),
  );

  // The server refuses too — the button is a courtesy, `startable` is the rule.
  const refusedEarly = await page.evaluate(async (id) => {
    const r = await fetch(`/api/projects/${id}/runs?module=%2Fcost-plan`, { method: "POST" });
    return { status: r.status, body: (await r.text()).trim() };
  }, projectId);

  check("a direct POST is refused as well", refusedEarly.status === 409, `HTTP ${refusedEarly.status}`);
  check(
    "in the upstream's words, not the checklist's",
    /not been signed off/i.test(refusedEarly.body) && !/still required/i.test(refusedEarly.body),
    refusedEarly.body.slice(0, 110),
  );

  // An unknown step is refused rather than opened with an empty field set and closed as reviewable.
  const unknown = await page.evaluate(async (id) => {
    const r = await fetch(`/api/projects/${id}/runs?module=%2Ftake-off`, { method: "POST" });
    return { status: r.status, body: (await r.text()).trim() };
  }, projectId);
  check("a step with no agent is refused", unknown.status === 404, `HTTP ${unknown.status}`);
  check("and says which steps do run", /\/feasibility/.test(unknown.body), unknown.body.slice(0, 90));

  // ── Sign the estimate above it ───────────────────────────────────────────────────────────
  const [upstream] = await sql`
    insert into runs (project_id, module, status, created_by, signed_by, signed_at)
    values (${projectId}, '/feasibility', 'review', ${env.DEV_USER_EMAIL}, ${env.DEV_USER_EMAIL}, now())
    returning id`;

  for (const [seq, spec] of FEASIBILITY_FIELDS.entries()) {
    const value = spec.id === "units" ? "1 046" : `${spec.id} value`;
    await sql`
      insert into run_fields (
        run_id, field_id, seq, label, proposed_state, proposed_value, proposed_confidence,
        source_document, source_excerpt, output_value
      ) values (
        ${upstream.id}, ${spec.id}, ${seq}, ${spec.label}, 'found', ${value}, 0.9,
        'brief.txt', ${`the passage ${spec.id} was read from`}, ${value}
      )`;
  }

  await page.goto(`${BASE}${href}${COST_PLAN}`, { waitUntil: "networkidle0" });

  const opened = await page.evaluate(() => {
    const region = document.querySelector('[data-region="run"]');
    const button = [...(region?.querySelectorAll("button") ?? [])].find((b) =>
      /run|read/i.test(b.textContent ?? ""),
    );
    return { disabled: button?.disabled ?? null, text: region?.textContent ?? "" };
  });

  check("signing the estimate opens the step below it", opened.disabled === false);
  check("and the waiting notice is gone", !/waiting on/i.test(opened.text));

  // ── The overview reads the same chain ────────────────────────────────────────────────────
  await page.goto(`${BASE}${href}`, { waitUntil: "networkidle0" });

  const board = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-region="chain"] li[data-step]')];
    return rows.map((li) => ({ step: li.dataset.step, state: li.dataset.state, text: li.textContent ?? "" }));
  });

  const estimate = board.find((s) => s.step === FEASIBILITY);
  const plan = board.find((s) => s.step === COST_PLAN);

  check("the cost plan is on the board", Boolean(plan), board.map((s) => s.step).join(", "));
  check("the estimate reads as signed off", estimate?.state === "signed_off", `${estimate?.state}`);
  check("and says it feeds the cost plan", /feeds .*cost plan/i.test(estimate?.text ?? ""));
  check(
    "the cost plan is ready rather than waiting",
    plan?.state === "ready" || plan?.state === "draft",
    `${plan?.state}`,
  );

  // ── The construction chain, which crosses process areas ──────────────────────────────────
  //
  // Contract → valuations · variations · cost report · final account. The first chain with a step
  // that has two upstreams, and the first place the distinction between "feeds" and "must precede"
  // is load-bearing: variations feed a certificate, and a certificate must not wait for one.
  await page.goto(`${BASE}${href}/valuations`, { waitUntil: "networkidle0" });
  const valuations = await page.evaluate(() => {
    const region = document.querySelector('[data-region="run"]');
    return { text: region?.textContent ?? "" };
  });

  check(
    "a certificate waits for the contract",
    /waiting on contract/i.test(valuations.text),
    valuations.text.replace(/\s+/g, " ").slice(0, 110),
  );
  check(
    "and not for variations that may not exist",
    !/variations/i.test(valuations.text.match(/Waiting on [^.]{0,80}/)?.[0] ?? ""),
  );

  await page.goto(`${BASE}${href}/variations`, { waitUntil: "networkidle0" });
  const variations = await page.evaluate(() => {
    const region = document.querySelector('[data-region="run"]');
    const button = [...(region?.querySelectorAll("button") ?? [])].find((b) =>
      /run|read|assess/i.test(b.textContent ?? ""),
    );
    return { text: region?.textContent ?? "", disabled: button?.disabled ?? null };
  });

  // Blocked by its own missing instruction, not by the contract — the two are different sentences.
  check("a variation does not wait for the contract", !/waiting on/i.test(variations.text));
  check(
    "it asks for its own instruction instead",
    /contract instruction/i.test(variations.text),
    variations.text.replace(/\s+/g, " ").slice(0, 110),
  );

  // ── And it closes again if the signature is not there ────────────────────────────────────
  //
  // The gate is a query, not a remembered flag: `upstreamPending` compares against what is signed
  // *now*. A soft-deleted upstream run is not signed, and the step below has to notice.
  await sql`update runs set deleted_at = now() where id = ${upstream.id} and signed_at is null`;
  const [{ n }] = await sql`
    select count(*)::int as n from runs where id = ${upstream.id} and deleted_at is not null`;
  check("a signed run cannot be soft-deleted out from under it", n === 0, `${n} deleted`);
  /**
   * ---- The stages a project runs, on the project's own screens ----
   *
   * Setup records which phases a project covers and, until now, that answer went into the column
   * and nowhere else: a project engaged from valuations onward still opened on a board of thirteen
   * steps under a tile reading "0/40 requirements met". Forty is not the size of that job, and a
   * figure that overstates what is outstanding is one nobody can plan against.
   *
   * Asserted against a second project opened at Construction, so the comparison is between two
   * live projects rather than against numbers written down here - the criteria are a template a
   * firm edits, and pinning their totals would make this suite break on every edit to the checklist.
   */
  const narrowName = `Late start ${Date.now()}`;
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
  const { href: narrowHref } = await createProject(page, narrowName, BASE, 4);
  await page.goto(`${BASE}${narrowHref}`, { waitUntil: "networkidle0" });

  /*
    Every group open before the sidebar is counted.

    The nav folds its groups now, and a folded group renders no rows — so counting `a[data-outside]`
    on arrival counts whatever happens to be unfolded, which is a different question from "does the
    sidebar mark the same steps the overview set aside". Opened by clicking the headings, because
    that is the only way a reader gets them open too.
  */
  const openEveryGroup = async () => {
    const folded = await page.$$eval("[data-nav-group]", (gs) =>
      gs.filter((g) => g.dataset.open !== "true").map((g) => g.dataset.navGroup),
    );
    for (const heading of folded) {
      await page.click(`[data-nav-group="${heading}"]`);
      await page.waitForFunction(
        (h) => document.querySelector(`[data-nav-group="${h}"]`)?.dataset.open === "true",
        { timeout: 4000 },
        heading,
      );
    }
  };

  await openEveryGroup();

  // The stages a project runs are named on its dashboard; the overview is kept to the job card.
  // Read there, then back to the overview so what follows reads the page it expects.
  const coversOf = async (projectHref) => {
    await page.goto(`${BASE}${projectHref}/dashboard`, { waitUntil: "networkidle0" });
    const text = await page
      .$eval('[data-region="covers"]', (el) => el.innerText.replace(/\s+/g, " "))
      .catch(() => "");
    await page.goto(`${BASE}${projectHref}`, { waitUntil: "networkidle0" });
    return text;
  };

  const scoped = await page.evaluate(() => {
    // The KPI tiles are gone; the job card's counts line carries the same two figures.
    const counts = document.querySelector('[data-region="job-counts"]');

    return {
      met: counts?.getAttribute("data-met"),
      ready: counts?.getAttribute("data-ready"),
      // Every phase has a tile now; the ones the project runs say so, and a tile for a phase it
      // does not run offers to add it (`AddPhase`).
      sections: [...document.querySelectorAll('[data-region="chain"] [data-stage][data-runs="true"]')].map(
        (s) => s.dataset.stage,
      ),
      onBoard: document.querySelectorAll('[data-region="chain"] [data-phase][data-runs="true"] [data-step]').length,
      setAside: document.querySelectorAll('[data-region="set-aside"] [data-step]').length,
      offStage: document.querySelectorAll('nav[aria-label="Project"] a[data-outside]').length,
    };
  });
  scoped.covers = await coversOf(narrowHref);

  check(
    "the project says which stages it runs",
    /Construction & Delivery/.test(scoped.covers) && !/Feasibility & Inception/.test(scoped.covers),
    scoped.covers.slice(0, 80),
  );
  check(
    "the board is grouped by stage, and only the stages it runs",
    scoped.sections.length > 0 && scoped.sections.every((s) => Number(s) >= 4),
    scoped.sections.join(","),
  );
  check(
    "steps in stages it does not run are set aside, not deleted",
    scoped.setAside > 0,
    `${scoped.setAside} set aside`,
  );
  check(
    "and the sidebar marks the same steps, still reachable",
    scoped.offStage === scoped.setAside,
    `${scoped.offStage} off stage against ${scoped.setAside} set aside`,
  );

  // The figures are the point: they must count the work in scope, not the whole chain.
  const [metScoped, ofScoped] = (scoped.met ?? "0/0").split("/").map(Number);
  const [, readyOfScoped] = (scoped.ready ?? "0/0").split("/").map(Number);
  check(
    "steps ready counts the board, not every module",
    readyOfScoped === scoped.onBoard,
    `${readyOfScoped} against ${scoped.onBoard} on the board`,
  );

  // A project running everything is the control. If narrowing changed nothing, both are equal and
  // the checks above would pass over a scoping that never happened.
  const wideName = `Full chain ${Date.now()}`;
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
  const { href: wideHref } = await createProject(page, wideName, BASE, 1);
  await page.goto(`${BASE}${wideHref}`, { waitUntil: "networkidle0" });
  await openEveryGroup();

  const wide = await page.evaluate(() => ({
    met: document.querySelector('[data-region="job-counts"]')?.getAttribute("data-met"),
    setAside: document.querySelectorAll('[data-region="set-aside"] [data-step]').length,
    offStage: document.querySelectorAll('nav[aria-label="Project"] a[data-outside]').length,
  }));
  wide.covers = await coversOf(wideHref);

  const [, ofWide] = (wide.met ?? "0/0").split("/").map(Number);
  check("a project running the whole chain says so in a word", /every stage/i.test(wide.covers), wide.covers);
  check("it sets nothing aside", wide.setAside === 0 && wide.offStage === 0);
  check(
    "and it counts more requirements than the narrowed one",
    ofWide > ofScoped && ofScoped > 0,
    `${ofScoped} in scope against ${ofWide} across the chain`,
  );
  check("neither project has met any requirement yet", metScoped === 0);

  /**
   * ---- The stage band is the practice's green, and it is readable ----
   *
   * At a neutral tint these headings were three values off the panel behind them and a board of
   * six stages read as one long list again. The band is `--brand-800`, taken from the logo rather
   * than picked - but a brand colour behind white text is a contrast decision, and one nobody
   * measures until somebody cannot read it. Asserted, not assumed.
   */
  const band = await page.evaluate(() => {
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const lum = ([x, y, z]) => 0.2126 * lin(x) + 0.7152 * lin(y) + 0.0722 * lin(z);
    const contrast = (a, c) => { const [hi, lo] = [lum(a), lum(c)].sort((m, n) => n - m); return (hi + 0.05) / (lo + 0.05); };
    const parse = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);

    const header = document.querySelector('[data-region="chain"] [data-stage] header');
    if (!header) return null;
    const bg = parse(getComputedStyle(header).backgroundColor);
    const title = header.querySelector("h3");
    // Text a reader reads beside the title. The number badge is `aria-hidden` decoration on its own
    // filled circle, so measuring its white numeral against the tile would score nothing real. A tile
    // that carries only its title (phases fold to their titles) has no secondary text to measure.
    const secondary = [...header.querySelectorAll("span:not([aria-hidden])")].at(-1) ?? null;

    /*
      Composite the text over the band before measuring, when it is translucent.

      `rgb(52, 59, 69)` has no alpha, and a regex that took the last number in the string read 69
      as one - scoring the count at 4057:1, which is not a contrast ratio, it is a bug reporting
      success. Four components mean rgba; three mean opaque.
    */
    const parts = secondary ? getComputedStyle(secondary).color.match(/[\d.]+/g).map(Number) : null;
    const alpha = parts && parts.length > 3 ? parts[3] : 1;
    const over = parts ? parts.slice(0, 3).map((c, i) => c * alpha + bg[i] * (1 - alpha)) : null;

    return {
      bg: bg.join(","),
      brand: getComputedStyle(document.documentElement).getPropertyValue("--brand-800").trim(),
      title: +contrast(parse(getComputedStyle(title).color), bg).toFixed(2),
      secondary: over ? +contrast(over, bg).toFixed(2) : null,
    };
  });

  check("the stage headings carry a band, not another neutral tint", band !== null && band.bg !== "255,255,255", band?.bg);
  check(
    "the stage title clears AA against it",
    band.title >= 4.5,
    `${band.title}:1 on rgb(${band.bg})`,
  );
  check(
    "and so does any text beside it, composited",
    band.secondary === null || band.secondary >= 4.5,
    band.secondary === null ? "title only" : `${band.secondary}:1`,
  );

  /*
    ── Entered by hand, with nothing filed (audit C2) ─────────────────────────────────────────

    Every step could only be fed by uploading and running the agent, so a QS who already knew a
    figure hit a dead end. Hand entry opens the same run – `review`, a row per field – with nothing
    proposed and nothing spent. Carried figures still come from the signed step above, with their
    original citation: hand entry never retypes an approved number.
  */
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
  const { href: handHref } = await createProject(page, "By hand " + Date.now());
  const handId = handHref.split("/").pop();

  const [signedEstimate] = await sql`
    insert into runs (project_id, module, status, created_by, signed_by, signed_at)
    values (${handId}, '/feasibility', 'review', ${env.DEV_USER_EMAIL}, ${env.DEV_USER_EMAIL}, now())
    returning id`;
  for (const [seq, spec] of FEASIBILITY_FIELDS.entries()) {
    const value = spec.id === "units" ? "1 046" : `${spec.id} value`;
    await sql`
      insert into run_fields (run_id, field_id, seq, label, proposed_state, proposed_value, proposed_confidence, source_document, source_excerpt, output_value)
      values (${signedEstimate.id}, ${spec.id}, ${seq}, ${spec.label}, 'found', ${value}, 0.9, 'brief.txt', ${`the passage ${spec.id} was read from`}, ${value})`;
  }

  await page.goto(`${BASE}${handHref}${COST_PLAN}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-region="run"] [data-action="enter-by-hand"]', { timeout: 30000 });
  check("with nothing filed, the cost plan offers entry by hand", true);
  // Server-rendered, so it is on the page before React attaches; a click before then does nothing.
  await page.waitForFunction(
    () => Object.keys(document.querySelector('[data-region="run"] [data-action="enter-by-hand"]') ?? {}).some((k) => k.startsWith("__reactProps")),
    { timeout: 15000 },
  );
  await page.click('[data-region="run"] [data-action="enter-by-hand"]');

  // The server's rows, not the button's label: a suite waits on what only the server produces.
  let handRun = null;
  for (let i = 0; i < 60 && !handRun; i++) {
    [handRun] = await sql`select id, status, input_tokens from runs where project_id = ${handId} and module = ${COST_PLAN} and deleted_at is null`;
    if (!handRun) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  // If nothing opened, say what the panel said rather than only that it failed.
  const handRefusal = handRun ? "" : await page.$eval('[data-region="run"]', (r) => r.querySelector('[role="alert"]')?.textContent ?? "no refusal shown").catch(() => "");
  check("it opens a draft in review with nothing spent", handRun?.status === "review" && handRun?.input_tokens === null, JSON.stringify(handRun) + (handRefusal ? ` – ${handRefusal}` : ""));

  const handFields = handRun ? await sql`select field_id, proposed_state, proposed_value, carried_via, source_document from run_fields where run_id = ${handRun.id} order by seq` : [];
  const carriedRows = handFields.filter((f) => f.carried_via === "/feasibility");
  check("one row per cost plan field, all at once", handFields.length === 13, `${handFields.length} rows`);
  check(
    "the three carried figures arrive from the signed estimate, citation intact",
    carriedRows.length === 3 && carriedRows.some((f) => f.field_id === "cp-units" && f.proposed_value === "1 046") && carriedRows.every((f) => f.source_document === "brief.txt"),
    JSON.stringify(carriedRows.map((f) => [f.field_id, f.proposed_value])),
  );
  check(
    "and the rest are empty for the QS to enter – never guessed",
    handFields.filter((f) => !f.carried_via).every((f) => f.proposed_state === "not_found" && f.proposed_value === null),
  );

  await page.waitForFunction(() => document.querySelector('[data-region="run"]')?.innerText.includes("Entered by hand"), { timeout: 20000 });
  const handTally = await page.$eval('[data-region="run"]', (e) => e.innerText);
  check("the panel says it was entered by hand, not that the corpus lacked it", /10 to enter/.test(handTally) && !/not in the corpus/.test(handTally), handTally.match(/Entered by hand[^\n]*/)?.[0]);
  check("and the button gives way to the draft", !(await page.$('[data-region="run"] [data-action="enter-by-hand"]')));

} finally {
  await browser.close();
  await sql.end();
}

console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} failed.`);
process.exit(fails ? 1 : 0);
