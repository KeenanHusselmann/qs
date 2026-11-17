-- Tender returns priced against the signed bill — PLATFORM.md §1.3.1, §4.7, §5.2, §1.4 (D1.3).
--
-- ── Why a tender return is not another bill run ───────────────────────────────────────────────
--
-- The obvious shortcut is to make each tenderer's return a `runs` row with its own `run_items`,
-- reusing everything the bill already has. It is wrong in a way that costs later: a run is one
-- module's output with one signature, and `loadLatestBill` takes the newest — so five tenderers on
-- one project would be five runs of `/bill` competing to be *the* bill, and the fifth would win.
--
-- A tender return is a different fact from a bill. It is somebody else's price against **our**
-- quantities, and the quantities are exactly what it must not carry a second copy of. So a return
-- holds rates only, keyed to the bill rows they were quoted against, and every quantity in the
-- comparison comes from the one signed bill all of them priced.
--
-- ── `bill_run_id` is the point, not bookkeeping ───────────────────────────────────────────────
--
-- A tender was invited on a specific issue of the bill. Revising and re-signing that bill does not
-- retrospectively change what a contractor priced, so the return records the run it was invited on
-- and the comparison can say plainly when the schedule has moved on underneath it. Without this
-- column a revision would silently re-base every price in the adjudication.

create table "tender_returns" (
  "id" uuid primary key default gen_random_uuid(),
  "project_id" uuid not null references "projects"("id") on delete cascade,

  -- The issue of the bill this tender was invited on. See the note above.
  "bill_run_id" uuid not null references "runs"("id") on delete cascade,

  "tenderer" text not null,

  -- What the tenderer says their tender comes to, in minor units — as submitted, uncorrected.
  --
  -- Stored rather than derived, and that is the whole of the arithmetic check: the sum a
  -- contractor writes on the form and the sum their own rates produce against our quantities are
  -- two different numbers often enough that checking it is a named QS task. Deriving this would
  -- destroy the very discrepancy it exists to surface.
  "stated_sum" bigint,

  "received_at" timestamptz,
  "created_by" text,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  "deleted_at" timestamptz
);--> statement-breakpoint

-- One row per tenderer per bill item. A missing row is a rate not quoted, which is a real state:
-- an item a tenderer left blank is not an item they priced at nought.
create table "tender_prices" (
  "id" uuid primary key default gen_random_uuid(),
  "return_id" uuid not null references "tender_returns"("id") on delete cascade,
  "item_id" uuid not null references "run_items"("id") on delete cascade,

  "rate" bigint,
  -- §5.1 — the scale travels with the rate it belongs to, exactly as on a bill row.
  "rate_precision" integer not null default 2,

  -- Written by the trigger below and by nothing else, as on `run_items`.
  "amount" bigint,

  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),

  constraint "tender_prices_rate_precision" check ("rate_precision" between 0 and 6),
  constraint "tender_prices_one_per_item" unique ("return_id", "item_id")
);--> statement-breakpoint

create index "tender_returns_project_idx" on "tender_returns" ("project_id", "bill_run_id")
  where "deleted_at" is null;--> statement-breakpoint
create index "tender_prices_return_idx" on "tender_prices" ("return_id");--> statement-breakpoint

-- ── The extension, against the bill's own quantity ───────────────────────────────────────────
--
--     amount_minor = round( bill.output_quantity × rate / 10^(rate_precision − 2) )
--
-- The same rule as `run_items_extend`, character for character in its arithmetic, and deliberately
-- a third statement of it rather than a clever shared one: `checks/bill.mjs` already drives the
-- same table of values — exact halves, negatives, six-place rates — through the trigger and through
-- `extend()` in `src/domain/money.ts` and compares them, and this is checked the same way.
--
-- The quantity is the **signed bill's frozen** one (`output_quantity`), never the working value. A
-- comparison is only a comparison if every tenderer priced the same quantities, and a draft
-- quantity still being corrected is not a quantity anybody was invited to price.
create or replace function tender_prices_extend() returns trigger as $$
declare
  qty numeric(18,4);
begin
  if new.rate is null then
    new.amount := null;
    return new;
  end if;

  select "output_quantity" into qty from "run_items" where "id" = new."item_id";

  -- An unmeasured item extends to nothing, not to nought — the same distinction the bill makes,
  -- and the reason the sign-off gate refuses a bill with a hole in it in the first place.
  if qty is null then
    new.amount := null;
    return new;
  end if;

  new.amount := round(qty * new.rate::numeric / (10::numeric ^ (new.rate_precision - 2)))::bigint;
  return new;
end;
$$ language plpgsql;--> statement-breakpoint

drop trigger if exists "tender_prices_extend" on "tender_prices";--> statement-breakpoint
create trigger "tender_prices_extend" before insert or update on "tender_prices"
  for each row execute function tender_prices_extend();--> statement-breakpoint
