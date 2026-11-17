-- People who can sign in — PLATFORM.md §1.3.1, §13.1.
--
-- ── Why this had to exist before anybody else could test ──────────────────────────────────────
--
-- Sign-in compared against two environment variables and nothing else. `session.ts` said so
-- plainly and called itself scaffolding, which was honest while one person used it. The moment a
-- second person needs an account it stops being a shortcut and becomes a defect, because this
-- platform's central claim is that a figure traces to a **named** signer (§1.3.1): every bill,
-- every certificate, every run carries `signed_by`. With one shared credential every one of them
-- carries the same name, and "who approved this" has no answer.
--
-- ── Passwords ────────────────────────────────────────────────────────────────────────────────
--
-- scrypt, per-row random salt, stored as `N$r$p$salt$hash` so the parameters travel with the hash
-- and can be raised later without invalidating what is already stored. Node's crypto does it; §13.2
-- sets the bar for adding a dependency and a password hash does not clear it.
--
-- ── The environment credential stays ─────────────────────────────────────────────────────────
--
-- Deliberately, and it is not a back door left by accident: production runs on Vercel, where there
-- is no shell. If the only administrator's row were deactivated or their password lost, there would
-- be no way back in short of a database console. So `DEV_USER_EMAIL` remains able to sign in, it is
-- always an administrator, and the People list **shows it** rather than leaving it as an account
-- nobody can see. A break-glass credential nobody knows about is the dangerous kind.

create table "users" (
  "id" uuid primary key default gen_random_uuid(),

  -- Lower-cased on the way in, and unique on that basis: "R@x4o.co.za" and "r@x4o.co.za" are one
  -- person, and letting both exist would put two signers on one job with the same name.
  "email" text not null,
  "name" text not null,

  -- `N$r$p$salt$hash`. Never the password, and never a reversible transformation of it.
  "password_hash" text not null,

  -- Can add and deactivate people. False for everyone created through the UI; the environment
  -- credential is an administrator without a row, so a fresh database is never locked.
  "is_admin" boolean not null default false,

  -- Soft, like every other withdrawal here. A deactivated person keeps their name on everything
  -- they signed — deleting the row would leave signatures pointing at nobody.
  "deactivated_at" timestamptz,
  "deactivated_by" text,

  "created_by" text,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);--> statement-breakpoint

create unique index "users_email_key" on "users" (lower("email"));--> statement-breakpoint
