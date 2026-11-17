/**
 * Notifications – what happened that someone should know about, told to them (round-3 testing).
 *
 * ── Who is told ─────────────────────────────────────────────────────────────────────────────
 *
 * The people who work on the project: whoever created it, whoever ran or signed a step on it,
 * whoever is assigned or raised its work, whoever issued its documents. Worked out from what the
 * platform already records rather than from a membership list nobody keeps up. The person who did
 * the thing is never told about it, and a deactivated person is not told anything.
 *
 * ── What is told ────────────────────────────────────────────────────────────────────────────
 *
 * Events, as they happen: a work item assigned to you, a comment on work you raised or hold, a step
 * signed off, a document issued. And deadlines, found by `sweepDeadlines`: work due tomorrow or
 * overdue, a tender closing within two days, a compliance item about to expire. A deadline is
 * written once however often the sweep runs – its key names the item and the date.
 *
 * Each notification is also emailed, where email is configured (`lib/email.ts`) and the person has
 * not turned it off; where it is not sent, the row says why.
 */

import { and, desc, eq, inArray, isNotNull, isNull, lte, gte, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  issuedDocuments,
  notificationSettings,
  notifications,
  projects,
  runs,
  tenders,
  users,
  workItems,
} from "@/db/schema";
import { notificationEmail, sendEmail } from "@/lib/email";
import { PROJECT_NAV } from "@/lib/navigation";
import { nameOf } from "@/lib/signers";

export type NotificationKind = "assigned" | "comment" | "signed" | "issued" | "due" | "overdue" | "tender_closing" | "compliance_expiring";

/**
 * The kinds still raised and still shown. Work items (assigned, comment, due, overdue) and compliance
 * records went with Project Management and Compliance in the simplification of 16 Nov 2026; rows of
 * those kinds already stored would open pages that no longer exist, so they are not listed or counted.
 */
const LIVE_KINDS: readonly NotificationKind[] = ["signed", "issued", "tender_closing"];

export interface NotificationView {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  href: string | null;
  project: string | null;
  createdAt: string;
  read: boolean;
}

const lower = (e: string | null | undefined) => (e ?? "").trim().toLowerCase();

/** The people who work on a project, as the platform records them. */
export async function projectTeam(projectId: string): Promise<string[]> {
  const [project] = await db.select({ createdBy: projects.createdBy }).from(projects).where(eq(projects.id, projectId)).limit(1);
  const [ran, work, issued] = await Promise.all([
    db.select({ a: runs.createdBy, b: runs.signedBy }).from(runs).where(eq(runs.projectId, projectId)),
    db.select({ a: workItems.assigneeEmail, b: workItems.createdBy }).from(workItems).where(and(eq(workItems.projectId, projectId), isNull(workItems.deletedAt))),
    db.select({ a: issuedDocuments.issuedBy }).from(issuedDocuments).where(eq(issuedDocuments.projectId, projectId)),
  ]);
  const emails = new Set(
    [project?.createdBy, ...ran.flatMap((r) => [r.a, r.b]), ...work.flatMap((w) => [w.a, w.b]), ...issued.map((i) => i.a)]
      .map(lower)
      .filter((e) => e.includes("@")),
  );
  if (emails.size === 0) return [];
  const gone = await db
    .select({ email: users.email })
    .from(users)
    .where(and(inArray(sql`lower(${users.email})`, [...emails]), isNotNull(users.deactivatedAt)));
  for (const g of gone) emails.delete(lower(g.email));
  return [...emails];
}

/**
 * Tell people something happened. Skips the actor, writes a row each, and emails each new row where
 * email is on. A `dedupeKey` makes it idempotent per recipient – a deadline found twice is told once.
 */
export async function notify({
  recipients,
  actor = null,
  projectId = null,
  kind,
  title,
  body = null,
  href = null,
  dedupeKey = null,
}: {
  recipients: readonly (string | null | undefined)[];
  actor?: string | null;
  projectId?: string | null;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  href?: string | null;
  dedupeKey?: string | null;
}): Promise<number> {
  const to = [...new Set(recipients.map(lower).filter((e) => e.includes("@") && e !== lower(actor)))];
  if (to.length === 0) return 0;

  const inserted = await db
    .insert(notifications)
    .values(to.map((recipient) => ({ recipient, projectId, kind, title, body, href, actor: actor ? lower(actor) : null, dedupeKey })))
    .onConflictDoNothing()
    .returning({ id: notifications.id, recipient: notifications.recipient });
  if (inserted.length === 0) return 0;

  const [project] = projectId ? await db.select({ name: projects.name }).from(projects).where(eq(projects.id, projectId)).limit(1) : [];
  const off = new Set(
    (await db.select().from(notificationSettings).where(inArray(notificationSettings.recipient, inserted.map((i) => i.recipient))))
      .filter((s) => !s.email)
      .map((s) => s.recipient),
  );
  const message = notificationEmail({ title, body, href, project: project?.name ?? null });
  for (const row of inserted) {
    if (off.has(row.recipient)) continue;
    const outcome = await sendEmail({ to: row.recipient, ...message });
    await db
      .update(notifications)
      .set(outcome.sent ? { emailedAt: new Date(), emailError: null } : { emailError: outcome.reason })
      .where(eq(notifications.id, row.id));
  }
  return inserted.length;
}

