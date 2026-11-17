/**
 * ⌘K — PLATFORM.md §4.1, §7.1, §7.3.
 *
 * The search button in the top bar was `disabled` with the title "not built yet", and §4.1's
 * project switcher was not there at all. This is both, because they are one control: a QS with
 * forty jobs wants to type three letters and be in the right one, not open a dropdown.
 *
 * ── Why <dialog>, again ────────────────────────────────────────────────────────────────────
 *
 * The reasons `new-project-dialog.tsx` already records: focus is trapped, Escape closes, focus
 * returns to whatever opened it, it renders in the top layer so no z-index in §7.2 can bury it,
 * and it is announced as a dialog without a single aria attribute. `showModal()` also makes the
 * page behind it inert, so arrow keys cannot wander into a grid.
 *
 * ── The keyboard is the point ──────────────────────────────────────────────────────────────
 *
 * §7.1 #3: keyboard first, every frequent action has a shortcut. Opening a project is the most
 * frequent action in the product. Arrows move, Enter goes, Escape leaves, and the highlighted row
 * is kept in view rather than scrolling away under the arrows.
 */

"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Building2, CornerDownLeft, FolderOpen, Search, SquareStack } from "lucide-react";

import {
  buildCommands,
  rankCommands,
  type Command,
  type SearchableProject,
} from "@/lib/command-search";
import { getServerSnapshot, getSnapshot, subscribe } from "@/lib/open-project";

const ICON = { project: FolderOpen, module: SquareStack, place: Building2 } as const;

export function CommandPalette({ projects }: { projects: readonly SearchableProject[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  // Which project is open lives outside React's tree — the top bar renders above the page that
  // knows it. The same store the breadcrumb reads, for the same reason.
  const openProject = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const commands = useMemo(() => buildCommands(projects, openProject), [projects, openProject]);
  const results = useMemo(() => rankCommands(commands, query), [commands, query]);

  // A shorter list can leave the selection past the end. Clamped rather than left to make Enter
  // silently do nothing.
  const selected = Math.min(active, Math.max(results.length - 1, 0));

  function open() {
    setQuery("");
    setActive(0);
    dialog.current?.showModal();
  }

  /**
   * ⌘K on a Mac, Ctrl+K everywhere else.
   *
   * Requiring the modifier is what keeps this out of the way of the grid: the bill has four hundred
   * editable cells and §7.4 gives them their own keyboard map, and a global shortcut that fired on
   * a bare keystroke would be the palette stealing input from the thing this product is for.
   */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      if (dialog.current?.open) dialog.current.close();
      else open();
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function go(command: Command | undefined) {
    if (!command) return;
    dialog.current?.close();
    router.push(command.href);
  }

  function keys(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = event.key === "ArrowDown" ? selected + 1 : selected - 1;
      // Wrapping: a list of twelve is short enough that running off the end and starting again is
      // quicker than reversing.
      setActive((next + results.length) % Math.max(results.length, 1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      go(results[selected]);
    }
  }

  // Keep the highlighted row in view when the arrows walk past the edge of the box.
  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selected, results.length]);

  return (
    <>
      <button
        type="button"
        onClick={open}
        data-open-palette
        title="Search projects and steps — Ctrl+K"
        className="t-sm flex h-8 items-center gap-2 rounded-[var(--r-sm)] border border-[var(--n-200)] px-2.5 text-[var(--n-500)] transition-colors hover:border-[var(--n-300)] hover:bg-[var(--n-50)]"
        style={{ transitionDuration: "var(--m-fast)" }}
      >
        <Search aria-hidden size={14} strokeWidth={1.75} />
        <span className="hidden lg:inline">Search</span>
        <kbd className="t-xs hidden rounded-[3px] border border-[var(--n-200)] bg-[var(--n-50)] px-1 font-sans lg:inline">
          ⌘K
        </kbd>
      </button>

      <dialog
        ref={dialog}
        data-region="palette"
        aria-label="Search projects and steps"
        onClose={() => setQuery("")}
        // The backdrop closes it; the panel below swallows its own clicks.
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current?.close();
        }}
        // `mx-auto` is not decoration: a <dialog> centres itself through `margin: auto`, and the CSS
        // reset zeroes it — so without this the palette renders hard against the top-left corner.
        // Measured, not assumed.
        className="mx-auto mt-[12vh] w-[min(560px,calc(100vw-2rem))] rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-0)] p-0 backdrop:bg-[var(--n-900)]/25"
      >
        <div className="flex items-center gap-2.5 border-b border-[var(--n-100)] px-4">
          <Search aria-hidden size={15} strokeWidth={1.75} className="shrink-0 text-[var(--n-400)]" />
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={keys}
            placeholder={openProject ? "Go to a step, or another project…" : "Go to a project…"}
            aria-label="Search"
            /*
              Inline, because the global `:focus-visible` outline is unlayered CSS and beats the
              `outline-none` utility – it drew a green ring around the input that ran past the edges
              of its row. The box is the only field in the dialog and holds the cursor from the
              moment it opens, so the caret is the focus indicator it needs.
            */
            style={{ outline: "none" }}
            className="t-md h-12 min-w-0 flex-1 bg-transparent placeholder:text-[var(--n-400)]"
          />
          <kbd className="t-xs shrink-0 rounded-[3px] border border-[var(--n-200)] bg-[var(--n-50)] px-1 font-sans text-[var(--n-500)]">
            Esc
          </kbd>
        </div>

        {results.length === 0 ? (
          /* §7.5 — every list gets an empty state, and this one says which of the two absences it
             is: nothing matched, or there is nothing yet to match against. */
          <p data-region="palette-empty" className="t-sm px-4 py-6 text-center text-[var(--n-500)]">
            {openProject
              ? "Nothing matches that."
              : /*
                  With no project open there are no steps to match, and "nothing matches" read as
                  "this platform has no bill". Say which absence it is and how to get past it.
                */
                commands.some((command) => command.kind === "project")
                ? "Nothing matches that. A project’s steps — the bill, pricing, valuations — are offered once a project is open."
                : "Nothing matches that, and there are no projects yet. Add one from the Projects page."}
          </p>
        ) : (
          <ul ref={list} className="max-h-[46vh] overflow-y-auto py-1.5">
            {results.map((command, index) => {
              const Icon = ICON[command.kind];
              const on = index === selected;

              return (
                <li key={command.id}>
                  <button
                    type="button"
                    data-active={on}
                    data-kind={command.kind}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => go(command)}
                    className={`flex w-full items-center gap-3 px-4 py-2 text-left transition-colors ${
                      on ? "bg-[var(--a-50)]" : ""
                    }`}
                    style={{ transitionDuration: "var(--m-fast)" }}
                  >
                    <Icon
                      aria-hidden
                      size={14}
                      strokeWidth={1.75}
                      className={`shrink-0 ${on ? "text-[var(--a-600)]" : "text-[var(--n-400)]"}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="t-base block truncate text-[var(--n-800)]">
                        {command.label}
                      </span>
                      {command.hint && (
                        <span className="t-xs block truncate text-[var(--n-500)]">
                          {command.hint}
                        </span>
                      )}
                    </span>
                    {on && (
                      <CornerDownLeft
                        aria-hidden
                        size={13}
                        strokeWidth={2}
                        className="shrink-0 text-[var(--a-600)]"
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </dialog>
    </>
  );
}
