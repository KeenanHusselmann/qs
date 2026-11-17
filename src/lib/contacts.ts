/**
 * The practice's directory, and the one link that stops it being an address book.
 *
 * ── What makes this a platform feature rather than a list of phone numbers ─────────────────
 *
 * A directory nothing points at is a spreadsheet with a login. The thing that earns this its place
 * is that it finds the work: a client entry shows the projects that name it, read from
 * `projects.client`, which is where that fact already lives.
 *
 * The match is on the name, deliberately, and it is not a foreign key. A project's client is free
 * text typed when the project was created, often before anybody added a directory entry — and
 * making it a reference would mean either refusing projects whose client is not yet on file, or
 * silently creating directory entries nobody reviewed. Neither is worth it for a link that is
 * useful when it works and harmless when it does not.
 */

import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { contacts, projects } from "@/db/schema";
import { isContactKind, type ContactKind } from "@/lib/contact-kinds";

export interface DirectoryEntry {
  id: string;
  organisation: string;
  person: string | null;
  role: string | null;
  kind: ContactKind;
  email: string | null;
  phone: string | null;
  note: string | null;
  /** Projects whose client is this organisation. Empty for every kind but `client`. */
  projects: { id: string; name: string }[];
}

/**
 * The directory, with each client's projects attached.
 *
 * Two queries and a join in memory rather than a SQL join: the project match is on a lowercased,
 * trimmed name and would need a function index to be worth doing in the database, on a table the
 * size of a practice's client list. Reading both and matching here is clearer and, at this size,
 * indistinguishable in cost.
 */
export async function directory(): Promise<DirectoryEntry[]> {
  const [rows, jobs] = await Promise.all([
    db
      .select()
      .from(contacts)
      .where(isNull(contacts.deletedAt))
      .orderBy(asc(contacts.kind), asc(sql`lower(${contacts.organisation})`)),
    db
      .select({ id: projects.id, name: projects.name, client: projects.client })
      .from(projects)
      .where(isNull(projects.deletedAt)),
  ]);

  const byClient = new Map<string, { id: string; name: string }[]>();
  for (const job of jobs) {
    if (!job.client) continue;
    const key = job.client.trim().toLowerCase();
    byClient.set(key, [...(byClient.get(key) ?? []), { id: job.id, name: job.name }]);
  }

  return rows.map((row) => ({
    id: row.id,
    organisation: row.organisation,
    person: row.person,
    role: row.role,
    kind: (isContactKind(row.kind) ? row.kind : "supplier") as ContactKind,
    email: row.email,
    phone: row.phone,
    note: row.note,
    projects:
      row.kind === "client" ? (byClient.get(row.organisation.trim().toLowerCase()) ?? []) : [],
  }));
}

/**
 * Clients named on a project but not in the directory.
 *
 * The gap worth showing. A practice with eleven projects and three client entries has eight
 * clients it cannot email, and nothing else on the platform would ever mention it — the projects
 * work perfectly well without a directory entry, which is exactly why the omission is invisible.
 */
export async function clientsNotFiled(): Promise<string[]> {
  const [jobs, filed] = await Promise.all([
    db
      .select({ client: projects.client })
      .from(projects)
      .where(isNull(projects.deletedAt)),
    db
      .select({ organisation: contacts.organisation })
      .from(contacts)
      .where(and(eq(contacts.kind, "client"), isNull(contacts.deletedAt))),
  ]);

  const known = new Set(filed.map((row) => row.organisation.trim().toLowerCase()));

  const missing = new Set(
    jobs
      .map((job) => job.client?.trim() ?? "")
      .filter((client) => client.length > 0 && !known.has(client.toLowerCase())),
  );

  return [...missing].sort((a, b) => a.localeCompare(b));
}
