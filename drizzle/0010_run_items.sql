-- The row-shaped run — PLATFORM.md §1.3.3, §4.7, §5.2, §6.4.
--
-- ── Why `run_fields` could not hold a bill ────────────────────────────────────────────────────
--
-- `run_fields` is one row per *named field of a fixed set* — ten for the feasibility estimate,
-- thirteen for the cost plan. A bill is not that. It is N items discovered from the documents, each
-- with a description, a unit, a quantity, a rate and an amount; N is not known in advance, there is
-- no stable `field_id`, and the arithmetic is per row. Synthetic ids like `item.3.quantity` would
-- have been the first dishonest thing in this schema.
--
-- So: a sibling table. §1.3.1's four maps are unchanged — proposed / overrides / working / output —
-- and what changes is that a row carries five values rather than one.
--
--   proposed_*   what the agent read. Never edited; the trigger below refuses
--   override_*   what the QS corrected, typed or pasted
--   working      derived — `coalesce(override_x, proposed_x)`, human wins. Never stored (§6.5)
--   output_*     null until sign-off. Written once, frozen
--
-- `if not exists` and `drop … if exists` throughout, for the reason 0004 records: drizzle replays by
-- timestamp rather than by hash, so running this file twice must be the same as running it once.

create table if not exists "run_items" (
  "id" uuid primary key default gen_random_uuid(),
  "run_id" uuid not null references "runs"("id") on delete cascade,

  -- **Sparse** — 100, 200, 300 (§6.3). A bill has items inserted into the middle of it for the whole
  -- of its life, and dense ordinals would renumber every row below the insert every time.
  "seq" integer not null,
  -- Section → Trade → Item (§4.7). Null at the top of the bill.
  "parent_id" uuid references "run_items"("id") on delete cascade,
  -- §4.7's vocabulary. `heading` and `item` are what this platform writes today; the rest are the
  -- domain's own list and are named here so a later row type is not a migration on a signed table.
  "row_type" text not null,
  -- The reference a QS quotes in a meeting — "B.1.2". Null until the bill is numbered.
  "item_ref" text,

  -- ── proposed. What the machine said. The trigger below refuses to let it change. ──
  "proposed_description" text,
  "proposed_unit" text,
  "proposed_quantity" numeric(18,4),
  "proposed_rate" bigint,
  -- §5.1 — a rate carries its own scale, because a brick rate wants four decimal places where a
  -- concrete rate wants two, and rounding the rate itself would compound across thousands of lines.
  "proposed_rate_precision" integer,
  -- What the document actually said, before it was read as a number. Kept for the figures
  -- `readAmount` **refused**: "R1 850,00 per cubic metre" is a rate this platform will not silently
  -- turn into an amount, and the reader deserves the document's own words beside the empty cell.
  "proposed_quantity_text" text,
  "proposed_rate_text" text,
  "proposed_confidence" real not null default 0,
  "proposed_note" text,

  -- ── provenance, per row rather than per cell (§1.3.2) ──
  --
  -- A bill item comes from one passage — a spec clause, a priced line in a source bill — and citing
  -- each of five cells to the same passage is duplication that makes the grid unreadable. What *is*
  -- per cell is `quantity_source` below.
  "source_document_id" uuid references "documents"("id") on delete set null,
  "source_document" text,
  "source_page" integer,
  "source_excerpt" text,

  -- ── overrides. What the human corrected, typed or pasted. ──
  "override_description" text,
  "override_unit" text,
  "override_quantity" numeric(18,4),
  "override_rate" bigint,
  "override_rate_precision" integer,
  "override_reason" text,
  "override_by" text,
  "override_at" timestamptz,

  -- §6.3 — "the agent read this quantity", "a QS typed it" and "it was pasted out of a spreadsheet"
  -- are three different claims about the same number, and none of them is derivable from the others.
  "quantity_source" text not null default 'ai_derived',

  -- ── the extension. §5.2's only rounding point, computed by the trigger and never by a writer. ──
  "amount" bigint,

  -- ── output. Null until sign-off, written once, frozen. ──
  "output_description" text,
  "output_unit" text,
  "output_quantity" numeric(18,4),
  "output_rate" bigint,
  "output_rate_precision" integer,
  "output_amount" bigint,

  -- ── struck, not deleted ──
  --
  -- A QS strikes a row the agent proposed. Deleting it would lose `proposed`, which is the record of
  -- what the machine said and the thing that makes the bill reviewable at all. Same shape as
  -- withdraw-versus-delete in the corpus.
  "omitted_at" timestamptz,
  "omitted_by" text,

  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);--> statement-breakpoint

