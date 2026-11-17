/**
 * 1280px — PLATFORM.md §14's "works at 1280px wide", and §7.3's breakpoint table.
 *
 *     npm run check:viewport
 *
 * ── Why this exists ────────────────────────────────────────────────────────────────────────
 *
 * §14 lists 1280 as a condition of a feature being done, and until this suite nothing had ever
 * looked. Every other suite runs at 1440 — the §7.3 design target — so the one width the
 * definition of done actually names was the one width nobody tested. "Nothing below 1280px has
 * been designed" was recorded as a known absence, but it was an *unknown*: nobody could say
 * whether it was a stylesheet afternoon or a rebuild.
 *
 * It is an afternoon. Nothing overflows at any width — the shell is fluid and the page columns
 * hold. What broke was narrower than that and this suite is shaped around it.
 *
 * ── The three failure modes, which are not the same defect ─────────────────────────────────
 *
 * 1. **The page scrolls sideways.** `documentElement.scrollWidth > clientWidth`. The loudest
 *    failure and, as it turns out, the one this app does not have.
 *
 * 2. **A header overflows its own column.** This is the one that was real, and a page-overflow
 *    check cannot see it: `table-fixed` gives a column a percentage, and a percentage cannot
 *    shrink a *word*. "CONFIDENCE" needs 94px with its padding; the column was 9%, which clears
 *    94px only at 1440. At 1280 it was 88px and at 1280 with the advisor open 57px, so the header
 *    painted over its neighbour and read `CONFIDENSOURCE` at every width below the design target.
 *    Nothing scrolled, nothing was cut off, and eighteen commits went past it.
 *
 * 3. **A control is clipped.** An input whose content box is narrower than its own placeholder —
 *    "leave as is" rendering as "leave as". The reader can still type; they cannot read what the
 *    box is for.
 *
 * ── Why the advisor is opened ──────────────────────────────────────────────────────────────
 *
 * 1280 with the advisor closed is not the binding case. The sidebar is 240 and the advisor 340, so
 * open it and the content column is 700px — and the panel is *persisted*, so a QS who opened it
 * once meets that column on every project screen afterwards. Testing only the closed case would
 * have passed the header collision at 1280 and failed a reader who had used the advisor.
 *
 * The run is seeded rather than driven, for the reason `home.mjs` gives: a live run costs DeepSeek
 * credits, and what is under test here is the table's geometry, not the agent.
 */

import { config } from "dotenv";
import postgres from "postgres";
import puppeteer from "puppeteer";

import { createProject, readEnv, signIn, watchConsole } from "./helpers.mjs";

config({ path: ".env.local", quiet: true });
const env = readEnv();

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const BASE = "http://localhost:3000";

/**
 * The widths that mean something.
 *
 * 1440 is §7.3's primary design target and the baseline every other suite runs at. 1280 is §14's
 * requirement. 1024 is inside §7.3's Tablet band, where the spec says the sidebar auto-collapses —
 * it does not yet, so 1024 is measured for overflow rather than held to the whole band's contract.
 */
const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "1280", width: 1280, height: 800 },
  { name: "1024", width: 1024, height: 768 },
];

const sql = postgres(env.DATABASE_URL, { max: 1 });

/**
 * Measure one rendered page.
 *
 * Everything here runs in the browser and returns plain data, so a failure names an element rather
 * than a screenshot somebody has to go and look at.
 */
