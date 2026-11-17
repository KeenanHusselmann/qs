/**
 * A design review workbook, read into a review.
 *
 * ── Why import at all ──────────────────────────────────────────────────────────────────────
 *
 * The practice already works this way, in Excel, and its reviewers are not going to retype a
 * seventy-item mapping into a web form to find out whether the platform is any good. So the first
 * thing the module does is read the workbook they already have: the Marshall Dam boundary wall
 * review's seven sheets are the format, and `design-review-workbook.ts` writes the same seven back.
 *
 * ── Read by its headings, not by its sheet names or cell addresses ─────────────────────────
 *
 * Each section is found by the row that heads it – "Ref | Discipline | Document" is the sources
 * register wherever it sits and whatever the tab is called. A reviewer who renames a sheet, inserts
 * a column or adds a fourth option has not changed what the workbook means, and a reader keyed to
 * `'QS Item Mapping'!G2` would import it wrongly without saying so.
 *
 * ── What is not read ───────────────────────────────────────────────────────────────────────
 *
 *  - Totals, counts and comparisons. They are formulas over the rows, and the platform computes
 *    them again from the same rows (`domain/design-review.ts`). Importing a cached total would be
 *    importing a claim about the rows rather than the rows.
 *  - Profit and attendance lines on provisional sums. They are a percentage of the sum above them,
 *    held once as an assumption, so a second copy of the figure could only ever disagree with it.
 *
 * Pure: sheets in, a review out, nothing written.
 */

import {
  DEFAULT_ASSUMPTIONS,
  ITEM_STATUSES,
  QUERY_PRIORITIES,
  QUERY_STATUSES,
  readStatus,
  type Review,
  type ReviewAdjustment,
  type ReviewItem,
  type ReviewOption,
  type ReviewParameter,
  type ReviewQuery,
  type ReviewSource,
} from "@/domain/design-review";

export interface Sheet {
  name: string;
  grid: string[][];
}

export type ImportResult = { ok: true; review: Review; notes: string[] } | { ok: false; reason: string };

// ── Cells ─────────────────────────────────────────────────────────────────────────────────

const norm = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const low = (s: string | undefined) => norm(s).toLowerCase();
/** A cell that says "nothing here" in the ways a reviewer writes it. */
const blank = (s: string | undefined) => ["", "-", "–", "n/a", "na", "none"].includes(low(s));
const text = (s: string | undefined): string | null => (blank(s) ? null : norm(s));

/**
 * A number cell as a fixed-place decimal string, or null.
 *
 * Cells arrive as the workbook stored them, which for a typed 0.1 can be "0.10000000000000001". A
 * typed quantity or rate is never meant to more places than the column holds, so it is rounded to
 * them here – once, on the way in – and every figure after this is exact.
 */
