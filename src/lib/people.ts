/**
 * What a person *is*, and what makes a password acceptable — the half with no database in it.
 *
 * ── Why this is a separate file ────────────────────────────────────────────────────────────
 *
 * `users.ts` imports `db`. A client component that imports anything from it — even a type, even a
 * number — drags the database client into the browser bundle and the whole app returns 500. That
 * has happened twice in this project and neither time was caught by typecheck, because it is not a
 * type error: it is a module-graph error.
 *
 * So the shape and the rules live here, importing nothing, and both sides read them. The same split
 * `session.ts` makes for the same reason.
 */

/**
 * The shortest password this platform will store.
 *
 * Length only, and no character-class rule. A rule demanding a capital, a digit and a symbol
 * produces `Password1!` on every system that has ever asked for one — among the first guesses any
 * attacker makes — while rejecting a long passphrase that is far stronger. The rule would teach the
 * wrong habit and measure the wrong thing.
 */
export const MIN_PASSWORD = 12;

/** Why a password is refused, or null if it is fine. */
export function refuse(password: string): string | null {
  if (password.length < MIN_PASSWORD) {
    return `A password needs at least ${MIN_PASSWORD} characters. Length is what makes one hard to guess — a long phrase beats a short one with symbols in it.`;
  }
  return null;
}

/** One person who can sign in, as a screen reads them. */
export interface Person {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  deactivatedAt: string | null;
  createdAt: string;
  createdBy: string | null;
  /** Two-step sign-in is on (0047). */
  twoStep: boolean;
}