const measure = (page) =>
  page.evaluate(() => {
    /** A short, readable trail to an element, for a failure message. */
    const trail = (el) => {
      const parts = [];
      for (let n = el; n && n.nodeType === 1 && parts.length < 3; n = n.parentElement) {
        parts.unshift(n.dataset.region ? `${n.tagName.toLowerCase()}[${n.dataset.region}]` : n.tagName.toLowerCase());
      }
      return parts.join(">");
    };

    /**
     * Hidden inputs are not clipped, they are hidden.
     *
     * Every upload control on a criterion row is a 1px `input[type=file]` behind a styled label —
     * a real and deliberate pattern, and twenty of them per page. Measured naively each one reports
     * a 1px box holding 162px of content, which is the loudest finding on the page and means
     * nothing at all. A box nobody can see cannot clip anything from a reader.
     */
    const visible = (el) => {
      if (el.clientWidth <= 2 || el.clientHeight <= 2) return false;
      const style = getComputedStyle(el);
      return style.visibility !== "hidden" && style.opacity !== "0";
    };

    const de = document.documentElement;
    const vw = de.clientWidth;

    return {
      viewport: vw,
      docScroll: document.documentElement.scrollWidth,

      // ── 2. Headers wider than the column holding them ───────────────────────────────
      headers: [...document.querySelectorAll("th")]
        .filter((th) => visible(th) && th.scrollWidth > th.clientWidth + 1)
        .map((th) => ({
          text: (th.textContent ?? "").trim().slice(0, 24),
          client: th.clientWidth,
          scroll: th.scrollWidth,
          trail: trail(th),
        })),

      /*
        ── 3a. A KPI figure wider than the tile holding it ────────────────────────────

        A different failure from a clipped control, and a worse one: a control that overflows is
        awkward, whereas "R 466 600 000,00" clipped at the tile edge reads as a *smaller figure*.
        Nothing about it looks broken, which is what makes it dangerous on a page whose whole
        claim is that its numbers are exact.
      */
      figures: [...document.querySelectorAll("[data-metric]")]
        .flatMap((tile) => {
          const figure = tile.querySelectorAll("p")[1];
          if (!figure || !visible(figure)) return [];
          return figure.scrollWidth > tile.clientWidth
            ? [`${tile.dataset.metric} needs ${figure.scrollWidth} in ${tile.clientWidth}`]
            : [];
        }),

      // ── 3. Controls narrower than what they are asking for ──────────────────────────
      controls: [...document.querySelectorAll("input, select, button")]
        .filter((el) => visible(el) && el.scrollWidth > el.clientWidth + 1)
        .map((el) => ({
          text: (el.placeholder || el.value || el.textContent || "").trim().slice(0, 24),
          client: el.clientWidth,
          scroll: el.scrollWidth,
          trail: trail(el),
        })),

      /**
       * The document must not scroll — `<main>` is the only scroller.
       *
       * `overflow-hidden` on the shell clips only what it is the containing block for, and every
       * `sr-only` control in the app is `position: absolute`. While the shell was `static` those
       * resolved against the initial containing block and escaped: with a run on screen the
       * deepest hidden upload input sat at 2 723px on a 900px viewport, so `<html>` grew a second
       * scrollbar and a screenful of blank canvas under the app. Nothing overflowed sideways and
       * no text was wrong, so every other assertion in every suite stayed green.
       */
      docScrollHeight: de.scrollHeight,
      docClientHeight: de.clientHeight,
      scrollers: [...document.querySelectorAll("*")]
        .filter((el) => {
          const style = getComputedStyle(el);
          // An assistant panel's conversation scrolls inside the panel by design — it is a column
          // of messages beside the page, not a second page scroller.
          // The same goes for a list that declares itself bounded inside a card – the job card's
          // phase panel takes the room left on the screen and scrolls its own steps, which is what
          // keeps the card whole on an 800px screen instead of pushing the page into a scroll.
          if (el.closest('[data-region="advisor"], [data-region="guide-panel"], [data-scroller]')) return false;
          return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1;
        })
        .map((el) => el.tagName.toLowerCase()),

      /*
        ── 4. A control something else is sitting on ──────────────────────────────────

        The closed advisor tab was `position: fixed` over the page's right edge. Nothing was clipped,
        nothing scrolled, every assertion above stayed green — and a click on the right-hand part of
        the bill's "Omit" opened the advisor instead. Asked the way a pointer asks: at the centre and
        just inside each side of every visible control, is the topmost element that control?

        Only controls wholly inside `<main>`'s visible box are asked, so a row scrolled under a sticky
        header is not reported as covered.
      */
      covered: (() => {
        const main = document.querySelector("main")?.getBoundingClientRect();
        if (!main) return [];

        return [...document.querySelectorAll("main button, main a[href], main input, main select")]
          .filter((el) => {
            if (!visible(el)) return false;
            const r = el.getBoundingClientRect();
            const inside = (box) => r.top >= box.top && r.bottom <= box.bottom && r.left >= box.left && r.right <= box.right;
            if (!inside(main)) return false;
            /*
              And wholly inside its own nearest scroller. A suggestion scrolled below the fold of the
              advisor's message list is clipped by that list, not covered by the composer under it —
              the same reasoning as a row scrolled under a sticky header, one scroller deeper.
            */
            for (let parent = el.parentElement; parent && parent.tagName !== "MAIN"; parent = parent.parentElement) {
              if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) {
                return inside(parent.getBoundingClientRect());
              }
            }
            return true;
          })
          .flatMap((el) => {
            const r = el.getBoundingClientRect();
            const y = r.top + r.height / 2;
            const points = [
              [r.left + r.width / 2, y],
              [r.left + 2, y],
              [r.right - 2, y],
            ];
            const hit = points
              .map(([x, py]) => document.elementFromPoint(x, py))
              .find((top) => top && top !== el && !el.contains(top) && !top.contains(el));
            return hit
              ? [`"${(el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 20)}" under ${trail(hit)}`]
              : [];
          });
      })(),

      advisor: document.querySelector('[data-region="advisor"]') !== null,
    };
  });

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));

