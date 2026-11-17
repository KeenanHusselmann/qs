/**
 * A project module — what this step needs, and where you file it.
 *
 * ── Why this replaced the overview dump ────────────────────────────────────────────────────
 *
 * Everything used to be on the project's main page: all fourteen criteria across three process
 * areas, and one upload box serving all of them. It answered "what does this project need?" and
 * nothing else, so a QS who came to work on the feasibility estimate read past the client mandate,
 * the stakeholder register, the title deed and the zoning certificate to reach the two rows they
 * came for. Every module's requirements competed with every other module's.
 *
 * Each module now renders only the criteria allocated to it (`Criterion.module`) and only the
 * documents filed against them. The requirement sits where the work happens, which is also where
 * someone has the document in hand.
 *
 * The v3 lesson still holds and is the reason the upload panel is on this page rather than behind a
 * link: a reader who discovers they need a document must be able to file it *there*, not leave to
 * find a documents page, work out the category and come back.
 */

import { notFound } from "next/navigation";
import { after } from "next/server";

import { ChecklistCard } from "@/components/criteria/checklist-card";
import { BillPanel } from "@/components/agent/bill-panel";
import { BillSummary } from "@/components/agent/bill-summary";
import { CarriedSchedule } from "@/components/agent/carried-schedule";
import { TenderComparison } from "@/components/agent/tender-comparison";
import { TenderEvaluation } from "@/components/agent/tender-evaluation";
import { RunPanel } from "@/components/agent/run-panel";
import { ReadinessList } from "@/components/criteria/readiness-list";
import { StepBadge } from "@/components/project/step-badge";
import { billTotal, carriesRowsFrom, producesItems } from "@/lib/agent/bill";
import { loadLatestBill, loadSignedBill } from "@/lib/agent/persist-bill";
import { loadTenderReturns } from "@/lib/agent/persist-tender";
import { loadLatestRun, loadSignature, signedModules } from "@/lib/agent/persist";
import { IssueCertificate } from "@/components/certificates/issue-certificate";
import { issuedFor } from "@/lib/certificates";
import { requireSession } from "@/lib/auth";
import {
  feedsInto,
  fieldsFor,
  labelOf,
  producesRuns,
  stepState,
  stepSummary,
  upstreamPending,
} from "@/lib/chain";
import { groundCriteria } from "@/lib/criteria-grounding";
import { assessProject } from "@/lib/documents/coverage";
import { blockingInputs, isSatisfied, readinessOfModule } from "@/lib/criteria-status";
import { criteriaForModule } from "@/lib/entry-criteria";
import { PROJECT_NAV } from "@/lib/navigation";
import { STAGES, phaseOfModule, stagesOf, withinStages } from "@/lib/stages";
import { OffStageNotice } from "@/components/project/off-stage-notice";
import { getProject } from "@/app/(app)/projects/actions";
import { nameOf } from "@/lib/signers";
import { listCriterionChecks, listDocuments } from "@/app/(app)/projects/[id]/actions";
import { isSpatial } from "@/lib/ingest/document-class";
import { loadElementalPlan } from "@/lib/elemental-plan";
import { ElementalPlanPanel } from "@/components/cost-plan/elemental-plan-panel";

/** The nav item that owns a module href, for its name and process code. */
const navItemFor = (module: string) =>
  PROJECT_NAV.flatMap((g) => g.items).find((i) => i.href === module);

const GENERIC_BLURB =
  "Reads the filed documents and returns each figure this step needs, with the passage it came from. Nothing is assumed — what it cannot find, it says.";

/**
 * What each run panel calls itself.
 *
 * One panel serves every agent, so its words cannot be baked into the component. They sit here
 * rather than on the `FieldSpec[]` because they describe the *screen*, not the data — and §7.7 asks
 * that a step say what it is about to do in the reader's terms rather than in the platform's.
 */
