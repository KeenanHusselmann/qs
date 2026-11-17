/**
 * The app shell — PLATFORM.md §4.1, §7.3.
 *
 * ┌──────────────────────────────────────────────┐
 * │ Top bar                              56px    │
 * ├──────────┬───────────────────────────────────┤
 * │ Sidebar  │  Main content                     │
 * │ 240px    │  (fills)                          │
 * └──────────┴───────────────────────────────────┘
 *
 * Every authenticated page renders inside this. The 480px right drawer (§7.5) is not here yet —
 * it belongs to the first screen that shows record detail beside a list, and adding it now would
 * mean maintaining something nothing opens.
 *
 * The session is resolved once, here, rather than in each page: a page that forgot to check would
 * be a page served to anyone.
 */

import { ASSISTANT_SLOT_ID } from "@/components/shell/assistant-slot";
import { Sidebar } from "@/components/shell/sidebar";
import { TopBar } from "@/components/shell/top-bar";
import { requireSession } from "@/lib/auth";
import { unreadCount } from "@/lib/notifications";
import { listAdhocRequests, listArchivedProjects, listProjects } from "@/app/(app)/projects/actions";
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await requireSession();

  /*
    Read once for the whole shell, so ⌘K is instant and no page pays for it twice.

    Archived projects used to be left out — "the palette is for getting to work, not for the filing
    cabinet" — and a tester found what that cost: archiving made a project vanish from the list and
    the palette at once, with no way back but a URL. §6.3 is explicit that an archived project is
    "still readable, still citable, out of the working list", and out of the working list is not out
    of the building. They are searchable now, marked, and ranked after the live ones, which keeps
    the original reasoning without making finished work unreachable.
  */
  const [projects, archived, adhoc, unread] = await Promise.all([
    listProjects(),
    listArchivedProjects(),
    listAdhocRequests(),
    unreadCount(session.email).catch(() => 0),
  ]);

  /*
    ── `relative`, because an `overflow-hidden` that cannot clip is not a clip ──────────────
    `overflow-hidden` only clips descendants whose containing block is this element or one inside
    it. An absolutely-positioned descendant with no positioned ancestor resolves against the
    *initial* containing block instead, so it escapes the clip entirely — and every `sr-only`
    control in this app is `position: absolute`.

    With a run on screen there are twenty-odd hidden `input[type="file"]` upload controls down the
    criteria list. Each is 1px and invisible, and each sat at its static offset measured against
    the document: the deepest reached 2 723px on a 900px viewport, so `<html>` grew a scrollbar of
    its own beside `<main>`'s. Two scrollbars, and a screen of blank canvas below the app.

    Making the shell a containing block fixes the class rather than the twenty instances, and
    cannot regress when the twenty-first is added. It does not move the advisor tab: `position:
    fixed` still resolves against the viewport, because only a transform or filter changes that.
  */
  return (
    /*
      ── `overflow-clip`, not `overflow-hidden` ──────────────────────────────────────────────

      Both clip. Only `hidden` still leaves the element a scroll container that script can move:
      the shell's content is the page's full height (the hidden inputs above extend it to 2 862px
      on a 940px screen), so `scrollIntoView` on a run row or a focus on a field scrolled the shell
      itself by 28px. Sidebar, top bar and page all slid up together and a white band appeared under
      the app — reported with the advisor open, because its composer sits on the bottom edge. `clip`
      cannot be scrolled by anything, so `<main>` stays the only scroller.
    */
    <div className="relative flex h-dvh overflow-clip">
      {/*
        The sidebar needs the open project's stages to know which steps that project runs, and it
        sits above the project route so it cannot be handed them by the page. `listProjects()` is
        already read here for the palette and carries the column, so this costs nothing — the
        alternative was a second query in a layout that had just run the first.
      */}
      <Sidebar stages={Object.fromEntries(projects.map((p) => [p.id, p.stages]))} adhoc={adhoc.map((r) => r.id)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          unread={unread}
          email={session.email}
          projects={[
            ...projects.map((p) => ({
              id: p.id,
              name: p.name,
              code: p.code,
              client: p.client,
            })),
            // Ad hoc requests are found by name in ⌘K like any project. "Ad hoc" stands where a client
            // would, so the palette row says what it is.
            ...adhoc.map((r) => ({
              id: r.id,
              name: r.name,
              code: null,
              client: `Ad hoc${r.requestedBy ? ` · ${r.requestedBy}` : ""}`,
              archived: r.closedAt !== null,
            })),
            ...archived.map((p) => ({
              id: p.id,
              name: p.name,
              code: p.code,
              client: p.client,
              archived: true,
            })),
          ]}
        />
        {/*
          ── The canvas is tinted, and that is what makes a panel a panel ──────────────────
          White cards with hairline borders on a white field are borders, not cards: at arm's
          length the page reads as one continuous sheet with faint rules ruled across it. §7.2
          prefers borders to shadows for structure, and a border only reads as an edge when the
          two sides of it differ. So the ground is `--n-50` and everything that holds content is
          `--n-0` — the same one step of contrast the sidebar already uses against this main
          area, applied consistently rather than only in the chrome.
        */}
        {/*
          ── The assistant has its own column, beside `<main>` rather than inside it ─────────

          The advisor and the overview assistant were rendered inside the page, under the Back
          button row and the page's own top padding, so the panel started 20 to 52px below the top
          bar and a strip of canvas sat above it — reported as a gap to close. Every attempt to size
          a sticky panel inside a scrolling page chased that offset. A column of its own starts flush
          under the top bar, is the full height by construction, and never scrolls with the page.
          The panels render into it through a portal (`shell/assistant-panel.tsx`).
        */}
        <div className="flex min-h-0 flex-1">
          <main className="min-h-0 min-w-0 flex-1 overflow-auto bg-[var(--n-50)]">
            {/*
              No Back button. It sat above every page and repeated what the breadcrumb and the
              sidebar already offer; the owner called it redundant, and the space is the page's.
            */}
            {children}
          </main>
          <div id={ASSISTANT_SLOT_ID} className="flex min-h-0 shrink-0" />
        </div>
      </div>
    </div>
  );
}
