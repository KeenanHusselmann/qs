-- The outbound ledger — ARC-005, "Record".
--
-- One row per attempt to send something to an outside service: an AI model, the web search, the
-- email provider. What it was for, who received it and where they are, which classes of
-- information were found and what was done with each, how much was sent, and a hash of exactly what
-- was sent. **Never the text itself.** The ledger answers "who received my information" (POPIA
-- s23–25), "which calls carried what" after a vendor reports a breach (s22), and an Information
-- Regulator's request for records (s17), without becoming a second copy of the data it protects.
--
-- Refusals are rows too: a call the gateway stopped is evidence that the control works.
--
-- Append-only, as a database fact rather than a convention: the trigger below refuses every update
-- and delete, in the same way the signed-run freezes in 0008 do. A ledger that can be edited is not
-- a record.
create table if not exists "egress_events" (
  "id" uuid primary key default gen_random_uuid(),
  "at" timestamptz not null default now(),
  -- A registered purpose: extract.field, quote.evaluate, web.search, email.notify, ...
  "purpose" text not null,
  "vendor" text not null,
  -- Where the vendor processes it (ISO country code), as recorded in the policy at the time.
  "region" text not null,
  -- No foreign keys, deliberately: a project or a person can be removed, and the record that their
  -- information was sent must outlive them.
  "project_id" uuid,
  "actor" text,
  -- {"C3 tokenised": 3, "C4 removed": 1, ...} – counts, never content.
  "classes" jsonb not null default '{}'::jsonb,
  "chars_out" integer not null default 0,
  -- sha256 of the system prompt and the text after transformation – exactly what left.
  "sha256" text,
  -- The practice's recorded transfer basis for this vendor when the call was made.
  "basis" text,
  "decision" text not null,
  -- Why a call was refused. Null when allowed.
  "reason" text
);--> statement-breakpoint

do $$ begin
  alter table "egress_events" add constraint "egress_events_decision_known"
    check ("decision" in ('allowed', 'refused'));
exception when duplicate_object then null;
end $$;--> statement-breakpoint

create index if not exists "egress_events_project_at" on "egress_events" ("project_id", "at" desc);--> statement-breakpoint
create index if not exists "egress_events_at" on "egress_events" ("at" desc);--> statement-breakpoint

create or replace function egress_events_append_only() returns trigger as $$
begin
  raise exception 'egress_events is an append-only ledger — % is not allowed', tg_op;
end;
$$ language plpgsql;--> statement-breakpoint

drop trigger if exists "egress_events_append_only" on "egress_events";--> statement-breakpoint
create trigger "egress_events_append_only"
  before update or delete on "egress_events"
  for each row execute function egress_events_append_only();
