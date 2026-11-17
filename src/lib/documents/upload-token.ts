/**
 * Authorising a browser to upload straight to the document store — PLATFORM.md §1.3.2.
 *
 * ── Why the bytes must not come through here ───────────────────────────────────────────────
 *
 * Vercel rejects a request body over about 4.5 MB at the edge, before any handler of ours runs. The
 * documents this platform exists for are bigger than that: a geotechnical report in the reference
 * corpus is 11.8 MB and a market study is 22.1 MB. No amount of raising our own limit reaches them,
 * because the refusal happens upstream of the function.
 *
 * So the browser sends the file to blob storage itself and hands the function a pathname. The
 * request that reaches us is a couple of hundred bytes whatever the document weighs.
 *
 * ── What this route is actually deciding ───────────────────────────────────────────────────
 *
 * It is the gate. A client token issued here lets the holder write to the store, so everything that
 * would have been checked on an upload is checked before one is issued: that there is a session,
 * that the kind is one something reads, and that the pathname is inside this project's own incoming
 * area. The size cap travels in the token, so the store enforces it rather than trusting us to.
 *
 * Nothing is filed by uploading. The blob sits in `incoming/` until the browser posts its pathname
 * to the documents route, which reads it, ingests it, and clears it away — see that route for why
 * the prefix is checked a second time there.
 */

import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { isKnownKind } from "@/lib/document-kinds";
import { MAX_UPLOAD_BYTES } from "@/lib/ingest/limits";
import { ADVISOR_KIND, advisorPrefix, incomingPrefix, NO_STORE } from "@/lib/ingest/handover";
import { storeIsConnected } from "@/lib/ingest/storage";

/**
 * Can a browser upload straight to a store here?
 *
 * Asked before a large file is sent, and answered plainly — because the alternative is inferring it
 * from a thrown error, and that was the first attempt. The token was refused with a recognisable
 * marker for the client to match on; `upload()` wraps the failure in its own error type, the marker
 * did not survive, the fallback never fired, and a 5 MB document failed with nothing filed.
 *
 * A capability question deserves a capability answer, not an exception to parse.
 */
/** Whether a browser may upload straight to a store here. */
export async function uploadCapability() {
  const session = await getSession();
  if (!session) return NextResponse.json({ direct: false }, { status: 401 });

  return NextResponse.json({ direct: storeIsConnected() });
}

/** Authorising one direct upload. */
export async function issueUploadToken(request: Request, projectId: string) {

  if (!storeIsConnected()) {
    return NextResponse.json(
      {
        error: NO_STORE,
        message:
          "No document store is connected to this deployment, so a browser cannot upload to one.",
      },
      { status: 503 },
    );
  }

  const body = (await request.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      body,
      request,

      onBeforeGenerateToken: async (pathname, clientPayload) => {
        // Checked here rather than by middleware, for the same reason the upload route checks it:
        // middleware refreshes a session, it does not guard, and this hands out write access.
        const session = await getSession();
        if (!session) throw new Error("Not signed in.");

        /**
         * The pathname comes from the browser, so it is not trusted. Confined to this project's
         * incoming area, which is what stops a token issued for one project being used to write
         * over another's documents — or over anything else in the store.
         */
        if (!pathname.startsWith(incomingPrefix(projectId))) {
          throw new Error("That is not a path this project may write to.");
        }

        const { kind } = JSON.parse(clientPayload ?? "{}") as { kind?: string };
        // An advisor attachment is read and not filed, so it has no kind of document – but it may
        // only land in the advisor's own corner of the incoming area.
        if (kind === ADVISOR_KIND && !pathname.startsWith(advisorPrefix(projectId))) {
          throw new Error("That is not a path an advisor attachment may be written to.");
        }
        if (!kind || (kind !== ADVISOR_KIND && !isKnownKind(kind))) {
          throw new Error(`"${kind ?? ""}" is not a kind anything reads.`);
        }

        return {
          access: "private" as const,
          // Enforced by the store, not by us. A cap we check after the bytes have arrived is not a
          // cap — and the whole point of this route is that the bytes never arrive here.
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          // The pathname already carries a random id; a suffix would make it unresolvable.
          addRandomSuffix: false,
          tokenPayload: JSON.stringify({ projectId, kind }),
        };
      },

      /**
       * Deliberately does nothing.
       *
       * Vercel calls this as a webhook once the upload lands, and it cannot reach a laptop — so a
       * platform that filed documents here would work in production and silently not in
       * development, which is the worst place for that difference to live. The browser posts the
       * pathname to the documents route instead, and there is one ingestion path for every
       * document however it arrived.
       */
      onUploadCompleted: async () => {},
    });

    return NextResponse.json(result);
  } catch (error) {
    // The reason, in words. "Not signed in" and "that kind is not read by anything" send a person
    // to completely different places, and both are thrown above.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The upload could not be authorised." },
      { status: 400 },
    );
  }
}
