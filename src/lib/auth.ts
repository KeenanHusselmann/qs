/**
 * Reading the current session on the server.
 *
 * Kept apart from `session.ts` (which is pure crypto, no framework) so the signing logic stays
 * testable without Next's request context.
 *
 * ── A signature is not enough (ARC-003) ────────────────────────────────────────────────────
 *
 * The signature proves the cookie was issued here. It cannot prove the session has not been ended
 * since, or that the person is still allowed in. So every request also checks:
 *
 *  - the `sessions` row is live: not signed out, not revoked, not past its absolute lifetime;
 *  - the person still has an active row in `users`, or is the environment operator on a deployment
 *    where that login is switched on.
 *
 * Before this, a deactivated person's cookie kept working, and a cookie in daily use never expired.
 */

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { operatorLoginEnabled, readSessionToken, SESSION_COOKIE, type Session } from "@/lib/session";
import { sessionIsLive } from "@/lib/sessions";
import { findActive, isOperator } from "@/lib/users";

/** Whether a signed, unexpired token still stands for someone who is allowed in. */
export async function stillValid(session: Session): Promise<boolean> {
  if (!(await sessionIsLive(session.sid, session.email))) return false;
  if (await findActive(session.email)) return true;
  return isOperator(session.email) && operatorLoginEnabled();
}

/**
 * The current session, or null.
 *
 * Cached per request, because a page and the components under it each ask, and the answer cannot
 * change part-way through rendering. A database that cannot be reached throws rather than returning
 * null: "you are signed out" would be the wrong thing to tell someone during an outage.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const store = await cookies();
  const session = readSessionToken(store.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  return (await stillValid(session)) ? session : null;
});

/**
 * The current session, or a redirect to login.
 *
 * Every authenticated page calls this. Checked on the server per request rather than in middleware
 * or on the client: a page that renders and *then* discovers it should not have is a page that has
 * already leaked whatever it rendered.
 */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}
