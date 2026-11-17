-- A document's name, its provenance, and where its bytes went.
--
-- `filename` held the whole import path, because a browser sends the relative path in the
-- multipart filename when the file was chosen through a directory picker. A row read
-- "Talani QS - for Feasibility/02 March LAND USE SUBMISSION FOLDER FINAL/ANNEXURE A - POWER OF
-- ATTORNEY/..." and ran out of column before reaching "poa.pdf", the only part anyone was reading.
--
-- The path is still worth having — it is where the professional who assembled the submission put
-- the document — so it moves to its own column and is shown as provenance rather than as identity.
-- `if not exists` throughout: drizzle replays by timestamp, so a database brought forward by hand
-- is past a migration its ledger has not recorded. Running this file twice must equal running it
-- once — see the note in 0004, which is where that was learned.
alter table "documents" add column if not exists "source_path" text;--> statement-breakpoint

-- Where the original bytes live. `store()` has always returned this and nothing wrote it down, so
-- the platform retained every original and could open none of them.
alter table "documents" add column if not exists "storage_location" text;--> statement-breakpoint

-- Backfill what is already filed.
--
-- Rows imported one file at a time have no separator and are already correct; they keep a null
-- source_path, because inventing a path for a document that arrived without one would put a
-- provenance line on screen that nothing in the world backs up.
--
-- `chr(92)` is a backslash. Spelled that way because a backslash is LIKE's own escape character,
-- so the obvious `like '%\%'` does not mean "contains a backslash" — it means "ends with a literal
-- percent sign", and would have quietly matched nothing on every Windows-sent path.
update "documents"
   set "source_path" = "filename"
 where "filename" like '%/%' or strpos("filename", chr(92)) > 0;--> statement-breakpoint

-- The name is the last segment. Both separators, because the sender may be on either platform.
update "documents"
   set "filename" = regexp_replace("filename", '^.*[/\\]', '')
 where "source_path" is not null;--> statement-breakpoint

-- A path made only of separators would leave the name empty, and an empty name is an unclickable,
-- unsearchable row that reads as a rendering fault rather than as a malformed upload.
update "documents"
   set "filename" = 'Unnamed document'
 where btrim("filename") = '';--> statement-breakpoint

-- storage_location stays null for everything filed before this migration. It is resolved on
-- demand instead: the storage key is derived from the document id, so an original written by an
-- earlier build is still found. See `locate()` in src/lib/ingest/storage.ts.
