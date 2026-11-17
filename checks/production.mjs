/**
 * The one thing local testing cannot prove — a real run, on production.
 *
 *     npm run check:production
 *
 * ── Why this exists when seventeen suites are already green ────────────────────────────────
 *
 * Every one of those runs against local dev: local Postgres, the local disk for documents, the key
 * in `.env.local`. They prove the *code*. They say nothing about production's environment, and this
 * platform has already been bitten there once — `store()` fell through to a disk write with no Blob
 * token, Vercel's filesystem does not persist, and every document filed on production was parsed,
 * indexed, and its original thrown away. Silently, for weeks. The code was correct throughout.
 *
 * So this exercises the things only production has: Neon over the wire, the Blob store actually
 * retaining bytes, the DeepSeek key in the production environment, and the freeze triggers on Neon
 * rather than on a container on this laptop.
 *
 * ── Getting past Deployment Protection ─────────────────────────────────────────────────────
 *
 * Production bounces anything unauthenticated to Vercel SSO — `curl` gets a 302 to `vercel.com`,
 * not the login screen. That is deliberate and stays on: these are a client's geotechnical reports.
 *
 * **Protection Bypass for Automation** is the supported way through: a secret this script presents
 * as a header, with Deployment Protection itself left on. It clears the first gate; the app's own
 * login is still the second.
 *
 * The secret is **not** in `vercel env pull`, and that is deliberate rather than an oversight —
 * every other `VERCEL_*` system variable comes through and this one is withheld, because it is the
 * key to a protected deployment. It is copied once from the dashboard into `.env.production.local`,
 * which `.gitignore` already covers.
 *
 * ── It cleans up after itself ──────────────────────────────────────────────────────────────
 *
 * `scripts/clean-test-projects.mjs` refuses to run against anything but a local database, and that
 * refusal is correct — a housekeeping script is the last place to discover a hostname difference. So
 * this deletes its own project through the interface, the way a person would.
 */

import { existsSync } from "node:fs";

import puppeteer from "puppeteer";

import { readEnv } from "./helpers.mjs";

/**
 * Production's own environment, not this laptop's.
 *
 *     vercel env pull .env.production.local --environment=production
 *
 * Production's credentials are read from here where they can be — but they are marked Sensitive on
 * Vercel, so the pull redacts them and the local pair is used instead, said out loud. See below.
 */
const ENV_FILE = ".env.production.local";

if (!existsSync(ENV_FILE)) {
  console.error(
    `No ${ENV_FILE}. Run:
  vercel env pull ${ENV_FILE} --environment=production`,
  );
  process.exit(1);
}

const pulled = readEnv(ENV_FILE);

/**
 * A value marked **Sensitive** on Vercel comes back as the literal string `[SENSITIVE]`.
 *
 * This is the second time that has cost an hour. `[SENSITIVE]` is not a value and behaves like one
 * everywhere it is used: as `DATABASE_URL` it threw `ERR_INVALID_URL` from the migrator, and typed
 * into `<input type="email">` it fails the browser's own validation, so the form silently refuses to
 * submit, no request is made, and the suite dies on a navigation timeout with nothing to explain it.
 * That is the same shape as the quoted-`.env.local` bug already in the handoff: **a credential that
 * is subtly not a credential produces no error, only an absence.**
 *
 * So it is treated as absent, out loud, and the local pair is used instead — which is honest as long
 * as it is stated, because a suite signing in with credentials it did not read from the machine it
 * is testing should say so rather than imply otherwise.
 */
const REDACTED = "[SENSITIVE]";
const usable = (value) => (value && value !== REDACTED ? value : undefined);

const local = readEnv(".env.local");

/*
  A person's own account first (ARC-003). Production refuses the environment credential unless the
  deployment sets OPERATOR_LOGIN=1, so the honest way to sign in there is as somebody with a row:
  QS_EMAIL and QS_PASSWORD, the same pair `scripts/lib/sign-in.mjs` reads.
*/
const own = process.env.QS_EMAIL && process.env.QS_PASSWORD;

const env = {
  ...pulled,
  DEV_USER_EMAIL: own ? process.env.QS_EMAIL.trim() : (usable(pulled.DEV_USER_EMAIL) ?? local.DEV_USER_EMAIL),
  DEV_USER_PASSWORD: own ? process.env.QS_PASSWORD : (usable(pulled.DEV_USER_PASSWORD) ?? local.DEV_USER_PASSWORD),
};

if (own) {
  console.log(`  note: signing in as ${env.DEV_USER_EMAIL} from QS_EMAIL / QS_PASSWORD.\n`);
} else if (!usable(pulled.DEV_USER_EMAIL)) {
  console.log(
    `  note: production's credentials are marked Sensitive, so ${ENV_FILE} carries "${REDACTED}"` +
      ` rather than them. Signing in with the pair from .env.local instead.
`,
  );
}

