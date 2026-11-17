/**
 * What kind of thing a document *is* — prose, or geometry.
 *
 * ── Why this is not the same as `kind` ─────────────────────────────────────────────────────
 *
 * `kind` says what a document is called: "Title deed", "Topographical map". This says what can be
 * *done* with it, and the two answers point at different machinery.
 *
 * A title deed is read. Words come out, they go into `passages`, full-text search finds the erf
 * number, and a run quotes the sentence it came from. That is the whole pipeline this platform has
 * built so far, and it works because the value is written down somewhere in the text.
 *
 * A topographical map is **measured**. Nothing useful is written down: the contour interval, the
 * fall across the site, the developable area, the cut-and-fill volume — none of these appear as a
 * sentence anyone could quote. They are recovered from the geometry. Extracting text from a survey
 * drawing yields a title block and a scale bar, which is why filing one today produces a document
 * that satisfies no criterion and looks, wrongly, like a failure.
 *
 * So spatial documents are marked as such and held for the take-off agent rather than fed to the
 * text extractor. This is not a limitation being papered over — it is the correct routing, and it
 * is what lets the platform say "this is a drawing, it will be measured" instead of "nothing
 * readable was found", which is true but useless.
 *
 * ── Vector PDF, not CAD ────────────────────────────────────────────────────────────────────
 *
 * The geometry comes from the issued PDF, which carries real vectors — a drawing of this corpus
 * yielded 117 756 exact segments, walls resolving at 230.4mm and 90.0mm, with the scale
 * self-calibrating at 1:100. No licence, no native binary, no third party, and it is the document a
 * QS would defend anyway because it holds the revision and the title block. See `placement.ts` for
 * why .dwg is held back.
 */

/**
 * Kinds whose value is in their geometry.
 *
 * Named explicitly rather than guessed from the word "plan" or "drawing": a "Site development plan"
 * is spatial, a "Development charge policy" is prose, and a substring match would confuse them.
 */
export const SPATIAL_KINDS: readonly string[] = [
  "Topographical map",
  "Contour survey",
  "Locality map",
  "Locality plan",
  "Layout plan",
  "Land use layout plan",
  "Site development plan",
  "Land surveyor's drawing",
  "SG diagram",
  "Concept drawings",
  "Unit plans",
  // The bill's own evidence, and spatial for the same reason as everything above it: a working
  // drawing's text is its title block. It satisfies the bill's scope criterion by being *filed* —
  // the criterion names a drawing as the evidence it wants — and contributes no passage to the run.
  "Working drawings",
  "Engineering layout",
  "Services layout",
];

export type DocumentClass = "text" | "spatial";

export const classOf = (kind: string): DocumentClass =>
  SPATIAL_KINDS.includes(kind) ? "spatial" : "text";

export const isSpatial = (kind: string) => classOf(kind) === "spatial";

/**
 * What the platform will do with it, said plainly on the import screen.
 *
 * §1.3 — a document that will not be searched must not be filed as though it will. Someone who
 * uploads a survey and sees it counted alongside the market study will reasonably expect a run to
 * find the site area in it.
 */
export const HANDLING: Record<DocumentClass, string> = {
  text: "Read and indexed — a run can quote from it",
  spatial: "Measured, not read — held for take-off",
};
