/**
 * Filing a document — PLATFORM.md §1.3.2.
 *
 * ── Why a route handler and not a server action ────────────────────────────────────────────
 *
 * It was a server action, and filing a real document failed with
 * *"Body exceeded 1 MB limit"*. That limit is specific to server actions, which buffer the whole
 * request body before the action runs, and 1 MB is nowhere near this domain: in the reference
 * corpus a market study is 22 MB, a transport impact assessment 10 MB, an A1 drawing 1.3 MB.
 *
 * Raising `serverActions.bodySizeLimit` would have silenced the error without fixing the shape of
 * the thing — a server action is not where a 22 MB upload belongs. Route handlers carry no such
 * limit, so the upload goes here and the rest of the form stays as it was.
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db/client";
import { documents, passages } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { isKnownKind } from "@/lib/document-kinds";
import { assessDocument } from "@/lib/documents/coverage";
import { splitIntoPassages } from "@/lib/ingest/split";
import { isSpatial } from "@/lib/ingest/document-class";
import { countDrawingOperations, fingerprintOf } from "@/lib/ingest/geometry";
import { nameAndOrigin } from "@/lib/ingest/filename";
import { parseDocument } from "@/lib/ingest/parse";
import { formatBytes, MAX_UPLOAD_BYTES } from "@/lib/ingest/limits";
import { discard, read, store } from "@/lib/ingest/storage";
import { incomingPrefix } from "@/lib/ingest/handover";

export interface FileDocumentResponse {
  ok: boolean;
  error?: string;
  /** Filed, but nothing could be read from it. Never silent (§1.3). */
  warning?: string;
}

const fail = (error: string, status = 400) =>
  NextResponse.json<FileDocumentResponse>({ ok: false, error }, { status });

