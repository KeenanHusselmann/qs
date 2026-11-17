-- What a document actually carries, measured at the moment it is filed.
--
-- The import agent has to tell a technical drawing from a reference map, and nothing in the text
-- does it: two A1 sheets from the same real project run to 183 and 438 words per page, both of them
-- title block, while their drawing operations are 1 230 and 2 256 170. Three orders of magnitude,
-- invisible to full-text search. So it is counted once, here, rather than re-derived every time
-- somebody opens the import screen — building the operator list costs seconds per drawing.
--
-- `if not exists` for the reason 0004 records: drizzle replays by timestamp, and a database brought
-- forward by hand is past a migration its ledger has not recorded.

-- Null means "not measured", and is never read as zero. A drawing nobody counted is kept rather
-- than proposed for archiving — the alternative is telling a QS to bin the site's geometry on the
-- strength of a parse that failed.
alter table "documents" add column if not exists "drawing_ops" integer;--> statement-breakpoint

-- A hash of what the document says, not of its bytes. Two exports of one title deed differ in every
-- byte and say the same thing, and it is the second fact a corpus with both of them cares about.
alter table "documents" add column if not exists "text_fingerprint" text;--> statement-breakpoint

-- Finding the copies is a group-by on this, always within one project (§1.3.2 — retrieval and
-- everything like it is scoped to a project in the query, never by remembering to filter).
create index if not exists "documents_fingerprint_idx"
    on "documents" ("project_id", "text_fingerprint")
 where "deleted_at" is null and "text_fingerprint" is not null;--> statement-breakpoint

-- Nothing is backfilled. Both columns are measurements taken while the original bytes are in hand,
-- and re-deriving them for existing rows would mean re-reading every stored original. Documents
-- filed before this are judged on what is known about them and say so.
