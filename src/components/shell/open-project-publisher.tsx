/**
 * Tells the breadcrumb which project is open.
 *
 * Renders nothing. It exists because the name is a server value and the crumb is a client component
 * mounted above it — see `@/lib/open-project`.
 */

"use client";

import { useEffect } from "react";

import { setOpenProject } from "@/lib/open-project";

export function OpenProjectPublisher({ id, name }: { id: string; name: string }) {
  useEffect(() => {
    setOpenProject({ id, name });
    // Cleared on the way out, so a stale project name cannot survive onto the projects list.
    return () => setOpenProject(null);
  }, [id, name]);

  return null;
}
