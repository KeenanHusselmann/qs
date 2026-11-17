#!/usr/bin/env node
/**
 * Put a project's RFQ together from documents already in its corpus.
 *
 *     node scripts/set-up-rfq.mjs --manifest <manifest.json> [--base https://…] [--ask] [--evaluate]
 *
 * ── Why it does not upload anything ────────────────────────────────────────────────────────
 *
 * Because the responses are already filed. A project's corpus is meant to be the one place every
 * step reads from, and a step that makes you file a document a second time has quietly stopped
 * believing that — it also leaves the reader with two copies of a proposal and no way to tell
 * which one an evaluation read. So this picks from what is filed, and refuses where a response
 * named in the manifest is not in the corpus rather than uploading it behind your back.
 *
 * ── The scope is the client's, not this script's ───────────────────────────────────────────
 *
 * `rfq.scope` and `rfq.requirements` come out of the manifest, which takes them from the scope
 * document the responses were answering. That matters more than it looks: every "included /
 * excluded / not stated" and every "met / not met" in the evaluation is judged against these
 * lines, so a scope invented here would produce a page of confident findings about a request
 * nobody made. The first version of this evaluation ran on three scope items somebody typed from
 * memory, and read one proposal as covering a third of the work when the client's memorandum had
 * asked for something else entirely.
 *
 * Evaluating spends model credits, so it only happens with `--evaluate`.
 */

import { readFileSync } from "node:fs";

import puppeteer from "puppeteer";

import { identityFor, signInOrExplain } from "./lib/sign-in.mjs";

const arg = (name, fallback = null) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};


const BASE = arg("base", "http://localhost:3000").replace(/\/$/, "");
const BYPASS = arg("bypass", process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? null);
const ASK = process.argv.includes("--ask");
const EVALUATE = process.argv.includes("--evaluate");
const manifestPath = arg("manifest");
if (!manifestPath) {
  console.error("Which project? Pass --manifest <file.json>.");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const rfq = manifest.rfq;
if (!rfq) {
  console.error(`${manifestPath} has no "rfq" block, so there is nothing to set up.`);
  process.exit(1);
}

console.log(`"${rfq.title}"`);
console.log(`  ${rfq.scope.length} scope items, ${rfq.requirements.length} requirements, ${rfq.responses.length} responses`);
for (const r of rfq.responses) {
  console.log(`    ${r.supplier ?? "?"} — ${r.document}${r.supporting?.length ? ` (+${r.supporting.length} supporting)` : ""}`);
}

const identity = await identityFor(BASE, { ask: ASK });

const browser = await puppeteer.launch({ headless: process.env.HEADLESS !== "0", defaultViewport: { width: 1500, height: 1100 } });
const page = await browser.newPage();
page.setDefaultTimeout(180_000);
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 160)));
if (BYPASS) await page.setExtraHTTPHeaders({ "x-vercel-protection-bypass": BYPASS, "x-vercel-set-bypass-cookie": "true" });

const setField = (selector, value) =>
  page.$eval(
    selector,
    (el, v) => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    value,
  );

