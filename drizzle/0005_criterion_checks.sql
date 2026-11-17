-- Ticking a required input off by hand — PLATFORM.md §1.3.3.
--
-- The checklist already ticks itself when a filed document grounds a criterion. This is the other
-- half: the QS saying "I have dealt with this". The moment that claim can affect whether a process
-- may start it stops being interface state and becomes a record someone will be asked about later,
-- so it is stored with who and when — the same shape as a sign-off.
--
-- `checked_by` is not nullable on purpose. An unattributed tick is exactly what this table exists
-- to prevent: it would let a checklist be cleared with no evidence and nobody's name against it.
-- `if not exists` for the same reason as 0004: a database brought forward by hand is past this
-- migration while the ledger has not recorded it, and drizzle replays by timestamp. Running this
-- file twice must be the same as running it once.
create table if not exists "criterion_checks" (
  "id" uuid primary key default gen_random_uuid(),
  "project_id" uuid not null references "projects"("id") on delete cascade,
  "criterion_id" text not null,
  "checked_by" text not null,
  "checked_at" timestamptz not null default now(),
  "note" text
);--> statement-breakpoint

-- One live tick per criterion per project. Unticking deletes the row rather than writing a second
-- one; the history belongs in the audit log, not in duplicates here.
create unique index if not exists "criterion_checks_unique" on "criterion_checks" ("project_id", "criterion_id");
