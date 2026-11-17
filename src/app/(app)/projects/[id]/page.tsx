import Link from "next/link";
import { notFound } from "next/navigation";
import { Upload } from "lucide-react";

import { stepRuns } from "@/lib/agent/persist";
import {
  feedsInto,
  nextStep,
  stepState,
  stepSummary,
  upstreamPending,
  type NextMove,
  type StepState,
} from "@/lib/chain";
import { groundCriteria } from "@/lib/criteria-grounding";
import { readinessOfModule } from "@/lib/criteria-status";
import { criteriaForModule, modulesWithCriteria } from "@/lib/entry-criteria";
import { PROJECT_NAV } from "@/lib/navigation";
import { JobPhaseTiles } from "@/components/project/job-phases";
import { phaseDeliverables, type ProjectEvidence } from "@/lib/phase-deliverables";
import { ProjectAgent } from "@/components/project/project-agent";
import { OpenAssistant } from "@/components/shell/open-assistant";
import { StepBadge } from "@/components/project/step-badge";
import { NextStepPublisher } from "@/components/shell/next-step-publisher";
import { STAGES, phaseOfModule, stagesOf, withinStages } from "@/lib/stages";
import { getProject } from "../actions";
import { AdhocOverview } from "@/components/adhoc/adhoc-overview";
import { listDocuments } from "./actions";

/**
 * A project's front page — where the work stands, and which module needs attention.
 *
 * ── What this page stopped being ───────────────────────────────────────────────────────────
 *
 * It used to carry every criterion of every process and a single upload box for all of them. That
 * made one long page whose length grew with the checklist, and it put the client mandate next to
 * the geotechnical report next to the QS cost plan — three different jobs, on three different days,
 * competing for the same screen.
 *
 * The requirements now live in the module that needs them. What belongs *here* is the question this
 * page is uniquely placed to answer: **where is this project up to, and where should I go next.**
 * One row per module, its blockers counted, linking through.
 *
 * Still nothing is uploaded from here — the Import data button is a way *to* the corpus, not a
 * second drop zone. §2.5: one path per task, and the path stays the one screen that owns it.
 */
/** How the next-step tile opens, by why the step was chosen. */
const NEXT_HEADING: Readonly<Record<NextMove, string>> = {
  continue: "Continue with",
  start: "Start with",
  file: "Start with",
  wait: "Next up:",
};

