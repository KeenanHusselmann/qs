"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, RotateCcw } from "lucide-react";

import { setAdhocAnswered } from "@/app/(app)/projects/actions";

/** Mark an ad hoc request answered, or open it again. Nothing is removed either way. */
export function AnsweredToggle({ id, answered }: { id: string; answered: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        data-action={answered ? "reopen-adhoc" : "answer-adhoc"}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await setAdhocAnswered(id, !answered).catch(() => ({ ok: false, reason: "The server did not answer. Try again." }));
            if (!result.ok) setError(result.reason ?? "That did not save.");
            else router.refresh();
          })
        }
        className={`t-sm inline-flex h-8 items-center gap-1.5 rounded-[var(--r-md)] px-3 font-medium transition-colors disabled:opacity-60 ${
          answered
            ? "border border-[var(--n-300)] bg-[var(--n-0)] text-[var(--n-700)] hover:bg-[var(--n-50)]"
            : "bg-[var(--ok-500)] text-white hover:bg-[var(--ok-700)]"
        }`}
      >
        {answered ? <RotateCcw aria-hidden size={13} /> : <Check aria-hidden size={14} />}
        {answered ? "Open it again" : "Mark answered"}
      </button>
      {error && <p role="alert" className="t-xs text-[var(--err-700)]">{error}</p>}
    </div>
  );
}
