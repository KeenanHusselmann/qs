"use server";

/**
 * The bell's side of notifications – reading them, marking them read, and whether they are emailed.
 *
 * Everything is the signed-in person's own: a recipient is never taken from the browser.
 */

import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db/client";
import { notificationSettings, notifications } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { emailConfigured } from "@/lib/email";
import { listNotifications, sweepIfDue, unreadCount, type NotificationView } from "@/lib/notifications";

export interface BellData {
  items: NotificationView[];
  unread: number;
  /** Whether this person wants email, and whether this deployment can send it at all. */
  email: { on: boolean; configured: boolean };
}

export async function bellData(): Promise<BellData> {
  const session = await requireSession();
  // Deadlines found as the bell opens, so they appear the day they matter without waiting for the schedule.
  await sweepIfDue();
  const me = session.email.toLowerCase();
  const [items, unread, [setting]] = await Promise.all([
    listNotifications(me),
    unreadCount(me),
    db.select().from(notificationSettings).where(eq(notificationSettings.recipient, me)).limit(1),
  ]);
  return { items, unread, email: { on: setting?.email ?? true, configured: emailConfigured() } };
}

export async function bellUnread(): Promise<number> {
  const session = await requireSession();
  return unreadCount(session.email);
}

export async function markRead(ids: readonly string[] | "all"): Promise<void> {
  const session = await requireSession();
  const me = session.email.toLowerCase();
  const mine = and(eq(notifications.recipient, me), isNull(notifications.readAt));
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(ids === "all" ? mine : and(mine, inArray(notifications.id, [...ids])));
}

export async function setEmailAlerts(on: boolean): Promise<void> {
  const session = await requireSession();
  const recipient = session.email.toLowerCase();
  await db
    .insert(notificationSettings)
    .values({ recipient, email: on })
    .onConflictDoUpdate({ target: notificationSettings.recipient, set: { email: on, updatedAt: new Date() } });
}
