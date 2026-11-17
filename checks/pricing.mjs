/**
 * Pricing — PLATFORM.md §4.8, §5.1, §5.2, §6.3, §7.2.
 *
 *     npm run check:pricing
 *
 * ── What this proves ───────────────────────────────────────────────────────────────────────
 *
 * That §4.8's two demands actually work on a real bill, in a browser, against the database:
 *
 *   · **bulk application** — one rate typed once and written to a selection, and a percentage
 *     moved across one, with the rows that had no rate to move **named rather than zeroed**
 *   · **a rate build-up behind a row** — components, waste, markup, the plug, and the rate it
 *     produces arriving on the row with the amount recomputed by the trigger
 *
 * And the parts that are quiet when they go wrong: that `rate_source` records how each figure got
 * there, that a refused figure is written nowhere, and that a signed bill offers none of it.
 *
 * ── Why the bill is seeded ─────────────────────────────────────────────────────────────────
 *
 * The same reason `checks/bill.mjs` seeds one: a real draft costs DeepSeek credits and `npm run
 * check` runs many times a day. §1.3's "no seed data" rule is about a project's figures being
 * invented for a *user*; fixtures for a test are fixtures.
 *
 * ── The arithmetic is checked against a hand calculation, not against the code ──────────────
 *
 * The build-up below is the worked example in `money.ts`: 0,35 t of cement at R2 400,00, 0,7 m³ of
 * sand at R180,00, 2,5 hours at R85,00, plus 5% waste and 12% markup, which a QS adding the column
 * gets to R1 385,92. That figure is written here as a literal. If the platform ever disagrees with
 * it, the platform is wrong.
 */

import { config } from "dotenv";
import postgres from "postgres";
import puppeteer from "puppeteer";

import { createProject, signIn, watchConsole, readEnv } from "./helpers.mjs";

config({ path: ".env.local", quiet: true });
const env = readEnv();

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const BASE = "http://localhost:3000";
const PRICING = "/pricing";

const sql = postgres(env.DATABASE_URL, { max: 1 });

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1400 });
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));
const consoleErrors = watchConsole(page);

/** Money groups thousands with a **non-breaking** space (§7.7). Every assertion has to fold it. */
const plain = (text) => text.replace(/ /g, " ");

/**
 * Type into a cell, replacing whatever was in it.
 *
 * **Select-all by keystroke, not by triple-click**, and the reason is a defect this suite found:
 * §7.7 groups thousands with a non-breaking space, Chrome's line selection will not cross one, and
 * a triple-click on a cell holding `1 500,00` selected `2-2 of 8` — nothing at all. Typing then
 * spliced rather than replaced, and `11 900,00500,00` was read as R119 000 050 000,00 and written
 * to the bill.
 *
 * Both halves of that are fixed in the product — the cell selects on focus, and `separatorsOf`
 * refuses a grouping that is not one — and this stays a keystroke because a suite should drive the
 * value it means to drive rather than depend on a browser's word-boundary rules.
 */
const typeInto = async (selector, text) => {
  await page.waitForFunction(
    (s) => {
      const el = document.querySelector(s);
      return Boolean(el) && !el.disabled;
    },
    { timeout: 10000, polling: 100 },
    selector,
  );
  await page.click(selector);
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.type(selector, text);
};

/**
 * Wait for a build-up's saves to land.
 *
 * The working underneath the editor is computed from the **local draft**, so it shows the right
 * rate the instant somebody stops typing and long before the server has been told. Asserting
 * against the database at that moment reads a build-up two components old — which is what this
 * suite did on its first run, and the screen said "Saving..." in the very detail line that passed.
 * So the signal is the row's own amount, which only the extension trigger can produce.
 */
const settled = async (rowId, amount) => {
  await page.waitForFunction(
    (id, expected) => {
      const row = document.querySelector(`tr[data-row="${id}"]`);
      const working = document.querySelector('[data-region="build-up-total"]');
      return (
        Boolean(row) &&
        row.textContent.replace(/ /g, " ").includes(expected) &&
        !(working?.textContent ?? "").includes("Saving")
      );
    },
    { timeout: 25000, polling: 200 },
    rowId,
    amount,
  );
};

/** Click once the control is there and not disabled — see `typeInto` above for why. */
const clickWhenEnabled = async (selector) => {
  await page.waitForFunction(
    (s) => {
      const el = document.querySelector(s);
      return Boolean(el) && !el.disabled;
    },
    { timeout: 10000, polling: 100 },
    selector,
  );
  await page.click(selector);
};

