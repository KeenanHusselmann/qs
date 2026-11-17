-- "chunks" becomes "passages".
--
-- The word was borrowed from the retrieval literature, where a "chunk" is what a splitter emits.
-- It says how the row was made, not what it is, and nobody outside that literature reads it as
-- anything. Every other name in this schema is a thing a quantity surveyor would recognise —
-- projects, documents — and this one asked the reader to know an implementation detail.
--
-- The word the rest of the codebase already uses is **passage**: the table's own docstring opens
-- "a retrievable passage from a filed document", the retriever returns passages, and the interface
-- says "no passage in it matches this criterion" to a QS. The schema was the last place still
-- calling it something else.
--
-- `idx` goes with it. Sitting beside four objects named `..._idx` for "index", a column named `idx`
-- for "position" is a pun the reader has to resolve every time. `seq` says what it holds.
--
-- ── Renames, not a rebuild ─────────────────────────────────────────────────────────────────
--
-- Drop-and-recreate would discard every indexed passage in the database, which is the whole corpus
-- — and rebuilding it means re-parsing every original file. `rename` preserves the rows, the
-- generated column, the foreign keys and the GIN index; Postgres rewrites the catalogue and nothing
-- else. It is also reversible, which drop-and-recreate is not.
--
-- ── Why every rename is guarded ────────────────────────────────────────────────────────────
--
-- This was a bare `alter table "chunks" rename to "passages"`, and the first deploy that ran the
-- migrations from a build failed on it with `relation "chunks" does not exist`. Neon had been
-- brought forward by hand, so the *schema* was past this migration while the ledger
-- (`drizzle.__drizzle_migrations`) had only recorded up to 0003 — and drizzle replays by
-- timestamp, so it replayed a rename that had already happened.
--
-- A rename that has already happened is not an error worth stopping a deploy for, and the guard
-- costs nothing. Written so that running this file twice is the same as running it once: on a
-- fresh database it renames, on one already past it, it does nothing and gets recorded.
do $$
begin
  if to_regclass('public.chunks') is not null and to_regclass('public.passages') is null then
    alter table "chunks" rename to "passages";
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_name = 'passages' and column_name = 'idx'
  ) then
    alter table "passages" rename column "idx" to "seq";
  end if;

  -- Indexes keep their own names in Postgres; renaming the table does not follow them, and an
  -- index called "chunks_search_idx" on a table called "passages" is the confusion this migration
  -- exists to remove.
  if to_regclass('public.chunks_project_idx') is not null then
    alter index "chunks_project_idx" rename to "passages_project_idx";
  end if;
  if to_regclass('public.chunks_document_idx') is not null then
    alter index "chunks_document_idx" rename to "passages_document_idx";
  end if;
  if to_regclass('public.chunks_search_idx') is not null then
    alter index "chunks_search_idx" rename to "passages_search_idx";
  end if;
  if to_regclass('public.chunks_project_search_idx') is not null then
    alter index "chunks_project_search_idx" rename to "passages_project_search_idx";
  end if;
end $$;
