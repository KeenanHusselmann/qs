#!/usr/bin/env node
/**
 * Is `package-lock.json` still installable on the platform that builds it?
 *
 *     node scripts/check-lockfile.mjs
 *
 * ── The trap this exists to catch ──────────────────────────────────────────────────────────
 *
 * npm resolves optional, platform-specific dependencies **for the machine it runs on**, and prunes
 * the rest out of the lockfile. This repo is developed on Windows and built on Linux — by CI and by
 * Vercel — so an ordinary `npm install` here quietly deletes the Linux-only entries that the build
 * needs, and the next `npm ci` on a runner fails with "Missing: @emnapi/runtime from lock file".
 *
 * That is exactly what happened: the gate went red at `npm ci` and stayed red, so it never reached
 * the step that counts serverless functions, and nobody could see whether a deploy would fit inside
 * the cap. A broken lockfile does not announce itself as a broken lockfile — it announces itself as
 * a build that stopped before it started.
 *
 * ── Why these packages ─────────────────────────────────────────────────────────────────────
 *
 * They are the ones that are **only** resolved on Linux, so their absence is the signature of a
 * lockfile written on Windows. `@emnapi/*` arrive through `@img/sharp-wasm32` and
 * `@napi-rs/wasm-runtime`.
 *
 * There was a third – `tsx`'s nested esbuild – and it went when esbuild became a declared dev
 * dependency. drizzle-kit's esbuild 0.25 used to be hoisted to the root, where vite's peer range
 * (`^0.27 || ^0.28`) found it invalid; tsx kept a nested 0.28 of its own, which is what vanished on
 * a Windows resolve, and the invalid peer is what crashed npm 10's resolver outright
 * ("Cannot read properties of null (reading 'edgesOut')") when Next.js had to be patched. Declaring
 * `esbuild ~0.28` puts one copy at the root for vite and tsx both, and drizzle-kit keeps its own.
 *
 * ── The fix, when this fires ───────────────────────────────────────────────────────────────
 *
 * Regenerate the lockfile on Linux, with a **full** install — `--package-lock-only` prunes, which is
 * how this was first "fixed" twice without fixing it:
 *
 *     npm run lock
 *
 * That script already existed and was subtly wrong — it passed `--package-lock-only`, which is the
 * flag that causes this. Two details decide whether it works, and both were learned by getting them
 * wrong:
 *
 *   · a **full** install, never `--package-lock-only`, which prunes;
 *   · **Node 22**, the version CI runs. Generating on Node 24 produced a file whose `npm ci` was
 *     fine under Node 24 and refused under Node 22 — different npm, different resolution — so the
 *     gate stayed red on a lockfile that looked verified.
 *
 * Done that way the change is purely additive: every platform's optional packages are present, and
 * `npm ci` passes on Linux and on Windows.
 */

import { readFileSync } from "node:fs";

/** Entries npm only writes when it resolves the tree on Linux. */
const LINUX_ONLY = [
  "node_modules/@emnapi/runtime",
  "node_modules/@emnapi/core",
];

const packages = JSON.parse(readFileSync("package-lock.json", "utf8")).packages;
const missing = LINUX_ONLY.filter((name) => !(name in packages));

for (const name of LINUX_ONLY) {
  console.log(`  ${missing.includes(name) ? "FAIL" : "PASS"}  ${name}`);
}

if (missing.length > 0) {
  console.error(
    `\n${missing.length} package(s) the Linux build needs are not in package-lock.json.\n` +
      "This lockfile was written on Windows, and `npm ci` on a runner will refuse it.\n\n" +
      "Regenerate it on Linux with a FULL install (--package-lock-only prunes):\n" +
      '  npm run lock\n',
  );
  process.exit(1);
}

console.log("\nThe lockfile still carries what the Linux build needs.");
