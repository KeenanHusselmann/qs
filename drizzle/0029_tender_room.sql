-- The Tender Room – issuing a tender, its addenda, receiving and opening returns (D1.3).
--
-- A tender is issued on one signed bill (`bill_run_id`), to named tenderers, with a closing time.
-- Addenda are numbered per tender and each tenderer's acknowledgement is recorded. A tenderer's
-- return is recorded when it arrives – the time decides whether it is late – and at the opening the
-- on-time sums become `tender_returns` rows against the same bill, which is what Tender Analysis
-- compares. Once opened, a tender is closed: the timestamps and sums it was opened on are frozen.

create table if not exists "tenders" (
  "id" uuid primary key default gen_random_uuid(),
  "project_id" uuid not null references "projects"("id") on delete cascade,
  "bill_run_id" uuid not null references "runs"("id") on delete restrict,
  "reference" text not null,
  "closing_at" timestamptz not null,
  "validity_days" integer not null default 90,
  "briefing_at" timestamptz,
  "briefing_venue" text,
  "issued_at" timestamptz,
  "issued_by" text,
  "opened_at" timestamptz,
  "opened_by" text,
  "created_by" text not null,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);--> statement-breakpoint
-- One tender in progress per project: a second is started only once the first is opened.
create unique index if not exists "tenders_one_open_per_project" on "tenders" ("project_id") where "opened_at" is null;--> statement-breakpoint
do $$ begin
  alter table "tenders" add constraint "tenders_validity_positive" check ("validity_days" > 0);
exception when duplicate_object then null;
end $$;--> statement-breakpoint

create table if not exists "tender_invitees" (
  "id" uuid primary key default gen_random_uuid(),
  "tender_id" uuid not null references "tenders"("id") on delete cascade,
  "contact_id" uuid references "contacts"("id") on delete set null,
  "company" text not null,
  "contact_name" text,
  "email" text,
  "received_at" timestamptz,
  "tender_sum" bigint,
  "qualifications" text,
  "declined_at" timestamptz,
  "return_id" uuid references "tender_returns"("id") on delete set null,
  "created_at" timestamptz not null default now()
);--> statement-breakpoint
create unique index if not exists "tender_invitees_company" on "tender_invitees" ("tender_id", lower("company"));--> statement-breakpoint
do $$ begin
  alter table "tender_invitees" add constraint "tender_invitees_sum_positive" check ("tender_sum" is null or "tender_sum" > 0);
exception when duplicate_object then null;
end $$;--> statement-breakpoint

create table if not exists "tender_addenda" (
  "id" uuid primary key default gen_random_uuid(),
  "tender_id" uuid not null references "tenders"("id") on delete cascade,
  "number" integer not null,
  "subject" text not null,
  "body" text not null,
  "issued_at" timestamptz not null default now(),
  "issued_by" text not null
);--> statement-breakpoint
create unique index if not exists "tender_addenda_number" on "tender_addenda" ("tender_id", "number");--> statement-breakpoint

create table if not exists "tender_acknowledgements" (
  "addendum_id" uuid not null references "tender_addenda"("id") on delete cascade,
  "invitee_id" uuid not null references "tender_invitees"("id") on delete cascade,
  "acknowledged_at" timestamptz not null default now(),
  primary key ("addendum_id", "invitee_id")
);--> statement-breakpoint

-- Once opened, a tender and its returns are the record of the opening: nothing about them changes.
create or replace function tenders_opened_frozen() returns trigger as $$
declare
  opened timestamptz;
begin
  select t.opened_at into opened from tenders t where t.id = coalesce(new.tender_id, old.tender_id);
  if opened is not null then
    raise exception 'the tender was opened on % — its returns are the record of the opening and are frozen', opened
      using errcode = 'restrict_violation';
  end if;
  return coalesce(new, old);
end;
$$ language plpgsql;--> statement-breakpoint
drop trigger if exists "tender_invitees_frozen" on "tender_invitees";--> statement-breakpoint
create trigger "tender_invitees_frozen" before insert or update or delete on "tender_invitees"
  for each row execute function tenders_opened_frozen();--> statement-breakpoint
drop trigger if exists "tender_addenda_frozen" on "tender_addenda";--> statement-breakpoint
create trigger "tender_addenda_frozen" before insert or update or delete on "tender_addenda"
  for each row execute function tenders_opened_frozen();
