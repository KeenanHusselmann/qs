-- A figure that arrived from an upstream service rather than from a document — PLATFORM.md §1.3.1.
--
-- Held back until now on purpose. §1.3.1 names `carried_via` alongside the other provenance columns,
-- and it was left out of 0008 because there was exactly one run-producing module and therefore
-- nothing a figure could be carried from: an always-null column sits in every row implying a
-- capability that does not exist, which is the same argument `schema.ts` makes for not declaring an
-- embedding column before there is an embedding provider. The cost plan is the upstream reader that
-- makes it real.
--
-- **Both provenances are kept, and that is the whole point of a separate column.** §1.3.1: "a
-- figure's provenance is its original document *and* the path it travelled, and collapsing them
-- loses whichever the reader needed". A QS checking a cost per unit wants the brief the unit count
-- was read from — `source_document`, already there — *and* wants to know it came through a signed
-- feasibility estimate rather than being read afresh out of this step's own corpus. The first tells
-- them whether the figure is true; the second tells them who approved it.
--
-- `if not exists` for the reason 0004 records: drizzle replays by timestamp, and a database brought
-- forward by hand is past a migration whose ledger row is missing.

-- The module the figure travelled through — "/feasibility". Null for a value this step read itself.
alter table "run_fields" add column if not exists "carried_via" text;--> statement-breakpoint

-- The exact run it was taken from, so the path can be walked rather than inferred.
--
-- No foreign key, deliberately. The reference points at a **signed** run, which is frozen and which
-- `runs_frozen()` will not let anybody edit — but a project deleted years later would cascade
-- through this column as `set null` or refuse the delete outright, and neither is worth it for a
-- pointer whose target cannot change. The module and the original document survive either way, so a
-- dangling id degrades to "carried, and the run it came through is gone" rather than to nothing.
alter table "run_fields" add column if not exists "carried_from_run_id" uuid;--> statement-breakpoint

-- Nothing is backfilled. Every existing row was read from a document by the run that wrote it, and
-- null is the correct answer for all of them.
