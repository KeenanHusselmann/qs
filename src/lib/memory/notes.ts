/**
 * Storing and searching the advisor's notes – `lib/agent/memory.ts` says what they are for.
 *
 * ── Recall is by words, and asks for more than one ─────────────────────────────────────────
 *
 * Full-text search, as the corpus and the policies use: a construction question is full of exact
 * words ("CEM II", "42,5N", "stock brick") that a lexical index finds and an embedding blurs. A note
 * is recalled when it shares enough of the question's significant words (`wordsNeeded`), counting
 * "cost" and "price" as one word, and the best few are ranked by how many they share, then by
 * `ts_rank`. A recalled note that does not answer the question is not shown: the model is told to
 * ignore it, and only the notes it uses reach the panel.
 */

import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { advisorNotes } from "@/db/schema";
import { MAX_RECALLED, questionKey, webNote, wordsNeeded, type RecalledNote } from "@/lib/agent/memory";
import type { WebAnswer } from "@/lib/agent/search";
import { significantWords } from "@/lib/ingest/retrieve";

/** Words every South African construction question shares, which say nothing about what it is about. */
const MEMORY_NOISE = new Set([
  "south", "africa", "african", "zar", "rand", "rands", "what", "how", "much", "does", "are", "can", "which",
  "current", "currently", "the", "get", "need",
]);
const MAX_WORDS = 10;

/**
 * Words a reader uses for the same thing. "cement cost" has to find a note saved for "cement bag
 * prices": the stemmer joins "price" and "prices", but not "cost" and "price".
 */
const SAME_THING: readonly (readonly string[])[] = [
  ["cost", "costs", "price", "prices", "pricing", "rate", "rates"],
  ["supplier", "suppliers", "merchant", "merchants", "store", "stores"],
];

function withSynonyms(words: readonly string[]): string[][] {
  return words.map((word) => [...new Set([word, ...(SAME_THING.find((group) => group.includes(word)) ?? [])])]);
}

/**
 * Keep a web finding. The same question asked again replaces the older finding – a price found today
 * supersedes the one found last month – and the older row is soft-deleted rather than overwritten, so
 * what the advisor said then is still on record.
 */
export async function rememberWeb(question: string, found: WebAnswer, savedBy: string): Promise<void> {
  const key = questionKey(question);
  if (key.length === 0 || found.sources.length === 0) return;

  const { title, body } = webNote(question, found);

  await db.transaction(async (tx) => {
    await tx
      .update(advisorNotes)
      .set({ deletedAt: new Date() })
      .where(and(eq(advisorNotes.kind, "web"), eq(advisorNotes.questionKey, key), isNull(advisorNotes.deletedAt)));

    await tx.insert(advisorNotes).values({
      kind: "web",
      question: question.trim(),
      questionKey: key,
      title,
      body,
      structured: found.structured,
      sources: found.sources,
      savedBy,
    });
  });
}

/** The notes bearing on a question, best first, coded M1.. for the model to cite. */
export async function recallNotes(question: string, limit = MAX_RECALLED): Promise<RecalledNote[]> {
  const words = significantWords([question])
    .filter((word) => !MEMORY_NOISE.has(word))
    .slice(0, MAX_WORDS);
  if (words.length === 0) return [];

  const vector = sql`${advisorNotes}.search`;
  const groups = withSynonyms(words);
  // One point per word of the question the note contains, counting a synonym as the word. A stop
  // word's query is empty and matches nothing, so a word the index ignores cannot count.
  const matched = sql<number>`(${sql.join(
    groups.map((group) => sql`(${vector} @@ websearch_to_tsquery('english', ${group.join(" or ")}))::int`),
    sql` + `,
  )})`;
  const anyWord = sql`websearch_to_tsquery('english', ${groups.flat().join(" or ")})`;
  const needed = wordsNeeded(words.length);

  const rows = await db
    .select({
      id: advisorNotes.id,
      kind: advisorNotes.kind,
      question: advisorNotes.question,
      title: advisorNotes.title,
      body: advisorNotes.body,
      structured: advisorNotes.structured,
      sources: advisorNotes.sources,
      savedAt: advisorNotes.savedAt,
      matched,
    })
    .from(advisorNotes)
    .where(and(isNull(advisorNotes.deletedAt), sql`${vector} @@ ${anyWord}`, sql`${matched} >= ${needed}`))
    .orderBy(desc(matched), desc(sql`ts_rank(${vector}, ${anyWord})`), desc(advisorNotes.savedAt))
    .limit(limit);

  return rows.map((row, index) => ({
    code: `M${index + 1}`,
    id: row.id,
    kind: row.kind,
    question: row.question,
    title: row.title,
    body: row.body,
    structured: row.structured ?? null,
    sources: row.sources ?? [],
    savedAt: row.savedAt.toISOString(),
  }));
}

/** Stop recalling a note. Soft, so what the advisor once said from it is still on record. */
export async function forgetNote(id: string): Promise<boolean> {
  const rows = await db
    .update(advisorNotes)
    .set({ deletedAt: new Date() })
    .where(and(eq(advisorNotes.id, id), isNull(advisorNotes.deletedAt)))
    .returning({ id: advisorNotes.id });
  return rows.length > 0;
}
