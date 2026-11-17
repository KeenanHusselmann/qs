/**
 * Upload limits and formatting.
 *
 * ── Separate from `storage.ts` on purpose ──────────────────────────────────────────────────
 *
 * These two values are needed on **both** sides: the browser checks a file's size before sending
 * it, and the server checks again before accepting it. `storage.ts` imports `node:fs/promises`, so
 * importing the constants from there pulled the filesystem into the client bundle and Turbopack
 * refused to build the page at all —
 *
 *     the chunking context does not support external modules (request: node:fs/promises)
 *
 * Pure values live here; anything that touches a disk stays in `storage.ts`.
 */

/**
 * The largest file the platform accepts.
 *
 * Sized from real client documents rather than a round number: market studies in the reference
 * corpus run to 22 MB, transport impact assessments to 10 MB, and a full drawing set is larger
 * still. 64 MB clears those with room, and anything beyond it is refused with a reason rather than
 * failing somewhere deep in the request.
 */
export const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

/**
 * What a serverless function will actually accept through the platform proxy.
 *
 * Our own limit is 64MB and a container honours it. **Vercel does not**: request bodies over about
 * 4.5MB are rejected at the edge, before the function runs, so no handler of ours ever sees them
 * and no error of ours describes them. A real geotechnical report from this corpus is 11.8MB, and
 * it failed with "Did not reach the server" — true, and useless.
 *
 * Checked in the browser so the message can name the size and the limit rather than reporting a
 * network fault. The real fix is uploading straight to Blob storage and handing the function only
 * the URL, which removes the body from the request entirely; until then this refuses honestly.
 */
export const PROXY_BODY_LIMIT = 4.5 * 1024 * 1024;

export const overProxyLimit = (bytes: number) => bytes > PROXY_BODY_LIMIT;

/** "11.8 MB" — for saying plainly what was too big. */
export const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export const formatBytes = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
