# QS Platform

A quantity surveying platform for South African construction, built around one idea: **every figure
can be traced to the document it came from, and no figure is approved until a person signs it.**

A QS uploads a project's documents. An agent reads them and proposes the figures each step of the
work needs — with the passage each one came from. The QS corrects what is wrong, signs what is
right, and only then can the next step read those figures. Nothing is typed into a blank form and
nothing is assumed: what the documents do not say, the platform says they do not say.

Four documents describe this repository, and they answer different questions:

| | |
|---|---|
| **[PLATFORM.md](PLATFORM.md)** | The specification. What the product is, the domain rules, the money rules, the design system. Section numbers referenced throughout the code — `§1.3.1`, `§5.2` — point here |
| **[HANDOFF.md](HANDOFF.md)** | The current state. What is built, what is deliberately not, what broke and why, and what comes next. Read this before writing anything |
| **[CONTRIBUTING.md](CONTRIBUTING.md)** | How to work on it with other people — branch, gate, pull request. Start here if you have just been given access |
| This file | How to run it |

---

## Running it

Node 22, Docker, and a Vercel account for deploys.

```bash
npm install

docker run -d --name qs-platform-db -p 5434:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=qs_platform postgres:16-alpine

cp .env.example .env.local     # then fill it in — see below
npm run dev                    # http://localhost:3000
```

`.env.local` needs a `DATABASE_URL` pointing at that container, a `SESSION_SECRET` of 32+
characters, a `DEEPSEEK_API_KEY`, and a `DEV_USER_EMAIL` / `DEV_USER_PASSWORD` pair to sign in with.

**Local development uses local Postgres and the local disk**, never Neon and never the Blob store.
That is deliberate: `.env.local` must never point at production, and a browser suite must not fill a
client's document store with fixtures. `USE_BLOB_STORAGE=1` opts in when you specifically want to
exercise the store.

Migrations run as part of `npm run build`, so a deploy carries its own schema. They are written to be
**replayable** — a database whose schema is ahead of drizzle's ledger must be able to run them again
without failing. That is not a style preference; see HANDOFF.md for the deploy it broke.

### Or the way it actually runs

`npm run dev` is the fast loop. This is the container PLATFORM.md §13.1 chose — *"a plain Node
server in a container, not serverless"* — with Postgres beside it:

```bash
docker compose up -d --build     # http://localhost:3000
docker compose logs -f app
docker compose down              # add -v to drop the database and the documents
```

It reads your `.env.local` for secrets and publishes Postgres on **5434**, so the browser suites and
any local tooling reach the same database the container is using.

Two things are only true here and not under `next dev`, and both have bitten this project:

- **The standalone build.** `postbuild.mjs` copies static assets into it; without that the server
  returns 200 and 404s every stylesheet — a deploy that looks healthy and renders unstyled.
- **Migrations run at start, not at build.** A `docker build` has no database to reach, and baking a
  migration into an image would mean the image could not be built without write access to
  production. The entrypoint migrates whatever it is pointed at, once, and names the host.

**`/data` must be a mounted volume.** Documents are written there and a container filesystem does
not survive a redeploy — which is exactly how originals were lost before.

---

## Checking it

```bash
npm run check          # 20 browser suites — the gate, no model spend
npm test               # 270 unit tests — money, grounding, the chain, the run's, the bill's and pricing's rules
npm run typecheck
npm run lint
node scripts/check-modules.mjs
```

Everything green before a commit. The browser suites need `npm run dev` running.

Four more are run **deliberately**, because each costs money or touches something shared:

```bash
npm run check:run-live      # a real DeepSeek run over the fixture corpus
npm run check:production    # a real run against production — see HANDOFF.md for the bypass
npm run check:blob          # round-trips a document through the Blob store
npm run check:cad-live      # the drawing reader in a browser, one DeepSeek call (`-- --no-model`: none)
```

And one that answers a question no amount of reading can:

```bash
vercel build && npm run functions   # how many serverless functions this will actually create
```

