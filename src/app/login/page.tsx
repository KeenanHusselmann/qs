/**
 * Login — PLATFORM.md §4.2.
 *
 * "Email, password, forgot password, company logo. Clean, centred card."
 *
 * The first screen of the platform, and where its restraint is set. §7.1: quiet by default — no
 * gradients, no hero, no illustration. This is a financial instrument and should feel like one
 * from the first pixel.
 *
 * **This authenticates one development credential** held in the environment, against a signed
 * session cookie. It is not the auth system — §13.1 leaves the provider unchosen and there is no
 * user table yet. It is enough to get past this screen and no more, and the screen says so.
 */

"use client";

import { Suspense, useActionState, useState } from "react";
import { useSearchParams } from "next/navigation";

import { MIN_PASSWORD } from "@/lib/people";
import { setPasswordWithLink, signIn, type SignInResult } from "./actions";

/**
 * Sign-in, or – arriving by a set-password link (`?set=<token>`, audit C7) – choosing a password.
 *
 * On this page rather than one of its own because every route is a server function and the
 * deployment is at its cap. The chooser reads the query, so it sits in a Suspense boundary and the
 * page stays prerendered: the sign-in form is the fallback, which is also what most visitors want.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={<SignInPage justSet={false} />}>
      <Chooser />
    </Suspense>
  );
}

function Chooser() {
  const set = useSearchParams().get("set");
  if (set && set !== "done") return <SetPasswordPage token={set} />;
  return <SignInPage justSet={set === "done"} />;
}

function SetPasswordPage({ token }: { token: string }) {
  const [result, formAction, pending] = useActionState<SignInResult | null, FormData>(setPasswordWithLink, null);

  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--n-50)] px-4 py-10">
      <div data-region="set-password" className="w-full max-w-[380px] rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-0)] p-6" style={{ boxShadow: "var(--e-1)" }}>
        <h1 className="t-xl mb-1 text-[var(--n-800)]">Choose your password</h1>
        <p className="t-md mb-5 text-[var(--n-500)]">At least {MIN_PASSWORD} characters. Nobody else will know it.</p>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="token" value={token} />
          <Field id="password" label="New password" type="password" autoComplete="new-password" />
          <Field id="confirm" label="The same again" type="password" autoComplete="new-password" />
          <button
            type="submit"
            disabled={pending}
            className="t-base h-9 rounded-[var(--r-md)] bg-[var(--a-500)] font-medium text-white transition-colors hover:bg-[var(--a-600)] disabled:opacity-60"
          >
            {pending ? "Saving…" : "Set password"}
          </button>
          {result?.error && (
            <p role="status" aria-live="polite" className="t-sm rounded-[var(--r-sm)] bg-[var(--err-50)] px-3 py-2 text-[var(--err-700)]">
              {result.error}
            </p>
          )}
        </form>
      </div>
    </main>
  );
}

function SignInPage({ justSet }: { justSet: boolean }) {
  const [result, formAction, pending] = useActionState<SignInResult | null, FormData>(signIn, null);
  /*
    Two-step sign-in: the code is asked for on the same form after a right password. React resets a
    form once its action runs, so what was typed is held here and sent again with the code.
  */
  const [typed, setTyped] = useState<{ email: string; password: string } | null>(null);
  const submit = (data: FormData) => {
    if (data.has("email")) setTyped({ email: String(data.get("email") ?? ""), password: String(data.get("password") ?? "") });
    formAction(data);
  };
  const askCode = Boolean(result?.needCode && typed);

  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--n-50)] px-4 py-10">
      <div className="w-full max-w-[380px]">
        {/* Mzilikazi's own mark, hardcoded — still one practice, one deployment. Becomes the
            practice's uploaded logo once Settings supports more than one (§4.12). */}
        <div className="mb-6 flex items-center justify-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element -- static mark, and next/image's
              optimizer is a Vercel function this app's 12-function budget has no room for. */}
          <img src="/mzi-logo.png" alt="" aria-hidden className="size-8 shrink-0 object-contain" />
          <span className="t-lg text-[var(--n-800)]">Mzilikazi QS Platform</span>
        </div>

        <div
          className="rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-0)] p-6"
          style={{ boxShadow: "var(--e-1)" }}
        >
          {justSet && (
            <p role="status" data-region="password-set" className="t-sm mb-4 rounded-[var(--r-sm)] bg-[var(--ok-50)] px-3 py-2 text-[var(--ok-700)]">
              Your password is set. Sign in with it.
            </p>
          )}
          <h1 className="t-xl mb-1 text-[var(--n-800)]">Sign in</h1>
          <p className="t-md mb-5 text-[var(--n-500)]">
            Use the email address your practice invited you with.
          </p>

          <form action={submit} className="flex flex-col gap-4">
            {askCode && typed ? (
              <>
                <input type="hidden" name="email" value={typed.email} />
                <input type="hidden" name="password" value={typed.password} />
                <Field id="code" label="Code from your authenticator app" type="text" autoComplete="one-time-code" placeholder="6 digits" />
              </>
            ) : (
              <>
                <Field
                  id="email"
                  label="Email"
                  type="email"
                  autoComplete="username"
                  placeholder="you@practice.co.za"
                />

                <Field
                  id="password"
                  label="Password"
                  type="password"
                  autoComplete="current-password"
                  trailing={
                    <a
                      href="/forgot-password"
                      className="t-sm text-[var(--a-600)] hover:text-[var(--a-700)] hover:underline"
                    >
                      Forgot password?
                    </a>
                  }
                />
              </>
            )}

            <button
              type="submit"
              disabled={pending}
              className="t-base h-9 rounded-[var(--r-md)] bg-[var(--a-500)] font-medium text-white transition-colors hover:bg-[var(--a-600)] disabled:opacity-60"
              style={{ transitionDuration: "var(--m-fast)" }}
            >
              {pending ? "Signing in…" : askCode ? "Confirm" : "Sign in"}
            </button>

            {/*
              §7.8 — announced politely, so a screen-reader user hears the outcome of submitting
              rather than only sighted users seeing it appear.
            */}
            {result?.error && (
              <p
                role="status"
                aria-live="polite"
                className="t-sm rounded-[var(--r-sm)] bg-[var(--err-50)] px-3 py-2 text-[var(--err-700)]"
              >
                {result.error}
              </p>
            )}
          </form>
        </div>

        <p className="t-sm mt-4 text-center text-[var(--n-400)]">
          Accounts are created by invitation. Ask your practice administrator.
        </p>
      </div>
    </main>
  );
}

/**
 * One labelled input — §7.5.
 *
 * The form posts natively to the server action, so the inputs are uncontrolled: no state, no
 * re-render per keystroke, and the browser's own `required` handling for the empty case. Written
 * inline rather than extracted — §13.2 says abstract on the third occurrence, and this is the
 * first.
 */
function Field({
  id,
  label,
  type,
  placeholder,
  autoComplete,
  trailing,
}: {
  id: string;
  label: string;
  type: string;
  placeholder?: string;
  autoComplete?: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="t-sm text-[var(--n-600)]">
          {label}
        </label>
        {trailing}
      </div>

      <input
        id={id}
        name={id}
        type={type}
        required
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="t-md h-9 rounded-[var(--r-sm)] border border-[var(--n-200)] bg-[var(--n-0)] px-2.5 text-[var(--n-800)] outline-none transition-colors placeholder:text-[var(--n-400)] focus:border-[var(--a-500)]"
        style={{ transitionDuration: "var(--m-fast)" }}
      />
    </div>
  );
}
