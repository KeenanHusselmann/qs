/**
 * The firm's standards, and how the advisor is held to them.
 *
 * ── A policy is not a project document, and must not read like one ─────────────────────────
 *
 * The corpus answers "what does this scheme say". A policy answers "what does this practice
 * require", and the difference is the whole reason this is a separate channel rather than more
 * passages. *"Your brief states a 36-month programme"* and *"the firm requires a programme before
 * a cost plan is signed"* are different kinds of sentence: one is a fact about the reader's job,
 * the other is an obligation on it. A panel that ran them together would leave a QS unable to tell
 * which of two statements they are allowed to disagree with.
 *
 * ── Guardrail, in the only sense that is honest ────────────────────────────────────────────
 *
 * "Guardrail" is usually a claim that a model has been prevented from saying something. This is
 * the weaker and more defensible version: the relevant standards are **put in front of it** before
 * it answers, and shown to the reader beside the answer. The model is not trusted to enforce the
 * policy — the reader is, and they can see what they are enforcing it against.
 *
 * What is actually prevented is narrower and mechanical: the advisor still may not state a figure,
 * a policy quote is rendered verbatim rather than paraphrased, and a policy the firm has withdrawn
 * is never retrieved.
 *
 * ── Firm-wide, and that is the point ───────────────────────────────────────────────────────
 *
 * `search()` scopes to one project in SQL. This deliberately does not: a standard applies to every
 * job, and retrieving it is not a leak because a policy is the firm's own words, filed by the firm,
 * for exactly this. The separation is structural — different tables — so neither query can reach
 * the other's rows by accident.
 */

import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { policies, policyPassages } from "@/db/schema";
import { fence } from "@/lib/egress/fence";

export interface PolicyCitation {
  policyId: string;
  /** The standard's name, as the firm filed it. */
  title: string;
  /** What it governs. */
  kind: string;
  /** Null where the firm filed it without one — said, never guessed at. */
  effectiveFrom: string | null;
  quote: string;
  page: number | null;
}

/**
 * The standards bearing on a question.
 *
 * Ranked by `ts_rank` like the corpus, and capped low on purpose: two relevant standards are
 * guidance and six are a reading list. A reader who is shown everything checks nothing.
 */
export async function searchPolicies(
  terms: readonly string[],
  limit = 3,
): Promise<PolicyCitation[]> {
  if (terms.length === 0) return [];

  const query = terms.map((term) => `"${term.replace(/"/g, "")}"`).join(" or ");
  const vector = sql`${policyPassages}.search`;
  const tsquery = sql`websearch_to_tsquery('english', ${query})`;

  const rows = await db
    .select({
      policyId: policies.id,
      title: policies.title,
      kind: policies.kind,
      effectiveFrom: policies.effectiveFrom,
      page: policyPassages.page,
      body: policyPassages.body,
      rank: sql<number>`ts_rank(${vector}, ${tsquery})`,
    })
    .from(policyPassages)
    .innerJoin(policies, eq(policies.id, policyPassages.policyId))
    /*
      A withdrawn policy is never retrieved.

      It is kept — it is what advice was given under last month, and deleting it would rewrite the
      record — but advising *from* it would be advising from a standard the firm has replaced.
    */
    .where(and(sql`${vector} @@ ${tsquery}`, isNull(policies.deletedAt)))
    .orderBy(desc(sql`ts_rank(${vector}, ${tsquery})`))
    .limit(limit);

  return rows.map((row) => ({
    policyId: row.policyId,
    title: row.title,
    kind: row.kind,
    effectiveFrom: row.effectiveFrom,
    page: row.page,
    quote: row.body.trim(),
  }));
}

/** Every standard the firm currently holds, newest first. */
export async function listPolicies() {
  return db
    .select({
      id: policies.id,
      title: policies.title,
      kind: policies.kind,
      filename: policies.filename,
      effectiveFrom: policies.effectiveFrom,
      filedBy: policies.filedBy,
      createdAt: policies.createdAt,
    })
    .from(policies)
    .where(isNull(policies.deletedAt))
    .orderBy(desc(policies.createdAt));
}

/**
 * The standards, as the model is shown them.
 *
 * Marked as binding, and marked as *not* this project's documents. A model handed a policy without
 * that distinction will cite it as though the client had written it, which is how a firm standard
 * comes to be reported back to a client as their own requirement.
 */
export function policyText(citations: readonly PolicyCitation[]): string {
  if (citations.length === 0) return "";

  return [
    "THE FIRM'S OWN STANDARDS — these bind the advice. They are NOT this project's documents:",
    ...citations.map(
      (c, i) =>
        fence(`[P${i + 1}] ${c.title} (${c.kind}${c.effectiveFrom ? `, effective ${c.effectiveFrom}` : ", no effective date filed"})`, c.quote),
    ),
  ].join("\n\n");
}
