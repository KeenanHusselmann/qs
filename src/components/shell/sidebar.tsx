/**
 * Left sidebar — PLATFORM.md §4.1, §7.3.
 *
 * 240px expanded, 56px collapsed, persisted per browser.
 *
 * ── One level at a time, not two stacked ───────────────────────────────────────────────────
 *
 * Platform nav when no project is open; project nav when one is. **Never both.** They were stacked
 * before, which made opening a project *add* to the sidebar rather than change it: twenty-odd items
 * over six headings, most of them greyed, with the firm's Rate library and Benchmarks sitting above
 * work that belongs to the project in front of you. The list a QS needs while working on a project
 * is the project's list; Dashboard and Approvals are somewhere to go afterwards, not competition
 * for attention during.
 *
 * So the sidebar swaps. The way back out is the project name at the top — a heading that says which
 * project you are in, and a link that leaves it. That is one control, in one place, rather than a
 * permanent copy of the platform nav kept on screen in case you want to leave.
 *
 * The process model is not in here, deliberately. See the note at the top of `@/lib/navigation`:
 * v3 shipped it as a sidebar tree and removed it on client feedback.
 */

"use client";

import { createElement, useSyncExternalStore } from "react";
import { ArrowLeft, ChevronDown, ChevronsLeft, ChevronsRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  getServerSnapshot,
  getSnapshot,
  subscribe,
  toggleCollapsed,
} from "@/components/shell/sidebar-state";
import {
  getServerSnapshot as groupsOnServer,
  getSnapshot as openGroups,
  subscribe as subscribeGroups,
  toggleGroup,
} from "@/components/shell/nav-groups";
import { PLATFORM_NAV, PROJECT_NAV, type NavGroup } from "@/lib/navigation";
import { iconFor } from "@/components/shell/nav-icons";
import {
  getServerSnapshot as nextOnServer,
  getSnapshot as nextStepSnapshot,
  subscribe as subscribeNext,
} from "@/lib/next-step";
import { withinStages } from "@/lib/stages";
import { inAdhocScope } from "@/lib/adhoc";

