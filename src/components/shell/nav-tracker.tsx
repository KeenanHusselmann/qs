/**
 * Records the trail through the application.
 *
 * The visible back control is gone — the breadcrumb does that job now, and does it unambiguously.
 * The trail is still worth keeping: browser Back and the mouse's fourth button both use it, and
 * anything that wants to return someone to where they actually were needs it recorded.
 *
 * Mounted in the top bar because the top bar is on every page inside the shell. Renders nothing.
 */

"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { visit } from "@/lib/nav-stack";

export function NavTracker() {
  const pathname = usePathname();

  useEffect(() => {
    visit(pathname);
  }, [pathname]);

  return null;
}
