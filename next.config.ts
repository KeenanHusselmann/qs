import type { NextConfig } from "next";

import { MAX_UPLOAD_BYTES } from "./src/lib/ingest/limits";

const nextConfig: NextConfig = {
  // Next generates its own AGENTS.md and CLAUDE.md. PLATFORM.md is the single source of truth
  // here, and a second set of instructions competing with it is the ambiguity it exists to remove.
  agentRules: false,

  /**
   * No dev-tools indicator.
   *
   * It renders in the bottom-left corner, which is exactly where the sidebar's collapse control
   * sits once the sidebar narrows to 56px — so in development the overlay covered the button.
   * Clicks landed on `NEXTJS-PORTAL` instead, and the browser checks reported a broken toggle that
   * worked perfectly when dispatched from script. Dev now matches production, which is what a
   * check should be exercising.
   */
  devIndicators: false,

  /**
   * Two deploy targets, and they want opposite things.
   *
   * PLATFORM.md §13.1 chose a single long-running container, which wants `output: "standalone"`.
   * Vercel builds its own output and **breaks** if given that, so the flag is set only when a
   * container image is being built:
   *
   *     BUILD_TARGET=container npm run build
   *
   * Left unset elsewhere, which is what Vercel needs. Keeping both paths honest rather than
   * quietly abandoning the one the spec chose.
   */
  output: process.env.BUILD_TARGET === "container" ? "standalone" : undefined,

  /**
   * How much of a request body Next will buffer when middleware is present.
   *
   * **The default is 10 MB, and it truncates rather than refusing.** Filing a 21.7 MB market study
   * produced `Failed to parse body as FormData`, with the real cause visible only in the server
   * log:
   *
   *     Request body exceeded 10MB … Only the first 10MB will be available unless configured.
   *
   * The cap applies because middleware exists at all — excluding `/api` from its matcher does not
   * avoid it, because the body is buffered before routing. Posting the same size from Node worked,
   * which is exactly why this survived a round of testing: the failing path was the only one a
   * user takes.
   *
   * Tied to the upload limit rather than written as a number, so the two cannot drift. A server
   * that accepts a 64 MB file has to be willing to read one.
   *
   * Note the name: Next's own error message points at `middlewareClientMaxBodySize`, which is
   * deprecated. The current key is `proxyClientMaxBodySize`, under `experimental`.
   */
  experimental: {
    proxyClientMaxBodySize: MAX_UPLOAD_BYTES,
  },

  /**
   * OCR of the images in a quotation (`lib/ingest/image-text.ts`).
   *
   * Tesseract starts its work in a worker thread from a script it finds by path at runtime, and
   * loads a WASM core the same way – neither survives bundling, and file tracing cannot see a path
   * built at runtime. So the packages stay external and their files are traced in by hand, for the
   * project routes, whose server actions evaluate quotations. The English language data is fetched
   * on first use and cached in the temp directory.
   */
  serverExternalPackages: ["tesseract.js", "tesseract.js-core"],
  /**
   * Tesseract, and everything its worker reaches for at run time.
   *
   * ── Why the list is not just tesseract.js ──────────────────────────────────────────────
   *
   * Its worker script `require`s its dependencies from inside a file the bundler never parses,
   * so tracing follows none of them. Locally that is invisible — `node_modules` has the lot — and
   * on production the first image a run tried to read killed the function outright:
   *
   *     Error: Cannot find module 'bmp-js'
   *     Require stack: …/tesseract.js/src/worker-script/utils/setImage.js
   *     unrecoverable error: Uncaught Exception
   *
   * Not a caught failure with a message. The function died, so the server action never returned,
   * nothing was written, and the page sat there with three responses still reading "not
   * evaluated" and no error anywhere on it. Every quotation evaluation on production failed this
   * way, silently, because reading a letterhead is OCR and OCR is this package.
   *
   * So the whole of tesseract.js's own dependency list is traced, rather than the two packages
   * somebody thought of. Read from its `package.json` when this was written; a version that adds
   * one will need it added here, which is the cost of a bundler that cannot see these requires.
   */
  outputFileTracingIncludes: {
    "/projects/**": [
      "./node_modules/tesseract.js/**/*",
      "./node_modules/tesseract.js-core/**/*",
      "./node_modules/bmp-js/**/*",
      "./node_modules/idb-keyval/**/*",
      "./node_modules/is-url/**/*",
      "./node_modules/node-fetch/**/*",
      "./node_modules/opencollective-postinstall/**/*",
      "./node_modules/regenerator-runtime/**/*",
      "./node_modules/wasm-feature-detect/**/*",
      "./node_modules/zlibjs/**/*",
    ],
  },
};

export default nextConfig;
