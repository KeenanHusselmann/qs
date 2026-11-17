"use client";

/**
 * Filing a standard.
 *
 * ── Four fields, and none of them optional by accident ─────────────────────────────────────
 *
 * The file, a name, what it governs, and when it took effect. The first three are required because
 * the advisor cites a standard by name and says what it governs — a policy without them retrieves
 * as an anonymous block of text and is useless in an answer.
 *
 * The date is the one that may be left out, and the list marks its absence rather than hiding it.
 * A firm that has not recorded when a standard took effect has a real gap, and the page saying so
 * is more use than a blank cell.
 */

import { useState, useTransition } from "react";
import { Upload } from "lucide-react";

import { filePolicy } from "@/app/(app)/policies/actions";

export function FilePolicyForm() {
  const [pending, start] = useTransition();
  const [refusal, setRefusal] = useState<string | null>(null);
  const [filed, setFiled] = useState<string | null>(null);

  return (
    <form
      data-region="file-policy"
      className="rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-0)] p-4"
      action={(form) =>
        start(async () => {
          setRefusal(null);
          setFiled(null);

          const outcome = await filePolicy(form);

          if (outcome.ok) {
            setFiled(String(form.get("title") ?? "The standard"));
            // The form is a `<form action>`, so React resets it on success. The refusal path must
            // not reset — somebody who mistyped a date should not lose the file they chose.
          } else {
            setRefusal(outcome.reason ?? "It could not be filed.");
          }
        })
      }
    >
      <h2 className="t-base font-semibold text-[var(--n-800)]">File a standard</h2>
      <p className="t-sm mt-0.5 text-[var(--n-600)]">
        The advisor consults these on every question, so a standard filed here changes the advice
        given on every project.
      </p>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_170px]">
        <label className="flex flex-col gap-1">
          <span className="t-xs font-medium text-[var(--n-600)]">Name</span>
          <input
            name="title"
            required
            placeholder="Estimating standard"
            className="t-sm h-8 rounded-[var(--r-md)] border border-[var(--n-200)] px-2.5 text-[var(--n-800)] focus:border-[var(--a-500)] focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="t-xs font-medium text-[var(--n-600)]">What it governs</span>
          <input
            name="kind"
            required
            placeholder="Cost estimating and accuracy classes"
            className="t-sm h-8 rounded-[var(--r-md)] border border-[var(--n-200)] px-2.5 text-[var(--n-800)] focus:border-[var(--a-500)] focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="t-xs font-medium text-[var(--n-600)]">Effective from</span>
          <input
            name="effectiveFrom"
            type="date"
            className="t-sm num h-8 rounded-[var(--r-md)] border border-[var(--n-200)] px-2.5 text-[var(--n-800)] focus:border-[var(--a-500)] focus:outline-none"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input
          name="file"
          type="file"
          required
          accept=".pdf,.docx,.md,.txt"
          className="t-sm min-w-0 flex-1 text-[var(--n-700)] file:mr-3 file:h-8 file:rounded-[var(--r-md)] file:border file:border-[var(--n-200)] file:bg-[var(--n-50)] file:px-3 file:text-[var(--n-700)]"
        />

        <button
          type="submit"
          disabled={pending}
          data-action="file-policy"
          className="t-base flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--a-600)] px-3 font-medium text-white transition-colors hover:bg-[var(--a-700)] disabled:opacity-60"
          style={{ transitionDuration: "var(--m-fast)" }}
        >
          <Upload aria-hidden size={14} strokeWidth={2} />
          {pending ? "Reading it…" : "File standard"}
        </button>
      </div>

      {refusal && (
        <p role="alert" className="t-sm mt-2 text-[var(--err-700)]">
          {refusal}
        </p>
      )}

      {filed && (
        <p role="status" className="t-sm mt-2 text-[var(--ok-700)]">
          {filed} is filed. The advisor will consult it from the next question asked.
        </p>
      )}
    </form>
  );
}