**`vercel build` migrates, and it can reach production from your laptop.** It runs `npm run build`,
whose first step is the migration, and `.env.production.local` — the file `vercel env pull` writes —
holds the real `DATABASE_URL`. Next loads `.env.production.local` ahead of `.env.local` for a
production build, so the obvious command migrates the instance production serves. CI solves this by
stripping every database variable out of the pulled file before building; do the equivalent locally,
or accept that you are migrating Neon.

Hobby allows twelve and the app sits at exactly twelve. **The route table in `npm run build` is not
the count** — it marks statically prerendered pages `○` and those still get a function each. Two
different counting methods have been wrong here; that script counts the `.func` directories Vercel
actually uploads.

---

## Working on it with someone else

**If you have just been given access, read [CONTRIBUTING.md](CONTRIBUTING.md) instead of this
section.** It is the same flow written as steps you can paste. What follows is the reasoning behind
it, and the part that only concerns whoever deploys.

**One person deploys.** `npm run deploy` is a CLI command run from a working directory — there is no
git integration and no deploy hook, so pushing to GitHub deploys nothing, ever. That is the property
the rest of this rests on: anyone can push, and only the person who runs that command ships.

The flow:

```
branch → push → open a pull request → gate runs → whoever deploys merges, pulls, and deploys
```

**After every pull, run `npm run setup`.** It is `npm ci` followed by the migrations, and both halves
matter: dependencies move, and a migration that has not been applied to *your* database is not a
failure you will read as one — the page 500s and looks like a bug in the code you just pulled.

```bash
git pull && npm run setup && npm run dev
```

**Every push and every pull request runs the gate** (`.github/workflows/gate.yml`): typecheck, lint,
the unit tests, check-modules, the build — which is also the migration, so a migration that is not
replayable fails there rather than on somebody's database — and the twenty browser suites against
a throwaway Postgres. It needs no model key: no suite in `checks/` reads one, and the paid suite is
deliberately not run. GitHub Actions are not Vercel functions, so none of it touches the cap.

**Before you deploy**, and only you:

```bash
git pull                              # you deploy your working directory, not a branch
npm run check                         # 20 suites
vercel build && npm run functions     # 12 of 12 — see below
npm run deploy
```

That third line is not optional when the merge added routes. The app sits at **exactly twelve
functions**, and the thirteenth does not fail the build — it deploys, and production carries on
serving the previous version. CI cannot check it for you without a Vercel token in the repository's
secrets; without one that job says so in the run summary rather than passing quietly.

**Migrations, if you are not the one deploying:** additive only. Preview and production share one
Neon database, so anything that reaches it reaches the data production is serving; a new column is
invisible to old code, a dropped or renamed one is not. And rebase before you write one —
`drizzle/meta/_journal.json` is a hand-edited list, and two people appending the same index is a
conflict that can silently reorder migrations rather than fail.

**The lock file is written on Linux** — `npm run lock` — because this is developed on Windows and
built on Linux, and npm resolves optional platform packages for the machine it is standing on. Any
plain `npm install` on Windows silently reverts it, and CI is what notices: `npm ci` fails on the
runner with three packages missing. If you change a dependency, run `npm run lock` before pushing.

**Branch protection is not available on this plan** — GitHub requires Pro or Team for it on a private
repository, and the API refuses. So nothing on GitHub's side stops a push straight to `platform`.
The gate still runs on it and still reports; it just cannot be made a blocker.

What is in the way instead is a **local `pre-push` hook** (`.githooks/pre-push`), installed by
`npm run setup` through `core.hooksPath` so it travels with the repository rather than living on one
machine. It refuses a direct push to `platform` and prints the three commands that move the commits
onto a branch. It is a courtesy and not a wall — `git push --no-verify` goes past it, which is the
right escape hatch for the person who does occasionally mean it.

---

## Where things are

