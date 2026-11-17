/**
 * Reading a workbook — PLATFORM.md §1.3.2, the parse step for `.xlsx`.
 *
 * ── Why the priced spreadsheet was the next document to read ───────────────────────────────
 *
 * `parse.ts` read pdf, docx, txt, md and csv, and the file it refused on the reference corpus was
 * *Bulk Infra Planning Cost Estimates Rev 4.xlsx*: R305m of civil infrastructure priced by service,
 * by phase and by pipe diameter. It filed, it opened, and nothing in it could ground a criterion or
 * answer a field in a run. The single most valuable document a QS files was, to this platform, an
 * attachment.
 *
 * ── Why there is no library here ───────────────────────────────────────────────────────────
 *
 * §13.2: no dependency without justification, and the two candidates justify themselves badly.
 * SheetJS on npm is pinned at 0.18.5 (2022) and carries two HIGH advisories — GHSA-4r6h-8v6p-xvw6
 * and GHSA-5pgg-2g8v-p4x9 — whose first patched version is **null**, because the fixed releases are
 * published to the vendor's own CDN and never to npm. Installing it means installing those.
 * exceljs brings nine runtime dependencies, among them a zip *writer* and a CSV parser, to do a job
 * that on our side is: unzip, read four XML parts, join the cells.
 *
 * Node already ships the hard half — `zlib.inflateRawSync`. What remains is a zip central directory
 * and OOXML, which is machine-generated and regular. Read-only, and it inflates only the parts it
 * needs, so a workbook's 1.4 MB of embedded images is never touched.
 *
 * ── What a workbook has instead of pages ───────────────────────────────────────────────────
 *
 * Sheets. A sheet is not a page and `p.3` beside a citation would be a lie, so — as with `.docx` —
 * no page number is invented. Instead every line carries its own address in the notation a QS
 * already types into the Name Box:
 *
 *     Summary!I9=Sewer | J9=9701795 | K9=56626765 | L9=66328560
 *
 * The sheet name is on **every** line, not on a heading, because `split.ts` cuts a sheet into
 * 1 200-character passages and only the first would have kept it. And the column letter is on every
 * cell because real estimates put two tables side by side — on this workbook's Sewer sheet columns
 * A–I are Phase 2D and Q–Y are Phase 2E, with the same labels down both. Without the letters those
 * merge into one line of figures and a phase 2E cost reads as a phase 2D cost.
 *
 * Values are the workbook's own stored characters, never re-parsed through a float and re-printed.
 * `9852717.982` is what the file holds and what a run will quote; the `R 9 852 717,98` a QS sees is
 * their display format, applied to this number.
 */

import { inflateRawSync } from "node:zlib";

/** One sheet's readable content, already addressed. */
export interface SheetText {
  name: string;
  text: string;
}

export interface WorkbookText {
  sheets: SheetText[];
  /** Why nothing could be read, when nothing could. Never silent (§1.3). */
  warning?: string;
}

/**
 * A failure with something useful to say.
 *
 * Thrown for the cases worth naming — a protected workbook, a file that is not one — and caught at
 * the bottom of this module so the reader gets the sentence rather than a stack. Anything else
 * propagates to `parse.ts`, which files the document and reports the raw error rather than
 * pretending to understand it.
 */
class Unreadable extends Error {}

// ── The container ───────────────────────────────────────────────────────────────────────────

const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;

/** The longest trailing comment a zip may carry, and so how far back the directory can hide. */
const MAX_COMMENT = 0xffff;

/**
 * A ceiling on what one workbook may inflate to.
 *
 * Compression ratios on a spreadsheet are enormous — this corpus's estimate is 2.5 MB holding
 * 4.2 MB of parts, and a sheet of repeated numbers does far better than that. Uploads are capped at
 * 64 MB, which bounds nothing useful once a zip is allowed to expand freely, so the parts are
 * budgeted and `inflateRawSync` is given a hard limit of its own rather than trusting the size the
 * archive declares about itself.
 */
const MAX_INFLATED_BYTES = 200 * 1024 * 1024;

/**
 * A ceiling on the text one workbook may contribute to the corpus.
 *
 * §6.8 puts a real bill at 2 000–15 000 items; at roughly 100 characters a row that is 1.5 MB, so
 * this clears the realistic worst case three times over. Beyond it the workbook is a database
 * export rather than a document, and the reader stops and says so instead of filling `passages`
 * with a million rows nobody will ever read.
 */
