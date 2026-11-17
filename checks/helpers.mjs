import { readFileSync } from "node:fs";

/**
 * Shared steps for the browser suites.
 *
 * Creating a project appears in six of them. When the form moved into a dialog, six suites broke on
 * the same two lines, and patching each one identically is how the copies drift apart until three
 * of them are testing a flow that no longer exists. The steps every suite shares live here.
 */


/** Where a module's own requirements are listed and filed. Modules own criteria; the project's
 *  front page only summarises them. */
export const FEASIBILITY = "/feasibility";

/**
 * Read `.env.local` the way dotenv does, which is not the way a one-liner does.
 *
 * Every suite carried its own `indexOf("=")` version of this, and connecting a Blob store proved
 * why that was a bad idea: `vercel env pull` rewrites the file with **every value quoted**, so
 * `DEV_USER_EMAIL="qs@example.com"` came back with the quotes attached. The application was
 * unaffected — dotenv strips them — but the suites typed a quoted string into `<input
 * type="email">`, the browser's own validation silently refused to submit the form, and no request
 * was ever made. No error, no failed assertion, just a navigation that never happened.
 *
 * In all twelve suites at once. Anything that appears to break every suite simultaneously, right
 * after something touched the environment, is usually not a code bug.
 */
export function readEnv(path = ".env.local") {
  const values = {};

  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const split = trimmed.indexOf("=");
    if (split < 1) continue;

    const key = trimmed.slice(0, split).trim();
    let value = trimmed.slice(split + 1).trim();

    if (value.length > 1 && /^(".*"|'.*')$/s.test(value)) value = value.slice(1, -1);
    values[key] = value;
  }

  refuseRemoteDatabase(values.DATABASE_URL);
  return values;
}

/**
 * Refuse to run a browser suite against anything but a local database.
 *
 * ── The accident this exists to make impossible ────────────────────────────────────────────
 *
 * These suites create projects, upload documents, sign runs and delete everything afterwards —
 * `clean-test-projects.mjs` removes them by the dozen. That is safe against a container on this
 * machine and catastrophic against the instance production serves.
 *
 * Nothing enforced it. The README says "local development uses local Postgres, never Neon" and
 * `.env.local` was trusted to say so, which held right up until `vercel link` and
 * `vercel integration add neon` each **rewrote `.env.local`** and pointed `DATABASE_URL` at the
 * production database without being asked. Two commands, both ordinary, both part of setting a
 * deployment up. The file the rule depended on is a file other tools edit.
 *
 * So the rule is checked at the one place every suite passes through, rather than documented.
 * A hostname is not a strong boundary, but it is the exact shape of the near-miss: the suites went
 * from safe to pointed at Neon without anybody typing a database URL.
 */
function refuseRemoteDatabase(url) {
  if (!url) return;

  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return; // Not parseable, so not a remote database this can reason about.
  }

  const local =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "db" || // the service name inside compose
    host.endsWith(".local");

  if (local) return;

  console.error(
    `
  DATABASE_URL points at ${host}, which is not a local database.

` +
      `  These suites create and delete projects. Against a deployed database that is
` +
      `  destructive, so this refuses rather than asks.

` +
      `  \`vercel link\` and \`vercel integration add\` both rewrite .env.local — if you have
` +
      `  just run either, put DATABASE_URL back to the container:

` +
      `    postgresql://postgres:devpassword@localhost:5434/qs_platform?sslmode=disable
`,
  );
  process.exit(1);
}

/**
 * Create a project from the list page and return its href.
 *
 * Assumes the page is already on /projects and signed in.
 */
/**
 * Dialogs are named, not assumed to be the only one.
 *
 * `document.querySelector("dialog")` returned the right element right up until the command palette
 * landed in the top bar — which renders *above* the page, so the bare selector started matching a
 * closed palette and every wait for "the dialog is open" hung for thirty seconds. Naming the one
 * you mean costs a data attribute and cannot break that way again.
 */
