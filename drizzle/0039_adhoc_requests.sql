-- Ad hoc requests (November meeting).
--
-- "Here's the input, this is what I need": a steel specification list for a supplier meeting, the
-- sheet count for a change to zinc roofing. Work that arrives out of the blue, has to be answered
-- quickly, and does not run a service chain.
--
-- An ad hoc request is a project of another kind rather than a table of its own. It needs exactly
-- what a project already has – a folder of documents that is read, searched and kept as context for
-- the follow-up, the take-off from drawings, the assistant, notifications, the egress ledger, and
-- the same access checks – and none of the stages. A second table would mean a second copy of every
-- one of those, and the first time one was missed would be the first leak.
--
-- Additive and replayable. Existing rows are projects, which is what the default says.
alter table "projects" add column if not exists "kind" text not null default 'project';--> statement-breakpoint

do $$ begin
  alter table "projects" add constraint "projects_kind_known" check ("kind" in ('project', 'adhoc'));
exception when duplicate_object then null;
end $$;--> statement-breakpoint

-- What was asked for, in the asker's words. The brief the assistant reads first.
alter table "projects" add column if not exists "request" text;--> statement-breakpoint
-- Who asked – "Richard", "the client's architect". A name as said, not a user: they usually are not one.
alter table "projects" add column if not exists "requested_by" text;--> statement-breakpoint
alter table "projects" add column if not exists "due_on" date;--> statement-breakpoint
-- Answered. Kept, not deleted: the inputs are the context for the next question about the same thing.
alter table "projects" add column if not exists "closed_at" timestamptz;--> statement-breakpoint
alter table "projects" add column if not exists "closed_by" text;--> statement-breakpoint

create index if not exists "projects_adhoc_open" on "projects" ("created_at" desc)
  where "kind" = 'adhoc' and "deleted_at" is null and "closed_at" is null;
