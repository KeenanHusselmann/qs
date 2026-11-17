/**
 * Every place in the nav has a mark — PLATFORM.md §4.1.
 *
 * The sidebar collapses to a 56px rail, and a rail is icons. A nav item with no icon is invisible
 * in review and obvious in production: a blank square somebody has to click to identify. Same shape
 * as `check-modules.mjs` — a list typed by hand needs a check that it is complete, or it silently
 * is not.
 */

import { describe, expect, it } from "vitest";

import { hasIcon, iconFor } from "./nav-icons";
import { PLATFORM_NAV, PROJECT_NAV } from "@/lib/navigation";

const everyHref = [...PLATFORM_NAV, ...PROJECT_NAV].flatMap((group) =>
  group.items.map((item) => item.href),
);

describe("nav icons", () => {
  it("covers every item in both navs, built or not", () => {
    // Unbuilt items are shown dimmed rather than hidden (§7.7), so they are in the rail too and
    // need a mark exactly as much.
    expect(everyHref.filter((href) => !hasIcon(href))).toEqual([]);
  });

  it("covers the project's own front page, whose href is empty", () => {
    expect(hasIcon("")).toBe(true);
  });

  it("returns something rather than nothing for an href it does not know", () => {
    // A gap in the map is a blank row; a crash is the whole shell. The test above is what stops
    // the gap reaching anybody.
    expect(iconFor("/not-a-place")).toBeTruthy();
  });

  it("gives measurement and money marks a QS would recognise apart", () => {
    expect(iconFor("/take-off")).not.toBe(iconFor("/pricing"));
    expect(iconFor("/bill")).not.toBe(iconFor("/cost-plan"));
  });
});