export async function createProject(page, name, base = "http://localhost:3000", stage = 1, client = "") {
  await page.$$eval("button", (buttons) =>
    buttons.find((b) => /add (a |the first )?project/i.test(b.textContent))?.click(),
  );
  await page.waitForFunction(() => document.querySelector('[data-region="new-project"]')?.open === true, {
    timeout: 5000,
  });

  // ── Three steps now, and the helper walks all three ────────────────────────────────────
  // Setup asks what the project is, where it is, and what documents are to hand. Every suite
  // that needs "a project exists" takes the shortest path through: a name, the stage, and no
  // documents — which is also the case that has to keep working (a project may be opened with
  // nothing filed).
  await page.type("#name", name);

  /*
    A client, where the caller needs one.

    Optional because most suites need only that a project exists. The contacts suite needs one
    whose client is a known string, so it can assert the directory finds it — and typing it here
    beats a second creation path that would drift from this one.
  */
  if (client) await page.type("#client", client);
  await page.click('[data-region="new-project"] [data-action="next"]');

  await page.waitForSelector(`[data-region="stages"] [data-stage="${stage}"]`, { timeout: 5000 });
  await page.click(`[data-region="stages"] [data-stage="${stage}"]`);
  await page.click('[data-region="new-project"] [data-action="next"]');

  await page.waitForSelector('[data-region="checklist"]', { timeout: 5000 });
  await page.click('[data-region="new-project"] [data-action="create"]');

  // Setup lands on the project it just opened, so the URL is the answer rather than a link that
  // has to be found in a list.
  await page.waitForFunction(
    () => /^\/projects\/[0-9a-f-]{36}$/.test(location.pathname),
    { timeout: 20000 },
  );

  const href = new URL(page.url()).pathname;
  return { href, url: base + href };
}

/** Sign in. Every suite starts here. */
export async function signIn(page, env, base = "http://localhost:3000") {
  await page.goto(`${base}/login`, { waitUntil: "networkidle0" });
  await page.type("#email", env.DEV_USER_EMAIL);
  await page.type("#password", env.DEV_USER_PASSWORD);
  await Promise.all([page.click('button[type="submit"]'), page.waitForNavigation()]);
}

/**
 * File a document against a named criterion, through that row's own Upload button.
 *
 * This is the only way to file now. The project-wide documents panel is gone: a second upload box
 * under the checklist asked the reader to choose between two ways to do the same thing, and the
 * one on the row already knows which criterion it is answering.
 *
 * `region` picks **which surface** the row is on, and there are two that carry the same control:
 * the readiness list, and the run panel's blocked refusal — which names the documents it is waiting
 * for and now offers each one's upload beside it. Same component, same criterion, same kind; what
 * differs is only where the reader happened to be told. A suite that could only drive one of them
 * would let the other rot.
 */
export async function fileAgainst(page, criterionLabel, filePath, region = '[data-region="readiness"]') {
  const inputs = await page.$$(`${region} li`);

  for (const row of inputs) {
    const text = await row.evaluate((el) => el.textContent ?? "");
    if (!text.includes(criterionLabel)) continue;

    const file = await row.$('input[type="file"]');
    if (!file) throw new Error(`"${criterionLabel}" has no upload — is it already satisfied?`);

    await file.uploadFile(filePath);
    return;
  }

  throw new Error(`No row for "${criterionLabel}"`);
}

/**
 * Collect the console errors a page emits, so a suite can fail on them.
 *
 * ── Why `pageerror` was not enough ─────────────────────────────────────────────────────────
 *
 * Every suite listens for `pageerror`, which fires on an *uncaught exception*. React's warnings are
 * not exceptions — they are `console.error` — so the whole class of "this renders but is wrong" went
 * past seventeen green suites. It was a reader who found `Each child in a list should have a unique
 * "key" prop`: the project overview keyed its downstream links on `link.module`, and a neighbour
 * that is a process area with no module of its own has `module: undefined`, so the Cost Plan's two
 * such links collided. Nothing crashed. Nothing was red.
 *
 * Returns a live array — read it after the navigations, and assert it is empty.
 *
 * Filtered to the warnings that are always a defect. React says these about real bugs and nothing
 * else, whereas a dev server's console carries fast-refresh chatter and network noise that would
 * make an assertion on *every* error a flaky one.
 */
export function watchConsole(page) {
  const errors = [];

  page.on("console", (message) => {
    if (message.type() !== "error") return;

    const text = message.text();
    if (/unique "key"|each child in a list|hydration|did not match|cannot appear as a descendant|validateDOMNesting/i.test(text)) {
      errors.push(text.replace(/\s+/g, " ").slice(0, 200));
    }
  });

  return errors;
}
