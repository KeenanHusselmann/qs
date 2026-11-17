/**
 * Sign-off and the service chain — PLATFORM.md §1.3.1.
 *
 *     npm run check:signoff
 *
 * ── What this proves ───────────────────────────────────────────────────────────────────────
 *
 * That a run is a record rather than a screenful of state: it is there after a reload, in a tab that
 * never ran it, with `proposed` untouched by any correction, `working` taking the human's figure
 * over the machine's, and `output` frozen the moment somebody puts their name to it. And that the
 * freeze is a guarantee and not a habit — the database itself refuses to edit a signed run, which is
 * asserted here in SQL rather than trusted.
 *
 * ── Why the run is seeded ──────────────────────────────────────────────────────────────────
 *
 * A real run costs DeepSeek credits, and `npm run check` runs many times a day. §1.3's "no seed
 * data" rule is about a project's figures being invented; fixtures for a test are fixtures. What
 * this cannot show is that the *route* writes rows of this shape — that is `checks/run-live.mjs`, which
 * runs deliberately and asserts the persisted rows against the events it watched being streamed.
 *
 * The field set is read out of `run.ts` rather than copied here, so a suite cannot go on passing
 * against a spec that has moved.
 */

import { readFileSync } from "node:fs";

import { config } from "dotenv";
import postgres from "postgres";
import puppeteer from "puppeteer";

import {
  createProject,
  fileAgainst,
  signIn,
  watchConsole,
  FEASIBILITY,
  readEnv,
} from "./helpers.mjs";

config({ path: ".env.local", quiet: true });
const env = readEnv();

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const BASE = "http://localhost:3000";

/** The live field set, parsed from its source the way `check-modules.mjs` parses the criteria. */
const SPECS = (() => {
  const source = readFileSync("src/lib/agent/run.ts", "utf8");
  /**
   * Bounded at the end of the array, and that bound is the bug this had.
   *
   * It sliced from `export const FEASIBILITY_FIELDS` to the end of the file, which was harmless
   * while that was the only field set. Nine more were added after it and the regex went on matching
   * — so this seeded **87 fields** into a feasibility run and called them the feasibility field set.
   * Project Data made it visible by rendering `cp-substructure` under the Feasibility Estimate.
   *
   * The count is asserted exactly, not as "at least ten", because "at least" is what let it pass.
   */
  const start = source.indexOf("export const FEASIBILITY_FIELDS");
  const array = source.slice(start, source.indexOf("\n];", start));
  return [
    ...array.matchAll(/id: "([^"]+)",\s*\n\s*label: "([^"]+)",[\s\S]*?required: (true|false),/g),
  ].map(([, id, label, required]) => ({ id, label, required: required === "true" }));
})();

check("the field set was parsed from run.ts", SPECS.length === 11, `${SPECS.length} fields`);
if (SPECS.length !== 11) process.exit(1);

/** The one required field the seeded run leaves unanswered, so the gate has something to refuse. */
const GAP = SPECS.find((s) => s.required && s.id === "absorption") ?? SPECS.find((s) => s.required);

const sql = postgres(env.DATABASE_URL, { max: 1 });

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1200 });
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));

// React warnings are console errors, not exceptions, so `pageerror` never saw them. See the note
// on `watchConsole` for the key-collision bug that shipped past seventeen green suites.
const consoleErrors = watchConsole(page);

