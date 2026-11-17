/**
 * Guessing what a document is, from where it sits.
 *
 * ── The folder knows ───────────────────────────────────────────────────────────────────────
 *
 * A real land-use submission arrives as `ANNEXURE E - GEOTECHNICAL REPORT/230-25.R01.pdf`. The
 * filename is a job number; the *folder* is the document kind, spelled out by the professional who
 * assembled it. Asking someone to classify forty files one at a time, when the answer is written on
 * the folder they dragged in, is the mechanical admin this platform exists to remove (§1.1).
 *
 * So the path is scored against the kinds the checklist accepts, and every guess is shown for
 * confirmation before anything is filed. §1.3 forbids a silent default: a wrong kind means a
 * criterion is satisfied by the wrong document, which is worse than an unclassified file. The guess
 * saves the typing; the human keeps the decision.
 *
 * Deliberately not an LLM call. It is a name match against a known list, it runs instantly on forty
 * files with no key and no cost, and when it is wrong it is wrong in ways a reader can see.
 */

/** Words that carry no signal and would otherwise match everything. */
const NOISE = new Set([
  "the", "and", "of", "for", "a", "an", "copy", "final", "draft", "rev", "revision",
  "annexure", "annex", "appendix", "report", "document", "file", "new", "old", "signed",
]);

/**
 * Loose word equality, because real folder names are not written to a schema.
 *
 * Tested against an actual submission, these three cases each cost a classification:
 *
 *  - `ANNEXURE F - ENVIRONMENTAL IMPACT ASSESMENT` — a typo, in the folder, in the real corpus.
 *  - `ANNEXURE H - WATER USE LICENSE` — American spelling against our "licence".
 *  - `Bulk Infra Planning Cost Estimates` — abbreviated, and plural.
 *
 * A QS is not going to rename forty folders to match our vocabulary, and refusing to guess because
 * of one letter is the pedantry that makes software feel hostile. So: singulars collapse, a long
 * enough prefix counts ("infra" for "infrastructure"), and one wrong letter is forgiven on longer
 * words. Short words are matched exactly — at four letters, edit distance one is a different word.
 */
function alike(a: string, b: string): boolean {
  if (a === b) return true;

  // "estimates" / "estimate"
  const sa = a.replace(/s$/, "");
  const sb = b.replace(/s$/, "");
  if (sa === sb) return true;

  // "infra" / "infrastructure"
  const [short, long] = sa.length <= sb.length ? [sa, sb] : [sb, sa];
  if (short.length >= 4 && long.startsWith(short)) return true;

  // "assesment" / "assessment", "license" / "licence"
  if (short.length >= 6 && Math.abs(sa.length - sb.length) <= 1) return withinOneEdit(sa, sb);

  return false;
}

/** Levenshtein, stopped at one. Cheaper and clearer than the full matrix for this question. */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];

  let i = 0;
  let j = 0;
  let slack = 1;

  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) {
      i += 1;
      j += 1;
      continue;
    }
    if (slack === 0) return false;
    slack -= 1;
    // A substitution advances both; an insertion advances only the longer one.
    if (short.length === long.length) i += 1;
    j += 1;
  }

  return long.length - j <= slack;
}

/**
 * How the industry writes these, which is how the folders are named.
 *
 * From the reference corpus, unclassified until this existed:
 *
 *  - `Bulk Services Planning/Roads/… _TIA_Dec 2025_Draft.pdf` — a traffic impact assessment.
 *  - `02 March LAND USE SUBMISSION FOLDER FINAL/ANNEXURE G - ROD/…` — a record of decision. The
 *    folder is named `ROD` because that is what a town planner calls it.
 *  - `Bulk Services Planning/Stormwater/SWMP - Standard/SWMP.txt` — a stormwater management report.
 *
 * The premise of this module is that the folder carries the professional's own classification. It
 * does — in the abbreviation they actually use. Expanding these is not guessing; it is reading the
 * label in the language it was written in.
 *
 * Only unambiguous ones, and only as whole tokens: `Rodney` tokenises to `rodney` and does not
 * match `rod`. An abbreviation that could plausibly mean two kinds is left out, because a wrong
 * kind satisfies a criterion with the wrong document (§1.3) and that is worse than no guess.
 */
