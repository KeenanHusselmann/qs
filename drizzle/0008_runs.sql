-- The service chain — PLATFORM.md §1.3.1, and the first thing on §18's expensive-to-reverse list.
--
-- A run has four field maps and the distinction between them is the whole design:
--
--   proposed   what the agent extracted. Never edited — the record of what the machine said
--   overrides  what the human corrected or filled
--   working    proposed + overrides, human wins. Derived, never stored (§6.5)
--   output     NULL until sign-off. Written once, frozen
--
-- `output` being absent while a run is a draft is what stops a downstream service reading
-- unapproved figures — not a status check in application code that someone can forget, but a
-- `where signed_at is not null` that finds nothing to read.
--
-- `if not exists` and `drop … if exists` throughout, for the reason 0004 records: drizzle replays by
-- timestamp rather than by hash, and a database brought forward by hand is past a migration whose
-- ledger row is missing. Running this file twice must be the same as running it once.

-- A run of one service step over the project corpus.
--
-- `module` is the nav href the step is addressed by — "/feasibility". The process code (D1.1) lives
-- on the nav item and is looked up from it; storing the code here would put the same fact in two
-- places, and PLATFORM.md §1.4 is clear that a module's process allocation can move.
--
-- Signing is `signed_by` + `signed_at` and nothing else. There is deliberately no `signed` status:
-- a status column beside a timestamp is two places for one fact, and §6.5 says derive rather than
-- store what can disagree with itself.
create table if not exists "runs" (
  "id" uuid primary key default gen_random_uuid(),
  "project_id" uuid not null references "projects"("id") on delete cascade,
  "module" text not null,

  -- Where the run got to. `signed` is not one of these — see above.
  --
  -- A check constraint rather than an enum: this set will grow (a cancelled run, a superseded one),
  -- and adding a value to a Postgres enum is its own migration with its own transaction rules,
  -- whereas widening a check constraint is one replayable statement.
  "status" text not null,
  -- The provider's own words when a run stopped (§1.3 — an outage is surfaced, never a silent gap).
  "error" text,

  -- What it spent. Kept so a reloaded run shows the same footer as the one that ran it; a figure
  -- that vanishes on refresh reads as a bug in the meter rather than as a missing column.
  "input_tokens" integer,
  "output_tokens" integer,

  -- The signature. Both or neither — the constraint below says so, because a signature with no
  -- name on it is the untraceable figure §1.3.1 warns about.
  "signed_by" text,
  "signed_at" timestamptz,

  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  "created_by" text,
  "deleted_at" timestamptz
);--> statement-breakpoint

do $$ begin
  alter table "runs" add constraint "runs_status_known"
    check ("status" in ('running', 'review', 'failed'));
exception when duplicate_object then null;
end $$;--> statement-breakpoint

do $$ begin
  alter table "runs" add constraint "runs_signature_complete"
    check (("signed_by" is null) = ("signed_at" is null));
exception when duplicate_object then null;
end $$;--> statement-breakpoint

-- The hot read: "what is the latest run of this step on this project", which every module page asks.
create index if not exists "runs_project_module_idx"
    on "runs" ("project_id", "module", "created_at" desc)
 where "deleted_at" is null;--> statement-breakpoint

-- One field of one run — the row that carries all four maps.
create table if not exists "run_fields" (
  "id" uuid primary key default gen_random_uuid(),
  "run_id" uuid not null references "runs"("id") on delete cascade,

  -- The field's stable id from the module's field set — "erf", "units".
  "field_id" text not null,
  -- Its position in that set, so a frozen run keeps the order it was read in even after the set is
  -- reordered.
  "seq" integer not null,
  -- The label copied at proposal time, for the reason §6.4 #9 gives for BillItem copying its
  -- description: the field set is going to change, and a signed record that renders as "erf"
  -- because its spec was renamed has stopped being a record of what somebody signed. Everything
  -- else about the field — its unit, what it feeds — is looked up live and simply absent if the
  -- spec dropped it.
  "label" text not null,

  -- ── proposed. What the machine said. The trigger below refuses to let it change. ──
  "proposed_state" text not null,
  "proposed_value" text,
  "proposed_confidence" real not null default 0,
  -- Why it landed where it did — including "a value was offered with a quote that is not in the
  -- filed documents. Discarded." A caught fabrication and an absent document must not look the same.
  "proposed_note" text,

  -- ── provenance (§1.3.1). The retrieval record, not decoration added afterwards. ──
  --
  -- `on delete set null`, and the name is kept beside it: a citation whose document was later
  -- deleted must still say which document it was. `carried_via` — a figure taken from an upstream
  -- service rather than a document — arrives with the downstream read that can produce one.
  "source_document_id" uuid references "documents"("id") on delete set null,
  "source_document" text,
  "source_page" integer,
  "source_excerpt" text,

  -- ── overrides. What the human corrected or filled. ──
  --
  -- A hand-entered value is an override with a person as its source (§1.3.3), so the name is not
  -- optional in practice; it is nullable only because the whole map is.
  "override_value" text,
  "override_reason" text,
  "override_by" text,
  "override_at" timestamptz,

  -- ── output. NULL until sign-off, written once, frozen. ──
  --
  -- Null inside a signed run means the run was signed with this field unestablished, which is a
  -- legitimate outcome for an optional field. Whether a run is signed is `runs.signed_at` and never
  -- the nullness of this column — which is why the freeze trigger keys on the parent run.
  "output_value" text,

  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);--> statement-breakpoint

