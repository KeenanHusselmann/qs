/**
 * Is this a line of measurable work, or is it the document's furniture?
 *
 * ── What this is for ───────────────────────────────────────────────────────────────────────
 *
 * A bill drafted from three contractors' spreadsheets opened with eight rows like these:
 *
 *     1  BILLS OF QUANTITIES                                                  sum  1,00
 *     3  EMPLOYER: Mzilikazi Property Services (Pty) Ltd / Sagole Capital …   sum  1,00
 *     7  DATE: 21 September 2026                                              sum  1,00
 *
 * Every one of them was correctly grounded — the words really are in the document — so the check
 * that catches invented rows had nothing to say. They are simply not work. A cover page states who
 * the employer is and when the bill was drawn; reading that as a lump-sum item to be priced puts a
 * cell in front of a quantity surveyor asking what the date costs.
 *
 * ── Why the rules are narrow ───────────────────────────────────────────────────────────────
 *
 * Wrongly dropping a real item is far worse than carrying a spurious one: a spurious row is
 * visible and struck out in a second, while a dropped one is invisible and reaches a tender. So
 * these match the two shapes a title block actually takes and nothing more, and anything they set
 * aside is counted and reported rather than silently removed.
 */

/**
 * A title-block field: an upper-case label, then a colon.
 *
 * `EMPLOYER:`, `STRUCTURAL ENGINEER:`, `BILLS PREPARED BY:`, `DATE:`, `OPTION:`. The label is
 * upper case throughout, which is what separates it from a description that happens to contain a
 * colon ("Excavate trench: in soft material" is sentence case and is kept).
 */
const TITLE_FIELD = /^[A-Z][A-Z0-9 &\-/'().]{1,60}:/;

/**
 * A heading: upper case from end to end.
 *
 * "BILLS OF QUANTITIES", "MARSHALL DAM RESIDENTIAL ESTATE — PERIMETER BOUNDARY WALL". A bill
 * description is written in sentence case — "One-brick walling in stock brick" — so the absence of
 * a single lower-case letter across several words is the document shouting a heading at you.
 *
 * Two words at least, because a one-word all-caps entry is as likely to be an abbreviation a
 * description legitimately opens with.
 */
function isHeading(description: string): boolean {
  if (/[a-z]/.test(description)) return false;
  const words = description.split(/\s+/).filter((w) => /[A-Z]/.test(w));
  return words.length >= 2;
}

/** Whether a proposed bill row is a cover-page line rather than work to be priced. */
export function isDocumentFurniture(description: string): boolean {
  const text = description.trim();
  if (text === "") return false;
  return TITLE_FIELD.test(text) || isHeading(text);
}
