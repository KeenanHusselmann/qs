/**
 * Where a filed document's bytes live.
 *
 * ── Two backing stores, chosen by what the environment actually has ────────────────────────
 *
 * PLATFORM.md §13.1 chose a single long-running container, where the filesystem is real and a
 * directory is the obvious answer. Vercel's filesystem is **ephemeral** — a file written during one
 * invocation is gone by the next — so on Vercel the bytes go to Blob storage instead.
 *
 * Every caller goes through `store` and `read`, so which one is in use is not a concern anywhere
 * else, and adding a third later is one file.
 *
 * **If neither is available the original is not retained, and that is reported rather than
 * swallowed.** The document is still parsed and indexed, so criteria can find their evidence — but
 * OCR and the drawing engine (§10) will want the original, and a platform that quietly discarded it
 * would be promising a re-read it cannot perform.
 */

import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { Readable } from "node:stream";

/** Overridable so a container can mount a volume somewhere else. */
const ROOT = process.env.STORAGE_DIR ?? join(process.cwd(), ".storage");

/**
 * Blob is used when a token is present — Vercel injects one once a store is connected.
 *
 * **Not locally, though.** Connecting the store wrote `BLOB_READ_WRITE_TOKEN` into `.env.local`,
 * and with it every `npm run check` would push its fixtures — including two 3 MB drawings per run —
 * into a client's production storage, with nothing to clean them up. That is the same mistake as
 * pointing local dev at Neon, which this repo has always refused to make.
 *
 * So the store is used on Vercel, or when something opts in explicitly: `npm run check:blob` does,
 * and round-trips one document through the real store to prove this path works.
 */
const blobToken = () =>
  process.env.VERCEL || process.env.USE_BLOB_STORAGE
    ? process.env.BLOB_READ_WRITE_TOKEN
    : undefined;

/**
 * Whether a browser may upload straight to the store.
 *
 * **Every part of the platform must answer this the same way.** It did not: the route issuing
 * upload tokens called `@vercel/blob`'s `handleUpload`, which reads `BLOB_READ_WRITE_TOKEN` from
 * the environment itself, while reads went through `blobToken()` above and were switched off
 * locally. So a large document uploaded to the store perfectly well and then failed to file with
 *
 *     ENOENT: no such file or directory, stat 'D:\…\.storage\incoming\…'
 *
 * — the server looking on disk for something it had just told the browser to put in the cloud. One
 * half of a handover deciding the store exists while the other half decides it does not is a
 * failure that can only appear after the slowest part of the operation has already succeeded.
 */
export const storeIsConnected = () => Boolean(blobToken());

/**
 * Two levels of fan-out from the id.
 *
 * A single flat directory with tens of thousands of files is slow to list and unpleasant to back
 * up. Sharding on the first four hex characters keeps any one directory small.
 *
 * Derived from the id rather than the filename: two projects filing "Cost plan.pdf" must not
 * collide, and a filename from an upload is untrusted input that could contain `../`.
 */
function keyFor(documentId: string, extension: string): string {
  const hash = createHash("sha256").update(documentId).digest("hex");
  return `${hash.slice(0, 2)}/${hash.slice(2, 4)}/${documentId}${extension}`;
}

const extensionOf = (filename: string) => {
  const dot = filename.lastIndexOf(".");
  // Bounded and stripped of anything that is not a word character: an "extension" from an upload
  // is untrusted, and this becomes part of a path.
  return dot >= 0 ? `.${filename.slice(dot + 1).replace(/\W/g, "").slice(0, 8).toLowerCase()}` : "";
};

/**
 * `location` is what gets written down, and it is **the storage key** — `ab/cd/<id>.pdf` — under
 * whichever store this deployment has. Never an absolute path, and no longer a URL.
 *
 * The first version recorded `join(ROOT, key)`, and moving this project from one drive to another
 * broke every document filed before the move: the row pointed at a path that no longer existed on
 * a machine that still had the file. A container remounting its volume elsewhere, a different
 * `STORAGE_DIR`, or a restore onto a new host would each have done the same thing quietly. A
 * database row should say *which* document, not which drive letter someone had that afternoon.
 *
 * A Blob URL had the same weakness in a different coat: it names a store, so a row written against
 * one store does not resolve against another. The key does, and — since the store is private — the
 * URL was never something to hand out anyway.
 */
export type StorageResult = { retained: true; location: string } | { retained: false; reason: string };

/** A location from an earlier build: an absolute path, or a Blob URL. Both are used verbatim. */
const isPortable = (location: string) => !location.startsWith("http") && !isAbsolute(location);

/** Where a recorded location actually is on disk. */
const resolve = (location: string) => (isPortable(location) ? join(ROOT, location) : location);

