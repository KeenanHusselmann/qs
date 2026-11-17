/**
 * Reading a rate schedule out of a spreadsheet — PLATFORM.md §12 (Tier 1), §6.3.
 *
 * ── Why this is how pricing data actually arrives ──────────────────────────────────────────
 *
 * The cost-management work was specified as *"integrate industry pricing APIs"*. Researched, and
 * there are none. The AAQS publishes a PDF cost guide and an Excel questionnaire; the BER's BCIS
 * is a login-gated quarterly subscription delivering a data file and a PDF, one registered user
 * per company; StatsSA's construction material price indices are monthly PDF publications. Not
 * one offers a feed.
 *
 * What every one of them does offer is **a document on a schedule**. So the import is the
 * integration, and it suits this platform better than an API would have: a rate that arrives with
 * a source and a date is a rate §1.3.1 can defend, where a figure fetched from an endpoint at an
 * unrecorded moment is not.
 *
 * ── The source and the date are asked once, not read per row ───────────────────────────────
 *
 * A SAFCEC quarterly or a BER release is one publication: every rate in it shares an origin and an
 * effective date. Reading those only from columns would invite a file where half the rows carry
 * them and half do not, and the two halves would be filed differently. So they are asked for at
 * import and applied to the sheet — while a column, where the file has one, still wins for its row.
 *
 * No database in here. The preview runs in the browser before anything is written.
 */

import { REGIONS, TRADES, parseRate, type LibraryRate } from "@/lib/rates";

/** What a column turns out to be. `null` where the header meant nothing to us. */
export type Field =
  | "trade"
  | "description"
  | "unit"
  | "rate"
  | "region"
  | "source"
  | "effectiveDate";

/**
 * The header words this recognises, lower-cased.
 *
 * Generous on purpose: the same column is "Rate", "Rate (ZAR)", "Price" and "Unit rate" across the
 * schedules a practice receives, and a reader whose file is refused over a synonym will go back to
 * the spreadsheet and not return. What is deliberately **not** generous is the guessing — an
 * unrecognised column is reported as unrecognised, never assigned by position.
 */
const HEADERS: Readonly<Record<Field, readonly string[]>> = {
  trade: ["trade", "work group", "workgroup", "element", "section", "category"],
  description: ["description", "item", "item description", "work", "particulars"],
  unit: ["unit", "uom", "unit of measure"],
  rate: ["rate", "rate (zar)", "rate zar", "price", "unit rate", "amount"],
  region: ["region", "province", "area", "location"],
  source: ["source", "reference", "basis", "authority"],
  effectiveDate: ["effective date", "effective", "date", "from", "as at", "valid from"],
};

const normalise = (cell: string) => cell.trim().toLowerCase().replace(/\s+/g, " ");

/** The field a header cell names, or null. */
export function fieldOf(cell: string): Field | null {
  const text = normalise(cell);
  if (text === "") return null;

  for (const [field, words] of Object.entries(HEADERS) as [Field, readonly string[]][]) {
    if (words.includes(text)) return field;
  }
  return null;
}

/**
 * Which row is the header, and what its columns mean.
 *
 * Scans for the row naming the most fields rather than taking the first, because a real schedule
 * opens with a title, a practice name and a blank line — reading row one would treat "Rate schedule
 * 2026" as a header of one unrecognised column and then import the actual header as data.
 *
 * A row must name **description and rate** before it counts as the header. Those two are what a
 * rate is; a stray "Region" label above the table would otherwise be taken for the header and the
 * whole file would import one row late.
 */
export function findHeader(
  grid: readonly (readonly string[])[],
): { at: number; columns: (Field | null)[] } | null {
  let best: { at: number; columns: (Field | null)[]; named: number } | null = null;

  // Only the first fifteen rows. Beyond that it is not a preamble, it is a different kind of file.
  for (let at = 0; at < Math.min(grid.length, 15); at++) {
    const columns = (grid[at] ?? []).map(fieldOf);
    const named = columns.filter(Boolean).length;

    if (!columns.includes("description") || !columns.includes("rate")) continue;
    if (!best || named > best.named) best = { at, columns, named };
  }

  return best ? { at: best.at, columns: best.columns } : null;
}

/** A row of the sheet, read — with whatever stopped it being importable. */
export interface ImportRow {
  /** 1-based line in the sheet, so a refusal can say where to look. */
  line: number;
  draft: Omit<LibraryRate, "id" | "createdBy"> | null;
  problems: string[];
}

/**
 * Read the rows under the header into drafts.
 *
 * Every row is returned, importable or not. A preview that silently dropped the eleven rows it
 * could not read would tell a practice its four-hundred-rate schedule imported fine — §1.3, a gap
 * is reported rather than passed over.
 */
