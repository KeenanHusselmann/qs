# Working on this repository

Two rules, and everything else is detail.

1. **Never commit to `platform`.** Every change goes on a branch of its own and reaches `platform`
   through a pull request.
2. **Never deploy.** One person deploys, from their own working directory. Pushing to GitHub ships
   nothing, ever — that is deliberate, and it is what makes rule 1 safe rather than merely tidy.

If you only read this far: `git switch -c my-change` before you type any code, and you will not get
either of them wrong.

---

## Once, when you start

```bash
gh auth login                       # sign in as yourself
gh repo clone X4OConsulting/qs-management-platform
cd qs-management-platform

docker run -d --name qs-platform-db -p 5434:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=qs_platform postgres:16-alpine

cp .env.example .env.local          # then fill it in — the file explains each value
npm run setup                       # dependencies, migrations, and the push guard
npm run dev                         # http://localhost:3000
```

You need Node 22 and Docker. `.env.local` needs four things and `.env.example` says what each one
is: a `SESSION_SECRET`, a `DEV_USER_EMAIL` / `DEV_USER_PASSWORD` pair to sign in with, and a
`DATABASE_URL` pointing at that container. **Nobody sends anybody their `.env` file** — every value
is one you generate for yourself in about a minute.

A model key is optional. The whole gate runs without one.

---

## Every time you change something

```bash
git switch platform && git pull     # start from what everyone else has
npm run setup                       # dependencies move, and migrations must be applied
git switch -c short-name            # ← the step that matters
```

Then write the change, and before you push:

```bash
npm run check                       # browser suites — needs `npm run dev` running
npm test
npm run typecheck
npm run lint
node scripts/check-modules.mjs
node scripts/clean-test-projects.mjs   # the suites leave projects behind
```

All green, then:

```bash
git push -u origin short-name
gh pr create --base platform
```

CI runs the whole gate again on the pull request. When it is green, say so — whoever is deploying
merges it.

**Name the branch after the change, not after yourself.** `bill-paste`, `fix-retention-cap`,
`valuations-agent`. It is the only label the pull request list has.

---

## If you forgot and committed on `platform`

Nothing is lost and nothing is broken. Your commits are still yours:

```bash
git switch -c short-name                        # takes your commits with it
git push -u origin short-name
git switch platform
git reset --hard origin/platform                # put platform back where everyone else has it
```

`git push` will refuse a direct push to `platform` and print these steps, so you will find out
before anything reaches anybody else. That guard is a local hook installed by `npm run setup` — it
is a courtesy, not a wall, and `--no-verify` goes past it. GitHub cannot enforce this for us:
branch protection needs a paid plan on a private repository, and the API refuses to set it.

---

## Things that will bite

**After every pull, run `npm run setup`.** It is `npm ci` plus the migrations, and both halves
matter. A migration that has not been applied to *your* database is not a failure you will read as
one: the page 500s and looks exactly like a bug in the code you just pulled.

**Local Postgres is a Docker container and it stops.** `docker start qs-platform-db`. When it is
down every page 500s, which also reads like an application bug.

**If you write a migration, rebase first.** `drizzle/meta/_journal.json` is a hand-edited list and
two people appending the same index is a conflict that can silently reorder migrations rather than
fail. Keep migrations **additive** — preview and production share one database, so a new column is
invisible to old code and a dropped or renamed one is not.

**If you change a dependency, run `npm run lock`.** The lock file has to be generated on Linux. A
plain `npm install` on Windows silently reverts it and CI is what notices, with `npm ci` failing on
the runner.

**Routes are scarce.** The app sits at exactly twelve serverless functions and Vercel's plan allows
twelve — the thirteenth does not fail the build, it deploys and production carries on serving the
previous version. Prefer a branch inside `src/app/(app)/projects/[id]/[module]/page.tsx` over a new
folder. If you think you need a new route, say so in the pull request.

**`fixtures/` contains real client documents** from a live scheme. The repository is private and
must stay that way. Do not copy anything out of it into an issue, a screenshot or a chat window.

---

## Where to read next

| | |
|---|---|
| [PLATFORM.md](PLATFORM.md) | The specification. Section numbers in the code — `§1.3.1`, `§5.2` — point here |
| [HANDOFF.md](HANDOFF.md) | What is built, what is deliberately not, what broke and why. Read before writing |
| [README.md](README.md) | How to run it |

Two things in PLATFORM.md are worth reading before the first pull request, because almost every
review comment traces to one of them: **§5** (money, and why every figure is either read with
certainty or refused in words) and **§1.3.1** (a run proposes, a person corrects, a signature
freezes — and nothing downstream reads an unsigned figure).