const rowsOf = (runId) =>
  sql`select id, proposed_description, override_rate, override_rate_precision, rate_source,
             quantity_source, amount, override_by
        from run_items where run_id = ${runId} and row_type = 'item' order by seq`;

try {
  await signIn(page, env);

  const name = "Pricing " + Date.now();
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
  const { href } = await createProject(page, name);
  const projectId = href.split("/").pop();

  // ── The empty state, because §7.5 says every list gets one ──────────────────────────────
  await page.goto(`${BASE}${href}${PRICING}`, { waitUntil: "networkidle0" });

  const empty = await page.evaluate(() => {
    const region = document.querySelector('[data-region="pricing-empty"]');
    return {
      present: Boolean(region),
      text: region?.textContent ?? "",
      link: region?.querySelector("a")?.getAttribute("href") ?? null,
    };
  });

  check("pricing has a page of its own", empty.present);
  check("which says what would fill it", /no bill to price yet/i.test(empty.text));
  check(
    "and links to the screen that would",
    empty.link?.endsWith("/bill") === true,
    empty.link ?? "no link",
  );

  // ── A drafted bill, as the route would have left it ─────────────────────────────────────
  const [run] = await sql`
    insert into runs (project_id, module, status, created_by)
    values (${projectId}, '/bill', 'review', ${env.DEV_USER_EMAIL})
    returning id`;

  const [section] = await sql`
    insert into run_items (run_id, seq, row_type, proposed_description)
    values (${run.id}, 100, 'heading', 'Substructure')
    returning id`;

  // Three items: one the documents priced, two they did not — which is the ordinary shape of a
  // bill drafted from a specification, and the reason this screen exists.
  const seeded = [
    { description: "25 MPa concrete in strip footings", unit: "m3", quantity: "1250.0000", rate: 185000n },
    { description: "230mm brickwork in cement mortar", unit: "m2", quantity: "864.0000", rate: null },
    { description: "Surface beds 100mm thick", unit: "m2", quantity: "420.0000", rate: null },
  ];

  const items = [];
  for (const [index, item] of seeded.entries()) {
    const [inserted] = await sql`
      insert into run_items (run_id, seq, parent_id, row_type, proposed_description,
                             proposed_unit, proposed_quantity, proposed_rate, proposed_rate_precision)
      values (${run.id}, ${200 + index * 100}, ${section.id}, 'item', ${item.description},
              ${item.unit}, ${item.quantity}, ${item.rate}, ${item.rate === null ? null : 2})
      returning id`;
    items.push({ ...item, id: inserted.id });
  }

  await page.goto(`${BASE}${href}${PRICING}`, { waitUntil: "networkidle0" });

  // ── §4.8's persistent unpriced count ────────────────────────────────────────────────────
  const tally = await page.evaluate(() => {
    const region = document.querySelector('[data-region="tally"]');
    return {
      text: region?.textContent ?? "",
      unpriced: region?.querySelector("[data-unpriced]")?.textContent ?? "",
      rows: [...document.querySelectorAll('[data-region="pricing-grid"] tr[data-row]')].map(
        (tr) => tr.dataset.state ?? tr.dataset.type,
      ),
    };
  });

  check("the bill is on the pricing screen without being re-drafted", tally.rows.length === 4, tally.rows.join(","));
  check("with its section and its three items", tally.rows.join(",") === "heading,priced,unpriced,unpriced", tally.rows.join(","));
  check("the unpriced count is stated", /2 unpriced/i.test(tally.unpriced), tally.unpriced.trim());
  // The rate check against past tenders is on the page whatever the local database holds – either its
  // findings, or a sentence saying there is nothing (or nothing out of line) to compare with.
  const market = await page.$eval('[data-region="market-check"]', (el) => el.innerText).catch(() => "");
  check("the rates are checked against past tenders", /Rates against past tenders/.test(market) && /past tenders|out of line|within/.test(market), market.replace(/\s+/g, " ").slice(0, 120));
  check(
    "and the total counts only what is priced",
    plain(tally.text).includes("2 312 500,00"),
    plain(tally.text).replace(/\s+/g, " ").slice(0, 140),
  );

  // ── The filter, which is also how "select every unpriced row" is done (§2.5) ─────────────
  await page.click('[data-filter="unpriced"]');
  await page.waitForFunction(
    `document.querySelectorAll('[data-region="pricing-grid"] tr[data-row][data-type="item"]').length === 2`,
    { timeout: 8000 },
  );

  const filtered = await page.evaluate(() =>
    [...document.querySelectorAll('[data-region="pricing-grid"] tr[data-row]')].map(
      (tr) => tr.dataset.state ?? tr.dataset.type,
    ),
  );
  check("filtering to unpriced leaves only the rows still to price", filtered.join(",") === "heading,unpriced,unpriced", filtered.join(","));

  // ── Bulk: one rate, typed once, across a selection ──────────────────────────────────────
  await page.click("[data-select-all]");
  await page.waitForFunction(`document.querySelector('[data-region="bulk"]') !== null`, {
    timeout: 8000,
  });

  const bulkShown = await page.$eval('[data-region="bulk"]', (el) => el.textContent ?? "");
  check("selecting rows offers the bulk bar", /2 items selected/i.test(bulkShown), bulkShown.replace(/\s+/g, " ").slice(0, 80));

  await typeInto("#bulk-rate", "312,50");
  await page.click('[data-act="apply-rate"]');
  await page.waitForFunction(
    `document.querySelector('[data-region="bulk-notice"]')?.textContent.includes("2 rates written")`,
    { timeout: 10000 },
  );

  const afterApply = await rowsOf(run.id);
  check(
    "one rate typed once reaches every selected row",
    afterApply[1].override_rate === "31250" && afterApply[2].override_rate === "31250",
    `${afterApply[1].override_rate}, ${afterApply[2].override_rate}`,
  );
  check("with its own scale beside it", afterApply.slice(1).every((r) => r.override_rate_precision === 2));
  check(
    "and the database extends each one — nothing here multiplies",
    afterApply[1].amount === "27000000" && afterApply[2].amount === "13125000",
    `${afterApply[1].amount}, ${afterApply[2].amount}`,
  );
  check("every one is attributed to the session's name", afterApply.slice(1).every((r) => r.override_by === env.DEV_USER_EMAIL));
  check(
    "and records that a person stated the rate (§6.3)",
    afterApply.slice(1).every((r) => r.rate_source === "manual"),
    afterApply.map((r) => r.rate_source).join(", "),
  );
  check(
    "the row the documents priced was not selected and did not move",
    afterApply[0].override_rate === null && afterApply[0].rate_source === "ai_derived",
  );

  // ── A refused figure is refused, not guessed ────────────────────────────────────────────
  await page.goto(`${BASE}${href}${PRICING}`, { waitUntil: "networkidle0" });
  await page.click("[data-select-all]");
  await typeInto("#bulk-rate", "1,234");
  await page.click('[data-act="apply-rate"]');
  await page.waitForFunction(`document.body.innerText.includes("factor of a thousand")`, {
    timeout: 8000,
  });

  const afterRefusal = await rowsOf(run.id);
  check("an ambiguous rate is refused in words", true);
  check(
    "and not one row was written",
    afterRefusal.every((r, i) => r.override_rate === afterApply[i].override_rate),
  );

  // ── Bulk: a percentage, and the rows with nothing to adjust named rather than zeroed ─────
  //
  // The third row's rate is cleared first, so the selection contains one row that can move and one
  // that cannot. §4.8 read strictly: 10% of nothing is nothing, and writing it would price an
  // unpriced item at nought — which the sign-off gate would then happily freeze.
  await sql`
    update run_items set override_rate = null, override_rate_precision = null, rate_source = 'ai_derived'
     where id = ${items[2].id}`;

  await page.goto(`${BASE}${href}${PRICING}`, { waitUntil: "networkidle0" });
  await page.click("[data-select-all]");
  await typeInto("#bulk-percent", "8");
  await page.click('[data-act="adjust"]');
  await page.waitForFunction(
    `document.querySelector('[data-region="bulk-notice"]') !== null`,
    { timeout: 10000 },
  );

  const notice = await page.$eval('[data-region="bulk-notice"]', (el) => el.textContent ?? "");
  const afterAdjust = await rowsOf(run.id);

  check("a percentage moves the rates that exist", /2 rates written/i.test(notice), notice.replace(/\s+/g, " ").slice(0, 90));
  check(
    "by the figure that was typed — R1 850,00 + 8% = R1 998,00",
    afterAdjust[0].override_rate === "199800",
    `${afterAdjust[0].override_rate}`,
  );
  check(
    "reading the working rate, so a QS's own correction is what gets adjusted",
    afterAdjust[1].override_rate === "33750",
    `${afterAdjust[1].override_rate}`,
  );
  check(
    "a row with no rate is named rather than priced at nought",
    afterAdjust[2].override_rate === null && /Surface beds/.test(notice),
    notice.replace(/\s+/g, " ").slice(0, 160),
  );

  // ── The rate build-up — §4.8, and the arithmetic a QS can check by hand ─────────────────
  await page.goto(`${BASE}${href}${PRICING}`, { waitUntil: "networkidle0" });

  const openBuildUp = async (rowId) => {
    const selector = `tr[data-row="${rowId}"] [data-act="build-up"]`;
    await clickWhenEnabled(selector);
  };

  await openBuildUp(items[0].id);
  await page.waitForFunction(`document.querySelector('[data-region="build-up"]') !== null`, {
    timeout: 10000,
  });

  const componentCell = (index, label) =>
    `[data-region="build-up"] tr[data-component="${index}"] input[aria-label="${label}, component ${index + 1}"]`;

  // Three components, typed the way a person types them — commas, spaces, and all.
  const componentRows = [
    ["Cement", "0,35", "2 400,00"],
    ["Sand", "0,7", "180,00"],
    ["Placing", "2,5", "85,00"],
  ];

  for (const [index, [description, quantity, rate]] of componentRows.entries()) {
    if (index > 0) {
      await clickWhenEnabled('[data-act="add-component"]');
      await page.waitForFunction(
        (i) => document.querySelector(`[data-region="build-up"] tr[data-component="${i}"]`) !== null,
        { timeout: 10000 },
        index,
      );
    }
    await typeInto(componentCell(index, "Description"), description);
    await typeInto(componentCell(index, "Quantity"), quantity);
    await typeInto(componentCell(index, "Rate"), rate);
  }

  await typeInto(`#waste-${items[0].id}`, "5");
  await typeInto(`#markup-${items[0].id}`, "12");
  // Blur the last field so it commits, the way leaving a cell does.
  await page.click('[data-region="build-up"] p');

  // 1 250 m³ at R1 385,92 — the amount the extension trigger writes, and therefore the only
  // signal that says the save landed rather than that the screen finished computing.
  await settled(items[0].id, "1 732 400,00");

  const working = await page.$eval('[data-region="build-up-total"]', (el) => el.textContent ?? "");
  check(
    "the build-up works out to the rate a QS gets by hand",
    plain(working).includes("1 385,92"),
    plain(working).replace(/\s+/g, " ").slice(0, 160),
  );
  check("showing the components summed", plain(working).includes("1 178,50"));
  check("the waste, rounded away from zero — 58,925 → 58,93", plain(working).includes("58,93"));
  check("and the markup on delivered cost", plain(working).includes("148,49"));

  const [built] = await sql`
    select i.override_rate, i.override_rate_precision, i.rate_source, i.amount,
           b.waste_rate, b.markup_rate,
           (select count(*) from rate_components c where c.build_up_id = b.id) as components
      from run_items i join rate_build_ups b on b.run_item_id = i.id
     where i.id = ${items[0].id}`;

  check("the build-up is stored with its components", Number(built.components) === 3, `${built.components}`);
  check("its percentages held as the fraction §5.1 specifies", built.waste_rate === "0.0500" && built.markup_rate === "0.1200", `${built.waste_rate} / ${built.markup_rate}`);
  check("and the rate it produced is on the bill row", built.override_rate === "138592", `${built.override_rate}`);
  check("recorded as built up rather than typed (§6.3)", built.rate_source === "build_up", built.rate_source);
  check(
    "with the amount recomputed by the trigger — 1 250 × R1 385,92",
    built.amount === "173240000",
    `${built.amount}`,
  );

  // ── The plug — "flagged, never hidden" ──────────────────────────────────────────────────
  await typeInto(`#plug-${items[0].id}`, "1 500,00");
  await page.click('[data-region="build-up"] p');

  // 1 250 m³ at the plugged R1 500,00.
  await settled(items[0].id, "1 875 000,00");

  const plugged = await page.$eval('[data-region="build-up-total"]', (el) => el.textContent ?? "");
  const [afterPlug] = await sql`
    select i.override_rate, i.amount, b.plug_rate, b.plug_rate_precision
      from run_items i join rate_build_ups b on b.run_item_id = i.id
     where i.id = ${items[0].id}`;

  check("a plug is applied instead of the computed rate", afterPlug.override_rate === "150000", `${afterPlug.override_rate}`);
  check("and stored as the plug it is, not as the build-up's answer", afterPlug.plug_rate === "150000" && afterPlug.plug_rate_precision === 2);
  check(
    "the build-up still says what it computes, beside what was used",
    plain(plugged).includes("1 385,92") && plain(plugged).includes("1 500,00"),
    plain(plugged).replace(/\s+/g, " ").slice(0, 200),
  );
  check("and the amount follows the applied rate", afterPlug.amount === "187500000", `${afterPlug.amount}`);

  // ── A rate typed over a build-up is flagged on the row ──────────────────────────────────
  await page.goto(`${BASE}${href}${PRICING}`, { waitUntil: "networkidle0" });
  await typeInto(`tr[data-row="${items[0].id}"] input[data-cell="rate"]`, "1 900,00");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    (rowId) =>
      document
        .querySelector(`tr[data-row="${rowId}"]`)
        ?.textContent.includes("not the build-up"),
    { timeout: 10000 },
    items[0].id,
  );

  const detached = await page.$eval(
    `tr[data-row="${items[0].id}"]`,
    (tr) => tr.textContent ?? "",
  );
  check(
    "a rate typed over a build-up says so on the row rather than hiding it",
    plain(detached).includes("not the build-up") && plain(detached).includes("1 500,00"),
    plain(detached).replace(/\s+/g, " ").slice(0, 180),
  );

  const [typedOver] = await sql`
    select override_rate, rate_source, amount from run_items where id = ${items[0].id}`;

  check(
    "and it is that rate the extension uses, not the build-up's",
    typedOver.override_rate === "190000" && typedOver.amount === "237500000",
    `rate ${typedOver.override_rate}, amount ${typedOver.amount}`,
  );
  check(
    "recorded as entered by hand, over a build-up that still exists",
    typedOver.rate_source === "manual",
    typedOver.rate_source,
  );

  // ── Removing a build-up takes the rate it set with it ───────────────────────────────────
  await openBuildUp(items[0].id);
  await page.waitForFunction(`document.querySelector('[data-act="remove-build-up"]') !== null`, {
    timeout: 10000,
  });
  await clickWhenEnabled('[data-act="remove-build-up"]');
  await page.waitForFunction(
    `document.querySelector('[data-region="build-up"]') === null`,
    { timeout: 10000 },
  );

  const [removed] = await sql`
    select override_rate, rate_source, amount from run_items where id = ${items[0].id}`;
  const [{ count: leftOver }] = await sql`
    select count(*)::int as count from rate_build_ups where run_item_id = ${items[0].id}`;

  check("the build-up is gone", leftOver === 0);
  check(
    "and the rate it set went with it, rather than becoming a figure with no derivation",
    removed.override_rate === null,
    `${removed.override_rate}`,
  );
  check("so the agent's own proposal is what the row shows again", removed.amount === "231250000", `${removed.amount}`);

  // ── A signed bill offers none of this ───────────────────────────────────────────────────
  //
  // The signature is the bill's, and it freezes these rows. There is no second signature here and
  // there must be no way to move a figure underneath one.
  await sql`update run_items set override_rate = 31250, override_rate_precision = 2
             where run_id = ${run.id} and row_type = 'item' and override_rate is null`;
  await sql`
    update run_items set output_description = coalesce(override_description, proposed_description),
                         output_quantity = coalesce(override_quantity, proposed_quantity),
                         output_rate = coalesce(override_rate, proposed_rate),
                         output_rate_precision = coalesce(override_rate_precision, proposed_rate_precision),
                         output_amount = amount
     where run_id = ${run.id} and row_type = 'item'`;
  await sql`
    update runs set signed_by = ${env.DEV_USER_EMAIL}, signed_at = now() where id = ${run.id}`;

  await page.goto(`${BASE}${href}${PRICING}`, { waitUntil: "networkidle0" });

  const frozen = await page.evaluate(() => ({
    text: document.querySelector('[data-region="pricing"]')?.textContent ?? "",
    inputs: document.querySelectorAll('[data-region="pricing-grid"] input').length,
    buildUp: document.querySelectorAll('[data-act="build-up"]').length,
  }));

  check("a signed bill says so on this screen", /signed off/i.test(frozen.text));
  check("and offers nothing to type into", frozen.inputs === 0, `${frozen.inputs} inputs`);
  check("nor a build-up to open", frozen.buildUp === 0);

  const forceRate = await sql`
    update run_items set override_rate = 1 where id = ${items[1].id}`
    .then(() => null)
    .catch((e) => e.message);
  check(
    "and the database refuses a rate written behind the screen's back",
    Boolean(forceRate),
    forceRate?.slice(0, 90) ?? "the update was allowed",
  );

  const forceBuildUp = await sql`
    insert into rate_build_ups (run_item_id, created_by) values (${items[1].id}, 'nobody')`
    .then(() => null)
    .catch((e) => e.message);
  check(
    "and refuses a build-up added behind a signature",
    Boolean(forceBuildUp),
    forceBuildUp?.slice(0, 90) ?? "the insert was allowed",
  );

  check(
    "no React warnings on any screen this visited",
    consoleErrors.length === 0,
    consoleErrors.join(" | ").slice(0, 220),
  );
} finally {
  await browser.close();
  await sql.end();
}

console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} failed.`);
process.exit(fails ? 1 : 0);
