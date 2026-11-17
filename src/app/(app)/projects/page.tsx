import { AdhocRequestDialog } from "@/components/adhoc/adhoc-request-dialog";
import { NewProjectDialog } from "@/components/projects/new-project-dialog";
import { ProjectList, type ProjectListRow } from "@/components/projects/project-list";
import { loadPortfolio } from "@/lib/dashboard";
import { STATUS_LABEL } from "@/lib/project-status";
import { STAGES, stagesOf } from "@/lib/stages";
import { documentCounts, listArchivedProjects, listProjects } from "./actions";

/** The stages a project runs, in the fewest words that stay true. */
function stagesText(stored: readonly number[] | null): string {
  const covered = STAGES.filter((stage) => stagesOf(stored).includes(stage.number));
  if (covered.length === STAGES.length) return "Every stage";
  if (covered.length === 1) return covered[0].name;
  return `${covered[0].name} + ${covered.length - 1} more`;
}

/**
 * Projects — PLATFORM.md §4.4.
 *
 * A list and a way to add one. No wizard yet: §4.4 describes three steps, and two of them collect
 * contract terms and sections that nothing reads. Asking for them now would be a form for its own
 * sake — they arrive with the modules that need them.
 */
export default async function ProjectsPage() {
  const [projects, archived, counts, portfolio] = await Promise.all([
    listProjects(),
    listArchivedProjects(),
    documentCounts(),
    // Test projects are still projects: listed here, left out of Home and Benchmarks.
    loadPortfolio(undefined, { includeTest: true }),
  ]);

  const tracked = new Map(portfolio.projects.map((row) => [row.id, row]));

  const rows: ProjectListRow[] = projects.map((project) => {
    const row = tracked.get(project.id);
    return {
      id: project.id,
      name: project.name,
      code: project.code,
      client: project.client,
      status: STATUS_LABEL[project.status],
      stages: stagesText(project.stages),
      documents: counts.get(project.id) ?? 0,
      signed: row?.signedSteps ?? 0,
      signable: portfolio.signableSteps,
      attention: row?.flags.length ?? 0,
      test: project.isTest,
    };
  });

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-6">
      {/* The action sits with the heading: adding a project is rare, opening one is constant, so
          the list gets the page and the form gets a button. */}
      <div className="flex items-center justify-between gap-4">
        <h1 className="t-xl text-[var(--n-800)]">Projects</h1>
        <div className="flex items-center gap-2">
          {/* Beside "Add project" (November meeting): the same start, without the project setup. */}
          <AdhocRequestDialog />
          {projects.length + archived.length > 0 && <NewProjectDialog />}
        </div>
      </div>

      {projects.length + archived.length === 0 ? (
        // §7.5 — every empty list says what goes there and offers the action.
        <div className="mt-6 rounded-[var(--r-lg)] border border-dashed border-[var(--n-200)] px-6 py-8 text-center">
          <h2 className="t-lg text-[var(--n-800)]">No projects yet</h2>
          <p className="t-md mx-auto mt-1 max-w-[46ch] text-[var(--n-500)]">
            A project is the container everything else hangs from — documents, estimates, bills and
            certificates all belong to one.
          </p>
          {/* On an empty page the only action belongs in the middle of it, not tucked up in a
              corner beside a heading that has nothing under it. */}
          <NewProjectDialog trigger="empty-state" />
        </div>
      ) : (
        /*
          Archived projects are the same list's filed section, under the same filter – a tester
          could not find one by its exact name while the filter read only the working list. §6.3:
          archived is a status, not a deletion.
        */
        <ProjectList
          rows={rows}
          archived={archived.map((project) => ({
            id: project.id,
            name: project.name,
            code: project.code,
            client: project.client,
            documents: counts.get(project.id) ?? 0,
          }))}
        />
      )}

    </div>
  );
}
