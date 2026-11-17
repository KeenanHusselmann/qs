/**
 * One corpus, read by every module.
 *
 * A document filed through the project corpus must appear as evidence on whichever step needs it, without
 * being filed again. That is the whole reason import exists — otherwise a QS drops forty files and
 * then re-uploads the title deed on Site & zoning because the page still says it is missing.
 *
 * The chain under test: import files a document as a kind -> the kind satisfies a criterion ->
 * the criterion belongs to a module -> that module's page shows it. It crosses three screens and
 * two tables, which is exactly the kind of link that quietly breaks.
 */

import { readFileSync } from "node:fs";
import puppeteer from "puppeteer";
import { createProject, readEnv } from "./helpers.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const env = readEnv();

let fails = 0;
const check = (l, ok, d = "") => { if (!ok) fails++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`); };

const b = await puppeteer.launch({ headless: true });
const p = await b.newPage();
await p.setViewport({ width: 1500, height: 900 });

try {
  await p.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
  await p.type("#email", env.DEV_USER_EMAIL);
  await p.type("#password", env.DEV_USER_PASSWORD);
  await Promise.all([p.click('button[type="submit"]'), p.waitForNavigation()]);

  await p.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
  const { href } = await createProject(p, `Corpus ${Date.now()}`);

  // ── File two documents through import, for two different modules ────────────────────────
  await p.goto(`${BASE}${href}/corpus`, { waitUntil: "networkidle0" });

  const text = readFileSync("./fixtures/brief.txt", "utf8");
  await p.evaluate((body) => {
    const paths = [
      "SUBMISSION/ANNEXURE B - COPY OF TITLE DEED/deed.txt",   // -> Site & zoning
      "SUBMISSION/ANNEXURE A - POWER OF ATTORNEY/poa.txt",     // -> Project inputs
    ];
    const dt = new DataTransfer();
    for (const path of paths) {
      const f = new File([body], path.split("/").pop(), { type: "text/plain" });
      Object.defineProperty(f, "webkitRelativePath", { value: path });
      dt.items.add(f);
    }
    const input = document.querySelector('input[type="file"]');
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, text);

  await p.waitForFunction(() => document.body.innerText.includes("Title deed"), { timeout: 8000 });
  check("import places them under the step that needs them",
    (await p.$eval("main", (e) => e.innerText)).includes("Site & Zoning"));

  await p.$$eval("button", (bs) => bs.find((x) => /^File \d+ document/.test(x.textContent))?.click());
  // Wait for *both*, not for the first — /\d+ filed/ matches "1 filed" and races the second upload.
  await p.waitForFunction(() => /2 filed/.test(document.body.innerText), { timeout: 30000 });
  check("both file into the corpus", true);

  // ── Now the modules, which were never visited during the upload ──────────────────────────
  await p.goto(`${BASE}${href}/site`, { waitUntil: "networkidle0" });
  const site = await p.$eval("main", (e) => e.innerText);
  check("Site & zoning sees the title deed without re-filing", site.includes("deed.txt"), site.match(/deed[^\n]*/)?.[0]);
  /*
    Two right answers, depending on whether coverage has been read yet: while the requirement is
    still unresolved the deed's line carries the Uploaded badge; once the deed is read as covering
    it, the row says it is filed and offers another (readiness-list.tsx). Either way the page shows
    the document as filed – what would be wrong is neither.
  */
  check("and shows that document line as filed", /Uploaded|Filed . add another/.test(site), site.match(/(Uploaded|Filed[^\n]*)/)?.[0]);

  await p.goto(`${BASE}${href}/inputs`, { waitUntil: "networkidle0" });
  const inputs = await p.$eval("main", (e) => e.innerText);
  check("Project inputs sees the power of attorney", inputs.includes("poa.txt"), inputs.match(/poa[^\n]*/)?.[0]);

  // Each module sees only its own. One corpus, scoped reads (§1.3.2).
  check("and does not show another module's document", !inputs.includes("deed.txt"));

  await p.goto(`${BASE}${href}`, { waitUntil: "networkidle0" });
  const overview = await p.$eval("main", (e) => e.innerText);
  check("the overview counts both", /2\b/.test(overview.match(/DOCUMENTS FILED\s*\n?\s*(\d+)/i)?.[1] ?? overview));
} finally {
  await b.close();
}

console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} check(s) failed.`);
process.exit(fails ? 1 : 0);
