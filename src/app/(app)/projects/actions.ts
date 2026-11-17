"use server";

/**
 * Creating and listing projects.
 *
 * Server actions rather than an API route: these are form submissions, and a form that posts to a
 * server action works before JavaScript has loaded.
 */

import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth";
import { readStages } from "@/lib/stages";
import { db } from "@/db/client";
import { documents, projects, type Project } from "@/db/schema";

export interface CreateProjectResult {
  error?: string;
  /**
   * The new project, on success.
   *
   * Setup files documents against the project it has just created, so it needs to know which one.
   * Returning the row rather than re-querying by name also settles the ambiguity two projects
   * called "Phase 2" would otherwise create.
   */
  project?: { id: string; name: string };
}

/**
 * The working list: newest first, excluding deleted and archived.
 *
 * Archived projects are finished work a practice keeps, not clutter to scroll past. They are still
 * reachable by URL and still cited by anything that referenced them — they are simply not what
 * someone opening this page is looking for.
 */
export async function listProjects(includeArchived = false): Promise<Project[]> {
  await requireSession();

  // Projects only. An ad hoc request has no stages and signs nothing, so every portfolio figure,
  // the list and the landing page – all of which read this – would be wrong with one counted in.
  return db
    .select()
    .from(projects)
    .where(
      includeArchived
        ? and(isNull(projects.deletedAt), eq(projects.kind, "project"))
        : and(isNull(projects.deletedAt), eq(projects.kind, "project"), ne(projects.status, "archived")),
    )
    .orderBy(desc(projects.createdAt));
}

/** Archived projects, for the list's "show archived" view. */
export async function listArchivedProjects(): Promise<Project[]> {
  await requireSession();

  return db
    .select()
    .from(projects)
    .where(and(isNull(projects.deletedAt), eq(projects.kind, "project"), eq(projects.status, "archived")))
    .orderBy(desc(projects.createdAt));
}

/**
 * Ad hoc requests – open ones first, newest first within each. Answered ones stay listed (their
 * inputs are the context for the next question) but sort below.
 */
export async function listAdhocRequests(): Promise<Project[]> {
  await requireSession();

  return db
    .select()
    .from(projects)
    .where(and(isNull(projects.deletedAt), eq(projects.kind, "adhoc")))
    .orderBy(sql`${projects.closedAt} is not null`, desc(projects.createdAt));
}

/**
 * Open an ad hoc request: what was asked, by whom, by when. The inputs are filed against it
 * afterwards, one at a time, for the reason `new-project-dialog.tsx` gives.
 */
export async function createAdhocRequest(
  _previous: CreateProjectResult | null,
  formData: FormData,
): Promise<CreateProjectResult> {
  const session = await requireSession();

  const name = String(formData.get("name") ?? "").trim().slice(0, 160);
  const request = String(formData.get("request") ?? "").trim().slice(0, 4_000);
  const requestedBy = String(formData.get("requestedBy") ?? "").trim().slice(0, 160);
  const dueOn = String(formData.get("dueOn") ?? "").trim();

  if (!name) return { error: "Give the request a short name – \"Steel schedule for the supplier meeting\"" };
  if (!request) return { error: "Say what is needed – it is what the assistant reads first" };
  if (dueOn && !/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) return { error: "The due date is not a date" };

  const [created] = await db
    .insert(projects)
    .values({
      name,
      kind: "adhoc",
      request,
      requestedBy: requestedBy || null,
      dueOn: dueOn || null,
      /*
        Null, not an empty list: `projects_stages_are_phases` refuses `{}` (the gate's ad hoc suite
        found it). An ad hoc request runs no stages, but what it shows is decided by `kind` – the
        sidebar, the module route and the advisor all read that – so the stages column says nothing.
      */
      stages: null,
      createdBy: session.email,
    })
    .returning({ id: projects.id, name: projects.name });

  revalidatePath("/my-work");
  revalidatePath("/");
  return { project: created };
}

/** Mark a request answered, or open it again. Its documents and take-off stay either way. */
export async function setAdhocAnswered(id: string, answered: boolean): Promise<{ ok: boolean; reason?: string }> {
  const session = await requireSession();
  const [row] = await db
    .update(projects)
    .set(answered ? { closedAt: new Date(), closedBy: session.email } : { closedAt: null, closedBy: null })
    .where(and(eq(projects.id, id), eq(projects.kind, "adhoc"), isNull(projects.deletedAt)))
    .returning({ id: projects.id });
  if (!row) return { ok: false, reason: "That ad hoc request no longer exists." };
  revalidatePath(`/projects/${id}`);
  revalidatePath("/my-work");
  revalidatePath("/");
  return { ok: true };
}

export async function createProject(
  _previous: CreateProjectResult | null,
  formData: FormData,
): Promise<CreateProjectResult> {
  const session = await requireSession();

  const name = String(formData.get("name") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim();
  const client = String(formData.get("client") ?? "").trim();
  const region = String(formData.get("region") ?? "").trim();

  // §7.7 — say what to do, not that validation failed.
  if (!name) return { error: "Give the project a name" };

  /**
   * The stages this project runs through — L0 phase numbers, read from the checkboxes.
   *
   * Written explicitly on every project rather than left to a column default, so the list of
   * phases lives in `process-model.ts` and nowhere else. `readStages` falls back to all of them,
   * because a project covering no work at all is not a project.
   */
  const stages = readStages(formData.getAll("stages").map(String));

  const [created] = await db
    .insert(projects)
    .values({
      name,
      // Empty means nobody said, which `ratesInForce` treats as "price from the whole
      // library" rather than as national. Never guessed from anything else.
      region: region || null,
      code: code || null,
      client: client || null,
      stages,
      createdBy: session.email,
    })
    .returning({ id: projects.id, name: projects.name });

  revalidatePath("/projects");
  return { project: created };
}

/** How many documents a project has filed. Drives the readiness figures on the list. */
export async function documentCounts(): Promise<Map<string, number>> {
  await requireSession();

  const rows = await db
    .select({ projectId: documents.projectId, kind: documents.kind })
    .from(documents)
    .where(isNull(documents.deletedAt));

  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.projectId, (counts.get(row.projectId) ?? 0) + 1);
  return counts;
}

export async function getProject(id: string): Promise<Project | null> {
  await requireSession();

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
    .limit(1);

  return project ?? null;
}
