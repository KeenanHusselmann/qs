-- What a project covers — PLATFORM.md §1.3.1, §13.1.
--
-- ── Why phase numbers and not a new list of stages ────────────────────────────────────────────
--
-- The vocabulary already exists. `process-model.ts` carries **L0, the seven-phase construction
-- value chain** — Feasibility & Inception, Design & Documentation, Procurement & Tender,
-- Construction & Delivery, Handover & Commissioning, Close-out & Final Account, Asset & Warranty —
-- and every process area declares which phase it belongs to. Each module already declares its
-- process area through its entry criteria, so **module → area → phase** is a chain that resolves
-- today, with nothing invented.
--
-- A second list of "stages" beside that would be the same domain fact written twice, and the two
-- would drift the first time somebody renamed one. So this column holds phase *numbers* and the
-- names stay where they are.
--
-- ── Why null rather than a default of "all" ───────────────────────────────────────────────────
--
-- A SQL default would have to spell out `{1,2,3,4,5,6,7}`, which is the phase list copied into a
-- migration where nobody would think to look when an eighth arrives. **Null means "every stage"**,
-- which is exactly what a project created before this column existed meant, so there is no backfill
-- and no list to keep in step. The application writes the selection explicitly on every new
-- project, so null only ever means "created before this was asked".

alter table "projects" add column if not exists "stages" integer[];--> statement-breakpoint

-- A phase number outside L0 is not a stage, and an empty selection is a project that covers no work
-- at all — which is not a project. Refused here rather than left to whichever writer comes next.
do $$ begin
  alter table "projects" add constraint "projects_stages_are_phases"
    check (
      "stages" is null
      -- `<@` is "every element is in that set", and `cardinality` counts an empty array as 0 where
      -- `array_length` would return null and quietly satisfy the check. A subquery cannot appear in
      -- a check constraint at all — Postgres refuses it with `transformSubLink`, which is how the
      -- first version of this line was found.
      or (cardinality("stages") between 1 and 7 and "stages" <@ '{1,2,3,4,5,6,7}'::integer[])
    );
exception when duplicate_object then null;
end $$;
