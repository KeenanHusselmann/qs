-- Notices, claims and extensions of time – D6.1. PLATFORM.md §1.3.1, §6.3.
--
-- ── Two registers, one signature ───────────────────────────────────────────────────────────
--
-- A notice is a fact about correspondence: who gave it, when, under which clause, about what. A
-- claim is what a notice may become: a request for time, for money, or both, with the contractor's
-- figures on it and, once the principal agent has assessed it, the award. The award is the signed
-- fact – it is what moves the completion date and what a certificate deducts against – so an
-- assessed claim is frozen by trigger exactly as a signed run is. Everything before the
-- assessment is a working record and may change.

create table if not exists "contract_notices" (
  "id" uuid primary key default gen_random_uuid(),
  "project_id" uuid not null references "projects"("id") on delete cascade,
  "number" integer not null,
  "kind" text not null,
  "from_party" text not null,
  "received_on" date not null,
  "clause" text,
  "subject" text not null,
  -- When the event the notice is about happened – the date a delay notice is late against.
  "event_on" date,
  "status" text not null default 'received',
  "document_id" uuid references "documents"("id") on delete set null,
  "note" text,
  "created_by" text not null,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  "deleted_at" timestamptz
);--> statement-breakpoint
create unique index if not exists "contract_notices_project_number" on "contract_notices" ("project_id", "number");--> statement-breakpoint
do $$ begin
  alter table "contract_notices" add constraint "contract_notices_kind_known"
    check ("kind" in ('delay', 'claim', 'dispute', 'variation', 'other'));
exception when duplicate_object then null;
end $$;--> statement-breakpoint
do $$ begin
  alter table "contract_notices" add constraint "contract_notices_party_known"
    check ("from_party" in ('contractor', 'employer', 'principal_agent', 'subcontractor', 'other'));
exception when duplicate_object then null;
end $$;--> statement-breakpoint
do $$ begin
  alter table "contract_notices" add constraint "contract_notices_status_known"
    check ("status" in ('received', 'acknowledged', 'claim_lodged', 'closed'));
exception when duplicate_object then null;
end $$;--> statement-breakpoint

create table if not exists "contract_claims" (
  "id" uuid primary key default gen_random_uuid(),
  "project_id" uuid not null references "projects"("id") on delete cascade,
  "number" integer not null,
  "notice_id" uuid references "contract_notices"("id") on delete set null,
  "kind" text not null,
  "clause" text,
  "description" text not null,
  "lodged_on" date not null,
  -- The delaying event, as claimed.
  "event_from" date,
  "event_to" date,
  -- ── as claimed by the contractor ──
  "days_claimed" integer,
  "amount_claimed" bigint,
  -- ── as assessed by the principal agent. Written by the assessment, frozen with it. ──
  "days_awarded" integer,
  "amount_awarded" bigint,
  "assessment" text,
  "assessed_by" text,
  "assessed_at" timestamptz,
  "status" text not null default 'lodged',
  "document_id" uuid references "documents"("id") on delete set null,
  "created_by" text not null,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  "deleted_at" timestamptz
);--> statement-breakpoint
create unique index if not exists "contract_claims_project_number" on "contract_claims" ("project_id", "number");--> statement-breakpoint
do $$ begin
  alter table "contract_claims" add constraint "contract_claims_kind_known"
    check ("kind" in ('time', 'cost', 'time_and_cost'));
exception when duplicate_object then null;
end $$;--> statement-breakpoint
do $$ begin
  alter table "contract_claims" add constraint "contract_claims_status_known"
    check ("status" in ('lodged', 'under_assessment', 'awarded', 'rejected', 'withdrawn'));
exception when duplicate_object then null;
end $$;--> statement-breakpoint
do $$ begin
  alter table "contract_claims" add constraint "contract_claims_figures_not_negative"
    check (
      coalesce("days_claimed", 0) >= 0 and coalesce("amount_claimed", 0) >= 0
      and coalesce("days_awarded", 0) >= 0 and coalesce("amount_awarded", 0) >= 0
    );
exception when duplicate_object then null;
end $$;--> statement-breakpoint
do $$ begin
  alter table "contract_claims" add constraint "contract_claims_assessment_attributed"
    check (("assessed_by" is null) = ("assessed_at" is null));
exception when duplicate_object then null;
end $$;--> statement-breakpoint
do $$ begin
  -- Awarded or rejected means assessed; assessed means awarded or rejected. One fact, two columns.
  alter table "contract_claims" add constraint "contract_claims_assessed_iff_decided"
    check (("assessed_at" is not null) = ("status" in ('awarded', 'rejected')));
exception when duplicate_object then null;
end $$;--> statement-breakpoint
do $$ begin
  alter table "contract_claims" add constraint "contract_claims_event_ordered"
    check ("event_from" is null or "event_to" is null or "event_to" >= "event_from");
exception when duplicate_object then null;
end $$;--> statement-breakpoint

-- An assessed claim is a signed fact. The one change allowed is the soft delete, which withdraws
-- nothing from the record: the row stays, marked.
create or replace function contract_claims_frozen() returns trigger as $$
begin
  if old.assessed_at is null then
    new.updated_at := now();
    return new;
  end if;
  if new.deleted_at is distinct from old.deleted_at
     and new.days_awarded is not distinct from old.days_awarded
     and new.amount_awarded is not distinct from old.amount_awarded
     and new.assessment is not distinct from old.assessment
     and new.assessed_by is not distinct from old.assessed_by
     and new.assessed_at is not distinct from old.assessed_at
     and new.status is not distinct from old.status
     and new.days_claimed is not distinct from old.days_claimed
     and new.amount_claimed is not distinct from old.amount_claimed
  then
    new.updated_at := now();
    return new;
  end if;
  raise exception 'claim % was assessed by % — an assessed claim is frozen', old.number, old.assessed_by
    using errcode = 'restrict_violation';
end;
$$ language plpgsql;--> statement-breakpoint
drop trigger if exists "contract_claims_frozen" on "contract_claims";--> statement-breakpoint
create trigger "contract_claims_frozen" before update on "contract_claims"
  for each row execute function contract_claims_frozen();
