"use client";

/**
 * Settings › People — who can sign in, and what their signatures will say.
 *
 * ── Why this is a section and not a page ───────────────────────────────────────────────────
 *
 * Every route in this app is a serverless function and the deployment is at its cap, so a new page
 * for six rows would cost a function the platform does not have to spend. It also belongs here on
 * its own merits: the rest of Settings is the firm's own configuration, and who works for the firm
 * is the same kind of fact.
 *
 * ── Nobody sets another person's password (audit C7) ─────────────────────────────────────
 *
 * Adding someone, or helping someone locked out, creates a single-use set-password link. It is
 * shown here once for the administrator to send on – and emailed too where email is configured –
 * and the person chooses their own password with it. See `lib/password-links.ts`.
 */

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, KeyRound, ShieldCheck, UserPlus, Users } from "lucide-react";

import { formatDate } from "@/lib/dates";
/* From `people.ts`, never `users.ts`: that one imports `db`, and a client component that
   pulls it in returns 500 for the whole app. See the note there. */
import { type Person } from "@/lib/people";
import {
  addTester,
  createResetLink,
  setPersonActive,
  type LinkAction,
} from "@/app/(app)/settings/people-actions";
import { resetTwoStepFor } from "@/app/(app)/settings/two-step-actions";

export function People({
  people,
  operator,
  canManage,
  you,
}: {
  people: readonly Person[];
  /** The environment credential's address, shown rather than hidden. Empty if none is configured. */
  operator: string;
  canManage: boolean;
  you: string;
}) {
  const router = useRouter();
  const [pending, act] = useTransition();
  const [refusal, setRefusal] = useState<string | null>(null);
  // The last link made – shown once, to be sent on. Never stored in the browser.
  const [link, setLink] = useState<Extract<LinkAction, { ok: true }> | null>(null);
  const [copied, setCopied] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  const makeLink = (work: () => Promise<LinkAction>, done?: () => void) =>
    act(async () => {
      const outcome = await work();
      setRefusal(outcome.ok ? null : outcome.reason);
      setCopied(false);
      if (outcome.ok) {
        setLink(outcome);
        done?.();
        router.refresh();
      }
    });

  const run = (work: () => Promise<{ ok: boolean; reason?: string }>, done?: () => void) =>
    act(async () => {
      const outcome = await work();
      setRefusal(outcome.ok ? null : (outcome.reason ?? "That did not save."));
      if (outcome.ok) {
        done?.();
        router.refresh();
      }
    });

  return (
    <section data-region="people" className="mt-8">
      <header className="flex items-center gap-2">
        <Users aria-hidden size={16} strokeWidth={1.75} className="shrink-0 text-[var(--n-500)]" />
        <h2 className="t-lg font-semibold text-[var(--n-800)]">People</h2>
      </header>

      <p className="t-sm mt-1 max-w-[80ch] text-[var(--n-500)]">
        Everyone here signs in with their own address, and every sign-off records the name of whoever
        made it. That is the point of separate accounts rather than a shared one — a bill signed by
        &ldquo;the office&rdquo; is a bill nobody approved.
      </p>

      {refusal && (
        <p role="alert" className="t-sm mt-3 rounded-[var(--r-md)] border border-[var(--err-500)]/30 bg-[var(--err-50)] px-3 py-2 text-[var(--err-700)]">
          {refusal}
        </p>
      )}

      {link && (
        <div role="status" data-region="password-link" className="t-sm mt-3 rounded-[var(--r-md)] border border-[var(--ok-500)]/30 bg-[var(--ok-50)] px-3 py-2 text-[var(--n-700)]">
          <p>
            <span className="font-medium text-[var(--ok-700)]">A set-password link for {link.name}.</span>{" "}
            {link.emailed ? "It was emailed to them; you can also send it yourself." : "Send it to them – it works once."} Valid until{" "}
            {formatDate(link.expiresAt)}.
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <input readOnly value={link.url} data-input="password-link" aria-label="Set-password link" onFocus={(e) => e.currentTarget.select()} className="t-xs h-7 min-w-0 flex-1 rounded-[var(--r-sm)] border border-[var(--n-200)] bg-[var(--n-0)] px-2 font-mono" />
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(link.url).then(() => setCopied(true), () => setCopied(false))}
              className="t-sm inline-flex h-7 items-center gap-1 rounded-[var(--r-sm)] border border-[var(--n-200)] bg-[var(--n-0)] px-2 font-medium text-[var(--n-700)] hover:bg-[var(--n-50)]"
            >
              <Copy aria-hidden size={12} /> {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      <div className="mt-3 overflow-x-auto rounded-[var(--r-lg)] border border-[var(--n-200)]">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[var(--n-200)] bg-[var(--n-50)]">
              {["Name", "Email", "Added", ""].map((head, i) => (
                <th
                  key={head || i}
                  scope="col"
                  className="t-xs px-3 py-2 text-left font-semibold tracking-wide text-[var(--n-600)] uppercase"
                >
                  {head}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {/*
              The environment credential, listed first and marked.

              It can always sign in and it has no row, so leaving it out would make the list a
              plausible-looking lie: somebody reading it would believe they were seeing everybody
              with access. §13.1 keeps it because production has no shell to recover from.
            */}
            {operator && (
              <tr data-person="operator" className="border-b border-[var(--n-100)] bg-[var(--n-25)]">
                <td className="t-sm px-3 py-2 font-medium text-[var(--n-800)]">
                  The operator
                  <span className="t-xs ml-2 rounded-[var(--r-sm)] bg-[var(--n-200)] px-1.5 py-0.5 font-medium text-[var(--n-700)]">
                    environment
                  </span>
                </td>
                <td className="t-sm px-3 py-2 text-[var(--n-700)]">{operator}</td>
                <td className="t-sm px-3 py-2 text-[var(--n-500)]">—</td>
                <td className="t-sm px-3 py-2 text-[var(--n-500)]">
                  Always able to sign in. Change it where the environment variables live, not here.
                </td>
              </tr>
            )}

            {people.map((person) => {
              const off = person.deactivatedAt !== null;

              return (
                <tr
                  key={person.id}
                  data-person={person.id}
                  className={`border-b border-[var(--n-100)] last:border-0 ${off ? "opacity-55" : ""}`}
                >
                  <td className="t-sm px-3 py-2 font-medium text-[var(--n-800)]">
                    {person.name}
                    {person.isAdmin && (
                      <span className="t-xs ml-2 inline-flex items-center gap-1 rounded-[var(--r-sm)] bg-[var(--a-50)] px-1.5 py-0.5 font-medium text-[var(--a-700)]">
                        <ShieldCheck aria-hidden size={11} strokeWidth={2.25} />
                        administrator
                      </span>
                    )}
                    {person.email.toLowerCase() === you.toLowerCase() && (
                      <span className="t-xs ml-2 text-[var(--n-500)]">you</span>
                    )}
                  </td>
                  <td className="t-sm px-3 py-2 text-[var(--n-700)]">{person.email}</td>
                  <td className="t-sm px-3 py-2 whitespace-nowrap text-[var(--n-500)]">
                    {off ? (
                      <span className="text-[var(--warn-700)]">
                        no access since {formatDate(person.deactivatedAt)}
                      </span>
                    ) : (
                      formatDate(person.createdAt)
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {canManage && (
                      <span className="flex flex-wrap items-center justify-end gap-2">
                        <button
                          type="button"
                          disabled={pending}
                          data-action="reset-password"
                          onClick={() => makeLink(() => createResetLink(person.id))}
                          className="t-sm inline-flex items-center gap-1.5 rounded-[var(--r-sm)] border border-[var(--n-200)] px-2 py-0.5 font-medium text-[var(--n-600)] transition-colors hover:bg-[var(--n-50)] disabled:opacity-50"
                          style={{ transitionDuration: "var(--m-fast)" }}
                        >
                          <KeyRound aria-hidden size={12} strokeWidth={2} />
                          Set-password link
                        </button>

                        {/* A lost phone: clears two-step so they can set it up again. */}
                        {person.twoStep && (
                          <button
                            type="button"
                            disabled={pending}
                            data-action="reset-two-step"
                            onClick={() => run(() => resetTwoStepFor(person.id))}
                            className="t-sm rounded-[var(--r-sm)] border border-[var(--n-200)] px-2 py-0.5 font-medium text-[var(--n-600)] transition-colors hover:bg-[var(--n-50)] disabled:opacity-50"
                          >
                            Reset two-step
                          </button>
                        )}

                        <button
                          type="button"
                          disabled={pending}
                          data-action={off ? "reactivate" : "deactivate"}
                          onClick={() => run(() => setPersonActive(person.id, off))}
                          className={`t-sm rounded-[var(--r-sm)] border px-2 py-0.5 font-medium transition-colors disabled:opacity-50 ${
                            off
                              ? "border-[var(--n-200)] text-[var(--n-600)] hover:bg-[var(--n-50)]"
                              : "border-[var(--err-500)]/40 text-[var(--err-700)] hover:bg-[var(--err-50)]"
                          }`}
                          style={{ transitionDuration: "var(--m-fast)" }}
                        >
                          {off ? "Restore access" : "Remove access"}
                        </button>
                      </span>
                    )}

                  </td>
                </tr>
              );
            })}

            {people.length === 0 && (
              <tr>
                <td colSpan={4} className="t-sm px-3 py-3 text-[var(--n-600)]">
                  Nobody has an account yet. Everything signed so far carries the operator&rsquo;s
                  address.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {canManage ? (
        <form
          ref={form}
          data-region="add-person"
          className="mt-3 flex flex-wrap items-end gap-3 rounded-[var(--r-lg)] border border-[var(--n-200)] px-4 py-3"
          action={(data) => makeLink(() => addTester(data), () => form.current?.reset())}
        >
          <label className="flex flex-col gap-1">
            <span className="t-sm text-[var(--n-600)]">Name</span>
            <input
              name="name"
              required
              placeholder="As it should appear on a signature"
              className="t-sm h-8 w-[230px] rounded-[var(--r-md)] border border-[var(--n-200)] px-2 outline-none focus:border-[var(--a-500)]"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="t-sm text-[var(--n-600)]">Email</span>
            <input
              name="email"
              type="email"
              required
              placeholder="they@example.co.za"
              className="t-sm h-8 w-[230px] rounded-[var(--r-md)] border border-[var(--n-200)] px-2 outline-none focus:border-[var(--a-500)]"
            />
          </label>

          <label className="flex h-8 items-center gap-2">
            <input name="isAdmin" type="checkbox" className="size-3.5 accent-[var(--a-500)]" />
            <span className="t-sm text-[var(--n-600)]">Can manage people</span>
          </label>

          <button
            type="submit"
            disabled={pending}
            data-action="add-person"
            className="t-sm flex h-8 items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--n-800)] px-3 font-medium text-white transition-colors hover:bg-[var(--n-900)] disabled:cursor-not-allowed disabled:opacity-50"
            style={{ transitionDuration: "var(--m-fast)" }}
          >
            <UserPlus aria-hidden size={13} strokeWidth={2.25} />
            {pending ? "Adding…" : "Add"}
          </button>
        </form>
      ) : (
        <p className="t-sm mt-3 text-[var(--n-500)]">
          Only an administrator can add or remove people. Ask one of the people marked above.
        </p>
      )}
    </section>
  );
}