export default async function ProjectPage({ params }: PageProps<"/projects/[id]">) {
  const { id } = await params;

  const project = await getProject(id);
  if (!project) notFound();

  const documents = await listDocuments(id);
  // An ad hoc request has no service chain to stand on: its front page is the request itself.
  if (project.kind === "adhoc") return <AdhocOverview project={project} documents={documents} />;
  const navItems = PROJECT_NAV.flatMap((g) => g.items);

  /**
   * Which steps of this project are signed — §1.3.1's `upstream_ready`, read once for the page.
   *
   * The chain is answered here, on the server, and rendered. Nothing below recomputes whether a
   * step may start: "a client that decided its own prerequisites could start a downstream step from
   * nothing and call it approved".
   */
  const steps = await stepRuns(id);
  const signed = new Set([...steps].filter(([, s]) => s.signature).map(([module]) => module));

  const modules = await Promise.all(
    modulesWithCriteria().map(async (module) => {
      const criteria = criteriaForModule(module);
      const wantedKinds = new Set(criteria.flatMap((c) => c.acceptedEvidence));
      const owned = documents.filter((d) => wantedKinds.has(d.kind));

      const known = await groundCriteria(id, module, owned);
      const readiness = readinessOfModule(module, known, upstreamPending(module, signed));
      const step = steps.get(module);

      return {
        module,
        label: navItems.find((i) => i.href === module)?.label ?? module,
        readiness,
        filed: owned.length,
        total: criteria.length,
        signature: step?.signature ?? null,
        // Steps that consume this one's signed output. Named even where they are not built yet:
        // "what does this feed" is the question the chain exists to answer, and an empty answer on a
        // step that clearly feeds something would read as the platform not knowing.
        downstream: feedsInto(module),
        state: stepState({
          module,
          startable: readiness.startable,
          hasRun: step?.hasRun ?? false,
          isSigned: Boolean(step?.signature),
        }),
      };
    }),
  );

  /**
   * ── The stages this project runs, and what that changes ──────────────────────────────────
   *
   * Setup asks which stage a project is at and records the phases from there on. Until now that
   * answer went into the column and nowhere else: a project taken on at valuation still opened on
   * a board of thirteen steps and a tile reading "0/40 requirements met", forty being every
   * requirement of every phase including six the practice is not engaged for.
   *
   * That figure is not merely noisy, it is wrong about the size of the job. So the counts are of
   * the work in scope, and the board is grouped by stage.
   *
   * Out of scope is **set aside, not hidden.** A project whose stages were entered wrongly must
   * still be able to reach the step it actually needs, and a QS handed an early document on a late
   * project should be able to file it. It sits under a disclosure, counted separately, with the
   * stages named — hiding it outright would leave someone hunting a step the sidebar still lists.
   */
  const covered = stagesOf(project.stages);
  const inScope = modules.filter((m) => withinStages(m.module, project.stages));
  const setAside = modules.filter((m) => !withinStages(m.module, project.stages));

  // The job card's one line of figures, counted over the work in scope. `startable`, not "no missing
  // inputs": a step can also be held up by an unsigned upstream, and a count that disagreed with the
  // badge on the row beneath it is the drift `criteria-status.ts` and `chain.ts` exist to prevent.
  const totalCriteria = inScope.reduce((n, m) => n + m.total, 0);
  const totalResolved = inScope.reduce(
    (n, m) => n + m.readiness.outcomes.filter((o) => o.state === "satisfied" || o.state === "declared").length,
    0,
  );
  const readySteps = inScope.filter((m) => m.readiness.startable).length;

  // The step to open next — in scope, in phase order, and one the reader can move from where they
  // stand. `nextStep` says why the old "first step missing a document" rule sent people to the
  // final account. The sentence under it is `stepSummary`'s, so the tile and the row agree.
  const next = nextStep(
    inScope.map((m) => ({
      ...m,
      blocked: m.readiness.missingInputs.length,
      upstreamPending: m.readiness.upstreamPending,
    })),
  );

  /** The board, one section per stage, in phase order. A stage with no step in it is not a section. */
  const board = STAGES.filter((stage) => covered.includes(stage.number))
    .map((stage) => ({
      stage,
      steps: inScope.filter((m) => phaseOfModule(m.module) === stage.number),
    }))
    .filter((section) => section.steps.length > 0);


  /*
    What the project has, for the phases' deliverables: which steps are signed, which kinds of
    document are on file, and what each step still needs. Read from what this page already loaded.
  */
  const filedKinds = new Map<string, number>();
  for (const document of documents) filedKinds.set(document.kind, (filedKinds.get(document.kind) ?? 0) + 1);
  const evidence: ProjectEvidence = {
    signed,
    filed: filedKinds,
    labelOf: (module) => navItems.find((item) => item.href === module)?.label ?? module,
    missingFor: (module) =>
      modules.find((m) => m.module === module)?.readiness.missingInputs.map((o) => o.criterion.label) ?? [],
  };

  return (
    <div className="@container mx-auto flex w-full max-w-5xl flex-col px-8 pt-4 pb-5">
      <header className="flex items-center justify-between gap-4">
        {/* The code, client and stages it runs are the dashboard's – this page is the job card. */}
        <h1 className="t-xl min-w-0 text-[var(--n-800)]">{project.name}</h1>

        {/*
          The way in, on the screen someone is already looking at.

          It was a sidebar item called "Data import", which put a verb in a list of places and made
          the first thing anyone does on a new project something they had to go and find. A project
          with nothing filed cannot answer a single requirement, so this is the action that unblocks
          every other one — it belongs here, on the front page, as a button.
        */}
        <Link
          href={`/projects/${id}/corpus`}
          className="t-base flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--a-500)] px-3 font-medium text-white transition-colors hover:bg-[var(--a-600)]"
          style={{ transitionDuration: "var(--m-fast)" }}
        >
          <Upload aria-hidden size={15} strokeWidth={1.75} />
          Import data
        </Link>
      </header>

      {/* The sidebar opens the group holding it, so the step is one click away from every page. */}
      <NextStepPublisher projectId={id} module={next?.step.module ?? null} />
      {/* The assistant is open on a project's front page, where a reader arriving most wants it. */}
      <OpenAssistant />

      {/*
        ── Short, and led by the agent ─────────────────────────────────────────────────────────

        This page opened on four KPI tiles, a next-step banner and a progress-by-stage table before
        it reached the steps. The figures are the dashboard's job, and a page that repeats them is a
        page nobody reads to the end. What is left is the one question this page answers — where the
        job is and what to do next — on one job card, with every phase and its steps inside it.
      */}
      <div className="mt-5">
        <ProjectAgent
          phases={
            <JobPhases
              projectId={id}
              board={board}
              currentStage={next ? (phaseOfModule(next.step.module) ?? null) : null}
              setAside={setAside}
              evidence={evidence}
            />
          }
          status={{
            projectId: id,
            stage: next ? (STAGES.find((s) => s.number === phaseOfModule(next.step.module))?.name ?? null) : null,
            documents: documents.length,
            signed: inScope.filter((m) => m.signature).length,
            steps: inScope.length,
            counts: { met: totalResolved, criteria: totalCriteria, ready: readySteps },
            next: next
              ? {
                  heading: NEXT_HEADING[next.move],
                  label: next.step.label,
                  href: `/projects/${id}${next.step.module}`,
                  summary: stepSummary({
                    state: next.step.state,
                    upstreamPending: next.step.upstreamPending,
                    signedBy: null,
                    blocked: next.step.blocked,
                    gaps: next.step.readiness.gaps.length,
                  }),
                  missing: next.step.readiness.missingInputs.map((m) => m.criterion.label),
                  waitingOn: [...next.step.readiness.upstreamPending],
                }
              : null,
          }}
        />
      </div>
    </div>
  );
}

