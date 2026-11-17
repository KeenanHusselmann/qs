-- Quotations – an RFQ and the responses to it, evaluated (D1.3). PLATFORM.md §1.3.2, §5.
--
-- An RFQ states what is being procured: the scope items every response must cover and the
-- requirements it must show. Each response is a filed quotation; evaluating it stores what the
-- agent read (`extraction`) and what the platform found when it checked it (`result`) – the price
-- lines with their arithmetic verified, the scope covered, the requirements shown. The
-- recommendation is worked out from the results whenever the RFQ is read; the decision a QS takes on
-- it – the recommendation accepted, or another response chosen and why – is recorded here.
create table if not exists "rfqs" (
  "id" uuid primary key default gen_random_uuid(),
  "project_id" uuid not null references "projects"("id") on delete cascade,
  "title" text not null,
  "scope" jsonb not null default '[]',
  "requirements" jsonb not null default '[]',
  "decided_response_id" uuid,
  "decision_reason" text,
  "decided_by" text,
  "decided_at" timestamptz,
  "created_by" text not null,
  "created_at" timestamptz not null default now(),
  "deleted_at" timestamptz
);--> statement-breakpoint
create index if not exists "rfqs_project" on "rfqs" ("project_id");--> statement-breakpoint

create table if not exists "rfq_responses" (
  "id" uuid primary key default gen_random_uuid(),
  "rfq_id" uuid not null references "rfqs"("id") on delete cascade,
  "document_id" uuid not null references "documents"("id") on delete cascade,
  "supplier" text,
  "extraction" jsonb,
  "result" jsonb,
  "evaluated_at" timestamptz,
  "input_tokens" integer,
  "output_tokens" integer,
  "error" text,
  "created_by" text not null,
  "created_at" timestamptz not null default now(),
  "deleted_at" timestamptz
);--> statement-breakpoint
create unique index if not exists "rfq_responses_document" on "rfq_responses" ("rfq_id", "document_id") where "deleted_at" is null;
