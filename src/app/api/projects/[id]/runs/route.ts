/**
 * A feasibility run — PLATFORM.md §1.3, §1.3.1, §1.3.2.
 *
 * ── Why the run is here and not in a server action ─────────────────────────────────────────
 *
 * It streams. Ten fields, each a retrieval and a model call, is tens of seconds, and a reader
 * should be checking the second answer while the seventh is still being read. Server actions
 * return once; a route handler can hand back a body that is still being written.
 *
 * ── Retrieval is scoped in the query, and that is not a detail ─────────────────────────────
 *
 * `search()` filters on `project_id` in SQL (§1.3.2). A figure from another scheme surfacing in
 * this one's cost plan is the failure that would end trust in the platform, and it is prevented by
 * the `where` clause rather than by asking a model nicely. The model only ever sees passages this
 * project's own documents produced.
 *
 * ── Nothing is signed by running it ────────────────────────────────────────────────────────
 *
 * §1.3.1: a run produces `proposed` values. What it writes here is exactly that — the record of what
 * the machine said, in the `proposed` map and nowhere else. They become `output`, readable by the
 * next step, only when a person signs them off, and no path through this file can sign anything.
 *
 * ── And the writing is not incidental to the streaming ─────────────────────────────────────
 *
 * Each field is written as it settles rather than at the end, for the same reason each is sent as it
 * settles: a run killed on the ninth field must not throw away eight answers somebody has already
 * paid for. The stream is what the reader watching sees; the rows are what everybody else sees,
 * including the same reader after a reload.
 */

import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db/client";
import { documents } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { costOf, ModelUnavailable, type Usage } from "@/lib/agent/deepseek";
import { itemSpecFor, type BillEvent, type ItemResult } from "@/lib/agent/bill";
import { extractField, type SourcePassage } from "@/lib/agent/extract";
import { decimalMarksOf, extractItems, freshItems } from "@/lib/agent/extract-items";
import { carryField } from "@/lib/agent/carry";
import {
  closeRun,
  openRun,
  recordField,
  signedModules,
} from "@/lib/agent/persist";
import { recordItems, SEQ_STEP } from "@/lib/agent/persist-bill";
import { activitySpecFor, type ActivityResult, type ProgrammeEvent } from "@/lib/agent/programme";
import { extractActivities, freshActivities } from "@/lib/agent/extract-activities";
import { recordActivities } from "@/lib/agent/persist-programme";
import { type RunEvent } from "@/lib/agent/run";
import { FIELD_SETS, fieldsFor, upstreamPending } from "@/lib/chain";
import { groundCriteria } from "@/lib/criteria-grounding";
import { readinessOfModule } from "@/lib/criteria-status";
import { criteriaForModule } from "@/lib/entry-criteria";
import { passagesOfDocuments, search, searchForExtraction } from "@/lib/ingest/retrieve";
import { listCriterionChecks } from "@/app/(app)/projects/[id]/actions";
import { enterEgressScope } from "@/lib/egress/scope";

/**
 * Sixty seconds — safe on any plan, and close to what a run actually takes.
 *
 * It was 300, the platform default on paid plans, which is a claim about this account's entitlement
 * that nothing here verifies; Hobby projects cap out well below it. Measured, a run is ten fields
 * at roughly a second each. A corpus big enough to exceed a minute wants the run split, not a
 * bigger number — a run killed mid-flight is the one outcome this route works hardest to avoid,
 * because it looks exactly like a corpus that had nothing to say.
 */
export const maxDuration = 60;