try {
  await signInOrExplain(page, identity, BASE);

  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
  const href = await page.evaluate((name) => {
    const link = [...document.querySelectorAll('a[href^="/projects/"]')].find((a) => a.textContent?.includes(name));
    const found = link?.getAttribute("href") ?? "";
    return /^\/projects\/[0-9a-f-]{36}$/.test(found) ? found : "";
  }, manifest.project.name);
  if (!href) throw new Error(`No project called "${manifest.project.name}". File its corpus first.`);

  await page.goto(`${BASE}${href}/rfq`, { waitUntil: "networkidle0" });

  // ── The RFQ itself ──────────────────────────────────────────────────────────────────────
  const exists = await page.$("[data-rfq]");
  if (exists) console.log(`\nAn RFQ is already on this project; adding to it.`);
  else {
    const start = await page.$('[data-action="new-rfq"]');
    if (start) await start.click();
    await page.waitForSelector('input[name="title"]');
    await setField('input[name="title"]', rfq.title);
    await setField('textarea[name="scope"]', rfq.scope.join("\n"));
    const requirements = await page.$('textarea[name="requirements"]');
    if (requirements) await setField('textarea[name="requirements"]', rfq.requirements.join("\n"));
    await page.click('[data-action="save-rfq"]');
    await page.waitForSelector("[data-rfq]");
    console.log(`\nRFQ created.`);
  }

  // ── The responses, from the corpus ──────────────────────────────────────────────────────
  for (const response of rfq.responses) {
    const added = await page.evaluate((name) => {
      /*
        The response picker, by its own label - not "any select that offers this name".

        The loose version matched the *supporting* picker too, which offers every filed document.
        On a second run the responses were already taken, so the loose matcher found each fee
        proposal in a supporting list and attached three competing firms' proposals to one
        another. The page has two pickers; a script has to say which one it means.
      */
      const select = document.querySelector('select[aria-label="Add a response already filed"]');
      if (!select || ![...select.options].some((o) => o.textContent?.trim() === name)) return "not offered";
      const option = [...select.options].find((o) => o.textContent?.trim() === name);
      const native = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
      native.call(select, option.value);
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return "added";
    }, response.document);

    if (added === "added") {
      await page.waitForFunction((n) => document.body.innerText.includes(n.replace(/\.[a-z0-9]+$/i, "")), { timeout: 60_000 }, response.document);
      console.log(`  response: ${response.supplier ?? response.document}`);
    } else {
      const already = await page.evaluate((n) => document.body.innerText.includes(n.replace(/\.[a-z0-9]+$/i, "")), response.document);
      console.log(`  ${already ? "already on the RFQ" : "NOT IN THE CORPUS"}: ${response.document}`);
    }
    await new Promise((r) => setTimeout(r, 1_000));

    /*
      The rest of the submission, attached to that response.

      Picked from the corpus for the same reason the response was: a firm's technical proposal
      arrived with its fee proposal and was filed with it, and uploading it again would leave two
      copies with nothing to say which one the evaluation read. Attached rather than filed as a
      response of its own, because a submission split into three would be ranked against parts of
      itself - two of them priceless.
    */
    /*
      Wait for the row before reaching into it.

      A fixed pause after adding the response was enough on a laptop and not on production, where
      the round trip is slower: the attach step looked for a row the page had not rendered yet,
      reported "no such response" for both of MUTEC's papers, and carried on to evaluate a
      submission missing the half that carries its registrations. A sleep that is long enough today
      is a sleep that is too short on a bad connection.
    */
    if ((response.supporting ?? []).length > 0) {
      const rowName = response.document.replace(/\.[a-z0-9]+$/i, "");
      await page
        .waitForFunction(
          (name) => [...document.querySelectorAll("[data-response]")].some((li) => li.getAttribute("data-response")?.includes(name)),
          { timeout: 60_000, polling: 250 },
          rowName,
        )
        .catch(() => console.log(`      (the row for ${rowName} never appeared – its supporting papers are not attached)`));
    }

    for (const paper of response.supporting ?? []) {
      const attached = await page.evaluate(
        (responseName, paperName) => {
          const row = [...document.querySelectorAll("[data-response]")].find((li) => li.getAttribute("data-response")?.includes(responseName));
          const select = row?.querySelector('[data-action="attach-filed"]');
          const option = select && [...select.options].find((o) => o.textContent?.trim() === paperName);
          if (!option) return row ? "not offered" : "no such response";
          const native = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
          native.call(select, option.value);
          select.dispatchEvent(new Event("change", { bubbles: true }));
          return "attached";
        },
        // The row is keyed by the response's *name*, which before evaluation is its document's
        // filename without the extension - not the supplier, which nothing has read yet.
        response.document.replace(/\.[a-z0-9]+$/i, ""),
        paper,
      );
      console.log(`      supporting: ${paper} — ${attached}`);
      await new Promise((r) => setTimeout(r, 1_500));
    }
  }

  console.log(`\n${BASE}${href}/rfq`);
  if (EVALUATE) {
    console.log("Evaluating – this reads every response in full and spends credits.");
    /*
      Wait for the button to be ready, rather than assuming it is.

      It is disabled while the page is mid-transition, and a click on a disabled button does
      nothing at all - silently. The first production run clicked into that gap, waited fifteen
      minutes for a recommendation that was never going to come, and left all three responses
      reading "not evaluated". This project has met the same bug before, in `checks/rfq.mjs`,
      where the note beside the fix says waiting for the condition rather than for a longer
      timeout is the difference between a fix and a plaster.
    */
    await page.waitForFunction(() => document.querySelector('[data-action="evaluate-all"]')?.disabled === false, { timeout: 120_000 });
    await page.click('[data-action="evaluate-all"]');

    /*
      No guard on "did it start".

      There was one, keyed on the "Reading and checking …" line, and it was wrong. That line is set
      inside a `useTransition`, so it is a low-priority update that in practice never painted at
      all on production — the guard therefore fired on every run, including the ones that were
      working, and aborted them. A check that cannot tell a working run from a broken one is worse
      than no check: it reported a failure that had not happened, and stopped one that had not
      either.

      What a stalled run actually looks like is the wait below timing out, which it already
      reports. The real silence — a function that dies mid-action and returns nothing — is not
      visible from the page at all, and was only ever going to be found in the server's log.
    */

    await page.waitForSelector('[data-region="rfq-recommendation"]', { timeout: 900_000 });
    await page.waitForFunction(() => !/Reading and checking/.test(document.body.innerText), { timeout: 900_000 });
    console.log("Evaluated.");
  } else {
    console.log("Not evaluated – pass --evaluate to read and check the responses.");
  }
  await browser.close();
} catch (error) {
  console.error(`\nStopped: ${error instanceof Error ? error.message : String(error)}`);
  await browser.close();
  process.exit(1);
}
