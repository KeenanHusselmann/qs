/**
 * The names both ends of a direct upload have to agree on.
 *
 * ── Separate from the route, for the reason `limits.ts` records ────────────────────────────
 *
 * The browser needs these and so does the server. Importing them from the route handler drags that
 * route's imports into the client bundle — and it imports `storage.ts`, which imports
 * `node:fs/promises`, which Turbopack refuses to put in a browser:
 *
 *     the chunking context does not support external modules (request: node:fs/promises)
 *
 * `limits.ts` was split out of `storage.ts` for exactly this and says so in its own docstring. Pure
 * values live in their own file; anything that touches a disk or a store stays behind.
 */

/**
 * Where a browser may write while a document is in mid-air.
 *
 * A pathname arrives from the client, so it is never trusted. The token route refuses to authorise
 * anything outside this prefix, and the filing route checks it again — a token authorised one
 * upload, while filing says "take what is at that path", and nothing else stops that naming another
 * project's document and copying it into this one.
 */
export const incomingPrefix = (projectId: string) => `incoming/${projectId}/`;

/**
 * What the token route says when this deployment has no store to upload to.
 *
 * Recognised by the browser, which then sends the body the ordinary way: a laptop has no store and
 * no edge limit either, so that works there at any size. Without this the two halves disagreed —
 * `handleUpload` reads `BLOB_READ_WRITE_TOKEN` itself and issued a token, the browser uploaded
 * 22 MB, and only then did the server go looking for the result on a disk that never had it:
 *
 *     ENOENT: no such file or directory, stat '…\.storage\incoming\…'
 *
 * A handover where one end believes in the store and the other does not can only fail *after* the
 * slowest part has already succeeded, which is the worst moment to find out.
 */
export const NO_STORE = "no-document-store";

/**
 * A file attached to an advisor question that is too large to send with it.
 *
 * Uploaded once, straight to the store, and read from there by every question in the conversation
 * that asks about it – never filed, and deleted when the reader removes it or starts over. Kept
 * inside the project's own incoming area, so the same confinement that guards filing guards this.
 */
export const ADVISOR_KIND = "advisor-attachment";
export const advisorPrefix = (projectId: string) => `${incomingPrefix(projectId)}advisor/`;
