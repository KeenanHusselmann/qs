/**
 * Ad hoc requests, read for a list: the request and how many inputs each has.
 */

import { documentCounts, listAdhocRequests } from "@/app/(app)/projects/actions";
import type { AdhocRow } from "@/components/adhoc/adhoc-list";

export async function loadAdhocRows(): Promise<AdhocRow[]> {
  const [requests, counts] = await Promise.all([listAdhocRequests(), documentCounts()]);
  return requests.map((r) => ({
    id: r.id,
    name: r.name,
    request: r.request,
    requestedBy: r.requestedBy,
    dueOn: r.dueOn,
    answered: r.closedAt !== null,
    inputs: counts.get(r.id) ?? 0,
  }));
}
