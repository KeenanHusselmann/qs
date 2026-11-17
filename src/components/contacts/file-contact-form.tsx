"use client";

/**
 * Filing a directory entry.
 *
 * ── Two required fields, and the rest genuinely optional ───────────────────────────────────
 *
 * An organisation and a kind. A practice routinely knows a company before it knows who answers
 * there, and a form insisting on a person gets "TBC" typed into it — which is worse than a blank,
 * because a blank is visibly missing and "TBC" looks like a value that survives into a report.
 */

import { useState, useTransition } from "react";
import { UserPlus } from "lucide-react";

import { fileContact } from "@/app/(app)/contacts/actions";
import { CONTACT_KINDS, KIND_LABEL } from "@/lib/contact-kinds";

export function FileContactForm() {
  const [pending, start] = useTransition();
  const [refusal, setRefusal] = useState<string | null>(null);
  const [filed, setFiled] = useState<string | null>(null);

  return (
    <form
      data-region="file-contact"
      className="rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-0)] p-4"
      action={(form) =>
        start(async () => {
          setRefusal(null);
          setFiled(null);

          const outcome = await fileContact(form);

          if (outcome.ok) setFiled(String(form.get("organisation") ?? "The entry"));
          else setRefusal(outcome.reason ?? "It could not be filed.");
        })
      }
    >
      <h2 className="t-base font-semibold text-[var(--n-800)]">Add a contact</h2>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[1.4fr_150px_1fr_1fr]">
        <label className="flex flex-col gap-1">
          <span className="t-xs font-medium text-[var(--n-600)]">Organisation</span>
          <input
            name="organisation"
            required
            placeholder="Ridgeview Housing Development Company"
            className="t-sm h-8 rounded-[var(--r-md)] border border-[var(--n-200)] px-2.5 text-[var(--n-800)] focus:border-[var(--a-500)] focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="t-xs font-medium text-[var(--n-600)]">Kind</span>
          <select
            name="kind"
            required
            defaultValue="client"
            className="t-sm h-8 rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] px-2 text-[var(--n-800)] focus:border-[var(--a-500)] focus:outline-none"
          >
            {CONTACT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {KIND_LABEL[kind]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="t-xs font-medium text-[var(--n-600)]">Person</span>
          <input
            name="person"
            placeholder="Optional"
            className="t-sm h-8 rounded-[var(--r-md)] border border-[var(--n-200)] px-2.5 text-[var(--n-800)] placeholder:text-[var(--n-400)] focus:border-[var(--a-500)] focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="t-xs font-medium text-[var(--n-600)]">Role</span>
          <input
            name="role"
            placeholder="Optional"
            className="t-sm h-8 rounded-[var(--r-md)] border border-[var(--n-200)] px-2.5 text-[var(--n-800)] placeholder:text-[var(--n-400)] focus:border-[var(--a-500)] focus:outline-none"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex min-w-[220px] flex-1 flex-col gap-1">
          <span className="t-xs font-medium text-[var(--n-600)]">Email</span>
          <input
            name="email"
            type="email"
            placeholder="Optional"
            className="t-sm h-8 rounded-[var(--r-md)] border border-[var(--n-200)] px-2.5 text-[var(--n-800)] placeholder:text-[var(--n-400)] focus:border-[var(--a-500)] focus:outline-none"
          />
        </label>

        <label className="flex min-w-[160px] flex-col gap-1">
          <span className="t-xs font-medium text-[var(--n-600)]">Phone</span>
          <input
            name="phone"
            placeholder="Optional"
            className="t-sm num h-8 rounded-[var(--r-md)] border border-[var(--n-200)] px-2.5 text-[var(--n-800)] placeholder:text-[var(--n-400)] focus:border-[var(--a-500)] focus:outline-none"
          />
        </label>

        <button
          type="submit"
          disabled={pending}
          data-action="file-contact"
          className="t-base flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--a-600)] px-3 font-medium text-white transition-colors hover:bg-[var(--a-700)] disabled:opacity-60"
          style={{ transitionDuration: "var(--m-fast)" }}
        >
          <UserPlus aria-hidden size={14} strokeWidth={2} />
          {pending ? "Filing…" : "Add contact"}
        </button>
      </div>

      {refusal && (
        <p role="alert" className="t-sm mt-2 text-[var(--err-700)]">
          {refusal}
        </p>
      )}

      {filed && (
        <p role="status" className="t-sm mt-2 text-[var(--ok-700)]">
          {filed} is filed.
        </p>
      )}
    </form>
  );
}