/*
  The same address `scripts/deploy.mjs` probes, overridable the same way. This read the
  `x4o-projects` scope that production left on 2 Sep 2026 (HANDOFF "Where it runs"), so the suite
  meant to prove production worked was testing a deployment nobody uses any more (ARC-002 review).
*/
const BASE = process.env.VERCEL_PRODUCTION_URL ?? "https://qs-management-platform-raymond-3084s-projects.vercel.app";

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

/**
 * The bypass secret.
 *
 * **`vercel env pull` does not include it**, and that is Vercel's decision rather than an oversight:
 * every other `VERCEL_*` system variable comes through — `VERCEL_ENV`, `VERCEL_URL`, the whole git
 * block — and this one is withheld because it is the key to a protected deployment. It has to be
 * copied once from Settings → Deployment Protection into `.env.production.local`, which `.gitignore`
 * already covers with `.env*`.
 *
 * Into the file, never onto a command line: an argument is a secret in a shell history, and an
 * environment variable exported by hand is one in a scrollback.
 */
const BYPASS =
  process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? env.VERCEL_AUTOMATION_BYPASS_SECRET;

if (!BYPASS) {
  console.error(
    [
      `No VERCEL_AUTOMATION_BYPASS_SECRET in ${ENV_FILE}, so production cannot be reached.`,
      "",
      "It is deliberately not included in `vercel env pull`, so it is copied once by hand:",
      "",
      "  1. Vercel → qs-management-platform → Settings → Deployment Protection",
      "  2. Protection Bypass for Automation → the eye icon → copy the secret",
      `  3. Add to ${ENV_FILE}:  VERCEL_AUTOMATION_BYPASS_SECRET="<the secret>"`,
      "",
      "That file is gitignored. Deployment Protection itself stays on — the bypass is a",
      "header this script presents, not a door left open.",
    ].join("\n"),
  );
  process.exit(1);
}

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1200 });
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));

/**
 * The bypass on every request, and the cookie so redirects keep it.
 *
 * Without `x-vercel-set-bypass-cookie` the header covers the first request and the browser's own
 * navigations — a redirect to `/login`, an image, a server action — arrive without it and land back
 * at Vercel's SSO. That reads as "the login screen is broken" rather than "the second request was
 * not carrying the header".
 */
await page.setExtraHTTPHeaders({
  "x-vercel-protection-bypass": BYPASS,
  "x-vercel-set-bypass-cookie": "true",
});

const name = `Production smoke ${Date.now()}`;

