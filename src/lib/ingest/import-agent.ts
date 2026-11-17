/**
 * Judging what a filed document is worth keeping — PLATFORM.md §1.1, §1.3.2.
 *
 * ── The problem this exists for ────────────────────────────────────────────────────────────
 *
 * A real land-use submission arrives as forty-odd files, and they are not forty documents. The same
 * title deed appears in two annexures. Revision A and revision E of the same sheet are both in the
 * folder because nobody deleted the old one. Half the drawings are locality maps that carry no
 * dimension anybody could cost. A QS filing all of it gets a corpus where a run has to read four
 * copies of the same page and a checklist that looks complete because a cover sheet ticked it.
 *
 * ── The agent proposes; a person archives ──────────────────────────────────────────────────
 *
 * Nothing here removes anything. Every verdict is a proposal with the measurement behind it
 * printed next to it, and withdrawing a document stays a human action — because the one thing worse
 * than a corpus with four copies of a deed is a corpus that silently dropped the copy that turned
 * out to be the signed one.
 *
 * ── The signal is measured, not guessed ────────────────────────────────────────────────────
 *
 * Both A1 sheets below are from the same real project, and the numbers are measured, not estimated:
 *
 * | | Reference map | Technical drawing |
 * |---|---|---|
 * | Drawing operations | 1 230 | 2 256 170 |
 * | Words per page | 183 | 438 |
 *
 * **Text density does not separate them** — 2.4× apart, and both are "a page with a title block and
 * a few labels". Operation count separates them by a factor of 1 835. A raster map placed on a page
 * is one image-draw and a handful of strokes; a vector drawing is every wall, contour and hatch,
 * individually. That is the difference between a document with something to measure and a picture
 * of a location, and it is not visible in the text at all.
 */

/** What the agent thinks should happen to a document. Never what it does. */
export type Verdict = "carries-data" | "reference-only" | "duplicate" | "superseded";

export interface DocumentSignals {
  id: string;
  filename: string;
  kind: string;
  /** True where the kind's value is in its geometry — see `document-class.ts`. */
  spatial: boolean;
  /** Pages the parser found. Zero for a document nothing could be read from. */
  pages: number;
  /** Characters of extracted text across every passage. */
  characters: number;
  /**
   * Drawing operations in the PDF's content streams, where they were counted.
   *
   * Null means not measured — a .docx, or a document filed before this was recorded. A null is
   * never read as zero: "no geometry" and "nobody looked" are different, and treating the second as
   * the first would propose archiving a technical drawing on no evidence.
   */
  operations: number | null;
  /** When it was filed. Decides which of two identical documents is the copy. */
  filedAt: Date;
}

export interface Judgement {
  id: string;
  verdict: Verdict;
  /**
   * The measurement this rests on, as a fact rather than a sentence.
   *
   * It was a full sentence per row — "1 230 drawing operations, a picture placed on a page, not
   * geometry. A technical drawing on this corpus has 2 256 170." Forty of those is forty
   * paragraphs, three quarters of which are the same yardstick repeated, and the number a reader
   * came for is buried mid-clause. The interpretation belongs to the verdict and is stated once for
   * the group; what belongs on the row is the figure that put it there.
   */
  detail: string;
  /** The other document this one duplicates or is superseded by. */
  relatedId?: string;
}

/**
 * Where a drawing stops being a drawing.
 *
 * Two orders of magnitude above the measured reference map and one and a half below the measured
 * technical drawing. Anything in that gap separates the two, so the exact number matters far less
 * than being explicit that it sits in a gap this wide rather than on a boundary someone tuned.
 */
const GEOMETRY_FLOOR = 50_000;

/**
 * Below this, a text document is a cover sheet or an index rather than something to read.
 *
 * Deliberately low. The cost of calling a real document reference-only is that a QS archives
 * evidence; the cost of missing one is a little noise in the corpus. Only the obvious cases.
 */
const TEXT_FLOOR = 400;

/**
 * A revision marker, and what it is a revision *of*.
 *
 * `2500041-CT-001-A1-revE-for info.pdf` is revision E of `2500041-CT-001-A1`, and the folder it
 * came in also holds revisions A through D. Matching this is what lets the agent say "there is a
 * later one of these" instead of leaving five sheets that differ by one letter.
 */
const REVISION = /[-_ ]?\b(?:rev\.?|revision|issue)[-_ ]?([a-z]|\d{1,3})\b/i;
const VERSION = /[-_ ]v(\d{1,3})\b/i;

export interface Revision {
  /** The document without its revision marker, for grouping. */
  stem: string;
  /** Comparable across revisions of one stem. Higher is later. */
  order: number;
}

