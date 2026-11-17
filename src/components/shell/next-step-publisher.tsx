/**
 * Tells the sidebar which step a project's overview says to open next.
 *
 * Renders nothing — see `@/lib/next-step`. Not cleared on unmount: the point is that the group stays
 * open while the reader walks from the overview into the project, and the value is keyed by project
 * so it cannot leak onto another one.
 */

"use client";

import { useEffect } from "react";

import { setNextStep } from "@/lib/next-step";

export function NextStepPublisher({ projectId, module }: { projectId: string; module: string | null }) {
  useEffect(() => {
    setNextStep(module ? { projectId, module } : null);
  }, [projectId, module]);

  return null;
}
