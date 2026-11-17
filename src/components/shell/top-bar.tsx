/**
 * Top bar — PLATFORM.md §4.1, §7.3.
 *
 * 56px. Left to right: breadcrumb · project switcher · global search (⌘K) · save-state indicator ·
 * notifications · user menu.
 *
 * The switcher and the search are **one control** — `CommandPalette`. §4.1 asks for both, and a QS
 * with forty jobs wants to type three letters rather than choose between a dropdown and a box.
 *
 * The save-state indicator is here from the first screen because §13.4 makes autosave the contract
 * — no save button anywhere in the product — and this is where a user learns their work is safe.
 * It reads "All changes saved" only when that is true; with nothing to save yet it stays quiet
 * rather than reassuring about work that does not exist.
 */

import { Breadcrumb } from "@/components/shell/breadcrumb";
import { CommandPalette } from "@/components/shell/command-palette";
import { NavTracker } from "@/components/shell/nav-tracker";
import { NotificationBell } from "@/components/shell/notification-bell";
import { UserMenu } from "@/components/shell/user-menu";
import { AdhocQuickAction } from "@/components/adhoc/adhoc-quick-action";
import type { SearchableProject } from "@/lib/command-search";

export function TopBar({
  email,
  projects,
  unread = 0,
}: {
  email: string;
  /** Unread notifications, read with the page; the bell keeps it current after that. */
  unread?: number;
  /** Everything ⌘K can reach. Read once in the layout — the palette never queries for itself. */
  projects: readonly SearchableProject[];
}) {
  return (
    <header className="flex h-[var(--topbar-h)] shrink-0 items-center gap-3 border-b border-[var(--n-100)] bg-[var(--n-0)] px-4">
      <NavTracker />
      <Breadcrumb />

      <div className="ml-auto flex items-center gap-2">
        <AdhocQuickAction />
        <CommandPalette projects={projects} />

        <NotificationBell initialUnread={unread} />

        <div aria-hidden className="mx-1 h-5 w-px bg-[var(--n-200)]" />

        <UserMenu email={email} />
      </div>
    </header>
  );
}
