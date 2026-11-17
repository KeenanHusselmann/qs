-- The firm's own standards — PLATFORM.md §1.3.1, §1.3.2.
--
-- ── Their own tables, not a nullable project_id ────────────────────────────────────────────
--
-- A policy is firm-wide: it applies to every project, which is the opposite of everything else in
-- this corpus. The cheap way to hold that is a nullable `documents.project_id`, and it is the wrong
-- way. Every retrieval in the platform scopes with `project_id = $1`, and that predicate is what
-- stops one scheme's figures surfacing in another's report. Making the column nullable turns each
-- of those into `project_id = $1 or project_id is null`, and the first one somebody forgets is a
-- silent leak in the direction that ends trust in the platform.
--
-- Separate tables make the boundary structural. A policy cannot appear in a project search because
-- it is not in the table a project search reads.

create table "policies" (
  "id" uuid primary key default gen_random_uuid(),
  "title" text not null,
  "filename" text not null,
  -- What it governs, so the advisor can say which standard it is citing.
  "kind" text not null,
  -- Kept as text as well as chunked: the policies page shows the whole thing, and re-assembling it
  -- from passages would render the chunk boundaries as though the document had them.
  "body" text not null,
  -- The date the firm adopted it. A standard superseded last year is not the standard, and a
  -- policy with no date cannot be told from one that is current.
  "effective_from" date,
  "filed_by" text not null,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  -- Soft, like documents: a withdrawn policy is still what advice was given under last month.
  "deleted_at" timestamptz
);

create table "policy_passages" (
  "id" uuid primary key default gen_random_uuid(),
  "policy_id" uuid not null references "policies"("id") on delete cascade,
  "seq" integer not null,
  "page" integer,
  "body" text not null,
  "created_at" timestamptz not null default now(),
  -- Generated, exactly as `chunks.search` is: the application never writes it, so there is no path
  -- by which a passage exists and is not searchable.
  "search" tsvector generated always as (to_tsvector('english', "body")) stored
);

create index "policy_passages_search_idx" on "policy_passages" using gin ("search");
create index "policy_passages_policy_idx" on "policy_passages" ("policy_id");
create index "policies_live_idx" on "policies" ("deleted_at") where "deleted_at" is null;
