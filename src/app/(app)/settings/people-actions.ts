"use server";

/**
 * Adding and removing the people who can sign in — §1.3.1, §13.1.
 *
 * ── Every action re-checks who is asking ───────────────────────────────────────────────────
 *
 * A server action is a public endpoint. Hiding the form from a non-administrator hides the form and
 * nothing else — the action is still reachable by anybody who can sign in and read the page source.
 * So the permission is checked **here**, on every call, and the page's own check is a courtesy to
 * the reader rather than the control.
 */

import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth";
import {
  addPerson,
  canManagePeople,
  emailTaken,
  isOperator,
  listPeople,
  setActive,
} from "@/lib/users";
import { emailConfigured, sendEmail } from "@/lib/email";
import { createPasswordLink, unusablePassword, type LinkPurpose } from "@/lib/password-links";

export type PeopleAction = { ok: true } | { ok: false; reason: string };

/**
 * A set-password link for someone to choose their own password (audit C7). Shown once to the
 * administrator to send on; emailed as well where email is configured.
 */
export type LinkAction =
  | { ok: true; name: string; url: string; expiresAt: string; emailed: boolean }
  | { ok: false; reason: string };

async function sendLink(email: string, name: string, url: string, purpose: LinkPurpose): Promise<boolean> {
  if (!emailConfigured()) return false;
  const what = purpose === "invite" ? "You have been given access to the Mzilikazi QS Platform." : "A new password was requested for your account.";
  const outcome = await sendEmail({
    to: email,
    subject: purpose === "invite" ? "Your access to the QS platform" : "Choose a new password",
    text: `${what}\n\nChoose your password here (this link works once):\n${url}\n`,
    html: `<p>${what}</p><p><a href="${url}">Choose your password</a> – the link works once.</p>`,
  });
  return outcome.sent;
}

const DENIED = "Only an administrator can change who has access.";

/** The signed-in email, or a refusal. Every action below starts here. */
async function administrator(): Promise<{ email: string; sid: string } | null> {
  const session = await requireSession();
  return (await canManagePeople(session.email)) ? { email: session.email, sid: session.sid } : null;
}

/** A very small check: something before an @, something after it, and a dot in that. */
const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

/**
 * Add somebody, and hand back the link they choose their password with (audit C7).
 *
 * No administrator types a password for anyone: the account is created with a password nobody
 * knows, and the invite link is the only way in until the person chooses their own.
 */
export async function addTester(formData: FormData): Promise<LinkAction> {
  const admin = await administrator();
  if (!admin) return { ok: false, reason: DENIED };

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const isAdmin = formData.get("isAdmin") === "on";

  if (!name) return { ok: false, reason: "A person needs a name — it is what their signatures will say." };
  if (!looksLikeEmail(email)) return { ok: false, reason: "That does not look like an email address." };

  // Named rather than silently ignored: a second row for one address would put two signers with the
  // same name on one job, and the unique index would refuse the insert with a Postgres error.
  if (await emailTaken(email)) {
    return { ok: false, reason: `${email} already has an account. Create a set-password link for them instead.` };
  }

  await addPerson({ name, email, password: unusablePassword(), isAdmin, by: admin.email });
  const person = (await listPeople()).find((p) => p.email.toLowerCase() === email.toLowerCase());
  if (!person) return { ok: false, reason: "The account could not be read back after it was created." };

  const link = await createPasswordLink(person.id, admin.email, "invite");
  revalidatePath("/settings");
  return { ok: true, name, url: link.url, expiresAt: link.expiresAt.toISOString(), emailed: await sendLink(email, name, link.url, "invite") };
}

/** A set-password link for someone already here – a forgotten password, or a suspected one. */
export async function createResetLink(id: string): Promise<LinkAction> {
  const admin = await administrator();
  if (!admin) return { ok: false, reason: DENIED };

  const person = (await listPeople()).find((p) => p.id === id);
  if (!person) return { ok: false, reason: "That person is not on the list." };
  if (person.deactivatedAt !== null) return { ok: false, reason: "Restore their access first – a deactivated account takes no link." };

  const link = await createPasswordLink(person.id, admin.email, "reset");
  return { ok: true, name: person.name, url: link.url, expiresAt: link.expiresAt.toISOString(), emailed: await sendLink(person.email, person.name, link.url, "reset") };
}

export async function setPersonActive(id: string, active: boolean): Promise<PeopleAction> {
  const admin = await administrator();
  if (!admin) return { ok: false, reason: DENIED };

  /*
    The last administrator cannot deactivate themselves out of the platform.

    The environment credential would still get somebody back in, so this is not a lockout in the
    strict sense — but it is a support call and a confusing five minutes, and the check is two
    lines. The operator is exempt because they have no row to deactivate.
  */
  if (!active) {
    const people = await listPeople();
    const target = people.find((person) => person.id === id);

    if (target && target.isAdmin) {
      const others = people.filter(
        (person) => person.isAdmin && person.deactivatedAt === null && person.id !== id,
      );

      if (others.length === 0 && !isOperator(admin.email)) {
        return {
          ok: false,
          reason:
            "That is the only administrator left. Make somebody else an administrator first, or nobody will be able to add people.",
        };
      }
    }
  }

  await setActive(id, active, admin.email);

  revalidatePath("/settings");
  return { ok: true };
}
