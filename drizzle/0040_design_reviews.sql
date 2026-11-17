-- Design review: a draft bill read line by line against the design that should govern it.
--
-- The practice's own working paper, as a place in the platform. The Marshall Dam boundary wall
-- review mapped three draft bills from an outside QS against the architect's, engineer's, surveyor's
-- and geotechnical documents in seven sheets: a sources register, design parameters side by side,
-- every bill item with a status and a finding, the options compared, a numbered query list, and the
-- items priced per option. Each of those is a table here, under one review.
--
-- A project can hold several reviews – the boundary wall's bills and the internal civils' estimates
-- are reviewed separately – so the review is its own row rather than a column on the project.
--
-- Per-option figures (quantities, rates, item numbers) are jsonb keyed by the option's key, because
-- the number of options is the review's and not the schema's: three here, two on the next job.
-- They are decimal strings, never JSON numbers, so nothing passes through binary floating point.
--
-- Additive and replayable.
create table if not exists "design_reviews" (
  "id" uuid primary key default gen_random_uuid(),
  "project_id" uuid not null references "projects" ("id") on delete cascade,
  "title" text not null,
  "subject" text,
  -- [{ "key": "option-b", "label": "Option B" }, …] in the order the bills were issued.
  "options" jsonb not null default '[]'::jsonb,
  "base_option" text,
  "recommendation" text,
  "limitations" text,
  -- The design parameters' column headings: one per discipline and one per option.
  "parameter_columns" jsonb not null default '[]'::jsonb,
  -- Contingency, VAT, P&A on provisional sums, the accuracy band, the main dimension and a figure
  -- to compare against – the estimate sheet's yellow cells.
  "assumptions" jsonb not null default '{}'::jsonb,
  -- The workbook it was imported from, where it was.
  "source_file" text,
  "created_by" text not null,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  "deleted_at" timestamptz
);--> statement-breakpoint

create index if not exists "design_reviews_project" on "design_reviews" ("project_id") where "deleted_at" is null;--> statement-breakpoint

-- Every document read, with the short reference the rest of the review cites it by.
create table if not exists "review_sources" (
  "id" uuid primary key default gen_random_uuid(),
  "review_id" uuid not null references "design_reviews" ("id") on delete cascade,
  "position" integer not null,
  "ref" text not null,
  "discipline" text,
  "document" text not null,
  "dated" text,
  -- "Rev 002", "Superseded concept". Free text, because that is how a register is kept; the
  -- review flags any item that cites a source whose status says superseded.
  "status" text,
  "notes" text,
  "location" text
);--> statement-breakpoint

create index if not exists "review_sources_review" on "review_sources" ("review_id", "position");--> statement-breakpoint

create table if not exists "review_parameters" (
  "id" uuid primary key default gen_random_uuid(),
  "review_id" uuid not null references "design_reviews" ("id") on delete cascade,
  "position" integer not null,
  "parameter" text not null,
  "values" jsonb not null default '{}'::jsonb,
  "status" text,
  "consequence" text
);--> statement-breakpoint

create index if not exists "review_parameters_review" on "review_parameters" ("review_id", "position");--> statement-breakpoint

-- One bill item across every option: quantity, the governing design reference, status, finding,
-- recommended action, and the estimate's rate for it.
create table if not exists "review_items" (
  "id" uuid primary key default gen_random_uuid(),
  "review_id" uuid not null references "design_reviews" ("id") on delete cascade,
  "position" integer not null,
  "ref" text not null,
  "bill" text not null,
  "item_numbers" jsonb not null default '{}'::jsonb,
  "description" text not null,
  "unit" text,
  "quantities" jsonb not null default '{}'::jsonb,
  "design_source" text,
  "requirement" text,
  "status" text,
  "finding" text,
  "action" text,
  "rates" jsonb not null default '{}'::jsonb,
  "rate_basis" text,
  "updated_by" text,
  "updated_at" timestamptz not null default now()
);--> statement-breakpoint

create index if not exists "review_items_review" on "review_items" ("review_id", "position");--> statement-breakpoint

do $$ begin
  alter table "review_items" add constraint "review_items_status_known"
    check ("status" is null or "status" in ('Aligned', 'Discrepancy', 'Error', 'Gap', 'Query', 'QS addition', 'Standard'));
exception when duplicate_object then null;
end $$;--> statement-breakpoint

-- The query list that goes out, and the answers as they come back.
create table if not exists "review_queries" (
  "id" uuid primary key default gen_random_uuid(),
  "review_id" uuid not null references "design_reviews" ("id") on delete cascade,
  -- Q1, Q2 … per review, so a query can be referred to in a letter.
  "number" integer not null,
  "topic" text,
  "query" text not null,
  "raised_to" text,
  "affects" text,
  "priority" text,
  "source_ref" text,
  "response" text,
  "status" text not null default 'Open',
  "answered_by" text,
  "answered_at" timestamptz,
  "created_by" text not null,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);--> statement-breakpoint

create unique index if not exists "review_queries_number" on "review_queries" ("review_id", "number");--> statement-breakpoint

do $$ begin
  alter table "review_queries" add constraint "review_queries_status_known" check ("status" in ('Open', 'Answered', 'Closed'));
exception when duplicate_object then null;
end $$;--> statement-breakpoint

do $$ begin
  alter table "review_queries" add constraint "review_queries_priority_known" check ("priority" is null or "priority" in ('High', 'Medium', 'Low'));
exception when duplicate_object then null;
end $$;--> statement-breakpoint

-- What the design needs that the bills do not carry, priced per option and tied to its query.
create table if not exists "review_adjustments" (
  "id" uuid primary key default gen_random_uuid(),
  "review_id" uuid not null references "design_reviews" ("id") on delete cascade,
  "position" integer not null,
  "ref" text not null,
  "query_number" integer,
  "description" text not null,
  "unit" text,
  "quantities" jsonb not null default '{}'::jsonb,
  "rates" jsonb not null default '{}'::jsonb,
  "basis" text
);--> statement-breakpoint

create index if not exists "review_adjustments_review" on "review_adjustments" ("review_id", "position");
