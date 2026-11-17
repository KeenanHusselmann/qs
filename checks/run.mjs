/**
 * The run's refusals — the half that costs nothing to test.
 *
 * A live run is in `checks/run-live.mjs` and spends credits, so it stays out of `npm run check`. What
 * belongs here is every path that ends before a token is spent, and those are not the boring ones:
 * §1.3's whole position is that a refusal must say what it is refusing and why. A run that returned
 * ten empty fields instead of saying "nothing is filed" would pass a naive test and lie to a QS.
 */

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

const name = "Run gate " + Date.now();
await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
const { href } = await createProject(page, name);
const projectId = href.split("/").pop();

// ── An empty corpus is refused in words, before anything is spent ─────────────────────────
const empty = await page.evaluate(async (id) => {
  const r = await fetch(`/api/projects/${id}/runs`, { method: "POST" });
  return { status: r.status, body: (await r.text()).trim() };
}, projectId);

check("a run over an empty corpus is refused", empty.status === 409, `HTTP ${empty.status}`);
check("and says there is nothing filed", /nothing is filed/i.test(empty.body), empty.body.slice(0, 80));
check("and says what would clear it", /file the documents/i.test(empty.body));

// ── The run is behind the session, like everything that reads a corpus ────────────────────
const anonymous = await browser.createBrowserContext();
const stranger = await anonymous.newPage();
// On the origin before fetching from it — a page on about:blank cannot make this request at all,
// and "Failed to fetch" would look like a passing refusal for entirely the wrong reason.
await stranger.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
const refused = await stranger.evaluate(
  async (id) => (await fetch(`/api/projects/${id}/runs`, { method: "POST" })).status,
  projectId,
);
check("a signed-out run is refused", refused === 401, `HTTP ${refused}`);
await anonymous.close();

// ── The button refuses before the server has to ───────────────────────────────────────────
await page.goto(`${BASE}${href}${FEASIBILITY}`, { waitUntil: "networkidle0" });

const gate = await page.evaluate(() => {
  const button = [...document.querySelectorAll("button")].find((b) =>
    /run extraction/i.test(b.textContent ?? ""),
  );
  return { present: Boolean(button), disabled: button?.disabled ?? null, page: document.body.innerText };
});

check("the run button is on the module page", gate.present);
check("and is disabled while required documents are missing", gate.disabled === true);

/**
 * ── And the server refuses the same thing ─────────────────────────────────────────────────
 *
 * §1.3.1: "the server owns the chain, and the client never recomputes it. A client that decided its
 * own prerequisites could start a downstream step from nothing and call it approved." It could: the
 * button had been disabled for missing inputs since it was built, and the route behind it checked
 * only whether the corpus was empty — so one filed document of any kind ran the step past every
 * requirement, and the result was indistinguishable afterwards from a run somebody was entitled to.
 */
/**
 * ── The refusal offers what it names ──────────────────────────────────────────────────────
 *
 * It used to be a sentence: "File Project brief and concept parameters first". A reader holding
 * that document then had to scroll past the run panel, find the matching row in the readiness list
 * and use the button there. Naming a requirement and putting the only way to satisfy it somewhere
 * else is the v3 lesson about the documents page, one screen further in.
 */
const refusal = await page.evaluate(() => {
  const region = document.querySelector('[data-region="blocked"]');
  return {
    present: Boolean(region),
    named: [...(region?.querySelectorAll("li") ?? [])].map((li) =>
      (li.textContent ?? "").replace(/Upload\s*$/, "").trim(),
    ),
    uploads: region?.querySelectorAll('input[type="file"]').length ?? 0,
    kinds: [...(region?.querySelectorAll("button[title]") ?? [])].map((b) => b.title),
  };
});

check("the refusal is a region of its own", refusal.present);
check(
  "naming every requirement that is missing",
  refusal.named.includes("Project brief and concept parameters"),
  refusal.named.join(" | "),
);
check(
  "with an upload beside each one, where the reader was told about it",
  refusal.uploads > 0 && refusal.uploads === refusal.named.length,
  `${refusal.uploads} uploads for ${refusal.named.length} requirements`,
);
check(
  "each filing under that criterion's own kind, never a guess",
  refusal.kinds.includes("File as Project brief"),
  refusal.kinds.join(", "),
);

// Filed **from the refusal**, not from the list below it. This is the assertion that would go red
// if the banner went back to being a sentence.
await fileAgainst(
  page,
  "Project brief and concept parameters",
  "./fixtures/brief.txt",
  '[data-region="blocked"]',
);
await page.waitForFunction(`document.body.innerText.includes("brief.txt")`, { timeout: 20000 });

