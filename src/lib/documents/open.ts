/**
 * Opening a filed document — PLATFORM.md §1.3.2.
 *
 * ── Read, and only read ────────────────────────────────────────────────────────────────────
 *
 * This module opens a document and cannot write one, and that is the feature rather than an
 * oversight. PUT, PATCH and DELETE never reach it: the route that calls it does not export them,
 * so they are 405 before any code runs. POST is refused explicitly by that route, because merging
 * three routes into one gave the file a POST and turned a guarantee into a 404 for one commit.
 *
 * The reason is §1.3.2's, not a security posture. A criterion is satisfied by a passage that can be
 * quoted from a filed document. If that document can be edited after the fact, the quote stops
 * being evidence and becomes a claim about a file that no longer exists — and the platform would go
 * on showing a green tick over it. The corpus is the record; corrections are filed as new documents
 * and the old one is withdrawn, which is what `removeDocument` already does.
 *
 * ── Withdrawn documents still open ─────────────────────────────────────────────────────────
 *
 * A withdrawn document stops answering searches (`retrieve.ts` joins on `deleted_at is null`) and
 * disappears from every list. It stays *openable*, because §13.4's whole point is that a document
 * something once cited remains resolvable. Someone auditing a six-month-old run needs to see what
 * the run actually read, not a dead link.
 *
 * ── The trailing name segment ──────────────────────────────────────────────────────────────
 *
 * `[[...name]]` matches zero or more segments and **nothing here reads it**. It exists because
 * Chrome titles a PDF tab from the last path segment rather than from `Content-Disposition`, so
 * `…/documents/84b042e3-…` opens a tab called `84b042e3-…` — the identifier winning over the name,
 * which is the thing this whole change is about. The name rides along so the tab is called
 * `title-deed.pdf`, while the document is still resolved from its id alone. That is what stops a
 * name in a URL from being able to address anything.
 */

import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { documents } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { locate, open } from "@/lib/ingest/storage";

/**
 * How a browser should treat each format.
 *
 * `inline` only where a browser renders the thing itself — a PDF opens in a tab, which is the
 * point of this route. A .docx has no renderer, so `inline` would produce a download with a
 * confusing name or a page of binary; it is offered as a download and says so.
 *
 * Anything not listed downloads as `application/octet-stream`. Refusing to name a type the platform
 * has not thought about is deliberate: an unrecognised upload served as `text/html` on this origin
 * would run as this application.
 */
const FORMATS: Record<string, { type: string; inline: boolean }> = {
  pdf: { type: "application/pdf", inline: true },
  txt: { type: "text/plain; charset=utf-8", inline: true },
  md: { type: "text/plain; charset=utf-8", inline: true },
  png: { type: "image/png", inline: true },
  jpg: { type: "image/jpeg", inline: true },
  jpeg: { type: "image/jpeg", inline: true },
  csv: { type: "text/csv; charset=utf-8", inline: false },
  docx: {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    inline: false,
  },
  xlsx: { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", inline: false },
};

const formatOf = (filename: string) =>
  FORMATS[filename.toLowerCase().split(".").pop() ?? ""] ?? {
    type: "application/octet-stream",
    inline: false,
  };

/**
 * A filename a header can carry.
 *
 * The plain `filename=` parameter is ASCII-only and cannot hold a quote or a newline, so it gets a
 * stripped version and `filename*` carries the real one. Header injection is the reason rather than
 * tidiness: this string came from an upload.
 */
function disposition(filename: string, inline: boolean): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

const refuse = (message: string, status: number) =>
  new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

/**
 * Opening a filed document. Reached by `GET /api/projects/[id]/documents/<documentId>/<name>`.
 *
 * The trailing name segment is ignored — see the note above on why it is in the URL at all.
 */
export async function openDocument(projectId: string, documentId: string) {
  const session = await getSession();
  if (!session) return refuse("Not signed in.", 401);

  /**
   * Matched on **both** ids.
   *
   * Scoping in the query rather than checking afterwards, for the same reason retrieval does it
   * (§1.3.2): a document id guessed or carried over from another scheme must not resolve here. One
   * project's evidence appearing under another project's URL is the failure that would end trust in
   * the platform, and it is prevented by the `where` clause rather than by remembering to check.
   */
  const [document] = await db
    .select({
      filename: documents.filename,
      storageLocation: documents.storageLocation,
    })
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.projectId, projectId)))
    .limit(1);

  if (!document) return refuse("No such document in this project.", 404);

  /**
   * Where the bytes are.
   *
   * Recorded at filing time — but the record is not trusted over the file system, because a
   * recorded location can go stale. A row written before that column existed has none, and a row
   * written before locations were made portable holds an absolute path from whatever machine filed
   * it. Moving this project between drives broke precisely that, and the recovery is cheap because
   * the storage key is derived from the document id: if the recorded place does not open, look.
   */
  let opened;
  let failure: unknown = null;

  for (const location of [document.storageLocation, await locate(documentId, document.filename)]) {
    if (!location) continue;
    try {
      opened = await open(location);
      break;
    } catch (error) {
      failure = error;
    }
  }

  if (!opened) {
    // §1.3 — said, not swallowed. "The original was not retained" and "something broke" send a
    // reader to two completely different places, so they are two different messages.
    return failure
      ? refuse(
          `${document.filename} is filed, but its stored copy could not be read: ${
            failure instanceof Error ? failure.message : "unknown error"
          }`,
          502,
        )
      : refuse(
          `The original of ${document.filename} was not retained, so it cannot be opened. It was read and indexed when it was filed, so what it says is still searchable — but the file itself is gone.`,
          410,
        );
  }

  const format = formatOf(document.filename);

  return new Response(opened.body, {
    headers: {
      "content-type": format.type,
      "content-disposition": disposition(document.filename, format.inline),
      ...(opened.size ? { "content-length": String(opened.size) } : {}),

      // The declared type is the only one honoured — an upload must never be sniffed into
      // something executable on this origin.
      "x-content-type-options": "nosniff",
      // And if it somehow is active content, it runs with no origin, no scripts, no forms.
      "content-security-policy": "sandbox; default-src 'none'; object-src 'self'",

      // Private, and revalidated. A client document must not sit in a shared cache, and a
      // withdrawn one must not keep opening from a stale copy.
      "cache-control": "private, no-cache, max-age=0, must-revalidate",
    },
  });
}