/** Tell a project's team, less the person who did it. */
export async function notifyTeam(projectId: string, input: Omit<Parameters<typeof notify>[0], "recipients" | "projectId">): Promise<number> {
  return notify({ ...input, projectId, recipients: await projectTeam(projectId) });
}

/** A notification must never cost the action that caused it – failures are logged, not thrown. */
export function quietly(work: () => Promise<unknown>): void {
  work().catch((error) => console.error("[notifications]", error));
}

export async function listNotifications(recipient: string, limit = 30): Promise<NotificationView[]> {
  const rows = await db
    .select({ n: notifications, project: projects.name })
    .from(notifications)
    .leftJoin(projects, eq(projects.id, notifications.projectId))
    .where(and(eq(notifications.recipient, lower(recipient)), inArray(notifications.kind, [...LIVE_KINDS])))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
  return rows.map(({ n, project }) => ({
    id: n.id,
    kind: n.kind as NotificationKind,
    title: n.title,
    body: n.body,
    href: n.href,
    project,
    createdAt: n.createdAt.toISOString(),
    read: n.readAt !== null,
  }));
}

export async function unreadCount(recipient: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.recipient, lower(recipient)), isNull(notifications.readAt), inArray(notifications.kind, [...LIVE_KINDS])));
  return row?.n ?? 0;
}

// ── Deadlines ──────────────────────────────────────────────────────────────────────────────


/**
 * Find the deadlines worth telling someone about, and tell them once each.
 *
 * Run by the daily schedule, and whenever someone opens the bell – so a deadline shows up the day
 * it matters even where the schedule has not run. Tender closings only, since work items and
 * compliance records were removed on 16 Nov 2026.
 */
export async function sweepDeadlines(now = new Date()): Promise<number> {
  let told = 0;


  // Tenders closing within two days, issued and not yet opened.
  const closing = await db
    .select({ id: tenders.id, projectId: tenders.projectId, reference: tenders.reference, closingAt: tenders.closingAt })
    .from(tenders)
    .where(and(isNotNull(tenders.issuedAt), isNull(tenders.openedAt), gte(tenders.closingAt, now), lte(tenders.closingAt, new Date(now.getTime() + 2 * 86_400_000))));
  for (const t of closing) {
    const team = await projectTeam(t.projectId);
    told += await notify({
      recipients: team,
      projectId: t.projectId,
      kind: "tender_closing",
      title: `Tender ${t.reference} closes ${t.closingAt.toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" })}`,
      body: "Record the returns as they arrive; tenders are opened after the closing time.",
      href: `/projects/${t.projectId}/tender`,
      dedupeKey: `tender:${t.id}:closing`,
    });
  }

  return told;
}

let lastSweep = 0;
/** The sweep as a bell opens – at most every ten minutes per server, because opening the bell should not be a batch job. */
export async function sweepIfDue(): Promise<void> {
  if (Date.now() - lastSweep < 10 * 60_000) return;
  lastSweep = Date.now();
  await sweepDeadlines().catch((error) => console.error("[notifications] sweep", error));
}

// ── Events ─────────────────────────────────────────────────────────────────────────────────

const stepLabel = (module: string) => PROJECT_NAV.flatMap((g) => g.items).find((i) => i.href === module)?.label ?? "step";

/** A step signed off – its figures are now what the steps after it read. */
export async function toldSignedOff(projectId: string, module: string, actor: string): Promise<void> {
  const who = await nameOf(actor);
  await notifyTeam(projectId, {
    actor,
    kind: "signed",
    title: `${who} signed off the ${stepLabel(module)}`,
    body: "Its figures are now fixed, and the steps after it read them.",
    href: `/projects/${projectId}${module}`,
  });
}

/** A document issued – on the register, and the version that went out. */
export async function toldIssued(projectId: string, title: string, documentId: string, actor: string): Promise<void> {
  const who = await nameOf(actor);
  await notifyTeam(projectId, {
    actor,
    kind: "issued",
    title: `${who} issued ${title.replace(/^.*? [–—] /, "the ")}`,
    body: "A copy of exactly what was sent is kept on the project's Report page.",
    href: `/projects/${projectId}/report/pdf?issued=${documentId}`,
  });
}
