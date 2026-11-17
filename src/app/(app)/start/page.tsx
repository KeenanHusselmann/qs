/**
 * The guided path — how this platform works, shown against a real project.
 *
 * ── Why a page and not a modal ─────────────────────────────────────────────────────────────
 *
 * A modal wizard traps a reader in a sequence and is dismissed once. This is a place they can come
 * back to, link somebody else to, and read while the work is half done — which is when the question
 * "what happens after I upload these?" is actually asked. It also survives a reload, because it
 * remembers nothing: every position on it is read from the database each time.
 *
 * ── Written for whoever is deciding ────────────────────────────────────────────────────────
 *
 * The reader is often not the quantity surveyor. Each step leads with what it *produces*, in words
 * somebody evaluating the platform can weigh, and carries the project's own figures once it has
 * happened. "15 documents filed · 18 of 40 requirements met" is a claim that can be checked;
 * "ingestion complete" is one that cannot.
 */

import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { and, count, eq, isNull, max, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { documents as documentsTable, runs as runsTable } from "@/db/schema";
import { loadSignedFigures, stepRuns } from "@/lib/agent/persist";
import { requireSession } from "@/lib/auth";
import { groundCriteria } from "@/lib/criteria-grounding";
import { criteriaForModule } from "@/lib/entry-criteria";
import { FIRM } from "@/lib/firm";
import { guidedPath, pathSummary, type GuidedStep } from "@/lib/guided-path";
import { PROJECT_NAV } from "@/lib/navigation";
import { viabilityReport } from "@/lib/report/viability";
import { listCriterionChecks, listDocuments } from "@/app/(app)/projects/[id]/actions";
import { listProjects } from "@/app/(app)/projects/actions";
import { Guide } from "@/components/start/guide";

export default async function StartPage() {
  await requireSession();

  const projects = await listProjects();

  const project = await mostRecentlyWorked(projects);

  /*
    Every figure on this page is the followed project's, including this one. It counted every
    document in the database, so a page promising "every figure below is one you can go and check"
    reported fifteen documents on a project holding none — the fifteen belonged to another job.
  */
  const [[filed], runs, signed] = await Promise.all([
    project
      ? db
          .select({ total: count() })
          .from(documentsTable)
          .where(and(eq(documentsTable.projectId, project.id), isNull(documentsTable.deletedAt)))
      : Promise.resolve([{ total: 0 }]),
    project ? stepRuns(project.id) : Promise.resolve(new Map()),
    project ? loadSignedFigures(project.id) : Promise.resolve([]),
  ]);

  /**
   * Requirements met, grounded the same way the project overview grounds them.
   *
   * It is a pass per built module, which is not free — but the alternative was a figure derived
   * from a plausible-looking multiplier, and a made-up denominator on the page that explains how
   * the platform works would be the exact failure the platform exists to prevent. This page is
   * read occasionally; a wrong number on it would be read as the truth every time.
   */
  const builtModules = PROJECT_NAV.flatMap((group) => group.items).filter((item) => item.built);

  const requirements = builtModules.flatMap((item) => criteriaForModule(item.href));

  let requirementsMet = 0;

  if (project) {
    const [filedDocuments, checks] = await Promise.all([
      listDocuments(project.id),
      listCriterionChecks(project.id),
    ]);

    for (const item of builtModules) {
      const known = await groundCriteria(project.id, item.href, filedDocuments, checks);
      for (const outcome of known.values()) {
        if (outcome.state === "satisfied" || outcome.state === "declared") requirementsMet += 1;
      }
    }
  }

  const report = viabilityReport(signed);

  const steps = guidedPath({
    projects: projects.length,
    project: project ? { id: project.id, name: project.name } : null,
    documents: filed?.total ?? 0,
    requirementsMet,
    requirementsTotal: requirements.length,
    runsStarted: runs.size,
    signedSteps: signed.length,
    reportSections: report.established,
    reportTotal: report.total,
  });

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-6 px-8 py-6">
      <header>
        <h1 className="t-xl text-[var(--n-800)]">How this works</h1>
        <p className="t-md mt-1 max-w-[76ch] text-[var(--n-600)]">
          Five steps from a folder of documents to a signed viability report.{" "}
          {project ? (
            <>
              Shown against <span className="font-medium text-[var(--n-800)]">{project.name}</span>,
              so every figure below is one you can go and check.
            </>
          ) : (
            <>Nothing is open yet, so this is the journey rather than a report on it.</>
          )}
        </p>
      </header>

      <ol data-region="path" className="flex flex-col gap-3">
        {steps.map((step) => (
          <Step key={step.no} step={step} />
        ))}
      </ol>

      {/*
        The guide sits under the path, not above it.

        The five steps are computed and always right, so they answer "what do I do" before anybody
        has to ask. This is for the question the list cannot anticipate — and putting it first would
        invite a reader to type a question the page had already answered.
      */}
      <Guide />

      <p className="t-sm text-[var(--n-500)]">
        {pathSummary(steps)} Nothing on this page is remembered — where you are is read from the
        project each time, so it is right on any machine and after any interruption.
      </p>

      <p className="t-sm text-[var(--n-500)]">
        {FIRM.name} · every figure the platform produces traces to a document and to the person who
        signed it.
      </p>
    </div>
  );
}

