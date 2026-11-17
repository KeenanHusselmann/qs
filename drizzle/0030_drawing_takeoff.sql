-- Take-off from drawings (D1.2). PLATFORM.md §1.3.2, §5.
--
-- The measuring agent writes dimension sheets from a project's drawings. What a sheet rests on is
-- kept beside it: every figure read from the drawings with the words it was quoted from, every
-- figure derived from others with its working, and every figure the drawings leave open, stated
-- as an assumption for a person to confirm. A quantity nobody can trace back to the drawing is
-- the thing this table exists to prevent.

create table if not exists "takeoff_parameters" (
  "id" uuid primary key default gen_random_uuid(),
  "project_id" uuid not null references "projects"("id") on delete cascade,
  "name" text not null,
  "label" text not null,
  -- read | derived | assumed
  "status" text not null,
  -- In the measuring unit: metres for a length printed in millimetres.
  "value" numeric(18,4) not null,
  "unit" text not null,
  -- The figure as the drawing prints it, where it was read or assumed.
  "figure" text,
  "expression" text,
  "quote" text,
  "document_id" uuid references "documents"("id") on delete set null,
  "page" integer,
  "assumption" text,
  "created_at" timestamptz not null default now()
);--> statement-breakpoint
create unique index if not exists "takeoff_parameters_project_name" on "takeoff_parameters" ("project_id", "name");--> statement-breakpoint

-- Who wrote the sheet: a person, or the agent measuring the drawings.
alter table "takeoff_items" add column if not exists "origin" text not null default 'manual';--> statement-breakpoint
-- The assumed figures the quantity rests on, said in words, for the sheet and the bill row.
alter table "takeoff_items" add column if not exists "note" text;--> statement-breakpoint
-- How a line was worked out – "2 × panel_length × wall_height" – where the agent wrote it.
alter table "takeoff_dimensions" add column if not exists "working" text;
