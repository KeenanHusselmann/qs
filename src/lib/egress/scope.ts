/**
 * Who a call is for — the project and the person a ledger row names.
 *
 * Seventeen call sites build prompts, and most sit several functions below the route or action that
 * knows which project and which person it is serving. Threading both through every signature would
 * touch every agent for the sake of a log line, so the entry point sets them once for everything
 * beneath it. A call made outside any scope is still recorded – with the project left empty and the
 * actor read from the session where there is one – rather than refused or guessed.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface EgressScope {
  projectId: string | null;
  actor: string | null;
}

const storage = new AsyncLocalStorage<EgressScope>();

/** Run `work` with every outbound call beneath it attributed to this project and person. */
export function withEgressScope<T>(scope: EgressScope, work: () => Promise<T>): Promise<T> {
  return storage.run(scope, work);
}

/** The common case: a project's work, done by whoever is signed in (the gateway reads the session). */
export function forProject<T>(projectId: string, work: () => Promise<T>): Promise<T> {
  return storage.run({ projectId, actor: null }, work);
}

/**
 * Set the scope for the rest of the current async function and everything it awaits – for a route
 * handler or a stream's `start`, where wrapping the whole body in `withEgressScope` would re-indent
 * a hundred lines for one line's worth of meaning. Call it first, before any `await`.
 */
export function enterEgressScope(scope: EgressScope): void {
  storage.enterWith(scope);
}

export function currentScope(): EgressScope | undefined {
  return storage.getStore();
}
