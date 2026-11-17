/**
 * Advice on a project — PLATFORM.md §1.3, §1.3.1.
 *
 * ── The brief is computed here; the model only reads it ────────────────────────────────────
 *
 * Everything the advisor is told about this project is derived on this server from the same
 * queries the project's own pages run: the chain for what is signed and what is waiting, the
 * criteria for what is filed and what is missing, the stages for what this project is engaged for.
 * The model is handed that and nothing else — no documents, no figures, no other project.
 *
 * That is not only a privacy property, though it is one. It is what makes the counsel and the
 * screen agree: two derivations of "where is this job" would disagree the first time somebody
 * signed something, and a panel confidently describing a position the page is not showing is worse
 * than no panel.
 *
 * ── A POST, and why the brief comes back either way ────────────────────────────────────────
 *
 * POST because it spends money — a GET that costs a fraction of a cent per render would be
 * re-issued by every prefetch and every back button. The response carries the brief whether or not
 * the model answered, because the brief is the useful half and it was computed without asking
 * anybody. §1.3: an outage is stated, never disguised as an empty answer.
 */

import { advisorPrefix } from "@/lib/ingest/handover";
import { discard } from "@/lib/ingest/storage";
import { after, NextResponse } from "next/server";

import { db } from "@/db/client";
import { documents, issuedDocuments, rates } from "@/db/schema";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { advise, brief, type Brief, type StepPosition } from "@/lib/agent/advisor";
import { askOrExplain } from "@/lib/agent/ask";
import { readAssistantRequest, type AssistantRequest } from "@/lib/agent/assistant-request";
import { searchWeb } from "@/lib/agent/search";
import { enterEgressScope } from "@/lib/egress/scope";
import { recallNotes, rememberWeb } from "@/lib/memory/notes";
import { loadSignedFigures } from "@/lib/agent/persist";
import { ModelUnavailable, costOf } from "@/lib/agent/deepseek";
import { stepRuns } from "@/lib/agent/persist";
import { billChecks, tenderChecks } from "@/lib/agent/checks";
import { loadLatestBill, loadSignedBill } from "@/lib/agent/persist-bill";
import { loadTenderReturns } from "@/lib/agent/persist-tender";
import { evaluationInputs } from "@/lib/tender-evaluation";
import { marketFindings } from "@/lib/market-rates";
import { stepState, upstreamPending } from "@/lib/chain";
import { groundCriteria } from "@/lib/criteria-grounding";
import { readinessOfModule } from "@/lib/criteria-status";
import { criteriaForModule, modulesWithCriteria } from "@/lib/entry-criteria";
import { PROJECT_NAV } from "@/lib/navigation";
import { getProject } from "@/app/(app)/projects/actions";
import { listFactors, listRates } from "@/app/(app)/rates/actions";
import { STAGES, stagesOf, withinStages } from "@/lib/stages";

/** A model call and a corpus read; well inside the platform default, but declared. */
export const maxDuration = 60;

const LABELS = new Map(PROJECT_NAV.flatMap((g) => g.items).map((i) => [i.href, i.label]));

/**
 * The project's position, from its records.
 *
 * Deliberately the same shape the overview builds, because it answers the same question. If these
 * two ever disagree the panel is describing a job the page is not showing, which is the one thing
 * this must never do.
 */
