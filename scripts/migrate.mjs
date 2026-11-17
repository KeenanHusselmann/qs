#!/usr/bin/env node
/**
 * Bring the database up to the committed migrations. Runs first in `npm run build`.
 *
 * ── Why not `drizzle-kit migrate` ──────────────────────────────────────────────────────────
 *
 * That was the first version, and the first time it failed on Vercel the entire build log said:
 *
 *     [⣷] applying migrations...
 *     Error: Command "npm run build" exited with 1
 *
 * No statement, no SQLSTATE, no message. A deploy step that can only say "it did not work" is a
 * deploy step you debug by guessing, and guessing at someone else's production database is the
 * thing not to do. drizzle-kit is also a *dev* tool — `generate` belongs to a developer's machine.
 * The migrator in `drizzle-orm` is the deploy-time one, and it is already a runtime dependency.
 *
 * So this reports. Everything Postgres hands back — code, detail, hint, and the statement that
 * actually failed — goes to stdout, because the next person to read it will be reading a build log
 * from a machine they cannot log into.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// Absent on Vercel, and that is fine — dotenv does not overwrite a variable already set, so a real
// environment always wins over a developer's own Postgres.
config({ path: join(root, ".env.local"), quiet: true });

/**
 * Neon's pooled URL goes through pgbouncer, which is built for short transactional queries rather
 * than DDL and the advisory lock a migrator takes. Neon expose a direct URL for this.
 */
const url =
  process.env.DATABASE_URL_UNPOOLED ??
  process.env.DATABASE_POSTGRES_URL_NON_POOLING ??
  process.env.DATABASE_URL;

if (!url) {
  console.error("No database URL. Set DATABASE_URL (or DATABASE_URL_UNPOOLED).");
  process.exit(1);
}

/** Which host, never which password. Builds are logged, and logs get pasted into issues. */
const describe = (value) => {
  try {
    const { hostname, pathname } = new URL(value);
    return `${hostname}${pathname}`;
  } catch {
    return "an unparseable URL";
  }
};

const journal = JSON.parse(readFileSync(join(root, "drizzle/meta/_journal.json"), "utf8"));
console.log(`Migrating ${describe(url)} — ${journal.entries.length} migrations committed.`);

// One connection: the migrator takes a lock, and a pool would hand the lock and the work to
// different sessions.
const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  await migrate(drizzle(sql), { migrationsFolder: join(root, "drizzle") });
  console.log("Database is up to date.");
} catch (error) {
  console.error("\nMigration failed.\n");

  /**
   * Drizzle wraps the driver's error, and the driver's is the one carrying the SQLSTATE and the
   * server's detail. The first attempt printed only the wrapper and was no more useful than the
   * silence it replaced, so the whole cause chain is walked.
   */
  const chain = [];
  for (let e = error; e && chain.length < 5; e = e.cause) chain.push(e);

  for (const [depth, e] of chain.entries()) {
    const indent = "  ".repeat(depth + 1);
    // postgres.js puts the server's fields on the error itself. One per line rather than as an
    // object, so a build log stays greppable.
    for (const field of ["message", "code", "severity", "detail", "hint", "where", "position", "routine"]) {
      if (e?.[field]) console.error(`${indent}${field.padEnd(9)} ${e[field]}`);
    }
    if (e?.query) console.error(`${indent}statement ${String(e.query).replace(/\s+/g, " ").slice(0, 400)}`);
    if (depth < chain.length - 1) console.error(`${indent}caused by:`);
  }

  if (chain.every((e) => !e?.code)) console.error(`\n${error?.stack ?? error}`);

  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
}

await sql.end({ timeout: 5 });