do $$ begin
  alter table "run_items" add constraint "run_items_row_type_known"
    check ("row_type" in ('heading', 'item', 'subtotal', 'provisional_sum', 'prime_cost', 'note'));
exception when duplicate_object then null;
end $$;--> statement-breakpoint

do $$ begin
  alter table "run_items" add constraint "run_items_quantity_source_known"
    check ("quantity_source" in ('manual', 'takeoff', 'imported', 'ai_derived'));
exception when duplicate_object then null;
end $$;--> statement-breakpoint

-- §4.7: a heading is bold with no quantities, and **a heading carrying a quantity is a bug**. Said
-- here rather than left to the writer, because a heading with a rate on it would be summed into the
-- bill total by a query that had no way to know it should not be.
do $$ begin
  alter table "run_items" add constraint "run_items_only_items_priced"
    check (
      "row_type" = 'item' or (
        "proposed_quantity" is null and "override_quantity" is null and "output_quantity" is null
        and "proposed_rate" is null and "override_rate" is null and "output_rate" is null
        and "amount" is null and "output_amount" is null
      )
    );
exception when duplicate_object then null;
end $$;--> statement-breakpoint

-- A rate and its scale travel together or the figure means nothing: 185000 is R1 850,00 at two
-- places and R18,5000 at four. The extension trigger reads the precision beside the rate it belongs
-- to, and this is what lets it do so without guessing.
do $$ begin
  alter table "run_items" add constraint "run_items_rate_scale_paired"
    check (
      ("proposed_rate" is null) = ("proposed_rate_precision" is null)
      and ("override_rate" is null) = ("override_rate_precision" is null)
      and ("output_rate" is null) = ("output_rate_precision" is null)
    );
exception when duplicate_object then null;
end $$;--> statement-breakpoint

-- §5.1 allows 0–6 decimal places on a rate; below the money scale a rate would scale the amount
-- *up*, which no rate in this schema does and `extend()` in `money.ts` throws for. Refused here too,
-- so the two implementations of §5.2 cannot disagree about what they accept.
do $$ begin
  alter table "run_items" add constraint "run_items_rate_precision_range"
    check (
      coalesce("proposed_rate_precision", 2) between 2 and 6
      and coalesce("override_rate_precision", 2) between 2 and 6
      and coalesce("output_rate_precision", 2) between 2 and 6
    );
exception when duplicate_object then null;
end $$;--> statement-breakpoint

-- An override with nobody's name on it is the untraceable figure §1.3.1 warns about, and a strike
-- with nobody's name on it is the same thing one step further on.
do $$ begin
  alter table "run_items" add constraint "run_items_override_attributed"
    check (("override_by" is null) = ("override_at" is null));
exception when duplicate_object then null;
end $$;--> statement-breakpoint

do $$ begin
  alter table "run_items" add constraint "run_items_omission_attributed"
    check (("omitted_by" is null) = ("omitted_at" is null));
exception when duplicate_object then null;
end $$;--> statement-breakpoint

-- The bill, in its own order. Every read of this table is "the rows of this run, top to bottom".
create index if not exists "run_items_run_seq_idx" on "run_items" ("run_id", "seq");--> statement-breakpoint

-- ── The extension — PLATFORM.md §5.2, and §6.4's second invariant ─────────────────────────────
--
--     amount = round(quantity × rate)      ← rounded ONCE, at the bill item
--
-- **This trigger and `extend()` in `src/domain/money.ts` are two implementations of one rule**, and
-- `checks/bill.mjs` runs the same table of values through both and asserts they agree — including
-- the exact halves and the negatives, which is where two roundings drift apart.
--
-- Why a trigger and not a generated column: a generated column cannot call a function that rounds
-- half away from zero, and half-away-from-zero is not a preference. It is what a QS gets from a hand
-- calculation and from Excel's ROUND, and §5.2's requirement is that a total be reproducible by hand.
-- Postgres `round(numeric)` is ties-away-from-zero, which is the same rule `divideRounded` applies.
--
-- Why it is not left to the application: the amount is stored (§6.5 — read constantly), so every
-- writer would have to remember, and one that forgot would leave a row whose amount disagreed with
-- its own quantity and rate. Nothing downstream could tell.
--
-- The arithmetic, in minor units:
--
--     amount_minor = round( quantity × rate_value / 10^(rate_precision − 2) )
--
-- 1 250,0000 m³ at R1 850,00 (185000 at two places) → 1250 × 185000 / 10^0 = 231 250 000 = R2 312 500,00.
create or replace function run_items_extend() returns trigger as $$
declare
  qty numeric(18,4);
  unit_rate bigint;
  scale integer;
