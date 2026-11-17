/**
 * The onboarding guide — a question from somebody who has not started yet.
 *
 * ── Not under /api/projects, because there may be no project ───────────────────────────────
 *
 * Every other agent route is scoped to a project id, which is what makes its retrieval safe. This
 * one has nothing to scope to and asks for nothing that would need scoping: the position is counted
 * across what the signed-in user can already see, the requirements come from the platform's own
 * definition of the work, and the only retrieval is over the firm's standards, which are firm-wide
 * by design.
 *
 * ── POST, because it spends money ──────────────────────────────────────────────────────────
 *
 * Same reasoning as the advice route: a GET costing a fraction of a cent would be re-issued by
 * every prefetch and every back button.
 */

import { NextResponse } from "next/server";
import { count, isNull, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { documents as documentsTable, rates } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { ModelUnavailable, costOf } from "@/lib/agent/deepseek";
import { askOnboardingOrExplain, onboardingBrief } from "@/lib/agent/onboarding";
import { readAssistantRequest, type AssistantRequest } from "@/lib/agent/assistant-request";
import { guidedPath } from "@/lib/guided-path";
import { loadPortfolio } from "@/lib/dashboard";
import { listProjects } from "@/app/(app)/projects/actions";
import { listFactors, listRates } from "@/app/(app)/rates/actions";

/** A model call, sometimes two. Well inside the platform default, but declared. */
export const maxDuration = 60;

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  // The same shape the project advisor reads: a question, the conversation so far, and files.
  let input: AssistantRequest;
  try {
    input = await readAssistantRequest(request);
  } catch (error) {
    return NextResponse.json({
      answer: null,
      unavailable: error instanceof Error ? error.message : "The attachment could not be read.",
    });
  }
  const { question, history, attachments } = input;

  if (question.length === 0) {
    return NextResponse.json({ error: "No question was asked." }, { status: 400 });
  }

  /*
    The position, counted — never asked for.

    The same derivation the guided path renders from, so the guide cannot describe a position the
    page beside it is not showing. One source, two uses.
  */
  const [projects, portfolio, [filed], priced] = await Promise.all([
    listProjects(),
    loadPortfolio(),
    db.select({ total: count() }).from(documentsTable).where(isNull(documentsTable.deletedAt)),
    /*
      Whether the practice has a rate library at all.

      Existence, not size — the guide is told yes or no and never a number, so it has none to
      repeat. Region is not narrowed here as it is on a project: this reader may not have a project
      yet, and the question is whether the library exists rather than whether it covers a province.
    */
    db.select({ one: sql<number>`1` }).from(rates).where(isNull(rates.deletedAt)).limit(1),
  ]);

  const signedSteps = portfolio.projects.reduce((total, p) => total + p.signedSteps, 0);
  const project = projects[0] ?? null;

  const steps = guidedPath({
    projects: projects.length,
    project: project ? { id: project.id, name: project.name } : null,
    documents: filed?.total ?? 0,
    requirementsMet: 0,
    requirementsTotal: 0,
    runsStarted: 0,
    signedSteps,
    reportSections: 0,
    reportTotal: 12,
  });

  const brief = onboardingBrief({
    projects: projects.length,
    documents: filed?.total ?? 0,
    signedSteps,
    hasRates: priced.length > 0,
    steps,
  });

  try {
    // The firm's rates and factors, so "how many bricks for 240 m²" is computed here as it is on a
    // project. No project means no province, so every rate is eligible (`ratesInForce`).
    const [library, factors] = await Promise.all([listRates(), listFactors()]);

    const answer = await askOnboardingOrExplain(question.slice(0, 2_000), brief, undefined, {
      takeOffRates: { library, options: { region: null }, factors },
      history,
      attachments: attachments.flatMap((a) => a.passages),
      names: new Map(attachments.map((a) => [a.documentId, a.name])),
    });
    return NextResponse.json({ answer: { ...answer, cost: costOf(answer.usage) } });
  } catch (error) {
    return NextResponse.json({
      answer: null,
      unavailable:
        error instanceof ModelUnavailable
          ? error.message
          : `The guide could not answer: ${error instanceof Error ? error.message : "unknown error"}.`,
    });
  }
}
