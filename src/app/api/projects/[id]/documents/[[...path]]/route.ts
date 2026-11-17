/**
 * Everything a project's documents answer to, behind one route.
 *
 * ── Why one route and not three ────────────────────────────────────────────────────────────
 *
 * Filing, opening and authorising an upload were three route files, which is three serverless
 * functions. Vercel's Hobby plan allows twelve per deployment and this app had sixteen, so deploys
 * stopped outright: the code pushed, and production carried on serving the build before it. The
 * error names the cap and nothing else, so it is worth writing down here — the next route added to
 * this app is the one that has to justify itself.
 *
 * The work itself did not move into this file. Each handler keeps its own module and its own
 * reasoning in `src/lib/documents`; this only decides which of them a request is for. A dispatcher
 * that also did the work would be three concerns in one file to satisfy a billing limit, which is
 * how a plan constraint turns into a design.
 *
 * ── The shapes it dispatches ───────────────────────────────────────────────────────────────
 *
 *     POST  /documents                     file a document (multipart, or a handover pathname)
 *     POST  /documents/upload-url          authorise a direct upload
 *     GET   /documents/upload-url          can a browser upload directly here?
 *     GET   /documents/<id>/<name>         stream the original, read-only
 *
 * A document id is a UUID, so it can never collide with `upload-url`.
 */

import { fileDocument } from "@/lib/documents/file";
import { openDocument } from "@/lib/documents/open";
import { issueUploadToken, uploadCapability } from "@/lib/documents/upload-token";

/** The one path segment that is a command rather than a document. */
const UPLOAD_URL = "upload-url";

const refuse = (message: string, status: number) =>
  new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; path?: string[] }> },
) {
  const { id: projectId, path = [] } = await params;

  if (path[0] === UPLOAD_URL) return uploadCapability();

  // `path[1]` is the filename, and is deliberately ignored — it is in the URL so a browser titles
  // the tab with it rather than with a UUID. See `open.ts`.
  if (path[0]) return openDocument(projectId, path[0]);

  return refuse("Name a document to open.", 404);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; path?: string[] }> },
) {
  const { id: projectId, path = [] } = await params;

  if (path[0] === UPLOAD_URL) return issueUploadToken(request, projectId);
  if (path.length === 0) return fileDocument(request, projectId);

  /**
   * A document is read and never written, and this is now where that is enforced.
   *
   * It used to be enforced by omission: the open route exported `GET` alone, so every other verb
   * was 405 before any code ran. Merging the routes gave this file a `POST`, which turned that into
   * a 404 and quietly changed a guarantee §1.3.2 depends on — a document that can be edited after a
   * passage in it grounded a criterion is no longer evidence, and the tick stays green over it.
   *
   * PUT, PATCH and DELETE are still 405 by omission, because nothing here exports them.
   */
  return refuse("A filed document is read, never written.", 405);
}
