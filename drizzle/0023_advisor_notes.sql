-- What the advisor found, kept so it is not lost with the conversation – PLATFORM.md §1.3, §6.3.
--
-- ── The problem ──────────────────────────────────────────────────────────────────────────────
--
-- A reader searched the web for cement prices, got a table of them with sources, turned web search
-- off, and asked the same thing later. The advisor had no idea it had ever looked: the conversation
-- lived in the panel's memory and went with a reload, and nothing it found was kept anywhere.
--
-- ── What is kept, and why only that ──────────────────────────────────────────────────────────
--
-- Web findings. They are the one thing the advisor learns that it cannot learn again for free: the
-- model's own general answers it re-derives on every question, and keeping those would let a wrong
-- one repeat itself with the authority of having been "remembered". A project's documents are
-- already filed and searchable, and are not copied out of their project.
--
-- Firm-wide, with no project column, for the reason `policies` gives: a nullable project id turns
-- every scoped query into an OR somebody forgets. A web finding is public information the practice
-- looked up – the question already left the building to get it – so it belongs to the practice.
--
-- Each note is markdown (what is indexed and what the model reads), with the structured answer and
-- its sources beside it so the panel can draw the table again and link every page. It is dated,
-- because a price found in September is a price in September.

create table "advisor_notes" (
  "id" uuid primary key default gen_random_uuid(),
  "kind" text not null,
  "question" text not null,
  -- The question normalised, so asking the same thing twice refreshes one note rather than piling up.
  "question_key" text not null,
  "title" text not null,
  "body" text not null,
  "structured" jsonb,
  "sources" jsonb not null default '[]'::jsonb,
  "saved_by" text not null,
  "saved_at" timestamp with time zone not null default now(),
  -- Soft: a note somebody asked the advisor to forget stops being recalled and is still on record.
  "deleted_at" timestamp with time zone,

  -- Generated, as `policy_passages.search` is: the application never writes it.
  "search" tsvector generated always as (
    to_tsvector('english', "title" || ' ' || "question" || ' ' || "body")
  ) stored
);

create unique index "advisor_notes_question_unique" on "advisor_notes" ("kind", "question_key") where "deleted_at" is null;
create index "advisor_notes_search_idx" on "advisor_notes" using gin ("search");
