-- The rate library — PLATFORM.md §4.5, §4.8, §6.3.
--
-- ── A rate set is a firm asset, so this table has no project ─────────────────────────────────
--
-- `navigation.ts` already puts the Rate Library under **Firm** rather than in a project's nav, and
-- says why: "WinQS's rate libraries and §4.5's Item Library are the same asset: the reusable
-- descriptions and rates a practice builds up." A rate copied into every project is a rate that
-- has to be corrected in every project, and §6.3 makes provenance a property of the rate set
-- rather than of the job that happened to use it.
--
-- The reference prototype scopes its `rates` to a project. That is the thing being deliberately
-- not copied. It is the same mistake as a nullable `project_id`, one step later: the moment a
-- second job needs the same concrete rate, either it is entered twice or one of them is wrong.
--
-- ── Appended, never overwritten — the same model as `assumptions` ────────────────────────────
--
-- A price is a fact about a date. "25 MPa concrete in strip footings, Gauteng" was R1 850,00 in
-- Q4 2023 and is something else now, and **both are true**. Updating the row in place would throw
-- away the figure a signed bill was priced against, which is exactly the provenance §1.3.1 exists
-- to keep: a certificate argued two years from now is argued against the rate that applied then.
--
-- So there is no `updated_at`. A new price is a new row with its own `effective_date` and its own
-- `source`, and "the current rate" is a query — the newest row on or before today for that item in
-- that region. `assumptions` (0015) settled this shape for firm-level figures and this follows it,
-- so a reader learning one has learned the other.
--
-- `deleted_at` is here even so, and it is not a contradiction: withdrawing a rate says "stop
-- offering this", which is a different act from repricing it. §6.1 — never hard-delete.
--
-- ── Money is minor units and carries its own scale ───────────────────────────────────────────
--
-- §5.1, and `run_items` already does it this way: `rate` is a bigint of minor units and
-- `rate_precision` is the scale it is held at, because 185000 is R1 850,00 at 2 and R18,5000 at 4.
-- A rate library holds both — a cubic metre of concrete is priced to the cent, and a rate per
-- 100 bricks or per linear metre of conduit is not.
--
-- The prototype's `numeric(18,2)` is the thing not copied here. §5 is explicit that a rate rounded
-- at storage is a rate that cannot reproduce the extension it was used in.

create table "rates" (
  "id" uuid primary key default gen_random_uuid(),

  -- What kind of work it is. Null where a rate has not been classified — §6.9 makes
  -- classifications dimensions rather than a required taxonomy nobody maintains.
  "trade" text,

  -- The item as a QS would read it in a bill. Not a code: §9.1 says say the domain word, and a
  -- rate whose description does not match the bill item it prices is a rate nobody will trust.
  "description" text not null,
  "unit" text not null,

  "rate" bigint not null,
  "rate_precision" integer not null default 2,

  -- Province. Null means "no regional basis stated", which is different from national — the
  -- library must not imply a rate applies everywhere when nobody said so.
  "region" text,

  /*
    Where the figure came from, and it is required.

    §6.3 makes provenance a property of a rate set. This is the column that makes the library
    usable in an argument: "SAFCEC Q4 2023" and "a supplier quote" and "a market survey" are
    different kinds of claim, and a rate with no stated origin is one nobody can defend. It is
    text rather than an enum because the sources are documents a practice subscribes to, and a new
    subscription must not need a migration.
  */
  "source" text not null,

  -- The date the price applies from. The library is read as at a date, never as "latest row".
  "effective_date" date not null,

  "created_at" timestamptz not null default now(),
  "created_by" text not null,
  "deleted_at" timestamptz
);

/*
  The query the screen actually runs: current rates for a trade and a region, newest first.

  `deleted_at is null` leads because a withdrawn rate must never reach a bill, and a partial index
  keeps the withdrawn rows out of the index rather than out of the results after the fact.
*/
create index "rates_current_idx"
  on "rates" ("trade", "region", "effective_date" desc)
  where "deleted_at" is null;

-- Free-text search over the description, which is how a QS looks for a rate — they know what the
-- item is, not what it was filed under.
create index "rates_description_idx" on "rates" ("description");
