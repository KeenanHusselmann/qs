/**
 * Health check — does this deployment actually work?
 *
 * A build succeeding and a deployment working are different claims. The build never opens a
 * connection, so a wrong DATABASE_URL, a database in another region, a missing SSL mode or a schema
 * that was never migrated all pass the build and fail the first real request. This endpoint asks
 * the question the build cannot: reach the database, from this region, with these credentials,
 * against the schema this code expects.
 *
 * ── Why it is unauthenticated ──────────────────────────────────────────────────────────────
 *
 * Every page behind `requireSession()` redirects before it touches the database, so an
 * unauthenticated probe can never tell you whether the database is up. The check has to sit in
 * front of the session gate to be worth anything.
 *
 * It therefore returns no data — no names, no counts, no connection string, and on failure the
 * error's *type* rather than its message, since driver errors happily print the host and user they
 * failed to reach. What a caller learns is up or down, which is what a health check is for.
 */

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { sweepDeadlines } from "@/lib/notifications";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const startedAt = Date.now();

  /*
    The daily notification sweep – deadlines due tomorrow, tenders closing, compliance expiring –
    told and emailed once each. On this route rather than its own because the deployment is at its
    function limit, and a schedule is one more caller of a route that already exists. Vercel's cron
    sends the CRON_SECRET it was given; nobody else can start a sweep.
  */
  if (new URL(request.url).searchParams.get("sweep") === "1") {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
      return Response.json({ status: "refused" }, { status: 401 });
    }
    const told = await sweepDeadlines();
    return Response.json({ status: "ok", told }, { headers: { "cache-control": "no-store" } });
  }

  /**
   * Whether this deployment could run an agent at all.
   *
   * Presence, never the value — a health check that leaked a key would be a worse bug than the one
   * it reports. It does not call the model: that would spend credits on every probe and turn a
   * provider's outage into this platform reporting itself unhealthy.
   *
   * Reported because the alternative is finding out from a QS. A deployment without the key builds
   * cleanly, serves every page, and refuses the first run someone starts — and the refusal is
   * honest but arrives at the worst possible moment. This deployment shipped without the key once.
   */
  const agent = process.env.DEEPSEEK_API_KEY ? "configured" : "no key";

  try {
    // Touches a real table, not `select 1`. Connecting proves the credentials; reading `projects`
    // proves the migrations ran, which is the failure this endpoint exists to catch.
    await db.execute(sql`select 1 from projects limit 1`);

    // `status` stays ok without a key: the platform works, one capability is absent, and a deploy
    // gated on this should not fail for a feature it may not be shipping yet.
    return Response.json(
      { status: "ok", database: "reachable", agent, ms: Date.now() - startedAt },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        status: "error",
        database: "unreachable",
        agent,
        // The class, not the text: enough to tell a missing table from a refused connection.
        reason: error instanceof Error ? error.constructor.name : "Unknown",
        ms: Date.now() - startedAt,
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
