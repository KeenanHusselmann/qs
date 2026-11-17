/**
 * Two-step sign-in – an authenticator code after the password (audit C7).
 *
 * Turning it on is two acts: a key is made and shown (as a QR code), and it only takes effect once
 * the person has entered a code from their app – so nobody is locked out by a key their phone never
 * saved. The key is sealed at rest (`secret-box`); the last accepted step is stored so a code
 * cannot be used twice, and that check-and-store is one conditional update.
 */

import QRCode from "qrcode";
import { and, eq, isNull, lt, or } from "drizzle-orm";

import { db } from "@/db/client";
import { users } from "@/db/schema";
import { open, seal } from "@/lib/secret-box";
import { base32Decode, newSecret, otpauthUri, verifyCode } from "@/lib/totp";

const PURPOSE = "totp";

/** A fresh key for someone, pending until confirmed. Replaces any earlier pending key. */
export async function startTwoStep(userId: string, email: string): Promise<{ key: string; qr: string }> {
  const key = newSecret();
  await db.update(users).set({ totpSecret: seal(key, PURPOSE), totpEnabledAt: null, totpLastStep: null }).where(eq(users.id, userId));
  const qr = await QRCode.toDataURL(otpauthUri(key, email), { margin: 1, width: 200 });
  return { key, qr };
}

/** The person enters a code from the app; only then does two-step take effect. */
export async function confirmTwoStep(userId: string, code: string): Promise<boolean> {
  const [row] = await db.select({ secret: users.totpSecret }).from(users).where(eq(users.id, userId)).limit(1);
  if (!row?.secret) return false;
  const step = verifyCode(base32Decode(open(row.secret, PURPOSE)), code, Date.now(), null);
  if (step === null) return false;
  await db.update(users).set({ totpEnabledAt: new Date(), totpLastStep: step }).where(eq(users.id, userId));
  return true;
}

/**
 * Is this the right code for someone with two-step on? Accepting it and recording its step is one
 * conditional update, so the same code sent twice at once is accepted once.
 */
export async function checkTwoStep(user: { id: string; totpSecret: string | null; totpLastStep: number | null }, code: string): Promise<boolean> {
  if (!user.totpSecret) return false;
  /*
    A key that will not open – SESSION_SECRET rotated, or the value damaged – fails closed: no code
    is accepted until an administrator resets two-step. Skipping the second step instead would turn
    a configuration change into a quiet loss of protection.
  */
  let key: Buffer;
  try {
    key = base32Decode(open(user.totpSecret, PURPOSE));
  } catch (error) {
    console.error("[two-step] stored key could not be opened for", user.id, error instanceof Error ? error.message : error);
    return false;
  }
  const step = verifyCode(key, code, Date.now(), user.totpLastStep);
  if (step === null) return false;
  const [taken] = await db
    .update(users)
    .set({ totpLastStep: step })
    .where(and(eq(users.id, user.id), or(isNull(users.totpLastStep), lt(users.totpLastStep, step))))
    .returning({ id: users.id });
  return Boolean(taken);
}

/** Turn it off – by the person (after a code) or by an administrator for a lost phone. */
export async function clearTwoStep(userId: string): Promise<void> {
  await db.update(users).set({ totpSecret: null, totpEnabledAt: null, totpLastStep: null }).where(eq(users.id, userId));
}
