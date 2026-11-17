"use server";

/**
 * Editing, archiving and deleting a project — PLATFORM.md §4.4.
 *
 * ── Archive and delete are different acts ──────────────────────────────────────────────────
 *
 * **Archiving** is a status: finished work a practice keeps. Still readable, still citable, out of
 * the working list. **Deleting** is a soft delete: this should not have existed. §13.4 says nothing
 * is ever really gone, so the row and everything under it stay resolvable — a certificate that
 * cited a document must not become a dangling reference because someone tidied a list.
 *
 * Keeping them separate matters because they answer different questions, and a single "remove"
 * would make "we finished this in 2024" indistinguishable from "I typed this by mistake".
 */

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireSession } from "@/lib/auth";
import { db } from "@/db/client";
import { projects } from "@/db/schema";
import { PROJECT_STATUSES, type ProjectStatus } from "@/lib/project-status";
import { STAGES, readStages, stagesOf } from "@/lib/stages";

export interface UpdateProjectResult {
  error?: string;
  saved?: boolean;
}

export async function updateProject(
  _previous: UpdateProjectResult | null,
  formData: FormData,
): Promise<UpdateProjectResult> {
  await requireSession();

  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim();
  const client = String(formData.get("client") ?? "").trim();
  const status = String(formData.get("status") ?? "") as ProjectStatus;
  const region = String(formData.get("region") ?? "").trim();

  if (!id) return { error: "No project" };
  if (!name) return { error: "Give the project a name" };
  if (!PROJECT_STATUSES.includes(status)) return { error: "Choose a status from the list" };

  /*
    The stages this project runs.

    They were settable at creation and nowhere else, while the overview carried a "Change" link to
    this page — a promise the form could not keep. An engagement is the thing about a project most
    likely to be entered wrongly and most likely to grow: a practice taken on for a feasibility is
    appointed for the cost planning three months later, and until now that meant a new project.

    Narrowing is safe by construction. A step outside the stages is **set aside, not deleted** —
    the board files it under a disclosure and the sidebar dims it — so a signature made under a
    wider engagement stays signed, stays readable and stays citable (§6.1).

    Empty means every stage, which is what `stagesOf` already reads a null column as: unchecking
    everything is not a project that runs nothing, it is a project nobody has narrowed.

    **And so does every stage ticked**, which is why it collapses back to null rather than being
    stored as the list. The two are the same statement today and stop being the same the moment the
    platform grows a seventh phase: a stored list would silently exclude it, while null goes on
    meaning "this project runs the whole chain". Writing the list would turn "nobody narrowed this"
    into "somebody chose these six", which is a claim the reader never made.
  */
  const chosen = readStages(formData.getAll("stages").map(String));
  const narrowed = chosen.length > 0 && chosen.length < STAGES.length;

  await db
    .update(projects)
    /* Empty is nobody said, not national — `ratesInForce` reads a project with no region as
       "price from the whole library". Never inferred from the name or a document. */
    .set({
      name,
      code: code || null,
      client: client || null,
      status,
      region: region || null,
      stages: narrowed ? chosen : null,
      // A checkbox posts only when ticked, so its absence is "not a test project" (audit C5).
      isTest: formData.get("isTest") === "on",
    })
    .where(eq(projects.id, id));

  // `layout`, not the page alone: the sidebar dims off-stage steps and renders outside the page,
  // so a narrowed engagement saved here would otherwise leave a stale nav beside a fresh board.
  revalidatePath(`/projects/${id}`, "layout");
  revalidatePath("/projects");
  return { saved: true };
}

/**
 * Add one stage to what a project runs — the offer an off-stage step makes.
 *
 * ── Why a step outside the engagement offers this at all ───────────────────────────────────
 *
 * Because reaching one is nearly always a correction, not a mistake. The stages are answered once,
 * at setup, by somebody who may not have had the appointment in front of them, and the first time
 * anybody notices is when a QS opens the step they were asked for and finds it dimmed. Sending them
 * to a settings form to work out which of six checkboxes corresponds to the page they are standing
 * on is asking them to translate; this does the one thing they came to do.
 *
 * ── Add, never set ─────────────────────────────────────────────────────────────────────────
 *
 * It unions rather than replaces, so widening from a step can only ever grow the engagement. A
 * control that could silently narrow one from a page about a single stage would be a control that
 * sets work aside as a side effect of a click meant to bring work in.
 *
 * A project running every stage (a null column) has nothing to widen and is left alone rather than
 * being written a list that means the same thing — `stagesOf` reads null as every stage, and
 * materialising that would turn "nobody narrowed this" into "somebody chose all six", which is a
 * different statement the moment the platform grows a seventh.
 */
export async function addStage(id: string, phase: number): Promise<void> {
  await requireSession();

  if (!STAGES.some((stage) => stage.number === phase)) return;

  const [project] = await db
    .select({ stages: projects.stages })
    .from(projects)
    .where(eq(projects.id, id));
  if (!project) return;

  // Null already covers everything. Nothing to add, and nothing to write.
  if (project.stages === null || project.stages.length === 0) return;

  const widened = [...new Set([...stagesOf(project.stages), phase])].sort((a, b) => a - b);
  if (widened.length === project.stages.length) return;

  await db.update(projects).set({ stages: widened }).where(eq(projects.id, id));

  // `layout`, because the sidebar renders from these and sits outside the page.
  revalidatePath(`/projects/${id}`, "layout");
}

/** Archive, or bring back. A status change, nothing more. */
export async function setArchived(id: string, archived: boolean): Promise<void> {
  await requireSession();

  await db
    .update(projects)
    .set({ status: archived ? "archived" : "estimating" })
    .where(eq(projects.id, id));

  // The whole app, layouts included: the shell's palette lists archived projects under their own
  // label, and every page of this project carries the archived line.
  revalidatePath("/", "layout");
}

/**
 * Delete — soft (§13.4).
 *
 * The row stays and its documents stay with it. Nothing that referenced this project becomes
 * unresolvable; it simply stops being listed.
 */
export async function deleteProject(id: string): Promise<void> {
  await requireSession();

  await db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, id));

  revalidatePath("/projects");
  redirect("/projects");
}
