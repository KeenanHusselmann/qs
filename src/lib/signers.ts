/**
 * The name a signature is shown under.
 *
 * ── Stored as the email, shown as the name ─────────────────────────────────────────────────
 *
 * A run is signed with the signer's email (`runs.signed_by`), and that stays: an email is unique and
 * does not change, which is what a record somebody will be asked about months later needs to point
 * at. But a sign-off reads as a person's act – "Signed off by Thandi Nkosi", not "by
 * qs@mzilikazi.co.za" – so every place a signature, a correction or a strike is shown resolves the
 * email to the person's name here.
 *
 * Deactivated people are included on purpose: `users.deactivated_at` is soft precisely so that
 * someone who has left keeps their name on everything they signed.
 *
 * The environment credential has no row, so its name comes from `DEV_USER_NAME`. Where nothing
 * names an email, the email is shown – a signature with no signer is worse than one with an address.
 */

import { cache } from "react";

import { db } from "@/db/client";
import { users } from "@/db/schema";
import { operatorEmail } from "@/lib/users";

/** Every known email, lower-cased, to its person's name. Read once per request. */
export const signerNames = cache(async (): Promise<ReadonlyMap<string, string>> => {
  const rows = await db.select({ email: users.email, name: users.name }).from(users);
  const names = new Map(rows.filter((row) => row.name.trim()).map((row) => [row.email.toLowerCase(), row.name.trim()]));

  const operator = operatorEmail();
  const operatorName = (process.env.DEV_USER_NAME ?? "").trim();
  if (operator && operatorName && !names.has(operator)) names.set(operator, operatorName);

  return names;
});

/** A name from a map already read – for a loader resolving many signers at once. */
export function nameIn(names: ReadonlyMap<string, string>, email: string): string;
export function nameIn(names: ReadonlyMap<string, string>, email: string | null): string | null;
export function nameIn(names: ReadonlyMap<string, string>, email: string | null): string | null {
  if (email === null) return null;
  return names.get(email.trim().toLowerCase()) ?? email;
}

/** One signer's name. */
export async function nameOf(email: string): Promise<string>;
export async function nameOf(email: string | null): Promise<string | null>;
export async function nameOf(email: string | null): Promise<string | null> {
  return nameIn(await signerNames(), email);
}
