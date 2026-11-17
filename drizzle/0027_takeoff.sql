-- Take-off – dimension sheets (D1.2). PLATFORM.md §4.7, §6.3.
--
-- A take-off item is what is being measured – a description and a unit – and its dimension lines
-- are the measurement: a timesing factor and up to three dimensions, each line optionally a
-- deduction. The item's quantity is derived from its lines on every read (`domain/dimensions.ts`)
-- and never stored, so it cannot disagree with them.
--
-- An item may be linked to a row of the project's bill. Sending it writes the measured quantity
-- into that row as an override whose source is 'takeoff' – a claim the bill already had a word for
-- (0010's `quantity_source`) and nothing wrote until now.

create table if not exists "takeoff_items" (
  "id" uuid primary key default gen_random_uuid(),
  "project_id" uuid not null references "projects"("id") on delete cascade,
  "number" integer not null,
  "section" text,
  "description" text not null,
  "unit" text not null,
  -- The drawing it was measured from, where one is named.
  "drawing_id" uuid references "documents"("id") on delete set null,
  -- The bill row it feeds. Null until linked; set null if the row goes with its run.
  "bill_item_id" uuid references "run_items"("id") on delete set null,
  -- What was last sent, and when, so the page can say when the bill is behind the sheet.
  "sent_quantity" numeric(18,4),
  "sent_at" timestamptz,
  "sent_by" text,
  "created_by" text not null,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  "deleted_at" timestamptz
);--> statement-breakpoint
create unique index if not exists "takeoff_items_project_number" on "takeoff_items" ("project_id", "number");--> statement-breakpoint

create table if not exists "takeoff_dimensions" (
  "id" uuid primary key default gen_random_uuid(),
  "item_id" uuid not null references "takeoff_items"("id") on delete cascade,
  "seq" integer not null,
  -- Where on the drawing – "Block A, grid 1–4", the annotation a checker reads it by.
  "location" text,
  "timesing" numeric(18,4) not null default 1,
  "length" numeric(18,4),
  "width" numeric(18,4),
  "depth" numeric(18,4),
  "deduct" boolean not null default false,
  "created_at" timestamptz not null default now()
);--> statement-breakpoint
create index if not exists "takeoff_dimensions_item_seq" on "takeoff_dimensions" ("item_id", "seq");--> statement-breakpoint
do $$ begin
  alter table "takeoff_dimensions" add constraint "takeoff_dimensions_positive"
    check (
      "timesing" > 0
      and coalesce("length", 1) > 0 and coalesce("width", 1) > 0 and coalesce("depth", 1) > 0
      -- Dimensions fill from the left: no width without a length, no depth without a width.
      and ("width" is null or "length" is not null)
      and ("depth" is null or "width" is not null)
    );
exception when duplicate_object then null;
end $$;
