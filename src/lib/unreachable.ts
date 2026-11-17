/**
 * Why something could not be reached, in words the person who pressed the button can act on.
 *
 * ── The message this replaces ──────────────────────────────────────────────────────────────
 *
 * "The advisor could not be reached (HTTP 503)." Three panels printed a version of that, and it
 * told a quantity surveyor one thing they could use — that it failed — wrapped around one they
 * could not. A status code is a fact about a protocol. The reader's question is narrower and
 * always the same: is this worth trying again, or is somebody going to have to fix something?
 *
 * So the status is read here and answered in those terms. It still reaches the browser console
 * for whoever is debugging; it just stops being the sentence under the button.
 */
export function whyUnreachable(status: number, what: string): string {
  if (status === 401 || status === 403) {
    return `${what} could not be reached – your session may have ended. Reload the page and sign in again.`;
  }
  if (status === 429) {
    return `${what} is handling too much at once. Wait a moment and try again.`;
  }
  if (status === 408 || status === 504) {
    return `${what} took too long to answer and the attempt was stopped. Try again – a long question sometimes needs a second run.`;
  }
  if (status >= 500) {
    return `${what} is unavailable at the moment. Nothing was changed – try again shortly.`;
  }
  // A 4xx that is none of the above is a fault in the platform rather than anything the reader
  // did, and saying so is more useful than a number they would have to look up.
  return `${what} could not be reached. This looks like a fault in the platform rather than anything you did – please report it.`;
}
