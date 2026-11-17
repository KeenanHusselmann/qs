#!/usr/bin/env node
/**
 * Create the official demonstration project — Ridgeview Gardens.
 *
 *     node scripts/seed-test-project.mjs              # create it, or leave the existing one alone
 *     node scripts/seed-test-project.mjs --recreate   # delete it and build it again
 *
 * ── Why it is driven through the browser ───────────────────────────────────────────────────
 *
 * Inserting rows would be faster and would prove nothing. The point of this project is that it was
 * produced the way a QS produces one: documents dropped into the import window, classified by the
 * same `inferKind` a user relies on, parsed by the same ingestion, grounded against the same
 * criteria. A seeded project built by INSERT would have no passages, so no criterion would ground,
 * no run would retrieve anything, and the first person to demonstrate it would find that out in
 * front of an audience.
 *
 * So this drives the real screens, and asserts as it goes. It is a check that leaves its project
 * behind on purpose.
 *
 * ── Why it survives `clean-test-projects.mjs` ──────────────────────────────────────────────
 *
 * That script deletes any project whose name carries a 13-digit epoch, because that is how every
 * suite names its own. "Ridgeview Gardens" carries no timestamp and never will — which is the
 * whole reason the name is a name rather than `Demo ${Date.now()}`. Nothing further is needed to
 * protect it, and nothing here should ever add a timestamp to it.
 *
 * ── The corpus ─────────────────────────────────────────────────────────────────────────────
 *
 * `fixtures/ridgeview/`, written by `make-test-corpus.mts` and guarded by `test-corpus.test.ts`.
 * Fifteen documents covering feasibility, procurement and cost management — the three areas named
 * for the proof of value.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { config } from "dotenv";
import postgres from "postgres";
import puppeteer from "puppeteer";

import { createProject, readEnv, signIn } from "../checks/helpers.mjs";
import { SCHEME, number } from "./lib/test-scheme.mjs";

config({ path: ".env.local", quiet: true });
const env = readEnv();

const BASE = "http://localhost:3000";
const CORPUS = "fixtures/ridgeview";

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const recreate = process.argv.includes("--recreate");

/**
 * Local only, for `clean-test-projects.mjs`'s reason.
 *
 * `--recreate` is a real delete of a named project. Against a remote database that is somebody's
 * data, and the production connection string differs from the development one by a hostname.
 */
const { hostname } = new URL(env.DATABASE_URL);
if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) {
  console.error(`Refusing to seed ${hostname}: this builds and deletes a named project, and only ever locally.`);
  process.exit(1);
}

const sql = postgres(env.DATABASE_URL, { max: 1 });

/**
 * Run one step, correct what the documents could not say, and sign it.
 *
 * ── Why a correction is passed in rather than avoided ──────────────────────────────────────
 *
 * The brief states the unit count **twice** — "Units permitted by zoning 1 143 · Units proposed
 * 1 046" — and the extractor refuses to choose between two candidates. That is the design working:
 * §1.3 says a figure nobody approved never becomes an output, and a model guessing between two
 * numbers in one sentence is exactly the confident wrong answer the platform exists to refuse. So
 * a person enters it, and this is that person.
 */