export function decimal(raw: string | undefined, places: number): string | null {
  const s = norm(raw).replace(/^R\s*/i, "").replace(/[\s,](?=\d{3}\b)/g, "");
  if (s === "" || !/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(places);
}

/** The index of the row whose cells include every wanted heading (each matched as a prefix). */
function headerRow(grid: string[][], wanted: readonly string[], limit = 15): number {
  for (let r = 0; r < Math.min(grid.length, limit); r++) {
    const cells = grid[r].map(low);
    if (wanted.every((w) => cells.some((c) => c.startsWith(w)))) return r;
  }
  return -1;
}

const column = (header: string[], ...prefixes: string[]) => {
  const cells = header.map(low);
  for (const p of prefixes) {
    const i = cells.findIndex((c) => c.startsWith(p));
    if (i >= 0) return i;
  }
  return -1;
};

const at = (row: string[], i: number) => (i >= 0 ? row[i] : undefined);

/** A stable key for an option label – "Max Brick" is `max-brick`. */
export const optionKey = (label: string) => low(label).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "option";

/**
 * Which options a short heading token names – "B", "Max", "Option A".
 *
 * A token names an option when it is the option's whole label or one of its words. "B" is Option B
 * and "Max" is Max Brick; a token that names two options, or none, names nothing, and the caller
 * says so rather than guessing.
 */
function optionsNamed(token: string, options: readonly ReviewOption[]): ReviewOption | null {
  const t = low(token);
  const hits = options.filter((o) => low(o.label) === t || low(o.label).split(" ").includes(t));
  return hits.length === 1 ? hits[0] : null;
}

// ── Sections ──────────────────────────────────────────────────────────────────────────────

function readMe(grid: string[][]) {
  const labelled = (label: RegExp) => {
    const row = grid.find((r) => label.test(norm(r[0])));
    if (!row) return null;
    // The label is often merged across two columns; the text is the first cell that is not it.
    return row.slice(1).map(norm).find((c) => c && !label.test(c)) ?? null;
  };
  return {
    title: norm(grid[0]?.[0]) || null,
    subject: norm(grid[1]?.[0]) || null,
    recommendation: labelled(/^recommended/i),
    limitations: labelled(/^limitations?$/i),
  };
}

function sources(grid: string[][]): ReviewSource[] | null {
  const h = headerRow(grid, ["ref", "discipline", "document"]);
  if (h < 0) return null;
  const head = grid[h];
  const c = {
    ref: column(head, "ref"),
    discipline: column(head, "discipline"),
    document: column(head, "document"),
    dated: column(head, "date"),
    status: column(head, "status", "revision"),
    notes: column(head, "relevance", "notes"),
    location: column(head, "location"),
  };
  return grid
    .slice(h + 1)
    .filter((r) => norm(at(r, c.ref)) && norm(at(r, c.document)))
    .map((r) => ({
      ref: norm(at(r, c.ref)),
      discipline: text(at(r, c.discipline)),
      document: norm(at(r, c.document)),
      dated: text(at(r, c.dated)),
      status: text(at(r, c.status)),
      notes: text(at(r, c.notes)),
      location: text(at(r, c.location)),
    }));
}

function parameters(grid: string[][]): { columns: string[]; rows: ReviewParameter[] } | null {
  const h = headerRow(grid, ["parameter", "status"]);
  if (h < 0) return null;
  const head = grid[h].map(norm);
  const p = column(head, "parameter");
  const s = column(head, "status");
  const consequence = column(head, "comment", "consequence");
  if (s <= p) return null;
  const columns = head.slice(p + 1, s).filter(Boolean);
  const rows = grid
    .slice(h + 1)
    .filter((r) => norm(r[p]))
    .map((r, i) => {
      const values: Record<string, string> = {};
      head.slice(p + 1, s).forEach((name, j) => {
        if (name) values[name] = norm(r[p + 1 + j]);
      });
      return { position: i + 1, parameter: norm(r[p]), values, status: text(r[s]), consequence: text(at(r, consequence)) };
    });
  return { columns, rows };
}

/** The bill items, and the options their quantity columns name. */
function items(grid: string[][], notes: string[]): { options: ReviewOption[]; rows: ReviewItem[] } | null {
  const h = headerRow(grid, ["ref", "bill", "unit", "status", "qty"]);
  if (h < 0) return null;
  const head = grid[h].map(norm);

  // "Qty Option A", "Qty Max Brick": every quantity column is an option, in the order the sheet has them.
  const qtyCols = head.flatMap((label, i) => (/^qty\b/i.test(label) ? [{ i, label: label.replace(/^qty\s*/i, "").trim() || `Option ${i}` }] : []));
  const options = qtyCols.map(({ label }) => ({ key: optionKey(label), label }));

  // "Item (B / Max)", "Item (A)": the item's number in each option's own bill.
  const itemCols = head.flatMap((label, i) => {
    const m = /^item\s*\(([^)]*)\)/i.exec(label);
    if (!m) return [];
    const named = m[1].split("/").map((t) => optionsNamed(t.trim(), options));
    if (named.some((o) => o === null)) notes.push(`The column "${label}" names an option that could not be matched; its item numbers were left out.`);
    return [{ i, options: named.filter((o): o is ReviewOption => o !== null) }];
  });

  const c = {
    ref: column(head, "ref"),
    bill: column(head, "bill"),
    description: column(head, "qs description", "description"),
    unit: column(head, "unit"),
    source: column(head, "design source", "source"),
    requirement: column(head, "design requirement", "requirement"),
    status: column(head, "status"),
    finding: column(head, "finding"),
    action: column(head, "recommended", "action"),
  };

  const rows: ReviewItem[] = [];
  for (const r of grid.slice(h + 1)) {
    const ref = norm(at(r, c.ref));
    const description = norm(at(r, c.description));
    // A footnote under the table sits in the ref column with nothing beside it.
    if (!ref || ref.length > 16 || !description) continue;

    const rawStatus = at(r, c.status);
    const status = readStatus(rawStatus, ITEM_STATUSES);
    if (!status && !blank(rawStatus)) notes.push(`${ref}: the status "${norm(rawStatus)}" is not in the key, so it was left unmarked.`);

    const quantities: Record<string, string | null> = {};
    qtyCols.forEach(({ i }, k) => (quantities[options[k].key] = decimal(r[i], 4)));
    const itemNumbers: Record<string, string> = {};
    for (const col of itemCols) {
      const v = norm(r[col.i]);
      if (!blank(v)) for (const o of col.options) itemNumbers[o.key] = v;
    }
    const rates: Record<string, string | null> = {};
    for (const o of options) rates[o.key] = null;

    rows.push({
      position: rows.length + 1,
      ref,
      bill: norm(at(r, c.bill)) || "Unassigned",
      itemNumbers,
      description,
      unit: text(at(r, c.unit)),
      quantities,
      designSource: text(at(r, c.source)),
      requirement: text(at(r, c.requirement)),
      status,
      finding: text(at(r, c.finding)),
      action: text(at(r, c.action)),
      rates,
      rateBasis: null,
    });
  }
  return { options, rows };
}