try {
  await signIn(page, env);

  const name = "Sign-off " + Date.now();
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
  const { href } = await createProject(page, name);
  const projectId = href.split("/").pop();

  // A real document, so the citations point at something a reader could open.
  await page.goto(`${BASE}${href}${FEASIBILITY}`, { waitUntil: "networkidle0" });
  await fileAgainst(page, "Project brief and concept parameters", "./fixtures/brief.txt");
  await page.waitForFunction(`document.body.innerText.includes("brief.txt")`, { timeout: 20000 });

  const [document] = await sql`
    select id, filename from documents where project_id = ${projectId} limit 1`;
  check("the brief is filed", Boolean(document), document?.filename ?? "nothing filed");

  // A passage really in that document, so the quote shown is the document's own characters.
  const [passage] = await sql`
    select page, body from passages where document_id = ${document.id} order by seq limit 1`;
  const quote = passage.body.replace(/\s+/g, " ").trim().slice(0, 80);

  // ── A finished run, as the route would have left it ─────────────────────────────────────
  const [run] = await sql`
    insert into runs (project_id, module, status, input_tokens, output_tokens, created_by)
    values (${projectId}, '/feasibility', 'review', 4210, 880, ${env.DEV_USER_EMAIL})
    returning id`;

  /**
   * One field is seeded stating a unit the field does not record — a programme given in years
   * against a field recorded in months.
   *
   * The live version of this is a market study saying "12 units per month" where absorption is
   * recorded per year: a 12× error that nothing else in any suite can see, because nothing
   * crashes, nothing is blank and the confidence badge reads 100%.
   *
   * Seeded, not updated. `run_fields_frozen()` refuses any edit to `proposed_value` — §1.3.1
   * enforced in the database — so the only way to have the agent propose a thing is to have
   * proposed it. `programme` is last in the set and is not the field the citation checks use.
   */
  const UNIT_MISMATCH = "programme";

  for (const [seq, spec] of SPECS.entries()) {
    const answered = spec.id !== GAP.id;
    await sql`
      insert into run_fields (
        run_id, field_id, seq, label,
        proposed_state, proposed_value, proposed_confidence, proposed_note,
        source_document_id, source_document, source_page, source_excerpt
      ) values (
        ${run.id}, ${spec.id}, ${seq}, ${spec.label},
        ${answered ? "found" : "not_found"},
        ${answered ? (spec.id === UNIT_MISMATCH ? "3 years" : `${spec.id} value`) : null},
        ${answered ? 0.9 : 0},
        ${answered ? null : "The passages that cover this do not state a figure for it."},
        ${answered ? document.id : null},
        ${answered ? document.filename : null},
        ${answered ? (passage.page ?? null) : null},
        ${answered ? quote : null}
      )`;
  }

  // ── It survives a page that never ran it ────────────────────────────────────────────────
  //
  // Not merely a reload: this tab has no memory of a run at all, which is the "another tab, another
  // machine" half of §1.3.1.
  await page.goto(`${BASE}${href}${FEASIBILITY}`, { waitUntil: "networkidle0" });

  const shown = await page.evaluate(() => {
    const region = document.querySelector('[data-region="run"]');
    return {
      present: Boolean(region),
      rows: [...(region?.querySelectorAll("[data-field]") ?? [])].map((li) => li.dataset.field),
      text: region?.textContent ?? "",
    };
  });

  check("the run is on the page without being re-run", shown.present);
  check(
    "every field it read is there",
    shown.rows.length === SPECS.length,
    `${shown.rows.length}/${SPECS.length}`,
  );
  check("with the values it proposed", shown.text.includes("units value"));
  check("and what it spent", /5,090 tokens|5 090 tokens/.test(shown.text), shown.text.match(/[\d,\s]+tokens/)?.[0] ?? "no spend shown");
  check("the citation opens the document it read", shown.text.includes(document.filename));

  // ── A unit the document stated that is not the unit the field records ─────────────────
  const mismatch = await page
    .$eval(`[data-field="${UNIT_MISMATCH}"]`, (row) => (row.textContent ?? "").replace(/\s+/g, " "))
    .catch(() => "");

  check(
    "a value stating a unit the field does not record is flagged",
    /states this in years/i.test(mismatch),
    mismatch.slice(0, 150),
  );
  check(
    "naming the field's own unit, and doing the arithmetic",
    /records months/i.test(mismatch) && /that is 36/.test(mismatch),
    mismatch.slice(0, 180),
  );
  check(
    "while leaving the figure exactly as the document stated it",
    /3 years/.test(mismatch),
    "the platform rewrote a figure no document states",
  );

  // The other half: a value already carrying its unit does not get it appended a second time.
  check(
    "a value that already says its unit is not given it twice",
    !/3 years\s*months/.test(mismatch),
    mismatch.slice(0, 120),
  );

  // ── Unsigned is stated, because that is what stops the next step reading it ──────────────
  check(
    "an unsigned run says so",
    /next step cannot read these until it is/i.test(shown.text),
  );

  // ── The gate: a required field with no value refuses the signature ───────────────────────
  /*
    Both regions, because the refusal no longer lives beside the button.

    It used to sit under the disabled control, which is what made it easy to miss — a reader met a
    greyed button first and the reason afterwards. The blocker is now its own panel *above* the
    control, so the wording this suite guards is in `signoff-blocked` and the button is still in
    `signature`. Reading only the second one is how this check started failing on a change that
    improved the screen.
  */
  const gate = await page.evaluate(() => {
    const region = document.querySelector('[data-region="signature"]');
    const blocker = document.querySelector('[data-region="signoff-blocked"]');
    const button = [...(region?.querySelectorAll("button") ?? [])].find((b) =>
      /sign off/i.test(b.textContent ?? ""),
    );
    return {
      disabled: button?.disabled ?? null,
      label: button?.textContent ?? "",
      text: `${blocker?.textContent ?? ""} ${region?.textContent ?? ""}`,
      jumps: Boolean(blocker?.querySelector("[data-blocked]")),
    };
  });

  check("the sign-off button is there", gate.disabled !== null);
  check("and is refused while a required field has no value", gate.disabled === true);
  check("the refusal names the field", gate.text.includes(GAP.label), gate.text.slice(0, 120));
  // Naming what is missing beats a count; taking the reader to the box beats naming it.
  check("and offers a way to the field that is blocking", gate.jumps);
  check(
    "and says why a gap must not be frozen",
    /reads downstream as an approved figure/i.test(gate.text),
  );
  check("the button names who would be signing", gate.label.includes(env.DEV_USER_EMAIL), gate.label.trim());

  // ── Moving off a figure commits it, and Cancel still beats that ─────────────────────────
  //
  // A review pass is a column of ten boxes. Typing a figure and clicking the next row used to
  // discard it silently — the row looked corrected and the database held nothing — so leaving the
  // cell now writes. Three paths, and the two negative ones are the reason this is asserted rather
  // than assumed: focus moving *within* the correction must not commit early, and Cancel must not
  // lose a race with the commit it is meant to prevent.
  //
  // A different field from GAP, so nothing here disturbs the correction asserted below.
  const BLUR = SPECS.find((spec) => spec.id !== GAP.id && !spec.carriedFrom) ?? SPECS[0];

  // 1. Typed, then focus moved into the reason box — still inside the correction, nothing written.
  await page.click(`#v-${BLUR.id}`);
  await page.type(`#v-${BLUR.id}`, "1 200");
  await page.waitForSelector(`#r-${BLUR.id}`, { timeout: 5000 });
  await page.click(`#r-${BLUR.id}`);

  const [midEdit] = await sql`
    select override_value from run_fields where run_id = ${run.id} and field_id = ${BLUR.id}`;
  check(
    "tabbing to the reason box does not commit the figure yet",
    midEdit.override_value === null,
    `stored "${midEdit.override_value}" while the reader was still typing`,
  );

  // 2. Focus leaves the cell entirely — written, with the reason that was typed on the way out.
  await page.type(`#r-${BLUR.id}`, "corrected against the layout schedule");
  await page.click("h1");

  await page
    .waitForFunction(
      `document.querySelector('[data-field="${BLUR.id}"]')?.textContent.includes("1 200")`,
      { timeout: 8000 },
    )
    .catch(() => {});

  const [blurred] = await sql`
    select override_value, override_by, override_reason
      from run_fields where run_id = ${run.id} and field_id = ${BLUR.id}`;

  check("moving off the figure commits it, with no button pressed", blurred.override_value === "1 200", `${blurred.override_value}`);
  check("under the session's name", blurred.override_by === env.DEV_USER_EMAIL);
  check("carrying the reason typed before leaving", /layout schedule/.test(blurred.override_reason ?? ""), `${blurred.override_reason}`);

  // 3. Cancel discards, and is not overtaken by the commit on the way out of the box.
  await page.click(`#v-${BLUR.id}`);
  await page.evaluate((id) => {
    const box = document.querySelector(`#v-${id}`);
    box.focus();
  }, BLUR.id);
  await page.type(`#v-${BLUR.id}`, " REVISED");
  await page.evaluate((fieldId) => {
    const row = document.querySelector(`[data-field="${fieldId}"]`);
    [...row.querySelectorAll("button")].find((b) => /^cancel$/i.test((b.textContent ?? "").trim()))?.click();
  }, BLUR.id);

  const [cancelled] = await sql`
    select override_value from run_fields where run_id = ${run.id} and field_id = ${BLUR.id}`;
  check(
    "Cancel discards the edit rather than losing a race with the auto-commit",
    cancelled.override_value === "1 200",
    `stored "${cancelled.override_value}"`,
  );

  // 4. Put the field back, through the product's own Revert rather than an UPDATE behind it.
  //
  // Everything below this point asserts that GAP is the *only* field a human touched — output
  // takes the agent's proposal everywhere else, and the cited field still carries `<id> value`.
  // A suite that left this correction standing would fail those two on its own leftovers, which
  // is a test reporting its own housekeeping as a defect in the application.
  await page.evaluate((fieldId) => {
    const row = document.querySelector(`[data-field="${fieldId}"]`);
    [...row.querySelectorAll("button")].find((b) => /revert/i.test(b.textContent ?? ""))?.click();
  }, BLUR.id);

  await page
    .waitForFunction(
      `!document.querySelector('[data-field="${BLUR.id}"]')?.textContent.includes("1 200")`,
      { timeout: 8000 },
    )
    .catch(() => {});

  const [reverted] = await sql`
    select override_value from run_fields where run_id = ${run.id} and field_id = ${BLUR.id}`;
  check("Revert drops the correction entirely", reverted.override_value === null, `${reverted.override_value}`);

  // ── A correction: overrides written, proposed untouched ──────────────────────────────────
  //
  // The override box is on the row, always. Correcting used to mean clicking Correct, waiting for a
  // form and clicking Save; a review pass is ten figures at a time, so the box is simply there and
  // Enter commits it.
  await page.click(`#v-${GAP.id}`);
  await page.type(`#v-${GAP.id}`, "96 units per annum");
  await page.waitForSelector(`#r-${GAP.id}`, { timeout: 5000 });
  await page.click(`#r-${GAP.id}`);
  await page.type(`#r-${GAP.id}`, "Taken from the absorption study the agent could not read");

  // Committed by leaving the cell, which is the only way now — the Save button is gone, because
  // saving is what moving on does. `h1` is outside the correction, so focus genuinely leaves it.
  await page.click("h1");

  await page.waitForFunction(
    `document.querySelector('[data-field="${GAP.id}"]')?.textContent.includes("96 units per annum")`,
    { timeout: 8000 },
  );

  const correctedRow = await page.$eval(
    `[data-field="${GAP.id}"]`,
    (li) => li.textContent ?? "",
  );

  check("the corrected figure is what the row shows", correctedRow.includes("96 units per annum"));
  check("with the name of whoever corrected it", correctedRow.includes(env.DEV_USER_EMAIL));
  check("and their reason", correctedRow.includes("absorption study"));
  check(
    "the agent's answer is still visible underneath",
    /agent said/i.test(correctedRow),
    correctedRow.replace(/\s+/g, " ").slice(0, 160),
  );

  const [afterCorrection] = await sql`
    select proposed_value, proposed_state, override_value, override_by, override_reason, output_value
      from run_fields where run_id = ${run.id} and field_id = ${GAP.id}`;

  check("the override is stored", afterCorrection.override_value === "96 units per annum");
  check("under the session's name, not the form's", afterCorrection.override_by === env.DEV_USER_EMAIL);
  check("the agent's proposal is untouched", afterCorrection.proposed_value === null, `${afterCorrection.proposed_value}`);
  check("and nothing is output yet", afterCorrection.output_value === null);

  // ── A figure of the wrong kind is refused, and nothing is stored (audit C4) ───────────────
  //
  // "421000" was signed as the list of tenderers because every field was free text. A selling price
  // is money, and "per unit" makes it a rate – the reader the cash flow uses downstream would refuse
  // it there, so it is refused here, where the person who typed it can fix it.
  const [priceBefore] = await sql`select override_value from run_fields where run_id = ${run.id} and field_id = 'selling-price'`;
  await page.click("#v-selling-price");
  await page.type("#v-selling-price", "R620 000 per unit");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    `(document.querySelector('[data-field="selling-price"] [role="alert"]')?.textContent ?? "").length > 0`,
    { timeout: 8000 },
  );
  const wrongKind = await page.$eval('[data-field="selling-price"] [role="alert"]', (e) => e.textContent ?? "");
  const [priceAfter] = await sql`select override_value from run_fields where run_id = ${run.id} and field_id = 'selling-price'`;
  check("a rate typed as the selling price is refused in words", wrongKind.length > 0, wrongKind.slice(0, 100));
  check("and nothing is stored", priceAfter.override_value === priceBefore.override_value, `${priceAfter.override_value}`);
  check("the box says what form it wants before anything is typed", (await page.$eval("#v-units", (i) => i.placeholder)) === "e.g. 1 046");
  // The refused draft is the browser's alone; a reload puts the row back as the server has it.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(`[data-field="${GAP.id}"]`, { timeout: 30000 });

  // ── The database refuses to edit a proposal, whatever the application does ───────────────
  const editProposed = await sql`
    update run_fields set proposed_value = 'rewritten' where run_id = ${run.id} and field_id = ${GAP.id}`
    .then(() => null)
    .catch((e) => e.message);

  check(
    "the database refuses to rewrite what the agent said",
    Boolean(editProposed),
    editProposed?.slice(0, 90) ?? "the update was allowed",
  );

  // ── The signature ───────────────────────────────────────────────────────────────────────
  const nowSignable = await page.$eval('[data-region="signature"]', (region) => {
    const button = [...region.querySelectorAll("button")].find((b) => /sign off/i.test(b.textContent ?? ""));
    return button?.disabled ?? null;
  });
  check("with every required field answered the signature is offered", nowSignable === false);

  await page.evaluate(() => {
    const region = document.querySelector('[data-region="signature"]');
    [...region.querySelectorAll("button")].find((b) => /sign off/i.test(b.textContent))?.click();
  });

  await page.waitForFunction(
    `document.querySelector('[data-region="signature"]')?.textContent.includes("Signed off")`,
    { timeout: 10000 },
  );

  const signature = await page.$eval('[data-region="signature"]', (r) => r.textContent ?? "");
  check("the run says it is signed", /signed off/i.test(signature));
  check("by a named person", signature.includes(env.DEV_USER_EMAIL));
  check("and that the next step can now read it", /next step can read them/i.test(signature));

  // ── And a way to walk the chain ─────────────────────────────────────────────────────────
  //
  // v3's flow, kept: signing is the moment the next step becomes possible, and saying so in a
  // sentence while leaving the reader to find that step in a folded nav is where it used to stop.
  // The link is derived from `feedsInto`, the same answer the project overview renders as "Feeds
  // Cost Plan", so a check that the two agree is a check that the chain has one source.
  check(
    "the signature names what it released",
    /released to/i.test(signature) && /Cost Plan/.test(signature),
    signature.replace(/\s+/g, " ").slice(-140),
  );

  const onward = await page.$$eval('[data-region="next"] [data-next]', (links) =>
    links.map((a) => ({ href: a.getAttribute("href"), module: a.dataset.next, text: (a.textContent ?? "").trim() })),
  );

  check("with a link to the step it released", onward.length > 0, `${onward.length} links`);
  check(
    "pointing at that step on this project",
    onward[0]?.href === `/projects/${projectId}/cost-plan`,
    `${onward[0]?.href}`,
  );
  check(
    "labelled with the step's name, not only its process code",
    /Cost Plan/.test(onward[0]?.text ?? ""),
    onward[0]?.text ?? "none",
  );

  // §7.7: `12 Aug 2026` in the UI, and never the numeric form that reads two ways.
  check(
    "the signature's date is written the way §7.7 asks",
    /\d{1,2} [A-Z][a-z]{2} \d{4}/.test(signature) && !/\d{2,4}\/\d{2}\/\d{2,4}/.test(signature),
    signature.replace(/\s+/g, " ").slice(0, 90),
  );

  // ── The document the signature makes possible ─────────────────────────────────────────
  //
  // v3's flow, kept: a signed feasibility estimate offers its report. Only once signed — a
  // viability report drawn from unapproved figures is the document somebody is shown in a
  // dispute.
  const reportOffer = await page.$$eval('[data-action="report"]', (links) =>
    links.map((a) => a.getAttribute("href")),
  );

  check(
    "a signed feasibility estimate offers its report",
    reportOffer.length === 1,
    `${reportOffer.length} offers`,
  );
  check(
    "pointing at this project's report",
    reportOffer[0] === `/projects/${projectId}/report`,
    `${reportOffer[0]}`,
  );

  await page.goto(`${BASE}/projects/${projectId}/report`, { waitUntil: "networkidle0" });

  const sheet = await page
    .$eval('[data-region="report-sheet"]', (el) => el.innerText.replace(/\s+/g, " "))
    .catch(() => "");

  const sections = await page.$$eval("[data-section]", (els) =>
    els.map((e) => ({ no: e.dataset.section, state: e.dataset.state })),
  );

  check("the report renders v3's twelve sections", sections.length === 12, `${sections.length}`);
  check(
    "the site and statutory section is established from the signed run",
    sections.find((x) => x.no === "3")?.state === "established",
    sections.find((x) => x.no === "3")?.state ?? "missing",
  );
  check(
    "carrying the document each figure was read from",
    sheet.includes(document.filename),
    document.filename,
  );
  check(
    "the sections the engine has not reached say so rather than being dropped",
    // Two: financial viability and sensitivity, which this project has not signed the four
    // cash-flow inputs for. The approval programme and the risk register both left this list
    // when they started deriving themselves — one from a dated reference table, the other from
    // the gates and the assumptions — rather than waiting on an engine.
    sections.filter((x) => x.state === "awaiting").length === 2,
    sections.filter((x) => x.state === "awaiting").map((x) => x.no).join(", "),
  );
  check(
    "naming what each is waiting for",
    /*
      What a waiting section names has moved, and the move is the point.

      It read "needs the scenario model" — true about this platform while the model was unported.
      The model runs now, so what sections 8 and 9 are actually missing on this project is signed
      data, and they name the four fields. Naming an engine a reader cannot see tells them to wait;
      naming the fields tells them what to go and do.
    */
    /*
      Only the first half now. "Not modelled yet" belonged to the approval programme and the risk
      register, and both derive themselves as of this change — so what remains waiting on this
      project is signed data, and the sections name the four fields that would supply it.
    */
    /selling price, absorption rate, programme and unit count/.test(sheet),
    sheet.slice(0, 200),
  );
  check(
    "and the sheet states that every figure on it was signed",
    /a named person has signed off/i.test(sheet),
  );

  // ── The same report, as the document a QS issues ──────────────────────────────────────
  //
  // v3 returns application/pdf with a filename naming the project, and that filename matters
  // more than it looks: the file lands in a job folder beside twenty others, where report.pdf is
  // indistinguishable from every one of them.
  const pdf = await page.evaluate(async (id) => {
    const response = await fetch(`/projects/${id}/report/pdf`);
    const bytes = new Uint8Array(await response.arrayBuffer());

    return {
      status: response.status,
      type: response.headers.get("content-type"),
      disposition: response.headers.get("content-disposition"),
      cache: response.headers.get("cache-control"),
      length: bytes.length,
      head: String.fromCharCode(...bytes.slice(0, 5)),
    };
  }, projectId);

  check("the report downloads as a PDF", pdf.status === 200 && pdf.type === "application/pdf", `${pdf.status} ${pdf.type}`);
  check("that is actually a PDF", pdf.head === "%PDF-", pdf.head);
  check(
    "named after the project, not report.pdf",
    /filename="[^"]*QS_Viability_Report\.pdf"/.test(pdf.disposition ?? ""),
    `${pdf.disposition}`,
  );
  check(
    "and is never cached, because what is signed changes",
    /no-store/.test(pdf.cache ?? ""),
    `${pdf.cache}`,
  );
  check("with a document behind it, not an empty file", pdf.length > 2000, `${pdf.length} bytes`);

  const download = await page.$$eval('[data-action="download-pdf"]', (links) =>
    links.map((a) => a.getAttribute("href")),
  );

  check(
    "the report page offers the download",
    download.length === 1 && download[0] === `/projects/${projectId}/report/pdf`,
    `${download.join(", ")}`,
  );

  // Back to the step, where the assertions below expect to be.
  await page.goto(`${BASE}${href}${FEASIBILITY}`, { waitUntil: "networkidle0" });

  const stillCorrectable = await page.$$eval("[data-field] button", (buttons) =>
    buttons.some((b) => /correct|revert/i.test(b.textContent ?? "")),
  );
  check("and nothing on it can still be corrected", stillCorrectable === false);

  // ── output is frozen from working, human wins ────────────────────────────────────────────
  const [signed] = await sql`select signed_by, signed_at, status from runs where id = ${run.id}`;
  check("the signature is stored with a name", signed.signed_by === env.DEV_USER_EMAIL);
  check("and a time", Boolean(signed.signed_at));
  check("and the status is untouched — a signature is not a status", signed.status === "review");

  const outputs = await sql`
    select field_id, proposed_value, override_value, output_value
      from run_fields where run_id = ${run.id} order by seq`;

  const frozenFromHuman = outputs.find((o) => o.field_id === GAP.id);
  check(
    "output takes the human's figure where there is one",
    frozenFromHuman.output_value === "96 units per annum",
    `${frozenFromHuman.output_value}`,
  );
  check(
    "and the agent's everywhere else",
    outputs
      .filter((o) => o.field_id !== GAP.id)
      .every((o) => o.output_value === o.proposed_value),
  );

  // ── Frozen means frozen, in the database ────────────────────────────────────────────────
  const editSigned = await sql`
    update run_fields set override_value = 'after the fact' where run_id = ${run.id} and field_id = ${GAP.id}`
    .then(() => null)
    .catch((e) => e.message);
  check(
    "a signed run's fields cannot be changed",
    Boolean(editSigned),
    editSigned?.slice(0, 90) ?? "the update was allowed",
  );

  const resign = await sql`update runs set signed_by = 'somebody else' where id = ${run.id}`
    .then(() => null)
    .catch((e) => e.message);
  check(
    "and the signature cannot be reassigned",
    Boolean(resign),
    resign?.slice(0, 90) ?? "the update was allowed",
  );

  // ── Another tab sees the same run ───────────────────────────────────────────────────────
  const second = await browser.newPage();
  await second.goto(`${BASE}${href}${FEASIBILITY}`, { waitUntil: "networkidle0" });
  const elsewhere = await second.$eval('[data-region="run"]', (r) => r.textContent ?? "");
  check("a second tab sees the signed run", /signed off/i.test(elsewhere));
  check("with the frozen figures on it", elsewhere.includes("96 units per annum"));
  await second.close();

  // ── And the corpus can no longer be deleted out from under it ───────────────────────────
  //
  // §1.3.2's promise is that a citation can be checked by opening the document. A signed figure
  // whose document has been deleted is the untraceable number §1.3.1 calls worse than a gap.
  await page.goto(`${BASE}${href}/corpus`, { waitUntil: "networkidle0" });
  await page.type("#clear-corpus", "remove all");
  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((b) => /delete all/i.test(b.textContent))?.click();
  });

  await page.waitForFunction(`document.body.innerText.includes("signed-off run")`, { timeout: 8000 })
    .catch(() => {});

  const corpus = await page.evaluate(() => document.body.innerText);
  check("clearing the corpus is refused once a run is signed", /signed-off run/i.test(corpus));
  check("and says to withdraw one at a time instead", /one at a time/i.test(corpus));

  const [remaining] = await sql`
    select count(*)::int as n from documents where project_id = ${projectId}`;
  check("nothing was deleted", remaining.n === 1, `${remaining.n} documents`);

  // ── The chain, on the page that answers "where is this project up to" ───────────────────
  //
  // §1.3.1: step state is derived once — `signed_off · draft · ready · waiting · not_built` — so a
  // tile and the row it opens cannot disagree about what a word means. And a signature is only
  // meaningful if the screen says what it unlocks, so every step names what it feeds.
  await page.goto(`${BASE}${href}`, { waitUntil: "networkidle0" });

  const chain = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-region="chain"] li[data-step]')];
    return {
      steps: rows.map((li) => ({ step: li.dataset.step, state: li.dataset.state, text: li.textContent ?? "" })),
      page: document.body.innerText,
    };
  });

  const feasibility = chain.steps.find((s) => s.step === "/feasibility");
  check("the overview lists the steps", chain.steps.length >= 3, `${chain.steps.length} steps`);
  check("and reads the signed step as signed off", feasibility?.state === "signed_off", `${feasibility?.state}`);
  check("naming the signer, not just the state", feasibility?.text.includes(env.DEV_USER_EMAIL));
  check(
    "and saying what the signature unlocks",
    /the next step can read these figures/i.test(feasibility?.text ?? ""),
  );
  check(
    "each step says what it feeds",
    /Feeds .*Cost Plan/i.test(feasibility?.text ?? ""),
    (feasibility?.text.match(/Feeds [^\n]{0,60}/) ?? ["not stated"])[0],
  );

  // What the cost plan feeds. D1.2 has a page now — the bill — so the link names it rather than the
  // process area; the area beyond that still does not, and is named and marked rather than dropped,
  // because hiding it would say the platform's model of the work stops at what has been built.
  const costPlan = chain.steps.find((s) => s.step === "/cost-plan");
  check(
    "and the last built step names what it feeds",
    /Feeds .*Bill of Quantities/i.test(costPlan?.text ?? ""),
    (costPlan?.text.match(/Feeds [^\n]{0,80}/) ?? ["not stated"])[0],
  );
  check(
    "with the area beyond it named and marked as having no page yet",
    /Funder Reporting[^\n]*not built/i.test(costPlan?.text ?? ""),
    (costPlan?.text.match(/Feeds [^\n]{0,80}/) ?? ["not stated"])[0],
  );

  // Project Inputs feeds the feasibility estimate and produces no run of its own, so it is never a
  // gate — the decision recorded in `chain.ts`. It reads as ready or waiting on its own documents.
  const inputs = chain.steps.find((s) => s.step === "/inputs");
  check("a step with no run of its own is never 'signed off'", inputs?.state !== "signed_off", `${inputs?.state}`);

  // ── Running the step again does not lose sight of the signature ─────────────────────────
  //
  // The panel shows the latest run, so a second run puts a draft where the signed one was. What the
  // next step reads is still the signed one, and a screen that answered "nothing is signed off yet"
  // there would be quietly wrong about the only thing this feature exists to say.
  const [redo] = await sql`
    insert into runs (project_id, module, status, created_by)
    values (${projectId}, '/feasibility', 'review', ${env.DEV_USER_EMAIL})
    returning id`;

  await sql`
    insert into run_fields (run_id, field_id, seq, label, proposed_state, proposed_value, proposed_confidence)
    values (${redo.id}, ${SPECS[0].id}, 0, ${SPECS[0].label}, 'found', 'a second reading', 0.8)`;

  await page.goto(`${BASE}${href}${FEASIBILITY}`, { waitUntil: "networkidle0" });
  const afterRerun = await page.$eval('[data-region="run"]', (r) => r.textContent ?? "");

  check("a newer run is what the panel shows", afterRerun.includes("a second reading"));
  check(
    "and the earlier signature is still stated",
    /earlier run of this step is signed off/i.test(afterRerun),
    afterRerun.replace(/\s+/g, " ").slice(0, 140),
  );
  check("naming who signed it", afterRerun.includes(env.DEV_USER_EMAIL));
  check(
    "and it does not claim nothing is signed",
    !/nothing is signed off yet/i.test(afterRerun),
  );

  // ── And when a cited document goes anyway ───────────────────────────────────────────────
  //
  // The application refuses above, but the database still has to cope: deleting a project cascades
  // through its documents, and `on delete set null` reaches these rows looking exactly like
  // somebody rewriting a citation. Refusing it would make a project undeletable. What has to
  // survive is the part that makes a citation readable — the document's name and the passage it was
  // read from — and the signed figure itself.
  const cited = SPECS.find((s) => s.id !== GAP.id).id;
  await sql`delete from documents where id = ${document.id}`;

  const [orphaned] = await sql`
    select source_document_id, source_document, source_excerpt, output_value
      from run_fields where run_id = ${run.id} and field_id = ${cited}`;

  check("a deleted document does not take the citation with it", orphaned.source_document === document.filename);
  check("the passage it was read from survives", orphaned.source_excerpt === quote);
  check("only the link to the original is dropped", orphaned.source_document_id === null);
  check("and the signed figure is untouched", orphaned.output_value === `${cited} value`, `${orphaned.output_value}`);

  /*
    ── A cost plan that does not add up is signed only with a reason (audit C3) ─────────────────

    Cost plans were signed with their elements R392 800 short of the stated total. The elements
    below sum to R95 000 000,00 against a stated R95 392 800,00: the panel says so before the click,
    the button waits for a reason, and the reason is stored with the signature.
  */
  const [plan] = await sql`
    insert into runs (project_id, module, status, input_tokens, output_tokens, created_by)
    values (${projectId}, '/cost-plan', 'review', 0, 0, ${env.DEV_USER_EMAIL}) returning id`;
  const planFields = [
    ["cp-units", "Total unit count", "1 046"],
    ["cp-unit-area", "Average unit area", "48 m2"],
    ["cp-erf", "Erf number and extent", "Erf 180"],
    ["cp-basis", "Estimate class and basis", "Elemental"],
    ["cp-total", "Total construction cost", "R95 392 800,00"],
    ["cp-substructure", "Substructure", "R10 000 000,00"],
    ["cp-superstructure", "Superstructure", "R30 000 000,00"],
    ["cp-finishes", "Finishes and fittings", "R20 000 000,00"],
    ["cp-services", "Engineering services", "R15 000 000,00"],
    ["cp-external-works", "External works", "R5 000 000,00"],
    ["cp-preliminaries", "Preliminaries and general", "R8 000 000,00"],
    ["cp-contingency", "Contingency", "R4 000 000,00"],
    ["cp-escalation", "Escalation", "R3 000 000,00"],
  ];
  for (const [seq, [fieldId, label, value]] of planFields.entries()) {
    await sql`
      insert into run_fields (run_id, field_id, seq, label, proposed_state, proposed_value, proposed_confidence)
      values (${plan.id}, ${fieldId}, ${seq}, ${label}, 'found', ${value}, 0.9)`;
  }
  await page.goto(`${BASE}${href}/cost-plan`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-region="reconcile-gap"]', { timeout: 30000 });
  const gapText = await page.$eval('[data-region="reconcile-gap"]', (e) => (e.textContent ?? "").replace(/ /g, " "));
  const signButton = () =>
    page.$eval('[data-region="signature"]', (r) => [...r.querySelectorAll("button")].find((b) => /sign off/i.test(b.textContent ?? ""))?.disabled ?? null);
  check("a cost plan that does not add up says so before signing", /392 800,00/.test(gapText), gapText.slice(0, 140));
  check("and the signature waits for a reason", (await signButton()) === true);

  // The warning is in the server's HTML, so it can appear before React has attached. Typing then
  // changes the box but not React's state, and the button never enables – wait for the attach.
  await page.waitForFunction(
    () => Object.keys(document.querySelector('[data-input="signoff-note"]') ?? {}).some((k) => k.startsWith("__reactProps")),
    { timeout: 15000 },
  );
  await page.type('[data-input="signoff-note"]', "Total includes the client's direct contracts; elements exclude them.");
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('[data-region="signature"] button')].find((b) => /sign off/i.test(b.textContent ?? ""));
    return button && !button.disabled;
  }, { timeout: 5000 });
  await page.$eval('[data-region="signature"]', (r) => [...r.querySelectorAll("button")].find((b) => /sign off/i.test(b.textContent ?? ""))?.click());

  let signedPlan = null;
  for (let i = 0; i < 60 && !signedPlan?.signed_at; i++) {
    [signedPlan] = await sql`select signed_at, signoff_note from runs where id = ${plan.id}`;
    if (!signedPlan?.signed_at) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  check("with a reason it signs", Boolean(signedPlan?.signed_at));
  check("and the reason is kept with the signature", /direct contracts/.test(signedPlan?.signoff_note ?? ""), `${signedPlan?.signoff_note}`);
  const noteEdit = await sql`update runs set signoff_note = 'rewritten' where id = ${plan.id}`.then(() => null).catch((e) => e.message);
  check("and is frozen with it", noteEdit !== null, noteEdit ?? "the update went through");

  // Every screen this suite visited, checked for the warnings that are always a defect.
  check(
    "no React warnings on any screen this visited",
    consoleErrors.length === 0,
    consoleErrors.join(" | ").slice(0, 220),
  );
} finally {
  await browser.close();
  await sql.end();
}

console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} failed.`);
process.exit(fails ? 1 : 0);
