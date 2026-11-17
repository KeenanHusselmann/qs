/**
 * The names the platform already holds — its contacts and its people — for the name detector.
 *
 * Read at most once a minute per instance: the list changes when somebody adds a contact, not on
 * every call, and an agent run makes a dozen calls in a few seconds. A contact added a moment ago is
 * caught on the next refresh; until then the deterministic detectors still catch its email and
 * phone number, which is where the risk is.
 */

import { isNull } from "drizzle-orm";

import { db } from "@/db/client";
import { contacts, users } from "@/db/schema";
import type { KnownNames } from "@/lib/egress/detect";

const TTL_MS = 60_000;
let cached: { at: number; names: KnownNames } | null = null;

export async function knownNames(): Promise<KnownNames> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.names;

  const [contactRows, userRows] = await Promise.all([
    db.select({ organisation: contacts.organisation, person: contacts.person }).from(contacts).where(isNull(contacts.deletedAt)),
    db.select({ name: users.name }).from(users),
  ]);

  const names: KnownNames = {
    people: [...contactRows.map((c) => c.person ?? ""), ...userRows.map((u) => u.name)].filter(Boolean),
    organisations: contactRows.map((c) => c.organisation).filter(Boolean),
  };
  cached = { at: Date.now(), names };
  return names;
}
