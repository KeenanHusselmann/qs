"use client";

/**
 * The chrome every assistant on this platform wears — the edge tab, and the panel it opens into.
 *
 * ── Why it is shared ───────────────────────────────────────────────────────────────────────
 *
 * There are two assistants: the project advisor, and the guide on the overview for somebody who
 * has no project yet. They answer different questions from different sources, but a reader should
 * not have to learn two affordances to reach them — the tab is in the same place, the same colour,
 * and remembers the same open state, so opening one on a project and navigating to the overview
 * finds the other already open.
 *
 * The tab's contrast reasoning lives here rather than in two copies that would drift. It was white
 * on the --n-50 canvas with an --n-200 border, which measures **1,19:1** — its *label* was legible
 * at 11,31:1 and the tab itself was not findable, which is a different defect needing a different
 * fix. Filling it takes the edge to **4,87:1** against the canvas.
 *
 * The blue is `--ai-*`, the platform's one "this is the machine speaking" colour. See globals.css
 * for what it means and why it is allowed to exist under §7.1 #5.
 *
 * ── In its own column, through a portal ────────────────────────────────────────────────────
 *
 * The panel is rendered by the page (the project layout, the overview) but shown in the column the
 * app layout keeps beside `<main>` (`ASSISTANT_SLOT_ID`). Inside the page it sat under the Back
 * button row and the page padding, a strip of canvas above it that was reported as a gap, and it
 * needed sticky positioning and measured heights to stay on screen. In its own column it starts
 * flush under the top bar, is the full height by construction, and does not scroll with the page.
 *
 * ── The closed tab takes its own width ─────────────────────────────────────────────────────
 *
 * It was `position: fixed` at the right edge, on top of whatever lay there. At 1440 that was the
 * bill's row-action column: `elementFromPoint` over row 1.1's Omit returned the tab, so a QS striking
 * a row out opened the advisor instead — and the natural second attempt clicks the same place. So
 * the closed state is a narrow sticky column in the row, the same flow the open panel uses: the page
 * gives up 28px and nothing can ever sit underneath the tab.
 */

import type { ReactNode } from "react";
import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ChevronsRight, Maximize2, Minimize2, SquarePen, Zap } from "lucide-react";

import { AdvisorMark } from "@/components/shell/advisor-mark";

import {
  getServerSnapshot,
  getSnapshot,
  setOpen,
  subscribe,
} from "@/components/project/advisor-state";
import { ASSISTANT_SLOT_ID } from "@/components/shell/assistant-slot";

const noSubscription = () => () => {};
/** The column to render into — absent on the server, and on any page outside the app layout. */
const findSlot = () => document.getElementById(ASSISTANT_SLOT_ID);
const noSlotOnServer = () => null;

export function AssistantPanel({
  /** What the tab and the header call it. */
  label,
  /** The tab's tooltip — what a reader gets by opening it. */
  offer,
  /** For the suites, and so the two assistants are distinguishable in the DOM. */
  region,
  /**
   * Offer a wider panel. A conversation with explanations, sources and attachments does not fit a
   * 340px column; the bill beside it usually needs its width, so wide is a choice, not the default.
   */
  expandable = false,
  /** One line under the title: what this assistant is for, or which project it is on. */
  subtitle,
  /** Start a new conversation. Offered only while there is one to clear. */
  onReset,
  children,
}: {
  label: string;
  offer: string;
  region: string;
  expandable?: boolean;
  subtitle?: string;
  onReset?: () => void;
  children: ReactNode;
}) {
  const open = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [wide, setWide] = useState(false);

  const slot = useSyncExternalStore(noSubscription, findSlot, noSlotOnServer);

  // In the column when there is one; in place otherwise, so the panel still works anywhere.
  const place = (node: ReactNode) => (slot ? createPortal(node, slot) : node);

  if (!open) {
    return place(
      <div
        data-region={`${region}-gutter`}
        className="flex h-full w-7 shrink-0 items-center justify-end"
      >
        <button
          type="button"
          data-region={`${region}-tab`}
          onClick={() => setOpen(true)}
          title={offer}
          className="flex items-center gap-1.5 rounded-l-[var(--r-md)] bg-[var(--ai-500)] py-3 pr-1.5 pl-1.5 shadow-[var(--e-1)] transition-colors hover:bg-[var(--ai-600)]"
          style={{ transitionDuration: "var(--m-fast)" }}
        >
          <span className="flex flex-col items-center gap-1.5">
            <AdvisorMark size={17} strokeWidth={1.9} className="text-white" />
            <span className="t-xs font-medium text-white [writing-mode:vertical-rl]">{label}</span>
          </span>
        </button>
      </div>,
    );
  }

  return place(
    <aside
      data-region={region}
      aria-label={label}
      data-wide={wide}
      className={`flex h-full shrink-0 flex-col overflow-hidden border-l border-[var(--n-200)] bg-[var(--n-50)] ${
        wide ? "w-[min(640px,42vw)]" : "w-[340px]"
      }`}
    >
      <header className="flex shrink-0 items-center gap-2.5 border-b border-[var(--n-200)] bg-[var(--n-0)] py-2.5 pr-2 pl-3.5">
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--ai-500)] text-white shadow-[var(--e-1)]"
        >
          <AdvisorMark size={19} strokeWidth={1.9} />
        </span>
        <span className="min-w-0 flex-1">
          <h2 className="t-base leading-tight font-semibold text-[var(--n-800)]">{label}</h2>
          {subtitle && <span className="t-xs block truncate text-[var(--n-500)]">{subtitle}</span>}
        </span>

        {/*
          Fixed in the header of every assistant (November meeting): back to the ad hoc requests
          from wherever the conversation is, without hunting through Projects or the menu.
        */}
        <Link
          href="/my-work#adhoc"
          data-action="adhoc-requests"
          aria-label="Ad hoc requests"
          title="Ad hoc requests"
          className="grid size-8 shrink-0 place-items-center rounded-[var(--r-md)] text-[var(--n-500)] transition-colors hover:bg-[var(--n-100)] hover:text-[var(--n-900)]"
          style={{ transitionDuration: "var(--m-fast)" }}
        >
          <Zap aria-hidden size={15} strokeWidth={1.75} />
        </Link>
        {onReset && (
          <HeaderButton label="New conversation" action="new-conversation" onClick={onReset}>
            <SquarePen aria-hidden size={15} strokeWidth={1.75} />
          </HeaderButton>
        )}
        {expandable && (
          <HeaderButton
            label={wide ? `Narrow the ${label.toLowerCase()}` : `Widen the ${label.toLowerCase()}`}
            action="widen"
            pressed={wide}
            onClick={() => setWide(!wide)}
          >
            {wide ? (
              <Minimize2 aria-hidden size={15} strokeWidth={1.75} />
            ) : (
              <Maximize2 aria-hidden size={15} strokeWidth={1.75} />
            )}
          </HeaderButton>
        )}
        <HeaderButton label={`Close the ${label.toLowerCase()}`} onClick={() => setOpen(false)}>
          <ChevronsRight aria-hidden size={17} strokeWidth={1.75} />
        </HeaderButton>
      </header>

      {children}
    </aside>,
  );
}

function HeaderButton({
  label,
  action,
  pressed,
  onClick,
  children,
}: {
  label: string;
  action?: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-action={action}
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className="grid size-8 shrink-0 place-items-center rounded-[var(--r-md)] text-[var(--n-500)] transition-colors hover:bg-[var(--n-100)] hover:text-[var(--n-900)]"
      style={{ transitionDuration: "var(--m-fast)" }}
    >
      {children}
    </button>
  );
}