/** Filing a document. Reached by `POST /api/projects/[id]/documents`. */
export async function fileDocument(request: Request, projectId: string) {
  // Checked here rather than by the dispatcher: an upload endpoint that trusted something else to
  // have checked would be the gap.
  const session = await getSession();
  if (!session) return fail("Not signed in", 401);

  const form = await request.formData();
  const upload = form.get("file");
  const kind = String(form.get("kind") ?? "").trim();

  /**
   * A document arrives one of two ways, and only the first half of its journey differs.
   *
   * Small ones come as a multipart body, which is the obvious thing and works everywhere. Anything
   * over Vercel's ~4.5 MB edge limit cannot: the request is refused upstream of this function, and
   * an 11.8 MB geotechnical report is an ordinary document in this domain. Those go to the store
   * from the browser and arrive here as a pathname — a couple of hundred bytes whatever the
   * document weighs.
   *
   * From `bytes` down, there is one path. Two ways in and two ways to file would be two places for
   * the kind to be defaulted, the name to keep its folders, or the measurement to be skipped.
   */
  const handedOver = String(form.get("blobPathname") ?? "").trim();

  if (!(upload instanceof File) && !handedOver) return fail("Choose a file");

  if (upload instanceof File && upload.size === 0) return fail("Choose a file");

  if (upload instanceof File && upload.size > MAX_UPLOAD_BYTES) {
    return fail(
      `${upload.name} is ${formatBytes(upload.size)}. The limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`,
      413,
    );
  }

  /**
   * The kind is required and never defaulted.
   *
   * v3's scar: a control there sent `category: "other"` for everything, nothing read `other`, so
   * every document filed through the portal landed where no step could find it. The upload
   * succeeded and the step went on asking for a document that was already there.
   */
  if (!kind) return fail("Choose what kind of document this is — it decides what it satisfies");
  if (!isKnownKind(kind)) return fail(`"${kind}" is not a kind anything reads. Pick one from the list.`);

  /**
   * Collect the bytes, whichever way they came.
   *
   * The pathname is checked against this project's incoming prefix again here, and not because the
   * token check was insufficient — because this is a different request. A token authorised one
   * upload; this call says "file what is at that path", and nothing but the prefix stops it naming
   * another project's document and filing a copy into this one.
   */
  let bytes: Uint8Array;
  let uploadedName: string;

  if (upload instanceof File) {
    bytes = new Uint8Array(await upload.arrayBuffer());
    uploadedName = upload.name;
  } else {
    if (!handedOver.startsWith(incomingPrefix(projectId))) {
      return fail("That upload does not belong to this project.", 403);
    }

    uploadedName = String(form.get("filename") ?? "").trim();
    if (!uploadedName) return fail("The upload arrived without a filename.");

    try {
      bytes = await read(handedOver);
    } catch (error) {
      return fail(
        `The uploaded file could not be read back from storage: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
        502,
      );
    }

    if (bytes.byteLength > MAX_UPLOAD_BYTES) {
      return fail(
        `${uploadedName} is ${formatBytes(bytes.byteLength)}. The limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`,
        413,
      );
    }
  }

  /**
   * The uploaded name is not a name. A browser sends the whole relative path when the file came
   * from a directory picker, so a folder import filed every document under four levels of
   * submission structure. Split on the way in — the name is the name, the path is provenance.
   */
  const { name, origin } = nameAndOrigin(uploadedName);

  const [document] = await db
    .insert(documents)
    .values({
      projectId,
      filename: name,
      sourcePath: origin,
      kind,
      byteSize: String(bytes.byteLength),
      createdBy: session.email,
    })
    .returning({ id: documents.id });

  /**
   * Kept before parsing, so a document the platform cannot read yet is still held — OCR and the
   * drawing engine (§10) will want the original, and asking for a re-upload would be an insult.
   *
   * Where it cannot be kept, that is said rather than swallowed: the document is still parsed and
   * indexed, so criteria find their evidence, but the platform must not imply it can re-read
   * something it threw away.
   */
  const stored = await store(document!.id, name, bytes);
  const storageWarning = stored.retained ? undefined : stored.reason;

  // Written down, not merely returned. The bytes were always retained; nothing recorded where, so
  // nothing could open them afterwards.
  if (stored.retained) {
    await db
      .update(documents)
      .set({ storageLocation: stored.location })
      .where(eq(documents.id, document!.id));

    /**
     * The handover copy has done its job. Deleted only once the document is retained under its own
     * key, so a failure anywhere above leaves the bytes in `incoming/` rather than nowhere — a QS
     * who uploaded 22 MB over a hotel connection should not have to do it twice because the parse
     * fell over.
     *
     * A failure to delete is not a failure to file. It leaves a stray blob, which costs a little
     * storage; treating it as fatal would throw away a document that is already safely filed.
     */
    if (handedOver) await discard(handedOver);
  }

  const parsed = await parseDocument(name, bytes);

  /**
   * Measured while the bytes are in hand — they will not be again without re-reading the original,
   * and the import agent cannot say anything useful about a corpus without both.
   *
   * **Before the warning returns, deliberately.** A document that yields no text is precisely where
   * the geometry count earns its keep: a plotted drawing whose every character is stroked parses to
   * nothing and is the last document anyone should archive. Returning early here would leave it
   * unmeasured and the agent would have nothing to say but "not counted".
   *
   * Geometry only for spatial kinds, because building the operator list costs seconds per drawing
   * and answers nothing about a market study.
   */
  const [drawingOps, textFingerprint] = await Promise.all([
    isSpatial(kind) && name.toLowerCase().endsWith(".pdf")
      ? countDrawingOperations(bytes)
      : Promise.resolve(null),
    fingerprintOf(parsed.text),
  ]);

  await db
    .update(documents)
    .set({ drawingOps, textFingerprint })
    .where(eq(documents.id, document!.id));

  if (parsed.warning) {
    return NextResponse.json<FileDocumentResponse>({
      ok: true,
      warning: [parsed.warning, storageWarning].filter(Boolean).join(" "),
    });
  }

  const split = splitIntoPassages(parsed);
  if (split.length === 0) {
    return NextResponse.json<FileDocumentResponse>({
      ok: true,
      warning: ["Nothing readable was found in the document.", storageWarning]
        .filter(Boolean)
        .join(" "),
    });
  }

  await db.insert(passages).values(
    split.map((passage) => ({
      documentId: document!.id,
      projectId,
      seq: passage.index,
      page: passage.page ?? null,
      body: passage.text,
    })),
  );

  /*
    Judged before the response, so the page that filed it refreshes onto the right answer. A reader
    who files a market study in their own words should see the requirement met, not "no passage in
    it matches" followed by a change on some later visit. A model outage stores nothing and never
    fails the filing — see `documents/coverage.ts`.
  */
  await assessDocument(document!.id, kind);

  return NextResponse.json<FileDocumentResponse>({ ok: true, warning: storageWarning });
}