do $$ begin
  alter table "run_fields" add constraint "run_fields_state_known"
    check ("proposed_state" in ('found', 'uncertain', 'not_found'));
exception when duplicate_object then null;
end $$;--> statement-breakpoint

-- One row per field per run. A second proposal for the same field would make `working` ambiguous.
create unique index if not exists "run_fields_unique" on "run_fields" ("run_id", "field_id");--> statement-breakpoint

-- ── The freeze, enforced here rather than in application code (§6.4) ──────────────────────────
--
-- §18 lists the service chain first among the things expensive to get wrong, and the reason is that
-- a signed figure which can still be edited is not signed. The application refuses these in words
-- because a person deserves a sentence rather than a stack trace; the trigger is what makes the
-- refusal a guarantee instead of a habit.
--
-- Two rules, and they are different rules:
--
--   1. `proposed` and its provenance never change. Not before sign-off, not after. It is the record
--      of what the machine said, and a corrected proposal is a corrected record of the past.
--   2. Once the parent run is signed, nothing on the row changes at all.
--
-- Sign-off writes `output_value` on every field first and stamps `runs.signed_at` last, in one
-- transaction, so rule 2 is not yet in force while the outputs are being written.
create or replace function run_fields_frozen() returns trigger as $$
declare
  restored run_fields%rowtype;
begin
  /**
   * The one update that is not an edit: `source_document_id references documents on delete set
   * null` firing because the cited document was hard-deleted.
   *
   * Postgres runs a referential action as an ordinary UPDATE, so it arrives here looking exactly
   * like somebody rewriting a citation — and refusing it makes deleting a project impossible, since
   * the cascade that removes its documents reaches these rows on the way. It is not a rewrite: the
   * document name and the quote, which are what make a citation readable, are untouched. What has
   * changed is that the original can no longer be opened, and recording that is more honest than
   * keeping an id that points at nothing.
   *
   * The whole row is compared rather than a list of columns, so nothing can be smuggled through
   * beside it and no column added later is forgotten.
   */
  if old.source_document_id is not null and new.source_document_id is null then
    restored := new;
    restored.source_document_id := old.source_document_id;
    if restored is not distinct from old then return new; end if;
  end if;

  if exists (select 1 from runs where id = old.run_id and signed_at is not null) then
    raise exception 'run % is signed off — its fields are frozen', old.run_id
      using errcode = 'restrict_violation';
  end if;

  if new.proposed_state    is distinct from old.proposed_state
  or new.proposed_value    is distinct from old.proposed_value
  or new.proposed_confidence is distinct from old.proposed_confidence
  or new.proposed_note     is distinct from old.proposed_note
  or new.source_document_id is distinct from old.source_document_id
  or new.source_document   is distinct from old.source_document
  or new.source_page       is distinct from old.source_page
  or new.source_excerpt    is distinct from old.source_excerpt
  or new.field_id          is distinct from old.field_id
  or new.run_id            is distinct from old.run_id
  then
    raise exception 'what the agent proposed for % cannot be edited — correct it with an override', old.field_id
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$ language plpgsql;--> statement-breakpoint

drop trigger if exists "run_fields_frozen" on "run_fields";--> statement-breakpoint
create trigger "run_fields_frozen" before update on "run_fields"
  for each row execute function run_fields_frozen();--> statement-breakpoint

-- The same guarantee at the run level: a signature cannot be moved, reassigned or withdrawn.
--
-- **Update only, deliberately.** Deleting the project deletes its runs by cascade, and a DELETE
-- guard here would make that fail — but removing a project entire is a different act from editing a
-- signature under someone, and it takes the documents the signature rests on with it. Soft delete is
-- the application-level rule (§13.4); this is the one about tampering.
create or replace function runs_frozen() returns trigger as $$
begin
  if old.signed_at is not null then
    raise exception 'run % was signed off by % — a signed run cannot be changed', old.id, old.signed_by
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$ language plpgsql;--> statement-breakpoint

drop trigger if exists "runs_frozen" on "runs";--> statement-breakpoint
create trigger "runs_frozen" before update on "runs"
  for each row execute function runs_frozen();