const MAX_RENDERED_CHARS = 5_000_000;

interface Entry {
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  offset: number;
  encrypted: boolean;
}

const decoder = new TextDecoder();

/** Microsoft's pre-2007 compound-file magic: a real `.xls`, or an encrypted `.xlsx`. */
const COMPOUND_FILE = [0xd0, 0xcf, 0x11, 0xe0];

function centralDirectory(bytes: Uint8Array, view: DataView): Map<string, Entry> {
  if (COMPOUND_FILE.every((byte, i) => bytes[i] === byte)) {
    throw new Unreadable(
      "This workbook is password-protected, or it was saved in the older .xls format under an " +
        ".xlsx name. Saving an unprotected copy as .xlsx makes its figures readable.",
    );
  }

  let eocd = -1;
  const earliest = Math.max(0, bytes.byteLength - 22 - MAX_COMMENT);
  for (let i = bytes.byteLength - 22; i >= earliest; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Unreadable("This file is not a workbook — it is not a zip archive.");

  const count = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);

  // ZIP64 puts sentinels here and the real figures in a second directory. No workbook a QS files
  // reaches four gigabytes or 65 535 parts; saying so beats reading the sentinel as a length.
  if (count === 0xffff || cursor === 0xffffffff) {
    throw new Unreadable("This workbook uses a zip format (ZIP64) this reader does not open.");
  }

  const entries = new Map<string, Entry>();

  for (let n = 0; n < count; n++) {
    if (view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) {
      throw new Unreadable("This workbook's zip directory is damaged.");
    }

    const flags = view.getUint16(cursor + 8, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));

    entries.set(name, {
      method: view.getUint16(cursor + 10, true),
      compressedSize: view.getUint32(cursor + 20, true),
      uncompressedSize: view.getUint32(cursor + 24, true),
      offset: view.getUint32(cursor + 42, true),
      encrypted: (flags & 1) === 1,
    });

    cursor += 46 + nameLength + extraAndComment(view, cursor);
  }

  return entries;
}

const extraAndComment = (view: DataView, cursor: number) =>
  view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);

/**
 * One part, inflated.
 *
 * The local header is re-read for the name and extra lengths rather than reusing the directory's:
 * writers routinely pad one and not the other, and starting the data a few bytes out produces an
 * inflate failure that reads like a corrupt file.
 */
function partOf(bytes: Uint8Array, view: DataView, entry: Entry, budget: { left: number }): string {
  if (entry.encrypted) {
    throw new Unreadable("This workbook is password-protected, so its sheets cannot be read.");
  }
  if (entry.method !== 0 && entry.method !== 8) {
    throw new Unreadable(`This workbook is compressed in a way this reader does not open (${entry.method}).`);
  }
  if (entry.uncompressedSize > budget.left) {
    throw new Unreadable("This workbook is too large to read.");
  }

  const from =
    entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true);
  const raw = bytes.subarray(from, from + entry.compressedSize);

  // The declared size is the archive's claim about itself; the limit is ours. A zip bomb overstates
  // its compression and understates its length, and only one of those two numbers is enforceable.
  const inflated = entry.method === 0 ? raw : inflateRawSync(raw, { maxOutputLength: budget.left });
  budget.left -= inflated.byteLength;

  return decoder.decode(inflated);
}

// ── XML, of the narrow kind OOXML actually is ───────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeXml(text: string): string {
  if (!text.includes("&")) return text;

  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] !== "#") return NAMED_ENTITIES[code.toLowerCase()] ?? whole;

    const point =
      code[1]?.toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));

    // Out of range, or half of a surrogate pair: leaving the escape as written is safer than
    // emitting a character `String.fromCodePoint` would refuse or Postgres would reject.
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
      ? String.fromCodePoint(point)
      : whole;
  });
}

const attribute = (tag: string, name: string): string | undefined =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];

/** Phonetic guides carry their own `<t>` and are not part of the string. */
const PHONETIC = /<rPh\b[\s\S]*?<\/rPh>/g;

