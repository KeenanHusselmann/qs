/**
 * Grounding a module's entry criteria against the project corpus — PLATFORM.md §1.3.2, §1.3.3.
 *
 * ── Why this is not in the module page any more ────────────────────────────────────────────
 *
 * It lived in `module-page.tsx` and was imported from there by the project overview, which was
 * already a component file being used as a library. The run route needs the same answer — it is
 * what decides whether a step may start, and §1.3.1 puts that decision on the server rather than in
 * a disabled button — and a route handler importing a `.tsx` file to get at one function is how a
 * React tree ends up in a request path that renders nothing.
 *
 * The logic is unchanged. Only its address is.
 */

import type { CriterionOutcome } from "@/lib/criteria-status";
import { criteriaForModule } from "@/lib/entry-criteria";
import { coverageOf } from "@/lib/documents/coverage";
import { isSpatial } from "@/lib/ingest/document-class";
import { excerpt, phrasesFor, search } from "@/lib/ingest/retrieve";
import type { CriterionCheck } from "@/db/schema";

/**
 * The three columns grounding reads, rather than a whole document row.
 *
 * The run route selects exactly these — it has no use for byte sizes or storage keys before it runs
 * — and a function that demanded the full row would force a wider query for nothing.
 */
export interface GroundableDocument {
  id: string;
  filename: string;
  kind: string;
}

/**
 * Ground each criterion against the corpus — §1.3.2's retrieve and ground steps.
 *
 * Two signals, answering different questions: the document's **kind** says something of the right
 * sort is filed; a **retrieved passage** says the corpus actually contains the words the criterion
 * is about, and supplies the citation. A kind match with no passage behind it is `uncertain`, never
 * `satisfied` — §1.3.2, a value the agent cannot ground it does not assert.
 */
