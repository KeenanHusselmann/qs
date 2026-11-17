-- Project management – the work a job generates between its signed steps.
--
-- ── What this is for ─────────────────────────────────────────────────────────────────────────
--
-- The platform knows where a job is: which steps are signed, which documents are filed, which
-- deliverables are outstanding. It did not hold the work that moves it – the RFI to the architect,
-- the snag to close before practical completion, the instruction to price, the risk to watch. That
-- lived in email and spreadsheets beside the platform. These tables hold it, per project.
--
-- ── One table, six kinds of item ────────────────────────────────────────────────────────────
--
-- A task, an RFI, a snag, an instruction to action, a risk and a submittal share almost everything
-- a board and a timeline need – a title, a status, a priority, an owner, dates – and differ in a
-- handful of fields each. Those few are `details`, validated in `lib/work/items.ts`, rather than six
-- tables that every view would have to union.
--
-- ── Owned by a person or by a contact, never both ───────────────────────────────────────────
--
-- An RFI sits with the architect until it is answered, and the architect does not sign in. So an
-- item is assigned either to a platform user (by email, as signatures are) or to a directory contact.
--
-- Additive: new tables only. Replayable: every statement is guarded.

create table if not exists "work_items" (
  "id" uuid primary key default gen_random_uuid(),
  "project_id" uuid not null references "projects"("id") on delete cascade,
  -- Per project, never reused: "#12" in a site meeting has to mean the same item next month.
  "number" integer not null,
  "type" text not null,
  "title" text not null,
  "description" text,
  "status" text not null default 'todo',
  "priority" text not null default 'medium',
  "assignee_email" text,
  "assignee_contact_id" uuid references "contacts"("id") on delete set null,
  "start_date" date,
  "due_date" date,
  -- The platform step this item moves, e.g. '/bill'. Checked against the steps in the application.
  "module" text,
  "document_id" uuid references "documents"("id") on delete set null,
  "details" jsonb not null default '{}'::jsonb,
  -- 'plan' when it was added from the job card's plan, so a reader can tell where it came from.
  "source" text not null default 'manual',
  -- Order within a board column. A double, so a card dropped between two others takes the midpoint.
  "rank" double precision not null default 0,
  "created_by" text not null,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  "completed_at" timestamp with time zone,
  -- Soft: an item raised in a meeting and deleted is still something somebody once raised.
  "deleted_at" timestamp with time zone,

  constraint "work_items_type_known" check ("type" in ('task', 'rfi', 'snag', 'instruction', 'risk', 'submittal')),
  constraint "work_items_status_known" check ("status" in ('todo', 'in_progress', 'waiting', 'done')),
  constraint "work_items_priority_known" check ("priority" in ('low', 'medium', 'high', 'urgent')),
  constraint "work_items_source_known" check ("source" in ('manual', 'plan')),
  constraint "work_items_one_owner" check ("assignee_email" is null or "assignee_contact_id" is null),
  constraint "work_items_dates_in_order" check ("start_date" is null or "due_date" is null or "start_date" <= "due_date")
);

create unique index if not exists "work_items_project_number" on "work_items" ("project_id", "number");
create index if not exists "work_items_project_status" on "work_items" ("project_id", "status") where "deleted_at" is null;
create index if not exists "work_items_assignee" on "work_items" ("assignee_email") where "deleted_at" is null;

create table if not exists "work_item_comments" (
  "id" uuid primary key default gen_random_uuid(),
  "item_id" uuid not null references "work_items"("id") on delete cascade,
  "body" text not null,
  "author" text not null,
  "created_at" timestamp with time zone not null default now()
);

create index if not exists "work_item_comments_item" on "work_item_comments" ("item_id", "created_at");
