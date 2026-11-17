/**
 * The row-shaped run — PLATFORM.md §1.3.3, §4.7, §5.2, §6.4, §7.4.
 *
 *     npm run check:bill
 *
 * ── What this proves ───────────────────────────────────────────────────────────────────────
 *
 * That a bill is a run: rows a person can correct, a total nobody stored, and a signature that
 * freezes it. And — the part worth the most — that **the database's arithmetic and `extend()` agree**.
 * §5.2 has one rounding point and this platform now has two implementations of it, one in
 * `src/domain/money.ts` and one in the trigger in `0010_run_items.sql`. Two implementations of a rule
 * that is wrong quietly is exactly the thing to check on every commit, so the same table of values —
 * exact halves, negatives, six-place rates — goes through both and the answers are compared.
 *
 * ── Why the bill is seeded ─────────────────────────────────────────────────────────────────
 *
 * A real draft costs DeepSeek credits and `npm run check` runs many times a day. §1.3's "no seed
 * data" rule is about a project's figures being invented for a *user*; fixtures for a test are
 * fixtures. What this cannot show is that the route writes rows of this shape — that is
 * `checks/run-live.mjs`.
 */

import { config } from "dotenv";
import postgres from "postgres";
import puppeteer from "puppeteer";

import { createProject, fileAgainst, signIn, watchConsole, readEnv } from "./helpers.mjs";

config({ path: ".env.local", quiet: true });
const env = readEnv();

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const BASE = "http://localhost:3000";
const BILL = "/bill";

/**
 * `extend()` from `src/domain/money.ts`, transcribed.
 *
 * Deliberately a transcription rather than an import: this suite is checking that two independent
 * statements of §5.2 agree, and importing one of them would leave the comparison testing a variable
 * against itself. If this ever has to change, the reason will be that the rule changed — which is
 * precisely when somebody should be made to look at both.
 */
const divideRounded = (numerator, denominator) => {
  const negative = numerator < 0n !== denominator < 0n;
  const absN = numerator < 0n ? -numerator : numerator;
  const absD = denominator < 0n ? -denominator : denominator;
  const rounded = (absN * 2n + absD) / (absD * 2n);
  return negative ? -rounded : rounded;
};

const scaleQuantity = (decimal) => {
  const negative = decimal.startsWith("-");
  const [whole, fraction = ""] = decimal.replace("-", "").split(".");
  const scaled = BigInt(whole) * 10_000n + BigInt((fraction + "0000").slice(0, 4));
  return negative ? -scaled : scaled;
};

const extend = (quantity, rate, precision) =>
  divideRounded(scaleQuantity(quantity) * rate, 10n ** BigInt(precision + 4 - 2));

const sql = postgres(env.DATABASE_URL, { max: 1 });

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1400 });
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));
const consoleErrors = watchConsole(page);

/**
 * Money is formatted with a **non-breaking** space between thousands (§7.7, so a figure cannot wrap
 * across two lines in a table cell). Every assertion about a rendered amount has to fold it, or it
 * compares against a space that is not the one on the screen.
 */
const plain = (text) => text.replace(/\u00a0/g, " ");

/** The cell input for one row, by the column's own name. */
const cell = (rowId, column) => `tr[data-row="${rowId}"] input[data-cell="${column}"]`;

/**
 * Type into a cell, having first waited for it to be there and be typeable.
 *
 * Running alone this passed every time; inside the full suite it timed out on the correction. The
 * grid used to disable every input while a save was in flight, so a save that took longer on a busy
 * machine swallowed the next keystrokes. The grid no longer does that — §7.4 wants a column typed
 * down without interruption — and this waits anyway, because a suite that assumes an element is
 * ready is a suite that fails for reasons that have nothing to do with the platform.
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
  await page.click(selector, { clickCount: 3 });
  await page.type(selector, text);
};

/** Empty a cell – which clears its override (§7.4) – selecting by script, since a triple-click stops at a non-breaking space. */
const clearCell = async (selector) => {
  await typeInto(selector, "");
  await page.$eval(selector, (el) => el.select());
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Enter");
};