/**
 * How much corpus a bill run reads, and how it is split into model calls.
 *
 * ── Whole documents, not the best nine passages ────────────────────────────────────────────
 *
 * It read the nine passages that best matched a list of trade words, in threes. A bill is every item
 * in a document, so that was a sample: six of the Ridgeview specification's twenty-two clauses were
 * never shown to the model, and a measured bill of any length could never be read to the end. Now
 * the documents that measure the work – or, failing those, that describe it – are read passage by
 * passage in order (`ItemSpec.measured`, `ItemSpec.described`).
 *
 * Two passages a call, so a reply lists rather than summarises. Four calls at once, so a three-page
 * bill is read in about the time one call takes and a run stays inside `maxDuration`. The results
 * are written in document order all the same – a wave at a time, each wave in order – so rows land
 * in the grid in the order the bill prints them, and a run killed mid-way leaves the waves before it.
 */
const BILL_MAX_PASSAGES = 48;
const PASSAGES_PER_CALL = 2;
const CALLS_AT_ONCE = 4;

const refuse = (message: string, status: number) =>
  new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return refuse("Not signed in.", 401);

  const { id: projectId } = await params;

  /**
   * Which step is running, as a query parameter on the one route.
   *
   * Not a route per module. Vercel's Hobby plan allows twelve serverless functions and this app sits
   * at eleven — the reason three module *pages* became `[module]`. Nine agents are coming and each
   * would be a function; they are one route that is told which field set to run.
   *
   * The module is validated against `FIELD_SETS` rather than trusted. An unknown module would
   * otherwise open a run with an empty field set, close it as reviewable, and present a step that
   * had established nothing as one that had finished.
   */
  const step = new URL(request.url).searchParams.get("module") ?? "/feasibility";
  const fields = fieldsFor(step);
  /**
   * The other shape a run comes in — §1.3.3. Take-off, the bill and pricing propose *rows*, not a
   * fixed set of named scalars, so the step declares an `ItemSpec` instead of a `FieldSpec[]` and
   * the two branches below differ in what they write and in nothing else.
   */
  const itemSpec = itemSpecFor(step);
  // And the third: dated rows, read from the contractor's programme (D2.5).
  const activitySpec = activitySpecFor(step);
  if (fields.length === 0 && !itemSpec && !activitySpec) {
    return refuse(
      `There is no agent for ${step}. The steps that run are ${Object.keys(FIELD_SETS).join(", ")}.`,
      404,
    );
  }

  /**
   * No blank forms (§1.3, design rule 1). A run over an empty corpus can only return ten
   * `not_found`s, which reads as a broken agent rather than as an empty project — so it is refused
   * in words instead, before a single call is spent.
   */
  const filed = await db
    .select({ id: documents.id, filename: documents.filename, kind: documents.kind })
    .from(documents)
    .where(and(eq(documents.projectId, projectId), isNull(documents.deletedAt)));

  if (filed.length === 0) {
    return refuse(
      "Nothing is filed on this project yet, so there is nothing to read. File the documents this step needs and run it again.",
      409,
    );
  }

  /**
   * §1.3.1 — **the server owns whether a step may start.**
   *
   * The button on the panel has been disabled for missing inputs since it was built, and this route
   * checked only whether the corpus was empty. So one filed document of any kind was enough to run
   * the step from a console, past every requirement, and the result would have been indistinguishable
   * afterwards from a run somebody was entitled to make. "A client that decided its own prerequisites
   * could start a downstream step from nothing and call it approved" — it could.
   *
   * The two refusals are worded apart because only one of them can be cleared by uploading (§1.3.3):
   * an unsigned upstream is not something a document fixes, and telling a reader to file one would
   * send them to do work that changes nothing.
   */
  const wantedKinds = new Set(criteriaForModule(step).flatMap((c) => c.acceptedEvidence));
  const known = await groundCriteria(
    projectId,
    step,
    filed.filter((d) => wantedKinds.has(d.kind)),
    await listCriterionChecks(projectId),
  );
  const readiness = readinessOfModule(
    step,
    known,
    upstreamPending(step, await signedModules(projectId)),
  );

  if (readiness.upstreamPending.length > 0) {
    return refuse(
      `This step reads figures from ${readiness.upstreamPending.join(", ")}, and ${
        readiness.upstreamPending.length === 1 ? "it has" : "they have"
      } not been signed off. Nothing filed here clears that — sign the step above first.`,
      409,
    );
  }

  if (readiness.missingInputs.length > 0) {
    const names = readiness.missingInputs.map((o) => o.criterion.label).join(", ");
    return refuse(
      `${names} ${readiness.missingInputs.length === 1 ? "is" : "are"} still required. A run without ${
        readiness.missingInputs.length === 1 ? "it" : "them"
      } returns nothing for most fields, which reads as a broken agent rather than a missing document.`,
      409,
    );
  }

  const byId = new Map(filed.map((d) => [d.id, d]));

  const encoder = new TextEncoder();
  const spend: Usage = { input: 0, output: 0 };

  /**
   * The run exists before the first field does.
   *
   * Opened here rather than inside the stream so that a database that will not accept the run is a
   * refusal in words with an HTTP status on it, rather than an error event arriving down a stream
   * that has already told the browser everything is fine.
   */
  let runId: string;
  try {
    runId = await openRun(projectId, step, session.email);
  } catch (error) {
    return refuse(
      `The run could not be recorded, so it was not started: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
      503,
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Every model call this run makes is recorded against this project and person (ARC-005).
      enterEgressScope({ projectId, actor: session.email });
      const send =(event: RunEvent | BillEvent | ProgrammeEvent) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));

      /** A retrieval hit, with the document it belongs to. Both branches read the same way. */
      const passagesFor = async (terms: readonly string[], limit: number, loose = false) => {
        // Retrieve wider than the model is shown: spatial documents are dropped downstream, and
        // dropping them after the limit would leave the run with fewer passages than it could have.
        // `loose` for a field read: see `searchForExtraction` for why phrase-only retrieval missed
        // figures a document stated in its own words.
        const hits = loose
          ? (await searchForExtraction(projectId, terms, limit)).passages
          : await search(projectId, terms, limit);

        return hits.flatMap<SourcePassage>((hit) => {
          const document = byId.get(hit.documentId);
          // A passage whose document has been withdrawn since retrieval, or that belongs to another
          // project, has no business grounding anything.
          if (!document) return [];
          return [
            {
              documentId: hit.documentId,
              documentName: document.filename,
              documentKind: document.kind,
              page: hit.page,
              body: hit.body,
            },
          ];
        });
      };

      try {
        if (activitySpec) {
          /*
            Every passage of every programme filed, in order, batch by batch – a programme is a
            list and a list read out of order is a different programme. Nothing but a programme is
            read: a minute that says "brickwork now expected 14 Sept" is progress against the
            baseline, not the baseline.
          */
          const source = filed.filter((d) => activitySpec.programme.includes(d.kind)).map((d) => d.id);
          const passages = (await passagesOfDocuments(projectId, source, BILL_MAX_PASSAGES + 1)).flatMap<SourcePassage>((hit) => {
            const document = byId.get(hit.documentId);
            if (!document) return [];
            return [{ documentId: hit.documentId, documentName: document.filename, documentKind: document.kind, page: hit.page, body: hit.body }];
          });
          const unread = passages.length > BILL_MAX_PASSAGES;
          if (unread) passages.length = BILL_MAX_PASSAGES;

          const proposed: ActivityResult[] = [];
          let seq = SEQ_STEP;
          let discarded = 0;
          const batches: SourcePassage[][] = [];
          for (let at = 0; at < passages.length; at += PASSAGES_PER_CALL) batches.push(passages.slice(at, at + PASSAGES_PER_CALL));

          // In order, not in waves: the programme's order is the programme.
          for (const batch of batches) {
            const read = await extractActivities(activitySpec, batch);
            spend.input += read.usage.input;
            spend.output += read.usage.output;
            discarded += read.discarded;
            const fresh = freshActivities(proposed, read.activities);
            proposed.push(...fresh);
            seq = await recordActivities(runId, fresh, seq);
            for (const activity of fresh) send({ type: "activity", activity });
          }

          await closeRun(runId, "review", spend);
          send({
            type: "done",
            spend: { ...spend, rand: costOf(spend) },
            read: passages.length,
            ...(discarded > 0 ? { discarded } : {}),
            ...(unread ? { unread: true } : {}),
          });
          return;
        }

        /**
         * ── The row-shaped run — §1.3.3 ──────────────────────────────────────────────────
         *
         * The passages are read in batches rather than all at once, for the reason the field run
         * streams at all: a bill is long, a batch is a model call, and a run that stopped on the
         * third call must leave the rows from the first two on the screen and in the database.
         *
         * Deduplication is across the whole run, not within a batch. Two batches of passages
         * routinely describe the same work — a specification clause and a priced line for the same
         * item — and the same row twice is a bill that double-counts.
         */
        if (itemSpec) {
          /*
            What is read: the measured documents if any are filed, otherwise the descriptive ones –
            never both, which would propose every item twice in two wordings, and never a variation,
            a valuation or a cost report, whose lines look like bill items and are not.
          */
          const ofKinds = (kinds: readonly string[]) => filed.filter((d) => kinds.includes(d.kind)).map((d) => d.id);
          const measuredIds = ofKinds(itemSpec.measured);
          const source = measuredIds.length > 0 ? measuredIds : ofKinds(itemSpec.described);

          const passages = (await passagesOfDocuments(projectId, source, BILL_MAX_PASSAGES + 1)).flatMap<SourcePassage>(
            (hit) => {
              const document = byId.get(hit.documentId);
              if (!document) return [];
              return [
                {
                  documentId: hit.documentId,
                  documentName: document.filename,
                  documentKind: document.kind,
                  page: hit.page,
                  body: hit.body,
                },
              ];
            },
          );
          // One past the cap was asked for, so a document longer than a run reads is said, not hidden.
          const unread = passages.length > BILL_MAX_PASSAGES;
          if (unread) passages.length = BILL_MAX_PASSAGES;

          const marks = decimalMarksOf(passages);
          const headings = new Map<string, string>();
          const proposed: ItemResult[] = [];
          let seq = SEQ_STEP;
          let discarded = 0;
          // Cover-page lines the agent offered as work. Counted apart: a different fault, a
          // different remedy - see ItemExtraction.
          let furniture = 0;

          const batches: SourcePassage[][] = [];
          for (let at = 0; at < passages.length; at += PASSAGES_PER_CALL) {
            batches.push(passages.slice(at, at + PASSAGES_PER_CALL));
          }

          for (let wave = 0; wave < batches.length; wave += CALLS_AT_ONCE) {
            const reads = await Promise.all(batches.slice(wave, wave + CALLS_AT_ONCE).map((batch) => extractItems(itemSpec, batch, undefined, marks)));

            for (const read of reads) {
              spend.input += read.usage.input;
              spend.output += read.usage.output;
              discarded += read.discarded;
              furniture += read.furniture;

              const fresh = freshItems(proposed, read.items);
              proposed.push(...fresh);

              // Written before it is sent, as with a field: a reader who reloads the moment a row
              // appears must find it there.
              seq = await recordItems(runId, fresh, headings, seq);
              for (const item of fresh) send({ type: "item", item });
            }
          }

          await closeRun(runId, "review", spend);
          send({
            type: "done",
            spend: { ...spend, rand: costOf(spend) },
            read: passages.length,
            ...(discarded > 0 ? { discarded } : {}),
            ...(furniture > 0 ? { furniture } : {}),
            ...(unread ? { unread: true } : {}),
            from: measuredIds.length > 0 ? "measured" : "described",
          });
          return;
        }

        for (const [seq, field] of fields.entries()) {
          /**
           * A carried figure is not read again — §1.3.1.
           *
           * The unit count is in the brief, and a model asked for it a second time will sometimes
           * answer from a different sentence. On a project where somebody has already reviewed the
           * first answer and signed their name to it, that is two numbers for one fact with only
           * one of them approved — and nothing on the screen afterwards to say which a cost per unit
           * was divided by. So it comes from the frozen output, with the original citation, and no
           * model call is made or paid for.
           *
           * `loadSignedOutput` filters on `signed_at is not null`, so an unsigned upstream has
           * nothing to give. It cannot arise here — the readiness gate above already refused —
           * which is exactly why it is worth the query saying so as well.
           */
          if (field.carriedFrom) {
            // One implementation of carrying, shared with hand entry (`lib/agent/carry.ts`).
            const { result, carried } = await carryField(projectId, { ...field, carriedFrom: field.carriedFrom });
            await recordField(runId, seq, result, carried);
            send({ type: "field", result });
            continue;
          }

          // The label joins the terms: "Programme duration" is itself the vocabulary a document
          // uses, and it is the one phrase every field is guaranteed to have.
          const passages = await passagesFor([field.label, ...field.terms], 12, true);

          const { result, usage } = await extractField(field, passages);
          spend.input += usage.input;
          spend.output += usage.output;

          // Written before it is sent. A reader who reloads the moment a row appears must find it
          // there; the other ordering has a window in which the screen knows something the
          // database does not.
          await recordField(runId, seq, result);
          send({ type: "field", result });
        }

        await closeRun(runId, "review", spend);
        send({ type: "done", spend: { ...spend, rand: costOf(spend) } });
      } catch (error) {
        /**
         * §1.3 — an outage is surfaced, never a silent gap.
         *
         * The fields already sent stay on screen; they were read and grounded. What must not happen
         * is the remaining fields arriving as `not_found`, because that is the platform reporting
         * an absence in the documents when the truth is that it stopped being able to ask.
         *
         * The run is closed as `failed` with the same words, so that the reader who comes back to
         * this project tomorrow gets the explanation too. A failure reported only at the moment it
         * happens is a failure nobody knows about a day later.
         */
        const said =
          error instanceof ModelUnavailable ? error.message : `The run stopped: ${plainly(error)}`;

        // Never inside the same try: a database that has gone away would replace the model's
        // explanation with its own, and the model's is the one the reader can act on.
        await closeRun(runId, "failed", spend, said).catch(() => {});
        send({ type: "error", error: said });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      // Proxies that buffer would hold every event until the run finished, which is the one thing
      // streaming exists to prevent.
      "x-accel-buffering": "no",
    },
  });
}

/**
 * An error in words the reader can act on.
 *
 * ── Why a database error may not be printed ────────────────────────────────────────────────
 *
 * A `postgres` error's `message` is the failed statement: the column list, the placeholders and
 * the parameter values. A run that died on a bad insert put a full page of SQL on a quantity
 * surveyor's screen, above their own figures, and the one thing that page did not contain was
 * anything they could do about it.
 *
 * §1.3 says an outage is surfaced and never silent — it does not say the reader has to read the
 * query. So the statement goes to the server log, where it is the right level of detail for the
 * person who can fix it, and the screen gets the fact plus the reassurance that matters: nothing
 * they signed was touched.
 *
 * A model outage is untouched. `ModelUnavailable` already carries a sentence written for a reader,
 * which is why it is handled before this is reached.
 */
function plainly(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";

  // `postgres` and `pg` both put a SQLSTATE on the error. Nothing else this route throws has one.
  const code = (error as { code?: unknown }).code;

  if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) {
    console.error(`[run] database error ${code}`, error);
    return (
      `the platform could not save what it read (database error ${code}). This is a fault in the ` +
      "platform, not in your documents. Nothing already signed off has been changed — run the " +
      "step again, and if it stops here a second time the code above identifies it in the log."
    );
  }

  return error.message;
}