export function Sidebar({
  /**
   * Each project's stages, by id — null meaning every stage.
   *
   * Keyed rather than passed for one project because the shell renders above the project route and
   * learns which project is open from the URL, not from a prop.
   */
  stages = {},
  /** The ids that are ad hoc requests, which show only their own modules (`lib/adhoc.ts`). */
  adhoc = [],
}: {
  stages?: Record<string, readonly number[] | null>;
  adhoc?: readonly string[];
}) {
  const collapsed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  /**
   * The project in the URL, if any.
   *
   * Read from the path rather than held in state: the sidebar and the page must agree about which
   * project is open, and the URL is the one thing both already see. A separate store could drift.
   */
  const pathname = usePathname();
  const openProject = /^\/projects\/([^/]+)/.exec(pathname)?.[1] ?? null;
  const openAdhoc = openProject !== null && adhoc.includes(openProject);
  /*
    An ad hoc request's modules are removed rather than dimmed. A project whose stages were entered
    wrongly must keep a way back to the step it needs; an ad hoc request has no steps to strand.
  */
  const projectGroups = openAdhoc
    ? PROJECT_NAV.map((g) => ({ ...g, items: g.items.filter((i) => inAdhocScope(i.href)) })).filter((g) => g.items.length > 0)
    : PROJECT_NAV;

  return (
    <aside
      className="flex shrink-0 flex-col border-r border-[var(--n-100)] bg-[var(--n-50)] transition-[width]"
      style={{
        width: collapsed ? "var(--sidebar-collapsed-w)" : "var(--sidebar-w)",
        transitionDuration: "var(--m-slow)",
      }}
    >
      <div className="flex h-[var(--topbar-h)] shrink-0 items-center gap-2.5 border-b border-[var(--n-100)] px-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- static mark, and next/image's
            optimizer is a Vercel function this app's 12-function budget has no room for (§ HANDOFF). */}
        <img src="/mzi-logo.png" alt="" aria-hidden className="size-6 shrink-0 object-contain" />
        {!collapsed && (
          <span className="t-md truncate font-semibold text-[var(--n-800)]">
            Mzilikazi QS Platform
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {openProject ? (
          <>
            {/* Says where you are and how to leave, in one control. */}
            <Link
              href={openAdhoc ? "/my-work#adhoc" : "/projects"}
              className="t-sm mx-2 mt-2 mb-1 flex items-center gap-1.5 rounded-[var(--r-sm)] px-2 py-1.5 text-[var(--n-700)] transition-colors hover:bg-[var(--n-100)] hover:text-[var(--n-900)]"
              style={{ transitionDuration: "var(--m-fast)" }}
              title={collapsed ? (openAdhoc ? "All ad hoc requests" : "All projects") : undefined}
            >
              <ArrowLeft aria-hidden size={14} strokeWidth={1.75} className="shrink-0" />
              {!collapsed && <span className="truncate">{openAdhoc ? "All ad hoc requests" : "All projects"}</span>}
            </Link>

            <NavSection
              groups={projectGroups}
              collapsed={collapsed}
              label={openAdhoc ? "Ad hoc request" : "Project"}
              base={`/projects/${openProject}`}
              stages={openAdhoc ? undefined : stages[openProject]}
              projectId={openProject}
              // Four rows do not need folding; an ad hoc request shows all of its few modules at once.
              foldable={!openAdhoc}
            />
          </>
        ) : (
          <NavSection groups={PLATFORM_NAV} collapsed={collapsed} label="Main" />
        )}
      </div>

      <div className="shrink-0 border-t border-[var(--n-100)] p-2">
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="t-sm flex w-full items-center gap-2.5 rounded-[var(--r-sm)] px-2 py-1.5 text-[var(--n-700)] transition-colors hover:bg-[var(--n-100)] hover:text-[var(--n-900)]"
          style={{ transitionDuration: "var(--m-fast)" }}
        >
          {collapsed ? (
            <ChevronsRight aria-hidden size={16} strokeWidth={1.75} />
          ) : (
            <ChevronsLeft aria-hidden size={16} strokeWidth={1.75} />
          )}
          {!collapsed && "Collapse"}
        </button>
      </div>
    </aside>
  );
}

function NavSection({
  groups,
  collapsed,
  label,
  /** Prefixed onto every href — project items are relative to the open project. */
  base = "",
  /** The open project's stages. Undefined for the platform nav, which no project scopes. */
  stages,
  /**
   * Whether the headed groups fold.
   *
   * The project nav is twenty-two rows under six headings and folding is the whole point. The
   * platform nav is seven rows under one, and folding four of them behind a heading hides the
   * firm's Rate Library and Benchmarks to save three rows of a sidebar that is not full. A rule
   * that folded by count would be arbitrary; declaring it per nav says which is which and why.
   */
  foldable = false,
  /** The open project, so a next step published for it — and only for it — can open its group. */
  projectId,
}: {
  groups: readonly NavGroup[];
  collapsed: boolean;
  label: string;
  base?: string;
  stages?: readonly number[] | null;
  foldable?: boolean;
  projectId?: string;
}) {
  const pathname = usePathname();
  const published = useSyncExternalStore(subscribeNext, nextStepSnapshot, nextOnServer);
  const nextHref =
    projectId && published?.projectId === projectId ? `${base}${published.module}` : null;

  return (
    <nav aria-label={label} className="flex flex-col">
      {groups.map((group, index) => (
        <NavGroupBlock
          key={group.heading ?? index}
          group={group}
          collapsed={collapsed}
          base={base}
          pathname={pathname}
          stages={stages}
          foldable={foldable}
          nextHref={nextHref}
        />
      ))}
    </nav>
  );
}

/**
 * One group in the sidebar — a heading you can fold, and the rows under it.
 *
 * ── What is open, and why it is mostly not stored ──────────────────────────────────────────
 *
 * A project's nav is twenty-two rows under six headings. All of it on screen at once is the
 * crowded board the stages were meant to fix, moved into the chrome, so the groups fold and start
 * folded.
 *
 * **The group holding the current page is always open**, derived from the path rather than
 * remembered. A stored "open" set that had to be corrected on every navigation would be a second
 * source of truth for the same fact, and the two would disagree the moment somebody arrived by
 * URL. `nav-groups.ts` therefore stores only the deliberate exceptions.
 *
 * The first group has no heading — Overview, Project Corpus, Project Data, Project Details on a
 * project; Dashboard and Projects on the platform. Those are where a reader goes to *find* their
 * way, so they have nothing to fold behind and always show.
 *
 * Collapsed to the 56px rail there are no headings to press, so the rail shows every row. A rail
 * that hid rows behind an invisible control would be a rail with no way out of it.
 */
function NavGroupBlock({
  group,
  collapsed,
  base,
  pathname,
  stages,
  foldable: navFolds,
  nextHref,
}: {
  group: NavGroup;
  collapsed: boolean;
  base: string;
  pathname: string;
  stages?: readonly number[] | null;
  foldable: boolean;
  /** Where the overview says to go next, if it has said. Its group opens, like the current page's. */
  nextHref: string | null;
}) {
  const opened = useSyncExternalStore(subscribeGroups, openGroups, groupsOnServer);

  const rows = group.items.map((item) => ({ item, href: `${base}${item.href}` }));
  const holdsCurrentPage = rows.some(({ href }) => pathname === href);

  // No heading means nothing to fold behind; the rail has no heading to press; and a nav that does
  // not fold at all keeps its headings as plain labels.
  const foldable = navFolds && Boolean(group.heading) && !collapsed;
  const holdsNext = nextHref !== null && rows.some(({ href }) => href === nextHref);
  const open = !foldable || holdsCurrentPage || holdsNext || opened.includes(group.heading ?? "");

  return (
    <div className="flex flex-col gap-px px-2 py-1">
      {group.heading &&
        (collapsed || !navFolds ? (
          collapsed ? (
            // A heading has nowhere to go in a 56px rail, and truncating one is worse than a rule:
            // the groups still read as groups, without inventing an abbreviation.
            <div aria-hidden className="mx-3 my-2 border-t border-[var(--n-200)]" />
          ) : (
            <div className="t-xs px-2 pt-2 pb-1 font-semibold tracking-[0.03em] text-[var(--n-600)] uppercase">
              {group.heading}
            </div>
          )
        ) : (
          <button
            type="button"
            data-nav-group={group.heading}
            data-open={open}
            aria-expanded={open}
            onClick={() => toggleGroup(group.heading as string)}
            className="t-xs flex w-full items-center gap-1.5 rounded-[var(--r-sm)] px-2 pt-2 pb-1 text-left font-semibold tracking-[0.03em] text-[var(--n-600)] uppercase transition-colors hover:text-[var(--n-800)]"
            style={{ transitionDuration: "var(--m-fast)" }}
          >
            <ChevronDown
              aria-hidden
              size={11}
              strokeWidth={2.5}
              className="shrink-0 transition-transform"
              style={{
                transitionDuration: "var(--m-fast)",
                transform: open ? undefined : "rotate(-90deg)",
              }}
            />
            <span className="truncate">{group.heading}</span>
            {/* The group holding the current page cannot be folded away under the reader, so it
                says why it will not close rather than appearing to ignore the click. */}
            {!opened.includes(group.heading as string) && (holdsCurrentPage || holdsNext) && (
              <span className="ml-auto shrink-0 font-normal normal-case">
                {holdsCurrentPage ? "here" : "next"}
              </span>
            )}
          </button>
        ))}

      {open &&
        rows.map(({ item, href }) => (
          <NavRow
            key={item.label}
            item={item}
            href={href}
            active={pathname === href}
            next={href === nextHref}
            collapsed={collapsed}
            /*
              Steps in a stage this project does not run: dimmed and labelled, never removed. The
              overview sets the same steps aside under a disclosure and says why; a sidebar that
              deleted them would disagree with the page beside it, and would strand a project whose
              stages were entered wrongly with no way back to the step it needs. Still a link.

              `withinStages` is true for anything with no phase — Project Corpus, Project Data,
              Project Details are places a project *has*, not stages it runs.
            */
            outside={stages !== undefined && !withinStages(item.href, stages)}
          />
        ))}
    </div>
  );
}

/**
 * The mark for a nav row.
 *
 * ── Why `createElement` and not `const Icon = iconFor(href)` ───────────────────────────────
 *
 * Collapsed, a row used to render `item.label.slice(0, 2)` — a rail reading "Da / Pr / Ap / Ra".
 * §4.1 treats the 56px rail as a first-class state, and a rail only works if each row carries a
 * mark somebody recognises without reading it. So every row looks its icon up by href.
 *
 * Binding that lookup to a capitalised local inside a component body is what
 * `react-hooks/static-components` refuses, and it is right to: a component *value* computed during
 * render is a new type on every pass as far as React is concerned, and state inside it would reset.
 * These icons hold no state, so nothing breaks today — but the rule guards a real hazard and the
 * way round it costs one line. Calling `createElement` names no component at all.
 */
const mark = (href: string, className: string) =>
  createElement(iconFor(href), {
    "aria-hidden": true,
    size: 15,
    strokeWidth: 1.75,
    className,
  });

/**
 * One row: a link, or a dimmed placeholder for work that is not built.
 *
 * Two states are marked here and neither is carried by colour alone (§7.1 #5). *Not built* says
 * "soon"; *not in this project's stages* says "off stage". Dimming alone would make them the same
 * thing to look at, and they are not — one is a gap in the platform, the other is a decision this
 * project made.
 */
function NavRow({
  item,
  href,
  active,
  next,
  collapsed,
  outside,
}: {
  item: NavGroup["items"][number];
  href: string;
  active: boolean;
  /** The step the overview says to open next. Marked in words, not colour (§7.1 #5). */
  next: boolean;
  collapsed: boolean;
  outside: boolean;
}) {
  const shared = `t-base flex min-h-[30px] items-center gap-2.5 rounded-[var(--r-sm)] py-1.5 ${
    collapsed ? "justify-center px-0" : "px-2"
  }`;

  // §7.7 — never send someone to a page that does not exist and let a 404 explain it. Unbuilt
  // items are present, dimmed and labelled rather than hidden: hiding them would imply the
  // platform does not cover the work at all, which is the more misleading of the two.
  if (!item.built) {
    return (
      <span
        title={collapsed ? `${item.label} — not built yet` : "Not built yet"}
        // `--n-500` on the sidebar's `--n-50` measures 4.45:1 — under AA by a rounding error,
        // which is still under it. `--n-600` is 7.1:1 and still reads as quieter than a row you
        // can click.
        className={`${shared} cursor-default text-[var(--n-600)]`}
      >
        {mark(item.href, "shrink-0")}
        {!collapsed && <span className="truncate">{item.label}</span>}
        {!collapsed && <span className="t-xs ml-auto shrink-0">soon</span>}
      </span>
    );
  }

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      data-outside={outside || undefined}
      title={
        outside ? `${item.label} — not in this project's stages` : collapsed ? item.label : undefined
      }
      className={`${shared} transition-colors ${
        active
          ? "bg-[var(--a-50)] font-medium text-[var(--a-700)]"
          : outside
            ? "text-[var(--n-500)] hover:bg-[var(--n-100)] hover:text-[var(--n-700)]"
            : "text-[var(--n-800)] hover:bg-[var(--n-100)] hover:text-[var(--n-900)]"
      }`}
      style={{ transitionDuration: "var(--m-fast)" }}
    >
      {mark(item.href, `shrink-0 ${active ? "text-[var(--a-600)]" : "text-[var(--n-600)]"}`)}
      {!collapsed && <span className="truncate">{item.label}</span>}
      {!collapsed && outside && (
        <span className="t-xs ml-auto shrink-0 text-[var(--n-500)]">off stage</span>
      )}
      {!collapsed && next && !active && !outside && (
        <span data-next className="t-xs ml-auto shrink-0 font-medium text-[var(--a-700)]">
          next
        </span>
      )}
    </Link>
  );
}