function Step({ step }: { step: GuidedStep }) {
  const done = step.state === "done";
  const current = step.state === "current";

  return (
    <li
      data-step={step.no}
      data-state={step.state}
      className={`rounded-[var(--r-lg)] border bg-[var(--n-0)] px-5 py-4 ${
        current ? "border-[var(--a-500)]" : "border-[var(--n-200)]"
      }`}
    >
      <div className="flex items-start gap-3">
        {/*
          The number, or a tick once it is behind you. §7.1 #5 — the state is in the mark and in
          the words beside it, never in colour alone.
        */}
        <span
          aria-hidden
          className={`num t-sm mt-0.5 grid size-6 shrink-0 place-items-center rounded-full font-semibold ${
            done
              ? "bg-[var(--ok-500)] text-white"
              : current
                ? "bg-[var(--a-600)] text-white"
                : "bg-[var(--n-100)] text-[var(--n-500)]"
          }`}
        >
          {done ? <Check size={13} strokeWidth={3} /> : step.no}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h2 className="t-base font-semibold text-[var(--n-800)]">{step.title}</h2>
            {current && (
              <span className="t-xs rounded-[var(--r-sm)] bg-[var(--a-50)] px-1.5 py-0.5 font-medium text-[var(--a-700)]">
                You are here
              </span>
            )}
          </div>

          <p className="t-sm mt-1 max-w-[86ch] text-[var(--n-600)]">{step.produces}</p>

          {/* The claim a reader can check. Only ever shown once it is true. */}
          {step.achieved && (
            <p className="t-sm num mt-1.5 font-medium text-[var(--ok-700)]">{step.achieved}</p>
          )}

          {step.action && (
            <Link
              href={step.action.href}
              data-action={`step-${step.no}`}
              className={`t-sm mt-2.5 inline-flex h-8 items-center gap-1.5 rounded-[var(--r-md)] px-3 font-medium transition-colors ${
                current
                  ? "bg-[var(--a-600)] text-white hover:bg-[var(--a-700)]"
                  : "border border-[var(--n-200)] text-[var(--n-700)] hover:bg-[var(--n-50)]"
              }`}
              style={{ transitionDuration: "var(--m-fast)" }}
            >
              {step.action.label}
              <ArrowRight aria-hidden size={13} strokeWidth={2} />
            </Link>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * The project somebody is most likely working on: the one where something last happened.
 *
 * It was `projects[0]`, which `listProjects` orders by creation — so opening a new job repointed this
 * page at an empty project, away from the one being worked. "Something happened" is derived rather
 * than remembered, like everything else on this page: a document filed, a run made or signed, or the
 * project itself edited. With no projects there is nothing to follow and the page describes the
 * journey instead.
 */
async function mostRecentlyWorked<P extends { id: string; updatedAt: Date; createdAt: Date }>(
  projects: readonly P[],
): Promise<P | null> {
  if (projects.length === 0) return null;

  const [filedAt, ranAt] = await Promise.all([
    db
      .select({ projectId: documentsTable.projectId, at: max(documentsTable.createdAt) })
      .from(documentsTable)
      .where(isNull(documentsTable.deletedAt))
      .groupBy(documentsTable.projectId),
    db
      .select({
        projectId: runsTable.projectId,
        at: max(sql<Date>`coalesce(${runsTable.signedAt}, ${runsTable.createdAt})`),
      })
      .from(runsTable)
      .groupBy(runsTable.projectId),
  ]);

  const latest = new Map<string, number>();
  for (const { projectId, at } of [...filedAt, ...ranAt]) {
    if (!at) continue;
    const time = new Date(at).getTime();
    if (time > (latest.get(projectId) ?? 0)) latest.set(projectId, time);
  }

  const activity = (p: P) => Math.max(latest.get(p.id) ?? 0, p.updatedAt.getTime(), p.createdAt.getTime());
  return projects.reduce((best, p) => (activity(p) > activity(best) ? p : best));
}
