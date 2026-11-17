/**
 * People who can sign in, and the passwords that let them — §1.3.1, §13.1, §13.2.
 *
 * ── scrypt, and why no dependency ──────────────────────────────────────────────────────────
 *
 * A password must be stored so that reading the database does not reveal it, and so that guessing
 * is expensive. scrypt is memory-hard, it is in Node's standard library, and §13.2 sets the bar for
 * adding a package: this does not clear it.
 *
 * Every hash carries **its own parameters and its own salt**:
 *
 *     scrypt$16384$8$1$<salt base64url>$<hash base64url>
 *
 * so the cost can be raised later without invalidating what is already stored — an old hash still
 * verifies against the parameters it was made with. A scheme that hard-codes the cost has to choose
 * between never raising it and locking everybody out.
 *
 * ── What is deliberately not here ──────────────────────────────────────────────────────────
 *
 * No password reset by email, because there is no mail sender and inventing one to hold a reset
 * token would be more surface than the thing it protects. An administrator sets a new password.
 *
 * Rate limiting was once left out here as belonging "at the edge". No edge rule was ever configured,
 * so sign-ins are now throttled in the database instead — see `sessions.ts` (ARC-003).
 */

import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";
import { promisify } from "node:util";

import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { users } from "@/db/schema";
import { revokeSessionsFor } from "@/lib/sessions";

/* The db-free half — see `people.ts` for why the shape and the rules live apart from the store. */
export { MIN_PASSWORD, refuse, type Person } from "@/lib/people";
import type { Person } from "@/lib/people";

/*
  Typed by hand, because `promisify` picks the three-argument overload and drops the one that takes
  cost parameters — and the cost parameters are the entire point of using scrypt.
*/
const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * Cost parameters. N=16384 is Node's own default and takes a few tens of milliseconds — slow enough
 * to make offline guessing expensive, fast enough that a sign-in does not feel broken.
 */
const N = 16384;
const r = 8;
const p = 1;
const KEY_BYTES = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = (await scrypt(password, salt, KEY_BYTES, { N, r, p }));

  return [
    "scrypt",
    N,
    r,
    p,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

/**
 * Verify a password against a stored hash.
 *
 * Returns false rather than throwing on a malformed hash: a row somebody edited by hand should fail
 * to authenticate, not crash the login route for everyone.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts;
  const cost = { N: Number(nRaw), r: Number(rRaw), p: Number(pRaw) };
  if (!Number.isInteger(cost.N) || !Number.isInteger(cost.r) || !Number.isInteger(cost.p)) {
    return false;
  }

  const expected = Buffer.from(hashRaw, "base64url");
  const actual = (await scrypt(password, Buffer.from(saltRaw, "base64url"), expected.length, cost));

  // Lengths are equal by construction above, so this cannot throw — and the comparison itself does
  // not leak how much of the hash matched.
  return timingSafeEqual(actual, expected);
}

const normalise = (email: string) => email.trim().toLowerCase();

/** Everyone with a row, active first, oldest first within that. */
export async function listPeople(): Promise<Person[]> {
  const rows = await db.select().from(users).orderBy(asc(users.createdAt));

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    isAdmin: row.isAdmin,
    deactivatedAt: row.deactivatedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    twoStep: row.totpEnabledAt !== null,
  }));
}

/**
 * The signed-in identity, checked against the table.
 *
 * A **deactivated** row does not authenticate — `deactivated_at is null` is in the where clause
 * rather than checked afterwards, so it cannot be forgotten by a later reader of this function.
 */
export async function findActive(email: string) {
  const [row] = await db
    .select()
    .from(users)
    .where(and(sql`lower(${users.email}) = ${normalise(email)}`, isNull(users.deactivatedAt)));

  return row ?? null;
}

export async function emailTaken(email: string): Promise<boolean> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${normalise(email)}`);

  return row !== undefined;
}

export async function addPerson(input: {
  email: string;
  name: string;
  password: string;
  isAdmin: boolean;
  by: string;
}): Promise<void> {
  await db.insert(users).values({
    email: normalise(input.email),
    name: input.name.trim(),
    passwordHash: await hashPassword(input.password),
    isAdmin: input.isAdmin,
    createdBy: input.by,
  });
}

/**
 * Set a new password, and end every session the person has (ARC-003) — a password is usually
 * changed because the old one is suspected, and a session opened with it should not outlive it.
 * `keep` spares the session making the change, when someone changes their own.
 */
export async function setPassword(id: string, password: string, keep?: string): Promise<void> {
  const [row] = await db
    .update(users)
    .set({ passwordHash: await hashPassword(password) })
    .where(eq(users.id, id))
    .returning({ email: users.email });
  if (row) await revokeSessionsFor(row.email, "password changed", keep);
}

export async function setActive(id: string, active: boolean, by: string): Promise<void> {
  const [row] = await db
    .update(users)
    .set(
      active
        ? { deactivatedAt: null, deactivatedBy: null }
        : { deactivatedAt: new Date(), deactivatedBy: by },
    )
    .where(eq(users.id, id))
    .returning({ email: users.email });
  // `auth.ts` already refuses a deactivated person on every request; ending the rows as well keeps
  // the session record honest, and means reactivating someone does not revive an old cookie.
  if (row && !active) await revokeSessionsFor(row.email, `deactivated by ${by}`);
}

/**
 * The environment credential — an administrator with no row.
 *
 * Production runs where there is no shell, so if the last administrator's row were deactivated or
 * their password lost there would be no way back in. This is the way back in. It is shown in the
 * People list rather than hidden, because a break-glass credential nobody can see is the dangerous
 * kind.
 */
export const operatorEmail = (): string =>
  (process.env.DEV_USER_EMAIL ?? "").trim().toLowerCase();

export const isOperator = (email: string): boolean => {
  const operator = operatorEmail();
  return operator !== "" && normalise(email) === operator;
};

/** Whether this signed-in person may add and deactivate people. */
export async function canManagePeople(email: string): Promise<boolean> {
  if (isOperator(email)) return true;

  const row = await findActive(email);
  return row?.isAdmin ?? false;
}