async function signOff(page, projectId, module, corrections) {
  await page.goto(`${BASE}/projects/${projectId}${module}`, { waitUntil: "networkidle0" });

  // Idempotent: a re-run over an already-signed step must not spend a second agent call.
  const existing = await page.$('[data-region="signature"]');
  if (!existing) {
    await page.evaluate(() => {
      const region = document.querySelector('[data-region="run"]');
      [...region.querySelectorAll("button")].find((b) => /^Run |^Draft /.test(b.textContent ?? ""))?.click();
    });
    await page.waitForSelector('[data-region="signature"]', { timeout: 180_000 });
  }

  for (const [fieldId, value] of corrections) {
    await page.click(`#v-${fieldId}`);
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    await page.type(`#v-${fieldId}`, value);
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      `document.querySelector('[data-field="${fieldId}"]')?.textContent.includes(${JSON.stringify(value)})`,
      { timeout: 8000 },
    );
  }

  /*
    Wait for the button, not for a moment after typing.

    Committing an override runs a server action and revalidates, and sign-off is disabled while
    that is in flight. Reading `disabled` straight after the last correction reads the *pending*
    state and calls a signable run unsignable — which is how this was first written, and it
    reported a perfectly good run as blocked. The suites learned the same lesson three times over:
    wait on the outcome, never on a proxy.
  */
  await page
    .waitForFunction(
      `[...document.querySelectorAll('[data-region="signature"] button')]
         .some((b) => /sign off/i.test(b.textContent) && !b.disabled)`,
      { timeout: 20_000 },
    )
    .catch(() => {});

  await page.evaluate(() => {
    const region = document.querySelector('[data-region="signature"]');
    [...region.querySelectorAll("button")].find((b) => /sign off/i.test(b.textContent))?.click();
  });

  await page.waitForFunction(
    `document.querySelector('[data-region="signature"]')?.textContent.includes("Signed off")`,
    { timeout: 15_000 },
  );
}

const documents = readdirSync(CORPUS)
  .filter((f) => f.endsWith(".pdf"))
  .sort();

if (documents.length === 0) {
  console.error(`No documents in ${CORPUS}. Run: npx tsx scripts/make-test-corpus.mts`);
  process.exit(1);
}

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));

