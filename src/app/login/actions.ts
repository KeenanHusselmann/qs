"use server";

/**
 * Sign in and sign out.
 *
 * Credentials are checked on the server and never reach the client — the browser only ever sees
 * whether it worked.
 *
 * ── Two sources, in this order ─────────────────────────────────────────────────────────────
 *
 * A row in `users` first, then the environment credential. The order matters and is not arbitrary:
 * if the operator also has a row, the row's password is the current one — an environment variable
 * left behind in a deployment should never quietly override a password somebody changed.
 *
 * The environment credential remains because production runs where there is no shell (§13.1). It is
 * the way back in when the last administrator's row is deactivated or their password is lost, and
 * `Settings › People` shows it rather than leaving it as an account nobody can see.
 */

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  createSessionToken,
  readSessionToken,
  SESSION_COOKIE,
  sessionCookieOptions,
  verifyCredentials,
} from "@/lib/session";
import { clearFailures, FAILURE_WINDOW_MINUTES, isThrottled, openSession, recordFailure, revokeSession } from "@/lib/sessions";
import { findActive, verifyPassword } from "@/lib/users";
import { spendPasswordLink } from "@/lib/password-links";
import { checkTwoStep } from "@/lib/two-step";

/**
 * The caller's address, as the platform in front of us reports it. On Vercel `x-real-ip` is set by
 * the platform; elsewhere the first `x-forwarded-for` hop is the best there is, and it can be forged,
 * which is why the per-address limit does not depend on it.
 */
async function callerIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-real-ip")?.trim() || h.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

export interface SignInResult {
  error?: string;
  /** The password was right and this person has two-step sign-in on: ask for the code. */
  needCode?: boolean;
}

export async function signIn(
  _previous: SignInResult | null,
  formData: FormData,
): Promise<SignInResult> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!email.trim()) return { error: "Enter your email address" };
  if (!password) return { error: "Enter your password" };

  /*
    Throttled before the password is checked (ARC-003). The same words whether or not the address
    has an account, so a lockout does not reveal which addresses exist.
  */
  const ip = await callerIp();
  if (await isThrottled(email, ip)) {
    return { error: `Too many attempts. Wait ${FAILURE_WINDOW_MINUTES} minutes and try again.` };
  }

  const person = await findActive(email);
  const ok = person
    ? await verifyPassword(password, person.passwordHash)
    : verifyCredentials(email, password);

  if (!ok) {
    /*
      One message for every failure, deliberately — no account, wrong password, deactivated. Saying
      "no such account" tells anyone who asks which addresses exist, and "this account is
      deactivated" tells them which ones used to.

      A deactivated person reaches here as `person === null`, because `findActive` has
      `deactivated_at is null` in its where clause. That means they fall through to the environment
      credential rather than being refused outright — which is correct and worth stating: the only
      way that lets them in is if they *are* the operator, and the operator is precisely who should
      never be locked out. Outside development that fallback is itself off unless the deployment sets
      OPERATOR_LOGIN=1 (`operatorLoginEnabled` in session.ts).
    */
    await recordFailure(email, ip);
    return { error: "That email and password do not match an account" };
  }

  /*
    Two-step sign-in (0047). Asked only after the password is right, so the prompt itself reveals
    nothing about which accounts exist. A wrong code counts towards the same throttle as a wrong
    password: five tries in fifteen minutes is not enough to guess six digits.
  */
  if (person?.totpEnabledAt) {
    const code = String(formData.get("code") ?? "").trim();
    if (!code) return { needCode: true };
    if (!(await checkTwoStep(person, code))) {
      await recordFailure(email, ip);
      return { needCode: true, error: "That code is not right. Use the newest one from your app." };
    }
  }

  await clearFailures(email);
  const h = await headers();
  const sid = await openSession(email, { userAgent: h.get("user-agent"), ip });

  const store = await cookies();
  store.set(SESSION_COOKIE, createSessionToken(email.trim().toLowerCase(), sid), sessionCookieOptions());

  redirect("/");
}

/**
 * Sign out — the session ends on the server, not only in this browser. Deleting the cookie alone left
 * any copy of it working; ending the row is what makes a copy useless.
 */
export async function signOut(): Promise<void> {
  const store = await cookies();
  const session = readSessionToken(store.get(SESSION_COOKIE)?.value);
  if (session) await revokeSession(session.sid, "signed out");
  store.delete(SESSION_COOKIE);
  redirect("/login");
}

/**
 * Choose a password with a set-password link (audit C7). The person is sent to sign in with it
 * afterwards rather than signed in here: the link proves they hold it, sign-in proves the password.
 */
export async function setPasswordWithLink(_previous: SignInResult | null, formData: FormData): Promise<SignInResult> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  if (password !== String(formData.get("confirm") ?? "")) return { error: "The two passwords do not match." };

  const outcome = await spendPasswordLink(token, password);
  if (!outcome.ok) return { error: outcome.reason };
  redirect("/login?set=done");
}