export function readRateSheet(
  grid: readonly (readonly string[])[],
  defaults: { source: string; effectiveDate: string },
): { header: { at: number; columns: (Field | null)[] } | null; rows: ImportRow[] } {
  const header = findHeader(grid);
  if (!header) return { header: null, rows: [] };

  const indexOf = (field: Field) => header.columns.indexOf(field);
  const at = {
    trade: indexOf("trade"),
    description: indexOf("description"),
    unit: indexOf("unit"),
    rate: indexOf("rate"),
    region: indexOf("region"),
    source: indexOf("source"),
    effectiveDate: indexOf("effectiveDate"),
  };

  const cell = (row: readonly string[], column: number) =>
    column === -1 ? "" : (row[column] ?? "").trim();

  const rows: ImportRow[] = [];

  for (let i = header.at + 1; i < grid.length; i++) {
    const row = grid[i] ?? [];
    // A wholly blank row is a spacer, not a failure. Schedules are full of them.
    if (row.every((c) => c.trim() === "")) continue;

    const description = cell(row, at.description);
    const unit = cell(row, at.unit);
    const typed = cell(row, at.rate);

    /*
      A section heading inside the schedule — "CONCRETE WORK" alone on a line, no unit, no rate.
      Not a rate, and not a fault, so it is skipped rather than reported: a file covering twelve
      trades would otherwise open its preview with twelve refusals a reader has to read past.

      **Neither a unit nor a rate is the test**, not "a description and nothing else". Real
      schedules put the heading in the *trade* column and leave the description empty, which the
      first version read as a row missing three fields — a preview of a nine-row file reported four
      refusals where there were two, and the two that mattered were buried among them.

      Nothing importable is lost by this. A row with no unit and no rate cannot be filed whatever
      else it carries, so the only question is whether it is worth a reader's attention, and a
      heading is not.
    */
    if (unit === "" && typed === "") continue;

    const problems: string[] = [];
    if (description === "") problems.push("No description.");
    if (unit === "") problems.push("No unit.");

    const parsed = typed === "" ? null : parseRate(typed);
    if (typed === "") problems.push("No rate.");
    else if (!parsed) problems.push(`Could not read "${typed}" as a rate.`);

    /*
      A province spelled the file's own way is reported rather than guessed. "KZN" and
      "Kwazulu Natal" are obvious to a reader and not a match this can make safely — a rate filed
      under the wrong province is worse than a row refused, because it will be used.
    */
    const region = cell(row, at.region);
    const knownRegion = REGIONS.find((r) => normalise(r) === normalise(region));
    if (region !== "" && !knownRegion) {
      problems.push(`"${region}" is not one of the nine provinces.`);
    }

    const trade = cell(row, at.trade);
    const knownTrade = TRADES.find((t) => normalise(t) === normalise(trade));

    const source = cell(row, at.source) || defaults.source;
    const effectiveDate = cell(row, at.effectiveDate) || defaults.effectiveDate;

    if (source.trim() === "") problems.push("No source, and none given for the file.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
      problems.push(`"${effectiveDate}" is not a date the library can file — use yyyy-mm-dd.`);
    }

    rows.push({
      line: i + 1,
      problems,
      draft:
        problems.length > 0 || !parsed
          ? null
          : {
              /*
                Unclassified is a fact (§6.9), and a trade the file spells differently is not
                invented into one of ours — it simply does not classify the rate. The row still
                imports, because a rate nobody has classified is still a rate.
              */
              trade: knownTrade ?? null,
              description,
              unit,
              rate: parsed.value,
              ratePrecision: parsed.precision,
              region: knownRegion ?? null,
              source: source.trim(),
              effectiveDate,
            },
    });
  }

  return { header, rows };
}

/**
 * Read a CSV the way a spreadsheet exports one.
 *
 * Quoted fields, doubled quotes inside them, and a delimiter **detected rather than assumed**: an
 * Excel set to a comma decimal — which is the South African default (§7.7) — writes semicolons, and
 * a file that imports as one column per row is the commonest way this goes wrong.
 */
export function readCsv(text: string): string[][] {
  // A byte-order mark on the first header cell makes it match no known header word.
  const body = text.replace(/^﻿/, "");

  const firstBreak = body.indexOf("\n");
  const firstLine = firstBreak === -1 ? body : body.slice(0, firstBreak);
  const semicolons = firstLine.split(";").length - 1;
  const commas = firstLine.split(",").length - 1;
  const delimiter = semicolons > commas ? ";" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;

    if (quoted) {
      if (ch !== '"') field += ch;
      else if (body[i + 1] === '"') {
        field += '"';
        i += 1;
      } else quoted = false;
      continue;
    }

    if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }

  if (field !== "" || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  // Dense, for the reason `sheetGrid` is: a column index has to mean the same thing on every row.
  const widest = rows.reduce((w, r) => Math.max(w, r.length), 0);
  return rows.map((r) => Array.from({ length: widest }, (_, i) => r[i] ?? ""));
}