const ACRONYMS: Record<string, string> = {
  tia: "traffic impact assessment",
  tis: "traffic impact assessment",
  rod: "record of decision",
  eia: "environmental impact assessment",
  swmp: "stormwater management report",
  sdp: "site development plan",
  wula: "water use licence",
  poa: "power of attorney",
  sla: "service level agreement",
  boq: "priced bill",
};

const words = (text: string): string[] => {
  const tokens = text
    .toLowerCase()
    .replace(/[_\-.]+/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !NOISE.has(w));

  // The abbreviation stays as well as expanding, so a kind that is itself abbreviated still matches.
  return tokens.flatMap((token) =>
    ACRONYMS[token] ? [token, ...ACRONYMS[token]!.split(" ")] : [token],
  );
};

/**
 * Score one candidate kind against a path.
 *
 * Folder segments count for more than the filename, because that is where the submission's own
 * classification lives. A kind matches when most of *its* words appear — "Bulk water report"
 * needs "bulk" and "water", not merely "report", which is why "report" is noise above.
 */
/**
 * Nouns that name a document's *form* rather than its subject.
 *
 * `report` is already noise, so "Stormwater management report" only ever needed "stormwater" and
 * "management". `plan` was not, so "Site location plan" required the literal word `plan` — and
 * `Sheet-Project Site Location.pdf` went unclassified for want of a word no one would put in a
 * filename. The asymmetry was accidental.
 *
 * **Optional only when two distinctive words remain.** That condition is the whole safety of this.
 * Dropping `plan` unconditionally would reduce "Layout plan" to `layout` and "QS cost plan" to
 * `cost` — one common word each, matching half a submission folder. Two specific words agreeing is
 * evidence; one is a coincidence, and §1.3 holds that a wrong kind is worse than no guess, because
 * it satisfies a criterion with the wrong document.
 */
const GENERIC = new Set(["plan"]);

function score(kind: string, segments: string[], filename: string): number {
  const all = words(kind);
  if (all.length === 0) return 0;

  const distinctive = all.filter((word) => !GENERIC.has(word));
  const target = distinctive.length >= 2 ? distinctive : all;

  const inFolders = new Set(segments.flatMap(words));
  const inName = new Set(words(filename));

  let hits = 0;
  let weight = 0;

  const has = (set: Set<string>, word: string) => {
    for (const candidate of set) if (alike(candidate, word)) return true;
    return false;
  };

  for (const word of target) {
    if (has(inFolders, word)) {
      hits += 1;
      weight += 2; // The folder is the professional's own label for the document.
    } else if (has(inName, word)) {
      hits += 1;
      weight += 1;
    }
  }

  // Every word of the kind must be accounted for. A partial match on a two-word kind is a
  // coincidence more often than it is a classification.
  if (hits < target.length) return 0;

  return weight;
}

export interface Guess {
  kind: string | null;
  /** What the guess was made from, so the reader can judge it. */
  because: string | null;
}

/**
 * Best kind for a path, or nothing.
 *
 * `path` is as the browser reports it — "SUBMISSION/ANNEXURE E - GEOTECHNICAL REPORT/230-25.pdf".
 * Returning null is a real answer: an unmatched file is filed by hand rather than mislabelled.
 */
export function inferKind(path: string, kinds: readonly string[]): Guess {
  const parts = path.split(/[/\\]/).filter(Boolean);
  const filename = parts.pop() ?? path;
  const segments = parts;

  let best: string | null = null;
  let bestScore = 0;

  for (const kind of kinds) {
    const value = score(kind, segments, filename);
    if (value > bestScore) {
      best = kind;
      bestScore = value;
    }
  }

  if (!best) return { kind: null, because: null };

  // Name the evidence: the folder if it carried the match, otherwise the filename.
  const folderHit = segments.find((segment) => score(best, [segment], "") > 0);
  return { kind: best, because: folderHit ?? filename };
}
