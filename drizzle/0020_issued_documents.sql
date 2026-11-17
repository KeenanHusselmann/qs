-- Documents the practice has issued — PLATFORM.md §4.11, §1.3.1, §6.1.
--
-- ── Why a generated report needs storing at all ──────────────────────────────────────────────
--
-- The viability report is generated **live** from signed figures, and that is deliberate: it can
-- never contradict them, because it is derived from them at the moment it is asked for. `pdf.ts`
-- and `bill-pdf.ts` both work that way and both should stay that way.
--
-- But a live report answers a different question from the one a practice needs answered a year
-- later. "What does this project come to?" is live. "**What did we send the client in March?**" is
-- not, and re-generating cannot answer it: the figures have moved since, and the document that
-- comes back is not the document that was sent.
--
-- So both. The live report stays the source of truth and nothing here replaces it. This records
-- what left the building: the bytes as issued, who issued them, when, and — the part that makes it
-- worth keeping — **which signatures it was generated from**.
--
-- ── The signatures are the point ─────────────────────────────────────────────────────────────
--
-- §1.3.1: every figure traces to a document and a signature. A stored PDF on its own is a picture
-- of some numbers. A stored PDF that says "generated from these five signed steps" is a record
-- somebody can defend, because each of those runs is frozen (`runs_frozen()`) and still readable.
-- `signed_run_ids` is that list, and it is why this table is not just a file cabinet.
--
-- Not a foreign key array, because Postgres has no such constraint and inventing a join table for
-- an audit record that is never queried by run would be machinery nothing reads. A run cannot be
-- deleted anyway — the freeze trigger refuses every update including `deleted_at`.
--
-- ── Never deleted, only withdrawn ────────────────────────────────────────────────────────────
--
-- §6.1's soft delete, and here it means something specific: a report that was sent cannot be
-- unsent. Withdrawing marks it as superseded so it stops appearing as current, and the record of
-- having issued it stays, because that is the fact somebody will need.

create table "issued_documents" (
  "id" uuid primary key default gen_random_uuid(),

  -- The project it belongs to. Firm-level documents are not a thing yet; when they are, this
  -- becomes nullable rather than the table being split.
  "project_id" uuid not null references "projects"("id") on delete cascade,

  /*
    What kind of document it is — 'viability_report' or 'bill_of_quantities' today.

    Text rather than an enum: a practice issues certificates, variation orders and final accounts
    too, and each of those arriving should be a row in this table rather than a migration.
  */
  "kind" text not null,

  -- What it calls itself. The filename a reader downloads, and what the register lists.
  "title" text not null,

  -- Where the bytes are — a Blob key or a path under STORAGE_DIR, exactly as `documents` holds it.
  "storage_location" text not null,
  "byte_size" integer not null,

  /*
    The signed runs this was generated from, newest first.

    Empty is legitimate and is not an error: a bill can be issued as a draft, and a viability report
    can be generated on a project with nothing signed. The register says so rather than hiding it —
    an issued document resting on no signature is exactly the one somebody should look at twice.
  */
  "signed_run_ids" uuid[] not null default '{}',

  "issued_by" text not null,
  "issued_at" timestamptz not null default now(),

  -- Superseded rather than removed. A report that was sent cannot be unsent.
  "withdrawn_at" timestamptz,
  "withdrawn_by" text
);

-- The register's own query: this project's documents, newest first, current ones only.
create index "issued_documents_project_idx"
  on "issued_documents" ("project_id", "issued_at" desc)
  where "withdrawn_at" is null;
