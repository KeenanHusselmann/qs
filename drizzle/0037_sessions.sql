-- Sessions the server can end, and a record of failed sign-ins (ARC-003, "login hardening").
--
-- Until this migration a session was a signed cookie and nothing else. The server never looked at
-- the database to accept one, so a deactivated person's cookie kept working, a changed password did
-- not sign anybody out, "sign out" only deleted the cookie in the one browser that pressed it, and
-- the daily rolling refresh meant a cookie in regular use never expired at all. A stolen cookie could
-- not be forced out by anyone.
--
-- Now every sign-in writes a row here, the cookie carries its id, and each request checks the row is
-- still live. Revoking is setting `revoked_at`. Rows are kept, not deleted, so "who was signed in
-- from where, and when was it ended" can still be answered.
create table if not exists "sessions" (
  "id" uuid primary key default gen_random_uuid(),
  -- Lower-cased, the same identity the cookie and `runs.signed_by` carry.
  "email" text not null,
  "created_at" timestamptz not null default now(),
  -- Touched at most hourly, so a list of sessions can say which are in use.
  "last_seen_at" timestamptz not null default now(),
  "revoked_at" timestamptz,
  -- Who ended it, and why: 'signed out', 'password changed', 'deactivated', 'ended by <email>'.
  "revoked_reason" text,
  "user_agent" text,
  "ip" text
);--> statement-breakpoint
create index if not exists "sessions_email_live" on "sessions" (lower("email")) where "revoked_at" is null;--> statement-breakpoint

-- Failed sign-ins, for throttling. One row per failure, pruned after a day. Only failures are kept:
-- a success clears the address's failures, and the password itself is never stored in any form.
create table if not exists "login_failures" (
  "id" bigserial primary key,
  "email" text not null,
  "ip" text,
  "at" timestamptz not null default now()
);--> statement-breakpoint
create index if not exists "login_failures_email_at" on "login_failures" ("email", "at");--> statement-breakpoint
create index if not exists "login_failures_ip_at" on "login_failures" ("ip", "at");