function queries(grid: string[][], notes: string[]): ReviewQuery[] | null {
  const h = headerRow(grid, ["no", "query", "status"]);
  if (h < 0) return null;
  const head = grid[h];
  const c = {
    no: column(head, "no"),
    topic: column(head, "topic"),
    query: column(head, "query"),
    raisedTo: column(head, "raised"),
    affects: column(head, "affects"),
    priority: column(head, "priority"),
    source: column(head, "source"),
    response: column(head, "response"),
    status: column(head, "status"),
  };
  const out: ReviewQuery[] = [];
  for (const r of grid.slice(h + 1)) {
    const m = /(\d+)/.exec(norm(at(r, c.no)));
    const query = norm(at(r, c.query));
    if (!m || !query) continue;
    const number = Number(m[1]);
    if (out.some((q) => q.number === number)) {
      notes.push(`Q${number} appears twice; the second was left out.`);
      continue;
    }
    const response = text(at(r, c.response));
    out.push({
      number,
      topic: text(at(r, c.topic)),
      query,
      raisedTo: text(at(r, c.raisedTo)),
      affects: text(at(r, c.affects)),
      priority: readStatus(at(r, c.priority), QUERY_PRIORITIES),
      sourceRef: text(at(r, c.source)),
      response,
      status: readStatus(at(r, c.status), QUERY_STATUSES) ?? (response ? "Answered" : "Open"),
    });
  }
  return out;
}

/**
 * The priced estimate: rates onto the items, the adjustments, and the key assumptions.
 *
 * Its quantity columns are links back to the mapping sheet, so they are not read – the mapping's
 * quantities are the review's quantities. Its rate columns are named by short tokens ("Rate Max")
 * which are matched to the mapping's options by name.
 */
