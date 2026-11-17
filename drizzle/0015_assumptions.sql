-- The practice's own assumptions — the figures the platform states on every report as "assumed".
--
-- ── Why these could not stay constants ─────────────────────────────────────────────────────
--
-- The report says "60/40 at prime-plus, a stated assumption" and "carried at 11,75%". A quantity
-- surveyor reading that asks where the rate came from, and until now the honest answer was that it
-- was written into `viability.ts` by whoever built the platform. A practice that cannot change its
-- own prime rate is not stating an assumption; it is accepting somebody else's.
--
-- ── Appended, never overwritten ────────────────────────────────────────────────────────────
--
-- A row per change, with the date it takes effect and who set it. The current value is the newest
-- row for a key, and the ones behind it are the record of what the practice assumed when an older
-- report was written.
--
-- That matters more here than it looks. The viability report is generated live from signed
-- figures, so changing an assumption changes every report the platform will print from now on,
-- including for jobs signed off last year. Keeping the history is what lets a reader see that a
-- figure moved and when — the alternative is a report that quietly reads differently than it did
-- the week before, with nothing on it to say so.

create table "assumptions" (
  "id" uuid primary key default gen_random_uuid(),
  -- The setting's name, matching the key in `lib/assumptions.ts`. Text rather than an enum so a
  -- new assumption is a migration of data, not of type.
  "key" text not null,
  -- Held as text and parsed, not as numeric: these are rates, counts and percentages with
  -- different scales, and one numeric column would need a precision that fits all of them or a
  -- silent round on the ones it does not.
  "value" text not null,
  "effective_from" date not null,
  "set_by" text not null,
  -- Why it was changed. Optional, and the settings page says plainly that an unexplained change
  -- is harder to defend a year later.
  "note" text,
  "created_at" timestamptz not null default now()
);

-- The current value for a key is the newest effective row, so both columns are in the index.
create index "assumptions_current_idx" on "assumptions" ("key", "effective_from" desc, "created_at" desc);
