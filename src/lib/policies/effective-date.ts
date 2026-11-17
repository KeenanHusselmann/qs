/**
 * When a standard took effect.
 *
 * ── Why this is not in `actions.ts` ────────────────────────────────────────────────────────
 *
 * It was, and the whole app returned 500. A `"use server"` module may export only async
 * functions — every export becomes a callable server action — so a synchronous predicate beside
 * the actions breaks the module at load, not at call. Its own file, and it is unit-testable
 * without dragging a database import along.
 */

/**
 * A date somebody could actually have adopted a standard on.
 *
 * ISO, and inside a century either side of now. Not a validation of the firm's records — it is
 * none of the platform's business which year a practice adopted a standard — but a year of five
 * digits is a typing accident, and one filed as an effective date is worse than no date at all.
 */
export function plausibleDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const year = Number(value.slice(0, 4));
  const now = new Date().getUTCFullYear();

  if (year < now - 100 || year > now + 5) return false;

  /*
    Round-tripped, not parsed.

    `Date.parse("2026-02-31")` does not fail — it rolls over to 3 March and returns a perfectly
    good timestamp, so a parse check accepts every impossible date there is. Formatting the result
    back and comparing is what actually rejects one.
  */
  const parsed = new Date(`${value}T00:00:00Z`);

  // Month 13 gives an Invalid Date, whose `toISOString` throws rather than returning anything to
  // compare — so it is checked before the round-trip, not caught after it.
  if (Number.isNaN(parsed.getTime())) return false;

  return parsed.toISOString().slice(0, 10) === value;
}
