import { notFound } from "next/navigation";

import { AdvisorPanel } from "@/components/project/advisor-panel";
import { ArchivedBanner } from "@/components/project/archived-banner";
import { OpenProjectPublisher } from "@/components/shell/open-project-publisher";
import { getProject } from "../actions";

/**
 * Wraps every page inside a project.
 *
 * Names the open project for the breadcrumb — fetched here rather than in each page, so the crumb
 * reads the same on Overview, Site & zoning and Project settings without four pages each
 * remembering to say so.
 *
 * ── And it carries the advisor ─────────────────────────────────────────────────────────────
 *
 * Here rather than on the overview, because "what should I do next" is a question somebody has
 * while they are in the middle of a step, not only when they are looking at a summary of all of
 * them. It reads the project's position from the server on demand, so being present on every
 * screen costs nothing until it is asked.
 *
 * The row is the layout: the page scrolls in its own column and the panel keeps its width beside
 * it. Absolutely positioning it over the content instead would put a panel on top of the bill,
 * which is the one screen that cannot spare the columns.
 */
export default async function ProjectLayout({
  params,
  children,
}: LayoutProps<"/projects/[id]">) {
  const { id } = await params;

  const project = await getProject(id);
  if (!project) notFound();

  return (
    <div className="flex min-h-0 flex-1 items-start">
      <OpenProjectPublisher id={id} name={project.name} />
      <div className="min-w-0 flex-1">
        {project.status === "archived" && <ArchivedBanner projectId={id} />}
        {children}
      </div>
      <AdvisorPanel projectId={id} projectName={project.name} />
    </div>
  );
}