/**
 * A run's text, with the empty shape matched **first**.
 *
 * `<t/>` is a legal empty run, and a pattern that only knows `<t>…</t>` reads the `/>` as the end
 * of an opening tag and then runs forward to the *next* run's `</t>`, swallowing the markup
 * between them into the string. Same trap in `<si/>` below. Both cost a wrong label rather than an
 * error, which is why they are matched explicitly rather than left to the greedy case.
 */
const RUN_TEXT = /<t\b[^>]*\/>|<t\b[^>]*>([\s\S]*?)<\/t>/g;

/**
 * The text of a shared string or an inline one.
 *
 * Every run joined, not the first: this corpus's Roads sheet writes `Area(m²)` as three runs —
 * `Area(m`, a superscripted `2`, and `)` — because someone superscripted one character. Taking the
 * first `<t>` reads that column heading as `Area(m`.
 */
function runsOf(xml: string): string {
  return [...xml.replace(PHONETIC, "").matchAll(RUN_TEXT)]
    .map((match) => (match[1] === undefined ? "" : decodeXml(match[1])))
    .join("");
}

// ── Number formats, and the one that must not be read as a number ───────────────────────────

type Presentation = "date" | "time" | null;

/** Excel's reserved date and time formats, which carry no format code of their own. */
const BUILT_IN_DATES = new Map<number, Presentation>([
  [14, "date"], [15, "date"], [16, "date"], [17, "date"],
  [18, "time"], [19, "time"], [20, "time"], [21, "time"],
  [22, "date"],
  [45, "time"], [46, "time"], [47, "time"],
]);

/**
 * What a format code says the number is.
 *
 * Quoted literals, `[$R-1C09]` currency locales and `\`-escaped characters are stripped first: a
 * South African currency format is `"R"#,##0.00`, and the `R` in it is not a date token.
 */
function presentationOf(code: string): Presentation {
  const bare = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, "");

  if (/[yd]/i.test(bare)) return "date";
  // `mm` alone is ambiguous — minutes or months — so a code with hours or seconds and no day or
  // year is read as a duration rather than as a date in 1899.
  if (/[hs]/i.test(bare)) return "time";
  return /m/i.test(bare) ? "date" : null;
}

