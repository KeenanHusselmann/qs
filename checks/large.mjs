/**
 * Filing real client documents — the sizes that broke the server-action version.
 *
 * Uses documents from the confidential corpus by path; skipped when they are not present, since
 * they are not in version control and never will be.
 */
import { existsSync, statSync } from "node:fs";
import puppeteer from "puppeteer";
import { createProject, fileAgainst, readEnv } from "./helpers.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const env = readEnv();

const CANDIDATES = [
  [process.env.BIG_PDF, "Market study"],
  [process.env.DRAWING, "Concept drawings"],
].filter(([p]) => p && existsSync(p));

if (CANDIDATES.length === 0) { console.log("  (no large fixtures available — skipped)"); process.exit(0); }

let fails=0; const check=(l,ok,d="")=>{if(!ok)fails++;console.log(`  ${ok?"PASS":"FAIL"}  ${l}${d?"  — "+d:""}`);};
const mb = p => (statSync(p).size/1048576).toFixed(1)+" MB";

const b=await puppeteer.launch({headless:true}); const p=await b.newPage(); await p.setViewport({width:1440,height:900});
p.on("pageerror",e=>console.log("  [pageerror]",String(e).slice(0,200)));
try {
  await p.goto(`${BASE}/login`,{waitUntil:"networkidle0"});
  await p.type("#email",env.DEV_USER_EMAIL); await p.type("#password",env.DEV_USER_PASSWORD);
  await Promise.all([p.click('button[type="submit"]'),p.waitForNavigation()]);

  const name="Large "+Date.now();
  await p.goto(`${BASE}/projects`,{waitUntil:"networkidle0"});
  const { href } = await createProject(p, name);
  await p.waitForFunction(`document.body.innerText.includes(${JSON.stringify(name)})`);
  await p.goto(`${BASE}${href}/feasibility`,{waitUntil:"networkidle0"});

  for (const [path] of CANDIDATES) {
    const base = path.split(/[\/]/).pop();
    await fileAgainst(p, "Project brief and concept parameters", path);
    await p.waitForFunction(
      `document.body.innerText.includes(${JSON.stringify(base.slice(0,24))}) || document.body.innerText.includes("did not reach") || document.body.innerText.includes("limit is") || document.body.innerText.includes("refused the file")`,
      { timeout: 120000 });
    const txt = await p.$eval("main", e=>e.innerText);
    check(`filed ${base.slice(0,34)} (${mb(path)})`, txt.includes(base.slice(0,24)),
          txt.match(/(did not reach|limit is|exceeded)[^\n]*/)?.[0] ?? "");
  }

  const txt = await p.$eval("main", e=>e.innerText);
  check("no 1 MB body error anywhere", !/exceeded 1 MB/i.test(txt));
  // A CAD plot has no text layer — it must be filed and reported, not silently empty.
  if (process.env.DRAWING) {
    check("CAD plot reported as not searchable", /not searchable/i.test(txt),
          txt.match(/not searchable[^\n]*/)?.[0] ?? "no warning shown");
  }
} finally { await b.close(); }
console.log(fails===0?"\nAll checks passed.":`\n${fails} failed.`); process.exit(fails?1:0);
