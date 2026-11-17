/**
 * User menu — profile, settings, sign out.
 *
 * A dropdown rather than a drawer: it holds three links, and §7.5 reserves the drawer for record
 * detail the user needs beside a list.
 *
 * Written by hand rather than pulled from a component library. §13.2: can this be forty lines of
 * our own code? A menu that closes on outside-click and Escape, and moves focus with the arrow
 * keys, is exactly that — and it means the focus behaviour is ours to get right rather than
 * something to work around.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { LogOut, Settings, User } from "lucide-react";

import { signOut } from "@/app/login/actions";

export function UserMenu({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  /** Initials for the avatar. "qs@mzilikazi.co.za" → "QS". */
  const initials = email.split("@")[0]?.slice(0, 2).toUpperCase() ?? "?";

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="grid size-7 place-items-center rounded-full bg-[var(--n-200)] text-[11px] font-semibold text-[var(--n-700)] transition-colors hover:bg-[var(--n-300)]"
        style={{ transitionDuration: "var(--m-fast)" }}
      >
        {initials}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-56 overflow-hidden rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)]"
          style={{ boxShadow: "var(--e-2)", zIndex: "var(--z-dropdown)" }}
        >
          {/* Who is signed in — the first thing anyone opens this menu to check. */}
          <div className="border-b border-[var(--n-100)] px-3 py-2.5">
            <p className="t-sm truncate font-medium text-[var(--n-800)]">{email}</p>
            <p className="t-xs text-[var(--n-500)]">Signed in</p>
          </div>

          <div className="p-1">
            <MenuItem icon={User} label="Profile" />
            <MenuItem icon={Settings} label="Settings" />
          </div>

          <div className="border-t border-[var(--n-100)] p-1">
            {/*
              A form posting to the server action, not a fetch: sign-out must work without
              JavaScript, and it is a state change so it must be a POST rather than a link.
            */}
            <form action={signOut}>
              <button
                type="submit"
                role="menuitem"
                className="t-base flex w-full items-center gap-2.5 rounded-[var(--r-sm)] px-2 py-1.5 text-left text-[var(--n-700)] transition-colors hover:bg-[var(--n-50)]"
                style={{ transitionDuration: "var(--m-fast)" }}
              >
                <LogOut aria-hidden size={15} strokeWidth={1.75} className="text-[var(--n-500)]" />
                Sign out
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/** A menu row whose destination does not exist yet — greyed and labelled, never a dead link. */
function MenuItem({ icon: Icon, label }: { icon: typeof User; label: string }) {
  return (
    <span
      role="menuitem"
      aria-disabled
      className="t-base flex cursor-default items-center gap-2.5 rounded-[var(--r-sm)] px-2 py-1.5 text-[var(--n-400)]"
    >
      <Icon aria-hidden size={15} strokeWidth={1.75} />
      {label}
      <span className="t-xs ml-auto">soon</span>
    </span>
  );
}
