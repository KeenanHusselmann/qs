/**
 * Editing, archiving and deleting a project — PLATFORM.md §4.4.
 *
 * Archive and delete mean different things, so both are checked for what they actually do:
 * archiving leaves the working list but keeps the project reachable; deleting is soft, so nothing
 * that cited it becomes unresolvable.
 */
import puppeteer from "puppeteer";
import { createProject, readEnv } from "./helpers.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const env = readEnv();

let fails=0; const check=(l,ok,d="")=>{if(!ok)fails++;console.log(`  ${ok?"PASS":"FAIL"}  ${l}${d?"  — "+d:""}`);};
const b=await puppeteer.launch({headless:true}); const p=await b.newPage(); await p.setViewport({width:1440,height:900});
p.on("pageerror",e=>console.log("  [pageerror]",String(e).slice(0,220)));

const listText = async () => { await p.goto(`${BASE}/projects`,{waitUntil:"networkidle0"}); return p.$eval("main",e=>e.innerText); };

try {
  await p.goto(`${BASE}/login`,{waitUntil:"networkidle0"});
  await p.type("#email",env.DEV_USER_EMAIL); await p.type("#password",env.DEV_USER_PASSWORD);
  await Promise.all([p.click('button[type="submit"]'),p.waitForNavigation()]);

  const original = "Admin "+Date.now();
  const renamed = original + " (renamed)";

  await p.goto(`${BASE}/projects`,{waitUntil:"networkidle0"});
  const { href } = await createProject(p, original);
  await p.waitForFunction(`document.body.innerText.includes(${JSON.stringify(original)})`);

  // ── Edit ─────────────────────────────────────────────────────────────────────────────
  await p.goto(`${BASE}${href}/settings`,{waitUntil:"networkidle0"});
  check("the project details page opens", (await p.$eval("h1",e=>e.textContent)).includes("Project Details"));

  await p.$eval("#name", (el,v)=>{ el.value=v; }, renamed);
  await p.type("#code","ADM-01");
  await p.type("#client","Test Client Trust");
  await p.select("#status","in_contract");
  await p.click('form button[type="submit"]');
  await p.waitForFunction(`document.body.innerText.includes("Saved")`,{timeout:8000});
  check("edits save", true);

  let list = await listText();
  check("rename shows in the list", list.includes(renamed), list.split("\n").slice(0,4).join(" | "));
  check("client shows in the list", list.includes("Test Client Trust"));

  /*
    ── The stages a project runs ────────────────────────────────────────────────────────
    The overview has always carried a "Change" link to this page, and until now this page had no
    stages control — the link went somewhere that could not do what it offered. Every count on the
    overview is scoped to these, so getting them wrong misstates the size of the job.
  */
  await p.goto(`${BASE}${href}/settings`,{waitUntil:"networkidle0"});
  const boxes = await p.$$('input[name="stages"]');
  check("the stages a project runs can be changed here", boxes.length > 0, `${boxes.length} stages offered`);

  // A project nobody has narrowed runs every stage, so every box is ticked — not none.
  const allTicked = await p.$$eval('input[name="stages"]', els => els.every(e => e.checked));
  check("an unnarrowed project shows every stage ticked, not none", allTicked);

  // Narrow it to the first two.
  await p.$$eval('input[name="stages"]', els => els.forEach((e,i) => { if ((i < 2) !== e.checked) e.click(); }));
  await p.click('form button[type="submit"]');
  await p.waitForFunction(`document.body.innerText.includes("Saved")`,{timeout:8000});
  await p.goto(`${BASE}${href}/settings`,{waitUntil:"networkidle0"});
  const narrowed = await p.$$eval('input[name="stages"]', els => els.map(e => e.checked));
  check("narrowing the engagement sticks", narrowed[0] && narrowed[1] && !narrowed[2],
        narrowed.map(t => t ? "x" : "-").join(""));

  /*
    A step outside the engagement says so on its own page.

    The sidebar dims it and the board files it under a disclosure; the page used to say nothing at
    all, which made the one screen where the fact changes what somebody should do the one screen
    that withheld it.
  */
  await p.goto(`${BASE}${href}/tender-analysis`,{waitUntil:"networkidle0"});
  const notice = await p.$('[data-region="off-stage"]');
  check("an off-stage step says it is outside the engagement", notice !== null);
  if (notice) {
    const text = await notice.evaluate(el => el.innerText);
    // Named, not counted — "one stage" tells a reader nothing they can check.
    check("and names the stage it belongs to and the ones the project runs",
          /Procurement & Tender/.test(text) && /Feasibility & Inception/.test(text));
    check("and says it is set aside rather than blocked", /not blocked|set aside/i.test(text));
  }

  // Set aside, not blocked: whatever the run control does off-stage, it does the same in scope.
  const runState = () => p.evaluate(() => {
    const b = [...document.querySelectorAll("main button")].find(x => /run |draft /i.test(x.textContent ?? ""));
    return b ? `${b.textContent.trim()}:${b.disabled}` : "none";
  });
  const offStageRun = await runState();

  // One click widens the engagement from the step itself, which is where the correction is noticed.
  await p.evaluate(() => {
    [...document.querySelectorAll("button")]
      .find(b => /^Add .* to this project$/.test((b.textContent ?? "").trim()))?.click();
  });
  await p.waitForFunction('!document.querySelector(\'[data-region="off-stage"]\')',{timeout:15000}).catch(()=>{});
  check("adding the stage from the step clears the notice", (await p.$('[data-region="off-stage"]')) === null);
  check("and the run control was never the thing being gated", (await runState()) === offStageRun,
        `${offStageRun} either way`);

  // Put the engagement back so the archive and delete checks below see an ordinary project.
  await p.goto(`${BASE}${href}/settings`,{waitUntil:"networkidle0"});
  await p.$$eval('input[name="stages"]', els => els.forEach(e => { if (!e.checked) e.click(); }));
  await p.click('form button[type="submit"]');
  await p.waitForFunction(`document.body.innerText.includes("Saved")`,{timeout:8000});
  await p.goto(`${BASE}${href}/settings`,{waitUntil:"networkidle0"});
  check("ticking every stage reads back as running every stage",
        await p.$$eval('input[name="stages"]', els => els.every(e => e.checked)));

  // ── Archive ──────────────────────────────────────────────────────────────────────────
  await p.goto(`${BASE}${href}/settings`,{waitUntil:"networkidle0"});
  await p.click('form:has(button) button[type="submit"]:not([disabled])'); // save button; skip
  await p.goto(`${BASE}${href}/settings`,{waitUntil:"networkidle0"});
  /*
    Click by text, not by index into every button on the page. The index shifted when the shell
    gained controls and the suite started archiving nothing at all.

    And **wait for the control, then assert the click landed.** `?.click()` on a `find` that
    matched nothing archives nothing and says nothing, so the failure surfaced eight seconds later
    as "archived project leaves the working list" — which names the wrong thing entirely and sends
    a reader to look at archiving. `networkidle0` means the network is quiet, not that React has
    painted; under the load of a full gate run the page is reliably idle before the button exists.
    This is the same lesson the poll below already carries, one step earlier in the flow.
  */
  await p.waitForFunction(
    `[...document.querySelectorAll("button")].some(b => b.textContent.includes("Archive project"))`,
    { timeout: 10000 },
  );
  const archiveClicked = await p.$$eval("button", bs => {
    const button = bs.find(b => b.textContent.includes("Archive project"));
    button?.click();
    return Boolean(button);
  });
  check("the archive control is there to click", archiveClicked);
  /*
    Wait for the outcome, not for a button and a stopwatch.

    This waited for "Archive project" to leave the settings page — swallowing the timeout — then
    slept 800ms and read the list. On a busy machine the revalidation had not landed inside that
    window and the archived project was still listed, so the suite failed roughly one run in ten
    on a product that was working. Polling the list itself asserts the same thing and cannot be
    beaten by a slow render: it either leaves within eight seconds or it genuinely did not go.
  */
  const deadline = Date.now() + 8000;
  do {
    list = await listText();
    if (!list.includes(renamed)) break;
    await new Promise(r=>setTimeout(r,250));
  } while (Date.now() < deadline);

  check("archived project leaves the working list", !list.includes(renamed), list.split("\n").slice(0,4).join(" | "));

  await p.goto(`${BASE}${href}/settings`,{waitUntil:"networkidle0"});
  check("but is still reachable and readable", (await p.$eval("main",e=>e.innerText)).includes(renamed));
  check("and says it is archived", (await p.$eval("main",e=>e.innerText)).includes("out of the working list"));
  check("on every page of the project, not only its details",
        await p.$eval('[data-region="archived-banner"]', e => e.innerText.includes("Archived")).catch(() => false));

  /*
    Round-1 testing: "I can't search for the project either. No trace." Typing its exact name into
    the Projects filter has to find it, labelled, and the archived section has to open by itself.
  */
  await p.goto(`${BASE}/projects`,{waitUntil:"networkidle0"});
  await p.type('[data-region="project-filter"]', renamed);
  await p.waitForFunction(() => document.querySelector('[data-region="archived"]')?.open === true, { timeout: 5000 }).catch(()=>{});
  const found = await p.$eval('[data-region="archived"]', e => ({ open: e.open, text: e.innerText })).catch(() => null);
  check("the filter finds an archived project by its exact name", Boolean(found?.open && found.text.includes(renamed)), JSON.stringify(found)?.slice(0,160));
  check("and labels it Archived", Boolean(found?.text.match(/Archived[\s\S]*Archived/)));
  check("and says why the working list is empty",
        await p.$eval('[data-region="project-filter-empty"]', e => e.innerText.includes("archived")).catch(() => false));
  await p.goto(`${BASE}${href}/settings`,{waitUntil:"networkidle0"});

  // Restore.
  const restoreIdx = await p.$$eval("button", bs => bs.findIndex(b=>b.textContent.includes("Restore project")));
  await (await p.$$("button"))[restoreIdx].click();
  // Wait for the control to become its opposite, not for 1200ms. The fixed sleep was long enough
  // when this suite ran alone and not under a full `npm run check`, so this was the one assertion
  // that failed on load — and a gate that goes red for reasons unrelated to the change is a gate
  // people learn to re-run rather than read.
  await p.waitForFunction(
    () => document.body.innerText.includes("Archive project"),
    { timeout: 15000 },
  ).catch(()=>{});
  list = await listText();
  check("restoring brings it back", list.includes(renamed));

  // ── Delete ───────────────────────────────────────────────────────────────────────────
  await p.goto(`${BASE}${href}/settings`,{waitUntil:"networkidle0"});
  const deleteIdx = await p.$$eval("button", bs => bs.findIndex(b=>b.textContent.includes("Delete project")));
  const deleteDisabled = await p.$$eval("button", bs => bs.find(b=>b.textContent.includes("Delete project"))?.disabled);
  check("delete is refused until the name is typed", deleteDisabled === true);

  await p.type("#confirm", renamed);
  await new Promise(r=>setTimeout(r,200));
  await (await p.$$("button"))[deleteIdx].click();
  await p.waitForFunction(`location.pathname === "/projects"`,{timeout:10000});
  check("deleting returns to the list", true);

  list = await p.$eval("main",e=>e.innerText);
  check("deleted project is gone from the list", !list.includes(renamed));
} finally { await b.close(); }

console.log(fails===0?"\nAll checks passed.":`\n${fails} failed.`); process.exit(fails?1:0);