async function positionOf(id: string): Promise<Brief | null> {
  const project = await getProject(id);
  if (!project) return null;

  const filed = await db
    .select({ id: documents.id, kind: documents.kind, filename: documents.filename })
    .from(documents)
    .where(and(eq(documents.projectId, id), isNull(documents.deletedAt)));

  /*
    Two facts the advisor cannot work out and a QS needs it to know.

    **Can anything be priced.** A rate with no region is eligible everywhere (`ratesInForce`), so
    the question is whether the library holds a live rate that is either national or this province's.
    Asked as an existence check rather than a count: the brief carries it as a yes or no, because a
    number handed to the model is a number that can come back out in the answer, and §1.3.1 says
    every figure traces to a signature. `limit 1` because the answer is not the size of the library.

    **Has anything been sent.** What is still current, not what was ever issued — a withdrawn
    document is exactly the case where "we have sent them something" stops being true.
  */
  const [pricable, sent] = await Promise.all([
    db
      .select({ one: sql<number>`1` })
      .from(rates)
      .where(
        and(
          isNull(rates.deletedAt),
          sql`${rates.effectiveDate} <= current_date`,
          project.region ? or(isNull(rates.region), eq(rates.region, project.region)) : undefined,
        ),
      )
      .limit(1),
    db
      .select({ one: sql<number>`1` })
      .from(issuedDocuments)
      .where(and(eq(issuedDocuments.projectId, id), isNull(issuedDocuments.withdrawnAt)))
      .limit(1),
  ]);

  const runs = await stepRuns(id);
  const signed = new Set([...runs].filter(([, s]) => s.signature).map(([module]) => module));

  const steps: StepPosition[] = [];

  // In chain order, and only the stages this project runs — advising somebody to start a stage
  // they are not engaged for is worse than saying nothing.
  // `step`, not `module`: Next forbids assigning to a variable of that name anywhere in a route,
  // because the bundler's own `module` lives in that scope.
  // An ad hoc request runs no step, so none is offered as a next move.
  const adhoc = project.kind === "adhoc";
  for (const step of adhoc ? [] : modulesWithCriteria()) {
    if (!withinStages(step, project.stages)) continue;

    const criteria = criteriaForModule(step);
    const wanted = new Set(criteria.flatMap((c) => c.acceptedEvidence));
    const owned = filed.filter((d) => wanted.has(d.kind));

    const known = await groundCriteria(id, step, owned);
    const readiness = readinessOfModule(step, known, upstreamPending(step, signed));
    const run = runs.get(step);

    steps.push({
      module: step,
      label: LABELS.get(step) ?? step,
      state: stepState({
        module: step,
        startable: readiness.startable,
        hasRun: run?.hasRun ?? false,
        isSigned: Boolean(run?.signature),
      }),
      waitingOn: readiness.upstreamPending,
      // The criterion's own words, which is what the reader sees on the step. `blockingInputs`
      // is the same list shaped for an upload control; this wants the labels alone.
      missing: readiness.missingInputs.map((m) => m.criterion.label),
      optional: readiness.gaps.map((g) => g.criterion.label),
      filed: owned.length,
      of: criteria.length,
    });
  }

  return brief({
    project: { name: project.name, client: project.client, request: adhoc ? project.request : null },
    checks: adhoc ? [] : await reviewChecks(id),
    region: project.region,
    // `stagesOf` rather than the raw column: null means every stage, which is what a project
    // created before the column existed meant. The advisor must read it the same way the nav does.
    stages: adhoc ? [] : stagesOf(project.stages).flatMap(
      (number) => STAGES.find((stage) => stage.number === number)?.name ?? [],
    ),
    documents: filed.length,
    canPrice: pricable.length > 0,
    hasIssued: sent.length > 0,
    steps,
  });
}

/**
 * What a reviewing QS would point at on this job: the working bill's gaps, and the tenders against the
 * signed bill. A failure here costs the advisor its specifics, never its answer – the brief is still
 * sound without them – so it is logged and left out rather than thrown.
 */
async function reviewChecks(projectId: string): Promise<string[]> {
  try {
    const [working, signedBill] = await Promise.all([loadLatestBill(projectId, "/bill"), loadSignedBill(projectId, "/bill")]);
    const findings = working ? billChecks(working.rows) : [];
    if (working && working.rows.length > 0) {
      const market = await marketFindings(projectId, working.rows);
      if (market && market.findings.length > 0) {
        findings.push("Some bill rates are well out of line with what tenderers priced the same items at on the practice's past jobs: they are listed under Rates against past tenders on the Pricing page.");
      }
    }
    if (signedBill) {
      const returns = await loadTenderReturns(projectId, signedBill.runId);
      const { items, tenders } = evaluationInputs(signedBill.rows, returns);
      findings.push(...tenderChecks(items, tenders));
    }
    return findings;
  } catch (error) {
    console.error(`advisor: review checks failed for ${projectId}:`, error);
    return [];
  }
}

/**
 * The corpus, as names — for attributing a passage to the document it came from.
 *
 * Read here rather than joined into `search()`: retrieval is a hot path over a generated tsvector
 * and has no business carrying display strings, and a project's document list is a handful of rows.
 */
async function filedNames(projectId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: documents.id, name: documents.filename })
    .from(documents)
    .where(and(eq(documents.projectId, projectId), isNull(documents.deletedAt)));

  return new Map(rows.map((row) => [row.id, row.name]));
}

/** A question is a question, not a document pasted into the box. */
const MAX_QUESTION_CHARS = 2_000;

