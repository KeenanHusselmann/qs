-- Set-password links: nobody sets another person's password (audit C7).
--
-- An administrator used to type a password for a new or locked-out person and pass it on, so the
-- administrator knew it. Now they create a single-use link and the person chooses their own.
--
-- Only the SHA-256 of the token is stored. The token is 256 random bits, so a fast hash is enough:
-- there is nothing to guess, and a copy of this table yields no working link. A link is consumed by
-- one conditional update – unused and unexpired – so two clicks cannot both succeed.
--
-- Additive and replayable.
create table if not exists "password_links" (
  "id" uuid primary key default gen_random_uuid(),
  "user_id" uuid not null references "users" ("id") on delete cascade,
  "token_hash" text not null unique,
  -- 'invite' (a new person, seven days) or 'reset' (an existing one, a day).
  "purpose" text not null check ("purpose" in ('invite', 'reset')),
  "created_by" text not null,
  "created_at" timestamptz not null default now(),
  "expires_at" timestamptz not null,
  "used_at" timestamptz
);--> statement-breakpoint
create index if not exists "password_links_user" on "password_links" ("user_id");
