-- Whether a filed document covers a requirement, read once by the model — PLATFORM.md §1.3.2, §1.3.3.
--
-- ── The problem this exists to fix ───────────────────────────────────────────────────────────
--
-- A requirement was met only when a document of an accepted kind contained one of its fixed
-- phrases word for word: "market study", "project brief". A tester filed a sales outlook as a
-- Market study that stated the absorption rate and the selling price, and the Feasibility Estimate
-- still refused to start, because the document never used the words "market study". A QS writes
-- in their own words, not in the platform's vocabulary.
--
-- Accepting any document of the right kind would be the opposite failure, and `checks/ingest.mjs`
-- guards against it: a cost plan filed as a project programme must not tick the programme off.
--
-- So where the phrases do not match, the model reads the document and says whether it covers the
-- requirement, with a verbatim quote that is located in the document before it counts. The answer
-- is kept here, because grounding runs on every page render and a model call per render would be
-- slow and paid for over and over for a document that has not changed.
--
-- ── Keyed by document, not by kind ───────────────────────────────────────────────────────────
--
-- The row records what the document says, which does not change when somebody re-files it under
-- another kind. Whether it counts is still decided at read time by the kind check in
-- `criteria-grounding.ts`, so a document moved to a kind the requirement does not accept stops
-- satisfying it without this table being touched.

create table "document_coverage" (
  "id" uuid primary key default gen_random_uuid(),
  "document_id" uuid not null references "documents"("id") on delete cascade,
  "criterion_id" text not null,

  -- False is a finding too: "read, and it does not cover this". It is kept so the same question is
  -- not asked again on every filing.
  "covered" boolean not null,
  -- The document's own characters, located in its passages. Null when not covered.
  "quote" text,
  "page" integer,

  "checked_at" timestamp with time zone not null default now()
);

create unique index "document_coverage_unique" on "document_coverage" ("document_id", "criterion_id");
