/**
 * Cost Data — the firm's rate library, and the figures it assumes.
 *
 * ── Why this is one route ──────────────────────────────────────────────────────────────────
 *
 * Every route is a serverless function, so a folder is not free (§13 gotchas — the count was read
 * as eleven when it was sixteen, and deploys silently stopped). This is the **one** new function
 * the Cost Data area gets: the library's views and the practice's assumptions are tabs inside this
 * page rather than routes of their own.
 *
 * It is firm-level, not project-level, which is why it sits here and not under
 * `/projects/[id]/[module]`. `navigation.ts` already said so: a rate set is a practice's asset, and
 * a rate copied into every job is a rate that has to be corrected in every job.
 */

import { RateLibrary } from "@/components/rates/rate-library";
import { assumptionsInForce } from "@/lib/assumptions";
import { ASSUMPTION_SPECS } from "@/lib/assumption-set";
import { listFactors, listRates } from "./actions";

export default async function Page() {
  const inForce = await assumptionsInForce();
  const byKey = new Map(inForce.map((row) => [row.key, row]));

  /*
    Resolved on the server and handed down as plain data. `assumptions.ts` reads the database and
    the screen is a client component — passing the rows rather than the module is what keeps `db`
    out of the browser bundle, which has taken this app down three times.
  */
  const assumptions = ASSUMPTION_SPECS.map((spec) => {
    const row = byKey.get(spec.key)!;
    return {
      spec,
      value: row.value,
      isDefault: row.isDefault,
      effectiveFrom: row.effectiveFrom,
      setBy: row.setBy,
    };
  });

  const [rows, factors] = await Promise.all([listRates(), listFactors()]);

  return <RateLibrary rows={rows} assumptions={assumptions} factors={factors} />;
}
