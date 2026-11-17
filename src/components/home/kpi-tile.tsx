/**
 * The KPI tile — PLATFORM.md §7.2, §7.5, §7.10 #11.
 *
 * Label at `--t-sm` in `--n-500`, figure at `--t-2xl` tabular, a line of context under it, in a
 * 16px card with a border rather than a shadow (§7.2 — "prefer borders to shadows for structure").
 *
 * ── Two things taken from the reference build and two deliberately not ─────────────────────
 *
 * The shape is the Mzilikazi dashboard's: four tiles across the top, each a label, a big number and
 * a line of context. What is not taken is its palette — `bg-blue-100`, `text-green-600`,
 * `bg-purple-100`, `bg-orange-100`, one per tile — because §7.1 #5 says **colour means exactly one
 * thing**, and four tiles wearing four colours for no reason other than being four makes green mean
 * "second tile" on a screen where green already means approved. Its icons are here, all in
 * `--n-400`: an icon is a landmark for scanning, and it costs nothing to say so quietly.
 *
 * ── The tile is a link, and that is the requirement rather than a nicety ───────────────────
 *
 * §1.3.1: a figure that cannot be traced is worse than a gap, because it survives review looking
 * checked. So the whole card is one anchor to the signed run the figure came from, and the trace
 * line names where that goes before it is clicked. Nothing inside it is a second anchor — an
 * anchor inside an anchor is invalid, React says so in the console, and `watchConsole` in the
 * browser suites fails on exactly that class of warning.
 *
 * ── An absence does not get to look like a figure ──────────────────────────────────────────
 *
 * A tile with nothing signed behind it renders its absence at `--t-lg` in `--n-400`, not at
 * `--t-2xl` in `--n-800`. Nought is never used to stand in for "not established": one is a scheme
 * that costs nothing and the other is a figure nobody has approved, and at a glance across a room
 * they must not be the same shape on the screen.
 */

import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";

export interface KpiTileProps {
  label: string;
  icon: LucideIcon;
  /** The figure, formatted. Null renders the absence below instead. */
  figure: string | null;
  /** What the figure is made of when there is one, or what is missing when there is not. */
  note: string;
  /** Where the trace goes, and what a reader is being offered before they click. */
  trace: { href: string; label: string };
  /** The absence headline. Required, because every tile must be able to say it has nothing. */
  absent: string;
  /** §7.2's semantic roles. Applied to the figure only, and never without the words beside it. */
  tone?: "ok" | "warn";
}

/**
 * A nine-figure rand amount does not fit at 28px in a quarter-width tile.
 *
 * `R 372 840 000,00` is sixteen characters, and a tile at the 1280px design target is about 210px
 * of content. §7.2 names `--t-2xl` for KPI numbers, so the long case steps **down the same scale**
 * to `--t-xl` rather than inventing a size or letting the figure wrap. Wrapping was the alternative
 * and it is worse: the currency mark ends up alone on the first line with the figure beneath it,
 * which reads as two things rather than one.
 *
 * Shortening the figure instead — the reference build renders `R 372,8M` — is not available here.
 * This tile traces to a signed total, and a rounded version of a figure somebody put their name to
 * is a different number from the one they signed.
 */
const LONG_FIGURE = 13;

export function KpiTile({ label, icon: Icon, figure, note, trace, absent, tone }: KpiTileProps) {
  const size = figure !== null && figure.length > LONG_FIGURE ? "t-lg" : "t-2xl";

  return (
    <Link
      href={trace.href}
      data-kpi={label}
      data-figure={figure === null ? "absent" : "signed"}
      title={`${note} — ${trace.label}`}
      className="group flex min-w-0 flex-col rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] p-3.5 transition-colors hover:border-[var(--a-300)] hover:shadow-[var(--e-1)]"
      style={{ transitionDuration: "var(--m-fast)" }}
    >
      {/*
        Chip, label and arrow share the top row, so the figure and its note below get the tile's
        full width. They used to sit in a column beside the chip and the arrow, which took about
        100px of a ~250px tile. At the narrower widths the band reaches, that clipped the label to
        "COST PER …" (two tiles reading the same) and pushed a signed figure past the card's edge.
      */}
      <span className="flex items-center gap-2">
        {/*
          The icon in a chip, as the reference build has it – it is what gives a row of four the
          rhythm of a KPI band rather than four paragraphs in boxes.

          **One neutral chip, not four coloured ones.** The reference uses blue, green, purple and
          orange, and §7.1 #5 allows colour exactly one meaning: the semantic roles in §7.2. Four
          decorative hues would spend the palette on making cards look distinct from each other, and
          then amber on this page would mean "attention" in one place and "the third card" in another.
        */}
        <span className="grid size-7 shrink-0 place-items-center rounded-[var(--r-md)] bg-[var(--n-100)] transition-colors group-hover:bg-[var(--a-50)]">
          <Icon
            aria-hidden
            size={14}
            strokeWidth={1.75}
            className="text-[var(--n-500)] transition-colors group-hover:text-[var(--a-600)]"
          />
        </span>

        <span className="t-sm min-w-0 flex-1 truncate tracking-[0.03em] text-[var(--n-500)] uppercase">
          {label}
        </span>

        <ArrowRight
          aria-hidden
          size={13}
          strokeWidth={2}
          className="shrink-0 text-[var(--n-300)] transition-all group-hover:translate-x-0.5 group-hover:text-[var(--a-600)]"
          style={{ transitionDuration: "var(--m-fast)" }}
        />
      </span>

      <span className="mt-2 min-w-0">
        {figure === null ? (
          <span className="t-lg block text-[var(--n-400)]">{absent}</span>
        ) : (
          <span
            className={`num ${size} block leading-tight whitespace-nowrap ${
              tone === "ok"
                ? "text-[var(--ok-700)]"
                : tone === "warn"
                  ? "text-[var(--warn-700)]"
                  : "text-[var(--n-800)]"
            }`}
          >
            {figure}
          </span>
        )}

        {/*
          Two lines, not a paragraph, and the whole of it on the card's `title`.
          This was three or four lines of prose plus a footer link, which made a tile taller than
          the table underneath it — four cards saying, at length, that a figure had not been signed
          yet. §7.1: density over whitespace, screen space is for data.
        */}
        <span className="t-xs mt-1 line-clamp-2 text-[var(--n-500)]">{note}</span>
      </span>
    </Link>
  );
}
