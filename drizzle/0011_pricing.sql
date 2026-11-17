-- Pricing — PLATFORM.md §4.8, §5.1, §5.2, §6.3.
--
-- ── Pricing is not a new run ──────────────────────────────────────────────────────────────────
--
-- §4.8 is the bill's rate column, revisited. It proposes no rows, establishes no field set and
-- carries no signature of its own: the rows are `run_items`, the signature is the bill's, and the
-- freeze that already governs them governs this. A `runs` row for pricing would be a second
-- approved answer to "what does this item cost" with nothing downstream able to say which of the
-- two a total was summed from.
--
-- So this migration adds two things to a table that already exists, and one thing beside it:
--
--   1. `run_items.rate_source` — where the rate came from, the exact parallel of `quantity_source`
--   2. `rate_build_ups` / `rate_components` — §4.8's build-up, hanging off one bill row
--
-- ── What is deliberately not stored ───────────────────────────────────────────────────────────
--
-- The build-up's **computed rate**. It is `sum(component quantity × component rate)`, plus waste,
-- plus markup — a derivation over figures three lines away, and §6.5's rule for a value that
-- changes as fast as its inputs is *derive*. `buildUpRate()` in `src/domain/money.ts` is the one
-- statement of it, read by the editor and by the writer that applies it.
--
-- What **is** stored is the figure the arithmetic actually uses: `run_items.override_rate`, which
-- the extension trigger in 0010 reads to produce the amount. One stored rate per row, as before,
-- and it is still the rate the screen is showing.
--
-- `if not exists` throughout, for the reason 0004 records: drizzle replays by timestamp rather than
-- by hash, so running this file twice must be the same as running it once.

-- ── Where a rate came from — §6.3 ─────────────────────────────────────────────────────────────
--
-- The same argument `quantity_source` already makes, about the other figure on the row: "the agent
-- read this", "a QS typed it", "it was pasted out of a spreadsheet" and "a build-up produced it"
-- are four different claims about one number, and **none of them is derivable from the others**. A
-- build-up is the near miss — a row with one attached looks as though its rate must have come from
-- it, right up until the QS types over the top, which §4.8 requires be possible and flagged.
alter table "run_items" add column if not exists "rate_source" text not null default 'ai_derived';--> statement-breakpoint

-- §6.3's own list, plus the two this platform genuinely produces today. `library`, `rate_set` and
-- `tender` are named now and written by nothing: they are the domain's own vocabulary, and naming
-- them here is a check constraint rather than a migration on a signed table later — the same
-- reasoning `run_items_row_type_known` already carries.
do $$ begin
  alter table "run_items" add constraint "run_items_rate_source_known"
    check ("rate_source" in ('ai_derived', 'manual', 'imported', 'build_up', 'library', 'rate_set', 'tender'));
exception when duplicate_object then null;
end $$;--> statement-breakpoint

-- ── The build-up — §4.8 ───────────────────────────────────────────────────────────────────────
--
-- One per bill row (§6.3: "build-up belongs to one BillItem"), which the unique constraint states
-- rather than leaves to the writer. Two build-ups behind one rate would be two derivations of a
-- figure that can only have had one.
create table if not exists "rate_build_ups" (
  "id" uuid primary key default gen_random_uuid(),
  "run_item_id" uuid not null unique references "run_items"("id") on delete cascade,

  -- §5.1 — percentages as the decimal fraction, `numeric(6,4)`: 0.1000 is 10%. Stored the way the
  -- schema and the code both read it, so neither has to remember to divide by a hundred.
  "waste_rate" numeric(6,4) not null default 0,
  "markup_rate" numeric(6,4) not null default 0,

  -- §4.8's **plug**: "a manual override that is flagged, never hidden".
  --
  -- Held here rather than only on the row, because the two say different things. The row's
  -- `override_rate` is the figure the extension uses; this is the QS's statement that they are not
  -- using the build-up's answer — which survives the next component edit, where a rate typed into
  -- the grid would simply be recomputed away.
  "plug_rate" bigint,
  "plug_rate_precision" integer,

  "created_by" text not null,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);--> statement-breakpoint

-- A rate and its scale travel together or the figure means nothing — 185000 is R1 850,00 at two
-- places and R18,5000 at four. The same pairing `run_items_rate_scale_paired` makes, for the same
-- reason, on a rate that reaches exactly the same arithmetic.
do $$ begin
  alter table "rate_build_ups" add constraint "rate_build_ups_plug_scale_paired"
    check (
      ("plug_rate" is null) = ("plug_rate_precision" is null)
      and coalesce("plug_rate_precision", 2) between 2 and 6
    );