function priced(grid: string[][], options: readonly ReviewOption[], rows: ReviewItem[], notes: string[]) {
  const h = headerRow(grid, ["ref", "bill", "rate"], 120);
  const adjustments: ReviewAdjustment[] = [];
  const assumptions = { ...DEFAULT_ASSUMPTIONS };
  if (h < 0) return { adjustments, assumptions, found: false };
  const head = grid[h].map(norm);

  const byToken = (prefix: RegExp) =>
    head.flatMap((label, i) => {
      const m = prefix.exec(label);
      // "Rate basis / notes" is a note about the rates, not a rate column.
      if (!m || /basis|note/i.test(label)) return [];
      const o = optionsNamed(label.slice(m[0].length).trim(), options);
      if (!o) notes.push(`The estimate column "${label}" does not name one option; it was left out.`);
      return o ? [{ i, key: o.key }] : [];
    });
  const rateCols = byToken(/^rate\s+/i);
  const qtyCols = byToken(/^qty\s+/i);
  const c = { ref: column(head, "ref"), bill: column(head, "bill"), qsItem: column(head, "qs item"), description: column(head, "description"), unit: column(head, "unit"), basis: column(head, "rate basis", "notes", "basis") };

  // ── Key assumptions: the labelled rows above the table, and above its summary ──
  // The summary repeats "Contingency", "VAT" and "Range, low" as computed totals; reading those as
  // assumptions would set VAT at eight hundred thousand per cent.
  const summary = grid.findIndex((r, i) => i < h && /^summary/i.test(norm(r[0])));
  for (const r of grid.slice(0, summary >= 0 ? summary : h)) {
    const label = low(r[0]);
    const value = r.slice(1).map((v) => norm(v)).find((v) => decimal(v, 4) !== null);
    if (!label || value === undefined) continue;
    if (/length|main quantity/.test(label)) {
      assumptions.mainQuantity = decimal(value, 4);
      assumptions.mainUnit = /\(([^)]+)\)/.exec(norm(r[0]))?.[1] ?? assumptions.mainUnit;
    } else if (/^contingency/.test(label)) assumptions.contingency = decimal(value, 4)!;
    else if (/^vat/.test(label)) assumptions.vat = decimal(value, 4)!;
    else if (/profit and attendance/.test(label)) assumptions.profitAndAttendance = decimal(value, 4)!;
    else if (/range.*low/.test(label)) assumptions.rangeLow = decimal(value, 4)!;
    else if (/range.*high/.test(label)) assumptions.rangeHigh = decimal(value, 4)!;
    else if (/contract period/.test(label)) assumptions.contractWeeks = Math.round(Number(value));
    else if (/comparison|cost plan/.test(label)) {
      assumptions.comparisonAmount = decimal(value, 2);
      assumptions.comparisonLabel = norm(r[0]).replace(/\s*\(for comparison\)\s*/i, "").replace(/\s*excl\.? VAT\s*/i, " ").trim();
    }
  }

  // ── Rates and adjustments ──
  const byRef = new Map(rows.map((row) => [row.ref, row]));
  const seen = new Set<string>();
  for (const r of grid.slice(h + 1)) {
    const ref = norm(at(r, c.ref));
    const description = norm(at(r, c.description));
    if (!ref || !description) continue;

    if (/^adj/i.test(ref) || /^adjust/i.test(norm(at(r, c.bill)))) {
      const quantities: Record<string, string | null> = {};
      const rates: Record<string, string | null> = {};
      for (const o of options) {
        quantities[o.key] = decimal(r[qtyCols.find((q) => q.key === o.key)?.i ?? -1], 4);
        rates[o.key] = decimal(r[rateCols.find((q) => q.key === o.key)?.i ?? -1], 2);
      }
      const q = /q\s*(\d+)/i.exec(norm(at(r, c.qsItem)));
      adjustments.push({ position: adjustments.length + 1, ref, queryNumber: q ? Number(q[1]) : null, description, unit: text(at(r, c.unit)), quantities, rates, basis: text(at(r, c.basis)) });
      continue;
    }

    // Profit and attendance is a percentage of the sum above it, held once as an assumption.
    if (/^profit and attendance/i.test(description)) continue;

    const item = byRef.get(ref);
    if (!item) {
      notes.push(`${ref} is priced in the estimate but is not on the item mapping; its rate was left out.`);
      continue;
    }
    // One mapping row priced as several lines – primer, first coat, final coat – over the same
    // quantity: the rates add, and q × (r1 + r2 + r3) is the three amounts.
    const again = seen.has(ref);
    seen.add(ref);
    for (const { i, key } of rateCols) {
      const rate = decimal(r[i], 2);
      if (rate === null) continue;
      const before = again ? item.rates[key] : null;
      item.rates[key] = before === null ? rate : (Number(before) + Number(rate)).toFixed(2);
    }
    const basis = text(at(r, c.basis));
    if (basis && !(item.rateBasis ?? "").includes(basis)) item.rateBasis = item.rateBasis ? `${item.rateBasis}; ${basis}` : basis;
  }
  return { adjustments, assumptions, found: true };
}

