/**
 * The step a project's overview says to open next, for the sidebar to open its group.
 *
 * The overview is the one screen that computes it — `nextStep` in `chain.ts`, over every step's
 * grounded readiness — and the sidebar renders above that tree, so a prop cannot reach it. Same
 * shape as `open-project.ts`: the page publishes, the chrome subscribes.
 *
 * ── Why the sidebar wants it ───────────────────────────────────────────────────────────────
 *
 * The project nav starts folded, and a reader landing on a project saw four rows and seven closed
 * headings: every module hidden, and Pricing findable only by knowing it sits under Measurement.
 * The group holding the step the chain says is next is the one they are about to need, so it opens.
 *
 * **Keyed by project**, so a value published on one job is never applied to another. Held in memory,
 * not storage: it is recomputed every time the overview renders, and after a reload onto a module
 * page the sidebar simply falls back to opening the group holding that page, which it always does.
 */

export interface PublishedNextStep {
  projectId: string;
  /** The step's nav href — "/bill". */
  module: string;
}

let current: PublishedNextStep | null = null;
let listeners: Array<() => void> = [];

export function setNextStep(next: PublishedNextStep | null): void {
  if (current?.projectId === next?.projectId && current?.module === next?.module) return;
  current = next;
  for (const listener of listeners) listener();
}

export function subscribe(onChange: () => void): () => void {
  listeners.push(onChange);
  return () => {
    listeners = listeners.filter((l) => l !== onChange);
  };
}

export function getSnapshot(): PublishedNextStep | null {
  return current;
}

export function getServerSnapshot(): null {
  return null;
}
