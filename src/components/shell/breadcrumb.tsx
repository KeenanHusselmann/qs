/**
 * Breadcrumb — PLATFORM.md §4.1.
 *
 * ── This says where you are. It does not navigate. ─────────────────────────────────────────
 *
 * The back button beside it is the control you click; this is the label that tells you which page
 * you are on and what it sits inside. Deliberately not links: two clickable things side by side,
 * both offering to move you upward, is what made the old pairing ambiguous — a reader had to work
 * out which of them did what. One control, one job.
 *
 * ── Naming the project ─────────────────────────────────────────────────────────────────────
 *
 * The middle crumb is the project's **name**, not "Project" and never its uuid. A trail that reads
 * "Projects / Project / Project inputs" is three words that locate nothing. The name is published
 * by the project layout through `@/lib/open-project`, because the crumb renders above the tree that
 * knows it.
 */

"use client";

import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";

import { getServerSnapshot, getSnapshot, subscribe } from "@/lib/open-project";
import { PLATFORM_NAV, PROJECT_NAV } from "@/lib/navigation";

const PLATFORM_LABELS = new Map(
  PLATFORM_NAV.flatMap((g) => g.items)
    .filter((i) => i.href)
    .map((i) => [i.href, i.label] as const),
);

/** Project-relative routes: "" is the overview, "/settings" the project's own settings. */
const PROJECT_LABELS = new Map(
  PROJECT_NAV.flatMap((g) => g.items).map((i) => [i.href, i.label] as const),
);

const SECTIONS: Record<string, string> = { settings: "Settings" };

const titleise = (segment: string) =>
  segment.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

function crumbsFor(pathname: string, project: { id: string; name: string } | null): string[] {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return [PLATFORM_LABELS.get("/") ?? "Home"];

  // ── Inside a project: Projects / {name} / {module} ─────────────────────────────────────
  if (segments[0] === "projects" && segments.length >= 2) {
    const id = segments[1]!;
    const trail: string[] = ["Projects"];

    // Until the layout has published, the name is unknown — better a neutral word than a uuid.
    const name = project?.id === id ? project.name : "Project";

    trail.push(name);
    if (segments.length === 2) return trail;

    const tail = `/${segments.slice(2).join("/")}`;
    trail.push(PROJECT_LABELS.get(tail) ?? titleise(segments[segments.length - 1]!));
    return trail;
  }

  const exact = PLATFORM_LABELS.get(pathname);
  if (exact) return [exact];

  return segments.map((segment, i) => {
    const path = `/${segments.slice(0, i + 1).join("/")}`;
    return PLATFORM_LABELS.get(path) ?? SECTIONS[segment] ?? titleise(segment);
  });
}

export function Breadcrumb() {
  const pathname = usePathname();
  const project = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const crumbs = crumbsFor(pathname, project);

  return (
    <nav aria-label="Breadcrumb" className="t-base flex min-w-0 items-center gap-1.5">
      {crumbs.map((crumb, i) => {
        const last = i === crumbs.length - 1;

        return (
          <span key={`${crumb}-${i}`} className="flex min-w-0 items-center gap-1.5">
            {i > 0 && (
              <span aria-hidden className="shrink-0 text-[var(--n-300)]">
                /
              </span>
            )}
            <span
              aria-current={last ? "page" : undefined}
              className={`truncate ${last ? "font-medium text-[var(--n-800)]" : "text-[var(--n-500)]"}`}
            >
              {crumb}
            </span>
          </span>
        );
      })}
    </nav>
  );
}
