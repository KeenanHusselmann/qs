/**
 * How a date is written — PLATFORM.md §7.7.
 *
 * > Dates: `12 Aug 2026` in UI · ISO in exports · **never `08/12/26`**
 *
 * ── Why the rule is a rule ─────────────────────────────────────────────────────────────────
 *
 * `08/12/26` is 8 December to a South African reader and 12 August to an American one, and there
 * is nothing in the string that says which. On a payment certificate, a practical completion date
 * or a variation instruction, that ambiguity is the kind a dispute turns on two years later —
 * which is exactly the material this platform holds. A named month cannot be read two ways.
 *
 * ── What was actually rendering ────────────────────────────────────────────────────────────
 *
 * `new Date(iso).toLocaleDateString("en-ZA")` returns `2026/08/28`. Not the American ordering, so
 * not wrong to a local reader — but numeric, slash-separated, and precisely the shape §7.7 names
 * as the one to avoid. It was declared seven times: once each in the run panel, the bill panel,
 * the dashboard, pricing, project data, and inline in the checklist card. Seven copies of a
 * convention is how a convention stops being one; this is the seventh copy replaced by the first
 * shared function.
 *
 * ── And why the month is not asked of a locale ─────────────────────────────────────────────
 *
 * This used `en-GB` with `{ month: "short" }`, on the reasoning that it gave `12 Aug 2026` rather
 * than a locale's opinion of what is short. It was still a locale's opinion: ICU's `en-GB` short
 * month for September is **`Sept`** — four letters where all eleven others are three. Every date
 * on the platform silently changed shape on the first of September, and a suite that had been
 * green for months went red on a product nobody had touched.
 *
 * §7.7 names the format. A twelve-entry table is the format; anything else is a guess that
 * happens to agree eleven months of the year.
 */

/** §7.7's months, three letters each, and not negotiable by a locale. */
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * A date as the UI writes it: `12 Aug 2026`.
 *
 * Accepts what the database and the DOM actually hand over — a `Date` from Drizzle, or the ISO
 * string a serialised row carries into a client component. An unparseable value returns an em
 * dash rather than `Invalid Date`, because a broken timestamp should read as an absent one and
 * not as a word in the middle of a sentence.
 */
export function formatDate(value: Date | string | null | undefined): string {
  if (value === null || value === undefined) return "—";

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}