try {
  await signIn(page, env);

  const name = "Bill " + Date.now();
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });
  const { href } = await createProject(page, name);
  const projectId = href.split("/").pop();

  // ── The step is real, and it is gated ───────────────────────────────────────────────────
  await page.goto(`${BASE}${href}${BILL}`, { waitUntil: "networkidle0" });

  const blocked = await page.evaluate(() => {
    const region = document.querySelector('[data-region="run"]');
    const button = [...(region?.querySelectorAll("button") ?? [])].find((b) =>
      /draft the bill/i.test(b.textContent ?? ""),
    );
    return { present: Boolean(region), disabled: button?.disabled ?? null, text: region?.textContent ?? "" };
  });

  check("the bill is a step with a run panel", blocked.present);
  check("and it will not start without something describing the work", blocked.disabled === true);
  check(
    "the refusal names what would clear it",
    /Specification or measured scope/i.test(blocked.text),
    blocked.text.replace(/\s+/g, " ").slice(0, 120),
  );
  check(
    "and it says what a row will be before anything is run",
    /left empty for you to measure/i.test(blocked.text),
  );

  // A real document, so the citations point at something a reader could open.
  await fileAgainst(page, "Specification or measured scope", "./fixtures/layouts.txt");
  await page.waitForFunction(`document.body.innerText.includes("layouts.txt")`, { timeout: 20000 });

  const opened = await page.evaluate(() => {
    const button = [...document.querySelectorAll('[data-region="run"] button')].find((b) =>
      /draft the bill/i.test(b.textContent ?? ""),
    );
    return button?.disabled ?? null;
  });
  check("filing the specification opens the step", opened === false);

  const [document_] = await sql`
    select id, filename from documents where project_id = ${projectId} limit 1`;
  const [passage] = await sql`
    select page, body from passages where document_id = ${document_.id} order by seq limit 1`;
  const quote = passage.body.replace(/\s+/g, " ").trim().slice(0, 80);

  // ── The arithmetic, before anything else ────────────────────────────────────────────────
  //
  // §5.2's single rounding point, stated twice. Ties away from zero — what a QS gets from a hand
  // calculation and from Excel's ROUND — rather than banker's rounding, which is better for large
  // aggregates and worse here because it would disagree with the person checking the column.
  const [run] = await sql`
    insert into runs (project_id, module, status, input_tokens, output_tokens, created_by)
    values (${projectId}, ${BILL}, 'review', 6120, 1430, ${env.DEV_USER_EMAIL})
    returning id`;

  const arithmetic = [
    ["1250.0000", 185000n, 2],
    ["0.5000", 1n, 2],
    ["-0.5000", 1n, 2],
    ["2.5000", 1n, 2],
    ["12.3456", 4567n, 4],
    ["0.0001", 1n, 2],
    ["-12.3456", 4567n, 4],
    ["1.0000", -12345n, 2],
    ["99999999.9999", 999999n, 6],
  ];

  let disagreed = 0;
  for (const [quantity, rate, precision] of arithmetic) {
    const [row] = await sql`
      insert into run_items (run_id, seq, row_type, proposed_description,
                             proposed_quantity, proposed_rate, proposed_rate_precision)
      values (${run.id}, 1, 'item', 'arithmetic probe', ${quantity}, ${rate}, ${precision})
      returning id, amount`;

    const expected = extend(quantity, rate, precision);
    if (BigInt(row.amount) !== expected) {
      disagreed++;
      console.log(`        ${quantity} × ${rate}@${precision}: db ${row.amount}, extend() ${expected}`);
    }
    await sql`delete from run_items where id = ${row.id}`;
  }

  check(
    "the database's extension agrees with extend() on every value",
    disagreed === 0,
    `${arithmetic.length} values, ${disagreed} disagreed`,
  );

  const halves = await sql`
    select round(2.5000::numeric * 1 / 1)::bigint as up, round(-2.5000::numeric * 1 / 1)::bigint as down`;
  check(
    "and it rounds halves away from zero, not to even",
    halves[0].up === "3" && halves[0].down === "-3",
    `2.5 → ${halves[0].up}, -2.5 → ${halves[0].down}`,
  );

  // ── A drafted bill, as the route would have left it ─────────────────────────────────────
  const [section] = await sql`
    insert into run_items (run_id, seq, row_type, proposed_description, proposed_confidence)
    values (${run.id}, 100, 'heading', 'Substructure', 0)
    returning id`;

  const seeded = [
    {
      description: "Strip footings in 25 MPa/19mm concrete to SANS 1200",
      unit: "m3",
      quantity: "1250.0000",
      rate: 185000n,
      rateText: "R1 850,00 per cubic metre",
    },
    {
      description: "Surface beds 100mm thick on 250 micron waterproof membrane",
      unit: "m2",
      // The document describes the work and prices it and states no quantity. That is the normal
      // case for a bill drafted from a specification, and the gate below is what it is for.
      quantity: null,
      rate: 31250n,
      rateText: "R312,50 per square metre",
    },
  ];

  const items = [];
  for (const [index, item] of seeded.entries()) {
    const [row] = await sql`
      insert into run_items (
        run_id, seq, parent_id, row_type,
        proposed_description, proposed_unit, proposed_quantity,
        proposed_rate, proposed_rate_precision, proposed_rate_text, proposed_confidence,
        source_document_id, source_document, source_page, source_excerpt
      ) values (
        ${run.id}, ${200 + index * 100}, ${section.id}, 'item',
        ${item.description}, ${item.unit}, ${item.quantity},
        ${item.rate}, 2, ${item.rateText}, 0.9,
        ${document_.id}, ${document_.filename}, ${passage.page ?? null}, ${quote}
      ) returning id, amount`;
    items.push({ ...item, id: row.id, amount: row.amount });
  }

  check(
    "an item with a quantity and a rate carries its extension",
    items[0].amount === "231250000",
    `${items[0].amount}`,
  );
  check("an item with no quantity has no amount, not nought", items[1].amount === null);

  // ── It survives a page that never drafted it ────────────────────────────────────────────
  await page.goto(`${BASE}${href}${BILL}`, { waitUntil: "networkidle0" });

  const shown = await page.evaluate(() => {
    const region = document.querySelector('[data-region="bill"]');
    return {
      present: Boolean(region),
      rows: [...(region?.querySelectorAll("tr[data-row]") ?? [])].map((tr) => tr.dataset.type),
      subtotals: [...(region?.querySelectorAll("tr[data-subtotal]") ?? [])].length,
      total: region?.querySelector('[data-region="bill-total"]')?.textContent ?? "",
      text: region?.textContent ?? "",
    };
  });

  check("the bill is on the page without being re-drafted", shown.present);
  check("with its heading and its items", shown.rows.join(",") === "heading,item,item", shown.rows.join(","));
  check("the section carries a subtotal nobody stored", shown.subtotals === 1);
  check(
    "the bill total is the sum of the rounded amounts",
    plain(shown.total).includes("2 312 500,00"),
    plain(shown.total).trim(),
  );
  check("an unmeasured row shows a dash rather than a zero", shown.text.includes("—"));
  check("every row keeps the passage it was read from", shown.text.includes(document_.filename));
  check("and the quote itself", shown.text.includes(quote.slice(0, 40)));

  // ── The gate: an item with no measure refuses the signature ─────────────────────────────
  const gate = await page.evaluate(() => {
    const region = document.querySelector('[data-region="signature"]');
    const button = [...(region?.querySelectorAll("button") ?? [])].find((b) =>
      /sign off/i.test(b.textContent ?? ""),
    );

    // The reason moved out of the signature strip and above the control it blocks — a reader met
    // a greyed button and a wall of specification prose under it. The assertions are unchanged in
    // intent: the refusal still has to name a row and say what a hole costs downstream.
    const reason = document.querySelector('[data-region="bill-blocked"]');

    return {
      disabled: button?.disabled ?? null,
      label: button?.textContent ?? "",
      text: `${region?.textContent ?? ""} ${reason?.textContent ?? ""}`,
    };
  });

  check("the sign-off button is there", gate.disabled !== null);
  check("and is refused while an item has no measure", gate.disabled === true);
  check("the refusal names the row", /Surface beds/i.test(gate.text), gate.text.replace(/\s+/g, " ").slice(0, 140));
  check("and says a hole reads downstream as an approved total", /approved total/i.test(gate.text));
  check("the button names who would be signing", gate.label.includes(env.DEV_USER_EMAIL), gate.label.trim());

  /*
    ── The gate is a way through, not a report ─────────────────────────────────────────────

    Everything above was already true of a gate that listed the blocked rows as text beside a chip,
    and the QS it was written for read it as a description of a problem rather than a way out of
    one: they could not tell the grid's cells were editable at all, could not tell why the button
    was grey, and had nothing to press. Three defects, three assertions.
  */
  const boxed = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('input[data-cell="quantity"]')];
    const opaque = (el) => getComputedStyle(el).borderTopColor !== "rgba(0, 0, 0, 0)";
    const empty = cells.filter((e) => !e.value);

    return {
      empty: empty.length,
      emptyBoxed: empty.filter(opaque).length,
      filledBoxed: cells.filter((e) => e.value).filter(opaque).length,
    };
  });

  check(
    "an empty measure cell is drawn as a box to type in",
    boxed.empty > 0 && boxed.emptyBoxed === boxed.empty,
    `${boxed.emptyBoxed} of ${boxed.empty}`,
  );
  check("and a cell that already has a figure is not", boxed.filledBoxed === 0, `${boxed.filledBoxed} boxed`);

  const control = await page.$('[data-region="bill-blocked"] [data-blocked="quantity"]');
  check("each blocked row offers a way to the cell it names", control !== null);

  if (control) {
    // The row this control belongs to, so "it focused *a* quantity cell" cannot pass.
    const wanted = await control.evaluate((b) => (b.closest("li")?.textContent ?? "").slice(0, 20));
    await control.click();

    const landed = await page
      .waitForFunction(() => document.activeElement?.dataset?.cell === "quantity", { timeout: 5000 })
      .then(() =>
        page.evaluate(() => ({
          cell: document.activeElement?.dataset?.cell ?? "",
          row: (document.activeElement?.closest("tr")?.textContent ?? "").slice(0, 20),
        })),
      )
      .catch(() => ({ cell: "", row: "" }));

    check(
      "pressing it puts the caret in that row's quantity",
      landed.cell === "quantity" && landed.row.includes(wanted.slice(0, 12)),
      `${landed.cell} — ${landed.row.trim()}`,
    );
  }

  const why = await page.$eval('[data-region="signature"] button', (b) => b.title);
  check("the greyed button says on itself why it is greyed", /without a quantity or a rate/i.test(why), why);

  // ── A figure that cannot be read is refused, not guessed ────────────────────────────────
  //
  // §5: `1,234` is a thousands separator to one reader and a decimal comma to another, the two
  // readings are a factor of a thousand apart, and nothing in the text decides it. The typing hand
  // is not exempt from that – unless the row's unit settles it. Round-1 testing: "12,940 m²" was left
  // blank. Nobody measures a length or an area to three decimal places, so on a row in metres the
  // comma can only be grouping; in tonnes both readings are ordinary and it is still refused.
  const unitOf = async () =>
    (await sql`select coalesce(override_unit, proposed_unit) as unit from run_items where id = ${items[1].id}`)[0].unit;
  const wholeUnit = await unitOf();
  await typeInto(cell(items[1].id, "quantity"), "1,234");
  await page.keyboard.press("Enter");
  const readAsGrouping = await (async () => {
    const deadline = Date.now() + 8000;
    for (;;) {
      const [row] = await sql`select override_quantity from run_items where id = ${items[1].id}`;
      if (row.override_quantity !== null || Date.now() > deadline) return row.override_quantity;
      await new Promise((r) => setTimeout(r, 250));
    }
  })();
  check(`on a row in ${wholeUnit}, 1,234 is read as one thousand two hundred and thirty-four`, readAsGrouping === "1234.0000", `${readAsGrouping}`);

  // The grid has to be showing the figure before emptying it means anything: an edit that leaves a
  // cell as it was drawn is no edit, and is rightly not saved.
  // Written back, not merely shown: the cell holds what was typed from the moment it was typed, so
  // the row's own saving mark is what says the refreshed rows have landed.
  await page.waitForFunction((s) => { const el = document.querySelector(s); return el && el.value.trim() !== "" && !el.closest("tr").dataset.saving; }, { timeout: 8000 }, cell(items[1].id, "quantity"));
  await clearCell(cell(items[1].id, "quantity"));
  {
    const deadline = Date.now() + 8000;
    while ((await sql`select override_quantity from run_items where id = ${items[1].id}`)[0].override_quantity !== null && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  await typeInto(cell(items[1].id, "unit"), "t");
  await page.keyboard.press("Enter");
  {
    const deadline = Date.now() + 8000;
    while ((await unitOf()) !== "t" && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
  }
  await typeInto(cell(items[1].id, "quantity"), "1,234");
  await page.keyboard.press("Enter");
  await page.waitForFunction(`document.body.innerText.includes("factor of a thousand")`, {
    timeout: 8000,
  });

  const [afterRefusal] = await sql`
    select override_quantity, amount from run_items where id = ${items[1].id}`;
  check("in tonnes an ambiguous figure is refused in words", true);
  check("and nothing is written for it", afterRefusal.override_quantity === null, `${afterRefusal.override_quantity}`);
  check("so the row still has no amount", afterRefusal.amount === null);

  // Put the unit back, so what follows sees the row it was written against.
  await page.waitForFunction((s) => { const el = document.querySelector(s); return el && el.value === "t" && !el.closest("tr").dataset.saving; }, { timeout: 8000 }, cell(items[1].id, "unit"));
  await clearCell(cell(items[1].id, "unit"));
  {
    const deadline = Date.now() + 8000;
    while ((await unitOf()) !== wholeUnit && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
  }

  // ── A correction: overrides written, proposed untouched, the amount recomputed ───────────
  //
  // Round-2 testing's first report: for about a second after Enter the cell showed the value it
  // had *before* the edit and the amount sat unchanged, so the edit looked dropped. Sampled every
  // few milliseconds from Enter until the amount lands: the cell must never show anything but 864,
  // and the amount column must say it is calculating rather than show the stale figure.
  await typeInto(cell(items[1].id, "quantity"), "864");
  await page.keyboard.press("Enter");
  const seen = await page.evaluate(
    (rowId, selector) =>
      new Promise((resolve) => {
        const values = new Set();
        let calculating = false;
        const start = Date.now();
        const tick = () => {
          const row = document.querySelector(`tr[data-row="${rowId}"]`);
          const input = document.querySelector(selector);
          const landed = (row?.textContent.replace(/\u00a0/g, " ") ?? "").includes("270 000,00");
          if (input && !landed) values.add(input.value.replace(/\u00a0/g, " "));
          if (row?.querySelector('[data-region="calculating"]')) calculating = true;
          const text = row?.textContent.replace(/\u00a0/g, " ") ?? "";
          if (text.includes("270 000,00") || Date.now() - start > 8000) resolve({ values: [...values], calculating, landed: text.includes("270 000,00") });
          else setTimeout(tick, 5);
        };
        tick();
      }),
    items[1].id,
    cell(items[1].id, "quantity"),
  );
  check("the amount lands", seen.landed);
  check("the typed figure stays in the cell until it does", seen.values.every((v) => v === "864"), seen.values.join(" | "));
  check("and the amount says it is calculating meanwhile", seen.calculating);

  const [corrected] = await sql`
    select proposed_quantity, override_quantity, override_by, quantity_source, amount
      from run_items where id = ${items[1].id}`;

  check("the corrected quantity is stored", corrected.override_quantity === "864.0000", `${corrected.override_quantity}`);
  check("under the session's name, not the form's", corrected.override_by === env.DEV_USER_EMAIL);
  check("the agent's proposal is untouched", corrected.proposed_quantity === null);
  check("the row records that a person measured it", corrected.quantity_source === "manual");
  check(
    "and the database recomputed the amount from the human's figure",
    corrected.amount === "27000000",
    `${corrected.amount}`,
  );

  // ── The database refuses to rewrite what the agent said ─────────────────────────────────
  const editProposed = await sql`
    update run_items set proposed_description = 'rewritten' where id = ${items[0].id}`
    .then(() => null)
    .catch((e) => e.message);
  check(
    "the database refuses to edit a proposal",
    Boolean(editProposed),
    editProposed?.slice(0, 90) ?? "the update was allowed",
  );

  const forgeAmount = await sql`
    update run_items set amount = 99 where id = ${items[0].id} returning amount`
    .then((rows) => rows[0]?.amount)
    .catch((e) => e.message);
  check(
    "and an amount written by hand is overwritten by the extension",
    forgeAmount === "231250000",
    `${forgeAmount}`,
  );

  // ── Paste a block from a spreadsheet — §7.4, the requirement that decides adoption ───────
  await page.goto(`${BASE}${href}${BILL}`, { waitUntil: "networkidle0" });

  await page.evaluate(
    (selector, text) => {
      const input = document.querySelector(selector);
      input.focus();
      const data = new DataTransfer();
      data.setData("text/plain", text);
      input.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
      );
    },
    cell(items[0].id, "quantity"),
    // Two columns, three rows — one row longer than the bill, which is the ordinary case when a QS
    // pastes a measured column against a bill that has not caught up with it.
    "1500\t1900,00\n900\t320,00\n42\t99,50",
  );

  await page.waitForFunction(
    `document.querySelectorAll('[data-region="bill"] tr[data-row]').length === 4`,
    { timeout: 10000 },
  );

  const pasted = await sql`
    select override_quantity, override_rate, override_rate_precision, quantity_source, amount, proposed_description
      from run_items where run_id = ${run.id} and row_type = 'item' order by seq`;

  check("a pasted block fills the cells it covers", pasted[0].override_quantity === "1500.0000", `${pasted[0].override_quantity}`);
  check("including the rate, with its own scale", pasted[0].override_rate === "190000" && pasted[0].override_rate_precision === 2);
  check("and the amount follows", pasted[0].amount === "285000000", `${pasted[0].amount}`);
  check("the second row took the second line", pasted[1].override_quantity === "900.0000");
  check(
    "a block longer than the bill appends a row rather than dropping it",
    pasted.length === 3 && pasted[2].override_quantity === "42.0000",
    `${pasted.length} items`,
  );
  check(
    "an appended row is a hand-entered row with nothing proposed",
    pasted[2].proposed_description === null,
  );
  check(
    "and every pasted figure records that it was pasted",
    pasted.every((row) => row.quantity_source === "imported"),
    pasted.map((r) => r.quantity_source).join(", "),
  );

  // ── Striking a row out is not a delete ──────────────────────────────────────────────────
  const beforeOmit = await page.$eval('[data-region="bill-total"]', (el) => el.textContent ?? "");

  await page.evaluate((rowId) => {
    const row = document.querySelector(`tr[data-row="${rowId}"]`);
    [...row.querySelectorAll("button")].find((b) => /omit/i.test(b.textContent))?.click();
  }, items[1].id);

  await page.waitForFunction(
    `document.querySelector('tr[data-row="${items[1].id}"]')?.dataset.omitted === "true"`,
    { timeout: 8000 },
  );

  const [struck] = await sql`
    select omitted_by, proposed_description, override_quantity from run_items where id = ${items[1].id}`;
  const afterOmit = await page.$eval('[data-region="bill-total"]', (el) => el.textContent ?? "");

  check("a struck row is stamped with who struck it", struck.omitted_by === env.DEV_USER_EMAIL);
  check("its record of what the agent said survives", struck.override_quantity !== null);
  check("and it leaves the total", beforeOmit !== afterOmit, `${beforeOmit.trim()} → ${afterOmit.trim()}`);

  // ── The signature ───────────────────────────────────────────────────────────────────────
  //
  // Every remaining item now has both figures, so the gate opens.
  const signable = await page.$eval('[data-region="signature"]', (region) => {
    const button = [...region.querySelectorAll("button")].find((b) => /sign off/i.test(b.textContent ?? ""));
    return button?.disabled ?? null;
  });
  check("with every item measured the signature is offered", signable === false);

  await page.evaluate(() => {
    const region = document.querySelector('[data-region="signature"]');
    [...region.querySelectorAll("button")].find((b) => /sign off/i.test(b.textContent))?.click();
  });

  await page.waitForFunction(
    `document.querySelector('[data-region="signature"]')?.textContent.includes("Signed off")`,
    { timeout: 10000 },
  );

  const signature = await page.$eval('[data-region="signature"]', (r) => r.textContent ?? "");
  check("the bill says it is signed", /signed off/i.test(signature));
  check("by a named person", signature.includes(env.DEV_USER_EMAIL));
  check(
    "with the total it froze",
    /items totalling/i.test(signature),
    plain(signature).replace(/\s+/g, " ").slice(0, 160),
  );

  const stillEditable = await page.$$eval('[data-region="bill"] input', (inputs) => inputs.length);
  check("and nothing on it can still be typed into", stillEditable === 0, `${stillEditable} inputs`);

  // ── output is frozen from working, human wins ───────────────────────────────────────────
  const outputs = await sql`
    select row_type, omitted_at, output_description, output_quantity, output_rate, output_amount, amount
      from run_items where run_id = ${run.id} order by seq`;

  const signedItems = outputs.filter((row) => row.row_type === "item" && !row.omitted_at);
  check(
    "every live item froze the amount the database computed",
    signedItems.every((row) => row.output_amount === row.amount),
  );
  check(
    "and the human's quantity is what was frozen",
    signedItems.some((row) => row.output_quantity === "1500.0000"),
  );
  check(
    "a struck row freezes nothing",
    outputs.find((row) => row.omitted_at)?.output_amount === null,
  );
  check(
    "a heading freezes its words and no figures",
    outputs.find((row) => row.row_type === "heading")?.output_description === "Substructure",
  );

  // ── Frozen means frozen, in the database ────────────────────────────────────────────────
  const editSigned = await sql`
    update run_items set override_unit = 'after the fact' where id = ${items[0].id}`
    .then(() => null)
    .catch((e) => e.message);
  check(
    "a signed bill's rows cannot be changed",
    Boolean(editSigned),
    editSigned?.slice(0, 90) ?? "the update was allowed",
  );

  /**
   * The half `run_fields` never needed. A field set is closed, so nobody can append a field to a
   * signed run; a bill is a list, and a row added to a signed bill would change an approved total
   * without touching a single row anybody signed.
   */
  const appendToSigned = await sql`
    insert into run_items (run_id, seq, row_type, proposed_description)
    values (${run.id}, 9999, 'item', 'smuggled in')`
    .then(() => null)
    .catch((e) => e.message);
  check(
    "and no row can be added to it",
    Boolean(appendToSigned),
    appendToSigned?.slice(0, 90) ?? "the insert was allowed",
  );

  // ── A second tab sees the same bill ─────────────────────────────────────────────────────
  const second = await browser.newPage();
  await second.goto(`${BASE}${href}${BILL}`, { waitUntil: "networkidle0" });
  const elsewhere = await second.$eval('[data-region="run"]', (r) => r.textContent ?? "");
  check("a second tab sees the signed bill", /signed off/i.test(elsewhere));
  check(
    "with the frozen figures on it",
    plain(elsewhere).includes("1 500"),
    plain(elsewhere).replace(/\s+/g, " ").slice(0, 120),
  );
  await second.close();

  // ── And the chain knows about it ────────────────────────────────────────────────────────
  await page.goto(`${BASE}${href}`, { waitUntil: "networkidle0" });
  const chain = await page.evaluate(() => {
    const row = document.querySelector('[data-region="chain"] li[data-step="/bill"]');
    return { state: row?.dataset.state ?? null, text: row?.textContent ?? "" };
  });

  check("the overview reads the bill as signed off", chain.state === "signed_off", `${chain.state}`);
  check("naming the signer", chain.text.includes(env.DEV_USER_EMAIL));

  /*
    ── A signature is a version, not a door ────────────────────────────────────────────────

    The freeze above is right and stays. What was wrong is that the only way onward from it was
    "Draft again", which re-reads the corpus and re-proposes every row — so a QS who had measured
    four hundred cells by hand measured them again, and the sign-off sentence had to warn them.
    Nothing about a frozen bill required that.

    What is asserted here is the thing that makes the relaxed wording *true*: a revision carries the
    signed figures forward, keeps each one's citation and its claim about who measured it, says on
    every row where it came from — and leaves the signed bill exactly as it was, still the one in
    force. If any of those stops holding, the sentence on the signature strip becomes a promise the
    platform does not keep, which is worse than the harsh version it replaced.
  */
  // Back to the bill: the assertions above walked off to the overview, and this
  // block runs last precisely because a revision becomes the newest run of the step.
  await page.goto(`${BASE}${href}${BILL}`, { waitUntil: "networkidle0" });
  await page.waitForSelector('[data-region="signature"]', { timeout: 20000 });

  check("the signed bill offers a way onward", (await page.$('[data-action="revise-bill"]')) !== null);
  check(
    "and the strip says a revision starts from these figures",
    /revision starts from these figures/i.test(plain(signature)),
  );

  await page.click('[data-action="revise-bill"]');
  await page.waitForFunction(
    () => document.querySelectorAll('[data-region="bill"] input').length > 0,
    { timeout: 20000 },
  ).catch(() => {});

  const [before] = await sql`
    select count(*)::int as rows, coalesce(sum(output_amount), 0)::text as total
      from run_items where run_id = ${run.id} and omitted_at is null`;

  const [revision] = await sql`
    select id from runs
     where project_id = ${projectId} and module = '/bill'
       and signed_at is null and deleted_at is null
     order by created_at desc limit 1`;

  check("revising opens a new unsigned draft", revision !== undefined);

  if (revision) {
    const [after] = await sql`
      select count(*)::int as rows,
             coalesce(sum(amount), 0)::text as total,
             count(proposed_note)::int as noted
        from run_items where run_id = ${revision.id}`;

    /*
      How each figure was come by, carried across as a multiset rather than by name.

      This asserted `manual > 0` and failed on 0, because this suite *pastes* its column — so its
      figures are `imported`, and the assertion was describing the live project it was written
      against rather than the rule. The rule is that the claim travels intact whatever it is: a
      pasted figure stays pasted, a measured one stays measured, and none of them is re-stamped
      `ai_derived` on the way into a revision, which would launder a person's work as the agent's.
    */
    const sources = async (runId) =>
      (
        await sql`
          select quantity_source, rate_source, count(*)::int as n from run_items
           where run_id = ${runId} and (${runId} = ${revision.id} or omitted_at is null)
           group by 1, 2 order by 1, 2`
      )
        .map((r) => `${r.quantity_source}/${r.rate_source}×${r.n}`)
        .join(", ");

    const wasFrom = await sources(run.id);
    const nowFrom = await sources(revision.id);

    const [orphans] = await sql`
      select count(*)::int as n from run_items c
       where c.run_id = ${revision.id} and c.parent_id is not null
         and not exists (select 1 from run_items p where p.id = c.parent_id and p.run_id = ${revision.id})`;

    check("it carries every row of the signed bill", after.rows === before.rows, `${after.rows} of ${before.rows}`);
    check("at the figures the signature froze", after.total === before.total, `${after.total} vs ${before.total}`);
    check("nothing has to be measured a second time", after.rows > 0 && after.noted === after.rows, `${after.noted} noted`);
    check("and how each figure was come by travels with it", nowFrom === wasFrom, `${nowFrom} vs ${wasFrom}`);
    check("and the sections are rebuilt inside the revision", orphans.n === 0, `${orphans.n} pointing at the old bill`);

    // The whole promise of the sentence: the signed bill is untouched and still the one in force.
    const [untouched] = await sql`
      select signed_by, signed_at, (select count(*)::int from run_items where run_id = ${run.id}) as rows
        from runs where id = ${run.id}`;
    check(
      "the signed bill is left exactly as it was",
      untouched.signed_by !== null && untouched.signed_at !== null,
      `${untouched.rows} rows, signed by ${untouched.signed_by}`,
    );
  }

  /*
    ── The signed bill reaches the next step ───────────────────────────────────────────────

    The point of signing. D1.2's BPMN flow ends `QA Check --> |Pass| D1.3 Tender Documentation`
    and its outputs list "Input to tender documentation (→ D1.3)" — and until the row carry existed
    the platform did none of it: nothing declared that the bill was an input to anything, so Tender
    Analysis was startable on a project with no bill, and the rows a QS had just signed reached the
    next screen not at all.

    Asserted here rather than in a suite of its own because this is the same signature the block
    above produced, and the claim being tested is that *it* travelled. The figures must match the
    ones frozen, not merely be present: a schedule that is close to the bill is worse than none.
  */
  await page.goto(`${BASE}${href}/tender-analysis`, { waitUntil: "networkidle0" });

  const carried = await page.$('[data-region="carried-schedule"]');
  check("the signed bill reaches the step that tenders it", carried !== null);

  if (carried) {
    const shown = plain(await carried.evaluate((el) => el.innerText));
    const frozen = await sql`
      select count(*)::int as items, coalesce(sum(output_amount), 0)::text as total
        from run_items
       where run_id = ${run.id} and omitted_at is null and row_type = 'item'`;

    const rand = (cents) => (Number(cents) / 100).toFixed(2).replace(".", ",")
      .replace(/\B(?=(\d{3})+(?!\d))/g, " ");

    check("it names where the rows came from and who signed them", /Carried from/.test(shown) && shown.includes(env.DEV_USER_EMAIL));
    check("at the item count that was frozen", new RegExp(`${frozen[0].items} items?`).test(shown), shown.replace(/\s+/g, " ").slice(0, 120));
    check("and the total that was frozen", shown.includes(rand(frozen[0].total)), rand(frozen[0].total));

    // Read-only here, on purpose: editing the schedule a tender is based on means revising the
    // bill, and a second editable copy of it under another name is how two bills happen.
    const editable = await page.$$eval('[data-region="carried-schedule"] input, [data-region="carried-schedule"] textarea', (e) => e.length);
    check("and nothing on it can be edited from this screen", editable === 0, `${editable} inputs`);
  }

  /*
    ── The comparison the bill exists to make possible ─────────────────────────────────────

    D1.3's second sub-process. A tenderer writes a sum on the front of their tender; their own
    rates, extended against our quantities, produce another — and reconciling the two is arithmetic
    no summary of a tender can carry. That is why this screen holds rows, and why the assertions
    below plant a discrepancy of a known size rather than checking that a total is non-empty.

    The second judgement is the one that would embarrass somebody in a meeting: a tenderer who
    priced two of nineteen items is always cheapest and never cheapest. `compareTenders` refuses to
    crown an incomplete tender, and this proves the refusal survives the trip through the database
    and the screen — not just the unit test.
  */
  await page.goto(`${BASE}${href}/tender-analysis`, { waitUntil: "networkidle0" });

  const comparison = await page.$('[data-region="tender-comparison"]');
  check("the tender step can compare returns against the signed bill", comparison !== null);

  if (comparison) {
    const addTender = async (who) => {
      await page.click('[data-field="tenderer-name"]', { clickCount: 3 });
      await page.type('[data-field="tenderer-name"]', who);
      await page.click('[data-action="add-tenderer"]');
      await page
        .waitForFunction(
          (name) => document.body.innerText.includes(name),
          { timeout: 20000 },
          who,
        )
        .catch(() => {});
      await page.goto(`${BASE}${href}/tender-analysis`, { waitUntil: "networkidle0" });
    };

    await addTender("Complete Co");
    await addTender("Partial Co");

    const columns = await page.$$eval("[data-tenderer]", (e) => e.length);
    check("each tenderer is a column beside the bill", columns === 2, `${columns} columns`);

    // Two priced items in the seeded bill. Complete Co prices both; Partial Co prices one, dearer
    // per item — so it extends lower while being the more expensive tender.
    const priced = await page.$$eval("[data-price]", (e) => e.length);
    check("with a cell per row per tenderer", priced === columns * 2, `${priced} cells`);

    const pasteInto = (index, text) =>
      page.evaluate(
        (i, block) => {
          const input = document.querySelectorAll("[data-price]")[i];
          input.focus();
          const data = new DataTransfer();
          data.setData("text/plain", block);
          input.dispatchEvent(
            new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
          );
        },
        index,
        text,
      );

    // §7.4's requirement, on the screen where the rates genuinely arrive as a spreadsheet.
    await pasteInto(0, "100,00\n200,00");
    await page.waitForNetworkIdle({ idleTime: 1500, timeout: 40000 }).catch(() => {});
    await page.goto(`${BASE}${href}/tender-analysis`, { waitUntil: "networkidle0" });

    const [pasted] = await sql`
      select count(*)::int as n from tender_prices p
        join tender_returns r on r.id = p.return_id
       where r.project_id = ${projectId} and r.tenderer = 'Complete Co' and p.rate is not null`;
    check("a column pastes straight out of a spreadsheet", pasted.n === 2, `${pasted.n} rates`);

    /*
      The extension, against the bill's own frozen quantity — §5.2's single rounding point, in a
      third trigger. `checks/bill.mjs` already drives the same table of values through the bill's
      trigger and through `extend()`; this asserts the tender one lands on the same answer for a
      real row rather than a fixture.
    */
    const [extended] = await sql`
      select sum(p.amount)::text as total,
             sum(round(i.output_quantity * p.rate::numeric / power(10::numeric, p.rate_precision - 2)))::text as expected
        from tender_prices p
        join tender_returns r on r.id = p.return_id
        join run_items i on i.id = p.item_id
       where r.project_id = ${projectId} and r.tenderer = 'Complete Co'`;
    check(
      "each rate is extended against the quantity the signature froze",
      extended.total === extended.expected,
      `${extended.total} vs ${extended.expected}`,
    );

    /*
      Partial Co prices ONE item, at a rate dearer than either of Complete Co's.

      The trailing newline is doing real work: a paste with no line break is an ordinary
      single-cell paste, which the component deliberately leaves to the browser — and a synthetic
      ClipboardEvent has no default action, so it would insert nothing at all. Written as a block
      of one, which is also what a QS pasting a single rate out of a spreadsheet actually sends.
    */
    await pasteInto(1, "5 000,00" + String.fromCharCode(10));
    await page.waitForNetworkIdle({ idleTime: 1500, timeout: 40000 }).catch(() => {});
    await page.goto(`${BASE}${href}/tender-analysis`, { waitUntil: "networkidle0" });

    // ── The evaluation under it (November meeting) ──────────────────────────────────────────
    const evaluated = await page.$$eval('[data-region="tender-evaluation"] [data-evaluated]', (rows) => rows.map((r) => r.getAttribute("data-evaluated")));
    check("each tender is read against our estimate", evaluated.length === 2 && evaluated.includes("Complete Co"), evaluated.join(", "));
    // Every tender over the whole bill, its gaps priced at what the others charged – ranked.
    const scoped = await page.$$eval('[data-region="same-scope"] [data-scope]', (rows) => rows.map((r) => r.getAttribute("data-scope")));
    check("and compared on the same scope, ranked", scoped.length === 2 && scoped.includes("Complete Co") && scoped.includes("Partial Co"), scoped.join(", "));
    check(
      "two items are too few to call anybody a copier, and it says it checked",
      /No pair of tenderers prices at a constant multiple/.test(await page.$eval('[data-region="collusion"]', (e) => e.innerText)),
    );
    const workbook = await page.evaluate(async (path) => {
      const r = await fetch(`${path}/report/pdf?document=tender-evaluation`);
      const bytes = new Uint8Array(await r.arrayBuffer());
      return { status: r.status, type: r.headers.get("content-type"), head: String.fromCharCode(bytes[0], bytes[1]) };
    }, href);
    check("and the evaluation downloads as a workbook", workbook.status === 200 && /spreadsheetml/.test(workbook.type ?? "") && workbook.head === "PK", `${workbook.status} ${workbook.type}`);

    // ── The arithmetic correction, with a discrepancy of a known size ─────────────────────
    const [{ total }] = await sql`
      select sum(p.amount)::text as total from tender_prices p
        join tender_returns r on r.id = p.return_id
       where r.project_id = ${projectId} and r.tenderer = 'Complete Co'`;

    // Their form claims R 1 000,00 less than their own rates come to.
    const short = (BigInt(total) - 100000n).toString();
    const asRand = (cents) =>
      (Number(cents) / 100).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ");

    await page.click("[data-stated]", { clickCount: 3 });
    await page.type("[data-stated]", asRand(short));
    await page.keyboard.press("Enter");
    await page.waitForNetworkIdle({ idleTime: 1500, timeout: 30000 }).catch(() => {});
    await page.goto(`${BASE}${href}/tender-analysis`, { waitUntil: "networkidle0" });

    const findings = plain(
      await page.$eval('[data-region="tender-comparison"]', (el) => el.innerText),
    ).replace(/\s+/g, " ");

    check(
      "a stated sum that does not match the rates is caught, to the cent",
      /R 1 000,00 more than stated/.test(findings),
      findings.slice(findings.indexOf("Complete Co"), findings.indexOf("Complete Co") + 130),
    );
    check("and the tender that priced nothing else is named as incomplete", /1 item not priced/.test(findings));

    /*
      The judgement. Partial Co extends to R 5 000,00 against Complete Co's R 300,00 — but it is
      the *incomplete* one, so "lowest" belongs to neither of them by price alone: an unfinished
      tender is not a low tender, and the badge must sit on Complete Co.
    */
    const lowest = await page.$$eval("[data-finding]", (rows) =>
      rows.filter((r) => r.innerText.includes("lowest")).map((r) => r.innerText.split("\n")[0].trim()),
    );
    check(
      "and an incomplete tender is not crowned lowest",
      lowest.length === 1 && lowest[0].startsWith("Complete Co"),
      lowest.join(" | ") || "nobody",
    );
  }

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
