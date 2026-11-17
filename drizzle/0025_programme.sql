-- The construction programme – D2.5. PLATFORM.md §1.3.1, §1.3.3, §6.3.
--
-- ── A programme is a run of rows, like a bill, with dates where the bill has money ──────────
--
-- `programme_activities` mirrors `run_items`: what the machine proposed (immutable), what a person
-- corrected (attributed), and what was signed (frozen). The signature freezes the **baseline** –
-- the dates the contractor was held to on the day the site was handed over.
--
-- ── And progress is a new fact every month, never a correction of the baseline ───────────────
--
-- `programme_progress` is append-only: where each activity stood as at a date, with the dates it
-- now expects. Slippage is the difference between a progress row and the baseline, and it exists
-- only because the baseline cannot move. A signed run's activities are frozen by the same trigger
-- pattern as a bill's; progress rows are written *against* a signed programme and are the one thing
-- a signed programme still accepts.

create table if not exists "programme_activities" (
  "id" uuid primary key default gen_random_uuid(),
  "run_id" uuid not null references "runs"("id") on delete cascade,
  -- Sparse, 100, 200, 300 – an activity is inserted into the middle of a programme all its life.
  "seq" integer not null,
  -- The activity's own number where the programme prints one – "1.2".
  "ref" text,
  -- ── proposed. What the machine read. The trigger below refuses to let it change. ──
  "proposed_name" text,
  "proposed_start" date,
  "proposed_finish" date,
  -- The document's own words, kept for the dates `readDate` refused – "wk 12", "TBC".
  "proposed_start_text" text,
  "proposed_finish_text" text,
  "proposed_milestone" boolean not null default false,
  "proposed_confidence" real not null default 0,
  "proposed_note" text,
  -- ── provenance, per row (§1.3.2) ──
  "source_document_id" uuid references "documents"("id") on delete set null,
  "source_document" text,
  "source_page" integer,
  "source_excerpt" text,
  -- ── overrides. What a person corrected, typed or pasted. ──
  "override_name" text,
  "override_start" date,
  "override_finish" date,
  "override_milestone" boolean,
  "override_by" text,
  "override_at" timestamptz,
  -- The QS's value for the activity – its share of the contract sum, for the cash flow. Minor
  -- units. Null means "share the remainder pro rata to duration", which is not the same as nought.
  "value" bigint,
  -- ── output. The baseline. Null until sign-off, written once, frozen. ──
  "output_name" text,
  "output_start" date,
  "output_finish" date,
  "output_milestone" boolean,
  "omitted_at" timestamptz,
  "omitted_by" text,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);--> statement-breakpoint
do $$ begin
  alter table "programme_activities" add constraint "programme_activities_dates_ordered"
    check (
      ("proposed_start" is null or "proposed_finish" is null or "proposed_finish" >= "proposed_start")
      and ("override_start" is null or "override_finish" is null or "override_finish" >= "override_start")
      and ("output_start" is null or "output_finish" is null or "output_finish" >= "output_start")
    );
exception when duplicate_object then null;
end $$;--> statement-breakpoint
do $$ begin
  alter table "programme_activities" add constraint "programme_activities_override_attributed"
    check (("override_by" is null) = ("override_at" is null));
exception when duplicate_object then null;
end $$;--> statement-breakpoint
do $$ begin
  alter table "programme_activities" add constraint "programme_activities_omission_attributed"
    check (("omitted_by" is null) = ("omitted_at" is null));
exception when duplicate_object then null;
end $$;--> statement-breakpoint
do $$ begin
  alter table "programme_activities" add constraint "programme_activities_value_not_negative"
    check ("value" is null or "value" >= 0);
exception when duplicate_object then null;
end $$;--> statement-breakpoint
create index if not exists "programme_activities_run_seq_idx" on "programme_activities" ("run_id", "seq");--> statement-breakpoint

-- Frozen once signed, the proposal immutable always – the same rule as `run_items_frozen`.
create or replace function programme_activities_frozen() returns trigger as $$
declare
  restored programme_activities%rowtype;
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from runs where id = new.run_id and signed_at is not null) then
      raise exception 'run % is signed off — no activity can be added to it', new.run_id
        using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  -- A document withdrawn from under a row: the reference is nulled by the foreign key and nothing
  -- else changes. That is not an edit.
  if old.source_document_id is not null and new.source_document_id is null then
    restored := new;
    restored.source_document_id := old.source_document_id;
    if restored is not distinct from old then return new; end if;
  end if;
  if exists (select 1 from runs where id = old.run_id and signed_at is not null) then
    raise exception 'run % is signed off — its programme is the baseline and is frozen', old.run_id
      using errcode = 'restrict_violation';
  end if;
  if new.proposed_name        is distinct from old.proposed_name
  or new.proposed_start       is distinct from old.proposed_start
  or new.proposed_finish      is distinct from old.proposed_finish
  or new.proposed_start_text  is distinct from old.proposed_start_text
  or new.proposed_finish_text is distinct from old.proposed_finish_text
  or new.proposed_milestone   is distinct from old.proposed_milestone
  or new.proposed_confidence  is distinct from old.proposed_confidence
  or new.proposed_note        is distinct from old.proposed_note
  or new.source_document_id   is distinct from old.source_document_id
  or new.source_document      is distinct from old.source_document
  or new.source_page          is distinct from old.source_page
  or new.source_excerpt       is distinct from old.source_excerpt
  or new.run_id               is distinct from old.run_id
  then
    raise exception 'the proposal on activity % is the record of what was read and cannot change', old.id
      using errcode = 'restrict_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;--> statement-breakpoint
drop trigger if exists "programme_activities_frozen" on "programme_activities";--> statement-breakpoint
create trigger "programme_activities_frozen" before insert or update on "programme_activities"
  for each row execute function programme_activities_frozen();--> statement-breakpoint

-- Where each activity stood as at a date. Append-only by convention: a mistaken record is
-- superseded by a later one as at the same date, and the record of the mistake stays.
create table if not exists "programme_progress" (
  "id" uuid primary key default gen_random_uuid(),
  "activity_id" uuid not null references "programme_activities"("id") on delete cascade,
  "as_at" date not null,
  -- The dates the activity now expects, where the update moved them. Null means "as the baseline".
  "start" date,
  "finish" date,
  "percent" integer not null,
  "note" text,
  "recorded_by" text not null,
  "recorded_at" timestamptz not null default now()
);--> statement-breakpoint
do $$ begin
  alter table "programme_progress" add constraint "programme_progress_percent_range"
    check ("percent" between 0 and 100);
exception when duplicate_object then null;
end $$;--> statement-breakpoint
do $$ begin
  alter table "programme_progress" add constraint "programme_progress_dates_ordered"
    check ("start" is null or "finish" is null or "finish" >= "start");
exception when duplicate_object then null;
end $$;--> statement-breakpoint
create index if not exists "programme_progress_activity_idx" on "programme_progress" ("activity_id", "as_at", "recorded_at");
