-- The practice's own resource factors — PLATFORM.md §4.8, §6.3, §1.3.1.
--
-- ── The problem this exists to fix ───────────────────────────────────────────────────────────
--
-- `build-up-method.ts` asks the model what one unit of work is made of, and that was defensible on
-- the grounds that a measurement factor is a stable fact: 104 bricks in a square metre of one-brick
-- walling is true this year and was true thirty years ago, and a QS spots a wrong one instantly.
--
-- **It holds for materials and it does not hold for labour and plant.** Asked the same question
-- twice on the same day, the model returned 0,10 hours of concrete mixer per m² and then 0,15 — a
-- fifty per cent difference in a figure a QS might price from. Bricks per square metre is fixed by
-- geometry. Hours per square metre is a *productivity assumption*, and a productivity assumption is
-- the practice's, not the model's: it depends on the gang, the site, the access and the season, and
-- a firm that has been building for twenty years knows its own better than any general answer.
--
-- So the factors become firm data, with the same standing as a rate: stated, attributable, dated,
-- and never silently replaced. The model keeps the job it is good at — proposing a method for work
-- the practice has no factor for yet — and the take-off says which of the two a reader is looking
-- at, every line, rather than presenting them as one kind of thing.
--
-- ── Firm-level, and why that is the whole point ──────────────────────────────────────────────
--
-- No `project_id`, exactly as `rates` has none. A factor copied into every job is a factor that has
-- to be corrected in every job, and the correction that matters most — "our bricklayers actually
-- lay this in 1,4 hours, not 1,2" — is the one a practice learns once and should never re-enter.
--
-- ── Append-only, because a factor is a fact about a date ─────────────────────────────────────
--
-- The same rule `rates` follows (§6.3). Revising a factor **inserts** a row with a later
-- `effective_date`; it never updates the old one. A cost plan priced last March was priced on the
-- assumptions in force last March, and a table that overwrote them could not answer for it.
-- `deleted_at` withdraws a factor, which is a different act from repricing it (§6.1).

create table "resource_factors" (
  "id" uuid primary key default gen_random_uuid(),

  /*
    The work this is a factor *for*, as a bill item would describe it.

    "One-brick wall in stock brick", not "wall" — the material and the thickness, because that is
    what makes the factor mean anything. Matched against the reader's own words by `factorsFor`,
    which uses the same significant-word comparison the rate library uses to match a bill row, so a
    practice does not have to guess the exact phrasing to get its own numbers back.
  */
  "work" text not null,
  -- What that work is measured in: m2 for walling, m3 for concrete, m for kerbing.
  "work_unit" text not null,

  -- 'material', 'labour', 'plant', 'subcontract', 'other' — `COMPONENT_KINDS` in lib/pricing.ts.
  -- Not a check constraint: §6.9 treats a classification as a dimension, and the kinds have grown
  -- once already. The application validates; the table records.
  "kind" text not null,

  -- The resource itself, in the words the rate library files it under, so it can be priced.
  "resource" text not null,
  "resource_unit" text not null,

  /*
    How much of the resource goes into **one** unit of the work. `numeric(18,4)`, per §5.1.

    104,0000 bricks in a m² of walling. Never a float: a factor that went through a JavaScript
    number on the way in would be wrong before it was ever multiplied by anything.
  */
  "quantity" numeric(18,4) not null,

  /*
    The cutting-and-breakage allowance for *this resource*, as a decimal fraction (§5.1 — 0,0500
    is five per cent).

    Per factor rather than per method, which is a correction to how the model's proposal is shaped:
    brickwork runs at about five per cent and tiling at ten, and one number for a whole build-up
    either overstates the bricks or understates the tiles. Null means "no allowance stated", and
    the take-off then falls back to the method's own — absent is not nought.
  */
  "waste_rate" numeric(6,4),

  /*
    Province, where the factor has a regional basis. Null means none was stated.

    Read exactly as `rates.region` is: a factor stating no region is eligible everywhere, and one
    stating a different province is a different assumption for a reason.
  */
  "region" text,

  /*
    Where the factor came from, and it is required — §6.3, the same reasoning as `rates.source`.

    "ASAQS Model Preambles", "our own output records 2024-2026", "supplier technical sheet" and
    "the estimator's judgement" are different kinds of claim, and a factor with no stated origin is
    one nobody can defend when a contractor disputes the allowance.
  */
  "source" text not null,

  -- The date the factor applies from. Read as at a date, never as "the latest row".
  "effective_date" date not null,

  "created_at" timestamptz not null default now(),
  "created_by" text not null,
  -- Withdrawn, not repriced. §6.1 — never a hard delete.
  "deleted_at" timestamptz
);

-- The lookup this table exists for: "what does this practice hold for this work, as at today".
create index "resource_factors_work_idx"
  on "resource_factors" ("work_unit", "effective_date" desc)
  where "deleted_at" is null;
