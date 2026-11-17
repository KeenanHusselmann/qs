/**
 * Withdrawing a document.
 *
 * The behaviour that matters is not that a row disappears from a list — it is that the criterion
 * it satisfied stops being satisfied. Soft delete preserves history; it must not keep a retracted
 * figure in circulation.
 */
import puppeteer from "puppeteer";
import { createProject, fileAgainst, readEnv } from "./helpers.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const FIXTURES = process.env.FIXTURES ?? "./fixtures";
const env = readEnv();

let fails=0; const check=(l,ok,d="")=>{if(!ok)fails++;console.log(`  ${ok?"PASS":"FAIL"}  ${l}${d?"  — "+d:""}`);};
const b=await puppeteer.launch({headless:true}); const p=await b.newPage(); await p.setViewport({width:1440,height:900});
p.on("pageerror",e=>console.log("  [pageerror]",String(e).slice(0,200)));

try {
  await p.goto(`${BASE}/login`,{waitUntil:"networkidle0"});
  await p.type("#email",env.DEV_USER_EMAIL); await p.type("#password",env.DEV_USER_PASSWORD);
  await Promise.all([p.click('button[type="submit"]'),p.waitForNavigation()]);

  const name="Withdraw "+Date.now();
  await p.goto(`${BASE}/projects`,{waitUntil:"networkidle0"});
  const { href } = await createProject(p, name);
  await p.waitForFunction(`document.body.innerText.includes(${JSON.stringify(name)})`);
  await p.goto(`${BASE}${href}/feasibility`,{waitUntil:"networkidle0"});

  const blockedCount = () => p.$eval("main", e => (e.innerText.match(/(\d+) required still needed/i)?.[1]) ?? "none");
  check("starts blocked on 3", (await blockedCount()) === "3", await blockedCount());

  await fileAgainst(p, "Project brief and concept parameters", `${FIXTURES}/brief.txt`);
  await p.waitForFunction(`document.body.innerText.includes("brief.txt")`,{timeout:15000});
  // 3 → 2, not 3 → 1. The brief used to clear *Market data* as well, because grounding accepted a
  // passage from any document and the brief carries a market paragraph. A criterion is now satisfied
  // only by a document of a kind it accepts, and a brief filed as a brief is not a market study.
  check("filing reduces the blocking count", (await blockedCount()) === "2", await blockedCount());

  const cited = (await p.$eval("main",e=>e.innerText)).includes("MONAGHAN FARM");
  check("the criterion cites the document", cited);

  // Withdraw it.
  await p.click('button[aria-label="Withdraw brief.txt"]');
  await p.waitForFunction(`!document.body.innerText.includes("brief.txt")`,{timeout:10000});
  check("withdrawn document leaves the list", true);

  check("and the criterion is blocking again", (await blockedCount()) === "3", await blockedCount());
  check("its passage is no longer cited", !(await p.$eval("main",e=>e.innerText)).includes("MONAGHAN FARM"));
} finally { await b.close(); }

console.log(fails===0?"\nAll checks passed.":`\n${fails} failed.`); process.exit(fails?1:0);
