/**
 * Sending one document to the platform, from the browser.
 *
 * ── Two routes in, because of a limit that is not ours ─────────────────────────────────────
 *
 * A document under Vercel's ~4.5 MB edge limit goes as a multipart body, which is the simple thing
 * and works on any host, including a laptop with no blob store connected.
 *
 * Anything larger cannot: the request is refused *upstream of the function*, so no handler of ours
 * ever sees it and no message of ours can describe it — which is how an 11.8 MB geotechnical report
 * came to fail with "Did not reach the server". True, and useless. Those go straight to the store
 * from here, and the platform is handed a pathname instead of a body.
 *
 * The split is by size and nothing else. Every document ends up in the same ingestion, filed the
 * same way, measured the same way; only the first hop differs.
 */

import { advisorPrefix, ADVISOR_KIND, incomingPrefix } from "@/lib/ingest/handover";
import { overProxyLimit, PROXY_BODY_LIMIT, mb } from "@/lib/ingest/limits";

export interface FileOutcome {
  ok: boolean;
  error?: string;
  /** Filed, but nothing readable came out of it. Never silent (§1.3). */
  warning?: string;
}

/**
 * File one document against a project.
 *
 * `path` is the document's path within a dropped folder, when it has one — it becomes provenance.
 * For a large upload the browser must send it explicitly, because the multipart filename that
 * usually smuggles it is not involved.
 */
export async function fileDocument({
  projectId,
  file,
  kind,
  path,
  onProgress,
}: {
  projectId: string;
  file: File;
  kind: string;
  path?: string;
  /** 0–1, for the large-upload path where a 22 MB file is a visible wait. */
  onProgress?: (fraction: number) => void;
}): Promise<FileOutcome> {
  const body = new FormData();
  body.set("kind", kind);

  if (!overProxyLimit(file.size)) {
    // The name carries the folder path here, exactly as a directory picker sends it, and the
    // server splits it back apart (`nameAndOrigin`).
    body.append("file", file, path || file.name);
    return send(projectId, body);
  }

  /**
   * Ask first, because a deployment without a store cannot take a direct upload.
   *
   * A laptop has no store connected and no edge limit either, so the ordinary body works there at
   * any size — falling back is the right answer, not a failure. On Vercel the body is refused at
   * the edge with a message that says so. Skipping this question produced
   * `ENOENT … .storage\incoming\…`: the token route reads the environment variable itself and
   * issued one, the browser uploaded 22 MB, and only then did the server go looking for the result
   * on a disk that never had it.
   */
  if (!(await storeAvailable(projectId))) {
    body.append("file", file, path || file.name);
    return send(projectId, body);
  }

  let pathname: string;
  try {
    const { upload } = await import("@vercel/blob/client");

    // A pathname inside this project's own incoming area. The server refuses to issue a token for
    // anything else, and refuses to file from anywhere else.
    const target = `${incomingPrefix(projectId)}${crypto.randomUUID()}`;

    const blob = await upload(target, file, {
      access: "private",
      handleUploadUrl: `/api/projects/${projectId}/documents/upload-url`,
      clientPayload: JSON.stringify({ kind }),
      multipart: true,
      onUploadProgress: onProgress ? throttled(onProgress) : undefined,
    });

    pathname = blob.pathname;
  } catch (error) {
    return {
      ok: false,
      error: `${file.name} is ${mb(file.size)} and could not be sent to storage: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    };
  }

  // The bytes are in storage; this asks the platform to file what is there. A couple of hundred
  // bytes, whatever the document weighs — which is the whole point.
  body.set("blobPathname", pathname);
  body.set("filename", path || file.name);
  return send(projectId, body);
}

/**
 * Progress, at a rate a person can read and a browser can paint.
 *
 * `onUploadProgress` fires per chunk, and every call lands in React state — which on the import
 * screen re-renders the whole list. With one row and one file the spinner's frame gaps went from
 * 6ms to 12ms median and 25ms at p95; a real import is fifty-nine rows and a 22 MB document, and
 * that is what "the spinner is not doing steady rotations" looks like.
 *
 * Four updates a second is faster than anyone reads a percentage and slow enough to stop the list
 * thrashing. The last call always lands, so the number never stalls short of where it finished.
 */
function throttled(report: (fraction: number) => void) {
  let last = 0;

  return ({ percentage }: { percentage: number }) => {
    const now = Date.now();
    if (percentage < 100 && now - last < 250) return;
    last = now;
    report(percentage / 100);
  };
}

/**
 * Whether this deployment can take a direct upload at all.
 *
 * One extra round trip, and only for a document already large enough to be a visible wait. Asked
 * rather than inferred: the first version refused the token with a recognisable marker and matched
 * on the thrown error, `upload()` wrapped the failure in its own type, the marker did not survive,
 * and a 5 MB document failed with nothing filed and no fallback.
 */
export async function storeAvailable(projectId: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/projects/${projectId}/documents/upload-url`);
    if (!response.ok) return false;
    return ((await response.json()) as { direct?: boolean }).direct === true;
  } catch {
    // Unreachable is not "no store" — but a direct upload cannot work either way, and the body
    // path gives a better message than a token request that never answered.
    return false;
  }
}

async function send(projectId: string, body: FormData): Promise<FileOutcome> {
  try {
    const response = await fetch(`/api/projects/${projectId}/documents`, { method: "POST", body });

    /**
     * Parsed defensively. A 500 from the framework has no JSON body, and calling `.json()` on it
     * throws — which used to send the failure down the catch below and report that the upload
     * "did not reach the server". It plainly had. An error that misdirects is worse than a blunt
     * one, because it sends someone to check their connection instead of their file.
     */
    const outcome = (await response.json().catch(() => null)) as FileOutcome | null;

    if (!response.ok || !outcome?.ok) {
      return {
        ok: false,
        error:
          outcome?.error ??
          `The server refused the file (HTTP ${response.status}). Documents over ${mb(PROXY_BODY_LIMIT)} go to storage directly; this one did not.`,
      };
    }

    return outcome;
  } catch {
    return { ok: false, error: "The upload did not reach the server. Check the connection." };
  }
}

/**
 * Hand a large advisor attachment to the store, once.
 *
 * Returns the pathname every later question in the conversation sends in place of the bytes, or
 * null where the file can go with the question as it is: small enough for the edge, or a laptop
 * with no store and no edge limit either.
 */
export async function handAttachment(projectId: string, file: File): Promise<string | null> {
  if (!overProxyLimit(file.size)) return null;
  if (!(await storeAvailable(projectId))) return null;
  const { upload } = await import("@vercel/blob/client");
  const blob = await upload(`${advisorPrefix(projectId)}${crypto.randomUUID()}`, file, {
    access: "private",
    handleUploadUrl: `/api/projects/${projectId}/documents/upload-url`,
    clientPayload: JSON.stringify({ kind: ADVISOR_KIND }),
    multipart: true,
  });
  return blob.pathname;
}
