/**
 * The name of the project currently open.
 *
 * The breadcrumb lives in the top bar, which renders *above* every project page in the tree, so
 * React context cannot reach it — context flows down, and the name is only known further down. The
 * crumb was reading "Projects / Project" as a result, which tells a reader nothing they did not
 * already know and is exactly the ambiguity worth removing.
 *
 * So the project layout publishes the name here and the breadcrumb subscribes. Same shape as
 * `nav-stack` and `sidebar-state`: an external store read with `useSyncExternalStore`, which is
 * what this is — a value that lives outside React's tree and changes underneath it.
 *
 * Held in memory rather than storage: it is only ever true for the page currently rendered, and a
 * stale name surviving a reload onto a different project would be worse than no name at all.
 */

let current: { id: string; name: string } | null = null;
let listeners: Array<() => void> = [];

export function setOpenProject(next: { id: string; name: string } | null): void {
  if (current?.id === next?.id && current?.name === next?.name) return;
  current = next;
  for (const listener of listeners) listener();
}

export function subscribe(onChange: () => void): () => void {
  listeners.push(onChange);
  return () => {
    listeners = listeners.filter((l) => l !== onChange);
  };
}

export function getSnapshot(): { id: string; name: string } | null {
  return current;
}

/** The server has no open project; the crumb falls back to the id-free label until hydration. */
export function getServerSnapshot(): null {
  return null;
}
