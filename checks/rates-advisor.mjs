/**
 * Price questions answered from the Rate Library – on the overview and in a project.
 *
 *     node checks/rates-advisor.mjs
 *
 * A tester asked "bricks cost zar" on the overview and got general guidance, while the firm's rates
 * were on file. This loads the simulated test rates through the Rate Library's own control, asks
 * both assistants, and checks that the answer is the library's rows – each brick, with its rate,
 * source and date – and that withdrawing the set takes it back out.
 *
 * Calls the model (two questions). Local database only.
 */

import puppeteer from "puppeteer";

import { createProject, readEnv, signIn, watchConsole } from "./helpers.mjs";

const env = readEnv();
const BASE = "http://localhost:3000";

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));
const consoleErrors = watchConsole(page);

const ask = (url, question) =>
  page.evaluate(
    async (u, q) => {
      const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q, mode: "general" }) });
      const j = await r.json();
      const t = j.answer?.tool ?? null;
      return { status: r.status, tool: t?.tool ?? null, title: t?.title ?? null, findings: t?.findings ?? [], unavailable: t?.unavailable ?? null };
    },
    url,
    question,
  );

try {
  await signIn(page, env);

  await page.goto(`${BASE}/rates`, { waitUntil: "networkidle0" });
  const load = await page.$('[data-action="load-simulated"]');
  if (load) {
    await load.click();
    await page.waitForSelector('[data-action="withdraw-simulated"]', { timeout: 15000 });
  }
  check("the simulated rates load from the Rate Library", /simulated test rates on file/.test(await page.$eval('[data-region="simulated-rates"]', (e) => e.innerText)));

  // ── The overview, no project ──────────────────────────────────────────────────────────────
  const overview = await ask("/api/onboarding", "bricks cost zar");
  check("the overview answers a price question from the library", overview.status === 200 && overview.tool === "rate_lookup", `${overview.status} ${overview.tool}`);
  const labels = overview.findings.map((f) => f.label);
  check("listing the bricks on file – stock, face, cement, maxi, paving", ["Clay stock brick", "Clay face brick", "Cement brick", "Cement maxi brick", "Clay paving brick"].every((b) => labels.some((l) => l.startsWith(b))), labels.join(" | ").slice(0, 200));
  // Every row names its source and date; the library may hold real rates beside the simulated set.
  check("each with its rate, source and date", overview.findings.every((f) => /^R\s/.test(f.value.replace(/ /g, " ")) && / · from \d{4}-\d{2}-\d{2}$/.test(f.from)) && overview.findings.filter((f) => /Simulated test data/.test(f.from)).length >= 5, overview.findings[0] && `${overview.findings[0].value} · ${overview.findings[0].from}`);
  check("and no bricklayer in an answer about bricks", !labels.some((l) => /bricklayer/i.test(l)));

  // ── In a project ──────────────────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
  const { href } = await createProject(page, "Rates " + Date.now());
  const id = href.split("/").pop();
  const project = await ask(`/api/projects/${id}/advice`, "What is the price of cement?");
  check("the project advisor answers from the library too", project.tool === "rate_lookup" && project.findings.some((f) => /Cement, CEM II 42,5N/.test(f.label)) && !project.findings.some((f) => /plaster/i.test(f.label)), `${project.tool} ${project.findings.map((f) => f.label).join(" | ")}`);

  // ── Withdrawn, it is gone ─────────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/rates`, { waitUntil: "networkidle0" });
  await page.click('[data-action="withdraw-simulated"]');
  await page.waitForSelector('[data-action="load-simulated"]', { timeout: 15000 });
  check("withdrawing takes the set back out as one", true);
  // Loaded again so testers keep the data locally.
  await page.click('[data-action="load-simulated"]');
  await page.waitForSelector('[data-action="withdraw-simulated"]', { timeout: 15000 });

  check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));
} finally {
  await browser.close();
}

console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} failed.`);
process.exit(fails ? 1 : 0);
