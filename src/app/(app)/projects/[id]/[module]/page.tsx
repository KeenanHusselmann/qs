import Link from "next/link";
import { notFound } from "next/navigation";

import { inAdhocScope } from "@/lib/adhoc";

import { ModulePage } from "@/components/project/module-page";
import { ProjectCorpus } from "@/components/project/project-corpus";
import { Pricing } from "@/components/pricing/pricing";
import { ProjectSettings } from "@/components/projects/project-settings";
import { getProject } from "@/app/(app)/projects/actions";
import { CashFlowPage } from "@/components/cash-flow/cash-flow";
import { TakeoffPage } from "@/components/takeoff/takeoff-page";
import { TenderRoomPage } from "@/components/tender/tender-room-page";
import { RfqPage } from "@/components/rfq/rfq-page";
import { ReviewPage } from "@/components/review/review-page";
import { EstimatesPage } from "@/components/estimates/estimates-page";
import { CostControlPage } from "@/components/cost-control/cost-control-page";

/**
 * Every module page, which was always one page three times over.
 *
 * `/feasibility`, `/inputs` and `/site` were three files that each read a single prop and rendered
 * the same component. The route now says what the code already did — and each of the six modules
 * still to be built is a row in `PROJECT_NAV` rather than another file.
 *
 * ── It also had to be one route ────────────────────────────────────────────────────────────
 *
 * Vercel's Hobby plan allows twelve serverless functions per deployment and every route is one.
 * Sixteen routes meant deploys simply stopped: the code was pushed and production kept serving the
 * build before it. Three pages that differ by a string were the cheapest four to give back.
 *
 * ── And then everything else had to come here too ──────────────────────────────────────────
 *
 * `/corpus` and `/settings` kept their own folders on the reasoning that a literal segment beats a
 * dynamic one and they were therefore free. They were not free: **a folder is a function**, and the
 * measured count was sixteen against a cap of twelve — the route table had been read as eleven
 * because it marks statically prerendered pages `○`, and those still get a function each.
 *
 * So the places a project *has* — its documents and its details — are branches here rather than
 * folders. `ModulePage` handles the rest and calls `notFound()` for a module the navigation does
 * not contain.
 */
export default async function Page({ params, searchParams }: PageProps<"/projects/[id]/[module]">) {
  const { id, module } = await params;

  /*
    An ad hoc request uses its own few modules (`lib/adhoc.ts`). A step of the service chain reached
    by URL would render a checklist and a run for a request that has neither, so it says so instead.
  */
  const project = await getProject(id);
  if (!project) notFound();
  if (project.kind === "adhoc" && !inAdhocScope(`/${module}`)) {
    return (
      <div className="mx-auto max-w-2xl px-8 py-10">
        <h1 className="t-lg text-[var(--n-800)]">Not part of an ad hoc request</h1>
        <p className="t-md mt-2 text-[var(--n-600)]">
          {project.name} is an ad hoc request: its inputs, a take-off and the assistant, without the project stages.
        </p>
        <Link href={`/projects/${id}`} className="t-sm mt-4 inline-block text-[var(--a-700)] hover:underline">Back to the request</Link>
      </div>
    );
  }

  /**
   * The project-wide places, which are not steps: no entry criteria, no agent, nothing to sign. Sent
   * to their own components before `ModulePage` gets a chance to render them an empty checklist.
   */
  if (module === "corpus") return <ProjectCorpus projectId={id} />;

  /**
   * Pricing is a step in the nav and a **lens** in the code: it has no entry criteria of its own
   * and runs no agent, because it edits the bill's rows rather than establishing anything (§4.8).
   * `ModulePage` would render it an empty checklist and no run panel, which is not what it is.
   */
  if (module === "pricing") return <Pricing projectId={id} />;
  // Cash Flow is the same kind of lens: three signed steps read into one table, nothing of its own to sign.
  if (module === "cash-flow") return <CashFlowPage projectId={id} />;
  // Dimension sheets: measured by a person, sent to the bill – a working tool, not a run to sign.
  if (module === "take-off") return <TakeoffPage projectId={id} />;
  // Issuing the tender and opening the returns – the part before Tender Analysis compares them.
  if (module === "tender") return <TenderRoomPage projectId={id} />;
  if (module === "rfq") return <RfqPage projectId={id} />;
  // Design review: a draft bill mapped against the design, with its queries and estimate. A project
  // can hold several, chosen by `?review=`.
  // Estimate comparison: estimates for the same works by element, chosen by `?comparison=`.
  // Design cost control: the detailed estimate against the Cost Plan's targets, and the client's decision.
  if (module === "cost-control") return <CostControlPage projectId={id} />;
  if (module === "estimates") {
    const chosen = (await searchParams).comparison;
    return <EstimatesPage projectId={id} comparisonId={typeof chosen === "string" ? chosen : undefined} />;
  }
  if (module === "review") {
    const chosen = (await searchParams).review;
    return <ReviewPage projectId={id} reviewId={typeof chosen === "string" ? chosen : undefined} />;
  }

  if (module === "settings") return <ProjectSettings project={project} />;

  return <ModulePage projectId={id} module={`/${module}`} />;
}
