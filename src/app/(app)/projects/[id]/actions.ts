"use server";

/**
 * Reading and removing a project's documents.
 *
 * **Filing is not here.** It moved to a route handler — server actions buffer the whole request
 * body and cap it at 1 MB, and a market study in the reference corpus is 22 MB. See
 * `src/app/api/projects/[id]/documents/route.ts`.
 */

import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth";
import { db } from "@/db/client";
import { criterionChecks, documents, runs, type ProjectDocument } from "@/db/schema";
import { nameOf } from "@/lib/signers";
import { discard } from "@/lib/ingest/storage";

export async function listDocuments(projectId: string): Promise<ProjectDocument[]> {
  await requireSession();

  return db
    .select()
    .from(documents)
    .where(and(eq(documents.projectId, projectId), isNull(documents.deletedAt)))
    .orderBy(desc(documents.createdAt));
}

/**
 * Soft delete — the row stays, so a run that cited it still resolves (§13.4).
 *
 * Revalidated as a **layout**, which covers the whole project subtree rather than only the page the
 * button was on. A withdrawn document has to leave Site & zoning, Project inputs, the feasibility
 * estimate and the import review at the same moment: they are four views of one corpus, and a
 * document gone from one and present in another is worse than one present in all four, because the
 * reader now has to work out which page is lying.
 */
export async function removeDocument(projectId: string, documentId: string): Promise<void> {
  await requireSession();

  await db.update(documents).set({ deletedAt: new Date() }).where(eq(documents.id, documentId));

  revalidatePath(`/projects/${projectId}`, "layout");
}

/**
 * Delete every document on a project. **Not a withdrawal — the rows and the files go.**
 *
 * ── Why this exists ────────────────────────────────────────────────────────────────────────
 *
 * A corpus arrives as a folder, and the first attempt is often the wrong one: the wrong folder, a
 * whole client drive instead of one submission, forty documents filed under kinds guessed before
 * anybody looked. Undoing that one at a time is forty clicks with no way to be sure you got them
 * all, and "start again" is the honest thing a person wants at that point.
 *
 * ── Why it deletes rather than withdraws ───────────────────────────────────────────────────
 *
 * It withdrew, on the reading that §13.4 never hard-deletes. That is the right rule for a document
 * somebody decided to retire, and the wrong one for a mistaken import: after four attempts at the
 * same folder this project held 298 rows to show 54 documents, and every withdrawn one kept its
 * stored original too. A false start is not history worth keeping — it is a folder dropped twice.
 *
 * So the two acts are now genuinely different, which is what makes either of them meaningful:
 *
 *  - **Withdraw** one document — soft. The row stays, the file stays, anything that cited it still
 *    resolves. This is the archive, and it is the one to use for a document that mattered.
 *  - **Start again** — hard. Rows, passages and stored bytes are gone and the space with them.
 *
 * ── And it stops at a signature ────────────────────────────────────────────────────────────
 *
 * The cost of the hard delete was always that nothing citing a deleted document resolves afterwards.
 * That was survivable while runs lived in a browser tab. It is not survivable now: a signed output
 * is a figure somebody put their name to, and §1.3.2's promise is that the citation under it can be
 * checked by opening the document. Deleting the document turns a defensible figure into a bare
 * number with a name attached — the exact thing §1.3.1 calls worse than a gap, because it survives
 * review looking checked.
 *
 * So a project with a signed run refuses, in words, and Withdraw remains available for every
 * document individually. Withdrawal is soft: the row and the file stay, and the citation still
 * resolves.
 *
 * Returns how many went, or the refusal, so the screen can say what happened rather than go quiet.
 */
export async function removeAllDocuments(
  projectId: string,
): Promise<{ deleted: number } | { refused: string }> {
  await requireSession();

  const [signed] = await db
    .select({ module: runs.module, signedBy: runs.signedBy })
    .from(runs)
    .where(and(eq(runs.projectId, projectId), isNotNull(runs.signedAt)))
    .limit(1);

  if (signed) {
    return {
      refused: `This project has a signed-off run — ${signed.module.replace("/", "")}, signed by ${await nameOf(signed.signedBy)}. Its figures cite these documents, and a signed figure whose document is gone cannot be checked by anybody. Withdraw documents one at a time instead: that keeps the record and the file.`,
    };
  }

  /**
   * The stored originals go first, while the rows still say where they are.
   *
   * Deleting the rows alone would leave the bytes in the store with nothing pointing at them:
   * invisible, unattributable, and still being paid for — which is the opposite of what someone
   * emptying a corpus is asking for.
   */
  const stored = await db
    .select({ location: documents.storageLocation })
    .from(documents)
    .where(eq(documents.projectId, projectId));

  for (const { location } of stored) {
    if (location) await discard(location);
  }

  // `passages` carries `on delete cascade`, so it goes with them.
  const deleted = await db
    .delete(documents)
    .where(eq(documents.projectId, projectId))
    .returning({ id: documents.id });

  revalidatePath(`/projects/${projectId}`, "layout");

  return { deleted: deleted.length };
}

/**
 * Ticking a required input off by hand — PLATFORM.md §1.3.3.
 *
 * The signer is taken from the session, never from the form. A tick's whole value is that it names
 * someone, and a name a client can post is a name anyone can put in someone else's mouth.
 */
export async function setCriterionChecked(
  projectId: string,
  criterionId: string,
  checked: boolean,
): Promise<void> {
  const session = await requireSession();

  if (checked) {
    await db
      .insert(criterionChecks)
      .values({ projectId, criterionId, checkedBy: session.email })
      // Ticking something already ticked keeps the first person's name and time — the record of
      // who first vouched for it is the one worth having.
      .onConflictDoNothing();
  } else {
    await db
      .delete(criterionChecks)
      .where(
        and(eq(criterionChecks.projectId, projectId), eq(criterionChecks.criterionId, criterionId)),
      );
  }

  /*
    The whole project, not the overview alone.

    Without the layout scope this revalidated `/projects/[id]` and nothing under it — so a tick made
    on a *step* page saved and the step page's own payload stayed as it was. The checkbox showed the
    tick optimistically, dropped it the moment the action returned and the optimistic value was
    cleared, and it reappeared later when something else revalidated: a tick that ticks, vanishes and
    comes back. Every other action here already revalidates the layout, for the same reason.
  */
  revalidatePath(`/projects/${projectId}`, "layout");
}

/** Every tick on a project, by criterion id. */
export async function listCriterionChecks(projectId: string) {
  await requireSession();

  const rows = await db
    .select()
    .from(criterionChecks)
    .where(eq(criterionChecks.projectId, projectId));

  return new Map(rows.map((row) => [row.criterionId, row]));
}
