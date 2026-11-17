-- Full-text search over the project corpus — PLATFORM.md §1.3.2.
--
-- The lexical half of hybrid retrieval, and for this domain the half that carries the most weight.
-- Construction documents are dense with exact identifiers — SANS 1200, 25 MPa/19mm, Erf 180,
-- JBCC PBA 6.2, a rate of R185,50 — and these are precisely what embeddings are worst at:
-- `SANS 1200` and `SANS 10400` sit close together in vector space, and in a costing platform that
-- is not a near miss, it is a wrong number.
--
-- A generated column rather than a trigger: Postgres keeps it in step with `body` itself, so there
-- is no path by which a chunk exists without being searchable.
alter table "chunks"
  add column "search" tsvector
  generated always as (to_tsvector('english', "body")) stored;

create index "chunks_search_idx" on "chunks" using gin ("search");

-- Retrieval is always scoped to one project (§1.3.2), so the project is part of the index rather
-- than a filter applied after the fact.
create index "chunks_project_search_idx" on "chunks" ("project_id") include ("id");
