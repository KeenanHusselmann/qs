/**
 * Session — the signed cookie.
 *
 * This file is the cookie's cryptography and nothing else, so it is testable without a database.
 * The cookie names a row in `sessions` (`sid`), and `auth.ts` checks that row and the person on
 * every request — see `sessions.ts` for why (ARC-003). The environment credential checked here is
 * the operator's break-glass login, off in production unless OPERATOR_LOGIN=1.
 *
 * What the cookie does properly, because these are cheap and their absence is a habit:
 *
 *  - the cookie is **signed**, so it cannot be forged by editing it in the browser
 *  - it is **httpOnly**, so client script cannot read it
 *  - it is **sameSite: lax**, so it is not sent on cross-site form posts
 *  - comparisons are **timing-safe**, so a wrong password cannot be narrowed down by measuring
 *
 * No dependency: Node's crypto does all of it in about sixty lines, which §13.2 says is the bar
 * before adding a package.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "qs_session";

/**
 * Thirty days.
 *
 * Signing in once should mean signing in once. A QS works in this platform daily for the life of a
 * project, and an eight-hour window would put a login screen in front of them every morning —
 * friction with no security benefit, since the threat here is a stolen laptop, which a short
 * expiry does not address either.
 */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * Re-issue a cookie once it is more than a day old.
 *
 * This is what makes the session *rolling*: an active user's expiry keeps moving forward, so they
 * never reach it. Refreshing only after a day, rather than on every request, avoids re-signing and
 * re-setting the cookie on every page load for no gain.
 */
const REFRESH_AFTER_SECONDS = 60 * 60 * 24;

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error(
      "SESSION_SECRET is missing or too short (needs 32+ characters). See .env.example.",
    );
  }
  return value;
}

/**
 * Compare two strings without leaking their contents through timing.
 *
 * Both sides are hashed first so the comparison is always over equal-length buffers —
 * `timingSafeEqual` throws on a length mismatch, and the mismatch itself would leak the length.
 */
function equals(a: string, b: string): boolean {
  const ha = createHmac("sha256", secret()).update(a).digest();
  const hb = createHmac("sha256", secret()).update(b).digest();
  return timingSafeEqual(ha, hb);
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/**
 * `<base64url payload>.<signature>` — the payload is readable, which is fine; it is not secret.
 *
 * `sid` names the row in `sessions` this cookie stands for (migration 0037). The signature proves
 * the cookie was issued here; the row proves it has not since been ended. A refresh re-signs the
 * same `sid`, so revoking the row ends the cookie however often it has been refreshed.
 */
export function createSessionToken(email: string, sid: string): string {
  const now = Date.now();
  const payload = Buffer.from(
    JSON.stringify({ email, sid, issued: now, expires: now + MAX_AGE_SECONDS * 1000 }),
  ).toString("base64url");

  return `${payload}.${sign(payload)}`;
}

export interface Session {
  email: string;
  /** The `sessions` row this cookie stands for. */
  sid: string;
  /** When this token was issued. Used to decide whether it is due a rolling refresh. */
  issued: number;
}

/** Returns the session, or null for anything malformed, unsigned, tampered with, or expired. */
export function readSessionToken(token: string | undefined): Session | null {
  if (!token) return null;

  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  if (!equals(sign(payload), signature)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      email?: unknown;
      sid?: unknown;
      issued?: unknown;
      expires?: unknown;
    };

    if (typeof data.email !== "string" || typeof data.expires !== "number") return null;
    if (Date.now() > data.expires) return null;
    // A cookie from before server-side sessions has no row to check, so it cannot be revoked and is
    // not accepted. Everybody signs in once more after this ships; that is the point of it.
    if (typeof data.sid !== "string" || data.sid === "") return null;

    return {
      email: data.email,
      sid: data.sid,
      // Tokens issued before `issued` existed simply refresh on next request. Treating a missing
      // field as "old" is the safe direction: it costs one extra cookie write, never a lockout.
      issued: typeof data.issued === "number" ? data.issued : 0,
    };
  } catch {
    return null;
  }
}

/** Whether this session is old enough to be worth re-issuing with a fresh expiry. */
export function shouldRefresh(session: Session): boolean {
  return Date.now() - session.issued > REFRESH_AFTER_SECONDS * 1000;
}

/**
 * Whether the environment credential may sign in on this deployment (ARC-003).
 *
 * It is a password held in a deployment setting rather than a person with a row, so it is exposed
 * wherever its values are set. In development and CI (`next dev`) it is how anybody signs in at all,
 * so it stays on there. Under a production build — Vercel, preview included, or the container — it
 * is off unless `OPERATOR_LOGIN=1` is set on that deployment: the break-glass way back in when the
 * last administrator is locked out, switched on for the repair and off again afterwards. Switching
 * it off also ends every operator session, because `auth.ts` checks this on each request.
 */
export function operatorLoginEnabled(): boolean {
  if (process.env.OPERATOR_LOGIN === "1") return true;
  return process.env.NODE_ENV !== "production";
}

/**
 * Check the one development credential.
 *
 * Both halves are compared timing-safely even when the email is wrong, so the response takes the
 * same time either way and cannot be used to discover which half was correct.
 */
export function verifyCredentials(email: string, password: string): boolean {
  const expectedEmail = process.env.DEV_USER_EMAIL ?? "";
  const expectedPassword = process.env.DEV_USER_PASSWORD ?? "";

  if (!expectedEmail || !expectedPassword || !operatorLoginEnabled()) return false;

  const emailOk = equals(email.trim().toLowerCase(), expectedEmail.trim().toLowerCase());
  const passwordOk = equals(password, expectedPassword);

  return emailOk && passwordOk;
}

/** The cookie options every place that sets this cookie must use. Defined once so they cannot drift. */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    // Off over plain HTTP so local development works; on everywhere else.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  };
}

export const SESSION_COOKIE = COOKIE_NAME;
export const SESSION_MAX_AGE = MAX_AGE_SECONDS;

/** For generating a secret when setting the project up. */
export const newSecret = () => randomBytes(32).toString("base64url");