const RUN_WORDING: Readonly<Record<string, { heading: string; blurb: string }>> = {
  "/feasibility": {
    heading: "Extract the estimate inputs",
    blurb: GENERIC_BLURB,
  },
  "/cost-plan": {
    heading: "Read the elemental cost plan",
    blurb:
      "Reads the priced plan element by element, and carries the scheme's shape from the signed feasibility estimate rather than asking the documents a second time. An element the plan does not price is reported as absent, never as nought.",
  },
  "/contract": {
    heading: "Read the contract particulars",
    blurb:
      "A JBCC contract states its own terms in a schedule — the sum, the retention rate and its limit, the dates, whether prices escalate. They are read out with the clause behind each one, because every certificate for the rest of the job is computed against them.",
  },
  "/valuations": {
    heading: "Value the period",
    blurb:
      "Reads what was built this period from the valuation record, and carries the contract sum and retention rate from the signed contract. Those are never re-read: an issued certificate is immutable, and a retention rate taken twice is a wrong deduction the contractor has already been paid against.",
  },
  "/variations": {
    heading: "Assess the variation",
    blurb:
      "Reads the instruction, what it changed and what it is worth. The instruction reference and its date are the fields a dispute turns on two years later, so a variation without them is refused rather than recorded.",
  },
  "/cost-report": {
    heading: "Report where the money is",
    blurb:
      "Reads the period's forecast and variance, and carries the contract sum and the work executed from the steps that established them. A cost report that quietly disagreed with the certificates it summarises is the failure this chain exists to prevent.",
  },
  "/tender-analysis": {
    heading: "Compare the tenders",
    blurb:
      "Reads the returns and the adjudication: who tendered, what they tendered, what was corrected and what each price is qualified by. A tender is often lowest because it is qualified, and a recommendation that records the number without the qualification is the document somebody is shown in a dispute.",
  },
  "/final-account": {
    heading: "Read the final account",
    blurb:
      "The last figure the job produces, read from the agreed statement and carried against the contract sum it moved from. Whether it was agreed, and by whom, is part of the record — an unsigned final account is a proposal.",
  },
  "/bill": {
    heading: "Draft the bill from the documents",
    blurb:
      "Reads the specification and the priced sources for items of measurable work, and proposes each one as a bill row with the passage it came from. Quantities the documents do not state are left for you to measure — an item nobody has measured is never written as nought.",
  },
};

