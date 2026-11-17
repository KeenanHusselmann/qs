-- Design cost control: the detailed estimate checked against the cost plan's targets (D1.1-SP-003).
--
-- The check itself is computed every time from the signed cost plan and the bill – it is not
-- stored, so a bill item priced is a check changed, everywhere, at once. What is stored is what a
-- person adds to it: why an element moved, and what the client decided.
--
-- A note is the current word on one line of the check, so it is one row per line and is replaced.
-- A decision is a record, so it is appended and never changed: the latest is the one in force, and
-- the earlier ones are the history of the budget. Each carries the figures it was made on, because
-- the bill under it will keep moving and "the client approved R4,1m" means nothing without what the
-- estimate stood at when they did.
--
-- Additive and replayable.
create table if not exists "cost_movement_notes" (
  "project_id" uuid not null references "projects" ("id") on delete cascade,
  -- A line of the check: substructure, superstructure, finishes, services, … – `COST_LINES`.
  "line" text not null,
  "note" text not null,
  "set_by" text not null,
  "set_at" timestamptz not null default now(),
  primary key ("project_id", "line")
);--> statement-breakpoint

create table if not exists "cost_decisions" (
  "id" uuid primary key default gen_random_uuid(),
  "project_id" uuid not null references "projects" ("id") on delete cascade,
  "decision" text not null check ("decision" in ('proceed', 'redesign', 'revise-budget')),
  "note" text not null default '',
  -- Cents, excluding VAT. Only for a revised budget.
  "revised_budget" bigint,
  -- What the decision was made on: the budget in force, the detailed estimate, the verdict.
  "budget" bigint,
  "detailed" bigint not null,
  "verdict" text not null,
  -- The signed cost plan and the bill it was checked between. A revised budget stands only for
  -- the cost plan it was approved against; a new plan is a new budget.
  "cost_plan_run_id" uuid references "runs" ("id") on delete set null,
  "bill_run_id" uuid references "runs" ("id") on delete set null,
  "decided_by" text not null,
  "decided_at" timestamptz not null default now()
);--> statement-breakpoint

create index if not exists "cost_decisions_project" on "cost_decisions" ("project_id", "decided_at");
