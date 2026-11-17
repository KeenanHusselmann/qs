/**
 * Finish the standalone build.
 *
 * `output: "standalone"` emits a self-contained server but **does not copy static assets into it**.
 * The result boots, serves HTML with HTTP 200, and 404s every stylesheet and script — a deploy that
 * looks healthy and renders unstyled. Verified before this existed: `/login` returned 200 while
 * `/_next/static/chunks/*.css` returned 404.
 *
 * Runs automatically after `next build`, so an image cannot be assembled without it.
 */

import { access, cp } from "node:fs/promises";
import { join } from "node:path";

// Only the container build produces a standalone directory to fill. On Vercel there is nothing
// to copy and nothing to fix.
if (process.env.BUILD_TARGET !== "container") process.exit(0);

const root = process.cwd();
const standalone = join(root, ".next", "standalone");

const copies = [
  [join(root, ".next", "static"), join(standalone, ".next", "static")],
  [join(root, "public"), join(standalone, "public")],
];

for (const [from, to] of copies) {
  try {
    await access(from);
  } catch {
    // `public/` is optional; a missing `.next/static` means the build did not complete.
    continue;
  }
  await cp(from, to, { recursive: true });
  console.log(`  copied ${from.replace(root, ".")} → ${to.replace(root, ".")}`);
}
