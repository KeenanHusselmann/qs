"use server";

/**
 * Filing and removing a directory entry.
 *
 * ── What it refuses ────────────────────────────────────────────────────────────────────────
 *
 * An organisation and a kind, and nothing else is required. A person, a role, an email and a
 * phone number are all optional because a practice routinely knows a company before it knows who
 * answers there, and a form that insists otherwise gets "TBC" typed into it — which is worse than
 * a blank, because a blank is visibly missing and "TBC" looks like a value.
 *
 * The duplicate check is on organisation *and* kind together: the same company is legitimately a
 * client on one job and a contractor on another, and refusing the second would be wrong.
 */

import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { contacts } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { isContactKind, KIND_LABEL } from "@/lib/contact-kinds";

export interface FileOutcome {
  ok: boolean;
  reason?: string;
}

/** Empty strings out of a form are absences, not values. */
const orNull = (value: FormDataEntryValue | null) => {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
};

export async function fileContact(form: FormData): Promise<FileOutcome> {
  const session = await requireSession();

  const organisation = String(form.get("organisation") ?? "").trim();
  const kind = String(form.get("kind") ?? "").trim();

  if (organisation.length === 0) {
    return { ok: false, reason: "An entry needs an organisation — it is what everything else hangs off." };
  }
  if (!isContactKind(kind)) {
    return { ok: false, reason: "Choose what kind of contact this is." };
  }

  /*
    Checked before inserting rather than caught after.

    The unique index would refuse it either way, but a constraint violation surfaces as a database
    error, and the reader would get a page of SQL for typing a name that is already on file.
  */
  const [existing] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(
        sql`lower(${contacts.organisation}) = ${organisation.toLowerCase()}`,
        eq(contacts.kind, kind),
        isNull(contacts.deletedAt),
      ),
    )
    .limit(1);

  if (existing) {
    return {
      ok: false,
      reason: `${organisation} is already filed as a ${KIND_LABEL[kind].toLowerCase()}. Two entries for one organisation is how a tender goes to the wrong address.`,
    };
  }

  await db.insert(contacts).values({
    organisation,
    kind,
    person: orNull(form.get("person")),
    role: orNull(form.get("role")),
    email: orNull(form.get("email")),
    phone: orNull(form.get("phone")),
    note: orNull(form.get("note")),
    addedBy: session.email,
  });

  revalidatePath("/contacts");
  return { ok: true };
}

/**
 * Remove an entry.
 *
 * Soft: a supplier the practice has stopped using is still who a rate came from three years ago,
 * and a directory that forgets them makes that rate untraceable.
 */
export async function removeContact(id: string): Promise<void> {
  await requireSession();
  await db.update(contacts).set({ deletedAt: new Date() }).where(eq(contacts.id, id));
  revalidatePath("/contacts");
}
