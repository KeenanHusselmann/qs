/**
 * What a filed document is called, and where it came from.
 *
 * ── The server cannot trust the name it is handed ──────────────────────────────────────────
 *
 * Measured rather than assumed. When a file is chosen through a directory picker, Chrome puts the
 * **relative path** in the multipart `filename` parameter, even though `File.name` inside the page
 * is the plain basename:
 *
 *     File.name             "poa.txt"
 *     Content-Disposition   filename="corpus/ANNEXURE A - POWER OF ATTORNEY/poa.txt"
 *
 * `request.formData()` reads back the second of those. So every document brought in by dropping a
 * folder was filed under its whole import path, and a row that should read `poa.pdf` instead read
 * four folders deep and ran out of column before it reached the name — the one part of it anybody
 * was looking for.
 *
 * ── The path is still worth keeping ────────────────────────────────────────────────────────
 *
 * It is where the professional who assembled the submission chose to put the document, which is
 * both how `inferKind` guesses the kind and how a reader confirms that `ANNEXURE A` is the annexure
 * they think it is. So it is kept as **provenance** — shown quietly beneath the name, never in
 * place of it.
 *
 * A path is also untrusted input. `..` and empty segments are dropped here rather than trusted to
 * be harmless later, because the name reaches a `Content-Disposition` header and the path reaches
 * a screen.
 */

/** Both, because a browser on Windows can send either. */
const SEPARATOR = /[/\\]+/;

export interface FiledName {
  /** What the document is called. Always a bare name — no folders, no separators. */
  name: string;
  /** The path it arrived under, or null when it arrived without one. Provenance only. */
  origin: string | null;
}

const segmentsOf = (raw: string) =>
  raw
    .split(SEPARATOR)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..");

/**
 * Split an uploaded name into the name and its provenance.
 *
 * A name that is only separators or only `..` leaves nothing to show. That is a malformed upload
 * rather than a document called nothing, and it gets a placeholder instead of an empty row — a
 * blank filename is unclickable and unsearchable, and reads as a rendering fault.
 */
export function nameAndOrigin(uploaded: string): FiledName {
  const segments = segmentsOf(uploaded);
  const name = segments.at(-1) ?? "Unnamed document";

  // Separators normalised, so one corpus does not display two kinds of slash.
  const origin = segments.length > 1 ? segments.join("/") : null;

  return { name, origin };
}

/** The folders above a document, outermost first, for showing provenance beside the name. */
export function foldersOf(origin: string | null | undefined): string[] {
  if (!origin) return [];
  return segmentsOf(origin).slice(0, -1);
}
