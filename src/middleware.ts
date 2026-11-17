/**
 * Rolling session refresh.
 *
 * A signed-in user should stay signed in. The cookie carries a 30-day expiry, and this moves that
 * expiry forward whenever it is more than a day old — so someone using the platform daily never
 * reaches it, and someone who leaves for a month is asked to sign in again.
 *
 * **Why here and not in the page.** Next does not allow setting a cookie while rendering a Server
 * Component, so `requireSession()` can read the session but cannot renew it. Middleware runs
 * before the render and can, which makes this the only correct place for it.
 *
 * It refreshes; it does not guard. Redirecting unauthenticated requests stays in
 * `requireSession()` on the page itself, because a page that decides its own access cannot be
 * accidentally left unprotected by a matcher that stopped matching it.
 */

import { NextResponse, type NextRequest } from "next/server";

import {
  createSessionToken,
  readSessionToken,
  SESSION_COOKIE,
  sessionCookieOptions,
  shouldRefresh,
} from "@/lib/session";

export function middleware(request: NextRequest) {
  /**
   * The root is the main page now, and only signed-out requests are redirected.
   *
   * It used to redirect unconditionally, on the reasoning that nothing was reachable signed-out
   * so the root may as well be the login screen. That held while there was no page at the root.
   * There is one now — what this platform is, where the work stands, and the way into it — and a
   * middleware redirect in front of it would make that page unreachable while looking like a
   * routing bug.
   *
   * The guard stays where it was: `requireSession()` on the page. This only decides which of the
   * two the root shows, and a request with no session never reaches the render.
   */
  const session = readSessionToken(request.cookies.get(SESSION_COOKIE)?.value);

  if (request.nextUrl.pathname === "/" && !session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const response = NextResponse.next();

  if (session && shouldRefresh(session)) {
    // The same `sid`: a refresh moves the cookie's expiry, never the session's. A revoked session
    // refreshed here is still refused by `auth.ts`, which checks the row on every request.
    response.cookies.set(SESSION_COOKIE, createSessionToken(session.email, session.sid), sessionCookieOptions());
  }

  return response;
}

export const config = {
  /**
   * Node runtime, not Edge: the session is signed with `node:crypto`, which Edge does not provide.
   * Next 16 supports this, and §13.1's single container runs Node anyway.
   */
  runtime: "nodejs",

  /**
   * Skip anything that is not a page request. Static assets and images carry no session and
   * re-signing a cookie for every one of them would be pure waste.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
