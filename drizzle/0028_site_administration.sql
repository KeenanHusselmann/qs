-- Site administration – the compliance register and site meetings (D2.5, D7).
--
-- ── Compliance ──────────────────────────────────────────────────────────────────────────────
-- One row per requirement per project: health and safety (Construction Regulations 2014) and the
-- statutory approvals and certificates – building plans, NHBRC, COCs, the occupation certificate.
-- Seeded from `domain/compliance.ts` the first time a project's register is opened; a row that
-- does not apply is marked so, never deleted.
create table if not exists "compliance_items" (
  "id" uuid primary key default gen_random_uuid(),
  "project_id" uuid not null references "projects"("id") on delete cascade,
  -- The seeded requirement it came from, or null for one a practice added itself.
  "key" text,
  "title" text not null,
  "source" text,
  "area" text not null,
  "stage" text not null,
  "responsible" text,
  "status" text not null default 'required',
  "needed_by" date,
  "submitted_on" date,
  "approved_on" date,
  "expires_on" date,
  "reference" text,
  "document_id" uuid references "documents"("id") on delete set null,
  "note" text,
  "updated_by" text,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);--> statement-breakpoint
create unique index if not exists "compliance_items_project_key" on "compliance_items" ("project_id", "key") where "key" is not null;--> statement-breakpoint
do $$ begin
  alter table "compliance_items" add constraint "compliance_items_known"
    check (
      "status" in ('required', 'submitted', 'approved', 'not_applicable')
      and "area" in ('health_and_safety', 'statutory')
      and "stage" in ('before_construction', 'during_construction', 'at_completion')
    );
exception when duplicate_object then null;
end $$;--> statement-breakpoint
do $$ begin
  -- Approved means an approval date; the date is what the certificate and the file will cite.
  alter table "compliance_items" add constraint "compliance_items_approved_dated"
    check ("status" <> 'approved' or "approved_on" is not null);
exception when duplicate_object then null;
end $$;--> statement-breakpoint

-- ── Site meetings ───────────────────────────────────────────────────────────────────────────
-- A meeting is numbered per project; its minutes are items, each optionally an action with who
-- and by when. Actions can be sent to Project Management as tasks, and the item remembers which.
create table if not exists "site_meetings" (
  "id" uuid primary key default gen_random_uuid(),
  "project_id" uuid not null references "projects"("id") on delete cascade,
  "number" integer not null,
  "kind" text not null default 'site',
  "held_on" date not null,
  "venue" text,
  "chair" text,
  "attendees" text,
  "apologies" text,
  "next_on" date,
  "created_by" text not null,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  "deleted_at" timestamptz
);--> statement-breakpoint
create unique index if not exists "site_meetings_project_number" on "site_meetings" ("project_id", "number");--> statement-breakpoint
do $$ begin
  alter table "site_meetings" add constraint "site_meetings_kind_known"
    check ("kind" in ('site', 'progress', 'design', 'client', 'handover'));
exception when duplicate_object then null;
end $$;--> statement-breakpoint

create table if not exists "meeting_items" (
  "id" uuid primary key default gen_random_uuid(),
  "meeting_id" uuid not null references "site_meetings"("id") on delete cascade,
  "seq" integer not null,
  "section" text,
  "text" text not null,
  "action_by" text,
  "due_on" date,
  -- The Project Management task this action became, once sent.
  "work_item_id" uuid references "work_items"("id") on delete set null,
  "created_at" timestamptz not null default now()
);--> statement-breakpoint
create index if not exists "meeting_items_meeting_seq" on "meeting_items" ("meeting_id", "seq");
