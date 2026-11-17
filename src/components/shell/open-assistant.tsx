"use client";

/**
 * Opens the assistant panel when the page it is on is visited — the overview and a project's
 * overview, where the assistant is the thing a reader arriving there most likely wants.
 *
 * Renders nothing. The open state is `advisor-state`'s, so the reader can still close the panel;
 * it opens again on the next visit to one of these pages, not on every other page.
 */

import { useEffect } from "react";

import { setOpen } from "@/components/project/advisor-state";

/** Below this the 340px panel would cover the page it is meant to sit beside. */
const ROOM_FOR_THE_PANEL = "(min-width: 1024px)";

export function OpenAssistant() {
  useEffect(() => {
    if (window.matchMedia(ROOM_FOR_THE_PANEL).matches) setOpen(true);
  }, []);

  return null;
}
