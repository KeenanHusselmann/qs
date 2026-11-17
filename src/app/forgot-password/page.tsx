/**
 * Forgot password — the link under the login form's password field.
 *
 * **There is no self-serve reset, and this page says so rather than pretending.** A reset by email
 * needs a single-use token table and an email channel, and email is off until `RESEND_API_KEY` and
 * `EMAIL_FROM` are configured (`lib/email.ts`). What exists today is an administrator setting a
 * new password from Settings → People, so that is where this sends someone.
 *
 * Outside `(app)`, so it renders without a session — the person reading it cannot sign in. It
 * names no administrator: a signed-out page listing who holds admin rights would hand that list to
 * anyone who asked.
 */

import Link from "next/link";

export default function ForgotPasswordPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--n-50)] px-4 py-10">
      <div className="w-full max-w-[380px]">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element -- as on the login page: a static
              mark, and next/image's optimizer is a function this app's budget has no room for. */}
          <img src="/mzi-logo.png" alt="" aria-hidden className="size-8 shrink-0 object-contain" />
          <span className="t-lg text-[var(--n-800)]">Mzilikazi QS Platform</span>
        </div>

        <div
          className="rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-0)] p-6"
          style={{ boxShadow: "var(--e-1)" }}
        >
          <h1 className="t-xl mb-1 text-[var(--n-800)]">Reset your password</h1>
          <p className="t-md mb-5 text-[var(--n-500)]">
            Ask your practice administrator for a set-password link. They create one from{" "}
            <span className="text-[var(--n-700)]">Settings → People</span>; it works once, and you
            choose the new password yourself.
          </p>

          <Link
            href="/login"
            className="t-base inline-flex h-9 w-full items-center justify-center rounded-[var(--r-md)] bg-[var(--a-500)] font-medium text-white transition-colors hover:bg-[var(--a-600)]"
            style={{ transitionDuration: "var(--m-fast)" }}
          >
            Back to sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
