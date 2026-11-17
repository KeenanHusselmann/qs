/**
 * A filed document, named and openable.
 *
 * ── The name, not the path ─────────────────────────────────────────────────────────────────
 *
 * A row used to read `Talani QS - for Feasibility/02 March LAND USE SUBMISSION FOLDER FINAL/
 * ANNEXURE A - POWER OF ATTORNEY/…` and ran out of column before it reached `poa.pdf`. Forty rows
 * of that share a prefix for their first sixty characters and differ only where the text is cut
 * off, so the list is unreadable in exactly the way a list of filenames must not be.
 *
 * The name is what identifies a document to the person who filed it. The folders it came in are
 * **provenance** — real, worth keeping, and worth showing quietly underneath, because `ANNEXURE A`
 * is how a land-use submission refers to its own contents and a reader confirming they filed the
 * right thing looks for exactly that.
 *
 * ── Why it is a link ───────────────────────────────────────────────────────────────────────
 *
 * §1.3.2 makes a citation the proof of a criterion. A proof you cannot open is an assertion. The
 * href streams the original read-only (see the route) and opens in a new tab, because a QS checking
 * evidence is in the middle of something and must come back to it.
 */

import { FileText } from "lucide-react";

import { foldersOf } from "@/lib/ingest/filename";

/**
 * The name is on the end of the URL, and the route ignores it.
 *
 * Chrome's PDF viewer titles the tab from the **last path segment**, not from
 * `Content-Disposition`. Without this the QS who opens three pieces of evidence gets three tabs
 * labelled `84b042e3-98ef-4312-…`, which is the same failure this whole change is about: the
 * identifier winning over the name.
 */
export function documentHref(projectId: string, documentId: string, filename: string): string {
  return `/api/projects/${projectId}/documents/${documentId}/${encodeURIComponent(filename)}`;
}

export function DocumentLink({
  projectId,
  documentId,
  filename,
  className = "t-sm",
}: {
  projectId?: string;
  documentId?: string;
  filename: string;
  className?: string;
}) {
  // Before a document is filed there is nothing to open, and a link to nowhere is worse than
  // plain text — it invites a click that does nothing and teaches that the links do not work.
  if (!projectId || !documentId) {
    return <span className={`${className} font-medium text-[var(--n-800)]`}>{filename}</span>;
  }

  return (
    <a
      href={documentHref(projectId, documentId, filename)}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open ${filename} in a new tab`}
      data-document-link={documentId}
      className={`${className} inline-flex max-w-full items-baseline gap-1 font-medium text-[var(--a-600)] underline decoration-[var(--n-300)] underline-offset-2 hover:decoration-[var(--a-600)]`}
    >
      <FileText aria-hidden size={12} strokeWidth={2} className="shrink-0 translate-y-px" />
      {/* Truncation is the default because most callers render a list of filenames in a fixed
          column. A caller that is showing the name *as evidence* overrides it — see the run
          table's Source cell, where a cut-off name is a citation nobody can check. */}
      <span className="truncate">{filename}</span>
    </a>
  );
}

/**
 * Where the document sat in the folder it arrived in.
 *
 * ── The innermost folder, not the whole chain ──────────────────────────────────────────────
 *
 * The full path rendered and truncated by CSS cuts the **end**, which is the half that carries the
 * meaning: `Talani QS - for Feasibility / 02 March LAND USE SUBMISSION FOLDER FINAL / ANNEXURE A -
 * POWER OF ATTO…`. Forty rows of that share their visible prefix and lose the only words that tell
 * them apart — the same failure as filing the path in place of the name, one line further down.
 *
 * So the folder the document actually sat in leads, because `ANNEXURE A - POWER OF ATTORNEY` is
 * how a land-use submission refers to its own contents and is what `inferKind` matched on. The
 * chain above it is on the title, and all of it is in `source_path` either way.
 *
 * Nothing renders for a document filed one at a time. It has no path, and an empty provenance line
 * implies one exists.
 */
export function DocumentOrigin({
  sourcePath,
  inline = false,
}: {
  sourcePath: string | null | undefined;
  /** Sits on a line with other facts rather than owning one of its own. */
  inline?: boolean;
}) {
  const folders = foldersOf(sourcePath);
  if (folders.length === 0) return null;

  if (inline) return <span title={folders.join(" / ")}>{folders.at(-1)}</span>;

  return (
    <span className="t-xs block truncate text-[var(--n-400)]" title={folders.join(" / ")}>
      {folders.at(-1)}
    </span>
  );
}