type BoardStep = {
  module: string;
  label: string;
  readiness: Awaited<ReturnType<typeof readinessOfModule>>;
  filed: number;
  total: number;
  state: StepState;
  signature: { by: string } | null;
  downstream: ReturnType<typeof feedsInto>;
};

/**
 * The job's phases inside the job card – tiles, with the steps of one phase under them.
 *
 * Every stage used to be a full-width section with a band and a tall row per step, so the board was
 * the longest thing on the page. The tiles are `JobPhaseTiles`; the rows stay server-rendered here.
 */
function JobPhases({
  projectId,
  board,
  currentStage,
  setAside,
  evidence,
}: {
  projectId: string;
  board: { stage: (typeof STAGES)[number]; steps: BoardStep[] }[];
  currentStage: number | null;
  setAside: BoardStep[];
  evidence: ProjectEvidence;
}) {
  const runs = new Set(board.map(({ stage }) => stage.number));

  /*
    Every phase has a tile, including the ones this project does not run.

    A project taken on at Construction sets five phases aside, and until now the only way back was a
    checkbox list under Project Details or a notice on a step page somebody had to find first. The
    phases are on the job card, so the offer belongs on the job card: a phase it does not run says so
    and offers to add it, which is the one thing `addStage` does – it only ever widens.

    Their steps stay under `data-region="set-aside"`, where they have always been counted from:
    set aside, not deleted, and still reachable.
  */
  const phases = STAGES.map((stage) => {
    const steps = runs.has(stage.number)
      ? (board.find((section) => section.stage.number === stage.number)?.steps ?? [])
      : setAside.filter((step) => phaseOfModule(step.module) === stage.number);

    return {
      number: stage.number,
      name: stage.name,
      runs: runs.has(stage.number),
      deliverables: phaseDeliverables(stage.number, evidence).map((d) => ({
        ...d,
        // A step to open, or the corpus to file a document in. Nothing for work nothing tracks.
        href: d.step
          ? `/projects/${projectId}${d.step.module}`
          : d.detail.startsWith("Nothing filed")
            ? `/projects/${projectId}/corpus`
            : null,
      })),
      steps: steps.map((step) => <StepRow key={step.module} projectId={projectId} step={step} />),
    };
  });

  return (
    <div>
      <p className="t-xs mb-2 font-semibold tracking-[0.02em] text-[var(--n-500)] uppercase">Phases</p>
      <JobPhaseTiles projectId={projectId} current={currentStage} phases={phases} />
    </div>
  );
}

/** One step, slim. Shared by the phases and the set-aside list, so they cannot drift. */
function StepRow({
  projectId,
  step: { module, label, readiness, state, signature, downstream },
}: {
  projectId: string;
  step: BoardStep;
}) {
  // §7.7 – say the state and what would change it. `stepSummary` owns the words, so this row and
  // the step's own page cannot describe one position two ways.
  const summary = stepSummary({
    state,
    upstreamPending: readiness.upstreamPending,
    signedBy: signature?.by ?? null,
    blocked: readiness.missingInputs.length,
    gaps: readiness.gaps.length,
  });
  // What this step feeds – the reason a signature matters. Unbuilt neighbours are named and marked
  // rather than hidden, which would imply the platform stops here.
  const feeds = downstream.map((link) => `${link.label}${link.built ? "" : " (not built)"}`).join(", ");
  const line = feeds ? `${summary} · Feeds ${feeds}` : summary;

  return (
    <li data-step={module} data-state={state}>
      <Link
        href={`/projects/${projectId}${module}`}
        title={line}
        className="flex items-center gap-3 px-3 py-1.5 transition-colors hover:bg-[var(--n-50)]"
        style={{ transitionDuration: "var(--m-fast)" }}
      >
        <span className="min-w-0 flex-1">
          <span className="t-sm block font-medium text-[var(--n-800)]">{label}</span>
          {/* One line, whatever it holds – the whole of it is the tooltip and the step's own page. */}
          <span className="t-xs block truncate text-[var(--n-500)]">{line}</span>
        </span>
        <StepBadge state={state} />
      </Link>
    </li>
  );
}
