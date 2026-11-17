-- A response is sometimes more than one document.
--
-- MUTEC's fee proposal carries the price; its technical proposal carries the scope it reads on and
-- the ECSA registration numbers of the people who would do the work; its organogram carries the
-- team. Filed as three responses they would be three respondents, two of them priceless, and the
-- comparison would rank a submission against parts of itself.
--
-- So a response keeps its priced document — `rfq_responses.document_id`, unchanged — and gathers
-- the rest here. The evaluation reads them together and the register says which document each
-- finding came from.

create table if not exists rfq_response_documents (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references rfq_responses (id) on delete cascade,
  document_id uuid not null references documents (id) on delete cascade,
  created_by text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- One document supports a response once. Withdrawing it and attaching it again is legitimate, so
-- the constraint holds only over the live rows.
create unique index if not exists rfq_response_documents_once
  on rfq_response_documents (response_id, document_id)
  where deleted_at is null;

create index if not exists rfq_response_documents_response
  on rfq_response_documents (response_id)
  where deleted_at is null;