/** Per cell-format index, what its number should be read as. */
function presentations(stylesXml: string): Presentation[] {
  const custom = new Map<number, Presentation>();
  for (const match of stylesXml.matchAll(/<numFmt\b[^>]*\/?>/g)) {
    const id = Number(attribute(match[0], "numFmtId"));
    if (Number.isInteger(id)) {
      custom.set(id, presentationOf(decodeXml(attribute(match[0], "formatCode") ?? "")));
    }
  }

  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? "";

  return [...cellXfs.matchAll(/<xf\b[^>]*>/g)].map((match) => {
    const id = Number(attribute(match[0], "numFmtId") ?? 0);
    return custom.get(id) ?? BUILT_IN_DATES.get(id) ?? null;
  });
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A date the way the workbook means it, not the way it is stored.
 *
 * A date cell holds a day count — `45 292` for 1 January 2024 — and the format is the only thing
 * that says so. Written into the corpus as `45292` it is a five-digit number sitting in a column of
 * quantities, indistinguishable from one, and quotable as one.
 */
function fromSerial(serial: number, as: Presentation, epoch1904: boolean): string | null {
  if (as === null || !Number.isFinite(serial) || serial < 0) return null;

  if (as === "time") {
    // Elapsed formats (`[h]:mm:ss`) run past 24 hours, so hours are counted rather than wrapped.
    const seconds = Math.round(serial * 86_400);
    return `${Math.floor(seconds / 3600)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
  }

  let days = Math.floor(serial);
  let seconds = Math.round((serial - days) * 86_400);
  if (seconds === 86_400) {
    days += 1;
    seconds = 0;
  }

  // 1900 counts a 29 February that never happened, so a serial past it is one day ahead of the
  // arithmetic. Lotus had the bug, Excel kept it for compatibility, and every file since carries it.
  if (!epoch1904 && days === 60) return "1900-02-29";

  const epoch = epoch1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, days < 60 ? 31 : 30);
  const at = new Date(epoch + days * 86_400_000);

  const date = `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
  if (seconds === 0) return date;

  return `${date} ${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}`;
}

// ── Cells ───────────────────────────────────────────────────────────────────────────────────

/** A formula's failure is not a figure. Quoting `#REF!` as evidence would be quoting nothing. */
const FORMULA_ERROR = /^#(REF|DIV\/0|VALUE|NAME\?|NUM|N\/A|NULL|ERROR|GETTING_DATA)!?$/;

const CELL_REFERENCE = /\br="([A-Z]+)(\d+)"/;
const CELL_TYPE = /\bt="([A-Za-z]+)"/;
const CELL_STYLE = /\bs="(\d+)"/;
const VALUE = /<v>([\s\S]*?)<\/v>/;

function columnNumber(letters: string): number {
  let column = 0;
  for (const letter of letters) column = column * 26 + (letter.charCodeAt(0) - 64);
  return column;
}

function columnLetters(column: number): string {
  let letters = "";
  for (let n = column; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return letters;
}

interface Workbook {
  shared: string[];
  formats: Presentation[];
  epoch1904: boolean;
}

function cellValue(attributes: string, body: string, workbook: Workbook): string | null {
  const type = CELL_TYPE.exec(attributes)?.[1];
  if (type === "e") return null;

  const raw = VALUE.exec(body)?.[1];

  if (type === "s") {
    const index = Number(raw);
    return workbook.shared[index] ?? null;
  }
  if (type === "inlineStr") return runsOf(body);
  if (raw === undefined) return null;
  if (type === "b") return raw === "1" ? "TRUE" : "FALSE";
  // `str` is a formula's cached text; `d` an ISO date some writers store directly. Both are already
  // the characters the sheet shows.
  if (type === "str" || type === "d") return decodeXml(raw);

  const style = Number(CELL_STYLE.exec(attributes)?.[1] ?? -1);
  const shown = fromSerial(Number(raw), workbook.formats[style] ?? null, workbook.epoch1904);

  return shown ?? raw;
}

// ── Sheets ──────────────────────────────────────────────────────────────────────────────────

/** `<row …>` and `<c …>`, either shape, in document order. */
const TOKEN = /<row\b([^>]*)>|<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;

/**
 * Which columns the sheet does not show.
 *
 * Not cosmetic, and this corpus proves it. Columns B–E of the Summary sheet are hidden and hold a
 * superseded copy of the estimate: `#REF!` where a total should be, `#ERROR!` where a sum should be,
 * and a primary-bulk figure of 19 403 590 against the 103 966 787 in the visible columns. Read them
 * and the corpus holds two answers to "what do the bulk services cost", one of which the QS cannot
 * find in their own file — §1.3.2's promise is that a citation can be checked by opening the
 * document, and a hidden cell cannot be.
 */
function hiddenColumnsOf(sheetXml: string): Set<number> {
  const hidden = new Set<number>();

  for (const match of sheetXml.matchAll(/<col\b[^>]*\/?>/g)) {
    if (!/\bhidden="(1|true)"/.test(match[0])) continue;

    const from = Number(attribute(match[0], "min") ?? 0);
    const to = Number(attribute(match[0], "max") ?? 0);
    for (let column = from; column <= to && column - from < 16_384; column++) hidden.add(column);
  }

  return hidden;
}

/** One decoded cell, addressed. Both readers below walk the sheet through this and no other way. */
interface Cell {
  row: number;
  /** 1-based, so column A is 1. */
  column: number;
  letters: string;
  value: string;
}

/**
 * Every visible, non-empty cell of a sheet, in document order.
 *
 * ── Why this is a generator rather than two loops ──────────────────────────────────────────
 *
 * There are two things worth doing with a sheet: joining it into addressed lines for retrieval,
 * and laying it out as a grid so an import can read a column. They need the same walk — the same
 * fallback when a writer omits a cell reference, the same hidden rows and columns, the same value
 * decoding, the same refusal of formula errors — and a second copy of that walk is a copy that
 * drifts. It would drift silently, too: a sheet that indexes correctly and imports one column to
 * the left is a wrong rate with nothing on screen to say so.
 */
function* cellsOf(sheetXml: string, workbook: Workbook): Generator<Cell> {
  const hiddenColumns = hiddenColumnsOf(sheetXml);
  const body = /<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/.exec(sheetXml)?.[1] ?? "";

  let row = 0;
  let column = 0;
  let rowHidden = false;

  for (const token of body.matchAll(TOKEN)) {
    if (token[1] !== undefined) {
      row = Number(attribute(token[1], "r") ?? row + 1);
      rowHidden = /\bhidden="(1|true)"/.test(token[1]);
      column = 0;
      continue;
    }

    const attributes = token[2] ?? "";
    const reference = CELL_REFERENCE.exec(attributes);

    if (reference) {
      column = columnNumber(reference[1]!);
      // A cell's own reference is the authority on which row it is in; `<row r=…>` is only where
      // the hidden flag lives.
      row = Number(reference[2]);
    } else {
      // Position is the fallback where a writer omits references, which the format permits.
      column += 1;
    }

    if (rowHidden || hiddenColumns.has(column)) continue;

    /**
     * A cell's own line breaks are folded away, because the row is the record.
     *
     * A header cell in one real export holds three lines — the practice name, the report title and
     * the period. Left as they are, two of those become lines with no address on them, and the
     * whole design here rests on every line naming its sheet and cell. Nothing is lost that
     * matters: `grounding.ts` folds whitespace before matching, so a quote spanning the break is
     * still found either way.
     */
    const value = cellValue(attributes, token[3] ?? "", workbook)?.replace(/\s+/g, " ").trim();
    if (!value || FORMULA_ERROR.test(value)) continue;

    yield { row, column, letters: reference ? reference[1]! : columnLetters(column), value };
  }
}

function readSheet(sheetXml: string, name: string, workbook: Workbook, budget: { left: number }) {
  const lines: string[] = [];
  let line: string[] = [];
  let at = 0;
  let truncated = false;

  const flush = () => {
    if (line.length > 0) lines.push(`${name}!${line.join(" | ")}`);
    line = [];
  };

  for (const { row, letters, value } of cellsOf(sheetXml, workbook)) {
    if (row !== at) {
      flush();
      at = row;
    }

    if (budget.left <= 0) {
      truncated = true;
      break;
    }

    const cell = `${letters}${row}=${value}`;
    budget.left -= cell.length;
    line.push(cell);
  }

  flush();

  if (truncated) {
    lines.push(`${name}: the rest of this sheet is longer than can be indexed and was not read.`);
  }

  return lines.join("\n");
}

/**
 * A sheet laid out as rows of cells — what an import reads, as against what retrieval indexes.
 *
 * Sparse in the file and dense here: a row that skips column C yields nothing for it, and a grid
 * with a hole where a column should be would silently shift every later column left. So gaps are
 * filled with empty strings and every row is padded to the widest one. An import maps a *column
 * position* to a field, and that mapping is only safe if the positions are real.
 *
 * Rows are returned in file order and are **not** trimmed of leading blank rows. A spreadsheet a
 * practice actually sends has a title and a blank line above the header, and finding the header is
 * the caller's job — throwing rows away here would hide the thing the caller needs to look at.
 */
export function sheetGrid(sheetXml: string, workbook: Workbook): string[][] {
  const byRow = new Map<number, Map<number, string>>();
  let widest = 0;

  for (const { row, column, value } of cellsOf(sheetXml, workbook)) {
    const cells = byRow.get(row) ?? new Map<number, string>();
    cells.set(column, value);
    byRow.set(row, cells);
    if (column > widest) widest = column;
  }

  return [...byRow.keys()]
    .sort((a, b) => a - b)
    .map((row) => {
      const cells = byRow.get(row)!;
      return Array.from({ length: widest }, (_, i) => cells.get(i + 1) ?? "");
    });
}

// ── The workbook ────────────────────────────────────────────────────────────────────────────

/** A relationship target, resolved against the package root. */
function resolve(target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const cleaned = target.replace(/^\.\//, "");
  return cleaned.startsWith("../") ? cleaned.slice(3) : `xl/${cleaned}`;
}

/**
 * The workbook's strings, in the order a cell indexes them by.
 *
 * An empty `<si/>` still occupies a position. Dropping it shifts every label after it onto the
 * wrong cell — which does not fail, it just quietly labels the sewer figure "Water".
 */
function sharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si\b[^>]*\/>|<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) =>
    match[1] === undefined ? "" : runsOf(match[1]),
  );
}

/**
 * Every visible sheet's cells, addressed and joined.
 *
 * Hidden sheets are left out for the same reason as hidden columns: they are where a superseded
 * version of the estimate lives, and a figure nobody can see in the file is a figure nobody can
 * check.
 */
/**
 * Open the package and yield each visible sheet's XML, with the workbook it must be read against.
 *
 * The zip central directory, the relationship targets, the shared strings, the number formats and
 * the 1904 epoch are the same work whichever way a sheet is then read — as addressed lines for
 * retrieval, or as a grid for an import. Extracted so there is one of it: a second copy would be a
 * second place for a hidden sheet to start being read, and hidden sheets are where a superseded
 * estimate lives.
 */
function* sheetsOf(bytes: Uint8Array): Generator<{ name: string; xml: string; workbook: Workbook }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = centralDirectory(bytes, view);
  const budget = { left: MAX_INFLATED_BYTES };

  const read = (name: string): string | null => {
    const entry = entries.get(name);
    return entry ? partOf(bytes, view, entry, budget) : null;
  };

  const workbookXml = read("xl/workbook.xml");
  if (workbookXml === null) {
    throw new Unreadable("This file is a zip archive, but there is no workbook inside it.");
  }

  const targets = new Map(
    [...(read("xl/_rels/workbook.xml.rels") ?? "").matchAll(/<Relationship\b[^>]*\/?>/g)].map(
      (match) => [attribute(match[0], "Id") ?? "", resolve(attribute(match[0], "Target") ?? "")],
    ),
  );

  const workbook: Workbook = {
    shared: sharedStrings(read("xl/sharedStrings.xml") ?? ""),
    formats: presentations(read("xl/styles.xml") ?? ""),
    epoch1904: /<workbookPr\b[^>]*\bdate1904="(1|true)"/.test(workbookXml),
  };

  for (const [index, match] of [...workbookXml.matchAll(/<sheet\b[^>]*\/?>/g)].entries()) {
    const state = attribute(match[0], "state");
    if (state === "hidden" || state === "veryHidden") continue;

    const path = targets.get(attribute(match[0], "r:id") ?? "") ?? `xl/worksheets/sheet${index + 1}.xml`;
    const xml = read(path);
    if (xml === null) continue;

    yield { name: decodeXml(attribute(match[0], "name") ?? `Sheet${index + 1}`), xml, workbook };
  }
}

