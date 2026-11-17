/**
 * Nothing leaves the platform except through the gateway — ARC-005.
 *
 * `src/lib/egress/` is the only code that may reach an outside host. Anywhere else, a `fetch` must
 * go to one of the platform's own routes (a path starting with "/"), and no vendor SDK may be
 * imported. A new integration that called a vendor directly would send client documents past the
 * purpose rules, the personal-information filter and the ledger, and nothing at runtime would say
 * so. This says so, in the gate, before it merges.
 *
 * A `fetch` whose address is a variable cannot be checked by reading, so it is refused unless it is
 * on the list below with the reason it is safe. Adding to the list is a reviewed change.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = "src";
const GATEWAY = join("src", "lib", "egress") + sep;

/** fetch calls with a non-literal address, each with why it never leaves the platform. */
const ALLOWED_DYNAMIC = {
  "src/lib/agent/bill.ts": "streamNdjson runs in the browser and is only ever given the platform's own /api/projects/… run routes",
  "src/lib/ingest/storage.ts": "reads a document back from the platform's own Blob store (a hosting operator, outside the gateway by ARC-005's scope)",
};

/** Packages that talk to an AI model, search or mail vendor. Only the gateway may import them. */
const VENDOR_PACKAGES = ["@anthropic-ai/sdk", "openai", "@google/genai", "@google/generative-ai", "resend", "@mistralai/mistralai", "cohere-ai", "ai", "@ai-sdk/"];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(ts|tsx|mjs|js)$/.test(name) && !/\.test\.tsx?$/.test(name)) yield path;
  }
}

let failures = 0;
let checked = 0;
const fail = (where, what) => {
  failures++;
  console.log(`  FAIL  ${where}  — ${what}`);
};

for (const path of files(ROOT)) {
  if (path.startsWith(GATEWAY)) continue;
  checked++;
  const text = readFileSync(path, "utf8");
  const where = relative(".", path).split(sep).join("/");

  for (const m of text.matchAll(/(?<![\w.])fetch\(\s*([^\s,)]+)/g)) {
    const line = text.slice(0, m.index).split("\n").length;
    const arg = m[1];
    const relativeLiteral = /^(['"`])\//.test(arg);
    const absoluteLiteral = /^(['"`])https?:/.test(arg);
    if (absoluteLiteral) fail(`${where}:${line}`, `fetch to an outside host – send it through src/lib/egress (outbound + guard)`);
    else if (!relativeLiteral && !ALLOWED_DYNAMIC[where]) fail(`${where}:${line}`, `fetch to an address that cannot be checked (${arg}) – use a "/…" path, or route it through src/lib/egress`);
  }

  for (const m of text.matchAll(/(?:from\s+|import\(\s*|require\(\s*)["']([^"']+)["']/g)) {
    const pkg = m[1];
    if (VENDOR_PACKAGES.some((v) => (v.endsWith("/") ? pkg.startsWith(v) : pkg === v || pkg.startsWith(`${v}/`)))) {
      const line = text.slice(0, m.index).split("\n").length;
      fail(`${where}:${line}`, `imports ${pkg} – vendor SDKs belong in src/lib/egress only`);
    }
  }
}

console.log(`\n  ${checked} files outside src/lib/egress checked.`);
console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