const afterFiling = await page.evaluate(() =>
  [...(document.querySelectorAll('[data-region="blocked"] li') ?? [])].map((li) =>
    (li.textContent ?? "").replace(/Upload\s*$/, "").trim(),
  ),
);
check(
  "and filing from it clears that requirement out of the refusal",
  !afterFiling.includes("Project brief and concept parameters"),
  afterFiling.join(" | ") || "(nothing left)",
);
check(
  "while the ones still outstanding stay named and still offer their upload",
  afterFiling.length > 0,
  `${afterFiling.length} left`,
);

const past = await page.evaluate(async (id) => {
  const r = await fetch(`/api/projects/${id}/runs`, { method: "POST" });
  return { status: r.status, body: (await r.text()).trim() };
}, projectId);

check("a run past the disabled button is refused by the server", past.status === 409, `HTTP ${past.status}`);
check(
  "and the refusal names the requirement, not the corpus",
  /still required/i.test(past.body) && !/nothing is filed/i.test(past.body),
  past.body.slice(0, 120),
);
check(
  "and says why a run without it would mislead",
  /reads as a broken agent/i.test(past.body),
);

const noRun = await page.evaluate(async (id) => {
  const r = await fetch(`/api/projects/${id}/runs`, { method: "POST" });
  return r.status;
}, projectId);
check("the refusal is not a one-off", noRun === 409, `HTTP ${noRun}`);
// "Blocked" alone is a shrug — the refusal names the documents that would clear it.
check(
  "the refusal names what to file",
  /file .*first/i.test(gate.page),
  (gate.page.match(/File [^\n]{0,80}/) ?? ["not found"])[0],
);
// The banner offers the other way in (audit C2): a QS who knows the figures types them.
check(
  "and offers entry by hand instead",
  /enter them by hand/i.test(gate.page),
);

// ── A drawing on its own must not take the page down ──────────────────────────────────────
//
// It did. Grounding discounted drawing passages *after* concluding that a passage existed and a
// kind match therefore need not, so a project whose only retrieval hit came from a drawing reached
// a non-null assertion on an absent document and 500'd the module page. Filing a concept drawing —
// one of the three documents this module asks for — was enough to trigger it.
await page.goto(`${BASE}${href}${FEASIBILITY}`, { waitUntil: "networkidle0" });
const drawingRow = await page.$$eval('[data-region="readiness"] li', (rows) =>
  rows.some((r) => /concept drawings/i.test(r.textContent ?? "")),
);
check("the module asks for a drawing kind", drawingRow);

const { fileAgainst: file } = await import("./helpers.mjs");
await file(page, "Concept layouts", "./fixtures/costplan.txt");
await page.waitForFunction(`document.body.innerText.includes("costplan.txt")`, { timeout: 20000 });

// The third mandatory input, filed under a kind the criterion accepts. Grounding requires both
// signals now — the corpus contains the words *and* they are in a document this criterion asked
// for — so the brief's own market paragraph no longer stands in for a market study.
await page.goto(`${BASE}${href}${FEASIBILITY}`, { waitUntil: "networkidle0" });
await file(page, "Market data", "./fixtures/market.txt");
await page.waitForFunction(`document.body.innerText.includes("market.txt")`, { timeout: 20000 });

const afterDrawing = await page.goto(`${BASE}${href}${FEASIBILITY}`, { waitUntil: "networkidle0" });
check("the module page still renders", afterDrawing.status() === 200, `HTTP ${afterDrawing.status()}`);
check("and still shows its requirements", Boolean(await page.$('[data-region="readiness"]')));

/**
 * ── A drawing the criterion asked for satisfies it ────────────────────────────────────────
 *
 * "Concept layouts" files under Concept drawings, which is spatial, and a spatial document's
 * passages never ground anything — so this criterion sat at `uncertain` for ever, `uncertain` is
 * not resolved, and mandatory-and-unresolved blocks. The feasibility step could not be started
 * through the interface at all, however many drawings were filed. The disabled button was the only
 * symptom and it said nothing about why.
 *
 * The run is deliberately **not** started here: this suite spends nothing. That the model runs from
 * this state is `checks/run-live.mjs`.
 */
const cleared = await page.evaluate(() => {
  const button = [...document.querySelectorAll("button")].find((b) =>
    /run extraction/i.test(b.textContent ?? ""),
  );
  return { disabled: button?.disabled ?? null, page: document.body.innerText };
});

check("filing the drawing it asked for satisfies the criterion", cleared.disabled === false);
check(
  "and the row says the drawing is measured rather than read",
  /measured by take-off rather than read/i.test(cleared.page),
);
check(
  "and nothing is still named as required",
  !/still needed|file .* first/i.test(cleared.page),
  (cleared.page.match(/File [^\n]{0,60}/) ?? ["nothing outstanding"])[0],
);

await browser.close();
console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} failed.`);
process.exit(fails ? 1 : 0);
