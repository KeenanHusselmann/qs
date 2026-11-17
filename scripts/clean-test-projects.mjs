#!/usr/bin/env node
/**
 * Remove the projects the browser suites leave behind.
 *
 *     npm run clean:test-projects
 *
 * Fifteen suites create a project each, several create two, and none of them tidied up — so a
 * working day of `npm run check` left 443 of them in front of the one real project on the list. The
 * suites cannot reliably clean up after themselves: a failing one exits on its first bad assertion,
 * which is exactly when it has made the most mess.
 *
 * So this runs *before* every check rather than after. A run that fails still leaves its own
 * evidence to look at, and the next run starts from a clean list either way.
 *
 * ── What it will and will not delete ───────────────────────────────────────────────────────
 *
 * Only a project whose name carries a 13-digit epoch, because every suite names its project
 * `<something> ${Date.now()}`. "Kingsway Estates" has no timestamp and is never matched. This is a
 * real delete, not a withdrawal, so the rule that decides is narrow and stated rather than clever.
 *
 * It refuses to run against anything but a local database unless `--force` is passed. The
 * production connection string and the development one differ by a hostname, and a housekeeping
 * script is the last place that difference should be discovered.
 */

import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local", quiet: true });

/** Every suite names its project with `Date.now()`. Nothing else on this platform does. */
const TEST_NAME = "[0-9]{13}";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("No DATABASE_URL. Nothing to clean.");
  process.exit(1);
}

const { hostname } = new URL(url);
const isLocal = ["localhost", "127.0.0.1", "::1"].includes(hostname);
const forced = process.argv.includes("--force");

if (!isLocal && !forced) {
  console.error(
    `Refusing to delete from ${hostname}: this only runs against a local database.\n` +
      "Pass --force if you genuinely mean to clean a remote one.",
  );
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

try {
  const doomed = await sql`
    select id, name from projects where name ~ ${TEST_NAME} order by created_at`;

  if (doomed.length === 0) {
    console.log("No test projects to clean.");
    process.exit(0);
  }

  /**
   * The stored originals go first, while their rows still say where they are.
   *
   * Deleting the projects alone would leave the bytes on disk or in the store with nothing left
   * pointing at them — invisible, and impossible to attribute later.
   */
  const stored = await sql`
    select d.storage_location
      from documents d
      join projects p on p.id = d.project_id
     where p.name ~ ${TEST_NAME} and d.storage_location is not null`;

  const { rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const root = process.env.STORAGE_DIR ?? join(process.cwd(), ".storage");

  let removed = 0;
  for (const { storage_location: location } of stored) {
    // Blob keys are cleaned by the checks that create them; this owns the local disk.
    if (location.startsWith("http")) continue;
    try {
      await rm(join(root, location), { force: true });
      removed += 1;
    } catch {
      // A file already gone is the outcome this wanted anyway.
    }
  }

  // Documents and passages carry `on delete cascade`, so the projects take them with them.
  await sql`delete from projects where name ~ ${TEST_NAME}`;

  console.log(
    `Cleaned ${doomed.length} test ${doomed.length === 1 ? "project" : "projects"}` +
      `${removed > 0 ? ` and ${removed} stored ${removed === 1 ? "file" : "files"}` : ""}.`,
  );
} finally {
  await sql.end();
}
