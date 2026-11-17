/**
 * How much geometry a drawing actually contains — PLATFORM.md §10.
 *
 * ── What is being counted, and why it is the right thing ───────────────────────────────────
 *
 * The operators in a PDF's content streams: every stroke, fill, path segment and image placement
 * the page is made of. Measured on two A1 sheets from the same real project:
 *
 * | | Reference map | Technical drawing |
 * |---|---|---|
 * | Drawing operations | 1 230 | 2 256 170 |
 * | Words per page | 183 | 438 |
 *
 * A raster map placed on a page is one image draw and a few strokes. A vector drawing is every
 * wall, contour, hatch and dimension line, individually. The first has nothing for a take-off to
 * measure; the second is the site. **Nothing in the text tells them apart** — 183 words against 438,
 * both of them title block — which is why this is measured rather than inferred.
 *
 * ── Only where the question is geometry ────────────────────────────────────────────────────
 *
 * Building the operator list costs 2.7s on the map and 4.5s on the drawing, and a bulk import is
 * forty files. So it runs for spatial kinds only: a market study is judged on what it says, and
 * counting its strokes would spend four seconds to learn nothing.
 */

/**
 * Count the drawing operations in a PDF.
 *
 * Returns null where the count could not be taken — not zero. "No geometry" and "nobody looked" are
 * different facts, and the import agent treats them differently: a drawing it cannot measure is
 * kept, because proposing that a QS archive a technical drawing on the strength of a failed parse
 * would be the most expensive mistake it could make.
 */
export async function countDrawingOperations(bytes: Uint8Array): Promise<number | null> {
  try {
    const { getDocumentProxy } = await import("unpdf");

    /**
     * A copy, because pdf.js takes ownership of what it is given.
     *
     * It transfers the underlying ArrayBuffer to its worker, which **detaches** it — the caller is
     * left holding a zero-length view. The upload route parses a document and then measures it, and
     * the second call failed with
     *
     *     Cannot transfer object of unsupported type.
     *
     * on a buffer the first had already taken. The symptom was a null measurement, which is
     * indistinguishable from "this is an old document" everywhere it is displayed, so the geometry
     * signal quietly did not exist. Copying here means neither reader can spoil the other's input,
     * whichever order they are called in.
     */
    const pdf = await getDocumentProxy(new Uint8Array(bytes));

    let operations = 0;
    for (let page = 1; page <= pdf.numPages; page++) {
      const { fnArray } = await (await pdf.getPage(page)).getOperatorList();
      operations += fnArray.length;
    }

    return operations;
  } catch (error) {
    // A drawing that cannot be opened is still filed and still held for take-off. The agent will
    // say it has not been counted rather than that it has nothing in it.
    //
    // Logged rather than swallowed. A null here is indistinguishable on screen from a drawing
    // filed before this existed, so a measurement that starts failing for every document would look
    // like nothing at all — the platform would just quietly stop having an opinion.
    console.error(
      `[geometry] could not count drawing operations: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
    return null;
  }
}

/**
 * A fingerprint of what a document says, for finding the same document filed twice.
 *
 * The *text*, not the bytes. Two exports of one deed, or the same page scanned into two annexures,
 * differ in every byte and say exactly the same thing — and a QS looking at a corpus with both of
 * them cares about the second fact, not the first. Whitespace and case are folded away for the same
 * reason they are in `grounding.ts`: they are the differences that are not differences.
 *
 * Null for anything too short to be evidence of sameness. Without that floor every cover sheet and
 * every unreadable scan hashes alike and the agent proposes archiving half the corpus as copies of
 * each other.
 */
export async function fingerprintOf(text: string): Promise<string | null> {
  const normalised = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (normalised.length < 200) return null;

  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(normalised).digest("hex");
}