export function revisionOf(filename: string): Revision | null {
  const withoutExtension = filename.replace(/\.[a-z0-9]+$/i, "");

  const marker = REVISION.exec(withoutExtension) ?? VERSION.exec(withoutExtension);
  if (!marker) return null;

  const token = marker[1]!;
  // Letters sort as letters, numbers as numbers. A revision scheme mixing both in one document is
  // not something to guess at, and each is compared only against its own kind by way of the stem.
  const order = /^\d+$/.test(token) ? Number(token) : token.toLowerCase().charCodeAt(0) - 96;

  const stem = withoutExtension
    .replace(marker[0], " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  return stem ? { stem, order } : null;
}

/**
 * Judge a project's filed documents against each other.
 *
 * Order matters. A duplicate is a duplicate whatever its density, and a superseded sheet should be
 * named as superseded rather than as a thin drawing — the reader's next action differs, and it is
 * the reason each verdict says which document it is talking about.
 */
export function judge(
  documents: readonly DocumentSignals[],
  /** Documents with identical extracted text, grouped by the caller. */
  identicalGroups: readonly (readonly string[])[] = [],
): Judgement[] {
  const byId = new Map(documents.map((d) => [d.id, d]));
  const judgements = new Map<string, Judgement>();

  // ── Duplicates: the same text, filed twice ──────────────────────────────────────────────
  for (const group of identicalGroups) {
    const members = group.map((id) => byId.get(id)).filter((d): d is DocumentSignals => Boolean(d));
    if (members.length < 2) continue;

    // The first one filed is the original; the rest are copies of it. Filing order is the only
    // honest tie-break available — nothing in the documents themselves says which came first.
    const [original, ...copies] = [...members].sort(
      (a, b) => a.filedAt.getTime() - b.filedAt.getTime(),
    );

    for (const copy of copies) {
      judgements.set(copy.id, {
        id: copy.id,
        verdict: "duplicate",
        detail: `identical to ${original!.filename}`,
        relatedId: original!.id,
      });
    }
  }

  // ── Superseded: a later revision of the same sheet is filed ─────────────────────────────
  const revisions = new Map<string, { doc: DocumentSignals; order: number }[]>();
  for (const doc of documents) {
    const revision = revisionOf(doc.filename);
    if (!revision) continue;
    const group = revisions.get(revision.stem) ?? [];
    group.push({ doc, order: revision.order });
    revisions.set(revision.stem, group);
  }

  for (const group of revisions.values()) {
    if (group.length < 2) continue;
    const latest = group.reduce((a, b) => (b.order > a.order ? b : a));

    for (const { doc } of group) {
      if (doc.id === latest.doc.id || judgements.has(doc.id)) continue;
      judgements.set(doc.id, {
        id: doc.id,
        verdict: "superseded",
        detail: `replaced by ${latest.doc.filename}`,
        relatedId: latest.doc.id,
      });
    }
  }

  // ── What is left: does it carry anything? ───────────────────────────────────────────────
  for (const doc of documents) {
    if (judgements.has(doc.id)) continue;
    judgements.set(doc.id, assess(doc));
  }

  return documents.map((d) => judgements.get(d.id)!);
}

function assess(doc: DocumentSignals): Judgement {
  const id = doc.id;

  if (doc.spatial) {
    /**
     * Not measured is not the same as nothing to measure. A drawing filed before operations were
     * counted, or one whose original was not retained, gets the benefit of the doubt — proposing
     * that a QS archive a technical drawing because nobody looked at it would be the single most
     * expensive mistake this agent could make.
     */
    if (doc.operations === null) {
      return { id, verdict: "carries-data", detail: "geometry not counted" };
    }

    const operations = `${doc.operations.toLocaleString()} drawing operations`;

    return doc.operations < GEOMETRY_FLOOR
      ? { id, verdict: "reference-only", detail: operations }
      : { id, verdict: "carries-data", detail: operations };
  }

  if (doc.characters === 0) {
    // Filed, unreadable, and already reported as such at ingest. Not the agent's call to archive:
    // it may be a scan of the one signed document in the folder.
    return { id, verdict: "carries-data", detail: "nothing could be read — may need OCR" };
  }

  if (doc.characters < TEXT_FLOOR) {
    return {
      id,
      verdict: "reference-only",
      detail: `${doc.characters} characters across ${doc.pages || 1} ${doc.pages === 1 ? "page" : "pages"}`,
    };
  }

  return { id, verdict: "carries-data", detail: `${doc.characters.toLocaleString()} characters` };
}

/** How a verdict reads on screen, and whether it is a proposal to act on. */
interface VerdictCopy {
  label: string;
  /** Whether the agent is proposing this one be removed. */
  archive: boolean;
  /** Group headings, read after a count: "3 duplicates", "1 duplicate". */
  one: string;
  many: string;
  /** Said once for the whole group, so no row has to carry the yardstick. */
  explanation: string;
}

export const VERDICTS: Record<Verdict, VerdictCopy> = {
  "carries-data": {
    label: "Carries data",
    archive: false,
    one: "document carries data",
    many: "documents carry data",
    explanation: "Read, measured, and worth keeping. Nothing to do.",
  },
  "reference-only": {
    label: "Reference only",
    archive: true,
    one: "may be reference only",
    many: "may be reference only",
    explanation:
      "A picture placed on a page rather than geometry, or a cover sheet rather than a document. For scale, a technical drawing in this corpus runs to 2 256 170 drawing operations and a reference map to 1 230.",
  },
  duplicate: {
    label: "Duplicate",
    archive: true,
    one: "is filed twice",
    many: "are filed twice",
    explanation: "The same text, filed more than once. The copy filed first is the one kept.",
  },
  superseded: {
    label: "Superseded",
    archive: true,
    one: "has a later revision",
    many: "have later revisions",
    explanation: "A later revision of the same sheet is already filed.",
  },
};