```
src/
  app/                     Next.js App Router. Routes are scarce — see the function cap above,
                           and prefer a branch in projects/[id]/[module] over a new folder
  components/              React. Server components by default
  lib/
    agent/                 What a run is: field sets, the model call, grounding, persistence
    chain.ts               Which step may start, what feeds what — the service chain (§1.3.1)
    entry-criteria.ts      What each step needs filed before it may begin (§1.3.3)
    ingest/                Parsing, chunking, retrieval, and what a document is
  domain/
    money.ts               Integer arithmetic, rounded once (§5). Nothing else may round
    amount.ts              Reading a figure out of a document's own words, or refusing to
  db/                      Drizzle schema and client
drizzle/                   Migrations. Hand-written, replayable, applied by the build
checks/                    Browser suites — the ones `npm run check` runs, plus the live ones
                           (`*-live`) that spend model credits and are run by hand
scripts/                   Deploy, migrate, housekeeping, the function counter — and the three
                           that drive a running platform: file-corpus, set-up-rfq,
                           measure-drawings. They sign in through scripts/lib/sign-in.mjs and
                           work against production as readily as localhost, which is the point:
                           `--base https://… --ask`
fixtures/                  Test documents. Read fixtures/README.md before publishing anything
```

---

## Things that will bite

**Sessions are rows, not just cookies** (migration 0037, ARC-003). Every request checks that the
session is live and the person is still active, so signing out, deactivating someone or resetting a
password ends their sessions everywhere. Sign-ins are throttled: five failures per address or thirty
per IP in fifteen minutes. A session also ends after ninety days whatever its use. Cookies issued
before this have no session row and are refused, so **everyone signs in once more after the deploy
that carries it.**

**The operator login is off in production** unless the deployment sets `OPERATOR_LOGIN=1`. Before
deploying, make sure at least one administrator has a row under Settings › People, or set the flag
for the first sign-in and remove it afterwards.

**Nothing leaves except through `src/lib/egress`** (ARC-005). Every model call names a purpose
(`extract.field`, `quote.evaluate`, `web.search`, …). The gateway removes or tokenises what identifies
people and companies, fences document text as data, and writes a row to `egress_events`, an
append-only ledger of counts and a hash, never the text. The reply's tokens are swapped back before
grounding runs. `node scripts/check-egress.mjs` (in the gate) fails on any `fetch` to an outside
host, or vendor SDK import, anywhere else. **In production nothing is sent to a vendor until its
`EGRESS_BASIS_*` variable records the practice's legal basis**: set those before deploying, or AI
features and email refuse with a reason.

**Confidentiality.** `fixtures/` contains real client documents from a live scheme. The repository is
private and must stay that way until they are anonymised — `fixtures/README.md` says which are which.

**Deploy with `npm run deploy`.** It parks `.git` for the duration, because Vercel refuses a deploy
when it can read a commit whose author is not on the team. The restore runs from a `finally` and from
the signal handlers.

**Preview and production share one Neon database**, so a preview deploy migrates the database
production is using. Additive migrations are safe in that order; anything that drops or renames is
not, and needs a different plan.

**`vercel env pull` writes `[SENSITIVE]`** for variables marked sensitive, and a value that is
subtly not a value produces no error — only an absence. It has cost an hour twice: as a database URL
it threw from the migrator, and as an email it failed the browser's own form validation so silently
that the suite died on a navigation timeout with nothing to explain it.

**GitHub**: three accounts are authenticated locally and only one can see this repository.
`gh auth switch --user KeenanHusselmannX4O` before pushing.

**`npm install` on Windows drops what the Linux build needs** from `package-lock.json`, and the
pre-commit hook refuses the commit. `npm run lock` regenerates it in a container — but that install
runs against the mounted repository and replaces `node_modules` with Linux binaries, which stops the
dev server. Copy `package.json` and `package-lock.json` to a scratch directory, run the same
container there, and copy only the lockfile back.

**Tesseract (OCR of images in a quotation) does not survive bundling.** It resolves its worker
script and WASM core by path at runtime, so `tesseract.js` and `tesseract.js-core` stay in
`serverExternalPackages` and are traced in by hand through `outputFileTracingIncludes`. Its language
data is fetched on first use and cached in the temp directory, so the first evaluation on a cold
production function pays for that download.
