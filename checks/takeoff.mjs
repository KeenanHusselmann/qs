/**
 * Take-off – dimension sheets sent to the bill (D1.2).
 *
 *     node checks/takeoff.mjs
 *
 * ── What this proves ───────────────────────────────────────────────────────────────────────
 *
 * That an item measured line by line totals exactly (timesing × dimensions, deductions taken
 * away); that a dimension the reader cannot settle is refused in words; that a line missing a
 * dimension for its unit blocks sending; and that sending writes the measured total into the
 * linked bill row as a 'takeoff' quantity – or adds a row – which the bill grid then marks
 * "measured".
 */

import { config } from "dotenv";
import postgres from "postgres";
import puppeteer from "puppeteer";

import { createProject, fileAgainst, readEnv, signIn, watchConsole } from "./helpers.mjs";

config({ path: ".env.local", quiet: true });
const env = readEnv();
const BASE = "http://localhost:3000";

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const sql = postgres(env.DATABASE_URL, { max: 1 });
const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1200 });
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));
const consoleErrors = watchConsole(page);

/** Poll until `read` returns something truthy, or give up after `ms` and return what it last said. */
async function until(read, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value || Date.now() > end) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

const text = (selector) => page.$eval(selector, (e) => e.innerText.replace(/ /g, " "));

async function addLine(item, values) {
  const at = `[data-takeoff="${item}"] [data-region="new-line"]`;
  if (values.location) await page.type(`${at} input[aria-label="Where"]`, values.location);
  // Replace, not append: a refused line keeps what was typed, so the next one types over it.
  for (const k of ["timesing", "length", "width", "depth"]) {
    const input = await page.$(`${at} input[data-dim="${k}"]`);
    if (!input) continue;
    await input.click();
    await input.evaluate((el) => el.select());
    await page.keyboard.press("Backspace");
    if (values[k]) await input.type(values[k]);
  }
  if (values.deduct) await page.click(`${at} input[data-dim="deduct"]`);
  const before = await page.$$eval(`[data-takeoff="${item}"] tr[data-line]`, (r) => r.length);
  await page.click(`[data-takeoff="${item}"] [data-action="add-line"]`);
  if (values.expectRefusal) {
    await page.waitForFunction((s, n) => document.querySelector(s)?.innerText.includes(n), { timeout: 10000 }, `[data-takeoff="${item}"] [data-region="new-line"]`, values.expectRefusal);
    return;
  }
  await page.waitForFunction((s, n) => document.querySelectorAll(s).length === n + 1, { timeout: 10000 }, `[data-takeoff="${item}"] tr[data-line]`, before);
}

