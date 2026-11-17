/**
 * Which sidebar groups are open — PLATFORM.md §4.1, §7.1.
 *
 * ── Why the groups fold ────────────────────────────────────────────────────────────────────
 *
 * A project's nav is twenty-two rows under six headings, and a QS working the feasibility estimate
 * has no use for eleven construction and close-out rows while they do it. The whole list on screen
 * at once is the crowded board the stages were meant to fix, reproduced in the chrome. §7.1 wants
 * density over whitespace, and a folded group is denser than a scrolled one.
 *
 * **The group holding the page you are on is always open**, and that is not stored anywhere — it
 * is derived from the path on every render. A remembered "open" set that had to be corrected on
 * navigation would be two sources of truth for the same fact, and they would disagree the first
 * time somebody arrived by URL.
 *
 * So this store holds only the deliberate exceptions: groups a reader opened by hand. Everything
 * else follows from where they are.
 *
 * ── The same shape as `sidebar-state.ts`, for the same reason ──────────────────────────────
 *
 * localStorage genuinely is an external store, so `useSyncExternalStore` rather than state synced
 * by an effect — which would render once folded and again unfolded, a visible flicker.
 */

const STORAGE_KEY = "qs.nav.open-groups";

let listeners: Array<() => void> = [];

/**
 * Cached, because `getSnapshot` must return the same reference until something changes.
 *
 * `useSyncExternalStore` compares snapshots by identity. Parsing the JSON on every call returns a
 * new array each time, React sees a change that did not happen, and it re-renders forever — it
 * throws "getSnapshot should be cached" rather than looping, which is a kindness. The cache is
 * invalidated by the only two things that can change the value: a write here, or a write in
 * another tab.
 */
let cached: readonly string[] | null = null;

/** Frozen and shared, so the empty case is one reference rather than a new array each read. */
const NONE: readonly string[] = Object.freeze([]);

function read(): readonly string[] {
  if (cached) return cached;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    // Anything that is not a list of strings is treated as absent. A corrupt value should fold the
    // groups, not throw inside a render and take the shell down with it.
    cached = Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : NONE;
  } catch {
    cached = NONE;
  }

  return cached;
}

export function subscribe(onChange: () => void): () => void {
  listeners.push(onChange);

  // Another tab's write fires `storage`; this tab's does not, hence the emit in `toggleGroup`.
  const onStorage = () => {
    cached = null;
    onChange();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners = listeners.filter((l) => l !== onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function getSnapshot(): readonly string[] {
  return read();
}

/** Nothing is open on the server. The active group is derived from the path, not from here. */
export function getServerSnapshot(): readonly string[] {
  return NONE;
}

export function toggleGroup(heading: string): void {
  const open = read();
  const next = open.includes(heading)
    ? open.filter((h) => h !== heading)
    : [...open, heading];

  cached = next;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  for (const listener of listeners) listener();
}
