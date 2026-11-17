-- Two-step sign-in: an authenticator code after the password (audit C7, "MFA before client data").
--
-- The key is stored sealed (AES-256-GCM under a key derived from SESSION_SECRET – lib/secret-box),
-- so a copy of this table cannot mint codes. `totp_enabled_at` is set only once the person has
-- proved the app works by entering a code; until then a pending key does nothing. The last step
-- accepted is kept so a code cannot be used twice.
--
-- Additive and replayable.
alter table "users" add column if not exists "totp_secret" text;--> statement-breakpoint
alter table "users" add column if not exists "totp_enabled_at" timestamptz;--> statement-breakpoint
alter table "users" add column if not exists "totp_last_step" bigint;
