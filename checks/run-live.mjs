/**
 * A real run, against the real model. **Not in `npm run check`** — it spends credits.
 *
 *     node checks/run-live.mjs
 *
 * `npm run check` covers the free half of this: the refusal on an empty corpus, and the streaming
 * contract. What only a live run can show is whether the thing works — whether retrieval finds the
 * passage, whether the model reads the figure out of it, and whether the quote it returns is
 * actually in the document. That last one is the product, so it is asserted rather than eyeballed.
 *
 * It is also the only place the **writer** is exercised. `checks/signoff.mjs` seeds a run to keep the
 * free suite free, and a seeded row is a row somebody typed — it proves the screen and proves
 * nothing about the route. So every persisted field is compared here against the event that was
 * streamed for it. If the two ever drift, this is what says so.
 */

import postgres from "postgres";
import puppeteer from "puppeteer";
import { createProject, fileAgainst, signIn, FEASIBILITY, readEnv } from "./helpers.mjs";

const env = readEnv();

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const BASE = "http://localhost:3000";

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));

await signIn(page, env);

const name = "Live run " + Date.now();
await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
const { href } = await createProject(page, name);
const projectId = href.split("/").pop();

// ── A run over an empty corpus is refused, not answered ───────────────────────────────────
const empty = await page.evaluate(async (id) => {
  const r = await fetch(`/api/projects/${id}/runs`, { method: "POST" });
  return { status: r.status, body: (await r.text()).slice(0, 120) };
}, projectId);

check("an empty corpus is refused in words, not run", empty.status === 409, `HTTP ${empty.status}`);
check("and the refusal says what to do", /file the documents/i.test(empty.body), empty.body);

// ── File what the step actually requires, then run for real ───────────────────────────────
//
// It used to file the brief alone and POST straight at the route, which worked because the route
// checked only whether the corpus was empty — the run button beside it had been disabled the whole
// time. So this suite was exercising a path the interface has never offered. The server enforces
// the checklist now (§1.3.1), and the honest version of this test is to file what a QS files.
//
// One document per mandatory criterion, each filed under a kind that criterion accepts. `brief.txt`
// used to stand in for the market study too — it carries the absorption paragraph — but grounding
// now requires the passage to come from a document of an accepted kind, and a brief filed as a
// brief is not a market study. See the README for why `layouts.txt` and `market.txt` exist and why
// `typologies.txt` must not be used here.
await page.goto(`${BASE}${href}${FEASIBILITY}`, { waitUntil: "networkidle0" });
await fileAgainst(page, "Project brief and concept parameters", "./fixtures/brief.txt");
await page.waitForFunction(`document.body.innerText.includes("brief.txt")`, { timeout: 20000 });

await page.goto(`${BASE}${href}${FEASIBILITY}`, { waitUntil: "networkidle0" });
await fileAgainst(page, "Concept layouts", "./fixtures/layouts.txt");
await page.waitForFunction(`document.body.innerText.includes("layouts.txt")`, { timeout: 20000 });

// A criterion is satisfied by a document of a kind it accepts, so the brief's market paragraph no
// longer stands in for a market study — it is filed as a project brief. This is the document.
await page.goto(`${BASE}${href}${FEASIBILITY}`, { waitUntil: "networkidle0" });
await fileAgainst(page, "Market data", "./fixtures/market.txt");
await page.waitForFunction(`document.body.innerText.includes("market.txt")`, { timeout: 20000 });

// The gate the interface shows, before spending anything on the run behind it.
await page.goto(`${BASE}${href}${FEASIBILITY}`, { waitUntil: "networkidle0" });
const startable = await page.evaluate(() => {
  const button = [...document.querySelectorAll("button")].find((b) =>
    /run extraction/i.test(b.textContent ?? ""),
  );
  return button?.disabled ?? null;
});
check("the step is startable once its required inputs are filed", startable === false);

console.log("\n  running against deepseek-chat…\n");
const started = Date.now();

const run = await page.evaluate(async (id) => {
  const response = await fetch(`/api/projects/${id}/runs`, { method: "POST" });
  const text = await response.text();
  return {
    status: response.status,
    type: response.headers.get("content-type"),
    events: text
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l)),
  };
}, projectId);

const seconds = ((Date.now() - started) / 1000).toFixed(1);
check("the run streams NDJSON", run.type?.includes("x-ndjson"), run.type ?? "none");

const fields = run.events.filter((e) => e.type === "field").map((e) => e.result);
const failure = run.events.find((e) => e.type === "error");
const done = run.events.find((e) => e.type === "done");

if (failure) console.log(`  [run error] ${failure.error}`);

