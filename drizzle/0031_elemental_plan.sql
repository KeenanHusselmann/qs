-- The elemental cost plan, from the measured bill (D1.1, Cost Plan Revision). PLATFORM.md §5.
--
-- Which element each bill row belongs to – written by the measuring agent for the items it
-- measures, and by a QS for any row they reassign. A row with no entry here is grouped by its words
-- (`domain/elemental-plan.ts`), and the page says which rows were grouped that way.
create table if not exists "bill_elements" (
  "run_item_id" uuid primary key references "run_items"("id") on delete cascade,
  "element" text not null,
  -- 'agent' where the measuring agent assigned it, otherwise the email of the person who did.
  "set_by" text not null,
  "set_at" timestamptz not null default now()
);--> statement-breakpoint
do $$ begin
  alter table "bill_elements" add constraint "bill_elements_known"
    check ("element" in ('substructure', 'superstructure', 'finishes', 'fittings', 'services', 'external', 'preliminaries', 'provisional'));
exception when duplicate_object then null;
end $$;--> statement-breakpoint

-- What the plan adds to the measured work, per project. No row means nobody has set them, and the
-- page shows typical figures marked as assumptions until somebody does.
create table if not exists "cost_plan_allowances" (
  "project_id" uuid primary key references "projects"("id") on delete cascade,
  "preliminaries" numeric(6,4) not null,
  "contingency" numeric(6,4) not null,
  "escalation" numeric(6,4) not null,
  "vat" numeric(6,4) not null,
  -- The plan's unit of measure – "m of boundary wall", "m² gross floor area" – and how many.
  "measure_label" text,
  "measure_value" numeric(18,4),
  "set_by" text not null,
  "set_at" timestamptz not null default now()
);
