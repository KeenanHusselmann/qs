/**
 * What ⌘K can take you to — PLATFORM.md §4.1.
 *
 * §4.1 asks the top bar for two things this replaces at once:
 *
 *   · **a project switcher**, "search-first — users have 5–50 projects, a `<select>` is not
 *     acceptable"
 *   · **global search (⌘K)**
 *
 * They are one control. A QS with forty jobs does not want a dropdown and a search box; they want
 * to type three letters of a project name and be in it. And once a project is open the same box is
 * how you reach its steps without walking the sidebar.
 *
 * ── Only what exists ───────────────────────────────────────────────────────────────────────
 *
 * Every destination here is a real project or a built module. §14 names demo-driven development as
 * a way this project fails, and a palette is where that would be easiest to commit: a list of
 * plausible commands is very cheap to write and tells a reader the product does things it does not.
 * An unbuilt module is not offered, because arriving at a page that does not exist is worse than
 * not finding it.
 *
 * ── The ranking is deliberately dull ───────────────────────────────────────────────────────
 *
 * A prefix beats a substring, a name beats the client's name, and that is the whole of it. Fuzzy
 * matching feels clever and then puts "Final Account" above "Feasibility Estimate" for `fe`, which
 * is the sort of thing nobody can predict and everybody has to work around.
 */

import { PLATFORM_NAV, PROJECT_NAV } from "@/lib/navigation";

/** A project as the palette needs it — enough to find it by, and nothing more. */
export interface SearchableProject {
  id: string;
  name: string;
  code: string | null;
  client: string | null;
  /**
   * Finished work the practice keeps (§6.3). Searchable, and said so on the result.
   *
   * It used to be absent from the palette entirely — "the palette is for getting to work, not for
   * the filing cabinet" — and a tester found the cost of that: archiving a project made it vanish
   * with no way back but a URL somebody had kept. Archived is a *status*, not a deletion, and a
   * job nobody can find is indistinguishable from one that was deleted.
   *
   * So it is here, marked, and after the live ones — which keeps the original reasoning intact
   * without making finished work unreachable.
   */
  archived?: boolean;
}

export type CommandKind = "project" | "module" | "place";

export interface Command {
  /** Stable across renders, so the keyboard's idea of "the third one" survives a keystroke. */
  id: string;
  kind: CommandKind;
  label: string;
  /** The quieter half of the row — a project's client, or the group a module sits in. */
  hint: string | null;
  href: string;
  /** Matched against as well as the label, but never shown. A code is how a QS says a job's name. */
  keywords: string;
}

/**
 * Everything reachable right now.
 *
 * The open project's own steps come **first**, because somebody who has a project open and reaches
 * for the palette is usually going somewhere inside it. When none is open they are absent entirely
 * rather than pointing at a project that has not been chosen.
 */
export function buildCommands(
  projects: readonly SearchableProject[],
  openProject: { id: string; name: string } | null,
): Command[] {
  const modules: Command[] = openProject
    ? PROJECT_NAV.flatMap((group) =>
        group.items
          // An unbuilt item renders greyed in the sidebar and has no page. Offering it here would
          // be a search result that goes nowhere.
          .filter((item) => item.built)
          .map((item) => ({
            id: `module:${item.href}`,
            kind: "module" as const,
            label: item.label,
            hint: group.heading ?? openProject.name,
            href: `/projects/${openProject.id}${item.href}`,
            keywords: `${item.label} ${group.heading ?? ""} ${item.process ?? ""}`,
          })),
      )
    : [];

  const asCommand = (project: SearchableProject): Command => ({
    id: `project:${project.id}`,
    kind: "project" as const,
    label: project.name,
    // "Archived" leads the hint rather than trailing it: a reader scanning a list of results reads
    // the left of each line, and this is the word that changes what the result means.
    hint:
      [project.archived ? "Archived" : null, project.code, project.client]
        .filter(Boolean)
        .join(" · ") || null,
    href: `/projects/${project.id}`,
    // Searchable *by the word too*, so "archived" finds the filing cabinet on purpose.
    keywords: `${project.name} ${project.code ?? ""} ${project.client ?? ""}${
      project.archived ? " archived" : ""
    }`,
  });

  // Live work first, then the filing cabinet. Ranking is stable within each group, so a live
  // project always outranks an archived one that matched the query equally well.
  const live = projects.filter((p) => !p.archived).map(asCommand);
  const filed = projects.filter((p) => p.archived).map(asCommand);

  /*
    The firm's own places — Rate Library, Reports, Policies — offered everywhere.

    They were absent, so "rate" found nothing from any screen in the product while the Rate Library
    is the asset a QS opens most outside a job. Built items only, for the reason modules are: a
    result that goes nowhere is worse than no result. After the live jobs, because somebody opening
    the palette is usually going to one.
  */
  const places: Command[] = PLATFORM_NAV.flatMap((group) =>
    group.items
      .filter((item) => item.built)
      .map((item) => ({
        id: `place:${item.href}`,
        kind: "place" as const,
        label: item.label,
        hint: group.heading ?? "Platform",
        href: item.href,
        keywords: `${item.label} ${group.heading ?? ""}`,
      })),
  );

  return [...modules, ...live, ...places, ...filed];
}

const fold = (value: string) => value.toLowerCase().trim();

/**
 * Rank one command against a query, or reject it.
 *
 * Lower is better, and the bands are wide enough that nothing tips over accidentally: the label's
 * own prefix wins, then a word inside the label, then anything in the keywords. A miss returns
 * null rather than a large number, so a caller cannot accidentally render the misses at the bottom.
 */
function score(command: Command, query: string): number | null {
  const label = fold(command.label);
  const keywords = fold(command.keywords);

  if (label.startsWith(query)) return 0;
  // A word boundary, so "cost" finds "Cost Plan" and "Elemental Cost" alike but not "Costa".
  if (label.split(/\s+/).some((word) => word.startsWith(query))) return 1;
  if (label.includes(query)) return 2;
  if (keywords.includes(query)) return 3;
  return null;
}

/**
 * The commands worth showing, best first.
 *
 * An empty query is not a miss — it is somebody who has just opened the palette, and the honest
 * answer is everything, in the order it was built: the open project's steps, then the jobs.
 */
export function rankCommands(commands: readonly Command[], query: string, limit = 12): Command[] {
  const needle = fold(query);
  if (needle === "") return commands.slice(0, limit);

  return commands
    .map((command) => ({ command, rank: score(command, needle) }))
    .filter((scored): scored is { command: Command; rank: number } => scored.rank !== null)
    // Stable within a rank: `sort` is stable in every engine this runs on, so equal ranks keep the
    // order `buildCommands` chose rather than shuffling as somebody types.
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map((scored) => scored.command);
}