exception when duplicate_object then null;
end $$;--> statement-breakpoint

-- A negative waste or markup is a discount written in the wrong box, and a markup above 100% is
-- almost always a percentage entered as a fraction of one. Refused at the boundary rather than
-- multiplied into four thousand rates.
do $$ begin
  alter table "rate_build_ups" add constraint "rate_build_ups_percentages_sane"
    check ("waste_rate" >= 0 and "waste_rate" <= 1 and "markup_rate" >= 0 and "markup_rate" <= 1);
exception when duplicate_object then null;
end $$;--> statement-breakpoint

-- ── The components — §4.8's five kinds ────────────────────────────────────────────────────────
--
-- "component rows (Labour / Material / Plant / Subcontract / Other) with quantity and unit rate".
-- The quantity is per **one unit of the bill item**: 0,35 t of cement in a cubic metre of concrete,
-- not in the whole of the substructure. That is what makes the sum a rate rather than an amount.
create table if not exists "rate_components" (
  "id" uuid primary key default gen_random_uuid(),
  "build_up_id" uuid not null references "rate_build_ups"("id") on delete cascade,

  -- Dense, not sparse — unlike `run_items.seq`. A build-up is five rows a person retypes in place,
  -- never a list of four thousand somebody inserts into the middle of.
  "seq" integer not null,
  "kind" text not null,
  "description" text,

  -- Both nullable: a component being typed is incomplete, and an incomplete component contributes
  -- **nothing** rather than nought. `computeBuildUp` counts them and the editor says so, because a
  -- rate that is quietly short by one line is the confident wrong number this platform is arranged
  -- against.
  "quantity" numeric(18,4),
  "rate" bigint,
  "rate_precision" integer,

  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);--> statement-breakpoint

do $$ begin
  alter table "rate_components" add constraint "rate_components_kind_known"
    check ("kind" in ('labour', 'material', 'plant', 'subcontract', 'other'));
exception when duplicate_object then null;
end $$;--> statement-breakpoint

do $$ begin
  alter table "rate_components" add constraint "rate_components_rate_scale_paired"
    check (
      ("rate" is null) = ("rate_precision" is null)
      and coalesce("rate_precision", 2) between 2 and 6
    );
exception when duplicate_object then null;
end $$;--> statement-breakpoint

create index if not exists "rate_components_build_up_seq_idx"
  on "rate_components" ("build_up_id", "seq");--> statement-breakpoint

-- ── The freeze, reaching two tables further out ───────────────────────────────────────────────
--
-- A signed bill's rate is frozen by `run_items_frozen`. Its **derivation** has to be frozen with
-- it: a build-up edited after the signature would leave an approved rate sitting under a working
-- that no longer produces it, which is the untraceable figure §1.3.1 calls worse than a gap.
--
-- `insert or update` and **not delete**, which is the same shape every freeze in this schema has
-- and the same reason: `run_items` cascades from `runs` from `projects`, so a delete trigger here
-- would make a project with a signed bill undeletable. 0010 records that failure being found by
-- `clean-test-projects.mjs` rather than by inspection. The application refuses the delete in
-- sentences (`openFor`), and the row's own trigger refuses the update that would accompany it.
create or replace function rate_build_up_frozen() returns trigger as $$
declare
  item_id uuid;
begin
  if tg_table_name = 'rate_build_ups' then
    item_id := new.run_item_id;
  else
    -- A component reaches its bill row through its build-up. A build-up that is already gone cannot
    -- be reached to check, which only happens inside a cascade — where refusing would be the
    -- undeletable-project bug above.
    select b.run_item_id into item_id from rate_build_ups b where b.id = new.build_up_id;
    if item_id is null then return new; end if;
  end if;

  if exists (
    select 1 from run_items i join runs r on r.id = i.run_id
     where i.id = item_id and r.signed_at is not null
  ) then
    raise exception 'the bill this rate belongs to is signed off — its build-up is frozen'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$ language plpgsql;--> statement-breakpoint

drop trigger if exists "rate_build_ups_frozen" on "rate_build_ups";--> statement-breakpoint
create trigger "rate_build_ups_frozen" before insert or update on "rate_build_ups"
  for each row execute function rate_build_up_frozen();--> statement-breakpoint

drop trigger if exists "rate_components_frozen" on "rate_components";--> statement-breakpoint
create trigger "rate_components_frozen" before insert or update on "rate_components"
  for each row execute function rate_build_up_frozen();
