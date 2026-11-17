/**
 * Home — where signing in lands: the practice's projects, what each is waiting on, and the ad hoc
 * requests.
 *
 * ── One front page, not two ────────────────────────────────────────────────────────────────
 *
 * Until 16 Nov 2026 there were two: an Overview that was mostly the practice's brochure (service
 * lines, areas of expertise, vision and mission, a "coming to the platform" list) and a Portfolio
 * dashboard that sign-in actually landed on. A first-time reader met two dashboards and a
 * corporate page before any work. The practice already has a website; this page is for the work,
 * so it is the dashboard – every figure signed, every gap naming the step that fills it – with the
 * two ways work arrives beside it: "Add project" in the header, and the ad hoc requests card (which
 * carries its own "New request" button).
 *
 * The first-visit walkthrough, with the guide assistant inline, is one click away ("How this works",
 * `/start`). The assistant is not a panel here: beside a sidebar it left the projects table too
 * narrow for its own column headers at 1024px, and this page is read every morning by people who
 * no longer need the guide. A project's advisor is on every project page.
 */

import Link from "next/link";
import { Compass } from "lucide-react";

import { requireSession } from "@/lib/auth";
import { loadAdhocRows } from "@/lib/adhoc-load";
import { Dashboard } from "@/components/home/dashboard";
import { AdhocList } from "@/components/adhoc/adhoc-list";
import { NewProjectDialog } from "@/components/projects/new-project-dialog";

/**
 * QS staff open Home to find their next job; the practice's value, rates per m² and stage counts are
 * an executive's question (user, 17 Nov 2026). So the QS view is the default and the figures are one
 * click away. In the URL rather than a cookie: a link to the executive view can be sent to a partner,
 * and nothing about a person's account changes what they are allowed to see.
 */
export default async function HomePage({ searchParams }: PageProps<"/">) {
  await requireSession();
  const view = (await searchParams).view === "executive" ? "executive" : "qs";
  const adhoc = await loadAdhocRows();
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="min-w-0 flex-1">
      <Dashboard
        title="Home"
        view={view}
        actions={
          <>
            <ViewToggle view={view} />
            <Link
              href="/start"
              data-action="how-this-works"
              className="t-sm flex h-8 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--a-100)] bg-[var(--a-50)] px-3 font-medium text-[var(--a-700)] hover:border-[var(--a-500)]"
            >
              <Compass aria-hidden size={14} strokeWidth={2} />
              How this works
            </Link>
            <NewProjectDialog />
          </>
        }
      >
        <AdhocList rows={adhoc} today={today} limit={4} />
      </Dashboard>
    </div>
  );
}

/** Two links that read as one control – the current view marked for the eye and for a reader. */
function ViewToggle({ view }: { view: "qs" | "executive" }) {
  const options = [
    { key: "qs", label: "QS view", href: "/" },
    { key: "executive", label: "Executive view", href: "/?view=executive" },
  ] as const;

  return (
    <nav aria-label="Home view" data-region="home-view" className="flex h-8 items-center rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] p-0.5">
      {options.map((option) => {
        const current = option.key === view;
        return (
          <Link
            key={option.key}
            href={option.href}
            data-view={option.key}
            aria-current={current ? "page" : undefined}
            className={`t-sm flex h-full items-center rounded-[var(--r-sm)] px-2.5 font-medium transition-colors ${
              current ? "bg-[var(--a-50)] text-[var(--a-700)]" : "text-[var(--n-600)] hover:text-[var(--n-800)]"
            }`}
          >
            {option.label}
          </Link>
        );
      })}
    </nav>
  );
}