try {
  // ── Past the first gate ─────────────────────────────────────────────────────────────────
  const landing = await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });

  check("the bypass reaches the app rather than Vercel SSO", landing.status() === 200, `HTTP ${landing.status()}`);
  check("and it is our login screen", !page.url().includes("vercel.com"), page.url());

  const health = await page.evaluate(async () => {
    const r = await fetch("/api/health");
    return { status: r.status, body: await r.text() };
  });
  console.log(`  health: ${health.body}`);
  check("production is healthy", /"status":"ok"/.test(health.body));
  check("the database is Neon and reachable", /"database":"reachable"/.test(health.body));
  check("the model key is configured there", /"agent":"configured"/.test(health.body));

  // ── The second gate ─────────────────────────────────────────────────────────────────────
  await page.type("#email", env.DEV_USER_EMAIL);
  await page.type("#password", env.DEV_USER_PASSWORD);
  await Promise.all([page.click('button[type="submit"]'), page.waitForNavigation()]);
  check("the production credentials sign in", !page.url().includes("/login"), page.url());

  // ── A project, and the documents a run needs ────────────────────────────────────────────
  const { createProject, fileAgainst } = await import("./helpers.mjs");
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
  const { href } = await createProject(page, name, BASE);
  check("a project can be created on production", Boolean(href), href);

  for (const [criterion, fixture] of [
    ["Project brief and concept parameters", "./fixtures/brief.txt"],
    ["Market data", "./fixtures/market.txt"],
    ["Concept layouts", "./fixtures/layouts.txt"],
  ]) {
    await page.goto(`${BASE}${href}/feasibility`, { waitUntil: "networkidle0" });
    await fileAgainst(page, criterion, fixture);
    const filed = fixture.split("/").pop();
    await page.waitForFunction(
      `document.body.innerText.includes(${JSON.stringify(filed)})`,
      { timeout: 30000 },
    );
  }

  /**
   * The Blob store, which is the thing that failed silently for weeks.
   *
   * A document whose original was discarded still parses, still indexes, still satisfies a
   * criterion — and cannot be opened. The viewer streaming real bytes is the only proof that the
   * store is connected, so it is asserted rather than assumed.
   */
  await page.goto(`${BASE}${href}/corpus`, { waitUntil: "networkidle0" });
  const opened = await page.evaluate(async () => {
    const link = [...document.querySelectorAll("a")].find((a) => /brief\.txt/.test(a.textContent ?? ""));
    if (!link) return { found: false };
    const r = await fetch(link.href);
    return { found: true, status: r.status, bytes: (await r.text()).length };
  });

  check("the filed original can be opened on production", opened.found && opened.status === 200, `HTTP ${opened.status}`);
  check("and real bytes come back, so the store retained it", (opened.bytes ?? 0) > 200, `${opened.bytes} bytes`);

  // ── The run itself ──────────────────────────────────────────────────────────────────────
  await page.goto(`${BASE}${href}/feasibility`, { waitUntil: "networkidle0" });
  const startable = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /run extraction/i.test(x.textContent ?? ""));
    return b?.disabled ?? null;
  });
  check("the step is startable once its inputs are filed", startable === false);

  console.log("\n  running against production…\n");

  const run = await page.evaluate(async (id) => {
    const r = await fetch(`/api/projects/${id}/runs`, { method: "POST" });
    const text = await r.text();
    return {
      status: r.status,
      events: text.split("\n").filter((l) => l.trim()).map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return { type: "unparsed", raw: l.slice(0, 120) };
        }
      }),
    };
  }, href.split("/").pop());

  const fields = run.events.filter((e) => e.type === "field").map((e) => e.result);
  const failure = run.events.find((e) => e.type === "error");
  if (failure) console.log(`  [run error] ${failure.error}`);

  for (const f of fields) {
    const mark = { found: "✓", uncertain: "?", not_found: "·" }[f.state];
    console.log(`  ${mark} ${f.field.label.padEnd(30)} ${f.value ?? "—"}`);
  }

  check("the run completes on production", run.status === 200 && !failure, `HTTP ${run.status}`);
  check("every field is answered", fields.length === 11, `${fields.length}/11`);
  check(
    "it reads the unit count out of the brief",
    /1\s*046/.test(fields.find((f) => f.field.id === "units")?.value ?? ""),
    fields.find((f) => f.field.id === "units")?.value ?? "—",
  );
  check("grounded fields carry a citation", fields.filter((f) => f.citation).length > 0);

  // ── It survives a reload, which is the run being a row on Neon ──────────────────────────
  await page.goto(`${BASE}${href}/feasibility`, { waitUntil: "networkidle0" });
  const reloaded = await page.$eval('[data-region="run"]', (r) => r.textContent ?? "");
  check("the run is still there after a reload", /1\s*046/.test(reloaded));
  check("and says it is not signed off", /next step cannot read these until it is/i.test(reloaded));
} finally {
  /**
   * Delete the project through the interface, the way a person would — and **check that it went**.
   *
   * The first version clicked a button matching `/delete/i` and printed "Removing…". Deleting needs
   * the project's name typed into `#confirm` first (§7.7 — the one irreversible act on the screen),
   * so the button was disabled and the click did nothing. The project stayed on production and the
   * script said it had gone.
   *
   * That is the failure this whole codebase is arranged against, committed by the cleanup code:
   * **reporting an outcome instead of observing one.** So it types the confirmation, and then reads
   * the project list back and says which of the two actually happened.
   *
   * `clean-test-projects.mjs` is not an option here — it refuses anything but a local database, and
   * that refusal is right.
   */
  try {
    await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
    const link = await page.$$eval(
      "main a[href^='/projects/']",
      (links, n) => links.find((l) => l.textContent.includes(n))?.getAttribute("href"),
      name,
    );

    if (link) {
      await page.goto(`${BASE}${link}/settings`, { waitUntil: "networkidle0" });
      await page.type("#confirm", name);
      await page.evaluate(() => {
        [...document.querySelectorAll("button")]
          .find((b) => /delete project/i.test(b.textContent ?? ""))
          ?.click();
      });

      // Read it back rather than trusting the click.
      await page
        .waitForFunction(`!document.body.innerText.includes(${JSON.stringify(name)})`, {
          timeout: 20000,
        })
        .catch(() => {});

      await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
      const remaining = await page.$$eval("main a[href^='/projects/']", (links) =>
        links.map((l) => l.textContent ?? ""),
      );

      const gone = !remaining.some((text) => text.includes(name));
      console.log(gone ? `
  Removed ${name}.` : `
  STILL ON PRODUCTION: ${name} — remove it by hand.`);
      if (!gone) fails += 1;
    }
  } catch (error) {
    console.log(`
  Cleanup failed, so ${name} is still on production: ${error.message}`);
    fails += 1;
  }

  await browser.close();
}

console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} failed.`);
process.exit(fails ? 1 : 0);
