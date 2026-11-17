-- Value engineering — the options considered for bringing a cost back to a budget (D1.1).
--
-- A register rather than an adjustment. The classic way value engineering goes wrong is that the
-- saving is agreed in a meeting, deducted from the estimate, and nobody afterwards can say which
-- option it came from, whether it was ever measured, or what it cost in quality. So each option is
-- a row with its own provenance: what changes, what it saves, how that figure was arrived at, what
-- it costs besides money, and who decided.
--
-- Nothing here changes a cost plan. An accepted option is a decision to make a change, and the
-- change reaches the money when somebody re-measures or re-rates the work — which is a signed step
-- of its own. A register that silently moved the total would be the same confident wrong number
-- this platform exists to prevent.

create table if not exists value_options (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  -- Per project, so an option can be referred to as "VE 7" in a meeting.
  number integer not null,

  -- The cost plan element it bears on, in the same vocabulary the plan uses.
  element text,
  description text not null,

  -- Cents. Positive saves money; negative is an option that costs more and buys something else.
  saving bigint not null,
  -- How that figure was arrived at: measured | rate | quotation | estimate.
  -- An estimate is not a lesser answer, but a gap closed entirely by estimates is not closed.
  basis text not null default 'estimate',

  -- What it costs besides money. A value engineering option with nothing said here has not been
  -- thought about: every real one trades something.
  effect text,

  status text not null default 'proposed',
  raised_by text,
  decision_reason text,
  decided_by text,
  decided_at timestamptz,

  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists value_options_project_number
  on value_options (project_id, number)
  where deleted_at is null;

create index if not exists value_options_project
  on value_options (project_id)
  where deleted_at is null;

-- The budget a project is held to.
--
-- The platform had no such figure anywhere, which is why value engineering had nothing to aim at:
-- the register could add up its own savings and not say whether they were enough. The practice's
-- own scope mapping names it twice - "value engineering if required for budget" and "financial
-- control of project budget" - so it is a fact about the project rather than about one exercise.
--
-- Nullable, because most projects do not have one settled at the start, and a nought would be a
-- budget of nothing rather than no budget.
alter table projects add column if not exists budget bigint;
