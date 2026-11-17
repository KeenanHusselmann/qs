-- Element unit quantities for the elemental cost plan (D1.1). PLATFORM.md §5.
--
-- An element's quantity is taken from its principal measured item unless a QS sets another – "m² of
-- footprint" for substructure, say – and the element unit rate is its cost over that quantity. No row
-- means the quantity is the measured one.
create table if not exists "element_quantities" (
  "project_id" uuid not null references "projects"("id") on delete cascade,
  "element" text not null,
  "quantity" numeric(18,4) not null,
  "unit" text not null,
  -- What the quantity measures – "footprint of the wall", "gross floor area".
  "label" text not null,
  "set_by" text not null,
  "set_at" timestamptz not null default now(),
  primary key ("project_id", "element")
);--> statement-breakpoint
do $$ begin
  alter table "element_quantities" add constraint "element_quantities_positive" check ("quantity" > 0);
exception when duplicate_object then null;
end $$;
