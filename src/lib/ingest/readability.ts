/**
 * Why a filed document cannot be read, in a quantity surveyor's terms.
 *
 * ── What was wrong with saying "not searchable" ────────────────────────────────────────────
 *
 * "15 filed but not searchable" is the platform describing its own internals. Searchable is our
 * word for whether a passage went into an index; it is not a thing a QS wants, and the line said
 * nothing about what it costs them or what to do next. It also read as a failure, when every one of
 * those documents is safely filed and openable.
 *
 * Worse, it lumped four unrelated situations into one number. A drawing that will be measured
 * rather than read is *working as intended*; a scanned title deed is a real gap that OCR would
 * close; a workbook with a password on it is one the sender can fix in a minute. The count hid the
 * one that mattered among three that did not.
 *
 * So the reason is the thing reported, because the reason is what decides whether anybody needs to
 * do anything.
 */

import { isSpatial } from "./document-class";

export type Reason = "drawing" | "spreadsheet" | "image" | "scan" | "unreadable";

export interface Explanation {
  /** Heading for one of these, and for several. "1 Spreadsheets" is not a sentence. */
  one: string;
  many: string;
  /** What it means for the work — never what it means for the index. */
  meaning: string;
}

export const EXPLANATIONS: Record<Reason, Explanation> = {
  drawing: {
    one: "drawing, which is measured rather than read",
    many: "drawings, which are measured rather than read",
    meaning:
      "Nothing is wrong with these. A drawing's value is its geometry, so it is held for take-off instead of being read for words — see the take-off step.",
  },
  spreadsheet: {
    one: "spreadsheet that would not open",
    many: "spreadsheets that would not open",
    meaning:
      "An .xlsx workbook is read and its figures can be quoted, so these are the ones that would not open — an older .xls or an .ods, or a workbook with a password on it — or that hold only charts and pictures. Re-saving one as an unprotected .xlsx makes its figures usable.",
  },
  image: {
    one: "image, which carries no text",
    many: "images, which carry no text",
    meaning:
      "A photograph or a picture of a page. Kept as part of the record; there is nothing in it for a run to read.",
  },
  scan: {
    one: "scan, where the words are a picture of words",
    many: "scans, where the words are a picture of words",
    meaning:
      "The pages are images, so the text cannot be extracted. Reading them needs OCR, which is not built. If you have the original digital file, filing that as well is what makes it usable.",
  },
  unreadable: {
    one: "file nothing could be read from",
    many: "files nothing could be read from",
    meaning: "Filed and kept, but no text came out of them.",
  },
};

const extensionOf = (filename: string) => filename.toLowerCase().split(".").pop() ?? "";

const SPREADSHEETS = ["xlsx", "xls", "xlsm", "ods", "csv"];
const IMAGES = ["jpg", "jpeg", "png", "gif", "tif", "tiff", "bmp", "webp", "heic"];

/**
 * Which of those a document is.
 *
 * The kind comes first: a drawing filed as a drawing is expected to be unreadable, whatever its
 * extension, and telling someone that is a problem would send them looking for a fix to something
 * that is working.
 */
export function reasonFor(filename: string, kind: string, warning?: string): Reason {
  if (isSpatial(kind)) return "drawing";

  const extension = extensionOf(filename);
  if (SPREADSHEETS.includes(extension)) return "spreadsheet";
  if (IMAGES.includes(extension)) return "image";

  // The parser's own words for a PDF whose every character is drawn rather than encoded.
  if (extension === "pdf" || /scan|OCR/i.test(warning ?? "")) return "scan";

  return "unreadable";
}