/**
 * Every visible sheet, as a grid — what an import reads.
 *
 * Returns the sheets rather than picking one: a practice's rate schedule arrives with a Cover and
 * a Notes tab beside the rates, and which one holds the table is the reader's call, made from a
 * preview. Guessing it here would be a guess nobody could see being made.
 */
export function readWorkbookGrids(
  bytes: Uint8Array,
): { sheets: { name: string; grid: string[][] }[]; warning?: string } {
  try {
    const sheets = [...sheetsOf(bytes)].map(({ name, xml, workbook }) => ({
      name,
      grid: sheetGrid(xml, workbook),
    }));

    const withRows = sheets.filter((s) => s.grid.length > 0);
    if (withRows.length === 0) {
      return { sheets: [], warning: "This workbook has no cell values to read." };
    }

    return { sheets: withRows };
  } catch (error) {
    if (error instanceof Unreadable) return { sheets: [], warning: error.message };
    throw error;
  }
}

export function readWorkbook(bytes: Uint8Array): WorkbookText {
  try {
    const rendering = { left: MAX_RENDERED_CHARS };
    const sheets: SheetText[] = [];

    for (const { name, xml, workbook } of sheetsOf(bytes)) {
      const text = readSheet(xml, name, workbook, rendering);
      if (text) sheets.push({ name, text });
    }

    if (sheets.length === 0) {
      return {
        sheets: [],
        warning:
          "This workbook has no cell values to read — its sheets hold only charts, images or " +
          "hidden columns. It is filed and can be opened.",
      };
    }

    return { sheets };
  } catch (error) {
    if (error instanceof Unreadable) return { sheets: [], warning: error.message };
    throw error;
  }
}

/** Exposed for tests: the sheet reader, without a zip around it. */
export const readSheetXml = (
  sheetXml: string,
  name: string,
  workbook: Partial<Workbook> = {},
): string =>
  readSheet(
    sheetXml,
    name,
    { shared: [], formats: [], epoch1904: false, ...workbook },
    { left: MAX_RENDERED_CHARS },
  );

/** Exposed for tests, which need to build the pieces a sheet is read against. */
export const forTesting = { sharedStrings, presentations, fromSerial, decodeXml };
