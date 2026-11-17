/**
 * Drives the app shell in a real browser.
 *
 * Throwaway check, same as checks/login.mjs — deleted once there is a real test suite.
 */

import puppeteer from "puppeteer";
import { createProject, readEnv } from "./helpers.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";

const env = readEnv();

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

/**
 * Wait for a condition rather than a fixed sleep.
 *
 * A fixed timeout made this suite flaky: the first run after a code change hits Next's dev-mode
 * compile, so a click landed before the component had hydrated and the assertion read a stale
 * width. Waiting on the thing being asserted removes the guess.
 */
async function waitFor(page, describe, predicate, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  console.log(`  (timed out waiting for ${describe})`);
  return false;
}

const sidebarWidthIs = (px) => `Math.round(document.querySelector("aside").getBoundingClientRect().width) === ${px}`;

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 }); // §7.3 primary design target

try {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
  await page.type("#email", env.DEV_USER_EMAIL);
  await page.type("#password", env.DEV_USER_PASSWORD);
  await Promise.all([page.click('button[type="submit"]'), page.waitForNavigation()]);
  check("signed in and landed on Home", new URL(page.url()).pathname === "/", page.url());

  // ── Shell structure ────────────────────────────────────────────────────────────────────
  const topBarHeight = await page.$eval("header", (el) => el.getBoundingClientRect().height);
  check("top bar is 56px (§7.3)", Math.round(topBarHeight) === 56, `${topBarHeight}px`);

  const sidebarWidth = await page.$eval("aside", (el) => el.getBoundingClientRect().width);
  check("sidebar is 240px (§7.3)", Math.round(sidebarWidth) === 240, `${sidebarWidth}px`);

  const navLabels = await page.$$eval("nav[aria-label='Main'] a, nav[aria-label='Main'] span", (els) =>
    els.map((e) => e.textContent.replace("soon", "").trim()).filter(Boolean),
  );
  // The platform level only — project modules render when a project is open, and none exist yet.
  check(
    "menu lists the platform modules",
    // The simplified menu of 16 Nov 2026: one front page, the work, and the firm's few places.
    ["Home", "Projects", "Ad hoc requests", "Rate Library", "Benchmarks", "Contacts", "Settings"].every((l) =>
      navLabels.includes(l),
    ) && !["Portfolio", "Approvals", "Reports", "Process model", "Policies", "Rubric"].some((l) => navLabels.includes(l)),
    navLabels.join(", "),
  );
  check(
    "project nav is absent with no project open",
    (await page.$("nav[aria-label='Project']")) === null,
  );
  // The sidebar must fit the viewport — the reason v3 pulled the process tree out of it.
  const navOverflows = await page.$eval("aside", (el) => el.scrollHeight > el.clientHeight + 1);
  check("sidebar fits without scrolling", !navOverflows);

  // ── Sidebar collapse persists ──────────────────────────────────────────────────────────
  // Hydration first — the button exists in the server HTML before React has attached to it.
  await page.waitForFunction(sidebarWidthIs(240));
  await page.click('button[aria-label="Collapse sidebar"]');
  check("collapses to 56px", await waitFor(page, "sidebar at 56px", sidebarWidthIs(56)));

  await page.reload({ waitUntil: "networkidle0" });
  check(
    "collapse survives a reload",
    await waitFor(page, "sidebar still at 56px", sidebarWidthIs(56)),
  );

  await page.click('button[aria-label="Expand sidebar"]');
  await waitFor(page, "sidebar back at 240px", sidebarWidthIs(240));

  // ── User menu: profile, settings, sign out ─────────────────────────────────────────────
  await page.click('button[aria-label="Account menu"]');
  await page.waitForSelector('[role="menu"]');

  const menu = await page.$eval('[role="menu"]', (el) => el.textContent);
  check("menu shows the signed-in email", menu.includes(env.DEV_USER_EMAIL), menu.slice(0, 60));
  check("menu has Profile", menu.includes("Profile"));
  check("menu has Settings", menu.includes("Settings"));
  check("menu has Sign out", menu.includes("Sign out"));

  // Escape closes it — §7.5.
  await page.keyboard.press("Escape");
  check(
    "Escape closes the menu",
    await waitFor(page, "menu to close", 'document.querySelector("[role=menu]") === null'),
  );

  /**
   * ── The command palette — PLATFORM.md §4.1 ──────────────────────────────────────────────
   *
   * A project is created first, deliberately.
   *
   * This asserted "the palette offers somewhere to go" against whatever the database happened to
   * hold, which for months was residue from earlier suites — it passed for a reason that had
   * nothing to do with the palette. Run against a clean database it failed with "0 results", and
   * it was right to: with no projects there is nowhere to go, and the empty state is the correct
   * screen. A suite that needs data has to make it.
   *
   * §4.1 asks the top bar for a project switcher ("search-first — a `<select>` is not acceptable")
   * and a global search. They are one control, and both were a `disabled` button until now.
   *
   * The centring is asserted because it was wrong: a `<dialog>` centres itself through
   * `margin: auto` and the CSS reset zeroes it, so the palette rendered hard against the top-left
   * corner. Nothing about that is visible to a text assertion.
   */
  await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });

  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
  await createProject(page, `Palette ${Date.now()}`, BASE);
  await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });

  await page.keyboard.down("Control");
  await page.keyboard.press("KeyK");
  await page.keyboard.up("Control");
  await page.waitForFunction(
    () => document.querySelector('[data-region="palette"]')?.open === true,
    { timeout: 5000 },
  );
  check("Ctrl+K opens the palette", true);

  const box = await page.evaluate(() => {
    const d = document.querySelector('[data-region="palette"]').getBoundingClientRect();
    return { off: Math.abs(d.left - (window.innerWidth - d.width) / 2), width: Math.round(d.width) };
  });
  check("and it is centred, not pinned to the corner", box.off < 2, `${box.off}px off centre`);

  const listed = await page.evaluate(() =>
    [...document.querySelectorAll('[data-region="palette"] [data-kind]')].map((b) => b.dataset.kind),
  );
  check("it offers somewhere to go", listed.length > 0, `${listed.length} results`);
  check(
    "and only projects, built steps and the firm's built places",
    listed.every((k) => k === "project" || k === "module" || k === "place"),
  );

  // Typing narrows it, and a query nothing matches says so rather than showing everything.
  await page.type('[data-region="palette"] input', "zzzznotathing");
  await page.waitForFunction(
    () => document.querySelector('[data-region="palette-empty"]') !== null,
    { timeout: 4000 },
  );
  check("a query nothing matches says so", true);

  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => document.querySelector('[data-region="palette"]')?.open === false,
    { timeout: 4000 },
  );
  check("Escape closes it", true);

  /*
    ── The process model, as a page ────────────────────────────────────────────────────────

    The BPMN hierarchy was the sidebar once and was removed on measurement — fifty-two rows of it
    made the nav taller than the viewport. The removal named where it belonged instead, "a page
    question, not a chrome question", and then nothing was built, so the model was correct research
    that no screen rendered.

    It is now the generic BPMN model of how a construction project is delivered (lib/process-
    library), not a map of this platform's modules. What is asserted is what makes it a model a
    reader can use: both ways in (phase and domain), every level reachable by a click that is its
    own URL, the detail each level promises, and nothing that links into a platform module.
  */
  await page.goto(`${BASE}/process`, { waitUntil: "networkidle0" });
  check("the process model has a page", (await page.$('[data-region="process-model"]')) !== null);

  const top = await page.evaluate(() => ({
    phases: document.querySelectorAll("[data-phase]").length,
    domains: document.querySelectorAll("[data-domain]").length,
    moduleLinks: [...document.querySelectorAll('[data-region="process-model"] a')].filter((a) =>
      /\/projects/.test(a.getAttribute("href") ?? ""),
    ).length,
  }));
  check("L0 offers all seven phases", top.phases === 7, `${top.phases}`);
  check("and all eight domains as the other way in", top.domains === 8, `${top.domains}`);
  check("and links to nothing in this platform's projects", top.moduleLinks === 0, `${top.moduleLinks}`);

  const drill = async (selector) => {
    await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click(selector)]);
    return { url: new URL(page.url()).search, text: await page.$eval('[data-region="process-model"]', (e) => e.innerText) };
  };

  const phase = await drill('[data-phase="1"]');
  check("a phase opens with its gate and PROCSA / FIDPM mapping", /Gate/.test(phase.text) && /FIDPM/.test(phase.text), phase.url);

  const areas = await drill('[data-domain="D1"]');
  check("a domain within the phase lists its process areas (L2)", (await page.$$("[data-area]")).length > 0, areas.url);

  const area = await drill('[data-area="D1.1"]');
  check("an area lists its sub-processes (L3)", (await page.$$("[data-sub-process]")).length > 0, area.url);

  const flow = await drill('[data-sub-process="D1.1-SP-001"]');
  check(
    "a sub-process draws its flow, trigger, outcome and decision",
    (await page.$('[data-region="bpmn-flow"]')) !== null && /Starts when/.test(flow.text) && /Decision/.test(flow.text),
    flow.url,
  );

  const task = await drill('[data-task="T01"]');
  check(
    "a task (L4) says who does it, with what, producing what",
    /Performed by/.test(task.text) && /Inputs/.test(task.text) && /Outputs/.test(task.text),
    task.url,
  );
  check("every level is its own URL", task.url.includes("sp=D1.1-SP-001") && task.url.includes("task=T01"), task.url);

  await page.goBack({ waitUntil: "networkidle0" });
  check("and Back goes up a level", new URL(page.url()).search === flow.url, new URL(page.url()).search);

  await page.goto(`${BASE}/process?q=final%20account`, { waitUntil: "networkidle0" });
  const hits = await page.$$eval('[data-region="process-search"] li', (e) => e.length);
  check("the model can be searched to any level", hits > 0, `${hits} matches`);

  // ── Sign out actually signs out ────────────────────────────────────────────────────────
  await page.click('button[aria-label="Account menu"]');
  await page.waitForSelector('[role="menu"]');
  await Promise.all([
    page.click('form button[type="submit"]'),
    page.waitForNavigation({ waitUntil: "networkidle0" }),
  ]);
  check("sign out lands on /login", page.url().includes("/login"), page.url());

  await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  check("and Home is protected again", page.url().includes("/login"), page.url());
} finally {
  await browser.close();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
