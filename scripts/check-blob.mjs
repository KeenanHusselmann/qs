#!/usr/bin/env node
/**
 * Does the document store actually hold a document, and give it back?
 *
 *     npm run check:blob
 *
 * **Not in `npm run check`.** It writes to the real Blob store, and a browser suite that ran forty
 * times a day would fill a client's storage with fixtures. Same reasoning as `check:run-live`: the
 * paths that cost money or touch a shared resource are run deliberately.
 *
 * It matters because the alternative is finding out from production. `store()` silently falls back
 * to a disk write when no token is present, and Vercel's filesystem does not persist — which is how
 * every document filed on production came to be indexed with its original discarded. That failure
 * is reported at upload time and nowhere else, so nothing accumulates the fact that a deployment
 * has been throwing originals away.
 *
 * Round-trips a document through the store and deletes it again, so running this leaves nothing.
 */

import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

// The opt-in. `storage.ts` ignores a local Blob token unless something asks for it, so that a
// browser suite cannot quietly fill a client's store with fixtures. This is the thing asking.
process.env.USE_BLOB_STORAGE = "1";

const { store, open, locate } = await import("../src/lib/ingest/storage.ts");

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const token = process.env.BLOB_READ_WRITE_TOKEN;
check("a document store is connected", Boolean(token), token ? "BLOB_READ_WRITE_TOKEN set" : "no token — this would discard originals on Vercel");
if (!token) process.exit(1);

// A document id that cannot collide with a real one, so the cleanup below is unambiguous.
const documentId = `00000000-0000-4000-8000-${Date.now().toString().slice(-12)}`;
const original = Buffer.from(`Round-trip check ${new Date().toISOString()}\n${"x".repeat(2048)}`);

const stored = await store(documentId, "round-trip.txt", new Uint8Array(original));
check("the original is retained", stored.retained === true, stored.retained ? stored.location : stored.reason);
if (!stored.retained) process.exit(1);

check(
  "and recorded as a portable key, not a URL",
  !stored.location.startsWith("http") && !/^[a-z]:[\\/]/i.test(stored.location),
  stored.location,
);

const found = await locate(documentId, "round-trip.txt");
check("it can be found from the document id alone", found === stored.location, `${found}`);

const opened = await open(stored.location);
const chunks = [];
for await (const chunk of opened.body) chunks.push(Buffer.from(chunk));
const returned = Buffer.concat(chunks);

check("it reads back byte for byte", returned.equals(original), `${returned.length} of ${original.length} bytes`);

// The size is either right or absent, never wrong. Blob does not report one on read — no
// content-length, and `blob.size` is 0 for a blob just written — so the viewer omits the header and
// the response is chunked. A `content-length: 0` on a response that has a body would be worse than
// no header, which is the mistake this asserts against.
check(
  "its size is reported correctly or not at all",
  opened.size === null || opened.size === original.length,
  `${opened.size}`,
);

/**
 * The blob must not be readable without the token.
 *
 * This is the whole reason the store is private: these are a client's geotechnical reports, and a
 * public blob URL works for anyone who has it, forever, whatever this platform's session gate says.
 */
const { head, del } = await import("@vercel/blob");
const meta = await head(stored.location, { token });
const anonymous = await fetch(meta.url).catch(() => null);
check(
  "the stored URL refuses an unauthenticated reader",
  !anonymous || !anonymous.ok,
  anonymous ? `HTTP ${anonymous.status}` : "no response",
);

await del(stored.location, { token });
const afterDelete = await locate(documentId, "round-trip.txt");
check("the check leaves nothing behind", afterDelete === null, `${afterDelete}`);

console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} failed.`);
process.exit(fails ? 1 : 0);
