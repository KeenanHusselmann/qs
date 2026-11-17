/**
 * Not found, for an address no route matches.
 *
 * Next resolves an unmatched URL at the root, outside the app shell, so there is no sidebar here.
 * The alternative that keeps it is a catch-all route inside `(app)`, and a folder is a serverless
 * function — so this carries the way out itself instead. See `NotFoundPanel`.
 */

import { NotFoundPanel } from "@/components/shell/not-found-panel";

export default function NotFound() {
  return (
    <main className="h-full overflow-y-auto bg-[var(--n-50)]">
      <NotFoundPanel />
    </main>
  );
}
