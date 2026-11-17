/**
 * Drives Projects — create, persist, list.
 *
 * ── A trap worth naming ────────────────────────────────────────────────────────────────────
 *
 * Table headings are uppercased by CSS (§7.4), so `innerText` returns "DOCUMENTS" while the source
 * says "Documents". Three assertions in this suite have failed on that, each time reporting a bug
 * that did not exist. Everything here compares case-insensitively.
 */

import puppeteer from "puppeteer";
import { readEnv } from "./helpers.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";

const env = readEnv();

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

const mainText = () => page.$eval("main", (el) => el.innerText);
const unique = `Test scheme ${Date.now()}`;

try {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
  await page.type("#email", env.DEV_USER_EMAIL);
  await page.type("#password", env.DEV_USER_PASSWORD);
  await Promise.all([page.click('button[type="submit"]'), page.waitForNavigation()]);

  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
  check("projects page loads", page.url().endsWith("/projects"));

  // ── The form lives in a dialog now ───────────────────────────────────────────────────────
  // Named, not "the only dialog on the page" — the command palette lives in the top bar now.
  const dialogOpen = () => page.$eval('[data-region="new-project"]', (d) => d.open);
  const isModal = () => page.$eval('[data-region="new-project"]', (d) => d.matches(":modal"));

  check("form is not on the page until asked for", (await dialogOpen()) === false);

  /*
    Clicked again if the first click did not open it, three times at most.

    The second open follows the stray-attribute test below, where the guard closes the dialog
    behind React's back. On a busy CI runner the click could land before the state had caught up
    and do nothing, failing the suite on 16 Nov 2026 with code identical to a run that had passed.
    Three clicks that each fail to open it is still a failure, so a button that is really dead
    still fails here; one lost to timing does not.
  */
  const openDialog = async () => {
    for (let attempt = 1; ; attempt++) {
      await page.$$eval("button", (buttons) =>
        buttons.find((b) => /add (a |the first )?project/i.test(b.textContent))?.click(),
      );
      const opened = await page
        .waitForFunction(() => document.querySelector('[data-region="new-project"]')?.matches(":modal") === true, {
          timeout: 4000,
        })
        .then(() => true)
        .catch(() => false);
      if (opened) return;
      if (attempt === 3) throw new Error("The Add project button did not open the dialog in three clicks.");
    }
  };

  await openDialog();
  check("the button opens it", await dialogOpen());

  /**
   * ---- A dialog is modal, or it is shut. There is no third state ----
   *
   * `<dialog open>` without showModal() is a *non-modal* dialog: normal flow, no backdrop, the
   * page behind it live, and it scrolls with the page. Reported twice from a real browser as "the
   * modal is fixed to the projects page on load", and the tell both times was that nothing behind
   * it was dimmed.
   *
   * A clean load never reaches that state - measured, with an observer watching the attribute from
   * before hydration. What reaches it is a tab left open and then hot-reloaded: the element is
   * replaced, the attribute is reconciled onto the new node, the top-layer entry is not.
   *
   * The first guard corrected it inside a render effect and did not hold, because **the bad state
   * arrives without a render and no render follows it**. So the attribute is watched instead, and
   * the check below is the shape that failed: force it, then touch nothing.
   */
  check("and it opens modal, with the page behind it inert", await isModal());
  check(
    "which is what makes the page behind it unreachable",
    // Falsifiable: with a non-modal dialog the "Add project" button is still the top element at
    // its own coordinates and a click would land on it. Under showModal() the backdrop is.
    await page.evaluate(() => {
      const behind = [...document.querySelectorAll("main button")].find((b) =>
        /add (a |the first )?project/i.test(b.textContent),
      );
      if (!behind) return false;
      const box = behind.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return hit !== behind && !behind.contains(hit);
    }),
  );

  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.querySelector('[data-region="new-project"]')?.open === false, {
    timeout: 4000,
  });

  // The reported state, reproduced exactly - and then nothing clicked, nothing typed, no render
  // provoked. A guard that needs something else to happen first is not a guard.
  //
  // Measured in the same synchronous turn as the attribute is set, before any observer can react:
  // this is the CSS rule alone (`dialog:not(:modal) { display: none }`), which is the layer that
  // still works when the JavaScript is the thing that went wrong - a stale bundle, a hot reload
  // that dropped the top-layer entry, a hydration that did not finish.
  const hiddenByStyle = await page.$eval('[data-region="new-project"]', (d) => {
    d.setAttribute("open", "");
    return { open: d.open, shown: d.checkVisibility(), display: getComputedStyle(d).display };
  });
  check(
    "a non-modal dialog is not displayed at all, before any script reacts",
    hiddenByStyle.open && !hiddenByStyle.shown && hiddenByStyle.display === "none",
    JSON.stringify(hiddenByStyle),
  );
  const corrected = await page
    .waitForFunction(() => document.querySelector('[data-region="new-project"]')?.open === false, {
      timeout: 3000,
    })
    .then(() => true)
    .catch(() => false);
  check("a stray open attribute is removed without waiting for a render", corrected);

  await openDialog();

  /*
    Closing has to take the React state with it, or the button is dead from here on.

    Waited for by its own box, not by the dialog being `:modal`. The dialog reports modal the
    moment it opens, while the close button inside it is still animating in with no clickable
    point — so `page.click` threw "Node is either not clickable" on a busy machine and killed the
    suite outright rather than failing a check. `visible: true` waits for a real bounding box.
  */
  const close = await page.waitForSelector('[data-region="new-project"] button[aria-label="Close"]', {
    visible: true,
    timeout: 4000,
  });
  await close.click();
  await page.waitForFunction(() => document.querySelector('[data-region="new-project"]')?.open === false, {
    timeout: 4000,
  });
  await openDialog();
  check("and it reopens after being closed", await isModal());

  // showModal() puts the dialog in the top layer and the caret in the first field. Both have
  // broken before — a dialog you have to click into is a dialog that wastes the first keystroke.
  check(
    "the name field has focus on open",
    await page.evaluate(() => document.activeElement?.id === "name"),
  );

  // Escape closes, and is the reflex people reach for before they look for a Cancel button.
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.querySelector('[data-region="new-project"]')?.open === false, {
    timeout: 4000,
  });
  check("Escape closes it", (await dialogOpen()) === false);

  /**
   * ---- Setup is three steps, and the second one is the whole point ----
   *
   * A project is opened by answering what it is, where it is, and what documents are to hand.
   * Asserted on the *derivation* rather than on names: the stage list comes from L0 and the
   * checklist from the entry criteria, so pinning either here would break every time a module was
   * added - the fixture bending to the platform.
   */
  await openDialog();

  const rail = await page.$$eval('[data-region="steps"] [data-step]', (steps) =>
    steps.map((s) => ({ state: s.dataset.state, text: s.textContent.trim() })),
  );
  check(
    "setup is three named steps, not one form",
    rail.length === 3,
    rail.map((s) => s.text).join(" / "),
  );
  check(
    "and it opens on the first of them",
    rail[0]?.state === "current" && rail[1]?.state === "ahead",
  );

  const nextDisabled = () =>
    page.$eval('[data-region="new-project"] [data-action="next"]', (b) => b.disabled);
  check("Next is refused until the project has a name", await nextDisabled());

  await page.type("#name", unique);
  check("and offered once it has one", (await nextDisabled()) === false);

  await page.click('[data-region="new-project"] [data-action="next"]');
  await page.waitForSelector('[data-region="stages"] [data-stage]', { timeout: 4000 });

  const readStages = () =>
    page.$$eval('[data-region="stages"] [data-stage]', (options) =>
      options.map((o) => ({
        value: o.dataset.stage,
        selected: o.dataset.selected === "true",
        text: o.textContent.replace(/\s+/g, " ").trim(),
      })),
    );

  const stages = await readStages();

  check("step two asks which stage the project is at", stages.length > 0, `${stages.length} stages`);
  check(
    "each is an L0 phase number, not a name of its own",
    stages.every((s) => /^[1-7]$/.test(s.value)),
    stages.map((s) => s.value).join(","),
  );
  check("each says what work it carries", /Feasibility Estimate/.test(stages[0]?.text ?? ""));
  check(
    "and how much it will ask for, before it is picked",
    stages.every((s) => /\d+ to gather/.test(s.text)),
    stages[0]?.text.slice(-30),
  );
  check("nothing is pre-selected - the stage is the question", stages.every((s) => !s.selected));

  // Picking one narrows the project to that stage onward. The earlier ones are shown as set aside
  // rather than hidden: a reader who picks Construction should see that they just put five behind.
  await page.click('[data-region="stages"] [data-stage="4"]');
  const afterPick = await readStages();
  check("picking a stage selects exactly one", afterPick.filter((s) => s.selected).length === 1);
  check(
    "and marks the earlier stages as behind it",
    afterPick.filter((s) => Number(s.value) < 4).every((s) => /behind it/.test(s.text)),
  );

  const advice = () =>
    page.$eval('[data-region="advice"]', (el) => ({
      tone: el.dataset.tone,
      text: el.innerText.replace(/\s+/g, " ").trim(),
    }));

  const opening = await advice();
  check(
    "the setup says what the stage will ask for",
    /\d+ things?/.test(opening.text),
    opening.text.slice(0, 90),
  );
  check("before anything is answered it is neither approval nor a warning", opening.tone === "info");

  // ---- Step three: that stage's criteria, and nothing else's ----
  await page.click('[data-region="new-project"] [data-action="next"]');
  await page.waitForSelector('[data-region="checklist"] [data-criterion]', { timeout: 4000 });

  const chosen = afterPick.find((s) => s.selected);
  const wanted = Number(/(\d+) to gather/.exec(chosen?.text ?? "")?.[1] ?? "0");
  const rows = await page.$$eval('[data-region="checklist"] [data-criterion]', (cells) =>
    cells.map((c) => c.dataset.criterion),
  );

  check(
    "the checklist is exactly what that stage said it would ask for",
    rows.length === wanted && wanted > 0,
    `${rows.length} rows against ${wanted} promised`,
  );
  check("and it is that stage's criteria, not every criterion", rows.length < 40, `${rows.length}`);

  const options = await page.$$eval(
    '[data-region="checklist"] [data-criterion] [data-answer-option]',
    (buttons) => buttons.slice(0, 3).map((b) => b.dataset.answerOption),
  );
  check(
    "every requirement offers the answer rather than asking for prose",
    options.join(",") === "have,not-yet,n/a",
    options.join(","),
  );

  // Answering changes what the setup says back, and an outstanding required thing is named.
  await page.click('[data-region="checklist"] [data-criterion] [data-answer-option="n/a"]');
  await page.waitForFunction(
    () => document.querySelector('[data-region="advice"]')?.dataset.tone !== "info",
    { timeout: 4000 },
  );
  const answered = await advice();
  check("answering one changes what the setup says back", answered.tone !== "info", answered.tone);
  check(
    "an outstanding required document is named, with what its absence costs",
    answered.tone === "warn" && answered.text.length > 60,
    answered.text.slice(0, 120),
  );

  // ---- A project may be opened with nothing filed ----
  // Doctrine states the gap; it does not withhold the project. This is the case that has to work:
  // a practice takes a job on with one document and a phone call.
  await page.click('[data-region="new-project"] [data-action="create"]');
  await page.waitForFunction(() => /^\/projects\/[0-9a-f-]{36}$/.test(location.pathname), {
    timeout: 20000,
  });
  check("opens the project with nothing answered but the stage", true, page.url().slice(-40));
  check("and lands on it, rather than back on a list", (await mainText()).includes(unique));

  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
  const after = await mainText();
  check("survives a reload - it is in Postgres, not memory", after.includes(unique));

  // The list says it in words under the name – "No client recorded" – not a dash, and never blank.
  const lines = after.split("\n");
  const at = lines.findIndex((line) => line.includes(unique));
  check("an unset client is said in words, not left blank", /No client recorded/.test(lines.slice(at, at + 3).join(" ")), lines.slice(at, at + 3).join(" | "));
  // The Documents column of this project's row, read from the table rather than from page text.
  const documentsCell = await page.evaluate((name) => {
    const tr = [...document.querySelectorAll('[data-region="project-list"] tbody tr')].find((r) => r.innerText.includes(name));
    return tr?.querySelectorAll("td")[4]?.innerText.trim() ?? null;
  }, unique);
  check("document count starts at 0, stated not blank", documentsCell === "0", String(documentsCell));

  check(
    "table headings present",
    /project/i.test(after) && /client/i.test(after) && /documents/i.test(after),
  );

  check(
    "breadcrumb reads Projects",
    (await page.$eval('nav[aria-label="Breadcrumb"]', (e) => e.textContent.trim())) === "Projects",
  );

  // The name is still the one thing required. It is refused by the step rather than by a server
  // round trip, which is the difference between a disabled button and an error message.
  await openDialog();
  check("a nameless project cannot advance past the first step", await nextDisabled());
  check("and the dialog stays open rather than being dismissed", await dialogOpen());
} finally {
  await browser.close();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
