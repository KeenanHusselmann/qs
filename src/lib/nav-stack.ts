/**
 * Where "back" goes.
 *
 * ── Why not just router.back() ─────────────────────────────────────────────────────────────
 *
 * The browser's history is not the trail through this application. It holds every entry the tab has
 * ever had, including the login page, the redirect that bounced through it, and whatever site was
 * open before. `router.back()` from a project's Site page can just as easily land on `/login` — and
 * on a page opened from a pasted link there is nothing behind it at all, so the control either does
 * nothing or leaves the product entirely. Neither is a back button.
 *
 * So the trail is kept explicitly: the in-app routes visited this session, in order. That makes two
 * things possible that history cannot offer — knowing whether there *is* a previous page, and
 * naming it, so the control can say where it goes instead of being an arrow you have to gamble on.
 *
 * ── sessionStorage, not memory ─────────────────────────────────────────────────────────────
 *
 * Per tab, and it survives a reload. A module-level array would reset on every refresh and strand
 * someone mid-trail. It is deliberately not localStorage: two tabs on two projects sharing one
 * back stack would send each other sideways.
 */

const KEY = "qs.nav.stack";

/** Beyond this the trail is noise; nobody navigates back through forty pages. */
const LIMIT = 30;

let listeners: Array<() => void> = [];

function read(): string[] {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    // Private-mode denials and malformed JSON both mean "no trail", not a crash on every render.
    return [];
  }
}

function write(stack: string[]): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(stack.slice(-LIMIT)));
  } catch {
    /* Storage unavailable — the control falls back to its default target. */
  }
  for (const listener of listeners) listener();
}

/**
 * Record a visit.
 *
 * Three cases, and getting the middle one wrong is what makes home-grown back buttons loop:
 *
 *  - same page again (a refresh, or a replace): nothing changes.
 *  - **the page below the top**: this is someone going back. Pop, rather than pushing a duplicate —
 *    otherwise back and forward build an ever-growing pile and back stops making progress.
 *  - anything else: push.
 */
export function visit(path: string): void {
  const stack = read();
  const top = stack[stack.length - 1];
  if (top === path) return;

  if (stack[stack.length - 2] === path) {
    stack.pop();
    write(stack);
    return;
  }

  stack.push(path);
  write(stack);
}

/** The page behind the current one, or null when this is where the trail starts. */
export function previous(): string | null {
  const stack = read();
  return stack.length >= 2 ? (stack[stack.length - 2] ?? null) : null;
}

export function subscribe(onChange: () => void): () => void {
  listeners.push(onChange);
  return () => {
    listeners = listeners.filter((l) => l !== onChange);
  };
}

export function getSnapshot(): string | null {
  return previous();
}

/** No trail on the server, so the control renders its default target and never mismatches. */
export function getServerSnapshot(): null {
  return null;
}
