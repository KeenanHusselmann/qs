/**
 * Sessions the server can end, and sign-in throttling — ARC-003, "login hardening".
 *
 * `session.ts` signs and reads the cookie and touches nothing else, so it stays testable without a
 * database. This is the other half: the row a cookie stands for, and the record of failed attempts.
 *
 * ── Why a row per sign-in, rather than a "valid from" date per person ──────────────────────
 *
 * A date per person can only end *every* session at once, so signing out of one laptop would sign
 * out the phone too, and nothing could say which devices were signed in. A row per sign-in ends one
 * session or all of them, and keeps the record of when and why each ended.
 *
 * ── Throttling, and why it lives in the database ───────────────────────────────────────────
 *
 * `users.ts` once said rate limiting "belongs at the edge". There is no edge rule configured, and on
 * serverless a counter in memory is per instance, so it would reset whenever a request landed on a
 * fresh one. A row per failure is shared by every instance and survives a cold start. Two limits:
 * per address, which stops a guess at one account; and per IP, which stops one source trying many
 * accounts. Neither says whether the address exists: a locked-out address that has no account is
 * refused exactly like one that does.
 */

import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { loginFailures, sessions } from "@/db/schema";

/** Failures per address within the window before that address is refused. */
export const MAX_FAILURES_PER_EMAIL = 5;
/** Failures per IP within the window. Higher: an office shares one address. */
export const MAX_FAILURES_PER_IP = 30;
export const FAILURE_WINDOW_MINUTES = 15;

/**
 * However often a cookie is refreshed, the password is asked for again after this. The rolling
 * thirty-day cookie otherwise never expires for someone who uses the platform daily, and a stolen
 * one would last as long as the thief kept using it.
 */
export const ABSOLUTE_LIFETIME_DAYS = 90;

/** `last_seen_at` is written at most this often, so a page load is not a write. */
const TOUCH_AFTER_MS = 60 * 60 * 1000;

const normalise = (email: string) => email.trim().toLowerCase();

/** Open a session for someone whose password has just been checked. Returns its id for the cookie. */
export async function openSession(email: string, context: { userAgent: string | null; ip: string | null }): Promise<string> {
  const [row] = await db
    .insert(sessions)
    .values({
      email: normalise(email),
      // Bounded, because both are supplied by the client.
      userAgent: context.userAgent?.slice(0, 300) ?? null,
      ip: context.ip?.slice(0, 64) ?? null,
    })
    .returning({ id: sessions.id });
  return row!.id;
}

/**
 * Whether the session a cookie names is still live: not revoked, not past its absolute lifetime,
 * and belonging to the address the cookie claims. Whether that person is still allowed in at all is
 * the caller's question (`auth.ts`), because the operator has no row to check.
 */
export async function sessionIsLive(sid: string, email: string): Promise<boolean> {
  // A malformed id would make Postgres throw on the uuid cast; a forged cookie cannot carry one
  // (it is signed), but an old or hand-edited one can, and it is simply not a session.
  if (!/^[0-9a-f-]{36}$/i.test(sid)) return false;

  const [row] = await db
    .select({ email: sessions.email, createdAt: sessions.createdAt, lastSeenAt: sessions.lastSeenAt })
    .from(sessions)
    .where(and(eq(sessions.id, sid), isNull(sessions.revokedAt)));

  if (!row || row.email !== normalise(email)) return false;
  if (Date.now() - row.createdAt.getTime() > ABSOLUTE_LIFETIME_DAYS * 86_400_000) return false;

  if (Date.now() - row.lastSeenAt.getTime() > TOUCH_AFTER_MS) {
    // Bookkeeping, not a check: a failure here must not sign anybody out.
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(sessions.id, sid))
      .catch((error) => console.error("[sessions] could not record last seen:", error));
  }
  return true;
}

/** End one session — "sign out". */
export async function revokeSession(sid: string, reason: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(sid)) return;
  await db
    .update(sessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(sessions.id, sid), isNull(sessions.revokedAt)));
}

/**
 * End every session a person has, optionally sparing one — the one that made the change, so that
 * changing your own password does not sign you out of the browser you changed it in.
 */
export async function revokeSessionsFor(email: string, reason: string, except?: string): Promise<number> {
  const rows = await db
    .update(sessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(
      and(
        sql`lower(${sessions.email}) = ${normalise(email)}`,
        isNull(sessions.revokedAt),
        except ? sql`${sessions.id} <> ${except}` : undefined,
      ),
    )
    .returning({ id: sessions.id });
  return rows.length;
}

/**
 * Whether this address, or this IP, has failed too often recently to be tried again yet.
 * Checked before the password is, so a locked address costs no scrypt work either.
 */
export async function isThrottled(email: string, ip: string | null): Promise<boolean> {
  const since = new Date(Date.now() - FAILURE_WINDOW_MINUTES * 60_000);
  const address = normalise(email);

  const [counts] = await db
    .select({
      byEmail: sql<number>`count(*) filter (where ${loginFailures.email} = ${address})`.mapWith(Number),
      byIp: ip
        ? sql<number>`count(*) filter (where ${loginFailures.ip} = ${ip})`.mapWith(Number)
        : sql<number>`0`.mapWith(Number),
    })
    .from(loginFailures)
    .where(
      and(
        gt(loginFailures.at, since),
        ip ? or(eq(loginFailures.email, address), eq(loginFailures.ip, ip)) : eq(loginFailures.email, address),
      ),
    );

  return (counts?.byEmail ?? 0) >= MAX_FAILURES_PER_EMAIL || (counts?.byIp ?? 0) >= MAX_FAILURES_PER_IP;
}

/** Record a failure, and prune anything older than a day so the table stays small. */
export async function recordFailure(email: string, ip: string | null): Promise<void> {
  await db.insert(loginFailures).values({ email: normalise(email).slice(0, 320), ip: ip?.slice(0, 64) ?? null });
  await db.delete(loginFailures).where(lt(loginFailures.at, new Date(Date.now() - 86_400_000)));
}

/** A correct password clears that address's failures. The IP's are left: other addresses share it. */
export async function clearFailures(email: string): Promise<void> {
  await db.delete(loginFailures).where(eq(loginFailures.email, normalise(email)));
}
