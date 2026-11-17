-- Notifications – the bell, and the email behind it (round-3 testing: "notifications instead of
-- having to go into the platform and look at the overview").
--
-- One row per person per thing that happened: a work item assigned to them, a comment on theirs, a
-- step signed off or a document issued on a project they work on, a deadline coming up. A deadline
-- is written once however often it is checked – its `dedupe_key` names the item and the date.
create table if not exists "notifications" (
  "id" uuid primary key default gen_random_uuid(),
  "recipient" text not null,
  "project_id" uuid references "projects"("id") on delete cascade,
  "kind" text not null,
  "title" text not null,
  "body" text,
  "href" text,
  -- Who did it, where a person did. Nobody is told about their own action.
  "actor" text,
  "dedupe_key" text,
  "created_at" timestamptz not null default now(),
  "read_at" timestamptz,
  "emailed_at" timestamptz,
  -- Why an email was not sent, where one should have been – never a silent gap.
  "email_error" text
);--> statement-breakpoint
create index if not exists "notifications_recipient_created" on "notifications" ("recipient", "created_at" desc);--> statement-breakpoint
create unique index if not exists "notifications_recipient_dedupe" on "notifications" ("recipient", "dedupe_key") where "dedupe_key" is not null;--> statement-breakpoint

-- Whether a person wants their notifications by email as well. No row means yes.
create table if not exists "notification_settings" (
  "recipient" text primary key,
  "email" boolean not null default true,
  "updated_at" timestamptz not null default now()
);
