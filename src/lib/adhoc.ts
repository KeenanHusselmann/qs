/**
 * Ad hoc requests – what one is, and which parts of a project it uses (November meeting).
 *
 * "Here's the input, this is what I need." Raymond's example: Richard asked, out of the blue, for a
 * steel specification list for a supplier meeting – block components, retaining walls, carports,
 * roofs, boundary walls, tonnage and specification for each – built from the architect's and the
 * engineer's drawings. The next one will be the sheet, screw and fitting count for a switch to zinc
 * roofing. Answered quickly, from documents, and asked about again later.
 *
 * So an ad hoc request is a project of kind "adhoc" (migration 0039) that uses only:
 *
 *   Overview    – the request itself: what was asked, by whom, by when, and whether it is answered
 *   Corpus      – the inputs folder, kept as the context for every follow-up question
 *   Take-off    – measuring from those drawings, which is most of what these requests are
 *
 * plus the assistant, which is on every project page. None of the service chain: no stage is run,
 * nothing is signed off, and nothing counts towards a portfolio figure.
 *
 * No database here, so the sidebar (a client component) can import it.
 */

export type ProjectKind = "project" | "adhoc";

/** The project modules an ad hoc request shows, by their href relative to the project. */
// "/review" and "/estimates": "check this BOQ against the drawings" and "compare these two
// estimates" are among the commonest things to arrive ad hoc.
export const ADHOC_MODULES: readonly string[] = ["", "/corpus", "/estimates", "/take-off", "/review"];

/** Whether a project module belongs on an ad hoc request. */
export function inAdhocScope(module: string): boolean {
  return ADHOC_MODULES.includes(module);
}

/** "Due Friday 14 Nov", "Overdue since 10 Nov", or null – the line a list shows under a request. */
export function dueLine(dueOn: string | null, today: string): { text: string; overdue: boolean } | null {
  if (!dueOn) return null;
  const label = new Date(`${dueOn}T00:00:00`).toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" });
  if (dueOn < today) return { text: `Overdue since ${label}`, overdue: true };
  return { text: dueOn === today ? "Due today" : `Due ${label}`, overdue: false };
}
