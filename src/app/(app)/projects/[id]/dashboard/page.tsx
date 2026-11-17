/**
 * A project's own dashboard.
 *
 * The same component the practice's dashboard uses, scoped to one project. Every figure on it — the
 * approved value, the cost per unit, the cost per m², what needs attention, what was signed — is
 * this project's and nothing else's.
 *
 * It used to be firm-wide only, which made it the wrong screen for the question a QS actually asks.
 * "What is the cost per unit" is a question about a scheme; averaged over a portfolio it describes
 * no scheme in it, the same way summed progress described no project. The practice still has its
 * view, and it is a roll-up rather than the primary place these figures live.
 *
 * The project's particulars – code, client, the stages it runs – sit here under the title rather than
 * on the overview, which is kept to the job card.
 */

import Link from "next/link";
import { notFound } from "next/navigation";

import { Dashboard } from "@/components/home/dashboard";
import { requireSession } from "@/lib/auth";
import { STAGES, stagesOf } from "@/lib/stages";
import { getProject } from "@/app/(app)/projects/actions";

export default async function ProjectDashboardPage({
  params,
}: PageProps<"/projects/[id]/dashboard">) {
  const { id } = await params;

  await requireSession();
  const project = await getProject(id);
  if (!project) notFound();

  const covered = stagesOf(project.stages);
  const narrowed = covered.length < STAGES.length;

  const details = (
    <div className="mt-1.5 flex flex-col gap-0.5">
      <p className="t-sm text-[var(--n-600)]">
        {[project.code, project.client].filter(Boolean).join(" · ") || "No client recorded"}
      </p>
      {/*
        Every figure on the project's screens is scoped to these, so they are named rather than left
        for somebody to infer. A project running the whole chain says so in one word.
      */}
      <p data-region="covers" className="t-sm text-[var(--n-600)]">
        <span className="text-[var(--n-500)]">Runs </span>
        {narrowed ? (
          STAGES.filter((s) => covered.includes(s.number)).map((stage, index) => (
            <span key={stage.number}>
              {index > 0 && <span className="text-[var(--n-300)]"> · </span>}
              <span className="font-medium text-[var(--n-800)]">{stage.name}</span>
            </span>
          ))
        ) : (
          <span className="font-medium text-[var(--n-800)]">every stage</span>
        )}
        <Link href={`/projects/${id}/settings`} className="t-xs ml-2 text-[var(--a-600)] hover:underline">
          Change
        </Link>
      </p>
    </div>
  );

  return <Dashboard project={{ id, name: project.name }} details={details} />;
}
