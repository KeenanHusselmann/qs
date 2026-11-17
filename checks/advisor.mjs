/**
 * Drives the project advisor — PLATFORM.md §1.3, §1.3.1.
 *
 * ── What is worth driving a browser for ────────────────────────────────────────────────────
 *
 * The figure guard and the next-step choice are unit-tested (`advisor.test.ts`), deterministically
 * and for free. What only a browser can answer is whether the whole path holds: the panel opens,
 * the route computes a brief from this project's real records, and what comes back describes the
 * job the page beside it is showing.
 *
 * This one suite spends money — one model call, a fraction of a cent — because a mocked advisor
 * would prove the mock works. It is the only check in the set that does, and the cost is printed
 * so nobody has to wonder.
 *
 * ── And it asserts the rule end to end ─────────────────────────────────────────────────────
 *
 * No digit reaches the advice. The unit test proves `readAdvice` drops one; this proves nothing
 * downstream puts one back — that the guard is on the path the panel actually renders, not on a
 * function nothing calls.
 */

import puppeteer from "puppeteer";

import { createProject, readEnv, signIn } from "./helpers.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const env = readEnv();

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 200)));

try {
  await signIn(page, env, BASE);
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });

  const name = `Advisor ${Date.now()}`;
  const { href } = await createProject(page, name, BASE, 1);
  await page.goto(`${BASE}${href}`, { waitUntil: "networkidle0" });

  // ── Open on a project's front page, where a reader arriving most wants it ─────────────────
  await page.waitForSelector('[data-region="advisor"]', { timeout: 5000 }).catch(() => {});
  check("the advisor is open on the project overview", (await page.$('[data-region="advisor"]')) !== null);

  // Closing it is a preference, and it follows the reader to the next screen.
  await page.click('[data-region="advisor"] button[aria-label="Close the advisor"]');
  await page.waitForSelector('[data-region="advisor-tab"]', { timeout: 4000 });
  await page.goto(`${BASE}${href}/feasibility`, { waitUntil: "networkidle0" });
  check(
    "closed, it stays a tab on the next screen",
    (await page.$('[data-region="advisor"]')) === null && (await page.$('[data-region="advisor-tab"]')) !== null,
  );
  await page.click('[data-region="advisor-tab"]');
  await page.waitForSelector('[data-region="advisor"]', { timeout: 5000 });
  check("and opens on a click", true);

  // ── The job card: where the job is, computed, on the overview and not in the chat ─────────
  // A tester: "if you don't tap next step after each phase, it won't track". The position is read
  // on the server for every visit, at no model cost, and the advisor is left for questions.
  check("the advisor holds no job status of its own", (await page.$('[data-region="advisor-brief"]')) === null);

  await page.goto(`${BASE}${href}`, { waitUntil: "networkidle0" });
  const card = await page.evaluate(() => {
    const el = document.querySelector('[data-region="project-agent"]');
    return {
      title: el?.querySelector("h2")?.textContent?.trim() ?? "",
      status: el?.querySelector('[data-region="job-counts"]')?.textContent?.replace(/\s+/g, " ") ?? "",
      next: el?.querySelector('[data-region="next-step"]')?.textContent?.trim() ?? "",
      open: [...(el?.querySelectorAll('[data-region="chain"] [data-stage][data-selected="true"]') ?? [])].map((d) => d.dataset.stage),
      closed: el?.querySelectorAll('[data-region="chain"] [data-stage][data-selected="false"]').length ?? 0,
    };
  });
  check("the overview carries a job card", card.title === "Job card", card.title);
  check("naming the stage the work is in", /Feasibility & Inception/.test(card.status), card.status.slice(0, 90));
  check("with the next step as a link", /^Open /.test(card.next), card.next);
  // Titles only on arrival: a phase opens when it is clicked, and folds again on a second click.
  check("every phase starts folded, as its title", card.open.length === 0 && card.closed > 0, `open ${card.open.join(",")}, ${card.closed} folded`);

  await page.click('[data-region="project-agent"] [data-stage="1"] button');
  const opened = await page.$eval('[data-region="project-agent"] [data-phase="1"]', (el) => !el.hidden);
  await page.click('[data-region="project-agent"] [data-stage="1"] button');
  const folded = await page.$eval('[data-region="project-agent"] [data-phase="1"]', (el) => el.hidden);
  check("a phase opens on a click and folds on the next", opened && folded);

  await page.click('[data-action="agent-plan"]');
  await page.waitForFunction(
    () => document.querySelector('[data-region="agent-plan"] [data-region="advisor-advice"], [data-region="agent-plan"] [role="alert"]'),
    { timeout: 60000 },
  );

  // ── The plan, or a stated outage. Never a silence ───────────────────────────────────────
  const advice = await page.$('[data-region="advisor-advice"]');
  const unavailable = await page.$('[data-region="agent-plan"] [role="alert"]');
  check("it either plans or says why it cannot", Boolean(advice) !== Boolean(unavailable));

  if (advice) {
    const text = await page.$eval('[data-region="advisor-advice"]', (el) => el.innerText);
    // The plan is a table now: one row per action, the action and its reason in one cell, the
    // step, the owner role, the due suggestion and the priority beside it.
    const actions = await page.$$eval('[data-region="plan-table"] [data-cell="action"]', (cells) =>
      cells.map((c) => c.innerText.replace(/\s+/g, " ").trim()),
    );
    const rows = await page.$$eval('[data-region="plan-table"] tbody tr', (trs) =>
      trs.map((tr) => ({ step: tr.querySelector("a")?.textContent?.trim() ?? null })),
    );

    check("it gives a short table of actions, not an essay", actions.length >= 1 && actions.length <= 6, `${actions.length} actions`);
    check("and at least one row links to the step it is done on", rows.some((r) => r.step), rows.map((r) => r.step).join(", "));
    check(
      "the plan is about the step the chain chose",
      /project inputs|mandate|brief|appointment/i.test(text),
      actions[0]?.slice(0, 80),
    );

    /*
      The rule, on the path the card actually renders.

      Every figure in this platform traces to a document and a signature. One that first appeared in
      the agent traces to nothing and would be read as though it did – and it would be wearing the
      platform's own voice while doing it.
    */
    // A reference to a standard ("JBCC PBA clause 31", "SANS 10400-XA") is not a figure – the same
    // allowance `statesFigure` in `src/lib/agent/advisor.ts` makes, kept in step with it by hand.
    const CITATION = /\b(?:JBCC|SANS|NEC\d?|ASAQS|FIDIC|PROCSA|SACQSP|ISO|clauses?|cl\.|regulations?|sections?|edition)\s*(?:[A-Z]{1,4}\s*)?\d[\dA-Za-z.()\-/]*(?:\s*(?:and|to|or|,)\s*\d[\dA-Za-z.()\-/]*)*/gi;
    const withDigits = actions.filter((a) => /\d/.test(a.replace(CITATION, "")));
    check(
      "and states no figure anywhere in it",
      withDigits.length === 0,
      withDigits[0]?.slice(0, 90) ?? "",
    );

    check(
      "it says out loud that it is not a source of figures",
      /not on figures|no number in this platform/i.test(text),
    );
    check("and what the plan cost is on screen", /R\s?0\./.test(text), text.replace(/\s+/g, " ").trim().slice(-80));

    await page.goto(`${BASE}${href}`, { waitUntil: "networkidle0" });
  } else {
    const said = await page.$eval('[data-region="agent-plan"] [role="alert"]', (el) => el.innerText);
    // §1.3 – an outage is surfaced with the provider's own words, never dressed as an empty answer.
    check("the outage is stated in words", said.length > 40, said.replace(/\s+/g, " ").slice(0, 100));
    check("and the computed status is still on screen beside it", card.status.length > 0);
  }

  // ── It is pinned, or a reader four screens down is looking at an empty column ───────────
  await page.evaluate(() => document.querySelector("main")?.scrollTo(0, 99999));
  await new Promise((r) => setTimeout(r, 300));
  const box = await page.$eval('[data-region="advisor"]', (el) => {
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), height: Math.round(r.height) };
  });
  check(
    "the panel stays in view when the page is scrolled",
    box.top >= 0 && box.top < 200 && box.height > 400,
    `top ${box.top}px, ${box.height}px tall`,
  );

  /*
    ── Asking it a question ──────────────────────────────────────────────────────────────

    The box and its two channels, without spending a model call: the suite asserts the surface
    exists and is guarded, and `src/lib/agent/ask.test.ts` asserts what comes back. A browser
    check that fired a real question would put the gate at the mercy of a third party and cost a
    fraction of a cent every run.
  */
  check(
    "the advisor takes a typed question",
    (await page.$('[data-region="advisor-ask"] textarea')) !== null,
  );

  const emptyDisabled = await page
    .$eval('[data-action="ask-question"]', (b) => b.disabled)
    .catch(() => null);
  // An empty question is a model call that buys nothing, so the control refuses it.
  check("and refuses an empty one", emptyDisabled === true);

  await page.type('[data-region="advisor-ask"] textarea', "where is the unit count stated");
  check(
    "and offers it once something is typed",
    (await page.$eval('[data-action="ask-question"]', (b) => b.disabled)) === false,
  );

  // Cleared before the panel closes, so the next assertion is not typing into a stale box.
  // Cleared the way a person clears it; React ignores a value set behind its back.
  await page.click('[data-region="advisor-ask"] textarea', { clickCount: 3 });
  await page.keyboard.down("Control");
  await page.keyboard.press("a");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.click('[data-region="advisor"] button[aria-label="Close the advisor"]');
  await page.waitForFunction(
    () => document.querySelector('[data-region="advisor"]') === null,
    { timeout: 4000 },
  );
  check("and it closes back to the tab", (await page.$('[data-region="advisor-tab"]')) !== null);
  /*
    ── The onboarding guide, on the path page ────────────────────────────────────────────

    Same treatment as the project advisor: the surface and its guard are asserted here, and what
    comes back is asserted in `src/lib/agent/onboarding.test.ts`. A browser check that fired a
    real question would put the gate at the mercy of a third party and cost money every run.
  */
  await page.goto(`${BASE}/start`, { waitUntil: "networkidle0" });

  check("the path page offers a guide", (await page.$('[data-region="guide"]')) !== null);

  // A blank box is not an invitation. Somebody who does not know what the platform knows will
  // type nothing, so the questions people actually arrive with are offered.
  const suggestions = await page.$$eval('[data-region="guide-suggestions"] button', (bs) =>
    bs.map((b) => b.textContent?.trim() ?? ""),
  );
  check("and suggests what to ask", suggestions.length >= 3, suggestions[0]);

  check(
    "and refuses an empty question",
    (await page.$eval('[data-action="ask-guide"]', (b) => b.disabled)) === true,
  );

  await page.type('[data-region="guide"] textarea', "what do I file first");
  check(
    "and offers it once something is typed",
    (await page.$eval('[data-action="ask-guide"]', (b) => b.disabled)) === false,
  );
} finally {
  await browser.close();
}

console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} failed.`);
process.exit(fails ? 1 : 0);
