/**
 * A section in a box — PLATFORM.md §7.2, and the one shape a section has here.
 *
 * ── Why the sections needed containers ─────────────────────────────────────────────────────
 *
 * They were headings with content under them, floating on one white field. Four of those read as
 * one long page rather than four things, and "everything is random" is the correct description of a
 * screen where nothing tells you where one idea stops and the next begins.
 *
 * §7.2: **prefer borders to shadows for structure.** So a rule and a header strip, not a drop
 * shadow — the reference build reaches for `<Card>` here and gets the same result a different way.
 *
 * The count in the header is the panel earning its space: a reader can tell whether a section is
 * worth opening without reading it.
 *
 * ── Why it lives in the shell rather than on the dashboard ─────────────────────────────────
 *
 * It was written for the dashboard and then written again on the main page, whose copy says in as
 * many words that it is *"the dashboard's language, kept"*. A third was about to be written for the
 * module pages, which is the point at which a copied component becomes a divergence waiting to
 * happen: §2.5 asks for one way to do things, and this is a shape rather than one page's detail.
 *
 * The main page keeps its own variant for now. It differs in how the count and the action render,
 * both settled and both measured, and reconciling them is a design decision about that screen
 * rather than part of giving the module pages a shape.
 */

import Link from "next/link";

export function Panel({
  title,
  count,
  tone,
  action,
  flush,
  children,
}: {
  title: string;
  /** What the section holds, said in the header so the body need not repeat it. */
  count?: string;
  tone?: "warn";
  action?: { href: string; label: string };
  /**
   * Drop the body padding.
   *
   * A table's cells and a list's rows already have their own, and the hover band on a row should
   * reach the panel's edge — inset by sixteen pixels it reads as a floating stripe rather than as
   * the row being pointed at.
   */
  flush?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-0)]">
      {/*
        The header strip is the panel's own band of shade — `--n-25` against `--n-0` is a
        difference of three values and did not survive a laptop screen at an angle. A section
        that wants attention wears `--warn-50`, which is §7.2's amber doing the one job it is
        allowed: the count beside it says the same thing in words, so nothing rests on the tint
        being seen.
      */}
      <header
        className={`flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5 ${
          tone === "warn"
            ? "border-[var(--warn-500)]/20 bg-[var(--warn-50)]"
            : "border-[var(--n-200)] bg-[var(--n-50)]"
        }`}
      >
        <h2 className="t-base font-semibold text-[var(--n-800)]">{title}</h2>
        {count && (
          <span
            className={`t-xs rounded-[var(--r-full)] px-2 py-0.5 font-medium ${
              tone === "warn"
                ? "bg-[var(--warn-500)]/15 text-[var(--warn-700)]"
                : "bg-[var(--n-200)] text-[var(--n-600)]"
            }`}
          >
            {count}
          </span>
        )}
        {action && (
          <Link
            href={action.href}
            className="t-sm ml-auto shrink-0 text-[var(--a-600)] hover:underline"
          >
            {action.label}
          </Link>
        )}
      </header>
      <div className={`min-w-0 ${flush ? "" : "px-4 py-3"}`}>{children}</div>
    </section>
  );
}
