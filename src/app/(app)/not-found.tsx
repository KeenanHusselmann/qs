/**
 * Not found, inside the app shell.
 *
 * Renders when a page in the app calls `notFound()` — a project id that no longer exists, a module
 * the navigation does not contain — so the sidebar and top bar stay, and the reader is one click
 * from where they were. See `NotFoundPanel`.
 */

import { NotFoundPanel } from "@/components/shell/not-found-panel";

export default function NotFound() {
  return <NotFoundPanel />;
}
