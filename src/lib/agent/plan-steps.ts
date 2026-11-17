/**
 * The project steps a plan may point at, by path – and their names.
 *
 * Apart from `advisor.ts` because the project page's client component needs `planStepLabel`, and
 * `advisor.ts` reaches the model call and through it the egress gateway, the database and the
 * session – none of which may be bundled into a browser.
 */

import { PROJECT_NAV } from "@/lib/navigation";

/** Every built project step, by path – the only paths a plan may point at. */
export const STEPS: ReadonlyMap<string, string> = new Map(
  PROJECT_NAV.flatMap((group) => group.items)
    .filter((item) => item.built && item.href.length > 1 && !["/dashboard", "/corpus", "/data", "/settings", "/work"].includes(item.href))
    .map((item) => [item.href, item.label] as const),
);

export const planStepLabel = (module: string): string => STEPS.get(module) ?? module;