try {
  const existing = await sql`
    select id, name from projects where name = ${SCHEME.name} and deleted_at is null`;

  if (existing.length > 0 && !recreate) {
    console.log(`${SCHEME.name} already exists — ${BASE}/projects/${existing[0].id}`);
    console.log("Pass --recreate to rebuild it from the corpus.");
    process.exit(0);
  }

  if (existing.length > 0) {
    // The stored originals first, while the rows still say where they are — the same ordering
    // `clean-test-projects.mjs` uses, and for the same reason.
    const stored = await sql`
      select d.storage_location from documents d
       where d.project_id in ${sql(existing.map((p) => p.id))} and d.storage_location is not null`;

    const { rm } = await import("node:fs/promises");
    const root = process.env.STORAGE_DIR ?? join(process.cwd(), ".storage");

    for (const { storage_location: location } of stored) {
      if (location.startsWith("http")) continue;
      await rm(join(root, location), { force: true }).catch(() => {});
    }

    await sql`delete from projects where id in ${sql(existing.map((p) => p.id))}`;
    console.log(`  (removed the previous ${SCHEME.name} and ${stored.length} stored files)`);
  }

  await signIn(page, env);
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });

  // Stage 1 — Feasibility & Inception. `stagesFrom` carries every later stage with it, so the
  // project is engaged for procurement and cost management too, which is what the corpus covers.
  const { href } = await createProject(page, SCHEME.name, BASE, 1);
  const id = href.split("/").pop();

  await sql`
    update projects set code = ${SCHEME.code}, client = ${SCHEME.client} where id = ${id}`;

  console.log(`  created ${SCHEME.name} (${SCHEME.code}) — ${BASE}${href}\n`);

  // ── File the corpus, through the import window a user would use ───────────────────────
  await page.goto(`${BASE}${href}/corpus`, { waitUntil: "networkidle0" });

  /**
   * Handed over as bytes, not as a path.
   *
   * The corpus input is a `webkitdirectory` picker, and Chrome will not let CDP set files on a
   * directory input — `uploadFile` silently leaves the queue empty, which looks exactly like a
   * component that failed to render. The component's other route in is a drop, so this builds the
   * `DataTransfer` a drop would have produced. Same handler, same classification, same everything
   * after the first line.
   */
  const payload = documents.map((file) => ({
    name: file,
    base64: readFileSync(resolve(CORPUS, file)).toString("base64"),
  }));

  await page.evaluate((files) => {
    const transfer = new DataTransfer();

    for (const { name, base64 } of files) {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      transfer.items.add(new File([bytes], name, { type: "application/pdf" }));
    }

    const input = document.querySelector('input[type="file"]');
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, payload);

  await page.waitForFunction(
    (count) => document.querySelectorAll("select").length >= count,
    { timeout: 30000 },
    documents.length,
  );

  /**
   * Every document classified itself.
   *
   * The filenames are the kinds, so `inferKind` should place all fifteen without help. If it
   * cannot, the corpus has drifted from the criteria and dragging the folder in — the flow this
   * project exists to demonstrate — no longer works.
   */
  const unclassified = await page.$$eval("select", (selects) =>
    selects.filter((s) => s.value === "").length,
  );
  check(`all ${documents.length} documents classified themselves`, unclassified === 0, `${unclassified} unplaced`);

  await page.$$eval("button", (buttons) =>
    buttons.find((b) => /^File \d+ documents?$/.test(b.textContent?.trim() ?? ""))?.click(),
  );

  // Filing is per document and sequential; fifteen small PDFs, but parsing is real work.
  await page.waitForFunction(
    (count) => document.querySelectorAll('[aria-label="Filed"]').length >= count,
    { timeout: 180000 },
    documents.length,
  );

  // ── What actually landed ──────────────────────────────────────────────────────────────
  const filed = await sql`
    select kind, filename from documents where project_id = ${id} and deleted_at is null order by kind`;

  check(`${documents.length} documents are filed`, filed.length === documents.length, `${filed.length} in the database`);

  const expected = documents.map((f) => f.replace(/\.pdf$/, "")).sort();
  const actual = filed.map((d) => d.kind).sort();
  check(
    "each is filed under its own kind",
    JSON.stringify(actual) === JSON.stringify(expected),
    actual.filter((k, i) => k !== expected[i]).join(", ") || "",
  );

  /**
   * Passages are what make a document readable — by the grounding that ticks a criterion and by
   * the retrieval a run does. A document filed with none is a document the platform has stored
   * and cannot use, and it looks completely normal on the corpus page.
   */
  const [{ count: passages }] = await sql`
    select count(*)::int as count from passages p
      join documents d on d.id = p.document_id
     where d.project_id = ${id}`;

  check("the documents were parsed into passages", passages > 0, `${passages} passages`);

  const [{ count: empty }] = await sql`
    select count(*)::int as count from documents d
     where d.project_id = ${id} and d.deleted_at is null
       and not exists (select 1 from passages p where p.document_id = d.id)`;

  check("no document was filed unreadable", empty === 0, `${empty} with no passages`);

  // ── Run the two steps and sign them ─────────────────────────────────────────────────────
  //
  // A corpus is not the demonstration. The report's verdict, the dashboard's cost per unit and the
  // affordability envelope all read *signed* figures, so a project with fifteen documents and no
  // signature cannot produce the one thing this project exists to show.
  //
  // It also broke the gate, quietly. `checks/settings.mjs` asserts that a practice's stored
  // assumption reaches the report — and the envelope it looks for only appears where an income
  // band is signed. After a `--recreate` that check failed with "no bond row", which reads as a
  // bug in the settings screen rather than as a half-seeded fixture, and the gate stops there so
  // the two suites after it never run at all.
  //
  // The handoff described running and signing these by hand afterwards. A manual step that a check
  // depends on is a manual step somebody forgets, so it happens here. Two DeepSeek calls, a
  // fraction of a cent, and the same screens a QS drives.
  // `number()` groups with U+00A0, as §7.7 requires and as every fixture document already does.
  // Typed with an ordinary space this would not match the figure the documents state.
  await signOff(page, id, "/feasibility", [["units", number(SCHEME.units)]]);
  await signOff(page, id, "/cost-plan", []);

  const signed = await sql`
    select module from runs where project_id = ${id} and signed_at is not null order by module`;
  check(
    "both cost-planning steps are signed off",
    signed.length === 2,
    signed.map((r) => r.module).join(", ") || "none",
  );

  console.log(`\n${SCHEME.name} is ready — ${BASE}${href}`);
  console.log(`  ${SCHEME.units} units · ${SCHEME.gfa} m² · contract sum R ${SCHEME.contractSum.toLocaleString("en-ZA")}`);
} finally {
  await browser.close();
  await sql.end();
}

process.exit(fails ? 1 : 0);
