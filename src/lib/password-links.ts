/**
 * Set-password links – the person chooses their own password, nobody else ever knows it (audit C7).
 *
 * An administrator creates a link for a new person (an invite, seven days) or a locked-out one (a
 * reset, a day) and sends it however they like; where email is configured the platform sends it
 * too. Opening it leads to the sign-in page's "choose a password" form.
 *
 * ── What makes it safe ─────────────────────────────────────────────────────────────────────
 *
 *   · 256 random bits per token; only its SHA-256 is stored, so the table yields no working link.
 *   · Consumed by one conditional update – unused, unexpired – so two clicks cannot both succeed.
 *   · A new link cancels any earlier unused one for the same person.
 *   · A deactivated person's link is refused: removing access must not be undone by an old email.
 *   · Setting the password ends every session the person has (`setPassword`).
 */

import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";

import { db } from "@/db/client";
import { passwordLinks, users } from "@/db/schema";
import { absoluteUrl } from "@/lib/email";
import { refuse } from "@/lib/people";
import { setPassword } from "@/lib/users";

export type LinkPurpose = "invite" | "reset";

const LIFETIME_HOURS: Record<LinkPurpose, number> = { invite: 7 * 24, reset: 24 };

const digest = (token: string) => createHash("sha256").update(token).digest("hex");

/** A fresh link for one person. Earlier unused links for them stop working. */
export async function createPasswordLink(
  userId: string,
  by: string,
  purpose: LinkPurpose,
): Promise<{ url: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + LIFETIME_HOURS[purpose] * 3_600_000);

  await db.transaction(async (tx) => {
    await tx
      .update(passwordLinks)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordLinks.userId, userId), isNull(passwordLinks.usedAt)));
    await tx.insert(passwordLinks).values({ userId, tokenHash: digest(token), purpose, createdBy: by, expiresAt });
  });

  return { url: absoluteUrl(`/login?set=${token}`), expiresAt };
}

/** One sentence for every way a link fails, so a probe learns nothing about which links exist. */
export const LINK_REFUSED = "This link has expired or has already been used. Ask your administrator for a new one.";

/** Choose a password with a link. The link is spent whether or not anything after it succeeds. */
export async function spendPasswordLink(token: string, password: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const tooWeak = refuse(password);
  if (tooWeak) return { ok: false, reason: tooWeak };
  if (!/^[\w-]{20,100}$/.test(token)) return { ok: false, reason: LINK_REFUSED };

  const [spent] = await db
    .update(passwordLinks)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordLinks.tokenHash, digest(token)), isNull(passwordLinks.usedAt), gt(passwordLinks.expiresAt, new Date())))
    .returning({ userId: passwordLinks.userId });
  if (!spent) return { ok: false, reason: LINK_REFUSED };

  const [person] = await db
    .select({ id: users.id, deactivatedAt: users.deactivatedAt })
    .from(users)
    .where(eq(users.id, spent.userId))
    .limit(1);
  if (!person || person.deactivatedAt !== null) return { ok: false, reason: LINK_REFUSED };

  await setPassword(person.id, password);
  return { ok: true };
}

/** A password nobody knows, for a person invited by link before they choose their own. */
export const unusablePassword = (): string => randomBytes(48).toString("base64url");
