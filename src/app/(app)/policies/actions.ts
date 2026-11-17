"use server";

/**
 * Filing and withdrawing the firm's standards.
 *
 * ── The same pipeline as a project document, on purpose ────────────────────────────────────
 *
 * A policy is parsed and chunked by `parseDocument` and `splitIntoPassages` — the functions the
 * project corpus uses. A second chunker would drift from the first, and the day it did, a policy
 * would retrieve differently from the documents it is meant to govern.
 *
 * What is *not* shared is where the rows land. Policies have their own tables so a project search
 * cannot reach them and a policy search cannot reach a project (see `lib/agent/policy.ts`).
 */

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { policies, policyPassages } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { parseDocument } from "@/lib/ingest/parse";
import { splitIntoPassages } from "@/lib/ingest/split";
import { plausibleDate } from "@/lib/policies/effective-date";

export interface FileOutcome {
  ok: boolean;
  /** Why it was refused, in the words a reader can act on. */
  reason?: string;
}

/**
 * File a standard.
 *
 * Refuses rather than files an empty one: a policy the parser could read nothing from would sit in
 * the list looking filed, be retrieved by nothing, and quietly govern no advice at all. A stated
 * refusal sends somebody to convert it; a silent success does not.
 */
export async function filePolicy(form: FormData): Promise<FileOutcome> {
  const session = await requireSession();

  const file = form.get("file");
  const title = String(form.get("title") ?? "").trim();
  const kind = String(form.get("kind") ?? "").trim();
  const effectiveFrom = String(form.get("effectiveFrom") ?? "").trim();

  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, reason: "No file was chosen." };
  }
  if (title.length === 0) {
    return { ok: false, reason: "A standard needs a name — it is what the advisor cites it by." };
  }
  if (kind.length === 0) {
    return { ok: false, reason: "Say what the standard governs, so the advisor can name it." };
  }

  /*
    An effective date the firm could not have adopted.

    A date input hands back whatever its segments hold, and a mistyped year arrives as a plausible
    string — `60115-02-19` was filed and displayed as an effective date before this check existed.
    A standard is dated so a reader can tell current from superseded, and a nonsense date defeats
    exactly that, quietly, while looking filed.

    The window is deliberately wide. It is not the platform's business which year a practice
    adopted a standard; it is the platform's business that the year is one.
  */
  if (effectiveFrom.length > 0 && !plausibleDate(effectiveFrom)) {
    return {
      ok: false,
      reason: `"${effectiveFrom}" is not a date a standard could have taken effect on. Leave it blank if it is not known — the list says so rather than guessing.`,
    };
  }

  const parsed = await parseDocument(file.name, new Uint8Array(await file.arrayBuffer()));
  const passages = splitIntoPassages(parsed);

  if (passages.length === 0) {
    return {
      ok: false,
      reason:
        "Nothing could be read out of that file, so it would be filed and govern nothing. If it is a scan, it needs a text layer.",
    };
  }

  const [policy] = await db
    .insert(policies)
    .values({
      title,
      kind,
      filename: file.name,
      body: passages.map((p) => p.text).join("\n\n"),
      // A date the firm did not give is left null and said so on the page. An invented one would
      // make a standard of unknown vintage look current.
      effectiveFrom: effectiveFrom.length > 0 ? effectiveFrom : null,
      filedBy: session.email,
    })
    .returning({ id: policies.id });

  await db.insert(policyPassages).values(
    passages.map((passage) => ({
      policyId: policy.id,
      seq: passage.index,
      page: passage.page ?? null,
      body: passage.text,
    })),
  );

  revalidatePath("/policies");
  return { ok: true };
}

/**
 * Withdraw a standard.
 *
 * Soft, and the passages stay. A withdrawn policy is what advice was given under last month, and
 * deleting it would rewrite that record — but `searchPolicies` will not retrieve it, so nothing is
 * advised from a standard the firm has replaced.
 */
export async function withdrawPolicy(id: string): Promise<void> {
  await requireSession();
  await db.update(policies).set({ deletedAt: new Date() }).where(eq(policies.id, id));
  revalidatePath("/policies");
}