export async function POST(request: Request, { params }: RouteContext<"/api/projects/[id]/advice">) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { id } = await params;
  // Every model call and web search below is recorded against this project and person (ARC-005).
  enterEgressScope({ projectId: id, actor: session.email });
  const position = await positionOf(id);
  if (!position) return NextResponse.json({ error: "No such project" }, { status: 404 });

  /*
    One endpoint, two questions.

    With no question in the body this is the panel opening and asking "what next" — the original
    behaviour. With one, it is a reader asking something specific of this project's documents.
    Both need the same position computed the same way, and splitting them into two routes would
    mean two derivations of where the job stands, which is the thing this route exists to prevent.
  */
  let input: AssistantRequest;
  try {
    input = await readAssistantRequest(request, id);
  } catch (error) {
    // The reader's words, not a status code: an unreadable attachment is something they can fix.
    return NextResponse.json({
      brief: position,
      answer: null,
      unavailable: error instanceof Error ? error.message : "The attachment could not be read.",
    });
  }
  const { question, web, history, attachments, briefOnly, mode } = input;

  /*
    A conversation's large attachments, deleted when the reader removes them or starts over. Only
    from this project's advisor area – the pathnames come from the browser.
  */
  if (input.discard.length > 0) {
    const mine = input.discard.filter((pathname) => pathname.startsWith(advisorPrefix(id)));
    await Promise.all(mine.map((pathname) => discard(pathname).catch(() => {})));
    return NextResponse.json({ discarded: mine.length });
  }

  /*
    The position alone, with no model call.

    The panel asks for this on every page it is open on, so "where this job is" and the next step
    follow the reader instead of standing still until somebody presses a button. It costs a few
    queries and nothing else, which is what makes asking on every navigation acceptable.
  */
  if (briefOnly) return NextResponse.json({ brief: position });

  /*
    ── The fifth channel ────────────────────────────────────────────────────────────────────

    Answered from the web instead of from the corpus, and kept entirely separate from it. The four
    ordinary channels all trace to something inside the practice — a filed document, an engine that
    can be re-run, a policy somebody wrote. This one traces to a page and a moment, which is a
    weaker claim, and the reader has to be able to see which they are being given.

    Nothing here touches the corpus, so a project's documents never leave with the question.
  */
  if (web && question.length > 0) {
    try {
      const found = await searchWeb(question.slice(0, 500));
      /*
        Kept, so the finding outlives the conversation: the same question asked later with web
        search off is answered from it, dated and sourced (`lib/agent/memory.ts`). After the
        response, because a reader should not wait on a write they did not ask for – and a failure
        to save is logged, never turned into a failure to answer.
      */
      after(() =>
        rememberWeb(question.slice(0, 500), found, session.email).catch((error) =>
          console.error("[advisor] could not keep a web finding:", error),
        ),
      );
      return NextResponse.json({
        brief: position,
        web: { ...found, cost: costOf(found.usage) },
      });
    } catch (error) {
      return NextResponse.json({
        brief: position,
        web: null,
        unavailable:
          error instanceof ModelUnavailable
            ? error.message
            : `The web search could not answer: ${error instanceof Error ? error.message : "unknown error"}.`,
      });
    }
  }

  if (question.length > 0) {
    try {
      /*
        The signed figures, for the tools.

        Read here and passed in rather than fetched inside a tool: four tools would otherwise make
        four identical queries for one question, and — worse — two of them could disagree if a
        signature landed between the calls.
      */
      /*
        The firm's rates travel with the question, for the take-off channel.

        Read here with the rest rather than inside the tool: a take-off already costs a second
        model call for the method, and adding a database round trip inside it would put a query
        behind a model response nobody can see waiting.

        Scoped to the project's province the way `matchRates` scopes a bill — a rate stating no
        region is national and always eligible.
      */
      const [names, signed, library, factors, memory] = await Promise.all([
        filedNames(id),
        loadSignedFigures(id),
        listRates(),
        // What the practice has written down about how much a unit of work consumes. Consulted
        // ahead of the model, so a firm that has recorded its own productivity gets it back.
        listFactors(),
        // What the practice found on the web for earlier questions. Not for the documents button,
        // which asks the documents and nothing else. A failed recall is an answer without memory,
        // not a failed answer.
        mode === "documents"
          ? Promise.resolve([])
          : recallNotes(question.slice(0, MAX_QUESTION_CHARS)).catch((error: unknown) => {
              console.error("[advisor] could not recall notes:", error);
              return [];
            }),
      ]);

      // Attachments are named alongside the filed documents, under ids no filed document can have.
      for (const attachment of attachments) names.set(attachment.documentId, attachment.name);

      const answer = await askOrExplain(
        id,
        question.slice(0, MAX_QUESTION_CHARS),
        position,
        names,
        signed,
        undefined,
        { library, options: { region: position.region }, factors },
        { history, attachments: attachments.flatMap((a) => a.passages), mode, memory },
      );
      return NextResponse.json({
        brief: position,
        answer: { ...answer, cost: costOf(answer.usage) },
      });
    } catch (error) {
      return NextResponse.json({
        brief: position,
        answer: null,
        unavailable:
          error instanceof ModelUnavailable
            ? error.message
            : `The advisor could not answer: ${error instanceof Error ? error.message : "unknown error"}.`,
      });
    }
  }

  try {
    const advice = await advise(position);
    return NextResponse.json({
      brief: position,
      advice: { ...advice, cost: costOf(advice.usage) },
    });
  } catch (error) {
    // The brief still goes back. It is the half that did not need anybody, and a reader whose
    // advisor is down should still be told where their job is.
    return NextResponse.json({
      brief: position,
      advice: null,
      unavailable:
        error instanceof ModelUnavailable
          ? error.message
          : `The advisor failed: ${error instanceof Error ? error.message : "unknown error"}.`,
    });
  }
}
