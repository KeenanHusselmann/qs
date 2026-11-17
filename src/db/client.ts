/**
 * The database connection.
 *
 * PostgreSQL over the standard wire protocol, so the host is interchangeable: nothing here or in
 * the schema knows whether it is talking to a local container, Neon, RDS or Render.
 *
 * Connection is deferred to first use. Throwing at module scope would fail `next build` wherever
 * DATABASE_URL is absent — CI, a fresh checkout — even though building needs no database.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set — see .env.example.");

  // A transaction-mode pooler multiplexes connections per transaction, so prepared statements —
  // which live on a session — break under load rather than obviously on day one.
  const pooled = url.includes("-pooler.");

  return drizzle(
    postgres(url, {
      prepare: !pooled,
      ssl: url.includes("sslmode=disable") ? false : "require",
      max: 10,
    }),
    { schema },
  );
}

type Database = ReturnType<typeof connect>;

/** Hot reload otherwise opens a pool per edit until Postgres refuses connections. */
const globalForDb = globalThis as unknown as { __db?: Database };
let instance: Database | undefined;

function getDb(): Database {
  instance ??= globalForDb.__db ?? connect();
  if (process.env.NODE_ENV !== "production") globalForDb.__db = instance;
  return instance;
}

export const db = new Proxy({} as Database, {
  get: (_t, property) => Reflect.get(getDb(), property),
});

export { schema };
