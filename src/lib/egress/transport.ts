/**
 * The only door out — ARC-005, "nothing else in the code may call an outside host".
 *
 * Every request to a vendor goes through `outbound`, which refuses any host the policy does not
 * register for that vendor. `scripts/check-egress.mjs` (in the gate) fails the build if `fetch` to
 * an outside host, or a vendor SDK, appears anywhere outside `src/lib/egress/`. Between them, a new
 * integration cannot quietly send client data somewhere the ledger does not know about.
 *
 * It sends; it does not decide. Purpose, policy, transformation and the ledger are `gateway.ts`, and
 * a caller reaches this only with what `guard()` handed back.
 */

import { VENDORS, type VendorId } from "@/lib/egress/policy";

export class EgressHostRefused extends Error {
  constructor(vendor: VendorId, host: string) {
    super(`Refused to send to ${host}: it is not the host registered for ${VENDORS[vendor].name}.`);
    this.name = "EgressHostRefused";
  }
}

/** `fetch`, to a registered vendor's host only. */
export function outbound(vendor: VendorId, input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  if (url.protocol !== "https:" || url.host !== VENDORS[vendor].host) {
    return Promise.reject(new EgressHostRefused(vendor, url.host));
  }
  return fetch(input, init);
}
