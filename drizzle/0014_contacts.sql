-- The practice's directory — the organisations and people the work is done with and for.
--
-- ── Firm-wide, like the policies ───────────────────────────────────────────────────────────
--
-- A supplier serves every job; a client has several. Scoping a directory to one project would
-- mean re-entering the same quantity surveyor on the next one, which is how two spellings of a
-- company come to exist and a tender goes to the wrong address.
--
-- ── It does not own the client name ────────────────────────────────────────────────────────
--
-- `projects.client` already records who a project is for, and the viability report's "prepared
-- for" line reads it. This table does **not** replace that: a project keeps its own client name,
-- and the directory finds the projects that name a contact rather than the other way round. One
-- fact, one owner — a second copy would disagree the first time somebody corrected one of them.

create table "contacts" (
  "id" uuid primary key default gen_random_uuid(),
  -- The organisation. A practice deals with companies; the person is who answers the phone there.
  "organisation" text not null,
  -- Nullable: plenty of entries are an organisation with no named contact yet, and inventing a
  -- person to satisfy a not-null is how "Accounts" ends up in a report as somebody's name.
  "person" text,
  "role" text,
  -- client · consultant · contractor · supplier · authority
  "kind" text not null,
  "email" text,
  "phone" text,
  "note" text,
  "added_by" text not null,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  -- Soft, like everything else here: a supplier the practice has stopped using is still who a
  -- rate came from three years ago.
  "deleted_at" timestamptz
);

create index "contacts_live_idx" on "contacts" ("kind") where "deleted_at" is null;

-- One organisation per kind. The same company can legitimately be a client on one job and a
-- contractor on another, so the pair is unique rather than the name alone.
create unique index "contacts_org_kind_idx"
  on "contacts" (lower("organisation"), "kind") where "deleted_at" is null;
