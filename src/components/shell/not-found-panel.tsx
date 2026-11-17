/**
 * An address that leads nowhere — and a way back from it.
 *
 * ── Why this exists ────────────────────────────────────────────────────────────────────────
 *
 * A mistyped URL, a bookmark to a step that was renamed, a colleague's pasted link to Approvals —
 * each got the framework's page: "404 · This page could not be found", with no sidebar and no link.
 * Every other screen here says where you are and offers the next move; this one stranded the reader
 * with the browser's back button, and to somebody not yet sure they are using the software properly
 * a blank 404 reads as "I broke it".
 *
 * So it says which absence it is. An address the nav lists as **not built yet** is named as such —
 * that is a gap in the platform, not a mistake by the reader (§7.7). Anything else is an address
 * that does not exist. Either way it offers the places a reader actually goes from: the project they
 * were in, if the address was inside one, and the projects list.
 *
 * Client-side because a not-found file receives no props, and the path is the only thing that tells
 * one absence from the other.
 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { PLATFORM_NAV, PROJECT_NAV } from "@/lib/navigation";

const PROJECT_PATH = /^\/projects\/([0-9a-f-]{36})(\/[^/]+)?/i;

/** What the reader asked for, as far as the path can say. Exported for its test. */
export function readMissing(pathname: string): { projectId: string | null; unbuilt: string | null } {
  const inProject = PROJECT_PATH.exec(pathname);

  if (inProject) {
    const step = inProject[2];
    const item = PROJECT_NAV.flatMap((g) => g.items).find((i) => i.href === step && !i.built);
    return { projectId: inProject[1], unbuilt: item?.label ?? null };
  }

  const item = PLATFORM_NAV.flatMap((g) => g.items).find((i) => i.href === pathname && !i.built);
  return { projectId: null, unbuilt: item?.label ?? null };
}

export function NotFoundPanel() {
  const pathname = usePathname() ?? "";
  const { projectId, unbuilt } = readMissing(pathname);

  return (
    <div data-region="not-found" className="mx-auto flex max-w-[640px] flex-col gap-4 px-8 py-16">
      <p className="t-xs font-semibold tracking-[0.03em] text-[var(--n-600)] uppercase">
        {unbuilt ? "Not built yet" : "Page not found"}
      </p>

      <h1 className="t-xl text-[var(--n-800)]">
        {unbuilt ? `${unbuilt} is not part of the platform yet` : "There is nothing at this address"}
      </h1>

      <p className="t-md text-[var(--n-600)]">
        {unbuilt
          ? `It is listed in the menu, greyed and marked “soon”, so the work it covers is visible — but there is no page behind it yet. Nothing you did caused this.`
          : "The link may be out of date, or the address mistyped. Nothing has been lost — every project and document is where it was."}
      </p>

      <p className="t-xs text-[var(--n-600)]">
        <code className="rounded-[var(--r-sm)] bg-[var(--n-100)] px-1.5 py-0.5 break-all">{pathname}</code>
      </p>

      <div className="mt-2 flex flex-wrap gap-2">
        {projectId && (
          <Link
            href={`/projects/${projectId}`}
            className="t-base flex h-8 items-center rounded-[var(--r-md)] bg-[var(--a-500)] px-3 font-medium text-white transition-colors hover:bg-[var(--a-600)]"
            style={{ transitionDuration: "var(--m-fast)" }}
          >
            Back to the project
          </Link>
        )}
        <Link
          href="/projects"
          className={`t-base flex h-8 items-center rounded-[var(--r-md)] px-3 font-medium transition-colors ${
            projectId
              ? "border border-[var(--n-200)] text-[var(--n-800)] hover:bg-[var(--n-100)]"
              : "bg-[var(--a-500)] text-white hover:bg-[var(--a-600)]"
          }`}
          style={{ transitionDuration: "var(--m-fast)" }}
        >
          All projects
        </Link>
        <Link
          href="/"
          className="t-base flex h-8 items-center rounded-[var(--r-md)] border border-[var(--n-200)] px-3 font-medium text-[var(--n-800)] transition-colors hover:bg-[var(--n-100)]"
          style={{ transitionDuration: "var(--m-fast)" }}
        >
          Main page
        </Link>
      </div>
    </div>
  );
}