export async function store(
  documentId: string,
  filename: string,
  bytes: Uint8Array,
): Promise<StorageResult> {
  const key = keyFor(documentId, extensionOf(filename));

  const token = blobToken();
  if (token) {
    const { put } = await import("@vercel/blob");
    /**
     * **Private.** These are a client's geotechnical reports and market studies, and `access:
     * "public"` on Vercel Blob means exactly that — an unauthenticated URL that works for anyone
     * who has it, forever, whatever this platform's own session gate says. Reads go through
     * `get()` with the store's token instead, behind the same session as everything else.
     */
    await put(key, Buffer.from(bytes), {
      access: "private",
      token,
      // The key already carries the document id; a random suffix would make it unresolvable.
      addRandomSuffix: false,
    });
    return { retained: true, location: key };
  }

  // No Blob store. On a container this is the normal path; on Vercel it means the write will fail.
  try {
    const path = join(ROOT, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    // The key, not `path` — see `StorageResult`.
    return { retained: true, location: key };
  } catch (error) {
    return {
      retained: false,
      reason:
        process.env.VERCEL
          ? "No document store is connected, and this platform's filesystem does not persist between requests. The document was read and indexed, but the original file was not kept."
          : `The original could not be written: ${error instanceof Error ? error.message : "unknown error"}.`,
    };
  }
}

/**
 * The whole document, in memory. For ingestion, which has to parse and measure it.
 *
 * Defined in terms of `open` rather than beside it. It was its own implementation — disk and HTTP
 * only — and when reads moved to the Blob SDK for the private store, this one was left behind: a
 * document uploaded straight to storage came back as *"could not be read back from storage"*,
 * because `read` was still looking for a blob key on the local filesystem. Two functions that must
 * agree about where documents live should not each carry their own opinion of it.
 */
export async function read(location: string): Promise<Uint8Array> {
  const { body } = await open(location);

  const chunks: Uint8Array[] = [];
  let total = 0;

  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
    total += chunk.byteLength;
  }

  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }

  return bytes;
}

/**
 * Where a document filed before locations were recorded ended up.
 *
 * The key is derived from the document id and the extension, so an original written by an earlier
 * build is at a computable address — which is the whole reason `keyFor` hashes the id rather than
 * the filename. Without this, every document already on production would be permanently
 * unopenable, and the viewer would ship working only for documents filed after it.
 *
 * Returns null rather than throwing: "the original was not kept" is a real and expected answer,
 * and the caller has to say so in words either way.
 */
export async function locate(documentId: string, filename: string): Promise<string | null> {
  const key = keyFor(documentId, extensionOf(filename));

  const token = blobToken();
  if (token) {
    try {
      const { list } = await import("@vercel/blob");
      const { blobs } = await list({ prefix: key, limit: 1, token });
      // The key, not the blob's URL: a URL names one store, and the point of locating is to find
      // the document wherever this deployment's store happens to be.
      if (blobs[0]) return key;
    } catch {
      // Fall through to disk. A Blob store that cannot be reached is not proof the file is absent.
    }
  }

  try {
    await stat(join(ROOT, key));
    return key;
  } catch {
    return null;
  }
}

/**
 * Throw away a stored object. Used for the handover copy a browser uploads before a document is
 * filed, and for nothing else — a filed document is withdrawn, never deleted (§13.4).
 *
 * Never throws. The caller is always in the middle of something that has already succeeded, and a
 * stray blob costs a little storage where a thrown error would cost the document.
 */
export async function discard(location: string): Promise<void> {
  const token = blobToken();

  if (token) {
    try {
      const { del } = await import("@vercel/blob");
      await del(location, { token });
    } catch {
      // Left behind rather than surfaced. See above.
    }
  }

  // And on disk, which is where a container and a laptop keep theirs. Deleting the row without
  // this leaves the bytes with nothing pointing at them — the space still gone, and now
  // unattributable.
  try {
    await rm(resolve(location), { force: true });
  } catch {
    // Already absent is the outcome this wanted.
  }
}

export interface OpenDocument {
  body: ReadableStream<Uint8Array>;
  /** Bytes, when the store knows without reading the file. Null where it does not. */
  size: number | null;
}

/**
 * Open the original for reading. **Reading is all this does.**
 *
 * Streamed rather than buffered: a 22 MB market study held in a function's memory to be handed
 * straight back out is memory spent for nothing, and on a serverless runtime it is memory that is
 * actually scarce.
 */
export async function open(location: string): Promise<OpenDocument> {
  /**
   * A key, with a Blob store connected: read it through the SDK, with the store's token.
   *
   * This is what makes a private store usable. A public blob could be fetched by URL by anyone who
   * had it; a private one is readable only with the token, which lives on the server, behind the
   * same session gate as every other read of a project's documents.
   */
  const token = blobToken();
  if (token && isPortable(location)) {
    try {
      const { get } = await import("@vercel/blob");
      const found = await get(location, { access: "private", token });

      // `null` is "no such blob"; a 304 carries no body. Neither is an error, and neither is a
      // document — so both fall through to disk rather than being returned as an empty stream.
      if (found?.statusCode === 200) {
        // The response header, not `blob.size` — which comes back 0 for a blob just written,
        // and a `content-length: 0` on a response that has a body is worse than no header at all.
        const declared = Number(found.headers.get("content-length"));
        const size = Number.isFinite(declared) && declared > 0 ? declared : found.blob.size || null;
        return { body: found.stream, size };
      }
    } catch {
      // Not in the store, or the store is unreachable. Disk is still worth trying — a container
      // keeps its originals locally and has no store at all.
    }
  }

  // A URL recorded by an earlier build, when blobs were public.
  if (location.startsWith("http")) {
    const response = await fetch(location);
    if (!response.ok || !response.body) {
      throw new Error(`Could not read the stored document (HTTP ${response.status}).`);
    }
    const declared = Number(response.headers.get("content-length"));
    return { body: response.body, size: Number.isFinite(declared) && declared > 0 ? declared : null };
  }

  const path = resolve(location);
  const { size } = await stat(path);
  return {
    body: Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>,
    size,
  };
}
