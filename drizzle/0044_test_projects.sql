-- Test projects stay out of the practice's figures (audit C5).
--
-- Home's KPIs and the benchmarks counted TEST projects: one at R0,24/m² and R13,31 a unit fed the
-- firm's cost per unit and the benchmark bands. A test project is still a project – it is listed,
-- opened and worked like any other – but nothing firm-level reads it.
--
-- The backfill marks every project whose name starts with TEST. The practice confirmed on
-- 17 Nov 2026 that none of those belongs to a real client. Additive and replayable: the update only
-- ever sets the flag on names that say TEST, so running it again changes nothing.
alter table "projects" add column if not exists "is_test" boolean not null default false;--> statement-breakpoint
update "projects" set "is_test" = true where "name" ilike 'test%' and "is_test" = false;
