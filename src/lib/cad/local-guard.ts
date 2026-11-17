/**
 * Who may talk to the local drawing reader – the viewer's front door.
 *
 * The viewer runs on a laptop and holds a DeepSeek key. Three ways in, each closed here:
 *
 * - **Another machine on the network.** The server binds to 127.0.0.1, not every interface, so a
 *   colleague on the office Wi-Fi – or anyone on a café's – cannot reach it at all. (Done at
 *   `listen`; restated here because the next two only matter once that is true.)
 * - **A web page in the same browser.** Any site can make a browser POST to localhost; a "simple"
 *   request is sent without a CORS preflight, and although the page cannot read the answer, the
 *   model call – and its cost – has already happened. So a POST must carry an Origin that is this
 *   server's own. Browsers set Origin on every cross-origin POST and scripts cannot forge it.
 * - **DNS rebinding.** A hostile domain re-pointed at 127.0.0.1 is same-origin to its own page,
 *   so the Origin check passes – but its requests still name the hostile domain in Host. Only a
 *   Host of localhost or 127.0.0.1 on this port is served.
 */

export interface GuardVerdict {
  allowed: boolean;
  reason: string | null;
}

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

export function guardRequest(request: { method: string; host: string | undefined; origin: string | undefined }, port: number): GuardVerdict {
  const hosts = LOCAL_HOSTS.map((h) => `${h}:${port}`);
  if (!request.host || !hosts.includes(request.host.toLowerCase())) {
    return { allowed: false, reason: "This reader answers only requests addressed to it on this machine." };
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    const origins = hosts.map((h) => `http://${h}`);
    if (!request.origin || !origins.includes(request.origin.toLowerCase())) {
      return { allowed: false, reason: "Only the reader's own page may send it a drawing." };
    }
  }
  return { allowed: true, reason: null };
}

/** Headers on every page the viewer serves. The nonce lets its one inline script run and nothing else. */
export function securityHeaders(nonce: string): Record<string, string> {
  return {
    "content-security-policy": [
      "default-src 'none'",
      `script-src 'nonce-${nonce}'`,
      "style-src 'unsafe-inline'",
      "img-src data:",
      "connect-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join("; "),
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
  };
}