begin
  -- §4.7 again: only an item is priced. A heading's amount is the sum of what is under it, and that
  -- is derived at read time (§6.5) rather than stored where it could go stale.
  if new.row_type <> 'item' then
    new.amount := null;
    return new;
  end if;

  -- `working` — human wins (§1.3.1). The same rule as `workingValue()`, applied to five values
  -- instead of one, and applied *here* so that the stored amount can never be the extension of
  -- figures nobody is looking at.
  qty := coalesce(new.override_quantity, new.proposed_quantity);
  unit_rate := coalesce(new.override_rate, new.proposed_rate);
  scale := coalesce(new.override_rate_precision, new.proposed_rate_precision, 2);

  -- A row missing either half has no amount, and **not** an amount of nought. An item nobody has
  -- measured and an item measured at zero are different facts, and the sign-off gate refuses the
  -- first by name.
  if qty is null or unit_rate is null then
    new.amount := null;
    return new;
  end if;

  new.amount := round(qty * unit_rate::numeric / (10::numeric ^ (scale - 2)))::bigint;
  return new;
end;
$$ language plpgsql;--> statement-breakpoint

drop trigger if exists "run_items_extend" on "run_items";--> statement-breakpoint
create trigger "run_items_extend" before insert or update on "run_items"
  for each row execute function run_items_extend();--> statement-breakpoint

-- ── The freeze, the same guarantee `run_fields` already has (§6.4) ────────────────────────────
--
-- Two rules, and they are different rules:
--
--   1. `proposed` and its provenance never change. Not before sign-off, not after. It is the record
--      of what the machine said, and a corrected proposal is a corrected record of the past.
--   2. Once the parent run is signed, nothing on the row changes at all — **and no row may be added
--      to it**. That second half is why this fires on insert as well, which `run_fields` does not
--      need: a field set is closed, and a bill is a list somebody can always append to.
--
-- The trigger name matters. Postgres fires `before` triggers in name order, so `run_items_extend`
-- runs first and this one sees the recomputed amount — which is what makes the `on delete set null`
-- exemption below able to compare whole rows.
create or replace function run_items_frozen() returns trigger as $$
declare
  restored run_items%rowtype;
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from runs where id = new.run_id and signed_at is not null) then
      raise exception 'run % is signed off — no row can be added to it', new.run_id
        using errcode = 'restrict_violation';
    end if;
    return new;
  end if;

  -- The one update that is not an edit: `source_document_id references documents on delete set
  -- null` firing because the cited document was hard-deleted. Postgres runs a referential action as
  -- an ordinary UPDATE, so it arrives here looking exactly like somebody rewriting a citation — and
  -- refusing it would make a project undeletable, since the cascade that removes its documents
  -- reaches these rows on the way out. The whole row is compared, so only the id may go: the
  -- document's name and the quote, which are what make a citation readable, stay.
  if old.source_document_id is not null and new.source_document_id is null then
    restored := new;
    restored.source_document_id := old.source_document_id;
    if restored is not distinct from old then return new; end if;
  end if;

  if exists (select 1 from runs where id = old.run_id and signed_at is not null) then
    raise exception 'run % is signed off — its bill is frozen', old.run_id
      using errcode = 'restrict_violation';
  end if;

  if new.proposed_description    is distinct from old.proposed_description
  or new.proposed_unit           is distinct from old.proposed_unit
  or new.proposed_quantity       is distinct from old.proposed_quantity
  or new.proposed_rate           is distinct from old.proposed_rate
  or new.proposed_rate_precision is distinct from old.proposed_rate_precision
  or new.proposed_quantity_text  is distinct from old.proposed_quantity_text
  or new.proposed_rate_text      is distinct from old.proposed_rate_text
  or new.proposed_confidence     is distinct from old.proposed_confidence
  or new.proposed_note           is distinct from old.proposed_note
  or new.source_document_id      is distinct from old.source_document_id
  or new.source_document         is distinct from old.source_document
  or new.source_page             is distinct from old.source_page
  or new.source_excerpt          is distinct from old.source_excerpt
  or new.run_id                  is distinct from old.run_id
  then
    raise exception 'what the agent proposed for row % cannot be edited — correct it with an override', old.id
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$ language plpgsql;--> statement-breakpoint

drop trigger if exists "run_items_frozen" on "run_items";--> statement-breakpoint
create trigger "run_items_frozen" before insert or update on "run_items"
  for each row execute function run_items_frozen();
