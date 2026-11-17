/**
 * Asking the advisor about an attached document – against the real model. **Not in `npm run check`**:
 * it spends credits.
 *
 *     node checks/advisor-attach-live.mjs
 *     HEADLESS=0 node checks/advisor-attach-live.mjs      (watch it)
 *
 * A contract's particulars, long enough that one answer cannot read all of it, with the facts a QS
 * asks for spread through it – the sum and retention at the start, the contractor's name in the
 * middle, the penalty for late completion near the end. The advisor is asked for each: the figures
 * must come back as the document writes them, a follow-up must still read the document without it
 * being attached again, and the answer must say how much of the document it read.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import puppeteer from "puppeteer";

import { createProject, readEnv, signIn } from "./helpers.mjs";

const env = readEnv();
const BASE = "http://localhost:3000";
const headless = process.env.HEADLESS !== "0";

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

// ── The document ───────────────────────────────────────────────────────────────────────────
const general = (n) =>
  `Clause ${n}. General condition ${n}. The contractor shall comply with the requirements of the principal building agreement in respect of this clause, ` +
  `including the provision of information, attendance at site meetings, keeping of records and notices to the principal agent. `.repeat(6);
const clauses = [];
for (let n = 1; n <= 60; n++) {
  if (n === 3) clauses.push("Clause 3. Contract sum. The contract sum is R 12 450 000,00 (twelve million four hundred and fifty thousand rand) excluding VAT.");
  else if (n === 4) clauses.push("Clause 4. Retention. Retention of 5% shall be deducted from each payment certificate, limited to 5% of the contract sum.");
  else if (n === 22) clauses.push("Clause 22. Parties. The contractor is Umhlanga Construction (Pty) Ltd, registration 2011/004512/07. The employer is Marshall Dam Estates.");
  else if (n === 51) clauses.push("Clause 51. Penalties. A penalty of R 7 500,00 per calendar day shall apply for each day by which practical completion is late.");
  else clauses.push(general(n));
}
const file = path.join(os.tmpdir(), "Contract particulars – Marshall Dam.txt");
fs.writeFileSync(file, `CONTRACT PARTICULARS – MARSHALL DAM BOUNDARY WALL\n\n${clauses.join("\n\n")}\n`);
console.log(`  document: ${Math.round(fs.statSync(file).size / 1000)} kB, 60 clauses`);

const browser = await puppeteer.launch(headless ? { headless: true } : { headless: false, defaultViewport: null, args: ["--window-size=1440,960"] });
const page = await browser.newPage();
if (headless) await page.setViewport({ width: 1440, height: 1000 });
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));

/** The answer's own words – not the quoted passages under it, which carry the document's text anyway. */
const said = (reply) => reply.split(/SOURCES/)[0];

async function ask(question, attach = null) {
  const before = await page.$$eval('[data-region="advisor-thread"] > li[data-exchange]', (l) => l.length).catch(() => 0);
  if (attach) {
    const input = await page.$('[data-region="advisor-ask"] input[type=file]');
    await input.uploadFile(attach);
    await page.waitForSelector('[data-region="advisor-ask-attachments"]', { timeout: 5000 });
  }
  await page.type('[data-region="advisor-ask"] textarea', question);
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    (n) => {
      const items = document.querySelectorAll('[data-region="advisor-thread"] > li[data-exchange]');
      if (items.length <= n) return false;
      const last = items[items.length - 1];
      return !/Reading|Thinking/.test(last.innerText.split("\n").slice(-2).join(" ")) && last.innerText.split("\n").length > 2;
    },
    { timeout: 180000 },
    before,
  );
  await new Promise((r) => setTimeout(r, 800));
  const last = await page.$$eval('[data-region="advisor-thread"] > li[data-exchange]', (l) => l.at(-1).innerText.replace(/ /g, " "));
  return last;
}

try {
  await signIn(page, env);
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
  const { href } = await createProject(page, "Advisor attachment " + Date.now(), BASE, 2);
  await page.goto(`${BASE}${href}`, { waitUntil: "networkidle0" });
  if (!(await page.$('[data-region="advisor-ask"]'))) {
    await page.click('[data-region="advisor-tab"]');
    await page.waitForSelector('[data-region="advisor-ask"]', { timeout: 5000 });
  }

  if (process.env.ONLY_DRAWING !== "1") {
  const one = await ask("What is the contract sum and the retention?", file);
  console.log("\n" + one.split("\n").map((l) => "    | " + l).join("\n").slice(0, 1400) + "\n");
  check("it states the contract sum as the document writes it", /R ?12 450 000,00/.test(said(one)), said(one).slice(0, 200));
  check("and the retention", /5 ?%/.test(said(one)));
  check("it says how much of the document it read", /Read (all of|\d+ of the \d+ parts of) Contract particulars/.test(one), one.match(/Read [^.]*\./)?.[0]);
  check("and quotes the passage it came from", /SOURCES[\s\S]*Clause 3/.test(one));
  check("it does not dwell on how much it read when it found the answer", !/in front of me/.test(said(one)));

  const held = await page.$('[data-region="advisor-held"] [data-held]');
  check("the document stays in the conversation", Boolean(held));

  const two = await ask("Who is the contractor?");
  console.log("\n" + two.split("\n").map((l) => "    | " + l).join("\n").slice(0, 900) + "\n");
  check("a follow-up still reads the document without attaching it again – and says the name", /Umhlanga Construction/.test(said(two)), said(two).slice(0, 160));

  const three = await ask("What is the penalty for late completion?");
  console.log("\n" + three.split("\n").map((l) => "    | " + l).join("\n").slice(0, 900) + "\n");
  check("a clause deep in a long document is found", /R ?7 500,00/.test(said(three)) && /(per|a) (calendar )?day/i.test(said(three)));
  check("and no figure the document does not write", !/R ?14 317 500|622 500/.test(one + two + three));

  await page.click('[data-region="advisor-held"] button[aria-label^="Stop reading"]');
  check("removing it stops it being read", !(await page.$('[data-region="advisor-held"]')));
  }

  // ── A large drawing set, where one is given ─────────────────────────────────────────────
  const drawing = process.argv[2];
  if (drawing && fs.existsSync(drawing)) {
    const mb = (fs.statSync(drawing).size / 1024 / 1024).toFixed(1);
    const four = await ask("What is the standard wall height, and the total perimeter distance of the boundary wall?", drawing);
    console.log(`\n  (${mb} MB drawing set)\n` + four.split("\n").map((l) => "    | " + l).join("\n").slice(0, 1200) + "\n");
    check(`a ${mb} MB drawing set is read`, !/limited to|could not be read/i.test(four), said(four).slice(0, 160));
    check("and its figures come back as the drawing writes them", /2 ?500 ?mm/i.test(said(four)) && /491[.,]05/.test(said(four)), said(four).slice(0, 240));
  }
} finally {
  await browser.close();
}

console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} failed.`);
process.exit(fails ? 1 : 0);
