/**
 * Drives the ingest pipeline — upload a real file, and check the citation it produces.
 *
 * The point is not "a document uploaded". It is that a criterion moves to satisfied *and can show
 * the passage that satisfied it* (§1.3.2), and that a document filed as the right kind but
 * containing nothing relevant is reported as uncertain rather than counted as evidence.
 */
import puppeteer from "puppeteer";
import { createProject, fileAgainst, readEnv } from "./helpers.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const FIXTURES = process.env.FIXTURES ?? "./fixtures";

const env = readEnv();

let fails=0; const check=(l,ok,d="")=>{if(!ok)fails++;console.log(`  ${ok?"PASS":"FAIL"}  ${l}${d?"  — "+d:""}`);};

const b=await puppeteer.launch({headless:true}); const p=await b.newPage(); await p.setViewport({width:1440,height:900});
p.on("pageerror",e=>console.log("  [pageerror]",String(e).slice(0,300)));

try {
  await p.goto(`${BASE}/login`,{waitUntil:"networkidle0"});
  await p.type("#email",env.DEV_USER_EMAIL); await p.type("#password",env.DEV_USER_PASSWORD);
  await Promise.all([p.click('button[type="submit"]'),p.waitForNavigation()]);

  const name="Ingest "+Date.now();
  await p.goto(`${BASE}/projects`,{waitUntil:"networkidle0"});
  const { href } = await createProject(p, name);
  await p.waitForFunction(`document.body.innerText.includes(${JSON.stringify(name)})`);
  await p.goto(`${BASE}${href}/feasibility`,{waitUntil:"networkidle0"});

  // File a brief whose text genuinely covers the criterion.
  await fileAgainst(p, "Project brief and concept parameters", `${FIXTURES}/brief.txt`);
  await p.waitForFunction(`document.body.innerText.includes("brief.txt")`,{timeout:15000});

  let txt=await p.$eval("main",e=>e.innerText);
  check("document is filed", txt.includes("brief.txt"));
  check("no 'not searchable' warning for readable text", !txt.includes("not searchable"), txt.match(/not searchable[^\n]*/)?.[0] ?? "");
  check("blocking count dropped", /[012] required still needed/i.test(txt) || /Ready to start/i.test(txt), txt.match(/[0-9]+ required still needed|Ready to start/)?.[0]);

  // The citation must quote the document, not restate the filing.
  const filed = txt.slice(txt.toLowerCase().indexOf("filed"));
  check("citation quotes the document", /“|"/.test(filed) && /1 046|GAP|absorption|Erf 180/i.test(filed),
        filed.split("\n").slice(0,6).join(" | ").slice(0,180));

  // A document of the right kind whose text is irrelevant must read as uncertain, not satisfied.
  await fileAgainst(p, "Project programme", `${FIXTURES}/costplan.txt`);
  await p.waitForFunction(`document.body.innerText.includes("costplan.txt")`,{timeout:15000});
  txt=await p.$eval("main",e=>e.innerText);
  check("irrelevant-but-right-kind reads as uncertain",
        /no passage in it matches/i.test(txt), txt.match(/no passage[^\n]*/)?.[0] ?? "not reported");

  // A priced workbook is a document, not an attachment. Until it could be read, the one file a QS
  // most wants quoted filed, opened, and grounded nothing.
  await fileAgainst(p, "Services layout and bulk contributions", `${FIXTURES}/cost-estimate.xlsx`);
  await p.waitForFunction(`document.body.innerText.includes("cost-estimate.xlsx")`,{timeout:20000});
  txt=await p.$eval("main",e=>e.innerText);

  const services = txt.slice(txt.indexOf("Services layout"));
  check("the workbook is filed", txt.includes("cost-estimate.xlsx"));
  check("and its cells are quoted back", /bulk infrastructure cost estimate/i.test(services),
        services.split("\n").slice(0,6).join(" | ").slice(0,180));
  // The fixture's hidden column holds a superseded total. Nothing a QS cannot see in their own
  // workbook may reach the corpus, because a citation they cannot check is not evidence.
  check("a hidden column's superseded figures stayed out", !txt.includes("99999999") && !txt.includes("SUPERSEDED"));

  await p.reload({waitUntil:"networkidle0"});
  check("survives reload", (await p.$eval("main",e=>e.innerText)).includes("brief.txt"));
} finally { await b.close(); }

console.log(fails===0?"\nAll checks passed.":`\n${fails} failed.`); process.exit(fails?1:0);
