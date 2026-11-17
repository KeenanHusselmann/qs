-- Estimate comparison: two or more cost estimates for the same works, element by element.
--
-- The practice's MEMO-04 as a place in the platform. Two engineers' civil estimates, one made of
-- allowances and one measured off concept drawings, set side by side by element, put on one unit
-- count, the gap between them taken apart, and a third column – one of them with stated
-- corrections – carried as the planning figure. See `domain/estimate-comparison.ts`.
--
-- An estimate is a column with its own lines (quantity × rate, or a lump sum), its own unit count
-- and its own markups. A derived estimate is a copy of another's lines plus corrections, each with
-- its reason, and records which estimate it came from. Figures are decimal strings in text columns
-- the domain reads exactly; money that is entered whole (a lump sum, a correction) is the same.
--
-- Additive and replayable.
create table if not exists "estimate_comparisons" (
  "id" uuid primary key default gen_random_uuid(),
  "project_id" uuid not null references "projects" ("id") on delete cascade,
  "title" text not null,
  "subject" text,
  -- The elements in reading order: earthworks, retaining, roads, stormwater, sewer, water.
  "elements" jsonb not null default '[]'::jsonb,
  -- Every estimate is also divided by this, so per-unit figures compare one scheme.
  "common_units" text,
  "unit_label" text not null default 'units',
  "alternative_contingency" text,
  "created_by" text not null,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  "deleted_at" timestamptz
);--> statement-breakpoint

create index if not exists "estimate_comparisons_project" on "estimate_comparisons" ("project_id") where "deleted_at" is null;--> statement-breakpoint

create table if not exists "comparison_estimates" (
  "id" uuid primary key default gen_random_uuid(),
  "comparison_id" uuid not null references "estimate_comparisons" ("id") on delete cascade,
  "position" integer not null,
  "name" text not null,
  "prepared_by" text,
  "dated" text,
  "basis" text,
  "units" text,
  "preliminaries" text not null default '0.1000',
  "contingency" text not null default '0.1000',
  -- The estimate this was derived from. Kept when that one is removed, as the record of lineage.
  "derived_from" uuid references "comparison_estimates" ("id") on delete set null
);--> statement-breakpoint

create index if not exists "comparison_estimates_comparison" on "comparison_estimates" ("comparison_id", "position");--> statement-breakpoint

create table if not exists "comparison_lines" (
  "id" uuid primary key default gen_random_uuid(),
  "estimate_id" uuid not null references "comparison_estimates" ("id") on delete cascade,
  "position" integer not null,
  "element" text not null,
  "description" text not null,
  "quantity" text,
  "unit" text,
  "rate" text,
  "lump_sum" text
);--> statement-breakpoint

create index if not exists "comparison_lines_estimate" on "comparison_lines" ("estimate_id", "position");--> statement-breakpoint

-- A stated change to a derived estimate, with its reason – the memo's Table 3.
create table if not exists "comparison_corrections" (
  "id" uuid primary key default gen_random_uuid(),
  "estimate_id" uuid not null references "comparison_estimates" ("id") on delete cascade,
  "position" integer not null,
  "ref" text not null,
  "element" text not null,
  "description" text not null,
  "amount" text not null,
  "basis" text,
  "created_by" text not null,
  "created_at" timestamptz not null default now()
);--> statement-breakpoint

create index if not exists "comparison_corrections_estimate" on "comparison_corrections" ("estimate_id", "position");--> statement-breakpoint

-- Observations that go back to an estimate's author, and the answers.
create table if not exists "comparison_clarifications" (
  "id" uuid primary key default gen_random_uuid(),
  "comparison_id" uuid not null references "estimate_comparisons" ("id") on delete cascade,
  "number" integer not null,
  "estimate" text,
  "observation" text not null,
  "evidence" text,
  "consequence" text,
  "response" text,
  "status" text not null default 'Open',
  "answered_by" text,
  "answered_at" timestamptz,
  "created_by" text not null,
  "created_at" timestamptz not null default now()
);--> statement-breakpoint

create unique index if not exists "comparison_clarifications_number" on "comparison_clarifications" ("comparison_id", "number");--> statement-breakpoint

do $$ begin
  alter table "comparison_clarifications" add constraint "comparison_clarifications_status_known" check ("status" in ('Open', 'Answered', 'Closed'));
exception when duplicate_object then null;
end $$;
