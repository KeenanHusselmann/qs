/**
 * Whether the sidebar is collapsed, persisted per browser.
 *
 * localStorage genuinely *is* an external store, so this is `useSyncExternalStore` rather than
 * state synced by an effect. Reading it in an effect and calling `setState` would render once with
 * the wrong width and again with the right one — a visible flicker, and the cascading render the
 * React Compiler rightly rejects.
 *
 * `getServerSnapshot` returns false so the server renders the expanded sidebar. That is the
 * default, and it is what someone with no stored preference should see. What is collapsed by
 * default is each *group* within it — see `nav-groups.ts`.
 *
 * Persists per user once there is a user record to hang it on (§7.3).
 */

const STORAGE_KEY = "qs.sidebar.collapsed";

let listeners: Array<() => void> = [];

export function subscribe(onChange: () => void): () => void {
  listeners.push(onChange);
  // A change in another tab fires `storage`; a change in this one does not, hence `emit` below.
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

export function getServerSnapshot(): boolean {
  return false;
}

export function setCollapsed(collapsed: boolean): void {
  window.localStorage.setItem(STORAGE_KEY, String(collapsed));
  for (const listener of listeners) listener();
}

/**
 * Flip it, reading the current value here rather than taking one from the caller.
 *
 * The button used to do `setCollapsed(!collapsed)`, closing over the value from
 * `useSyncExternalStore`. On a fresh load that worked; after a reload with the sidebar already
 * collapsed, clicking Expand did nothing at all — the handler was holding a stale `false` and
 * writing `true` over `true`.
 *
 * A toggle that reads the store has no closure to go stale, which removes the class of bug rather
 * than the instance of it.
 */
export function toggleCollapsed(): void {
  setCollapsed(!getSnapshot());
}
