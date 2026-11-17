/**
 * Upload, on the row of the thing that needs it.
 *
 * These buttons were disabled placeholders. A QS looking at "Client mandate — missing" beside a
 * greyed-out Upload has been told what is wrong and denied the one action that fixes it, then has
 * to scroll to a panel at the foot of the page, find the right kind in a select and work out which
 * of the fourteen requirements they were answering. The requirement and the action to satisfy it
 * belong in the same place.
 *
 * ── The kind is not guessed, it is known ───────────────────────────────────────────────────
 *
 * The documents panel deliberately refuses to default `kind` — filing something as the wrong sort
 * of document is worse than being asked. Here it is not a default: the button lives on one
 * criterion, so a file dropped on it is that criterion's evidence, and the kind comes from where
 * the person clicked rather than from a guess about the file. Where a criterion accepts several
 * kinds the first is the primary one, and it is shown on the button's title so nothing is silent.
 */

"use client";

import { useRef, useState } from "react";
import { FileUp, Loader2 } from "lucide-react";

import { fileDocument } from "@/lib/ingest/file-document";
import { mb, overProxyLimit } from "@/lib/ingest/limits";
import { useRouter } from "next/navigation";

export function CriterionUpload({
  projectId,
  kind,
  label,
  compact = false,
}: {
  projectId: string;
  /** The document kind this criterion is filed under. */
  kind: string;
  /** The criterion's name, for the accessible label. */
  label: string;
  /** On a per-document line, where the row is already narrow. */
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(file: File) {
    setBusy(true);
    setError(null);
    setProgress(null);

    // A large document is no longer refused here. `fileDocument` sends anything over the platform's
    // body limit to storage from the browser, so the geotechnical report a QS actually has can be
    // filed against the row that asks for it.
    const outcome = await fileDocument({
      projectId,
      file,
      kind,
      onProgress: overProxyLimit(file.size)
        ? (fraction) => setProgress(`${Math.round(fraction * 100)}% of ${mb(file.size)}`)
        : undefined,
    });

    setBusy(false);
    setProgress(null);
    if (input.current) input.current.value = "";

    // §1.3 — a refusal says what happened. Silence here would look like a slow network.
    if (!outcome.ok) {
      setError(outcome.error ?? "That did not file. Try again.");
      return;
    }

    // The checklist is server-rendered from the corpus, so the tick appears when the page does.
    router.refresh();
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <input
        ref={input}
        type="file"
        className="sr-only"
        aria-label={`Upload evidence for ${label}`}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void send(file);
        }}
      />

      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        title={`File as ${kind}`}
        className={`t-sm flex shrink-0 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--a-100)] bg-[var(--a-50)] font-medium text-[var(--a-700)] transition-colors hover:border-[var(--a-500)] hover:bg-[var(--a-100)] disabled:opacity-60 ${compact ? "h-6 px-2" : "h-8 px-2.5"}`}
        style={{ transitionDuration: "var(--m-fast)" }}
      >
        {busy ? (
          <Loader2 aria-hidden size={14} strokeWidth={2} className="animate-spin" />
        ) : (
          <FileUp aria-hidden size={14} strokeWidth={2} />
        )}
        {busy ? (progress ?? "Filing…") : "Upload"}
      </button>

      {error && (
        <span role="alert" className="t-xs max-w-[22ch] text-right text-[var(--err-700)]">
          {error}
        </span>
      )}
    </span>
  );
}
