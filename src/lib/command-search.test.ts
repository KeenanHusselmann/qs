/**
 * What ⌘K can reach — PLATFORM.md §4.1.
 *
 * The ranking is worth pinning because it is the whole experience: a QS types three letters and
 * either lands on the right job or does not. And the *contents* are worth pinning because a palette
 * is the easiest place in the product to commit §14's demo-driven development — a list of plausible
 * commands is very cheap to write and tells a reader the product does things it does not.
 */

import { describe, expect, it } from "vitest";

import { buildCommands, rankCommands, type SearchableProject } from "./command-search";
import { PLATFORM_NAV, PROJECT_NAV } from "./navigation";

const projects: SearchableProject[] = [
  { id: "a", name: "Erf 180 Monaghan Ext 3", code: "MON-01", client: "Clever Development Trust" },
  { id: "b", name: "Kingsway Estates", code: "KW-02", client: "Mzilikazi Properties" },
  { id: "c", name: "Cost Centre Refurb", code: null, client: null },
];

const open = { id: "a", name: "Erf 180 Monaghan Ext 3" };

describe("what the palette offers", () => {
  it("offers every project when none is open, and no modules", () => {
    const commands = buildCommands(projects, null);
    expect(commands.filter((c) => c.kind === "project")).toHaveLength(projects.length);
    expect(commands.some((c) => c.kind === "module")).toBe(false);
  });

  /*
    "rate" found nothing from anywhere in the product: the palette indexed projects and a project's
    steps, and the Rate Library is neither.
  */
  it("reaches the firm's places from anywhere, open project or not", () => {
    for (const openProject of [null, open]) {
      const found = rankCommands(buildCommands(projects, openProject), "rate");
      expect(found.map((c) => c.label)).toContain("Rate Library");
    }
  });

  it("never offers a firm place that is not built", () => {
    const unbuilt = PLATFORM_NAV.flatMap((g) => g.items).filter((i) => !i.built);
    // Empty since the simplification of 16 Nov 2026 removed every unbuilt item; the rule stands for the next one.

    const labels = buildCommands(projects, null).map((c) => c.label);
    for (const item of unbuilt) expect(labels).not.toContain(item.label);
  });

  it("still leads with the jobs when nothing has been typed", () => {
    const first = buildCommands(projects, null).slice(0, projects.length);
    expect(first.every((c) => c.kind === "project")).toBe(true);
  });

  it("puts the open project's steps first, because that is where somebody already is", () => {
    const commands = buildCommands(projects, open);
    expect(commands[0].kind).toBe("module");
    expect(commands.filter((c) => c.kind === "project")).toHaveLength(projects.length);
  });

  /**
   * The guard against a palette that lies. An unbuilt nav item renders greyed in the sidebar and
   * has no page behind it, so offering it here would be a search result that goes nowhere.
   */
  it("never offers a module that is not built", () => {
    const unbuilt = PROJECT_NAV.flatMap((g) => g.items).filter((i) => !i.built);
    // Empty since the simplification of 16 Nov 2026 removed every unbuilt item; the rule stands for the next one.

    const labels = buildCommands(projects, open).map((c) => c.label);
    for (const item of unbuilt) expect(labels).not.toContain(item.label);
  });

  it("points every command at a real address under the open project", () => {
    const modules = buildCommands(projects, open).filter((c) => c.kind === "module");
    expect(modules.every((c) => c.href.startsWith(`/projects/${open.id}`))).toBe(true);
  });
});

describe("ranking", () => {
  const labels = (query: string, openProject = null as typeof open | null) =>
    rankCommands(buildCommands(projects, openProject), query).map((c) => c.label);

  it("shows everything for an empty query rather than nothing", () => {
    expect(labels("").length).toBeGreaterThan(0);
  });

  it("prefers a prefix of the name over a word inside it", () => {
    expect(labels("king")[0]).toBe("Kingsway Estates");
  });

  it("finds a job by its code, which is how a QS says its name", () => {
    expect(labels("MON-01")).toContain("Erf 180 Monaghan Ext 3");
  });

  it("finds a job by its client", () => {
    expect(labels("mzilikazi")).toContain("Kingsway Estates");
  });

  it("is case-insensitive and ignores surrounding space", () => {
    expect(labels("  KINGSWAY ")).toContain("Kingsway Estates");
  });

  it("puts a matching step above a project that only mentions the word", () => {
    // "Cost Plan" is a step; "Cost Centre Refurb" starts with the word too, but the open project's
    // steps are built first and a label prefix outranks anything found in keywords.
    const found = labels("cost plan", open);
    expect(found[0]).toBe("Cost Plan");
  });

  it("returns nothing rather than everything when nothing matches", () => {
    expect(labels("zzzzz")).toEqual([]);
  });

  it("caps the list, so the box never becomes a page", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: String(i),
      name: `Project ${i}`,
      code: null,
      client: null,
    }));
    expect(rankCommands(buildCommands(many, null), "project").length).toBeLessThanOrEqual(12);
  });
});

/**
 * Archived projects in the palette — reported by a tester, not found by a test.
 *
 * "It did archive but once it's archived the project is hard to find. There's no clear Archived
 * label almost as though it was deleted. I can't search for the project either. No trace."
 *
 * All three were true at once: the list excluded it, `listArchivedProjects` was exported and never
 * called, and the palette was fed from the same excluding query. §6.3 is explicit that an archived
 * project is "still readable, still citable, out of the working list" — and out of the working list
 * is not out of the building.
 */
describe("archived projects", () => {
  const filed: SearchableProject[] = [
    ...projects,
    { id: "z", name: "Ridgeview Phase 1", code: "RVG-P1", client: "Ridgeview Trust", archived: true },
  ];

  it("offers an archived project rather than hiding it", () => {
    const found = buildCommands(filed, null).find((c) => c.id === "project:z");
    expect(found).toBeDefined();
    expect(found?.href).toBe("/projects/z");
  });

  /** Said in words, because a result that looks live and is not sends somebody to the wrong job. */
  it("says it is archived, first in the hint", () => {
    const found = buildCommands(filed, null).find((c) => c.id === "project:z");
    expect(found?.hint).toMatch(/^Archived/);
  });

  /** So "archived" is a search anybody can run on purpose. */
  it("is findable by the word itself", () => {
    const ranked = rankCommands(buildCommands(filed, null), "archived");
    expect(ranked.map((c) => c.id)).toContain("project:z");
  });

  /**
   * Live work first. The original reasoning — "the palette is for getting to work, not for the
   * filing cabinet" — was right about priority and wrong only about exclusion.
   */
  it("ranks live projects ahead of archived ones", () => {
    const both: SearchableProject[] = [
      { id: "old", name: "Kingsway Estates", code: null, client: null, archived: true },
      { id: "new", name: "Kingsway Estates", code: null, client: null },
    ];

    const ranked = rankCommands(buildCommands(both, null), "kingsway");
    expect(ranked.map((c) => c.id)).toEqual(["project:new", "project:old"]);
  });
});