try {
  await signIn(page, env);
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
  const { href } = await createProject(page, "Take-off " + Date.now(), BASE, 2);
  const projectId = href.split("/").pop();

  // A draft bill with one item to feed.
  const [run] = await sql`insert into runs (project_id, module, status, input_tokens, output_tokens, created_by) values (${projectId}, '/bill', 'review', 0, 0, ${env.DEV_USER_EMAIL}) returning id`;
  const [row] = await sql`insert into run_items (run_id, seq, row_type, proposed_description, proposed_unit, proposed_rate, proposed_rate_precision, proposed_confidence)
                          values (${run.id}, 100, 'item', 'One-brick wall in stock brick', 'm2', 38500, 2, 0.9) returning id`;

  await page.goto(`${BASE}${href}/take-off`, { waitUntil: "networkidle0" });
  check("Take-off is a working page", Boolean(await page.$('[data-region="add-takeoff-item"]')));

  // ── Measure an area ───────────────────────────────────────────────────────────────────────
  await page.type('[data-region="add-takeoff-item"] input[name="description"]', "One-brick wall in stock brick, Block A");
  await page.click('[data-action="add-takeoff-item"]');
  await page.waitForSelector('[data-takeoff="1"]', { timeout: 15000 });

  await addLine(1, { location: "Grid 1–4", timesing: "3", length: "4,20", width: "2,70" });
  await addLine(1, { location: "Door D1", length: "0,90", width: "2,10", deduct: true });
  const total = await text('[data-takeoff="1"] [data-region="takeoff-total"]');
  check("three walls less a door is 32,13 m²", total === "32,13 m²", total);

  await addLine(1, { length: "1,250", width: "2,70", expectRefusal: "thousand" });
  const refusal = await text('[data-takeoff="1"] [data-region="new-line"]');
  check("a dimension of 1,250 is refused rather than guessed", /thousand/.test(refusal), refusal.match(/"1,250"[^.]*/)?.[0]);
  check("and the total did not move", (await text('[data-takeoff="1"] [data-region="takeoff-total"]')) === "32,13 m²");

  // ── Send to the linked row ────────────────────────────────────────────────────────────────
  await page.select(`[data-takeoff="1"] [data-region="link-bill"]`, row.id);
  await page.waitForFunction(() => document.querySelector('[data-takeoff="1"]')?.innerText.includes("bill 1"), { timeout: 10000 });
  await page.click('[data-takeoff="1"] [data-action="send-to-bill"]');
  await page.waitForFunction(() => document.querySelector('[data-takeoff="1"]')?.innerText.includes("sent 32,13"), { timeout: 15000 });
  const [sent] = await sql`select override_quantity, quantity_source, amount from run_items where id = ${row.id}`;
  check("the measured total lands in the bill row", sent.override_quantity === "32.1300", sent.override_quantity);
  check("recorded as a take-off quantity, not typed", sent.quantity_source === "takeoff", sent.quantity_source);
  check("and the database extends it at the row's rate", String(sent.amount) === String(Math.round(32.13 * 38500)), String(sent.amount));
  check("the sheet says the bill carries it, measured", /bill 1: 32,13 m² · measured/.test(await text('[data-takeoff="1"]')));

  // A later line puts the bill behind the sheet, and says so.
  await addLine(1, { location: "Grid 5", length: "3,00", width: "2,70" });
  check("a line added after sending shows the bill behind the sheet", /behind the sheet/.test(await text('[data-takeoff="1"]')));

  // ── A volume missing a dimension cannot be sent ───────────────────────────────────────────
  await page.type('[data-region="add-takeoff-item"] input[name="description"]', "Strip footings, 25 MPa");
  await page.select('[data-region="add-takeoff-item"] select[name="unit"]', "m3");
  await page.click('[data-action="add-takeoff-item"]');
  await page.waitForSelector('[data-takeoff="2"]', { timeout: 15000 });
  await addLine(2, { length: "12,00", width: "0,60", expectRefusal: "Required" });
  const wrong = await page.$eval('[data-takeoff="2"]', (e) => e.innerText);
  check("two dimensions on a volume are refused at entry", /Required/.test(wrong));
  await page.type('[data-takeoff="2"] [data-region="new-line"] input[data-dim="depth"]', "0,30");
  await page.click('[data-takeoff="2"] [data-action="add-line"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-takeoff="2"] tr[data-line]').length === 1, { timeout: 10000 });
  check("with its depth it measures 2,16 m³", (await text('[data-takeoff="2"] [data-region="takeoff-total"]')) === "2,16 m³");

  // ── Sent unlinked, it adds a row ──────────────────────────────────────────────────────────
  await page.click('[data-takeoff="2"] [data-action="send-to-bill"]');
  await page.waitForFunction(() => document.querySelector('[data-takeoff="2"]')?.innerText.includes("sent 2,16"), { timeout: 15000 });
  const added = await sql`select override_description, override_unit, override_quantity, quantity_source from run_items where run_id = ${run.id} and id <> ${row.id}`;
  check("an unlinked item adds a bill row, described and measured", added.length === 1 && added[0].override_description === "Strip footings, 25 MPa" && added[0].override_quantity === "2.1600" && added[0].quantity_source === "takeoff", JSON.stringify(added[0]));

  // ── The bill grid says which quantities were measured ─────────────────────────────────────
  await page.goto(`${BASE}${href}/bill`, { waitUntil: "networkidle0" });
  const measuredRows = await page.$$eval("tr[data-row]", (trs) => trs.filter((tr) => tr.innerText.includes("measured")).length);
  check("the bill marks both rows measured", measuredRows === 2, String(measuredRows));

  /*
    ── What a quantity surveyor would ask before anybody priced it ──────────────────────────

    The boundary-wall review found R476 000 of work that was never measured: blinding, the
    reinforcement, the pier footings, the lintels. Every figure in that bill added up, which is
    exactly why arithmetic could not catch it. This is the rubric that does.
  */
  await page.goto(`${BASE}${href}/take-off`, { waitUntil: "networkidle0" });
  check("the take-off says what is missing before it is priced", Boolean(await page.$('[data-region="takeoff-review"]')));
  const review = await text('[data-region="takeoff-review"]');
  check("it asks for the blinding and the reinforcement under a footing", /no blinding under it/i.test(review) && /no reinforcement/i.test(review), review.split("\n").slice(1, 3).join(" / "));
  check("and for what walling carries – the DPC and the movement joints", /damp-proof course is measured/i.test(review) && /movement joints/i.test(review));
  check("the ones that change the price come first", (await page.$eval('[data-region="takeoff-review"] li[data-severity]', (li) => li.getAttribute("data-severity"))) === "high");
  check("and it says they are questions, not corrections", /questions, not corrections/i.test(review));

  // ── The take-off goes out to compare offline (November meeting) ───────────────────────────
  check("the take-off offers a workbook and a PDF", Boolean(await page.$('[data-region="takeoff-export"] a[href$="document=takeoff"]')) && Boolean(await page.$('[data-region="takeoff-export"] a[href$="format=pdf"]')));
  const exported = await page.evaluate(async (path) => {
    const read = async (url) => {
      const r = await fetch(url);
      const bytes = new Uint8Array(await r.arrayBuffer());
      return { status: r.status, type: r.headers.get("content-type"), name: r.headers.get("content-disposition"), head: String.fromCharCode(...bytes.slice(0, 5)), size: bytes.length };
    };
    return { xlsx: await read(`${path}/report/pdf?document=takeoff`), pdf: await read(`${path}/report/pdf?document=takeoff&format=pdf`) };
  }, href);
  check("the workbook downloads as a spreadsheet, named for the project", exported.xlsx.status === 200 && /spreadsheetml/.test(exported.xlsx.type ?? "") && exported.xlsx.head.startsWith("PK") && /_Take-off\.xlsx/.test(exported.xlsx.name ?? ""), `${exported.xlsx.status} ${exported.xlsx.type} ${exported.xlsx.size} bytes`);
  check("and the dimension sheet as a PDF", exported.pdf.status === 200 && exported.pdf.head === "%PDF-" && /_Take-off\.pdf/.test(exported.pdf.name ?? ""), `${exported.pdf.status} ${exported.pdf.size} bytes`);

  // ── A signed bill takes nothing ───────────────────────────────────────────────────────────
  await sql`update runs set signed_by = ${env.DEV_USER_EMAIL}, signed_at = now() where id = ${run.id}`;
  await page.goto(`${BASE}${href}/take-off`, { waitUntil: "networkidle0" });
  check("with the bill signed, sending is disabled and says why", (await page.$eval('[data-takeoff="1"] [data-action="send-to-bill"]', (b) => b.disabled)) && /The bill is signed/.test(await page.$eval("main", (e) => e.innerText)));

  /*
    ── No bill yet: measuring is how a bill starts (audit C1) ────────────────────────────────

    Everything above seeds a bill first, which is how the dead end got past this suite: on a new
    project Take-off said "sending creates its rows", the send was refused, and the bill page would
    not open a bill without a filed specification.
  */
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
  const first = await createProject(page, "Take-off first send " + Date.now(), BASE, 2);
  const firstId = first.href.split("/").pop();
  await page.goto(`${BASE}${first.href}/take-off`, { waitUntil: "networkidle0" });
  await page.type('[data-region="add-takeoff-item"] input[name="section"]', "Masonry");
  for (const [n, description, length] of [[1, "Half-brick wall, Block B", "5,00"], [2, "Half-brick wall, Block C", "4,00"]]) {
    await page.type('[data-region="add-takeoff-item"] input[name="description"]', description);
    await page.click('[data-action="add-takeoff-item"]');
    await page.waitForSelector(`[data-takeoff="${n}"]`, { timeout: 15000 });
    await addLine(n, { length, width: "2,70" });
    await page.click(`[data-takeoff="${n}"] [data-action="send-to-bill"]`);
    await page.waitForFunction((s) => document.querySelector(s)?.innerText.includes("sent "), { timeout: 15000 }, `[data-takeoff="${n}"]`);
  }

  const opened = await sql`select id, status, input_tokens from runs where project_id = ${firstId} and module = '/bill' and deleted_at is null`;
  check("the first send opens the bill – one draft, in review, nothing spent", opened.length === 1 && opened[0].status === "review" && opened[0].input_tokens === null, JSON.stringify(opened));
  const firstRows = await sql`select id, parent_id, row_type, override_description, override_quantity, quantity_source from run_items where run_id = ${opened[0]?.id ?? null} order by seq`;
  const headings = firstRows.filter((r) => r.row_type === "heading");
  const walls = firstRows.filter((r) => r.row_type === "item");
  check("both items land under one Masonry section", headings.length === 1 && headings[0].override_description === "Masonry" && walls.length === 2 && walls.every((w) => w.parent_id === headings[0].id), JSON.stringify(firstRows.map((r) => [r.row_type, r.override_description])));
  check("measured, 13,50 m² and 10,80 m²", walls[0]?.override_quantity === "13.5000" && walls[1]?.override_quantity === "10.8000" && walls.every((w) => w.quantity_source === "takeoff"), walls.map((w) => w.override_quantity).join(", "));

  // ── The bill page opens a bill by hand, with nothing filed ───────────────────────────────
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
  const byHand = await createProject(page, "Bill by hand " + Date.now(), BASE, 2);
  const byHandId = byHand.href.split("/").pop();
  await page.goto(`${BASE}${byHand.href}/bill`, { waitUntil: "networkidle0" });
  check("with nothing filed, the bill can still be started by hand", Boolean(await page.$('[data-action="start-bill"]')));
  await page.click('[data-action="start-bill"]');
  await page.waitForSelector('[data-action="add-item"]', { timeout: 15000 });
  check("once started, the button gives way to the bill", !(await page.$('[data-action="start-bill"]')));
  await page.click('[data-action="add-item"]');

  // The server's rows, not the screen's: a suite waits on what only the server can produce.
  const handRows = await until(async () => {
    const rows = await sql`select ri.id, ri.parent_id, ri.row_type, ri.quantity_source from run_items ri join runs r on r.id = ri.run_id where r.project_id = ${byHandId} order by ri.seq`;
    return rows.length >= 2 ? rows : null;
  });
  check("it opens with a section, and an item added sits under it", handRows?.length === 2 && handRows[0].row_type === "heading" && handRows[1].row_type === "item" && handRows[1].parent_id === handRows[0].id && handRows[1].quantity_source === "manual", JSON.stringify(handRows));

  /*
    ── Measuring on the drawing ───────────────────────────────────────────────────────────────

    The invented Ridgeview site plan, filed as a drawing, opened beside the sheets. At 1:100 a line
    72 PDF points long is 2,54 m on site; on a wall item in m² with a 3,00 m height that is 7,62 m².
    The figure is the server's, worked from the clicked points – the browser only sends the points.
  */
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
  const studio = await createProject(page, "Take-off studio " + Date.now());
  const studioId = studio.href.split("/").pop();
  await page.goto(`${BASE}${studio.href}/feasibility`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-region="readiness"]', { timeout: 30000 });
  await fileAgainst(page, "Concept layouts", "./fixtures/ridgeview/Site development plan.pdf");
  await page.waitForFunction(() => document.body.innerText.includes("Site development plan.pdf"), { timeout: 30000 });

  await page.goto(`${BASE}${studio.href}/take-off`, { waitUntil: "networkidle0" });
  await page.type('[data-region="add-takeoff-item"] input[name="description"]', "Boundary wall, 230 mm brick");
  await page.click('[data-action="add-takeoff-item"]');
  await page.waitForSelector('[data-takeoff="1"]', { timeout: 15000 });
  check("with a PDF drawing filed, Take-off offers to measure on it", Boolean(await page.$('[data-action="toggle-studio"]')));
  await page.click('[data-action="toggle-studio"]');
  await page.waitForSelector('[data-region="studio-canvas"]', { timeout: 30000 });
  check("the drawing renders beside the sheets", true);

  await page.click('[data-action="set-scale"]');
  await page.waitForFunction(() => /1:100\b/.test(document.querySelector('[data-region="studio-scale"]')?.textContent ?? ""), { timeout: 5000 });
  const box = await (await page.$('[data-region="studio-canvas"]')).boundingBox();
  await page.mouse.click(box.x + 100, box.y + 100);
  await page.mouse.click(box.x + 172, box.y + 100);
  await page.keyboard.press("Enter");
  await page.waitForSelector('[data-action="save-mark"]', { timeout: 5000 });
  const figure = await page.$eval('[data-region="studio-status"]', (e) => e.textContent ?? "");
  check("a 72-point line at 1:100 reads 2,54 m before it is added", /2,54\s*m/.test(figure.replace(/ /g, " ")), figure.slice(0, 60));
  await page.type('[aria-label="Height or width"]', "3");
  await page.click('[data-action="save-mark"]');

  const markedLine = await until(async () => {
    const [row] = await sql`select d.length, d.width, d.working, d.mark from takeoff_dimensions d join takeoff_items i on i.id = d.item_id where i.project_id = ${studioId}`;
    return row ?? null;
  });
  check("the mark becomes a dimension line, measured by the server", markedLine?.length === "2.5400" && markedLine?.width === "3.0000", JSON.stringify({ length: markedLine?.length, width: markedLine?.width }));
  check("and the line keeps the mark it came from", markedLine?.mark?.kind === "length" && markedLine?.mark?.page === 1 && markedLine?.mark?.points?.length === 2, JSON.stringify(markedLine?.mark ?? null).slice(0, 120));
  await page.waitForFunction(() => document.querySelector('[data-takeoff="1"] [data-region="takeoff-total"]')?.textContent?.includes("7,62"), { timeout: 15000 });
  check("the sheet totals it: 2,54 × 3,00 = 7,62 m²", true);
  check("and the line can be shown on the drawing again", Boolean(await page.$('[data-takeoff="1"] [data-action="show-mark"]')));

  check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));
} finally {
  await browser.close();
  await sql.end();
}

console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} failed.`);
process.exit(fails ? 1 : 0);
