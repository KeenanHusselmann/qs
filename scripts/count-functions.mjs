#!/usr/bin/env node
/**
 * How many serverless functions this deployment will actually create.
 *
 *     npm run functions
 *
 * ── Why this exists, and why the old method was wrong ──────────────────────────────────────
 *
 * Hobby allows twelve. The handoff said to count the `ƒ` entries in `npm run build`'s route table,
 * and that number was **eleven with one slot free** — while Vercel refused the deploy at sixteen.
 *
 * The route table marks a statically prerendered page `○` and it still gets a function each:
 * `/`, `/login`, `_not-found`, `_global-error`, and `favicon.ico` when it lives in `app/`. Five
 * functions the route table does not show. Counting `page.tsx` files was wrong before that, for
 * different reasons. Both methods were proxies for the thing itself.
 *
 * This counts the thing itself — the `.func` directories in `.vercel/output`, which is exactly what
 * gets uploaded. `.rsc.func` variants are excluded: Vercel serves the RSC payload from the same
 * lambda, and counting them would put every app over the cap on day one.
 *
 * It needs `vercel build` to have run. That build executes `npm run build`, which migrates — so
 * point it at a scratch or local database, never production, before running it for a count.
 */

import { readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const OUTPUT = join(root, ".vercel/output/functions");

/**
 * The number of functions this plan allows in one deployment.
 *
 * **Twelve is Hobby's, and Hobby's alone.** Vercel's own refusal says so: "No more than 12
 * Serverless Functions can be added to a Deployment on the Hobby plan. Create a team (Pro plan) to
 * deploy more." On Pro the count limit is lifted and the binding constraint becomes the unzipped
 * bundle size instead, which this script does not measure.
 *
 * So it is a variable, and the default stays 12: a repo that silently assumed the higher number
 * would let somebody merge eleven routes and meet the wall only when a deploy quietly kept serving
 * the previous version. Raise it where the plan is known — `FUNCTION_CAP=100 npm run functions`.
 *
 * It counts and prints either way, because the number is worth knowing whether or not it is a
 * limit: every function is a cold start and a line on a bill.
 */
const CAP = Number(process.env.FUNCTION_CAP ?? 12);

if (!existsSync(OUTPUT)) {
  console.error(
    "No .vercel/output — run `vercel build` first.\n" +
      "It runs `npm run build`, which migrates: point DATABASE_URL at a local database.",
  );
  process.exit(1);
}

const found = [];
(function walk(dir, prefix) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const name = prefix ? `${prefix}/${entry}` : entry;

    if (entry.endsWith(".func")) {
      found.push(name);
      continue;
    }
    try {
      if (statSync(path).isDirectory()) walk(path, name);
    } catch {
      // A broken link in build output is not this script's problem to report.
    }
  }
})(OUTPUT, "");

const functions = found.filter((name) => !name.endsWith(".rsc.func")).sort();

for (const name of functions) console.log(`  ${name}`);
console.log(`\n${functions.length} functions, cap ${CAP}.`);

if (functions.length > CAP) {
  console.error(
    `\nThis deployment would be refused after the build. Every route is a function, and so is` +
      ` every statically prerendered page — merge a route into an existing dynamic one.` +
      `

Unless the cap is wrong: 12 is Hobby's, and on Pro there is no count limit at all.` +
      ` FUNCTION_CAP is what tells this script which plan it is looking at.`,
  );
  process.exit(1);
}

if (functions.length === CAP) {
  console.log("At the cap. The next route added will break the deploy.");
}
