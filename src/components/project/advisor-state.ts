/**
 * Whether the advisor panel is open, persisted per browser.
 *
 * Closed by default: 340px of a 1280px design target is a quarter of the screen, and the bill and
 * the pricing grid need their width more than a reader who has not asked for advice needs a panel.
 * Once it is opened it stays open — a QS who wants the advisor beside them wants it beside them on
 * the next screen too, and re-opening it on every navigation would be the platform forgetting.
 *
 * The same shape as `sidebar-state.ts` and `nav-groups.ts`: localStorage genuinely is an external
 * store, so `useSyncExternalStore` rather than state synced by an effect — which would render once
 * closed and again open, a visible flicker on every project page.
 */

const STORAGE_KEY = "qs.advisor.open";

let listeners: Array<() => void> = [];

export function subscribe(onChange: () => void): () => void {
  listeners.push(onChange);
  // Another tab's write fires `storage`; this one's does not, hence the emit in `setOpen`.
  window.addEventListener("storage", onChange);

  return () => {
    listeners = listeners.filter((l) => l !== onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Returns a boolean, so React's identity check compares by value and cannot loop. */
export function getSnapshot(): boolean {
  return window.localStorage.getItem(STORAGE_KEY) === "true";
}

/** Closed on the server, which is the default, so the first paint matches it. */
export function getServerSnapshot(): boolean {
  return false;
}

export function setOpen(open: boolean): void {
  window.localStorage.setItem(STORAGE_KEY, String(open));
  for (const listener of listeners) listener();
}
