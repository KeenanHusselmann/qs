/**
 * drizzle-kit configuration.
 *
 * Migrations are generated as plain SQL and committed: reviewable in a pull request, runnable by
 * any Postgres client, and no drizzle-kit dependency at deploy time.
 *
 * ── Unpooled, where there is a choice ──────────────────────────────────────────────────────
 *
 * Neon's pooled URL goes through pgbouncer, which is built for short transactional queries rather
 * than for DDL and the advisory locks a migrator takes. Neon supply a direct URL for exactly this,
 * and it is used when present. Locally there is only one URL and this falls through to it.
 *
 * `dotenv` does not overwrite a variable that is already set, so a real environment — Vercel's
 * during a build — wins over `.env.local`, which points at a developer's own Postgres.
 */

import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });

const url =
  process.env.DATABASE_URL_UNPOOLED ??
  process.env.DATABASE_POSTGRES_URL_NON_POOLING ??
  process.env.DATABASE_URL;

if (!url) throw new Error("No database URL: set DATABASE_URL (or DATABASE_URL_UNPOOLED).");

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  verbose: true,
  strict: true,
});