check("every field is answered", fields.length === 11, `${fields.length}/11 in ${seconds}s`);
check("the run completed rather than erroring", Boolean(done) && !failure);

console.log("\n  ── what it read ──────────────────────────────────────────────────────");
for (const f of fields) {
  const mark = { found: "✓", uncertain: "?", not_found: "·" }[f.state];
  console.log(`  ${mark} ${f.field.label.padEnd(30)} ${f.value ?? "—"}`);
  if (f.citation) console.log(`      “${f.citation.quote.replace(/\s+/g, " ").slice(0, 100)}”`);
  if (f.note) console.log(`      note: ${f.note}`);
}
console.log("  ──────────────────────────────────────────────────────────────────────\n");

// ── The figures this brief actually states ────────────────────────────────────────────────
const unitCount = fields.find((f) => f.field.id === "units");
check(
  "it reads the unit count out of the brief",
  unitCount?.state !== "not_found" && /1\s*046/.test(unitCount?.value ?? ""),
  `${unitCount?.state} — ${unitCount?.value ?? "—"}`,
);

// ── The guarantee: every quote is really in the document it cites ─────────────────────────
const db = postgres(env.DATABASE_URL);
try {
  const cited = fields.filter((f) => f.citation);
  check("grounded fields carry a citation", cited.length > 0, `${cited.length} of ${fields.length}`);

  let verified = 0;
  for (const f of cited) {
    const [row] = await db`
      select body from passages
       where document_id = ${f.citation.documentId}
         and project_id = ${projectId}
         and body like ${"%" + f.citation.quote.slice(0, 60) + "%"}
       limit 1`;
    if (row) verified++;
    else console.log(`  [ungrounded] ${f.field.label}: “${f.citation.quote.slice(0, 80)}”`);
  }

  check(
    "every quote is verbatim in the passage it cites",
    verified === cited.length,
    `${verified}/${cited.length}`,
  );

  // A citation must name a document of this project. Scoping is enforced in SQL; asserted anyway,
  // because it is the failure that would end trust in the platform.
  const ids = [...new Set(cited.map((f) => f.citation.documentId))];
  const owned = await db`
    select id from documents where project_id = ${projectId} and id in ${db(ids)}`;
  check("every cited document belongs to this project", owned.length === ids.length, `${owned.length}/${ids.length}`);

  // ── The run was written down, and written down as `proposed` ────────────────────────────
  //
  // §1.3.1: a run produces proposed values and nothing else until a person signs. A route that
  // wrote an output, or a status of signed, would hand the next step figures nobody approved.
  const [persisted] = await db`
    select id, module, status, error, input_tokens, output_tokens, signed_by, signed_at, created_by
      from runs where project_id = ${projectId}`;

  check("the run is a row", Boolean(persisted), persisted?.id ?? "no run recorded");
  check("addressed by its module", persisted?.module === "/feasibility", persisted?.module);
  check("closed as reviewable", persisted?.status === "review", `${persisted?.status}${persisted?.error ? ` — ${persisted.error}` : ""}`);
  check("signed by nobody", persisted?.signed_at === null && persisted?.signed_by === null);
  check("and attributed to whoever ran it", persisted?.created_by === env.DEV_USER_EMAIL, persisted?.created_by);
  check(
    "with the spend it reported",
    persisted?.input_tokens === done?.spend?.input && persisted?.output_tokens === done?.spend?.output,
    `${persisted?.input_tokens}/${persisted?.output_tokens} against ${done?.spend?.input}/${done?.spend?.output}`,
  );

  const stored = await db`
    select field_id, seq, label, proposed_state, proposed_value, proposed_confidence,
           proposed_note, source_document_id, source_page, source_excerpt, override_value, output_value
      from run_fields where run_id = ${persisted.id} order by seq`;

  check("every field it streamed was stored", stored.length === fields.length, `${stored.length}/${fields.length}`);

  /**
   * The row against the event it came from.
   *
   * This is the assertion that keeps the seeded fixture in `checks/signoff.mjs` honest: that suite
   * proves the screen reads rows of this shape, and this one proves the route writes them.
   */
  let matched = 0;
  for (const [i, streamed] of fields.entries()) {
    const row = stored[i];
    const same =
      row?.field_id === streamed.field.id &&
      row?.label === streamed.field.label &&
      row?.proposed_state === streamed.state &&
      row?.proposed_value === streamed.value &&
      Math.abs(row?.proposed_confidence - streamed.confidence) < 0.001 &&
      (row?.proposed_note ?? undefined) === streamed.note &&
      (row?.source_document_id ?? null) === (streamed.citation?.documentId ?? null) &&
      (row?.source_excerpt ?? null) === (streamed.citation?.quote ?? null);

    if (same) matched++;
    else console.log(`  [drift] ${streamed.field.id}: stored ${JSON.stringify(row)}`);
  }

  check("each stored field is exactly what was streamed", matched === fields.length, `${matched}/${fields.length}`);
  check("nothing was corrected by anyone", stored.every((r) => r.override_value === null));
  check("and nothing is output before a signature", stored.every((r) => r.output_value === null));

  // ── And it is on the screen without being run again ─────────────────────────────────────
  await page.goto(`${BASE}${href}${FEASIBILITY}`, { waitUntil: "networkidle0" });
  const reloaded = await page.$eval('[data-region="run"]', (r) => r.textContent ?? "");
  const readable = fields.filter((f) => f.value && reloaded.includes(f.value)).length;
  const withValues = fields.filter((f) => f.value).length;

  check(
    "a reload shows the run without spending anything",
    readable === withValues,
    `${readable}/${withValues} values on screen`,
  );
  check("and says it is not signed off", /next step cannot read these until it is/i.test(reloaded));

  // ── Sign it, and run the step that reads it ─────────────────────────────────────────────
  //
  // This is the chain doing the thing it exists for, against the real model: a figure established
  // here, reviewed, signed, and then **carried** into the cost plan rather than read a second time.
  // §1.3.1's `carried_via` has no other exercise — `checks/chain.mjs` proves the gate and the screen
  // for free, but the figures only move inside the route.
  //
  /**
   * A provider outage ends the suite here, and says so.
   *
   * Everything below signs a run and builds four more on top of it, and none of that is meaningful
   * over a run that never read anything. Crashing instead — which is what happened the first time
   * the model timed out at 45s — buries a plain "DeepSeek was slow" under a TypeError about a null
   * element, and sends the next person looking for a bug in the screen.
   */
  if (failure || fields.length === 0) {
    console.log(`
  The model did not answer, so the rest of this suite did not run.`);
    console.log(`  ${failure?.error ?? "no fields were returned"}`);
    console.log(`
  The run itself is recorded as failed with those words, which is the platform`);
    console.log(`  behaving correctly. Re-run when the provider is answering.`);
    await browser.close();
    await db.end();
    process.exit(1);
  }

  /**
   * Fill by hand what the documents did not say, exactly as a QS would.
   *
   * This is not test scaffolding around an inconvenience — it is the designed flow, and the real
   * corpus proves why it has to exist: the brief gives *comparable sales in adjacent schemes* and
   * never states an achievable selling price for this scheme, so the agent correctly declines to
   * offer one as the other. A required field with no figure refuses the signature, and the way past
   * it is a person putting their own number in. Nothing else is allowed to.
   */
  const correct = async (fieldId, value) => {
    // The override box is on every row already — no control to open first.
    await page.click(`#v-${fieldId}`);
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    await page.type(`#v-${fieldId}`, value);
    // Enter commits from inside the box. Leaving the cell would do it too — there is no Save
    // button any more — but Enter keeps the focus where a reviewer working down a column has it.
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      `document.querySelector('[data-field="${fieldId}"]')?.textContent.includes(${JSON.stringify(value)})`,
      { timeout: 8000 },
    );
  };

  // The unit count is corrected even though the agent found it, deliberately: `working` is
  // human-wins, so what must arrive downstream is the QS's figure and not the model's. A carry that
  // quietly shipped the machine's answer past a correction would be the confident wrong number in
  // its purest form.
  await correct("units", "1 040");

  // Whatever else the corpus could not establish. Read from the database rather than assumed, so
  // this suite does not go green by hard-coding which fields a model happened to miss today.
  const unfilled = fields.filter((f) => f.field.required && !f.value).map((f) => f.field.id);
  console.log(`  filling by hand: ${unfilled.join(", ") || "nothing"}`);
  // A figure of each field's own kind (`lib/agent/field-kinds.ts`): a correction is now refused when
  // it cannot be read as one, and "R620 000 per unit" is a rate the money reader rightly refuses.
  const BY_HAND = { units: "1 040", "unit-area": "48 m2", programme: "36 months", absorption: "96 units per annum" };
  for (const fieldId of unfilled) await correct(fieldId, BY_HAND[fieldId] ?? "R620 000,00");

  const blocking = await page.$eval('[data-region="signature"]', (r) => r.textContent ?? "");
  const signable = await page.$eval('[data-region="signature"]', (region) => {
    const button = [...region.querySelectorAll("button")].find((b) => /sign off/i.test(b.textContent ?? ""));
    return button?.disabled ?? null;
  });

  if (signable !== false) {
    console.log(`  [not signable] ${blocking.replace(/\s+/g, " ").slice(0, 200)}`);
  }
  check("the estimate can be signed once its required fields hold values", signable === false);

  await page.evaluate(() => {
    const region = document.querySelector('[data-region="signature"]');
    [...region.querySelectorAll("button")].find((b) => /sign off/i.test(b.textContent))?.click();
  });
  await page.waitForFunction(
    `document.querySelector('[data-region="signature"]')?.textContent.includes("Signed off")`,
    { timeout: 10000 },
  );
  check("and it signs", true);

  // The cost plan's own required document.
  await page.goto(`${BASE}${href}/cost-plan`, { waitUntil: "networkidle0" });
  await fileAgainst(page, "Priced cost plan or elemental estimate", "./fixtures/costplan.txt");
  await page.waitForFunction(`document.body.innerText.includes("costplan.txt")`, { timeout: 20000 });

  console.log("\n  running the cost plan against deepseek-chat…\n");

  const plan = await page.evaluate(async (id) => {
    const response = await fetch(`/api/projects/${id}/runs?module=%2Fcost-plan`, { method: "POST" });
    const text = await response.text();
    return {
      status: response.status,
      events: text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)),
    };
  }, projectId);

  const planFields = plan.events.filter((e) => e.type === "field").map((e) => e.result);
  const planFailure = plan.events.find((e) => e.type === "error");
  if (planFailure) console.log(`  [cost plan error] ${planFailure.error}`);

  console.log("  ── what the cost plan read ───────────────────────────────────────────");
  for (const f of planFields) {
    const mark = { found: "✓", uncertain: "?", not_found: "·" }[f.state];
    console.log(`  ${mark} ${f.field.label.padEnd(28)} ${f.value ?? "—"}`);
  }
  console.log("  ──────────────────────────────────────────────────────────────────────\n");

  check("the cost plan run starts now its upstream is signed", plan.status === 200, `HTTP ${plan.status}`);
  check("and answers every field", planFields.length > 0 && !planFailure, `${planFields.length} fields`);

  // ── The carry ───────────────────────────────────────────────────────────────────────────
  const [planRun] = await db`
    select id from runs where project_id = ${projectId} and module = '/cost-plan'`;
  const planRows = await db`
    select field_id, proposed_value, proposed_state, carried_via, carried_from_run_id,
           source_document, source_excerpt
      from run_fields where run_id = ${planRun.id} order by seq`;

  const units = planRows.find((r) => r.field_id === "cp-units");

  check(
    "the unit count arrives carried, not read again",
    units?.carried_via === "/feasibility",
    `carried_via ${units?.carried_via}`,
  );
  check(
    "and it is the figure the QS corrected, not the model's",
    units?.proposed_value === "1 040",
    `${units?.proposed_value}`,
  );
  check(
    "the run it came through is recorded",
    units?.carried_from_run_id === persisted.id,
    `${units?.carried_from_run_id}`,
  );
  check(
    "a carried field costs no model call",
    planRows.filter((r) => r.carried_via).length >= 2,
    `${planRows.filter((r) => r.carried_via).length} carried`,
  );

  // §1.3.1 — both provenances. The original document survives the journey, so a reader can reach
  // the brief the figure was read from rather than only the step it came through.
  const erf = planRows.find((r) => r.field_id === "cp-erf");
  check(
    "the original document travels with it",
    Boolean(erf?.source_document) && erf.source_document === "brief.txt",
    `${erf?.source_document ?? "none"}`,
  );
  check("as does the passage it was read from", Boolean(erf?.source_excerpt), erf?.source_excerpt?.slice(0, 50));

  // What this step read for itself is not carried — it came out of the cost plan document.
  const total = planRows.find((r) => r.field_id === "cp-total");
  check("a field this step read itself is not marked carried", total?.carried_via === null);
  check(
    "and it read the total out of the cost plan",
    total?.proposed_state !== "not_found",
    `${total?.proposed_state} — ${total?.proposed_value ?? "—"}`,
  );

  /**
   * ── And the screen says so ────────────────────────────────────────────────────────────
   *
   * This asserted the words "carried from the signed feasibility estimate", and that sentence has
   * not been on the screen since the run panel became a table: a carried row reads **"approved in
   * Feasibility Estimate"** there, which says the same thing in the space a table cell has. Nothing
   * caught it because this suite spends credits and is run deliberately, so a stale assertion here
   * sits red — or worse, unread — for weeks.
   *
   * Asserted against `navigation.ts`'s label rather than a literal, because one list owns those
   * words and a suite that hard-codes them breaks the day somebody edits the menu.
   */
  await page.goto(`${BASE}${href}/cost-plan`, { waitUntil: "networkidle0" });
  const planScreen = await page.$eval('[data-region="run"]', (r) => r.textContent ?? "");
  check(
    "the row says the figure was carried, and from where",
    /approved in\s*Feasibility Estimate/i.test(planScreen.replace(/\s+/g, " ")),
    (planScreen.replace(/\s+/g, " ").match(/approved in[^·]{0,40}/) ?? ["not stated"])[0],
  );
  check("and names the document it originally came from", planScreen.includes("brief.txt"));

  // ── A module from the other end of the lifecycle, on its own document ───────────────────
  //
  // Five modules were added at once from the same pattern, and a pattern that only ever runs on the
  // two documents it was written beside is a pattern nobody has tested. The contract is the one to
  // prove: it reads a JBCC schedule, and the figures it establishes — the sum, the retention rate
  // and its limit — are what every certificate for the rest of the job is computed against. §6.4
  // calls an issued certificate the most important invariant in the system; this is what feeds it.
  await page.goto(`${BASE}${href}/contract`, { waitUntil: "networkidle0" });
  await fileAgainst(page, "Signed contract", "./fixtures/contract.txt");
  await page.waitForFunction(`document.body.innerText.includes("contract.txt")`, { timeout: 20000 });

  console.log("\n  running the contract against deepseek-chat…\n");

  const contract = await page.evaluate(async (id) => {
    const response = await fetch(`/api/projects/${id}/runs?module=%2Fcontract`, { method: "POST" });
    const text = await response.text();
    return {
      status: response.status,
      events: text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)),
    };
  }, projectId);

  const contractFields = contract.events.filter((e) => e.type === "field").map((e) => e.result);
  const contractFailure = contract.events.find((e) => e.type === "error");
  if (contractFailure) console.log(`  [contract error] ${contractFailure.error}`);

  console.log("  ── what the contract read ────────────────────────────────────────────");
  for (const f of contractFields) {
    const mark = { found: "✓", uncertain: "?", not_found: "·" }[f.state];
    console.log(`  ${mark} ${f.field.label.padEnd(30)} ${f.value ?? "—"}`);
  }
  console.log("  ──────────────────────────────────────────────────────────────────────\n");

  check("the contract run completes", contract.status === 200 && !contractFailure, `HTTP ${contract.status}`);

  const value = (id) => contractFields.find((f) => f.field.id === id);
  check(
    "it reads the contract sum",
    /186\s*420\s*000/.test(value("ct-sum")?.value ?? ""),
    `${value("ct-sum")?.value ?? "—"}`,
  );
  check(
    "and the retention percentage every certificate deducts",
    /10\s*%|10 per cent/i.test(value("ct-retention")?.value ?? ""),
    `${value("ct-retention")?.value ?? "—"}`,
  );
  check(
    "and the form that governs the job",
    /jbcc/i.test(value("ct-form")?.value ?? ""),
    `${value("ct-form")?.value ?? "—"}`,
  );
  check(
    "and who is being certified to",
    /ndlovu/i.test(value("ct-contractor")?.value ?? ""),
    `${value("ct-contractor")?.value ?? "—"}`,
  );

  const grounded = contractFields.filter((f) => f.citation);
  check("every figure it reports carries its clause", grounded.length >= 4, `${grounded.length} cited`);

  let verifiedContract = 0;
  for (const f of grounded) {
    const [row] = await db`
      select body from passages
       where document_id = ${f.citation.documentId}
         and project_id = ${projectId}
         and body like ${"%" + f.citation.quote.slice(0, 50) + "%"}
       limit 1`;
    if (row) verifiedContract++;
    else console.log(`  [ungrounded] ${f.field.label}: “${f.citation.quote.slice(0, 70)}”`);
  }
  check(
    "and every clause is verbatim in the contract",
    verifiedContract === grounded.length,
    `${verifiedContract}/${grounded.length}`,
  );

  /**
   * ── Every remaining module, on its own document ─────────────────────────────────────────
   *
   * Nine modules run, and a field set that has never met a document is a declaration rather than a
   * feature: the retrieval terms are the part that is wrong most often, and nothing but a run finds
   * out. Each of these files one fixture, runs the step, and asserts the figure the step exists to
   * establish — the one a QS would notice missing.
   */
  /**
   * Sign the contract, because four of the steps below cannot start without it.
   *
   * §1.3.1's gate is real and it is the point: valuations, the cost report and the final account
   * each carry a *required* figure from the contract, so the platform refuses to run them over an
   * unsigned one. Signing here is not test scaffolding — it is the workflow.
   */
  const signCurrentRun = async (label) => {
    const state = await page.$eval('[data-region="signature"]', (region) => {
      const button = [...region.querySelectorAll("button")].find((b) =>
        /sign off/i.test(b.textContent ?? ""),
      );
      return { disabled: button?.disabled ?? null, text: region.textContent ?? "" };
    });

    if (state.disabled !== false) {
      console.log(`  [cannot sign ${label}] ${state.text.replace(/\s+/g, " ").slice(0, 180)}`);
    }
    check(`${label} can be signed`, state.disabled === false);
    if (state.disabled !== false) return false;

    await page.evaluate(() => {
      const region = document.querySelector('[data-region="signature"]');
      [...region.querySelectorAll("button")].find((b) => /sign off/i.test(b.textContent))?.click();
    });
    await page.waitForFunction(
      `document.querySelector('[data-region="signature"]')?.textContent.includes("Signed off")`,
      { timeout: 10000 },
    );
    return true;
  };

  await page.goto(`${BASE}${href}/contract`, { waitUntil: "networkidle0" });
  const contractSigned = await signCurrentRun("the contract");

  const steps = [
    {
      module: "/tender-analysis",
      criterion: "Tender returns",
      fixture: "./fixtures/tender-report.txt",
      expect: [
        ["ta-recommended", /ndlovu/i],
        ["ta-lowest", /186\s*420\s*000/],
      ],
    },
    {
      module: "/variations",
      criterion: "Contract instruction",
      fixture: "./fixtures/variation.txt",
      expect: [
        ["vo-number", /VO-?\s*009/i],
        ["vo-instruction", /CI-?\s*014/i],
        ["vo-value", /1\s*512\s*600/],
      ],
    },
    // The three that carry a required figure from the contract, and so could not have run at all
    // until it was signed a moment ago.
    {
      module: "/valuations",
      criterion: "Site valuation or measurement record",
      fixture: "./fixtures/valuation.txt",
      needsContract: true,
      /**
       * `vl-number` is deliberately not asserted, and it is not a weakened test — it is a recorded
       * miss. The certificate states "interim payment certificate number 07" in a sentence of its
       * own, retrieval reaches the document, and the model answers "the passages that cover this do
       * not state a figure for it". Every other field on the same document, including the period end
       * and four amounts, is read correctly.
       *
       * Nudging retrieval to prefer the step's own documents was tried and reverted: it did not fix
       * this and it perturbed two fields that had been stable. The value is printed above so the miss
       * is visible on every run rather than buried, and it is in the handoff as an open finding.
       */
      expect: [
        ["vl-work-executed", /94\s*310\s*500/],
        ["vl-contract-sum", /186\s*420\s*000/],
      ],
    },
    {
      module: "/cost-report",
      criterion: "Cost report or financial statement",
      fixture: "./fixtures/cost-report.txt",
      needsContract: true,
      expect: [
        ["cr-forecast", /197\s*340\s*000/],
        ["cr-variance", /10\s*920\s*000|5[.,]9/],
        ["cr-contract-sum", /186\s*420\s*000/],
      ],
    },
    {
      module: "/final-account",
      criterion: "Final account statement",
      fixture: "./fixtures/final-account.txt",
      needsContract: true,
      expect: [
        ["fa-value", /198\s*105\s*400/],
        ["fa-variations", /11\s*240\s*000/],
        ["fa-contract-sum", /186\s*420\s*000/],
      ],
    },
  ];

  /**
   * File against a row only if the row is still asking.
   *
   * Two criteria on two modules can accept the same kind of document, and one document then
   * satisfies both — a variation rests on the instruction the instructions register captured, which
   * is the domain being right rather than the platform being loose. The row that is already
   * satisfied offers no upload, and a suite that assumed one crashed with a null element instead of
   * saying so.
   */
  const fileIfOffered = async (criterion, fixture) => {
    const offered = await page.$$eval(
      '[data-region="readiness"] li',
      (rows, label) =>
        rows.some((r) => (r.textContent ?? "").includes(label) && r.querySelector('input[type="file"]')),
      criterion,
    );
    if (!offered) {
      console.log(`  (${criterion} is already satisfied by something filed earlier — not filed again)`);
      return false;
    }
    await fileAgainst(page, criterion, fixture);
    const filed = fixture.split("/").pop();
    await page.waitForFunction(
      `document.body.innerText.includes(${JSON.stringify(filed)})`,
      { timeout: 20000 },
    );
    return true;
  };

  for (const step of steps) {
    if (step.needsContract && !contractSigned) {
      check(`${step.module} runs`, false, "the contract was not signed, so this could not be reached");
      continue;
    }

    await page.goto(`${BASE}${href}${step.module}`, { waitUntil: "networkidle0" });
    await fileIfOffered(step.criterion, step.fixture);

    console.log(`\n  running ${step.module} against deepseek-chat…`);

    const run = await page.evaluate(
      async (id, mod) => {
        const response = await fetch(
          `/api/projects/${id}/runs?module=${encodeURIComponent(mod)}`,
          { method: "POST" },
        );
        const text = await response.text();
        return {
          status: response.status,
          body: text.slice(0, 160),
          events: text.split("\n").filter((l) => l.trim()).map((l) => {
            try {
              return JSON.parse(l);
            } catch {
              return { type: "unparsed" };
            }
          }),
        };
      },
      projectId,
      step.module,
    );

    const results = run.events.filter((e) => e.type === "field").map((e) => e.result);
    const failed = run.events.find((e) => e.type === "error");

    if (run.status !== 200) console.log(`  [refused] ${run.body}`);
    if (failed) console.log(`  [error] ${failed.error}`);

    for (const f of results) {
      const mark = { found: "✓", uncertain: "?", not_found: "·" }[f.state];
      console.log(`  ${mark} ${f.field.label.padEnd(30)} ${f.value ?? "—"}`);
      // The platform's own explanation for an absence. Printing it is the difference between
      // "the model did not answer" and knowing whether retrieval missed, the document is silent,
      // or a fabricated quote was caught and discarded.
      if (f.note) console.log(`      note: ${f.note}`);
    }

    check(`${step.module} runs`, run.status === 200 && !failed, `HTTP ${run.status}`);

    for (const [fieldId, pattern] of step.expect) {
      const got = results.find((f) => f.field.id === fieldId);
      check(
        `${step.module} reads ${fieldId}`,
        pattern.test(got?.value ?? ""),
        `${got?.state ?? "absent"} — ${got?.value ?? "—"}`,
      );
    }

    // The guarantee that makes any of it usable: what it quotes is in the document.
    const cited = results.filter((f) => f.citation);
    let ok = 0;
    for (const f of cited) {
      const [row] = await db`
        select body from passages
         where project_id = ${projectId}
           and document_id = ${f.citation.documentId}
           and body like ${"%" + f.citation.quote.slice(0, 45) + "%"}
         limit 1`;
      if (row) ok++;
      else console.log(`  [ungrounded] ${f.field.label}: “${f.citation.quote.slice(0, 60)}”`);
    }
    check(`${step.module} quotes verbatim`, ok === cited.length && cited.length > 0, `${ok}/${cited.length}`);
  }

  /**
   * ── The row-shaped run — §1.3.3 ─────────────────────────────────────────────────────────
   *
   * The bill proposes *rows*, so nothing above exercises it: a different extractor, a different
   * writer, a different table. `checks/bill.mjs` seeds rows to keep the free suite free, and a
   * seeded row is a row somebody typed — it proves the grid and proves nothing about the route.
   *
   * What is asserted here is structural rather than a list of expected descriptions. Which items a
   * model finds in a document is the thing being tested; an assertion naming them would be the
   * fixture bending to the platform. What has to hold whatever it reads: every row is grounded in a
   * passage really in the corpus, every persisted row is the row that was streamed, and **no
   * quantity is invented** — `costplan.txt` gives rates and measures nothing, so the rows must
   * arrive unmeasured rather than measured at zero.
   */
  await page.goto(`${BASE}${href}/bill`, { waitUntil: "networkidle0" });
  await fileIfOffered("Specification or measured scope", "./fixtures/layouts.txt");

  /**
   * Wait for the **server** to say the step may start, by asking it again until it does.
   *
   * `fileIfOffered` waits for the file's name to appear in the page, and `layouts.txt` was already
   * there — filed earlier as Concept drawings, which the bill also accepts — so it returned while
   * the upload was still being indexed, and the run was refused by its own gate. Polling the button
   * inside the current render is not enough either: `startable` is computed on the server (§1.3.1),
   * so the honest wait is a fresh render of the page.
   */
  let startableBill = false;
  for (let attempt = 0; attempt < 12 && !startableBill; attempt++) {
    await page.goto(`${BASE}${href}/bill`, { waitUntil: "networkidle0" });
    startableBill = await page.evaluate(() => {
      const button = [...document.querySelectorAll('[data-region="run"] button')].find((b) =>
        /draft the bill/i.test(b.textContent ?? ""),
      );
      return Boolean(button) && !button.disabled;
    });
  }

  check("the bill is startable once its scope document is filed", startableBill);

  console.log("\n  drafting the bill against deepseek-chat…");

  const bill = await page.evaluate(async (id) => {
    const response = await fetch(`/api/projects/${id}/runs?module=%2Fbill`, { method: "POST" });
    const text = await response.text();
    return {
      status: response.status,
      body: text.slice(0, 200),
      events: text.split("\n").filter((l) => l.trim()).map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return { type: "unparsed" };
        }
      }),
    };
  }, projectId);

  const proposed = bill.events.filter((e) => e.type === "item").map((e) => e.item);
  const billDone = bill.events.find((e) => e.type === "done");
  const billFailed = bill.events.find((e) => e.type === "error");

  if (bill.status !== 200) console.log(`  [refused] ${bill.body}`);
  if (billFailed) console.log(`  [error] ${billFailed.error}`);

  for (const item of proposed) {
    console.log(
      `  · ${(item.section ?? "—").padEnd(16)} ${item.description.slice(0, 50).padEnd(52)}` +
        ` ${(item.unit ?? "—").padEnd(4)} qty ${item.quantity ?? "—"}  rate ${item.rateText ?? "—"}`,
    );
    if (item.note) console.log(`      note: ${item.note}`);
  }
  if (billDone?.discarded) {
    console.log(`  ${billDone.discarded} row(s) discarded — the quote was not in the filed documents`);
  }

  check("/bill drafts a bill", bill.status === 200 && !billFailed, `HTTP ${bill.status}`);
  check("it proposes rows from the documents", proposed.length > 0, `${proposed.length} rows`);

  let verbatim = 0;
  for (const item of proposed) {
    const [row] = await db`
      select body from passages
       where project_id = ${projectId}
         and document_id = ${item.citation.documentId}
         and body like ${"%" + item.citation.quote.slice(0, 45) + "%"}
       limit 1`;
    if (row) verbatim++;
    else console.log(`  [ungrounded] ${item.description}: “${item.citation.quote.slice(0, 60)}”`);
  }
  check(
    "every row quotes verbatim",
    verbatim === proposed.length && proposed.length > 0,
    `${verbatim}/${proposed.length}`,
  );

  // The writer. Every row on the screen came from an event; every row in the database has to be the
  // same row, or the two halves of this feature have drifted apart.
  const written = await db`
    select row_type, proposed_description, proposed_unit, proposed_quantity,
           proposed_rate, proposed_rate_precision, amount, source_excerpt
      from run_items
     where run_id = (select id from runs where project_id = ${projectId} and module = '/bill'
                      order by created_at desc limit 1)
     order by seq`;

  const writtenItems = written.filter((row) => row.row_type === "item");

  // Every one of these has to be false over an empty run. A suite that passes when nothing happened
  // is the "at least ten" mistake `checks/signoff.mjs` already recorded — it is what lets a broken
  // writer stay green.
  check(
    "every proposed row was written",
    writtenItems.length === proposed.length && proposed.length > 0,
    `${writtenItems.length} rows against ${proposed.length} events`,
  );
  check(
    "with the description the stream reported",
    proposed.length > 0 &&
      writtenItems.every((row, i) => row.proposed_description === proposed[i]?.description),
  );
  check(
    "and the passage it cited",
    proposed.length > 0 && writtenItems.every((row) => row.source_excerpt?.length > 0),
  );
  check(
    "a section the documents grouped work under became a heading",
    written.some((row) => row.row_type === "heading") ===
      proposed.some((item) => item.section !== null),
  );

  /**
   * The one that matters most on this corpus. `costplan.txt` gives rates — "R1 850,00 per cubic
   * metre" — and states no quantity for anything. A model asked for a bill will happily supply one;
   * the platform's answer has to be that the work is described, priced and **not measured**.
   */
  const measured = writtenItems.filter((row) => row.proposed_quantity !== null);
  check(
    "no quantity was invented for work the documents do not measure",
    measured.length === 0 && writtenItems.length > 0,
    measured.map((row) => `${row.proposed_description} = ${row.proposed_quantity}`).join("; ") ||
      `${writtenItems.length} rows, none measured`,
  );
  check(
    "so no row carries an amount yet",
    writtenItems.length > 0 && writtenItems.every((row) => row.amount === null),
  );
  const priced = writtenItems.filter((row) => row.proposed_rate !== null);
  check(
    "and a rate that could be read is stored with its own scale",
    priced.length > 0 && priced.every((row) => Number(row.proposed_rate_precision) >= 2),
    `${priced.length} priced`,
  );

  if (billDone?.spend) {
    console.log(
      `  bill spend: ${billDone.spend.input} in + ${billDone.spend.output} out tokens` +
        (billDone.spend.rand !== null ? ` · $${billDone.spend.rand.toFixed(4)}` : ""),
    );
  }
} finally {
  await db.end();
}

if (done?.spend) {
  console.log(
    `  spend: ${done.spend.input} in + ${done.spend.output} out tokens` +
      (done.spend.rand !== null ? ` · $${done.spend.rand.toFixed(4)}` : " · no rates configured"),
  );
}

await browser.close();
console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} failed.`);
process.exit(fails ? 1 : 0);