const consoleErrors = watchConsole(page);

try {
  await signIn(page, env);
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle0" });

  const project = await createProject(page, "Viewport " + Date.now());
  const id = project.href.split("/").pop();

  /**
   * A run in review, because an empty module page proves nothing about width.
   *
   * The table that has to fit is the one carrying ten figures, each with a value, a confidence, a
   * source document and the passage it was read from. The values are long on purpose — a target
   * market and a bulk-services note are the two longest things a feasibility run returns, and a
   * column that holds them holds the rest.
   */
  const [run] = await sql`
    insert into runs (project_id, module, status, input_tokens, output_tokens, created_by)
    values (${id}, '/feasibility', 'review', 4210, 880, ${env.DEV_USER_EMAIL})
    returning id`;

  const FIELDS = [
    ["units", "Number of units", "1 046"],
    ["unit-area", "Average unit area", "48 m²"],
    ["zoning", "Zoning", "Residential 3, as per the approved scheme"],
    ["absorption", "Absorption rate", "96 units per annum"],
    ["target-market", "Target market", "Households earning R8 000 – R30 000 per month"],
    ["services", "Bulk services status", "Municipal bulk available at the northern boundary"],
  ];

  for (const [seq, [fid, label, value]] of FIELDS.entries()) {
    await sql`
      insert into run_fields (
        run_id, field_id, seq, label, proposed_state, proposed_value, proposed_confidence,
        source_document, source_excerpt
      ) values (
        ${run.id}, ${fid}, ${seq}, ${label}, 'found', ${value}, 0.92,
        'Kings Estate feasibility brief.pdf',
        ${`the passage in the brief that established the ${label.toLowerCase()}`}
      )`;
  }

  /*
    A drafted bill with rows down the page, because an empty bill proves nothing about what might
    sit on top of its controls. The closed advisor tab was fixed over the right edge at mid-height
    and covered the "Omit" of whichever row lay there — invisible on a bill with no rows. Unmeasured
    items, so every row carries the three inputs and the action a QS actually clicks.
  */
  const [bill] = await sql`
    insert into runs (project_id, module, status, input_tokens, output_tokens, created_by)
    values (${id}, '/bill', 'review', 5200, 1100, ${env.DEV_USER_EMAIL})
    returning id`;

  const [heading] = await sql`
    insert into run_items (run_id, seq, row_type, proposed_description, proposed_confidence)
    values (${bill.id}, 100, 'heading', 'Earthworks and substructure', 0)
    returning id`;

  const WORK = [
    "Excavate in all materials for strip footings, average 1,20 m below existing ground level",
    "Concrete in footings, 25 MPa/19 mm, mechanically vibrated",
    "Surface beds 100 mm thick on 250 micron damp-proof membrane on compacted fill",
    "Reinforcement in high tensile steel to SANS 920, cut, bent and fixed",
    "External walls one brick thick in clay stock brick, in class II mortar",
    "Internal load-bearing walls half brick thick in clay stock brick",
    "Suspended floor slabs 170 mm thick, 30 MPa/19 mm, smooth shutter finish to soffits",
    "Roof covering in 0,5 mm profiled sheeting on purlins, pitch not exceeding 17 degrees",
    "Internal walls plastered and finished with two coats acrylic PVA",
    "Boundary fencing 1,8 m high welded mesh on galvanised standards",
  ];

  for (const [index, description] of WORK.entries()) {
    await sql`
      insert into run_items (run_id, seq, parent_id, row_type, proposed_description, proposed_confidence)
      values (${bill.id}, ${200 + index * 100}, ${heading.id}, 'item', ${description}, 0.9)`;
  }

  const SCREENS = [
    // Home is the practice's dashboard since 16 Nov 2026; the project's own dashboard is measured too.
    ["main", "/"],
    ["dashboard", `/projects/${id}/dashboard`],
    ["projects", "/projects"],
    ["overview", `/projects/${id}`],
    ["feasibility", `/projects/${id}/feasibility`],
    ["bill", `/projects/${id}/bill`],
    ["pricing", `/projects/${id}/pricing`],
  ];

  /** One screen at one width, measured and asserted. */
  async function inspect(label, href, viewport, advisorOpen) {
    await page.goto(BASE + href, { waitUntil: "networkidle0" });
    if (advisorOpen) await page.waitForSelector('[data-region="advisor"]', { timeout: 5000 }).catch(() => {});

    const m = await measure(page);
    const where = `${label} @ ${viewport}${advisorOpen ? " + advisor" : ""}`;

    check(
      `${where} — the page does not scroll sideways`,
      m.docScroll <= m.viewport + 1,
      `document is ${m.docScroll}px in a ${m.viewport}px viewport`,
    );

    check(
      `${where} — every column header fits its column`,
      m.headers.length === 0,
      m.headers.map((h) => `"${h.text}" needs ${h.scroll} in ${h.client} (${h.trail})`).join("; "),
    );

    check(
      `${where} — no figure is clipped by its own tile`,
      m.figures.length === 0,
      m.figures.join("; "),
    );

    check(
      `${where} — no control is clipped by its own column`,
      m.controls.length === 0,
      m.controls.map((c) => `"${c.text}" needs ${c.scroll} in ${c.client} (${c.trail})`).join("; "),
    );

    check(
      `${where} — nothing sits on top of a control`,
      m.covered.length === 0,
      m.covered.slice(0, 4).join("; "),
    );

    check(
      `${where} — the document itself does not scroll`,
      m.docScrollHeight <= m.docClientHeight + 1,
      `<html> is ${m.docScrollHeight}px in a ${m.docClientHeight}px viewport`,
    );

    check(
      `${where} — <main> is the only thing that scrolls`,
      m.scrollers.every((tag) => tag === "main"),
      m.scrollers.join(", "),
    );

    /*
      Nothing above <main> may move when something is scrolled into view.

      The shell was `overflow-hidden` over content 2 862px tall. That clips, but it is still a
      scroll container, so the run panel's `scrollIntoView` scrolled the shell by 28px and a white
      band appeared under the whole app. Every assertion above stayed green, because none of them
      scrolls. This one does it the way the pages do.
    */
    const shifted = await page.evaluate(() => {
      const main = document.querySelector("main");
      if (!main) return [];
      const deepest = [...main.querySelectorAll("*")].at(-1);
      deepest?.scrollIntoView({ block: "center" });
      const moved = [];
      for (let el = main.parentElement; el; el = el.parentElement) {
        if (el.scrollTop !== 0) moved.push(`${el.tagName.toLowerCase()} by ${el.scrollTop}px`);
      }
      if (document.scrollingElement.scrollTop !== 0) moved.push(`document by ${document.scrollingElement.scrollTop}px`);
      main.scrollTo(0, 0);
      return moved;
    });
    check(`${where} — scrolling into view moves only <main>`, shifted.length === 0, shifted.join(", "));

    return m;
  }

  // ── Every screen, at every width, with the advisor closed ───────────────────────────────
  for (const { name, width, height } of VIEWPORTS) {
    await page.setViewport({ width, height });
    for (const [label, href] of SCREENS) await inspect(label, href, name, false);
  }

  // ── And the binding case: 1280 with the advisor taking 340 of it ────────────────────────
  //
  // Set through the same key the panel persists under, because that is how a reader arrives in
  // this state — they opened it once on another screen and it followed them here.
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`${BASE}/projects/${id}`, { waitUntil: "networkidle0" });
  await page.evaluate(() => window.localStorage.setItem("qs.advisor.open", "true"));

  let opened = false;
  for (const [label, href] of SCREENS.slice(2)) {
    const m = await inspect(label, href, "1280", true);
    opened ||= m.advisor;
  }

  // Without this the three assertions above would pass by never having been in the state they
  // exist to test — a green suite measuring the closed layout twice.
  check("the advisor was actually open for those", opened);

  // Put it back, so a suite that runs after this one meets the default.
  await page.evaluate(() => window.localStorage.setItem("qs.advisor.open", "false"));

  check(
    "no React warnings on any screen at any width",
    consoleErrors.length === 0,
    consoleErrors.join(" | ").slice(0, 220),
  );
} finally {
  await browser.close();
  await sql.end();
}

console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} failed.`);
process.exit(fails ? 1 : 0);