// ── The workbook ──────────────────────────────────────────────────────────────────────────

/**
 * Read a review out of a workbook's sheets.
 *
 * The item mapping is the one section a review cannot be without: the rest are read where present
 * and reported where not, so a workbook with only a mapping and a query list still imports.
 */
export function importReview(sheets: readonly Sheet[], fileName: string): ImportResult {
  const notes: string[] = [];
  const find = <T>(read: (grid: string[][]) => T | null): T | null => {
    for (const s of sheets) {
      const got = read(s.grid);
      if (got !== null) return got;
    }
    return null;
  };

  const mapped = find((g) => items(g, notes));
  if (!mapped || mapped.rows.length === 0) {
    return {
      ok: false,
      reason:
        "No item mapping was found. The workbook needs a sheet headed Ref, Bill, Description, Unit, a Qty column per option, and Status – one row per bill item.",
    };
  }
  if (mapped.options.length === 0) return { ok: false, reason: "The item mapping has no Qty columns, so there is no option to review." };

  const meSheet = sheets.find((s) => /read\s*me/i.test(s.name) || s.grid.some((r) => /^recommended base/i.test(norm(r[0]))));
  const me = meSheet ? readMe(meSheet.grid) : { title: null, subject: null, recommendation: null, limitations: null };
  const register = find(sources);
  const params = find(parameters);
  const asked = find((g) => queries(g, notes));

  // The estimate sheet is the one with a Rate column per option.
  const estimateSheet = sheets.find((s) => headerRow(s.grid, ["ref", "bill", "rate"], 120) >= 0);
  const pricedOut = estimateSheet
    ? priced(estimateSheet.grid, mapped.options, mapped.rows, notes)
    : { adjustments: [], assumptions: { ...DEFAULT_ASSUMPTIONS }, found: false };

  if (!register) notes.push("No sources register was found.");
  if (!params) notes.push("No design parameters sheet was found.");
  if (!asked) notes.push("No queries tracker was found.");
  if (!pricedOut.found) notes.push("No priced estimate was found; the items are unpriced.");

  // The recommended base is whichever option the recommendation names first.
  const rec = me.recommendation ?? "";
  const named = mapped.options
    .map((o) => ({ o, at: rec.toLowerCase().indexOf(o.label.toLowerCase()) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at);

  return {
    ok: true,
    notes,
    review: {
      title: me.title ?? fileName.replace(/\.xlsx?$/i, ""),
      subject: me.subject,
      options: mapped.options,
      baseOption: named[0]?.o.key ?? null,
      recommendation: me.recommendation,
      limitations: me.limitations,
      parameterColumns: params?.columns ?? [],
      assumptions: pricedOut.assumptions,
      sources: register ?? [],
      parameters: params?.rows ?? [],
      items: mapped.rows,
      queries: asked ?? [],
      adjustments: pricedOut.adjustments,
    },
  };
}