export async function groundCriteria(
  projectId: string,
  module: string,
  documents: readonly GroundableDocument[],
  checks?: ReadonlyMap<string, CriterionCheck>,
): Promise<Map<string, CriterionOutcome>> {
  const byId = new Map(documents.map((d) => [d.id, d]));
  const known = new Map<string, CriterionOutcome>();

  // What the model read out of documents whose phrases did not match — see `documents/coverage.ts`.
  // One query for the module, not one per criterion.
  const covering = await coverageOf(documents.map((d) => d.id));

  for (const criterion of criteriaForModule(module)) {
    const kindMatch = documents.find((d) => criterion.acceptedEvidence.includes(d.kind));
    const phrases = phrasesFor(criterion);

    /**
     * Several hits, not one — because the best passage in the corpus is not always in a document
     * this criterion accepts.
     *
     * Taking the single top hit and testing its kind was the first version, and it failed the moment
     * there were six documents on a project: a tender report was filed under exactly the right kind,
     * and the *contract* outranked it for those words because it says "the accepted **tender
     * amount**". The criterion had its evidence and reported that it did not.
     *
     * So retrieval is asked for a handful and the best hit **from an accepted document** is the one
     * that grounds it. Ranking still decides which passage is quoted; it no longer decides whether
     * the criterion is met at all.
     */
    const hits = await search(projectId, phrases, 8);

    /**
     * A passage grounds a criterion only when it comes from a document the criterion **accepts**.
     *
     * ── Why the kind has to be checked here ────────────────────────────────────────────────
     *
     * Retrieval is project-wide, and it used to be enough on its own: any document containing the
     * criterion's phrases satisfied it, whatever that document was. That is too loose for a gate,
     * and it failed three times in one afternoon while modules were being added —
     *
     *   - a concept-layouts document saying "the standard assumed in **the cost plan**" satisfied
     *     *Priced cost plan*, so the step reported it had an estimate nobody had filed;
     *   - a JBCC contract saying "the accepted **tender amount**" satisfied *Tender returns*;
     *   - each time the response was to narrow the search phrases, which makes real documents
     *     harder to find in order to stop wrong ones matching — exactly backwards.
     *
     * §1.3.3 already says what satisfies a criterion: `acceptedEvidence`. "Site and market data may
     * arrive as a geotechnical report, a fee schedule or a market study" — *those* documents, not
     * any document that happens to use the words. So both signals are now required: the corpus
     * contains the words **and** they are in a document of a kind this criterion asked for.
     *
     * The row's own upload files under the criterion's primary kind by construction, so filing from
     * a blocked step always satisfies it. What no longer happens is a step going green because
     * something else in the corpus mentioned it in passing.
     *
     * ── Drawings, for the reason they always were ──────────────────────────────────────────
     *
     * §1.3.2 — a passage from a drawing is a title block. Grounding on it would tick "Site location
     * and extent" off the words "PROJECT LOCATION" stamped in a corner. Discounted here, before
     * anything else looks at it: testing it further down once let a project whose only hit came from
     * a drawing reach a non-null assertion and 500 the whole module page.
     */
    const usable = hits.find((hit) => {
      const kind = byId.get(hit.documentId)?.kind ?? "";
      return criterion.acceptedEvidence.includes(kind) && !isSpatial(kind);
    });

    if (usable) {
      const source = byId.get(usable.documentId);
      known.set(criterion.id, {
        criterion,
        state: "satisfied",
        evidence: {
          documentId: usable.documentId,
          document: source?.filename ?? "Filed document",
          page: usable.page ?? undefined,
          quote: excerpt(usable.body, phrases),
          confidence: usable.rank,
        },
      });
      continue;
    }

    // A hand tick, with nobody's document behind it. §1.3.3 — recorded as `declared` and never
    // as `satisfied`, and only clearing the gate where the criterion allows it to be declared.
    const check = checks?.get(criterion.id);
    if (!kindMatch) {
      if (check && criterion.declarable) {
        known.set(criterion.id, {
          criterion,
          state: "declared",
          declaredBy: check.checkedBy,
          declaredReason: check.note ?? undefined,
        });
      }
      continue;
    }

    /**
     * A drawing the criterion asked for **is** the evidence — §1.3.3.
     *
     * ── The bug this fixes, which a run found rather than a reading ────────────────────────
     *
     * "Concept layouts" accepts Concept drawings, Unit plans, Typology schedule and Site development
     * plan, and the upload on its row files under the first — which is spatial. A spatial document's
     * passages never ground anything (§1.3.2, and rightly: a site plan's text is a title block, and
     * "PROJECT LOCATION" stamped in a corner would otherwise tick a site-location criterion). So the
     * criterion fell through to `uncertain`, `uncertain` is not resolved, mandatory-and-unresolved is
     * blocking — and the feasibility step could **never be started through the interface**, however
     * many drawings a QS filed. The button had been disabled for that reason since it was built, and
     * nothing said why.
     *
     * The mistake was reading §1.3.2's rule too widely. It governs **quoting**: a value asserted on
     * the strength of a passage lifted out of a title block is not grounded. It says nothing about a
     * criterion that *names a drawing as the evidence it wants*. There, the document is the answer,
     * and "no passage matched" carries no information at all — a drawing has no passage to match, by
     * definition, which the message below already admitted while still blocking on it.
     *
     * So a spatial document filed under a kind this criterion accepts satisfies it, and the evidence
     * line says plainly that it will be measured rather than quoted. What has **not** changed is the
     * thing §1.3.2 was protecting: a retrieved passage from a drawing is still discarded above, so
     * nothing is ever satisfied by a title block that happened to match.
     */
    if (isSpatial(kindMatch.kind)) {
      known.set(criterion.id, {
        criterion,
        state: "satisfied",
        evidence: {
          documentId: kindMatch.id,
          document: kindMatch.filename,
          quote: `Filed as ${kindMatch.kind} — measured by take-off rather than read, so there is no passage to quote.`,
          confidence: 0,
        },
      });
      continue;
    }

    /*
      Filed as the right kind, no phrase matched — but the document was read and it covers this.

      The tester's case: a sales outlook filed as a Market study, stating the absorption rate, that
      never said "market study". The quote was located in the document before it was stored, so the
      evidence line is the document's own words, as with a phrase match.
    */
    const read = covering.find(
      (row) =>
        row.criterionId === criterion.id &&
        criterion.acceptedEvidence.includes(byId.get(row.documentId)?.kind ?? ""),
    );
    if (read?.quote) {
      known.set(criterion.id, {
        criterion,
        state: "satisfied",
        evidence: {
          documentId: read.documentId,
          document: byId.get(read.documentId)?.filename ?? "Filed document",
          page: read.page ?? undefined,
          quote: read.quote,
          confidence: 0,
        },
      });
      continue;
    }

    // Filed as the right kind, but nothing in its text matched. Said plainly rather than counted
    // as satisfied — the document may be a scan, or may simply not cover this.
    known.set(criterion.id, {
      criterion,
      state: "uncertain",
      evidence: {
        documentId: kindMatch.id,
        document: kindMatch.filename,
        quote: `Filed as ${kindMatch.kind}, but no passage in it matches this criterion.`,
        confidence: 0,
      },
    });
  }

  return known;
}