export async function ModulePage({ projectId, module }: { projectId: string; module: string }) {
  const session = await requireSession();
  // Who is signing, by name – "Sign off as Thandi Nkosi". The signature itself records the email.
  const signerName = await nameOf(session.email);
  const project = await getProject(projectId);
  if (!project) notFound();

  const item = navItemFor(module);
  if (!item) notFound();

  const criteria = criteriaForModule(module);
  const all = await listDocuments(projectId);

  // Only what this module asked for. A title deed filed under Site does not belong in the
  // feasibility estimate's list, even though both live in one corpus.
  const wantedKinds = new Set(criteria.flatMap((c) => c.acceptedEvidence));
  const documents = all.filter((d) => wantedKinds.has(d.kind));

  const checks = await listCriterionChecks(projectId);
  const known = await groundCriteria(projectId, module, documents, checks);

  // Documents filed before coverage was read, or while the model was unreachable, are judged once
  // this page has been sent; the next render shows the result. See `documents/coverage.ts`.
  after(() => assessProject(projectId));

  /**
   * §1.3.1 — whether this step may start depends on its upstream as well as its own documents, and
   * the two are kept apart because only one of them can be cleared by uploading something.
   */
  const readiness = readinessOfModule(
    module,
    known,
    upstreamPending(module, await signedModules(projectId)),
  );

  /*
    The signed rows this step opens from, where it is that kind of step.

    `loadSignedBill` has `signed_at is not null` in its where clause rather than filtering after —
    so an unsigned draft upstream is not in the result set at all, and this is null. That is the
    same sentence the loader carries and the reason it is used here rather than `loadLatestBill`:
    a bill that is still being corrected must not reach a tender.
  */
  const source = carriesRowsFrom(module);
  const carried = source ? await loadSignedBill(projectId, source) : null;
  const returns = carried ? await loadTenderReturns(projectId, carried.runId) : [];

  /*
    What this step has produced, read once.

    Both of these were awaited inline in the panel's props, which was fine while the panel was the
    only thing that cared. The header states the step's position now and `stepState` needs the same
    two facts — read twice, they would be two queries able to disagree about whether a run exists.

    `producesRuns` guards them because `/inputs` and `/site` run no agent at all: they have no run
    to load and no signature to find, and their position is decided by their documents alone.
  */
  const bill = producesItems(module) ? await loadLatestBill(projectId, module) : null;
  /*
    The cost plan revised from the measured bill (D1.1 Cost Plan Revision). Where a project has a
    bill, the plan is built from it – whichever stage the project started at, which is why a bill-fed
    plan is never set aside as off-stage.
  */
  const elemental = module === "/cost-plan" ? await loadElementalPlan(projectId) : null;
  const run =
    producesRuns(module) && !producesItems(module)
      ? await loadLatestRun(projectId, module)
      : null;
  const signature = producesRuns(module) ? await loadSignature(projectId, module) : null;

  /*
    Where the step stands, in the platform's one vocabulary for it (§1.3.1's five states).

    The overview says this on every row and the step's own page said nothing, so clicking a row
    marked "Waiting on Feasibility Estimate" opened a screen with no trace of it. Same function,
    same badge, same sentence.
  */
  const state = stepState({
    module,
    startable: readiness.startable,
    hasRun: Boolean(run ?? bill),
    isSigned: Boolean(signature),
  });

  /*
    Where this step sits in the practice's process, derived rather than declared: the stage is the
    L0 phase its process area belongs to (`stages.ts`), and the code is the area the nav item
    already carries. Neither is a second list.
  */
  const stage = STAGES.find((s) => s.number === phaseOfModule(module));

  /* What reads this step's signed output — the reason the signature matters at all. */
  const downstream = feedsInto(module);

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col px-8 py-6">
      {/*
        ── The header answers the questions the breadcrumb cannot ──────────────────────────
        It was the module's name over the project's name — and the project's name is already in the
        breadcrumb above it and on the back button beside that, so a page said one thing three times
        and the step's own position not at all. Every other page here opens by saying where the
        thing stands: the overview names the client and the stages the job runs, the dashboard says
        how many steps are signed.

        So: where the step sits, what state it is in, and what reads it when it is signed. All three
        derived — the stage from L0, the state from `stepState`, the readers from the chain.
      */}
      <header>
        <h1 className="t-xl text-[var(--n-800)]">{item.label}</h1>
        {/*
          `--n-600`, not the `--n-500` this line used to wear. On the `--n-50` canvas that measures
          **4.45:1** and §7.8 asks for 4.5 — the same correction the sidebar rows got on this branch,
          for the same reason. `--n-600` is 7.09:1. Inside a white panel `--n-500` is 4.72:1 and
          stays; it is the canvas, not the token, that is short.
        */}
        <p className="t-md mt-0.5 text-[var(--n-600)]">
          {[project.name, stage?.name, item.process].filter(Boolean).join(" · ")}
        </p>

        <div data-region="position" className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <StepBadge state={state} />
          <span className="t-sm text-[var(--n-600)]">
            {stepSummary({
              state,
              upstreamPending: readiness.upstreamPending,
              signedBy: signature?.by ?? null,
              blocked: readiness.missingInputs.length,
              gaps: readiness.gaps.length,
            })}
          </span>
        </div>

        {/*
          Unbuilt readers are named and marked rather than filtered out, as they are on the board:
          hiding them would imply the chain stops here. Keyed by `code` where a reader is a process
          area with no module of its own, which is the only value unique across these links.
        */}
        {downstream.length > 0 && (
          <p className="t-sm mt-1 text-[var(--n-600)]">
            Feeds{" "}
            {downstream.map((link, i) => (
              <span key={link.module ?? link.code}>
                {i > 0 && ", "}
                <span className="font-medium text-[var(--n-800)]">{link.label}</span>
                {/* Parenthesised rather than greyed. The board can spend `--n-300` on this because
                    it is inside a white panel; on the canvas it measures 1,6:1, and §7.1 #5 says
                    never colour alone — the words already carry the whole meaning. */}
                {!link.built && " (not built)"}
              </span>
            ))}
          </p>
        )}
      </header>

      {/*
        A step this practice is not engaged for.

        The sidebar dims it and the board files it under a disclosure; this page said nothing, and
        offered a live run that spends money reading documents for a stage nobody was appointed to.
        The notice states it and offers to widen — it does not block, for the reason the board
        gives for setting these aside rather than hiding them.

        `stage` is null for a place a project *has* rather than a stage it runs (Corpus, Data,
        Details), and `withinStages` is true for those, so neither condition alone is enough.
      */}
      {stage && !withinStages(module, project.stages) && !elemental && (
        <OffStageNotice
          projectId={projectId}
          stageName={stage.name}
          phase={stage.number}
          runs={STAGES.filter((s) => stagesOf(project.stages).includes(s.number)).map((s) => s.name)}
        />
      )}

      {/* The agent runs where its inputs are collected — §1.3.2, retrieval is scoped to the
          module's own corpus. The panel appears wherever a module has a field set, which is what
          makes it a module that runs at all (`FIELD_SETS`); the other eight agents are this same
          panel with a different one.

          The run is read from the database rather than started fresh: §1.3.1 requires that a run in
          flight survive a reload, another tab and another machine, and that a signed one stay
          readable long afterwards. */}
      {elemental && (
        <div className="mt-6">
          <ElementalPlanPanel projectId={projectId} view={{ bill: elemental.bill, items: elemental.items, plan: elemental.plan, allowances: elemental.allowances, measure: elemental.measure }} />
        </div>
      )}

      {producesRuns(module) && (
        <FoldedRun folded={Boolean(elemental)}>
          {/*
            Two shapes of run, one place that decides which (§1.3.3). A step declares either a field
            set or an item set; the panels differ in what they render and in nothing else — same
            gate, same words about an outage, same one signature at the end.
          */}
          {producesItems(module) ? (
            <BillPanel
              projectId={projectId}
              module={module}
              heading={RUN_WORDING[module]?.heading ?? `Draft the ${item.label.toLowerCase()}`}
              blurb={RUN_WORDING[module]?.blurb ?? GENERIC_BLURB}
              blockedBy={blockingInputs(readiness)}
              waitingOn={readiness.upstreamPending}
              /*
                Whether a priced source is already on file. It is advisory, so it never appears in
                `blockedBy` — and the sign-off gate still needs to know, or it offers a QS a cost
                plan they filed an hour ago as the way out of an unpriced bill.
              */
              pricedSource={isSatisfied(readiness, "d1.2-rates")}
              drawings={module === "/bill" ? all.filter((d) => isSpatial(d.kind)).map((d) => ({ id: d.id, name: d.filename })) : []}
              bill={bill}
              signature={signature}
              signer={signerName}
            />
          ) : (
            <RunPanel
              projectId={projectId}
              module={module}
              fields={fieldsFor(module)}
              heading={RUN_WORDING[module]?.heading ?? `Extract the ${item.label.toLowerCase()} inputs`}
              blurb={RUN_WORDING[module]?.blurb ?? GENERIC_BLURB}
              blockedBy={blockingInputs(readiness)}
              waitingOn={readiness.upstreamPending}
              run={run}
              signature={signature}
              signer={signerName}
            />
          )}
        </FoldedRun>
      )}

      {/*
        The document a signed step produces – a payment certificate from a signed valuation – issued
        where the signature is.
      */}
      {signature && module === "/valuations" && run?.id === signature.runId && (
        <div className="mt-4">
          <IssueCertificate
            projectId={projectId}
            kind="payment_certificate"
            runId={signature.runId}
            label="Payment certificate"
            issued={await issuedFor(projectId, "payment_certificate", signature.runId)}
          />
        </div>
      )}

      {/*
        What the bill comes to — the reference build's BoQ Summary.

        **Under the grid rather than beside it**, which is the one place this departs from that
        design. The content column here is `max-w-[1280px]` inside a 240px sidebar, and with the
        advisor open at the §14 width it is about 700px: a fixed 320px panel beside a bill grid is
        precisely the squeeze `checks/viewport.mjs` exists to catch, and a media query would fire on
        the viewport when what is short is the container.
      */}
      {bill && bill.rows.length > 0 && (
        <div className="mt-6">
          <BillSummary projectId={projectId} rows={bill.rows} signed={Boolean(signature)} />
        </div>
      )}

      {/*
        What this step opened from, where it opened from another step's rows.

        A carried *field* shows its origin in the field table; a carried *bill* had nowhere to
        appear at all, so the signed rows reached the next step invisibly. It sits under the run
        panel because it is what the run is about to work on, and above the readiness list because
        it is a fact about this project rather than a requirement still to be met.
      */}
      {carried && (
        <CarriedSchedule
          projectId={projectId}
          from={carriesRowsFrom(module)!}
          fromLabel={labelOf(carriesRowsFrom(module)!)}
          rows={carried.rows}
          by={carried.by}
          at={carried.at}
        />
      )}

      {/*
        The comparison, under the schedule it prices.

        The order is the work: this is the bill we issued, and these are the prices that came back
        against it. Putting the tenders above the schedule would be a comparison with its subject
        off screen.
      */}
      {carried && (
        <TenderComparison
          projectId={projectId}
          rows={carried.rows}
          returns={returns}
          billTotal={billTotal(carried.rows, true).toString()}
        />
      )}
      {/* Then what the rows add up to: against our estimate, and between the tenderers (November meeting). */}
      {carried && <TenderEvaluation projectId={projectId} rows={carried.rows} returns={returns} />}

      <div className="mt-6 flex items-start gap-10">
        <div className="min-w-0 flex-1">
          <ReadinessList
            readiness={readiness}
            projectId={projectId}
            filedKinds={new Set(documents.map((d) => d.kind))}
            filedDocuments={documents}
          />
        </div>

        {/* The checklist, always in view. It is what a QS is actually working through, so it does
            not scroll away with the detail beside it. */}
        <ChecklistCard projectId={projectId} outcomes={readiness.outcomes} checks={checks} />
      </div>

    </div>
  );
}

/**
 * The document-reading run, folded away where the cost plan is revised from the bill.
 *
 * A project with a measured bill has its plan above; reading a separately filed cost plan is the
 * other way to arrive at one, still available, and no longer the first thing on the page – nor its
 * "waiting on the feasibility estimate", which a bill-fed plan does not wait on.
 */
function FoldedRun({ folded, children }: { folded: boolean; children: React.ReactNode }) {
  if (!folded) return <div className="mt-6">{children}</div>;
  return (
    <details data-region="folded-run" className="mt-6 rounded-[var(--r-lg)] border border-[var(--n-200)] px-4 py-3">
      <summary className="t-sm cursor-pointer font-medium text-[var(--n-700)]">Or read the plan from a filed cost plan document instead</summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}
