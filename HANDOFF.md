# Handoff

State of the QS platform as at **2026-10-01**. `PLATFORM.md` is the specification; this is what has
actually been built against it, what is deliberately not built, and what comes next.

**`platform` is the only branch, and production runs it.** Everything below that says otherwise is
older than this paragraph — in particular, the sections naming **`home-ux`** as the live branch.
That branch was merged and deleted on 2026-10-01, along with eight others; the repository now
carries `platform`, `archive/first-attempt`, and `security/next-16-3-5`.

### What changed on 2026-11-11 – the drawing reader, inside the app

The reader below now has a place in the app: **Take-off → "Read a drawing"**, on any project with
a PDF or DXF filed as a drawing. Same `domain/cad`, through two server actions in
`projects/[id]/drawing-actions.ts` – **no route, no schema, no function added**; the route table
is unchanged. It writes nothing, so it is offered on a signed bill too. Interpret reads the file
again on the server rather than trusting a report sent back from the browser.

- **The picture had to shrink.** A 120 000-segment test sheet (§10.1's size for a plotted A1)
  came back as 16,5 MB, against Vercel's 4,5 MB response cap. `renderSvg` gained an opt-in
  `pickable` mode: only shapes a row can pick keep an element and a `data-h` tag, the rest merge
  into one path at a tenth of a pixel – 2,4–3,2 MB. Over 4 MB the figures are sent without the
  picture, and the page says so. The local viewer and MCP output are unchanged.
- **Highlighting is in the browser**, by those tags, so a click does not re-read an A0 sheet.
- **Checked in the running app by hand on 2026-11-12** – a PDF drawing filed on a project, read
  from Take-off, rows picked. There is no browser suite for it yet; `checks/takeoff.mjs` is where
  one would go.
- DXFs still cannot be filed (`UNREADABLE_EXTENSIONS`), so in the app it is PDFs in practice.

### What changed on 2026-11-09 – a drawing reader (spike, PR #23)

A reader for concept drawings, towards §10, on **no route, schema, nav item or dependency**:
`src/domain/cad`, `src/lib/cad`, three scripts and one deliberate check.

- **What it does.** An ASCII DXF, or a PDF plotted from CAD, becomes one set of entities. It
  measures closed outlines (arcs exactly), joins loose lines into loops, traces the regions of a
  boundary network (erven on a site plan), counts blocks, and checks every printed area – m² or
  hectares – against the outline it sits in, at §10.4's 0,5%. Units and scale are read from the
  drawing or the areas are withheld; nothing is assumed.
- **The model labels, the domain decides.** DeepSeek sees a digest of what was measured and returns
  roles only – site, footprint, unit type. Unknown ids are refused, figures are stripped from its
  words, and the concept schedule (site, footprint, coverage, unit mix) is computed here.
- **Three ways in.** `npx tsx scripts/cad-viewer.mts` – a local page, 127.0.0.1 only;
  `npx tsx scripts/cad-mcp.mts --root <folder>` – a read-only MCP server for Claude Code or Codex;
  `npx tsx scripts/read-pdf-drawing.mts <file.pdf> --regions "<pen>"` – the terminal.
- **Checked deliberately, not in the gate:** `npm run check:cad-live` – 24 assertions against
  `fixtures/cad/concept-layout.dxf`, whose every figure is worked by hand in
  `scripts/make-cad-fixture.mts`. It makes one DeepSeek call unless run as
  `npm run check:cad-live -- --no-model`; `-- --record demo.mp4` needs ffmpeg on the path.
- **On a real A0 site development plan from the corpus**, the scale (1:1250) was read from the
  sheet and the erven traced from the boundary pen. The outlines measure 3–10% under the printed
  hectares. Neighbouring outlines run 4,1 m apart, and growing each by half that brings all six
  single-erf checks to −1,3%…+3,3%: the architect drew each erf about 2 m inside its boundary. Not
  passed – correctly – and the finding for a QS is to ask for the cadastral layer.
- **Worth knowing before building on it.** Which pen is the erf boundary is a labelling decision,
  asked for and never guessed. A label placed outside its outline on a leader is not matched. DWG is
  still not read. **Client drawings stay out of the repository**: the PDF test ran locally and is
  not committed, and the tests use invented erf numbers.

### What changed on 2026-09-29 to 2026-10-01

- **The Marshall Dam project is real and on production** — 20 client documents, an evaluated RFQ
  and a measured bill. It is the first project here that is not a fixture.
- **Three new modules:** Rubric (firm-level, the standard every output is held to), Benchmarks
  (the practice's figures against the published AECOM bands, escalated on BER), Value Engineering
  (options for bringing a cost back to a budget, with `projects.budget` behind it).
- **The bill has a workbook as well as a PDF** — the practice's rule is a spreadsheet where
  numbers are calculated, a PDF where the thing is a report.
- **An outage worth remembering.** Every quotation evaluation on production failed silently for
  months: `tesseract.js`'s worker requires its dependencies from a file the bundler never parses,
  so tracing missed them, and OCR killed the function outright rather than returning an error.
  Locally it was invisible, because `node_modules` has everything. Two UI blind spots hid it — a
  progress line that never painted and a rejected action nobody caught. All three are fixed; the
  lesson is that **this platform cannot be verified on a laptop alone.**

### Running something against production

`scripts/lib/sign-in.mjs` is the one sign-in every script uses. `QS_EMAIL` and `QS_PASSWORD` beat
the terminal prompt; a refusal comes back in about two seconds in the site's own words, and the
password's SHA-256 fingerprint is printed so a mangled one can be told from a wrong one.

| | |
|---|---|
| `scripts/file-corpus.mjs` | File a manifest of documents into a project. Drives the real import, so the blob handover for anything over 4.5 MB is exercised |
| `scripts/set-up-rfq.mjs` | Build an RFQ from documents already in the corpus. `--evaluate` spends credits |
| `scripts/measure-drawings.mjs` | Measure the filed drawings into the bill. `--sheets` names a subset, because a whole corpus exceeds one reply |

All three take `--manifest`, `--base`, `--ask` and `--show`.

> **The file is written in layers, and the newest is not at the bottom.** They run newest first:
> **"2026-09-03"**, then **"2026-09-02"**, then **"2026-09-01/02"**, then everything else —
> including sections that post-date the ones before them. Where two sections disagree the newer is right; where an older one says something is "not
> built" and the newest says it is, it is.

Starting a new session: read this file and `PLATFORM.md`, then the prompt at the bottom.
Starting *on the repository* rather than on the work: `CONTRIBUTING.md` — branch, gate, pull
request, and what to do about commits already made on `platform`.

---

## Where it runs

| | |
|---|---|
| Production | `https://qs-management-platform-raymond-3084s-projects.vercel.app` — the only domain; it auto-follows every `--prod` deploy. Moved off `x4o-projects` on 2 Sep 2026: that scope was Hobby, capped at twelve functions against the twenty-three this app builds, and had an overdue balance. |
| Repo | `X4OConsulting/qs-management-platform`, **private**, default branch `platform` |
| Database | Neon `qs-platform-db`, provisioned through the Vercel integration, region `eu-west-2` (London) |
| Functions | Pinned to `lhr1` in `vercel.json` — beside the database. Measured 2–8ms warm; split across continents it is 100ms+ per query |
| Local dev | Its own Postgres on `localhost:5434`, and the **disk** for documents. **Not** Neon, not the Blob store — `.env.local` never points at production, and a browser suite must not fill a client's storage with fixtures. `USE_BLOB_STORAGE=1` opts in |
| Documents | Vercel Blob store `qs-platform-documents`, **private**. An `access: "public"` blob is an unauthenticated URL that works forever for anyone holding it, and these are a client's geotechnical reports |
| Working copy | `D:\Projects\qs-platform` since 2026-08-13. `C:` reached zero free bytes and Turbopack began failing compiles with `ENOSPC` — which surfaces as a 500 on one page, not as a disk error. Postgres and the puppeteer browser stayed on `C:` and are unaffected |

### Deploying

**The build migrates the database.** `"build": "drizzle-kit migrate && next build && …"`, so a
deploy brings the schema with it and there is no separate step to forget.

It was a separate step, and the trap was real: nothing ran migrations on deploy, so shipping code
that read a column Neon did not have would have 500'd every project page. Drizzle names its columns
explicitly, so there is no version of that failure that degrades gracefully. Migrations run first
in the chain — a failed migration stops the build rather than shipping code its schema cannot
serve — and against Neon's **unpooled** URL, which is what their pooler is not built for.

Note that preview and production share one Neon database, so a *preview* deploy migrates the
database production is using. That is the safe ordering rather than an accident: an additive
migration lands, the old code carries on unaffected because nothing selects the new columns yet,
and the code that needs them is promoted afterwards. A migration that drops or renames anything
does not have that property and needs a different plan.

**Migrations are written to be replayable, and this is not optional.** The first build to run them
against Neon failed on 0004 with `relation "chunks" does not exist`. Neon's *schema* had been
brought forward by hand while drizzle's ledger recorded only through 0003 — and drizzle replays by
**timestamp, not by hash**, so it tried to rename a table renamed months earlier. The database was
fine; the bookkeeping was behind, which is the normal condition of any database a person has ever
opened with psql. Guarded renames, `create … if not exists`, `add column if not exists`: on a fresh
database they do the work, on one already past them they do nothing and get recorded, which
reconciles the ledger without anyone hand-editing it. Reproduce the condition by migrating a
scratch database, deleting ledger rows past 0003, and migrating again.

The migration step is `scripts/migrate.mjs`, not `drizzle-kit migrate`. drizzle-kit failed with
`[⣷] applying migrations…` and `exited with 1` and no other word — no statement, no SQLSTATE. A
deploy step that can only say "it did not work" is one you debug by guessing at somebody's
production database. The script prints the host, the failing statement and the whole cause chain,
because drizzle wraps the driver's error and the driver's is the one carrying the SQLSTATE.

**Twelve serverless functions.** Hobby's cap. This app reached sixteen and deploys stopped dead —
the code pushed, and production carried on serving a build two commits old, with the failure visible
only in the deploy output. It sits at eleven: three module pages that differed by one string became
`/projects/[id]/[module]`, and filing, opening and authorising an upload became one dispatcher over
three modules in `src/lib/documents`. **The next route added has to justify itself**, and the
remaining QS modules must go through `[module]` rather than each taking a folder.

**Count it with `npm run functions`, and by nothing else.** Two methods have now been wrong.
Counting `page.tsx` and `route.ts` files was wrong in both directions. Counting the `ƒ` entries in
the `npm run build` route table replaced it and was **also** wrong: it read eleven, "one slot free",
while Vercel refused the deploy at **sixteen**. The route table marks a statically prerendered page
`○`, and those still get a function each — `/`, `/login`, `_not-found`, `_global-error`, and
`favicon.ico` when it lives in `app/`. Five the table does not show.

`scripts/count-functions.mjs` counts the `.func` directories in `.vercel/output`, which is the thing
itself rather than a proxy for it. It needs `vercel build` to have run first, and that build runs
`npm run build`, which migrates — **point `DATABASE_URL` at a local database before counting**, never
production.

**It sits at exactly twelve.** Getting there cost four routes: `/` became a redirect in the
middleware (a redirect does not need a function), `favicon.ico` moved to `public/`, and `/corpus` and
`/settings` became branches in `/projects/[id]/[module]` beside `/data`. The nine remaining agents
cost nothing — they go through `[module]`. **The next route added breaks the deploy**, and
`npm run functions` says so rather than leaving it to be discovered after a build.

**Production is behind Vercel Deployment Protection.** Plain `curl` gets a 302 to Vercel SSO, which
is why `deploy.mjs` probes with `vercel curl`. It also means a browser cannot be driven against
production from a script without a bypass token — the browser suites run against local dev.

`npm run deploy`. It parks `.git` for the duration, because Vercel blocks the deploy when it can
read a commit whose author is not on the team and the Hobby plan has no collaborators. Restore runs
from a `finally` and from the signal handlers. The permanent fix is adding the committing email to
the Vercel account, after which `scripts/deploy.mjs` is a plain wrapper and can be deleted.

The deploy refuses to report success unless `/api/health` returns ok. That endpoint sits in front of
the session gate on purpose: every page redirects to `/login` before touching the database, so an
authenticated probe could never distinguish "database down" from "not signed in".

### Access

Three GitHub accounts are authenticated locally and **only `KeenanHusselmannX4O` can see the repo**.
`gh` defaults to the wrong one — `gh auth switch --user KeenanHusselmannX4O` before pushing.

On the repository itself there are three collaborators, and the roles are worth knowing before
diagnosing anybody's 403: `KeenanHusselmannX4O` and `RaymondCrown` are both **admin with write**,
and `rtc1999-Mzi` is **read**. So a write refused here is an authentication problem — the wrong
account, or a token that has not been SSO-authorised for the `X4OConsulting` org — and never a
permissions one. **Nobody sends anybody a token**: `gh auth login` mints one bound to the person
using it, which is also what keeps a commit attributable to whoever wrote it.

---

## What is built

**Twenty-four browser suites**, `npm run check`, all green. Plus `npm test` (**741 unit tests**:
money, reading a figure or refusing to, quote grounding, import judgement, readability, workbooks,
the run's, the bill's and pricing's derivation rules, the chain, the design tokens — and the whole
ported feasibility engine, which is the bulk of the growth) and `node scripts/check-modules.mjs`.

> **The engine is ported and the report is complete — 12 of 12 sections.** That is the largest
> change since this document was last written, and everything from "The feasibility engine" onwards
> post-dates the rest of the file. Read that section before planning engine work: several things
> listed further down as "not built" now are.

Run deliberately, outside `check`, because each costs money or touches a shared resource:
`check:run-live` (a real DeepSeek run — **all eleven agents, green**, $0.0022 for the lot),
`check:blob` (round-trips a document through the store and asserts an anonymous fetch is refused),
`check:direct` (files a 5.2 MB document the way a browser does — needs `USE_BLOB_STORAGE=1 npm run dev`).

- **Auth** — HMAC-signed cookie, 30-day expiry, rolling refresh in middleware (Node runtime, since
  the signature uses `node:crypto`).
- **Projects** — create, edit, archive, soft-delete. Archive and delete are kept distinct: one is
  finished work a practice keeps, the other is "this should not have existed".
- **Importing** — drop a folder, kinds inferred from folder names, one review pass, per-file
  outcomes. 16 of 18 real corpus paths classify automatically. Documents of any size up to 64 MB:
  anything over the platform's ~4.5 MB body limit goes from the browser straight to storage.
- **Modules — thirteen** — Project Inputs, Site & Zoning, Feasibility Estimate, Cost Plan, **Bill of
  Quantities**, Tender Analysis, Contract, Valuations, Variations, Instructions, Cost Report, Final
  Account, Handover. Each shows only its own requirements, with uploads on the row. **Eleven run an
  agent**; the two Set-up ones carry criteria only. All eleven have been run live against DeepSeek on
  a real document — ten returning a field set, and the bill returning rows.
- **Workbooks** — `.xlsx` and `.xlsm` are read. No library: `node:zlib` unzips it and four XML
  parts are parsed, so the priced cost estimate is now a document a run can quote. See below.
- **Checklist** — auto-ticks when a document grounds a criterion; manual ticks recorded with who and
  when (`criterion_checks`).
- **Documents** — filed under their own name, with the import path kept as provenance and shown as
  the folder they sat in. The name is a link that streams the original read-only, `inline`, in a new
  tab. The citation quote sits behind a one-line disclosure so the document leads the row.
- **Agent run** — field-set extraction on Feasibility Estimate, **against DeepSeek**, streaming. Ten
  fields, retrieval per field scoped to the project in SQL, every value carrying the passage it came
  from. A value whose quote is not in the corpus is discarded and says so.
- **Sign-off and the service chain** — a run is a row (`runs`, `run_fields`). `proposed` is written
  as each field settles and never edited; a QS's correction lands in `overrides`; `working` is
  derived, human wins; `output` is frozen once, at sign-off, under a named signer. See below.
- **Startability, owned by the server** — `chain.ts` answers what feeds what, what a step *is*
  (`signed_off · draft · ready · waiting · not_built`) and what is holding it up. The run route
  enforces it; the project overview renders it. See below.
- **The Cost Plan** — the second run-producing module, and the one that makes the chain carry
  something. It cannot start until the feasibility estimate is signed, and it **carries** the
  scheme's shape from that signed output rather than reading it again. See below.
- **Import agent** — judges the filed corpus: *carries data* / *reference only* / *duplicate* /
  *superseded*, each with the measurement it rests on. Proposes; never removes.
- **Project Corpus** — was "Data import", under Set up in the sidebar, at `/import`. A sidebar is a
  list of places and that was a verb; it also sat among the steps as though filing documents were
  one step of several, when every step reads from it. It is now **Project Corpus**, beside Overview,
  at `/corpus`, and the verb is an **Import data** button on the project's front page — which is the
  screen someone looking at an empty project is already on.
- **Corpus review** — the whole corpus on one screen, grouped by verdict. The interpretation is
  stated once per group; each row carries the single figure that put it there. Every filename opens
  the original, so a QS can look before deciding.
- **Import window** — a modal that cannot be dismissed while documents are still being written.
  Failures are named with the server's own reason rather than absorbed into a total, and a **Retry**
  files only the ones that did not land. Documents nothing could be read from are grouped by why —
  a drawing that will be measured, a scan that needs OCR, an image carrying no text, a workbook that
  would not open — because the reason is what decides whether anybody needs to do anything.
- **Clearing the corpus** — `Delete all N` behind a typed confirmation. A hard delete: rows,
  passages, and the stored bytes. Withdrawing a single document stays soft, so anything already
  citing it still resolves.
- **Money** — `src/domain/money.ts`, recovered from the abandoned branch. See below.
- **Pricing** — §4.8, at `/pricing`: the bill's rows revisited with the rate column in play, a rate
  build-up behind a row, and one act across a selection. See below.

### The chain that makes it work

```
document filed as a kind
  -> kind satisfies a criterion        (entry-criteria.ts)
    -> criterion belongs to a module   (Criterion.module)
      -> module page shows it
```

`checks/corpus.mjs` proves this end to end: a title deed imported under `ANNEXURE B` appears on Site &
Zoning without being re-filed, and Project Inputs does not show it. One corpus, scoped reads.

---

## Sign-off — the four maps, and where each one lives

§1.3.1's spine, built. `runs` and `run_fields` (migration `0008_runs.sql`).

| Map | Where it is | Who writes it |
|---|---|---|
| `proposed` | `run_fields.proposed_*` + `source_*` | The route, one row per field **as it settles** |
| `overrides` | `run_fields.override_*` | `correctField`, with the session's name |
| `working` | nowhere — `workingValue()` | Derived. `override ?? proposed`, human wins |
| `output` | `run_fields.output_value` | `signOffRun`, once, then frozen |

**Whether a run is signed is `runs.signed_at`, never the nullness of `output_value`.** A signed run
may legitimately carry a null output for an optional field nobody could establish, and a downstream
query that keyed on the column would silently treat that run as a draft.

**There is no `signed` status, and that is deliberate.** A status column beside a signature timestamp
is two places for one fact. `runState()` decides what a run is — `running · stalled · review ·
failed · signed` — so a header and the row beneath it cannot disagree.

**The freeze is a trigger, not a habit.** `run_fields_frozen()` refuses any update that changes a
proposal or its provenance, at any time, and refuses everything once the parent run is signed;
`runs_frozen()` refuses to move, reassign or withdraw a signature. The application refuses the same
things in sentences, because a person deserves a sentence rather than a stack trace — but the
sentence is the courtesy and the trigger is the guarantee. Sign-off therefore writes every
`output_value` **first** and stamps `signed_at` **last**, in one transaction, or it would lock the
outputs out of their own sign-off.

**One update is not an edit.** `source_document_id references documents on delete set null` arrives
at that trigger looking exactly like somebody rewriting a citation, and refusing it makes a project
undeletable — the cascade that removes its documents reaches these rows on the way out. It is
exempted, narrowly: the whole row is compared, so only the id may go, and the document's **name**
and the **quote** stay. A citation whose original cannot be opened still says what was read and
where. This was found by `clean-test-projects.mjs` failing at the top of a check run, not by
inspection.

**The dead Accept button is gone rather than wired up.** §1.3.1 has four maps and none of them is an
approval per field: *a signature freezes*, once, over the whole run. A per-row Accept would be a
fifth piece of state nothing downstream reads, and ten clicks before the one click that means
something. The row's control is **Correct**; the run's control is **Sign off as \<name\>**.

**A signature is refused while a required field has no working value**, and the refusal names the
fields. Computed against the *field set*, not the rows that exist — a run that stopped on the fourth
field has no row for the fifth, and walking the rows would happily freeze an output missing half its
required figures. Optional fields never block (§1.3.3: label it, do not stop).

**Clearing the corpus is refused on a project with a signed run.** Predicted in the note this
replaces, and now real: §1.3.2's promise is that a citation can be checked by opening the document,
and a signed figure whose document was deleted is exactly the number §1.3.1 calls worse than a gap.
Withdraw stays available per document, and stays soft.

**A signature the screen is not showing is still stated.** Sign a run, run the step again, and the
panel shows the new draft — while the *signed* run is what a downstream step reads. The panel says
so rather than reporting "nothing is signed off yet" over a project that has a signed output.

## The chain — who may start, and why not

`src/lib/chain.ts`, pure; the facts come from `stepRuns()` in one query per page.

**The server owns `startable`, and it did not before.** The run button had been disabled for missing
inputs since it was built, and the route behind it checked only whether the corpus was empty — so a
POST from a console ran the step past every requirement, and the result was indistinguishable
afterwards from a run somebody was entitled to make. §1.3.1 warns about exactly this and it was true
here. Now `checks/run.mjs` files one document, POSTs, and asserts the 409.

**Two blockers, worded apart, because only one is clearable by uploading** (§1.3.3). Missing inputs
name the documents; an unsigned upstream says plainly that nothing filed here will help. Getting this
backwards is how v3 printed "needs a cost plan" beneath "Filed and indexed: the cost plan".

**An upstream with nothing to sign is not a gate.** Project Inputs and Site & Zoning feed the
Feasibility Estimate and produce no run — they carry entry criteria and no field set — so waiting on
them would be waiting for a document to approve itself. §1.3.1 gates on "which upstream **runs** are
signed", so `upstreamPending` consults only run-producing steps. It is therefore empty today, and the
mechanism is not: adding the cost plan's `FieldSpec[]` to `FIELD_SETS` is what makes it a step that
cannot start until feasibility is signed. **Nothing else changes** — which is the test that the shape
is right.

**A module is run-producing because it has a field set**, not because a boolean says so. `FIELD_SETS`
is the one place, and `producesRuns`, the panel's presence, and the gate all read it.

**The chain is between process areas, not modules, and they do not line up.** D1.2 (*BoQ Production*)
is four nav items — Take-off, Repetition Designer, Bill of Quantities, Pricing — so "which module is
D1.2" has no answer, and picking the first would put a name on screen that nothing chose. A link
carries the area and the module only where one genuinely exists: *Feeds Site & Zoning* against *Feeds
BoQ Production (not built)*. Hiding the unbuilt ones would say the model of the work stops here.

### The deadlock this enforcement exposed

**A mandatory criterion whose primary kind is spatial could never be satisfied, so the feasibility
step could never be started through the interface.** "Concept layouts" accepts Concept drawings first,
the row files under the first accepted kind, spatial passages never ground anything — so it sat at
`uncertain` for ever, and mandatory-and-unresolved blocks. The disabled button was the only symptom.
The live suite never noticed because it POSTed straight at the route.

The mistake was reading §1.3.2 too widely. That rule governs **quoting** — a value asserted on a
passage lifted out of a title block is not grounded, and a real site plan here yields 175 words of
title block including "PROJECT LOCATION". It says nothing about a criterion that *names a drawing as
the evidence it wants*. There the document is the answer, and "no passage matched" carries no
information: a drawing has no passage to match, which the old message admitted while still blocking
on it.

So a spatial document filed under a kind the criterion accepts now satisfies it, and the row says it
will be measured rather than quoted. **What did not change** is the thing §1.3.2 protects: a
*retrieved* passage from a drawing is still discarded before anything looks at it.

## Carrying a figure — the cost plan

The second run-producing step, and the first consumer of a frozen `output`.

**Adding it changed `FIELD_SETS` and nothing else in `chain.ts`.** That was the test of whether the
shape from the previous slice was right: a module is run-producing because it has a `FieldSpec[]`,
so declaring one made the cost plan a step that waits for a signature, a step the overview shows as
Waiting, and a step whose route refuses a direct POST — with no new branch anywhere.

**Three of its thirteen fields are carried, not read.** The unit count, the average unit area and the
erf extent were established, reviewed and signed on the feasibility estimate. Asking the model for
them again would produce a second answer to a settled question from a different sentence in the same
corpus — two numbers for one fact with only one of them approved, and nothing afterwards to say which
a cost per unit was divided by. A carried field has no retrieval terms and costs no model call.

**`working` is what gets carried, so the human wins downstream too.** Proven live: the agent read
`1 046`, the QS corrected it to `1 040`, signed, and the cost plan carried **1 040**.

**Both provenances survive the journey** (§1.3.1). `carried_via` records the step it came through and
`carried_from_run_id` the exact run; `source_document` and `source_excerpt` still hold `brief.txt`
and the passage it was originally read from. One tells a reader whether the figure is true, the other
tells them who approved it, and collapsing them loses whichever they needed.

**`loadSignedOutput` is the query the whole chain rests on** — `signed_at is not null` in the `where`
clause, reading `output_value` rather than `working`. A draft is not filtered out by an `if`; it is
not in the result set.

**One route, a `?module=` parameter.** Nine agents are coming and Vercel allows twelve functions. An
unknown module is refused with 404 rather than opening a run over an empty field set and closing it
as reviewable — which would present a step that established nothing as one that had finished.

**Two steps in one process area, which the process model cannot express.** D1.1's sub-processes are
*Feasibility Cost Estimate*, *Elemental Cost Plan*, *Cost Plan Revision* — an order inside one code —
so the edge is declared on the modules (`WITHIN_AREA`), not by inventing D1.1a and D1.1b in a record
of the firm's documented BPMN. A within-area edge **replaces** the area's upstream rather than adding
to it (the cost plan waits on the estimate, not on the brief), the area's downstream belongs to the
last step in the queue, and an incoming area edge lands on the first.

**Amounts are still text, as the document writes them.** `R186 420 000,00`, not `bigint` minor units.
Parsing a currency out of a model's answer is where a confident wrong number gets in — a misread
thousands separator is silent and survives review — and §5.2's round-once rule is about
`quantity × rate` at a bill item. `money.ts` is waiting for the step that multiplies.

## The row-shaped run — built

The proposal below was built, with three changes to it. `run_items` (migration `0010_run_items.sql`),
the Bill of Quantities at `/bill`, and `extend()`'s first caller.

**The two riskiest parts were the two named as risky, and both are proven by a run.** The rounding
trigger and `extend()` are checked against each other on every commit — `checks/bill.mjs` puts nine
values through both, including the exact halves and the negatives, and asserts they agree. Measured:
`2.5 → 3` and `-2.5 → -3`, ties away from zero rather than to even, which is what a QS's calculator
does and what §5.2 means by "reproducible by hand". Excel paste is built and drives a real block
through a real `ClipboardEvent` in the suite.

**`amount` is written by the database and by nothing else.** The trigger recomputes it on every
insert and update from the *working* quantity and rate, so a row whose amount disagrees with its own
figures cannot exist — and an `update run_items set amount = 99` is silently overwritten with the
right answer, which the suite asserts. The application never multiplies anything.

**Three departures from the proposal, each because building it said so:**

- **No `quantity`/`rate` "working" columns.** The proposal stored the four maps and left `working`
  derived; the trigger then had to read the derivation anyway. It computes `coalesce(override_x,
  proposed_x)` itself, so there is exactly one stored figure per row — the amount — and it is always
  the extension of the two values the screen is showing.
- **Two rate precisions, not one.** §5.1 puts the scale beside the rate, and a single per-row column
  breaks the moment a QS corrects `R1 850,00` (two places) to `R1 850,4567` (four): the *proposal*
  would silently re-read as R18,50. `proposed_rate_precision` and `override_rate_precision`, paired
  with their rates by a check constraint.
- **The freeze fires on insert as well.** `run_fields` does not need that — a field set is closed —
  but a bill is a list, and a row appended to a signed bill would move an approved total without
  touching a row anybody signed. `insert into run_items` against a signed run raises.

**A refused figure is the design working.** `readQuantity` and `readRate` join `readAmount` in
`amount.ts` and refuse on the same terms: `1,234` is a thousand-fold ambiguity nothing in the text
settles, so the cell stays empty, the document's own words sit beside it, and the QS types the
figure. That applies to the typing hand too — the suite types `1,234` into a quantity and asserts
**nothing is written**.

**Writing them found two real defects in the readers, both from the property test.** `864 m2` was
read as *two* figures, because `m2` and `m3` — the units a South African bill actually measures in —
contain a digit; the unit now comes off before the figures are counted. And `formatRate` writes
`0,001` for a three-place rate, which `separatorsOf` refused as ambiguous — no convention writes a
leading-zero thousands group, and it now says so. The round-trip property is stated honestly:
anything the formatter writes reads back **or is refused as undecidable**, never something else. A
rate at three places can be written `1,000`, and that genuinely is one thousand to half the world.

**No quantity is ever invented.** `costplan.txt` describes four items of work, prices all four and
measures none of them, and the live run drafts exactly that: four grounded rows, four rates, no
quantities, no amounts. The sign-off gate then names every unmeasured row and refuses. That is the
designed flow rather than a defect — the documents describe the work, the QS measures it — and it is
asserted in `checks/run-live.mjs` so a model that starts inventing quantities turns the suite red.

**Headings are ours; items are the model's.** §4.7 wants Section → Item and a flat list of forty rows
is not a bill. But a heading carries no figure, so it is not a claim about any document: the model
returns a `section` label per item, and the writer creates the heading rows those labels imply, in
order. No heading exists that no item sits under, and the model never proposes one.

**The bill does not wait for a signed cost plan.** `upstreamPending` gates on the upstreams a step
carries a *required* figure from, and a bill carries none — it is measured from drawings and a
specification, while the elemental plan is a parallel estimate of the same work. Real jobs bill from
drawings with no plan signed. The chain still names D1.1 above it, because `feedsFrom` is "provides
data to" and only `requiredCarriesFrom` is a gate. That distinction was already carrying variations
and valuations; nothing new was needed.

### What §7.4 got, and what it did not

Three of its eight mandatory requirements decide whether this is usable, and they are built: **inline
editing with no modal** (the cell *is* the input), **keyboard navigation** (arrows move rows, Enter
commits and descends, left/right move the caret until it runs out and then move the cell, Escape
cancels), and **Excel paste** — a block fills from the cell it lands in and **appends rows** when it
runs past the end of the bill, because a QS pasting forty measured quantities against a bill of
twelve means the other twenty-eight.

Sections fold, subtotals are derived on every read, and the totals footer is a sum of already-rounded
amounts. Not built and not pretended: virtualisation and 15 000 rows, undo/redo, `⌘D` fill-down, and
columns resizable / reorderable / hideable per user. They land with the bill that needs them.

**The row is two lines, which is a deliberate departure from the 32px default.** §4.7 puts provenance
in a right-hand drawer that does not exist, and a bill whose rows had no visible evidence would be
this platform's one claim quietly dropped from its most important screen. The citation sits under the
description — document, page and the passage in full.

**There is no reason box, and that is a decision.** The field table asks for one beside a correction
because ten figures is a pace where a sentence is worth typing. Four hundred cells is not, and a
reason field that is always empty is a record of nothing. What is recorded instead is stronger: who
and when on the row, and `quantity_source` saying whether the figure was **typed or pasted** (§6.3) —
which a reason box could never have told anybody.

**The grid does not disable its cells while a save is in flight.** It did, and the bill suite passed
alone and timed out inside the full run: a save that took longer on a busy machine swallowed the next
keystrokes. That is also simply wrong for §7.4, which wants a column typed down without interruption.

## The dashboard — every tile traces, or says why it cannot

`/home` was deliberately an empty page, because §14 names demo-driven development as a way this
project fails and there was nothing signed to put on it. There is now.

**Four tiles, and each one is a query over signed figures.** Total project value is `cp-total` from
the signed cost plan, read through `readAmount`, falling back to a signed bill's own total. Cost per
unit divides it by the unit count the feasibility estimate signed; cost per m² by unit count ×
average unit area. "Needs attention" is the union of four things that already exist and had nowhere
to be seen together: reconciliation differences, steps waiting on an unsigned upstream, required
fields with no value, and unpriced bill rows — each itemised with a link to the step that would
settle it.

**A tile is a figure or a stated absence, never a plausible number.** Where nothing is signed it says
which document would establish it and links there. Where a signed figure could not be *read* —
`readAmount` refusing a qualified total — that is a **third** state and says so, with the document's
own words and the reader's reason. Calling it "not signed off" would send a QS to sign something that
already carries a signature.

**Clicking a tile reaches the signed run behind it.** With one contributor it opens that step; with
several it opens the table, where each project links to its own run. A KPI nobody can trace is the
untraceable figure §1.3.1 calls worse than a gap, and a dashboard is where that failure is easiest to
commit.

**Two things from the reference build were not copied.** Its four coloured icon chips — §7.1 #5 says
colour means exactly one thing — and its progress and activity panels, which are hard-coded arrays of
plausible sentences. Progress here is signed steps counted; activity is the signatures themselves.

`perUnit` and `multiplyQuantities` in `money.ts` are a **second** rounding site, and the reason it
does not breach §5.2 is written where they are: §5.2 governs the extension and the totals that sum
it, and these are indicators computed *from* a total, never summed, never stored, never carried into
a certificate. The same standing `applyPercent` already had.

`checks/home.mjs` — 57 checks — pins the arithmetic to figures that can be checked by hand:
R186 420 000,00 ÷ 1 046 units = R178 221,80, and ÷ (1 046 × 48 m²) = R3 712,95.

## Pricing — the rate column, and two ways to fill four thousand of them

§4.8, built. `/pricing`, `rate_build_ups` / `rate_components` and `run_items.rate_source`
(migration `0011_pricing.sql`).

**Pricing is a lens, not a step.** No `runs` row, no field set, no signature of its own: the rows
are the bill's `run_items`, and the bill's signature is what freezes them. A second run for pricing
would be a second approved answer to "what does this item cost" with nothing downstream able to say
which of the two a total was summed from. It is also already consistent — §4.7's sign-off refuses a
bill while any item has no rate, so **a signed bill is a priced bill by construction**, and the
pricing screen renders one read-only.

That is why it has no entry criteria and never appears on the project overview's list of steps. It
is `built: true` in the nav and a branch in `[module]`, so the function count is **still twelve**.

**§2.5 is honoured at the level that decides anything: one write path.** A rate corrected on this
screen goes through `correctCell` — the same server action the bill grid calls. Making that possible
meant moving `openBill`, `cellWrite` and `writeOverrides` out of `bill-actions.ts` into
`src/lib/agent/bill-writes.ts`, because **every export of a `"use server"` module is a server action
reachable from a browser**, so an action file cannot lend a helper to another one. Copying the
writer would have given two implementations of what a correction is.

**Bulk application, and what is deliberately not in it.** §4.8 names two bulk actions. *Apply a
percentage across a selection* is built. *Apply a rate set* is the Rate Library, which is not built,
and a nameless imitation of it inside this screen would put a second home for the firm's rates in
the product before the first one exists — so what is there instead is the primitive underneath it:
**a rate a person states, applied to the rows they selected**, attributed to them. Without that the
bulk gesture would only work on rows that already had a rate, and a bill drafted from a
specification arrives with none.

**A row with no rate is skipped by name, never zeroed.** Ten per cent of nothing is nothing, and
writing it turns an item nobody has priced into an item priced at zero — which the sign-off gate
would then happily freeze. The screen says which rows were left alone and why.

**One selection mechanic, plus a filter.** A checkbox per row, one on each section, one in the
header that takes everything *currently shown* — so "select every unpriced row" is the Unpriced
filter plus the header box, rather than a third control doing it in one click (§2.5).

### The build-up, and where its arithmetic stands

`buildUpRate()` in `money.ts`: each component extended and **rounded per line**, summed, then waste,
then markup on delivered cost. It is a third rounding site and does not breach §5.2 for the reason
written beside it — it produces a **rate**, which is an input to the extension rather than a step
inside it, and the item's amount is still computed exactly once afterwards by the trigger.

Rounding per component is not a shortcut: it is what the paper does, and §5.2's actual test is that
a QS adding the column by hand gets the same answer. The worked example is asserted twice, as a
literal — `0,35 t @ R2 400 + 0,7 m³ @ R180 + 2,5 h @ R85`, net R1 178,50, waste 5% → R58,93, markup
12% → R148,49, **rate R1 385,92** — in `money.test.ts` and again through the browser in
`checks/pricing.mjs`.

**The computed rate is not stored.** It is a derivation over rows three lines away, and §6.5's
answer for a value that changes as fast as its inputs is *derive*. What is stored is the figure the
arithmetic uses: `run_items.override_rate`, applied from the build-up and extended once by the
trigger. The same discipline as the "no working columns" departure `run_items` already made.

**`readBuildUpDraft` runs twice per edit and that is the point.** Once in the editor, so the rate
appears the moment somebody stops typing rather than after a round trip, and once on the server,
which is the copy that decides. One function in `@/lib/pricing`, so the number on screen and the
number written to the row cannot differ — neither copy has its own opinion about what `1,234` means.

**The plug is stored on the build-up, not only on the row.** The row's `override_rate` is the figure
the extension uses; the plug is the QS's standing statement that they are not using the build-up's
answer, and it survives the next component edit where a rate typed into the grid would simply be
recomputed away. A rate typed over a build-up from *either* screen is flagged on the row — *"not the
build-up's R1 500,00"* — which is §4.8's "flagged, never hidden" arrived at from the other
direction.

**Removing a build-up takes the rate it set with it.** Leaving it behind would leave a figure whose
derivation had just been deleted, arrived at by tidying up.

**`rate_source` is stored rather than derived**, for the reason `quantity_source` already is: read
by the agent, typed, pasted and built up are four different claims about one number and none is
derivable from the others. A build-up is the near miss — a row with one attached looks as though its
rate must have come from it, right up until somebody types over the top.

**The freeze reaches two tables further out.** A signed bill's rate is frozen by `run_items_frozen`;
its *derivation* has to be frozen with it, or an approved rate ends up sitting under a working that
no longer produces it. `insert or update` and **not delete**, the same shape every freeze in this
schema has and for the same reason: a delete trigger would make a project with a signed bill
undeletable.

### What driving it found, which reading it would not have

**`separatorsOf` accepted a grouping that was not a grouping, and read it as a number.**

The cell held `1 500,00`. A triple-click selected **`2-2 of 8` — nothing**: §7.7 groups thousands
with a non-breaking space and Chrome's line selection will not cross one, so the click placed a
caret and typing `1 900,00` produced `11 900,00500,00`. That was read as **R119 000 050 000,00** and
written to the bill, because "more than one of the same mark can only be grouping" never checked
that the groups were groups.

Both halves are fixed and they are not the same defect. The interaction was awkward; **accepting the
result was dangerous**, and that is the one that protects every route in — the agent's reading, a
pasted column and a typed cell alike. `thousandsGrouped` now requires one to three digits and then
groups of exactly three, and `separatorsOf` returns the reason rather than a bare `"ambiguous"`
sentinel, so a malformed figure is refused in its own words. Verified by putting the bug back and
watching two tests go red.

The interaction fix is `onFocus` → `select()` on **both** grids' numeric cells, which also makes the
mouse agree with the keyboard: `move()` in the bill grid already selected on arrival.

**The suite found its own version of the same lesson.** A build-up's working is computed from the
*local draft*, so it shows the right rate long before the server has been told — asserting against
the database at that moment read a build-up two components old, while the screen said "Saving…" in
the very detail line that passed. The signal is now the row's own amount, which only the extension
trigger can produce.

**The function count was not measured, and here is why.** `vercel build` runs `npm run build`, whose
first step is the migration, and Next loads `.env.production.local` — which holds the real
`DATABASE_URL` — ahead of `.env.local` for a production build. Running it here would have migrated
the instance production serves, which is not mine to do. What is verified instead is the input to
the count: **no route file was added, renamed or deleted**, `/pricing` is a branch inside the
existing `[module]/page.tsx`, and `pricing-actions.ts` is a `"use server"` module with no `page.tsx`
or `route.ts` beside it. The existing `.vercel/output` still reads twelve. Run
`vercel build && npm run functions` before deploying, with the database variables stripped the way
CI strips them.

## The container — §13.1's own choice, finally built

`Dockerfile`, `.dockerignore` and `compose.yml`. The full twenty-suite gate has been run **against
the running container** rather than against `next dev`, and passes.

**This is not a new direction, it is the specified one.** §13.1 — *"chosen once, not revisited"* —
says the app *"runs as a plain Node server in a container, not serverless"*, and names a single
container as the hosting choice. Serverless was the deviation, and every constraint that came with
it is a tax on that: twelve functions, `maxDuration = 60` on the agent route, a 4.5MB body limit the
whole browser-to-storage upload path exists to work around. `next.config.ts` has carried
`BUILD_TARGET=container` since early on and `postbuild.mjs` was written for a standalone build that
nothing was building. This is the missing twenty lines.

**Migrations moved from build to start.** `npm run build` migrates first, which is right for a
platform that builds against the database it will serve and wrong twice over here: a `docker build`
has no database to reach, and baking a migration into an image means the image cannot be built
without write access to production. Not hypothetical — it is why the function count was never
measured locally. The image runs `next build` alone; the entrypoint migrates whatever it is pointed
at, once, and names the host it reached.

**`fixtures/` is the first entry in `.dockerignore`.** It holds real client documents, and an image
is a much looser thing than a private repository: pushed to a registry, pulled onto build agents,
cached in layers that outlive the tag. None of that is a place for a client's title deed.

**`.env.local` is quoted, and Compose strips the quotes — verified, not assumed.** `vercel env pull`
writes every value quoted, and quotes surviving into a container are the failure this repository has
already hit twice. Probed before trusting it: `EMAIL=[qs@mzilikazi.co.za]`, secret length 43 rather
than 45.

362MB. `HEALTHCHECK` on `/api/health`, non-root, and `exec` so the server is PID 1 and SIGTERM
reaches it rather than stopping at the shell.

### What running the gate against a production build found

**`checks/import-agent.mjs` had been passing on timing, not on truth.**

It clicked Withdraw and waited for the count of `Withdraw` buttons to drop. That happens in about
**35 milliseconds** — because `setWithdrawing(id)` relabels that one button "Withdrawing…" and it
stops matching the regex. The suite was waiting for the click to be *acknowledged*, not for the
document to be withdrawn. It then reloaded while the server action was still in flight, and against
a production build the reload is fast enough to win: the row came back, and `5 → 5` failed.

The database was queried at the moment of failure and the withdrawal **had** been written — which is
what ruled out a caching bug and pointed at the suite instead. Under `next dev` it passed because
dev is slow enough that the write always landed first.

It now waits for `Delete all N`, rendered from the server's own `reviewed.length`, which cannot
change until the write has landed. Green against the container and against `next dev`.

The same mistake `checks/pricing.mjs` records making with "Saving…", and worth naming as a class:
**a suite must wait on something only the server can produce.** An optimistic label, a spinner, a
disabled attribute — each says a click was received. None says the work is done.

## Two things the tokens were never defining

**`--ok-*` and `--warn-*` were used thirty-nine and thirty-six times and declared nowhere.** An
undefined custom property makes its declaration invalid at computed-value time, so `color:
var(--ok-700)` was **dropped** and the text inherited body grey: every "Signed off" green and every
amber refusal in the platform was colourless, in exactly the places §7.1 #5 leans on state being
legible at a glance. `.num` was the same — twenty-four elements asking for tabular figures from a
class that defined none, so every column of money was set in proportional digits.

Seventeen browser suites went past it because the defect has no text. `src/app/globals.test.ts` is
the detector: it fails on any `var(--token)` a component references and the stylesheet does not
declare. Verified by putting the bug back and watching it go red.

## Production, exercised

`npm run check:production`. Deployed 2026-08-16 with `0008_runs` and `0009_carried_via` — the build
log reads *"Migrating …/neondb — 10 migrations committed. Database is up to date."*

The agent has now run against Neon by a signed-in client: ten fields, six read from the corpus, the
unit count `1 046` out of the brief with citations, the run still there after a reload. **The filed
original opened and returned 1 003 real bytes**, which is the check that matters most — `store()`
once fell through to a disk write with no Blob token, Vercel's filesystem does not persist, and every
document filed on production was indexed with its original thrown away, silently, for weeks.

**Deployment Protection stays on.** Protection Bypass for Automation is the way through: a header the
suite presents. The secret is **not** in `vercel env pull` — every other `VERCEL_*` system variable
is, and that one is withheld — so it is copied once from the dashboard into `.env.production.local`.

**`vercel env pull` writes `[SENSITIVE]` for anything marked Sensitive**, and that cost an hour
twice. As `DATABASE_URL` it threw `ERR_INVALID_URL` from the migrator. As `DEV_USER_EMAIL` it went
into `<input type="email">`, failed the browser's own validation, and the form silently refused to
submit — no error, no request, just a navigation timeout thirty seconds later. That is the same shape
as the quoted-`.env.local` bug already recorded: **a credential that is subtly not a credential
produces no error, only an absence.** The suite detects it, says so, and falls back to the local pair.

## Money — reading a figure, and refusing to guess

`src/domain/amount.ts`, in front of `money.ts`. §18 lists money second among the things expensive to
get wrong, and §5 is the one place in the product to be paranoid.

**`parseMoney` was always strict and always right to be.** Hand it `"R186 420 000,00"` and it throws,
which is correct for a bill cell somebody typed. But these figures did not come from a cell — they
came from a cost plan saying *"R186 420 000,00 excluding VAT"*, a contract saying *"R42 000,00 per
calendar day"*, a brief saying *"48 m2 and 62 m2"*. The missing piece was the boundary in front of it.

**It refuses rather than guesses, and the refusals are the design:**

| Refused | Why |
|---|---|
| `1,234` | Thousands separator or decimal comma — a **factor of a thousand**, and nothing in the text decides it |
| `R42 000,00 per calendar day` | A rate. Summed with amounts it contributes forty-two thousand rand of nothing |
| `10%` | A percentage is not an amount once the sign is dropped |
| `48 m2 and 62 m2` | Two figures; picking one is a guess about which was meant |
| `R186 420 000,00 excluding VAT` | The qualifier changes what the figure means |

Everything else *is* decidable and is read: mixed separators settle by position (the last mark
decimates, true of both conventions, so no locale is assumed); repeated marks are grouping; a space
is always grouping. The ambiguous case is deliberately narrow — grouping is only plausible when the
part before the mark is one to three digits, so `1234,567` reads as a decimal.

**The property tests round-trip `formatMoney`**, which is the only honest way to test a parser:
anything the formatter writes, the reader must read back exactly. That caught a real defect —
§7.4's accounting negative `(1 234,56)` had its brackets stripped as ordinary punctuation and read
back **positive**, so an omission would have increased a total it was meant to reduce.

**A step checks itself.** `FieldSpec.money` marks each figure `element` or `total`; `reconcile()`
sums the elements and compares them with the total the document states. A difference is **reported,
never resolved** — the plan may carry an element this field set does not ask for, the total may
include VAT the elements exclude, or a figure may be wrong, and all three happen. Refused figures
are listed with their reason, because a sum that silently skipped three elements is a sum nobody can
reconcile by hand.

Shown on Project Data, **outside the table, labelled as computed**. That separation is what lets it
be on a page of signed figures at all.

**Not this slice:** `round(quantity × rate)`. `extend()` is still the only function that rounds and
still has no caller — it belongs to the bill, where something multiplies.

## Project Data — the approved figures, read back

`/projects/[id]/data`. The chain had been writing signed outputs for four slices and only the *next
step* ever read one: a QS could see ten figures on the feasibility estimate and eleven on the
contract, and had nowhere to see the project's approved data as one thing. That is the question asked
before anything is issued, and it is what a report is generated from.

**Signed only.** `signed_at is not null`, `output_value` rather than `working`. A draft figure is not
approved data, and putting one here beside approved ones would recreate exactly the ambiguity
`output` exists to remove.

**What is *not* approved is on the page too**, named, with its state — because "what is left" is half
of making sense of this, and a reader who cannot see the gap assumes there is not one.

**Every figure keeps its document.** §1.3.2's promise does not weaken with distance from the run that
produced it: same document, same page, same quote. A hand-entered figure says *"Entered by hand — no
passage to quote"*, because that is a different kind of number and the difference is the point.

**It is deliberately not a report.** No totals, no derived figures, no verdict. Everything on it is a
value a person signed; the moment it also carried arithmetic nobody signed, the two would be
indistinguishable at a glance. Money is the next slice and belongs to the step that multiplies.

**It is a `[module]` route, not a folder.** A folder is a serverless function and one slot is left —
the same reason three module pages became `[module]`. Measured after: still eleven.

**It found a bug in the test seeding on its first render.** `checks/signoff.mjs` parsed
`FEASIBILITY_FIELDS` from `run.ts` by slicing to the end of the file, which was right while that was
the only field set. Nine more were declared after it, so the suite had been seeding **87 fields** into
a feasibility run — and the page showed `cp-substructure` under the Feasibility Estimate. The slice is
bounded now, and the count is asserted exactly rather than as "at least ten", which is what let it
pass.

## What a step establishes, before it is run

§1.3 defines a run by **the fields it must return, not by a prompt** — and that definition lived only
in the source. A reader met a button, pressed it, spent money, and found out afterwards what had been
asked. It is the same complaint as the wall of rows, one step earlier: the step could not be
understood before it acted.

The field set is now on the panel until a run exists — every figure in the order it will be asked
for, what each one feeds, which are required, and which are **carried** from a step above rather than
read here. On the cost plan that reads *13 figures · 7 required · 3 carried from a step above rather
than read again*, and the three say which step they wait for. It disappears once a run exists,
because the run's own table then answers the same question better: what was asked *and* what came
back.

## The run is a table

It was a list of tall rows — label, value, note, a citation folded behind a disclosure, a confidence
badge and two buttons, stacked. Ten of those is a wall, and the first thing said about it was that
the extracted data was **"too much, and too confusing"**, which is the correct reading of a surface
where the ten figures a QS came to check are spread down two screens with the evidence hidden.

§7.1: *the grid is the interface*, density over whitespace, this is a financial instrument and should
feel like one. §7.4 fixes the numbers — 13px, 6px/12px cells, a 12px uppercase header, one rule
between rows, no zebra. The columns are **v3's** (`portal-v3/components/bodies/field-table.tsx`),
which is the surface this replaces and the one a QS has already reviewed runs on:

| Field | Value | Confidence | Source | Your figure |

**No horizontal scroll, as a correctness rule.** v3 records why: with an auto-width table the Source
column grows until it pushes the override control off the right edge, and a reader who does not
notice a horizontal scrollbar concludes the figures cannot be changed. `table-fixed` with declared
widths holds it, and Source gives by **wrapping** — a quote cut off at an ellipsis is evidence
nobody can check. Measured after the rebuild: `scrollWidth === clientWidth`, 1094px.

**`DocumentLink` truncates by default and must not here.** Rendered in the Source column it produced
"DEMACON_Wewe (Kings Estate) Residential Mark…" with the page number pushed under the next column and
clipped. The caller overrides it; the default is still right for a list of filenames.

**The override is a box on the row, not a button that opens one.** Correcting used to be: click
Correct, wait for a form, type, click Save. A review pass is ten figures at a time, so the box is
simply there and Enter commits it. The reason field appears only on the row being edited — a second
input on every row is the clutter this rewrite exists to remove.

**Confidence reads as a word where a percentage would mislead.** A carried figure is *Approved* — it
came from a signed run, so the model's uncertainty about it was settled by a person. A corrected one
is *Human*. A gap is *Gap*, never 0%.

## A refusal that names a document now offers to take it

The run panel's blocker was a sentence: *"File Project brief and concept parameters first."* A
reader who has just been told that is a reader holding that document, and the only way to file it
was to scroll past the run panel, find the matching row in the readiness list and use the button
there.

That is the v3 lesson about the documents page — *"a reader who discovers they need a document must
be able to file it there, not leave to find a documents page, work out the category and come back"*
— arrived at one screen further in. The refusal now lists each missing requirement with its own
**Upload** beside it, on both the field panel and the bill panel.

**It is not a second way to file, and that distinction is the whole of §2.5.** It is the same
`CriterionUpload`, bound to the same criterion, filing under the same primary kind — the rule
`readiness-list.tsx` and `criterion-upload.tsx` already use, derived once in
`blockingInputs()` so the two surfaces cannot drift. What §2.5 forbids, and what got the
project-wide documents panel deleted, is a control that asks the reader to *choose a kind from a
select*: a genuinely different act with a different chance of being got wrong.

**The upstream blocker deliberately gets none of this**, and `checks/chain.mjs` now asserts that the
run panel offers **zero** upload controls while a step is waiting on an unsigned signature. Nothing
filed there clears it, and an upload button under that sentence would be the contradiction v3
printed when it showed "needs a cost plan" beneath "Filed and indexed: the cost plan". §1.3.3 keeps
the two blockers apart in words; this keeps them apart in controls.

`checks/run.mjs` drives it: the refusal names three requirements, offers three uploads, each titled
with the kind it files under, and the brief is filed **through the banner** — so the assertion goes
red if it ever goes back to being a sentence.

## A satisfied criterion still takes documents

The evidence list rendered only while a criterion was unresolved, so the moment one document
grounded it the row offered no way to file another. That is wrong for most of this platform: a job
has forty contract instructions and twelve payment certificates, and the criterion is satisfied by
the first. The rest had nowhere to go but the bulk import screen — and the reason the upload is on
the row at all is v3's lesson that a reader who discovers they need a document must be able to file
it *there*.

Found by the live suite crashing: the variation order satisfied the instructions register's
criterion, so its own fixture could never be filed and the step was tested against the wrong
document. What changes on a satisfied row is only the sentence — *"Filed — add another if there is
more than one"* — because filing is no longer the thing that would unblock the step.

## The spinner was strobing, and the reason was the accessibility rule

`@media (prefers-reduced-motion: reduce)` set `animation-duration: 0.01ms !important` on `*`. That
ends a *finite* animation instantly, which is the intent. On an `infinite` one it does the opposite
of removing motion: measured at **`1e-05s`, `infinite`**, the spinner completes a rotation every
hundredth of a millisecond, so every painted frame samples an arbitrary angle. That is what "the
spinner is glitchy, it is not rotating steadily" was — and only for readers who have reduced motion
switched on, which is why it looked intermittent and unreproducible.

An earlier pass read the same symptom as a compositing problem and promoted the layer with
`will-change`. That is sound for its own reasons and is kept, but it was not this.

WCAG 2.3.3 governs animation that is decoration. A progress indicator is feedback — the only thing
on screen saying an import is still running — so it keeps turning under reduced motion, at 2.4s and
steadily, which is genuinely less motion than the default.

## Grounding — both signals, not either

**A criterion is satisfied only by a passage from a document of a kind it accepts.** Retrieval used
to be enough on its own: any document containing the phrases satisfied it. That is too loose for a
gate, and it failed three times in one afternoon —

- a concept-layouts document saying "the standard assumed in **the cost plan**" satisfied *Priced
  cost plan*, so the step reported it had an estimate nobody had filed;
- a JBCC contract saying "the accepted **tender amount**" satisfied *Tender returns*;
- and each time the response was to narrow the search phrases, which makes real documents harder to
  find in order to stop wrong ones matching. Exactly backwards.

§1.3.3 already said what satisfies a criterion — `acceptedEvidence`. "Site and market data may
arrive as a geotechnical report, a fee schedule or a market study": *those* documents, not any
document that happens to use the words. The row's own upload files under the criterion's primary
kind by construction, so filing from a blocked step always satisfies it.

**Retrieval returns a handful and the best hit from an *accepted* document grounds it.** Testing
only the top hit was the first version and it broke as soon as a project had six documents: a tender
report filed under exactly the right kind was outranked by the contract for those words. Ranking
decides which passage is quoted; it no longer decides whether the criterion is met.

**`Criterion.terms` is separate from `acceptedEvidence`.** One list was naming the kinds a document
files under *and* supplying the search phrases. A JBCC contract never contains the words "signed
contract" — it says *principal building agreement*, *the contractor is*, *contract sum*.

**A gate wants precision where a field wants recall.** An extra passage costs a field nothing — the
model reads it and says it does not answer. It costs a gate its meaning.

**What this changed downstream:** the developer brief no longer satisfies *Market data*, because a
brief filed as a brief is not a market study. `fixtures/market.txt` exists for that reason, and the
withdraw suite's "3 → 1" became "3 → 2" — the old number was the spurious double-satisfaction.

## The construction chain — five more modules

Contract (D1.4) → Valuations (D1.5) · Variations (D1.6) · Cost Report (D1.7) · Final Account (D1.8).
Seven run-producing modules now, **and still eleven functions**: they share
`/projects/[id]/[module]` and the one `?module=` run route.

**Adding each one is four declarations.** A `FieldSpec[]` in `FIELD_SETS`, its entry criteria, its
wording in `RUN_WORDING`, and `built: true` in the nav. No new route, no new branch in `chain.ts`.

**A step's dependencies are now derived from the figures it needs, not read from the process model.**
That model is **L2** and was wrong in both directions at once: too coarse to order two steps inside
D1.1, and silent about the contract that the D1.8 final account plainly measures against. So
`feedsFrom` is the union of the area model and **the modules a step carries from** — and `WITHIN_AREA`
disappeared, because a carry inside one's own area already says everything it said.

**An upstream gates only when this step carries a *required* field from it.** `feedsFrom` conflates
"provides data to" with "must come first", and only the second is a gate. Variations feed a
certificate — but the first certificate on a well-run job has no variations, and mechanical gating
would make a normal month's work impossible until somebody ran a step over an empty register and
signed it. The rule needs no configuration: it falls out of the field sets, like `producesRuns`.

**`Criterion.terms` had to be separated from `acceptedEvidence`.** One list was naming the kinds a
document may be filed under *and* supplying the phrases the corpus is searched for. Usually close
enough — a market study says "market study". A JBCC contract never contains the words "signed
contract"; it says *principal building agreement*, *the contractor is*, *contract sum*. So a contract
filed under exactly the right kind was grounded by nothing and blocked its own step for ever. The
same failure already recorded against a workbook; five new modules turned a known limitation into
five broken steps.

**A gate wants precision where a field wants recall.** The first draft of the cost plan's terms
included the bare phrase "cost plan", and a concept-layouts document saying "the standard assumed in
the cost plan" satisfied the criterion — so the step reported it had a priced estimate nobody had
filed. An extra passage costs a field nothing; it costs a gate its meaning.

## Verification

**Verification.** `checks/signoff.mjs` (free, in `check`) seeds a finished run and drives the screen:
persistence in a tab that never ran it, correction, the gate, the signature, a second tab, and the
database refusing all four kinds of tampering in SQL. `checks/run-live.mjs` (paid, deliberate) is the
only thing that exercises the **writer** — it compares every persisted row against the event that
was streamed for it, which is what keeps the seeded fixture honest. It now files what the interface
requires rather than POSTing past it. Last live run: 10/10 fields persisted identically, 3 742 in +
293 out tokens, $0.0013.

`chain.test.ts` covers the derivation. `checks/chain.mjs` (free, in `check`) seeds a signed feasibility
run and drives the gate: the cost plan closed and saying which step it waits on, the server refusing a
direct POST in the upstream's words, an unknown module refused, and the step opening the moment the
signature exists. The **carry itself** only happens inside the route, so `checks/run-live.mjs` is the
only thing that exercises it — it runs the estimate for real, corrects a figure, signs it, runs the
cost plan, and asserts the corrected figure arrives with `carried_via`, the upstream run id and the
original `brief.txt` citation. It then runs the **contract** on a JBCC schedule, because a pattern
that has only ever run on the two documents it was written beside is a pattern nobody has tested:
eleven fields, every one grounded, every clause verbatim.

**`vitest.config.mts` exists now** for one reason: vitest does not read `tsconfig` paths, so until it
was added a module could only be unit-tested if it happened to import nothing. That is a rule about
what gets tested rather than what is worth testing.

---

## Decisions worth not re-litigating

**Lexical retrieval before vectors.** `SANS 1200` and `SANS 10400` sit close together in vector
space, and in a costing platform that is not a near miss, it is a wrong number. Postgres FTS is the
first half of hybrid retrieval; pgvector is the second half, not the default.

**One list owns the menu labels, and they are Title Case.** `navigation.ts` is it: `module-page.tsx`
renders the matching label as the page `<h1>` and `placement.ts` uses it to say where a document
landed, so a label is not decoration and changing it in one place changes it everywhere — which is
why four suites asserted on the old casing. *Bill of Quantities* keeps its lowercase *of*: that is
how §4.7 and §9.1 spell the document, and the domain's spelling of its own artefact beats a
mechanical rule. "Project settings" is **Project Details**, but `/settings` did not move — unlike
import → corpus, nothing about that page changed.

**A hidden column is not evidence.** Measured on the reference estimate: columns B–E of its Summary
sheet are hidden and hold a superseded copy of the whole thing — `#REF!` where a total belongs,
`#ERROR!` where a sum belongs, and a primary-bulk figure of **19 403 590** against the
**103 966 787** in the visible columns beside it. Read them and the corpus holds two answers to
"what do the bulk services cost", one of which the QS cannot find in their own file. §1.3.2's
promise is that a citation can be checked by opening the document, so hidden columns, hidden rows
and hidden sheets are not read. The trade is deliberate: a missing passage is a visible gap, a
superseded total is a confident wrong number.

**No spreadsheet library, and the reason is not taste.** SheetJS on npm is pinned at 0.18.5 (2022)
and carries two HIGH advisories — GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9 — whose
`firstPatchedVersion` is **null**, because the fixed releases go to the vendor's own CDN and never
to npm. exceljs brings nine runtime dependencies including a zip *writer* and a CSV parser. Node
ships `zlib.inflateRawSync`; the rest is a zip directory and machine-generated XML. It also inflates
only the parts it needs, so a workbook's 1.4 MB of embedded images is never touched — the 2.5 MB
reference estimate reads in 137 ms.

**A workbook has sheets, not pages**, so no page number is invented (as with `.docx`). Every line
carries its own address instead — `Summary!I9=Sewer | J9=9701795 | K9=56626765` — because
`split.ts` cuts a sheet into 1 200-character passages and a sheet name on a heading line would
survive only into the first one. The column letter is on every cell because real estimates put two
tables side by side: on the Sewer sheet, columns A–I are Phase 2D and Q–Y are Phase 2E with the
same labels down both, and without the letters a 2E cost reads as a 2D cost. Verified against six
real workbooks from four producers — Google Sheets export, Excel, and two accounting exports.

**A drawing is not a document.** Measured on this corpus: a 4MB site plan yields 175 words, all
title block. Worse, "PROJECT LOCATION" in that block matches the site-location criterion through
full-text search — a criterion ticked green by a title block. Spatial kinds never ground a criterion
(`src/lib/ingest/document-class.ts`).

**The import agent proposes; a person archives.** Nothing it decides removes anything. Every verdict
carries the number behind it — "46 drawing operations, where a technical drawing on this corpus has
2 256 170" rather than "reference only" — because a verdict a QS cannot argue with is one they
either obey or ignore, and both are wrong. The button beside a proposal is the same Withdraw they
could have clicked anyway. A corpus that quietly dropped the copy which turned out to be the signed
one is worse than one with four copies in it.

**pdf.js detaches the buffer you give it.** It transfers the ArrayBuffer to its worker, leaving the
caller with a zero-length view and no error. The upload route parsed a document and then measured
it, and the measurement failed with *"Cannot transfer object of unsupported type"* on a buffer the
parse had already taken. The symptom was a null measurement — indistinguishable, everywhere it is
displayed, from "this document predates the measurement" — so the geometry signal simply did not
exist and nothing said so. Both `parse.ts` and `geometry.ts` copy before handing bytes over now.

**Two kinds of drawing, and the signal is measurable.** Both A1 sheets from the same project:

| | Reference map | Technical drawing |
|---|---|---|
| Drawing operations | 1 230 | 2 256 170 |
| Text | title block only | `267,733 m²`, `100 YEAR FLOODLINE`, `retaining wall required` |

Three orders of magnitude. A raster map placed on a page has nothing to measure; a vector drawing
has both geometry and costable annotations. **Op count plus text density is the signal the import
agent should use** to judge whether a document carries data worth having.

**.dwg is held back, not parsed.** Every reader means a paid licence, a GPL obligation, or sending
client drawings to a third party. The issued PDF parses fine and is the document a QS would defend —
it carries the revision and the title block. Counted and reported, never silently dropped.

**A tick is not evidence.** `satisfied` needs a passage that can be quoted; a human tick is
`declared` and renders outlined rather than filled, so a reviewer can see which items rest on a
document and which rest on a person.

**The bytes do not come through the function.** Vercel rejects a request body over about 4.5 MB at
the edge, before any handler runs — and the documents this platform exists for are bigger: 22.1 MB
of market study, 11.8 MB of geotechnical report, 9.0 MB of developer presentation. No message of
ours could describe the failure, because no code of ours ever saw it. The browser sends anything
over that limit to the store itself and hands the function a pathname; the request that arrives is a
couple of hundred bytes whatever the document weighs. Below the limit a multipart body still works,
including on a laptop with no store connected. **From `bytes` down there is one ingestion** — two
ways in and two ways to file would be two places for the kind to be defaulted or the measurement
skipped.

**Originals were being discarded on production, silently, for weeks.** With no store connected,
`store()` fell through to a disk write, and Vercel's filesystem does not persist — so every document
filed was parsed, indexed, and its original thrown away. It said so at upload time, once, among
per-file rows, and nowhere afterwards. Nothing accumulated the fact. `/api/health` now reports
`agent` and the store is connected, but the general lesson stands: a failure reported only at the
moment it happens is a failure nobody knows about a day later.

**A run is a field set, not a chatbox.** Nobody is trying to find out what is in the documents —
they are filling a cost model with a fixed shape. Ask for the unit count, not "what does this say".

**The model's quote is not taken on trust.** It is located in the passages the model was given, by
string matching, in `grounding.ts` — code that has no opinion and cannot be persuaded. The citation
is then built from the passage the quote was *found* in, so it cannot point at the wrong document
even if the model says otherwise, and the quote shown is the document's own characters.

This is not theoretical. On the first real run against the reference brief, the erf field came back
`Erf 180, 63.8 hectares` — **both figures true**, and taken from two different sections, stitched
into a quote that appears nowhere. It was discarded, and the row says so in words rather than
showing a bare "not in the filed documents", because a QS who reads that would go looking for a
document they already have. Matching folds away whitespace, case and curly punctuation, which a
model tidies; it does not fold away words or digits.

**`not_found` may only ever mean "the corpus does not say".** Never "the model was unreachable",
never "the call timed out". Those throw, and the run turns them into a visible refusal that keeps
the fields already read on screen and states that the rest were never asked. A cost model filled
from a run that recorded absence for a question it failed to ask is the confident wrong number this
platform is arranged against.

**Retrieval terms are the words a document uses, not a description of the field.** They were first
written as labels — "erf extent", "average unit area" — and retrieved nothing from a brief that says
"Erf 180" and "walk-up units of 48 m2": seven of ten fields reported "no passage mentions this"
about a document that mentioned most of them. Now `accommodation schedule`, `comparable sales`.
**Bias toward recall**, because the errors are asymmetric once a quote must be found: an extra
passage costs tokens and the model says it does not answer, while a missed passage is
indistinguishable on screen from the document not containing it.

**A browser does not send you a filename.** Measured, not assumed: when a file comes from a
directory picker, Chrome puts the *relative path* in the multipart `filename` parameter, while
`File.name` in the page stays the bare name.

| | |
|---|---|
| `File.name` | `poa.txt` |
| `Content-Disposition` | `filename="corpus/ANNEXURE A - POWER OF ATTORNEY/poa.txt"` |

`request.formData()` reads back the second. That is why every folder import was filed under its
whole path. The server splits it now (`nameAndOrigin`) — the name is the name, the path is
provenance in `source_path`. The split is on the **server**, so it holds however the bytes arrive.

**A document is read, never written.** The viewer route exports `GET` and nothing else, so the
other verbs are 405 by construction rather than by a check somebody could remove. §1.3.2 is the
reason: if a filed document can be edited after a passage in it grounded a criterion, the quote
stops being evidence and the platform goes on showing a green tick over it.

**A database row must not name a drive letter.** `storage_location` holds the Blob URL or the
storage *key* (`ab/cd/<id>.pdf`), resolved against `STORAGE_DIR` at read time. It held an absolute
path for about an hour, and moving this project from `C:` to `D:` broke every document filed in
that window. A remounted volume or a restore onto a new host would have done the same, quietly.
The route also re-derives the location from the document id when the recorded one does not open,
so a stale row recovers instead of reporting a broken file.

---

## The money layer — corrected record

I said during the build that the money layer was "not built". **That was wrong.** It was built early
on, in this repo, then stranded when the UI was scrapped and rebuilt from scratch.

It is now restored: `src/domain/money.ts` (309 lines) and `src/domain/money.test.ts` — **30
property-based tests, passing** (`npm test`). It is self-contained and imports nothing.

The central rule, PLATFORM.md §5.2: `amount = round(quantity × rate)`, **rounded once**, at the bill
item. `extend()` is the only function in the system that rounds; every downstream total sums
already-rounded amounts. Quantities are `numeric(18,4)`, money is `bigint` minor units.

Nothing consumes it yet — the BoQ and pricing modules that would are not built. It is deliberately
in place ahead of them, because it is the one place where being wrong is catastrophic and quiet.

---

## The interface — branch `home-ux`

> Its heading said "forty-nine commits, pushed but not deployed". Both halves have moved on: the
> branch is well past that count and it is **live in production**. See the 2026-09-01/02 section
> for where it runs now.

The engine was built first and the screens grew around it one module at a time. This branch is the
pass that made them read as one product: a palette taken from the practice's own mark, a landing
screen that answers one question, project screens that narrow to the stages a job is engaged for,
and an advisor that says what to do next without ever stating a figure.

**Nothing here is pushed and nothing is deployed.** `git log origin/platform..HEAD` is the whole of
it. Forty-seven files, +4 840 / −545.

### The palette is the practice's, and it was sampled rather than chosen

`public/mzi-logo.png` is one flat colour across 129 853 of its pixels: **`#8dc63f`**. That is
`--brand-500`, exactly, and the stage bands on a project overview wear it undiluted.

The accent moved with it. It was a deep slate-blue on every button, link, active row and focus
ring — somebody else's colour on Mzilikazi's platform, and beside green stage bands it meant two
answers to "what does a primary action look like here". It is now a green of the same family, each
step keeping the *role* and roughly the *lightness* of the blue it replaced, so no component needed
re-tuning.

Every role was measured, not matched by eye:

| Role | Ratio |
|---|---|
| Primary button — white on `--a-500` | 5.31:1 (blue was 5.17) |
| Button hover — white on `--a-600` | 7.00:1 |
| Link text on white | 7.00:1 |
| Link text on the `--n-25` zebra | 6.83:1 |
| Active nav — `--a-700` on `--a-50` | 9.01:1 |
| Stage title on the band | 8.72:1 |
| The count beside it | 5.54:1 |
| Sidebar row — `--n-800` on `--n-50` | 14.31:1 (was 4.9) |
| Sidebar group heading | 7.09:1 (was 2.7) |

The first stage band put **white** on the logo green, which measures 2.04:1 and is unreadable. The
fix was never to darken the green — it was to stop putting white on a light surface. Near-black on
it is 8.72:1, better than the dark-olive version with white it replaced. `--brand-600` exists for
exactly one reason: a filled button needs white, white needs 4.5:1, and `--brand-700` fails at
4.04:1. It is a contrast requirement wearing a scale's clothing.

`checks/chain.mjs` measures the band on every run and fails under 4.5:1 — confirmed by setting it
to the raw logo green and watching it report 2.04:1.

### Green is not the same green as "approved"

§7.1 #5 gives colour one meaning and `--ok-*` already means signed off. They do not collide:
`--ok-500` is a blue-green at **145°**, the accent is a yellow-green at **92°**, the mark at
**85°**. The accent never appears on a state badge, and the stage band is identical on every stage
whether it is run or not — which is what stops a green band reading as "complete".

### The screens

**Dashboard** (`src/components/home/dashboard.tsx`). Four sections in bordered panels, each with a
header strip carrying its title and count. The canvas is `--n-50` so white panels lift off it — a
white card with a hairline border on a white field is a border, not a card. Order is the QS's own:
where things stand · what needs doing · the jobs · how far through.

**Project setup** (`src/components/projects/new-project-dialog.tsx`). Three steps: what it is ·
where it is · what you have. `src/lib/onboarding.ts` derives the third step's checklist from the
same entry criteria the runs gate on, so a step cannot ask for something setup never mentioned.
Feasibility asks for twenty things, Procurement for two — the ask is sized to the answer. Three
clickable answers per requirement; attaching a file runs it through `inferKind`, which names the
folder or filename it matched on.

**Project overview** (`src/app/(app)/projects/[id]/page.tsx`). Grouped by stage, one panel each with
ready-over-total. Counts are scoped: a project engaged from valuations onward reads 0/16 and 0/7,
not 0/40 and 0/13. Out-of-scope steps are **set aside under a disclosure, never deleted** — stages
are entered once and get entered wrongly, and a sidebar that deleted rows would disagree with the
page beside it.

**Sidebar** (`src/components/shell/sidebar.tsx`). Groups fold and start folded — 22 rows down to 3.
The group holding the current page opens itself, *derived from the path, never stored*: a remembered
"open" set that had to be corrected on navigation would be a second source of truth and would
disagree the first time somebody arrived by URL. `nav-groups.ts` stores only deliberate exceptions.
Folding is declared per nav (`foldable`) rather than applied by count — the platform nav is seven
rows under one heading, where folding hides more than it saves.

**Advisor** (`src/components/project/advisor-panel.tsx`, `src/lib/agent/advisor.ts`). A right panel
on every project screen, closed to a tab until wanted. See the section below.

**⌘K** (`src/components/shell/command-palette.tsx`). Project switcher and global search.

### Four invariants a design pass must not break

Each is enforced by something that fails, not by a note.

1. **A dialog is modal, or it is not shown.** `dialog:not(:modal) { display: none }` in
   `globals.css`. `<dialog open>` without `showModal()` is a non-modal dialog in normal document
   flow — it was reported three times as "the modal is stuck on the projects page", and the tell
   every time was that nothing behind it was dimmed. It was chased twice in the component first: a
   render effect that never ran because the bad state arrives *without* a render, then a
   MutationObserver that does hold. Both are JavaScript, and every route into that state is a route
   where the JavaScript is what went wrong. The CSS needs none of it to be working. Both checks are
   in `checks/projects.mjs` and both were confirmed to go red.
2. **The advisor states no figure.** Enforced in `readAdvice`, not requested in the prompt. Four
   unit tests in `advisor.test.ts`, and `checks/advisor.mjs` asserts it on the path the panel
   actually renders — a guard on a function nothing calls is not a guard.
3. **Colour means one thing.** No new semantic hue. If a design pass wants a fifth colour, the
   question to answer first is what it *means*, and whether `--ok`, `--warn`, `--err` or the accent
   already means it.
4. **Nothing is declared that can be derived.** Stages come from L0's phases; the setup checklist
   from the entry criteria; the advisor's brief from the chain. Every one of those has a test
   asserting the derivation rather than the list, because the list changes and the derivation must
   not.

---

## The advisor — counsel on process, never on figures

A panel on the right of every project screen. `src/lib/agent/advisor.ts`,
`src/app/api/projects/[id]/advice/route.ts`, `src/components/project/advisor-panel.tsx`.

**The facts are computed; only the counsel is asked for.** Where a project stands is not a question
for a language model — the chain knows what is signed and what waits on an upstream, the criteria
know what is filed, the stages know what the job is engaged for. Asking a model to re-derive that
from prose risks getting wrong what the database answers exactly, which is §14's plausible-looking
version of a thing that already works. The route assembles the brief and hands the model that and
nothing else: no documents, no figures, no other project.

That is not only a privacy property. It is what makes the counsel and the screen agree — two
derivations of "where is this job" would disagree the first time somebody signed something, and a
panel confidently describing a position the page is not showing is worse than no panel.

What the model adds is what a database cannot hold: how a South African QS would ordinarily
proceed, in what order, and which standard governs it — ASAQS, JBCC, NEC, SANS, SACQSP, or `null`
rather than reaching for one.

**It may not state a figure.** Not a rate, not a total, not a percentage. Every figure in this
platform traces to a document and a signature; one that first appeared in the advisor traces to
nothing and would be read as though it did, wearing the platform's own voice. `readAdvice` drops
any action, position or caution containing a digit.

**An outage is a refusal, not a silence.** The brief comes back either way, with the provider's own
words beside it — a depleted balance and a malformed request send a reader to different places.

Verified live against DeepSeek: it named the two documents Project Inputs was short of, from that
project's own criteria, for **R 0.0004**. `checks/advisor.mjs` is the twenty-first suite and the
only one that spends money; CI's count is raised to match.

---

## The feasibility engine — ported, and what it now decides

Everything in this section and the five that follow post-dates the rest of this document. v3's
Python engine (`C:\Users\keena\Projects\construction-intelligence-platform`) is ported to
`src/domain/`, and the viability report is **complete: 12 of 12 sections**.

| Module | What it decides | Worth knowing |
|---|---|---|
| `affordability.ts` | The price ceiling every cost is tested against | Parity with v3 verified by running its Python. Deliberately diverges on v3's falsy-zero prime-rate bug. |
| `statutory.ts` | SARS transfer duty, NHBRC | **Two real discontinuities pinned, not fixed** — duty falls R1 at R3 109 500 and R667 at R11 000 000. v3 has both identically. |
| `cost-stack.ts` | B1–B7 | `constructionCarriesContingency` is asked, not assumed. Every line carries `signed / derived / assumption`. |
| `cashflow.ts` | Peak funding, IRR, NPV, sensitivity | NPV, IRR and the S-curve verified against v3's own output to ten decimals. |
| `gates.ts` | The six gates | 0–2 from cost, 3–5 from the cash flow. `overall` stays null until every gate is evaluated. |
| `risk.ts` | Section 10 | Derived from failed gates, tornado levers, unsigned figures, assumptions. **Composes nothing.** |
| `approvals.ts` | Section 4 | Critical path is a graph, not a sum — 19 months, not the 42 the lead times add to. |

### The findings it produces on Ridgeview

Worth knowing, because they are what a demo shows and none is obvious:

- **Gate 4 fails on a 42,4% margin.** The scheme is cheap to build and slow to sell: 1 046 units at
  144 a year is a 10,5-year sell-out, and NPV to equity is −R 24 224 386 at 14%. *A margin earned
  over a decade is not the same return as the same margin over three years* — a finding no cost plan
  can reach, which is why that gate's recommendation points at the programme, not the specification.
- **Phasing into three tranches** moves peak funding R574,8m → R346,9m and interest R159,1m →
  R60,1m. It clears gate 4 and **still fails gate 5** — necessary and not sufficient, and the
  platform says so rather than declaring victory.
- **Section 4 contradicts the platform's own assumption.** The statutory path is 19 months against
  the 6 the cash flow assumes, *"worth roughly R 7 202 009,47 of holding cost the model does not
  show."*

### Three things about the money that cost time

- **`formatRand` in `domain/money.ts` is the only money formatter.** `R -24 224 386,96` was written
  by hand in three separate files before it was written once there. The sign goes in front of the
  symbol.
- **Money is `bigint` minor units, but a discounted cash flow is not a ledger.** NPV and IRR are
  transcendental in the rate, so `cashflow.ts` converts to float cents, computes, and rounds **once**
  at the boundary. Cents keep it inside 2^53 on a R1bn scheme.
- **NBSP.** Money groups with U+00A0 (§7.7). An assertion typed with an ordinary space never matches
  and fails looking like a wrong figure. Use `\s` in test regexes — this was hit four times in one
  session.

---

## The agentic layer — four channels, and what each is trusted for

The advisor answers typed questions now. The design that makes that safe is worth reading before
touching it.

| Channel | What it is | Why it may show what it shows |
|---|---|---|
| **Answer** | The model's own words | States no figure. `HAS_FIGURE` in `advisor.ts` drops any sentence containing a digit — exported so `ask.ts` uses the *same* rule rather than a second copy. |
| **From the documents** | Passages, verbatim | Carries document and page. Retrieval is scoped to the project **in SQL**, never by prompt. |
| **Computed** | An engine run on demand | Every line names its method. |
| **What the firm requires** | A policy, verbatim | Carries name, scope, effective date. |

**The reader gets the figure; the model never said it.** That is not a loophole in the no-figures
rule — it is the rule working: a figure may reach a person when it arrives attached to the page it
was read from, and not when it arrives as an assertion.

- **Tools** (`agent/tools.ts`) — `gates`, `cost`, `affordability`, `cashflow`. The model picks one,
  the platform computes it, the model answers with it. **One call, not a loop**: none takes an
  argument, so a second could only be a different tool answering a question nobody asked. They run
  the same functions the report runs, so the advisor cannot contradict it.
- **No web search.** There is no key — only `DEEPSEEK_API_KEY`. When there is one it slots into
  `TOOLS` with one difference that matters: a figure off the web has provenance too, but it is a
  *source and a date*, not a signature, and it must be labelled that way everywhere it appears.
- **Onboarding** (`agent/onboarding.ts`) is a *separate* agent, on `/` and `/start`. The project
  advisor answers about one job out of that job's documents; somebody meeting the platform has
  neither, so every channel it relies on is empty. This one answers from `entry-criteria.ts` and
  **cannot compose a requirement** — it asks the platform for a step's needs and is handed them.

---

## Firm-wide surfaces — policies, contacts, settings

Three tables belonging to the practice rather than to a project, sharing one rule: **a project
search must not reach them, and they must not reach a project search.** That boundary is
structural — separate tables — not a nullable `project_id`, because every retrieval scopes with
`project_id = $1` and a nullable column turns each of those into an OR somebody eventually forgets.

- **Policies** (`/policies`) — the standards advice is given under. The advisor consults them before
  answering and shows the ones bearing on a question beside its answer. *"Guardrail" is used here in
  the honest sense*: the standards are put in front of the model and shown to the reader. The model
  is not trusted to enforce them — the reader is, and can see what they are enforcing against. A
  withdrawn policy is kept but never retrieved.
- **Contacts** (`/contacts`) — the directory. **It does not own the client name**: `projects.client`
  already records who a job is for, so the directory *finds* the projects that name a contact. The
  page opens with clients on a project but not on file — a gap nothing else would mention, because a
  job runs perfectly well without an entry.
- **Settings** (`/settings`) — **the ten assumptions the report calls "stated"**. They were
  hard-coded in `viability.ts` until this session, which meant a practice reading its own report was
  accepting somebody else's figures. Appended, never overwritten. Bounded, because a prime rate of
  1175% fails *nothing* downstream: it makes the ceiling near zero, every scheme fails Gate 1, and
  the report is confident and wrong.

`viabilityReport(signed, assumed)` and `projectScenario(signed, assumed)` take the set and **default
to the platform's figures**, so they stay pure and synchronous — every unit test and the PDF fixture
still call them without a database.

---

## The report — 12 of 12, and what the cover taught

The cover used to lead with *"10 of 12 sections established · 2 signed steps · latest signature"*:
three measures of how much of the document the platform had filled in, on the first page a client
opens to find out whether to build a thousand homes. It now leads with **units · construction cost ·
verdict**, then the finding in one sentence.

**That change found a bug on sight.** It printed "1 450 units — Go" on a 1 046-unit No-Go, because
test runs had been signed on the seeded project. The old cover could never have surfaced that. *A
cover that states the scheme is checkable; one that states the platform's confidence is not.*

- **Charts are in the PDF.** `writer.ts` could fill rectangles and nothing else, which is why nine
  sections carried one bar list. It has `curves` (a stroked polyline) and `tornado` (diverging bars
  about a centre line) now.
- **The contents page marks only exceptions.** Twelve rows reading "Established" was the platform
  reporting on itself.
- **On-screen charts use ApexCharts**, and the forms were **researched, not chosen**: the S-curve and
  the tornado are what the discipline uses. An earlier pass used a treemap, a funnel and a radial
  gauge — all legible, none of which appears in a cost report. Deleted.
- **The palette is one hue on a ramp**, measured with the dataviz validator: worst adjacent pair
  ΔE 10,9 protan, lightness strictly monotonic. Eight steps fell to ΔE 5,8 and was cut to six.
  §7.1 #5 rules out a categorical palette — amber already means "attention" here.

---

## Two whole-app failures, both from a client/server boundary

Both returned **500 on every page including login**, and neither was caught by typecheck:

1. A `"use server"` module may export **only async functions**. A synchronous predicate beside the
   actions broke the module at load. → moved to `lib/policies/effective-date.ts`.
2. A `"use client"` component imported a **constant** from a module that imports `db`, dragging the
   database client into the browser bundle. → moved to `lib/contact-kinds.ts`.

**If every page 500s right after touching a server module, look at what a client component imports
from it.** Typecheck will not tell you.

---

## Signed runs are frozen in Postgres, not only in code

`runs_frozen()` (migration 0008) refuses **any** update to a signed run — no exception for
`deleted_at`. A stray signature therefore cannot be withdrawn, and the platform's own remedy is the
one the sign-off copy states: *run the step again and sign the new figures.*

This matters because the seeded project is excluded from `clean-test-projects.mjs`, so it is the one
place stray signatures accumulate. `loadSignedFigures` takes the **latest** signature per step, so
one test run silently becomes the figure the report, the gates and the advisor all read.

**`node scripts/seed-test-project.mjs --recreate`** is the clean fix — localhost-only, deletes the
project and re-ingests the 15 fixture PDFs. Then run both steps and sign them, and note that **the
feasibility extractor refuses `units`**, correctly: the brief states *"Units permitted by zoning
1 143 · Units proposed 1 046"* and it will not guess between two candidates. Enter 1 046 by hand.
That is the human-in-the-loop design working, not a failure.

---

## Flaky checks: three fixed, all the same shape

Each waited on a **proxy** rather than the **outcome**, and each failed about one run in ten on a
working product:

| Suite | Waited for | Should have waited for |
|---|---|---|
| `login` | network idle | the refusal message |
| `project-admin` | a button vanishing, plus 800 ms | the project leaving the list |
| `projects` | `:modal` | the close button having a bounding box |

**A gate that fails at random teaches everyone to press the button again instead of reading it.** If
a suite goes red once and green on a rerun, fix the wait — do not rerun.

Related, and it caused a green gate to be reported that had actually failed: capture the exit code
**inside** the redirect — `{ npm run check; echo "GATE_EXIT=$?"; } > check.out 2>&1`. Chaining
`echo "EXIT=$?"` after the redirect reports the *echo's* status.

---

## What is deliberately not built

- **The downstream read.** `output` is frozen and readable, and nothing reads it yet: `feeds_from`,
  `feeds_into`, `startable`, `blocked_reason`, `upstream_ready` are §1.3.1's other half and arrive
  with the second module. Until then the chain has one link.
- **`carried_via`.** A figure taken from an upstream service rather than a document needs its own
  provenance column. There is no upstream service to take one from, and an always-null column
  implies a capability that does not exist — it lands with the read that can produce one.
- **Run history.** The panel shows the latest run and states any earlier signature; there is no
  screen listing every run of a step. `runs` keeps them all, so it is a view rather than a schema
  change when somebody wants it.
- **The rest of the QS lifecycle.** Thirteen modules are built, beside the project-wide Overview,
  Project Corpus, Project Data, Project Details and Pricing. Five remain in the nav, greyed and
  marked rather than linking to a page that does not exist: Documents & Drawings, Cash Flow,
  Take-off, Repetition Designer, Tender Room. Three of the five are the same pattern with a
  different field set; **Take-off is not** — it needs geometry (§10).
- **The Rate Library**, and with it §4.8's *apply a rate set*. A rate set is named, versioned and
  carries its own provenance (§6.3); the pricing screen applies a rate a person states instead, and
  `rate_source` already has `rate_set` and `library` in its check constraint for the day it lands.
- **`.xls` and `.ods`.** The 2007 format is read; the older binary one and OpenDocument are not, and
  the import window now says so with the fix attached — re-save as `.xlsx`.

### On the interface specifically

Said plainly because a design pass should start from what is missing rather than rediscover it.

- **No dark mode.** Every token is a light-mode value on `:root` and nothing reads
  `prefers-color-scheme`. Adding one is a token exercise, not a component one — but `--n-*` is used
  directly in about four hundred places, so it wants a plan before a find-and-replace.
- **Nothing below 1280px has been designed.** §7.3's target is 1440 and §14 requires 1280. Tables
  are `table-fixed` with percentage colgroups and the sidebar plus the advisor take 580px of
  chrome; at 1024 the project overview has not been looked at. No suite runs at a narrow viewport.
- **The module pages are the least worked screens.** The overview, dashboard, setup and advisor got
  this pass; `/feasibility`, `/bill`, `/pricing`, `/valuations` and the rest still read as the
  screens they grew into. The bill and pricing grid are §7.4 and deliberately dense; the field-set
  modules are not, and they look it.
- **A module page says nothing when it is off stage.** `withinStages` narrows the overview and
  marks the nav, but opening `/valuations` on a feasibility-only project renders it normally. The
  page should say it is outside the stages this project runs, and offer to widen them.
- **No empty state on a fresh project overview.** With no documents and nothing signed, the board
  is thirteen rows all reading "Waiting" — correct, and not what a first-time reader needs.
- **The advisor cannot be asked a question.** One button, one question, about the step the chain
  chose. That was deliberate — a text box implies it will answer "what should the rate be?" — but
  the shape of a follow-up that stays inside the no-figures rule is unexplored.
- **`--e-1` / `--e-2` are barely used.** §7.2 prefers borders to shadows and this build takes that
  literally; the KPI tile's hover is the only elevation on any screen.
- **No motion beyond colour transitions.** `--m-fast/base/slow` exist; nothing animates entry,
  exit, or the panels folding. The nav groups appear and disappear instantly.
- **Icons are lucide throughout** and `nav-icons.ts` asserts every nav href has one. Nothing else
  is asserted — a screen can still ship an icon that means nothing.

---

## Next, in order

1. **Excel / CSV import** is Tier 1 and "non-negotiable" (§12), and it is the one that now has the
   most built around it: a bill is the thing a QS wants to bring in, the paste path is already the
   small version of it, and `rate_source`, `quantity_source` and the `imported` value they both
   carry were put there for exactly this. §1.2 settles that WinQS is not an integration target —
   the importer maps *into* our structure and **says so where a source file carries something we do
   not model**, rather than distorting the schema to hold it.
2. **Take-off (D1.2)** is still the different problem, and still not next: it produces *dimensions*
   that feed quantities, and §10's measured finding is that a technical drawing carries its value in
   geometry nothing here reads yet. It is what closes the gap the bill leaves — every quantity on a
   bill drafted from a specification is currently a QS's to measure by hand.
3. **The Rate Library** is what turns §4.8's bulk application from a rate somebody states into
   §4.8's actual second sentence, *apply a rate set*. It is firm-level rather than per project
   (`PLATFORM_NAV`), it needs §6.3's provenance on every set — source, effective date, region,
   approval status, because "a rate nobody can defend does not get reused" — and it is a **route**,
   which is the twelfth-function problem. Worth costing that before starting it.
4. **Cash Flow (D1.7)** is the last field-set-shaped module and is deliberately not built: it shares
   D1.7 with Cost Report, and its process allocation is muddled — an S-curve is built from the cost
   plan and the programme, while D1.7's model says the area feeds from contract, valuations and
   variations. Worth resolving the allocation before declaring it, rather than shipping a board row
   that names three upstreams it does not use.

### And on the interface, in order

The engineering list above and this one are independent — neither blocks the other.

1. ~~**The module pages.**~~ **Done, 2026-09-02.** One shape, in `components/project/module-page.tsx`
   and `components/shell/panel.tsx`: where the step sits, what state it is in, what reads it when it
   is signed — all three derived rather than declared.
2. ~~**Off-stage and empty states.**~~ **Done, 2026-09-07.** The board's empty state turned out to
   be the half already built — it groups by stage, names the step to start with, and counts the
   set-aside separately. The half that was missing was the *module page*, which said nothing at all
   while the sidebar dimmed it, and the fact that the stages were settable only at creation while
   the overview carried a "Change" link to a form that had no such control. Both fixed together;
   see 2026-09-07 below.
3. ~~**1280 and below.**~~ **Settled.** `checks/viewport.mjs` holds §14's 1280 and asserts three
   failure modes at 1440/1280/1024 plus 1280-with-the-advisor: the page does not scroll sideways,
   every header fits its column, no control is clipped, and `<main>` is the only scroller. It found
   eight real failures when written, including a `CONFIDENCE` header needing 94px in an 88px column
   — the column was removed rather than abbreviated.
4. **Dark mode**, if it is wanted at all. A QS working from a site office in daylight may not want
   it, and it is the largest of these by some distance. Worth asking before starting.

> **Note, 2026-08-29.** Items 1 and 2 above are the interface backlog as it stands, and the
> engineering list is unchanged *except* that the Cash Flow module's arithmetic now exists —
> `domain/cashflow.ts` is ported and tested, so what is left there is the process-allocation
> question, not the model. See "The feasibility engine". The report, policies, contacts, settings
> and the agentic layer were built after this list was written and are not on it.

---

## Proposed: the row-shaped run — **built**

Kept as the record of what was proposed. What was actually built, and the three places building it
changed the proposal, is in "The row-shaped run — built" above.

**The problem.** `run_fields` is one row per *named field of a fixed set* — ten for the feasibility
estimate, thirteen for the cost plan. A bill is not that. It is N items discovered from the
documents, each with a description, a unit, a quantity, a rate and an amount; N is not known in
advance, there is no stable `field_id`, and the arithmetic is per row. Bending `run_fields` to hold
it — synthetic ids like `item.3.quantity` — would be the first dishonest thing in that schema.

**The proposal is a sibling table, not a new mechanism.** §1.3.1's four maps are still right; what
changes is that a row has five values rather than one.

### `run_items`

One row per bill item, hanging off the same `runs` row, with the same discipline:

| | |
|---|---|
| `proposed_*` | description, unit, quantity, rate — what the agent read. **Never edited**, same trigger as `run_fields` |
| `override_*` | the same four, where the QS corrected them |
| working | derived, human wins — one function, as now |
| `output_*` | frozen at sign-off, with `runs.signed_at` stamped last so the freeze is not in force while the outputs are being written |

Plus what a bill needs and a field set does not: `seq` (sparse — 100, 200, 300, so an insert does not
renumber the bill), `parent_id` for Section to Trade to Item, and `row_type` (`heading · item ·
subtotal · provisional_sum · prime_cost · note`), because §4.7 says those rows look different and a
heading carrying a quantity is a bug.

**Provenance is per row, not per cell.** A bill item comes from a passage — a spec clause, a priced
line in a source bill — and citing each of five cells to the same passage is duplication that makes
the screen unreadable. What *is* per cell is `quantity_source` (§6.3: `manual · takeoff · imported ·
ai_derived`), because "the agent read this quantity" and "a take-off sheet produced it" are different
claims about the same number.

### Where `extend()` finally gets its caller

`amount = round(quantity × rate)` — §5.2's **only** rounding point, and §6.4's second invariant.

- `quantity` `numeric(18,4)`, `rate` `bigint` with its own precision, `amount` `bigint` minor units,
  **stored** (§6.5 — read constantly, recomputed in a transaction on change).
- Enforced by a **trigger**, the way the freeze already is. A generated column cannot do
  half-away-from-zero rounding, and §5.2's requirement is that a QS adding the column by hand gets
  the same answer.
- Section and bill totals are **derived**, never stored (§6.5), and `sum()` adds already-rounded
  amounts. Nothing re-rounds a sum.

### Two things a field set never had to answer

**A QS will add a row the agent did not propose.** That is a row with no `proposed_*` at all — pure
override, `quantity_source = manual`. §1.3.3 requires it: manual entry never disappears, and a
hand-entered value is an override with a person as its source.

**A QS will strike a row the agent did propose.** That is **not** a delete. `proposed` is the record
of what the machine said, and deleting it loses the thing that makes the bill reviewable. An
`omitted_at` / `omitted_by` pair, rendered struck through — the same shape as withdraw-versus-delete
in the corpus.

### Sign-off, and what blocks it

Unchanged in shape: `output_*` written per row, the run stamped last, triggers refuse afterwards.
What changes is the gate — `blockingFields` becomes "no `item` row may have a null working quantity
or rate". Heading and note rows are exempt by construction, which is what `row_type` is for.

### The screen is §7.4, and §7.4 is not optional

`Item ref | Description | Unit | Qty | Rate | Amount`, and its mandatory list applies. Three of them
decide whether this is usable at all: **inline editing with no modal**, **full keyboard navigation**,
and **paste a multi-cell block from Excel** — §7.4 says it outright, *"if a QS can't paste a column
from Excel, they won't use the product"*. Virtualisation and 15 000 rows can wait for a bill that
size; those three cannot.

### Do BoQ first, and not take-off

They are not one slice:

- **Bill of Quantities** is the row-shaped run. Build this.
- **Pricing** is the same rows revisited with the rate column in play — mostly the same screen, and
  cheap once the bill exists.
- **Take-off** is a different problem. It produces *dimensions* that feed quantities, and §10's
  measured finding is that a technical drawing carries its value in geometry nothing here reads yet.

---

## The three tasks of 2026-08-17, and where each ended up

### 1. The row-shaped run — **built**

The two parts named as riskiest were the two that mattered, and both are proven by a run rather than
asserted: the rounding trigger is checked against `extend()` on every commit, and Excel paste drives
a real block through a real `ClipboardEvent`. See "The row-shaped run — built".

### 2. The dashboard, shaped like the Mzilikazi build — **built**

See "The dashboard — every tile traces, or says why it cannot" above. The brief below is what it
was built to, and the reference's shape survived: four KPI tiles, then a wide panel beside a narrow
one, then the working section.

`C:\Users\keena\Downloads\Mzilikazi-QS-Services\Mzilikazi-QS-Services` — read
`client/src/pages/Dashboard.tsx` and `client/src/components/KPICards.tsx`.

**Its `design-system.md` is the same design system as PLATFORM.md §7** — identical principles,
identical tokens. This is not a re-theme. What to take is the *shape*: four KPI cards (Total Project
Value · Cost per Unit · Cost per m² GFA · QA Flags), then progress beside recent activity, then the
working sections.

**Two things to fix rather than copy.** Its KPI cards use Tailwind's default palette —
`bg-blue-100`, `text-green-600` — rather than the tokens, and §7.1 #5 says colour means exactly one
thing. Four coloured icon chips is also at odds with §7.2's "quiet by default".

**The hard part is not the layout, it is where the numbers come from.** §14 lists demo-driven
development as a way this project fails, and `/home` is deliberately an empty page today for exactly
that reason. It is no longer empty by necessity: **every one of those KPIs is now computable from
signed figures.** Total project value is the cost plan's signed total; cost per unit divides it by
the unit count the feasibility estimate signed; cost per m² by the average unit area. `amount.ts`
reads them and refuses what it cannot read, so a tile is either a figure or a stated absence — never
a plausible number.

So the rule for this screen: **every tile traces.** Click it and reach the signed run it came from.
A KPI nobody can trace is precisely the untraceable figure §1.3.1 calls worse than a gap. "QA flags"
maps onto something real too — reconciliation differences, steps waiting on an unsigned upstream,
required fields still empty.

### 3. WinQS — a correction worth reading before starting

The ask was "make sure the features of WinQS are integrated". **PLATFORM.md §1.2 says the opposite**,
and §17.2 restates it as settled: *"They are not integration targets and not systems to stay
compatible with… Excel import matters for migration and trust (§12) — that is a different thing from
staying WinQS-shaped."*

Two honest readings, leading to different work:

- **Feature parity** — match the capability surface. §11 catalogues it, and §8's parked list records
  the six capabilities deliberately not built in v1 with a reason each. That list already *is* the
  answer to "what does WinQS have that we do not", as decisions rather than oversights.
- **Data exchange** — and here there is a real gap. **Excel/CSV import and export is Tier 1,
  "non-negotiable", and is not built.** §12: *"A QS with 20 years of bills will not adopt a product
  that can't ingest them."* It lands naturally with the bill, because a bill is the thing they want
  to bring in.

Worth settling which was meant before building either. If it is the second, the importer maps *into*
our structure and says so where a source file carries something we do not model, rather than
distorting the schema to hold it.

## Open, and known

**Dependabot #1 (esbuild, moderate) is dismissed as `not_used` — triaged 2026-08-13.** Re-open it
if drizzle-kit's dependencies change.

GHSA-67mh-4wv8-2f99 is about esbuild's *development server* (`esbuild serve`) setting
`Access-Control-Allow-Origin: *`, so any site can read from it. Nothing here runs `esbuild serve`.

The vulnerable copy is `esbuild@0.18.20`, pinned inside `@esbuild-kit/core-utils`, reached only
through `drizzle-kit → @esbuild-kit/esm-loader`. **That dependency is vestigial**: grepping the
whole `drizzle-kit` package finds `esbuild-kit` in its own `package.json` and in no source file.
drizzle-kit transpiles `drizzle.config.ts` with its own `esbuild ^0.25.4` — already patched — and
`tsx`. It is a devDependency and is not in the deployed bundle.

There is nothing to upgrade to: `0.31.10` **is** the latest drizzle-kit, and it still declares
`@esbuild-kit/esm-loader`, which upstream deprecated as *"merged into tsx"*. `npm audit fix --force`
proposes `drizzle-kit@0.18.1` — thirteen minor versions back, breaking the migration tooling, to
patch a code path that never executes. An npm nested override of `@esbuild-kit/core-utils > esbuild`
was tried and npm does not apply it for this path.

**`vercel env pull` rewrites `.env.local` with every value quoted**, and it runs as a side effect of
connecting a store. The application is unaffected — dotenv strips them — but anything parsing that
file by hand gets `"qs@example.com"` with the quotes attached. Every browser suite carried its own
`indexOf("=")` parser, so all twelve began failing at once: a quoted address typed into `<input
type="email">` fails the browser's own validation, the form silently refuses to submit, and no
request is made. No error, no failed assertion, just a navigation that never happens. There is one
`readEnv()` in `checks/helpers.mjs` now. **Anything that breaks every suite at once, right after
something touched the environment, is usually not a code bug.**

## Loose ends

- **The settings suite appends an assumption row on every gate run.** `checks/settings.mjs` sets
  instalment-to-income to 25% and back to 30%, and the table is append-only by design, so a
  hundred gate runs leaves two hundred rows. Harmless — the query takes the newest effective row —
  but the settings history will be mostly test noise. It is *not* worth a cleaner:
  `clean-test-projects.mjs` scopes to projects, assumptions are firm-wide, and nothing can tell a
  test row from a real one. Read the current value, ignore the history, or clear the table by hand
  on a machine that has been running the gate for months.

- **`isDefault` on the settings page reads false for anything a check has touched.** Same cause. It
  says "Set by qs@mzilikazi.co.za" rather than "Not set by the practice" for instalment-to-income,
  which is accurate — somebody did set it — but it is a check, not a decision.

- **The date-serial path in `xlsx.ts` is unexercised by real data.** Not one of the six real
  workbooks read during that work has a date-formatted number in it — the two that show dates store
  them as inline text. So it is checked against Excel's own documented serials (1, 60, 61, 25569,
  45292, the 1904 epoch) rather than against a file. It stays because the failure it prevents is
  silent: a date cell holds a day count, and `45292` written into a column of quantities is
  indistinguishable from one.
- **A mid-sheet passage loses its header row.** A sheet is split into 1 200-character passages, so
  `A7=50mm | B7=864 | C7=405552` may land in a passage whose `A6=Pipe | B6=Length | C6=Cost` is in
  the previous one. Every line still names its sheet and cell; what it can lose is the column
  meaning. The fix is repeating a table's header at the head of each passage, which `split.ts` knows
  nothing about yet.
- **A workbook that files is not a workbook that is found.** The reference estimate reads
  perfectly and still would not satisfy *Services layout and bulk contributions*, because that
  criterion searches for the phrase "bulk infrastructure cost estimate" and the workbook's own words
  are "FEASIBILITY COSTS FOR PRIMARY BULK AND LINK CIVIL INFRASTRUCTURE". That is the retrieval-terms
  problem already recorded above, now visible on a new document type rather than a new bug.
- **Skipped hidden cells are not reported anywhere.** They are left out of the corpus for good
  reason, and nothing tells the reader it happened. `ParsedDocument.warning` means "nothing could be
  read" and setting it would stop the document being indexed at all, so this needs a second
  channel — a note that survives to the import window and the document row. Worth having: it is the
  same shape as every other thing this platform says out loud rather than deciding quietly.
- **`fixtures/` still holds real client data.** The README no longer claims otherwise — it now says
  file by file which are real (`brief.txt`, `costplan.txt`, `title-deed.pdf` — Monaghan Farm, Clever
  Development Trust, Erf 180, 1 046 units) and which are invented. The repo is private so nothing is
  exposed; **anonymising the three properly is still the outstanding job**, and until it is done this
  directory is a reason the repo cannot be made public.
- **`typologies.txt` is a different scheme** — Anytown, 896 units — so it must never be filed beside
  `brief.txt` in a run whose answers are asserted. `layouts.txt` was added for that reason: the real
  corpus here has nothing that satisfies *Concept layouts*, and without it the feasibility step
  cannot legitimately start.
- **A drawing satisfies a criterion but still tells a run nothing.** `layouts.txt` files as Concept
  drawings, which is spatial, so its "density of 55 units per hectare" is excluded from extraction —
  and the live run duly reports *Permitted use and density* as not in the corpus while the sentence
  sits in a filed document. That is the design working as specified (a drawing is measured, not
  read) and it is also a gap a reader will notice. It closes when take-off lands.
- **A correction overwrites the previous correction.** `override_*` holds one value with one name
  and one time, so the *current* figure is always attributed but a sequence of corrections leaves
  only the last. §6.3's `AuditEvent` — append-only, polymorphic, never updated — is the right home
  for the rest and does not exist yet. `proposed` is safe either way: it is never written twice.
- **A second tab does not update itself.** A run in progress renders what has been written with a
  **Check again** button beside it, rather than polling. That is honest and it is not live. Polling
  would be a timer per open tab; the RSC refresh it would call is already there, so this is a
  decision about noise rather than a missing mechanism.
- **`costplan.txt` does not support the field set it is read with.** It is twelve lines of real
  Monaghan Farm prose giving *rates* — `R1 850,00 per cubic metre` — and one bill total, so a live
  cost plan run reads the total and the estimate class and reports the eight elements as absent.
  That is the agent behaving correctly on a thin document, and it means the live suite proves the
  carry and the total rather than the elemental read. It is a real client document, so the fix is a
  fuller real cost plan, never additions invented into this one.
- **A cost plan cannot be signed off the demo corpus without three corrections.** Substructure,
  superstructure and preliminaries are required — an elemental plan without them is not one — and
  `costplan.txt` states none of them. That is the designed flow rather than a defect: the gate names
  them and the QS fills them in. Worth knowing before demonstrating it cold.
- **A criterion is grounded by a phrase anywhere in the corpus, whatever kind the document is.**
  That looseness is deliberate — §1.3.3 wants different documents able to satisfy one input, and
  `brief.txt` legitimately satisfies *Market data* while filed as a project brief. What it lacks is
  a relevance floor: a single passing mention counts as much as a document about the subject. The
  cost-plan terms were narrowed rather than tuning `passage.rank`, because a threshold is a number
  that wants measuring against a real corpus before it is chosen.
- **`in-date` is not deterministic, which is worth knowing before reading a red live suite.** Two
  runs an hour apart, same corpus, same code: the first reported *"the passages that cover this do
  not state a figure for it"* and the second read **3 February 2027** correctly. The instruction says
  *"Issued by Malinga Le Roux Architects, principal agent, on 3 February 2027"* — one sentence
  carrying both the issuer and the date — so retrieval reaches it either way and what varies is the
  model. `temperature: 0` reduces this and does not remove it. Nothing was tuned to make it pass, for
  the reason recorded against `vl-number`: a term added to make one fixture pass is the fixture
  bending to the platform. **A single red field on a live run is not yet a regression — run it
  again.**
- **`checks/run-live.mjs` had an assertion that could not have passed since the run panel became a
  table.** It looked for the words *"carried from the signed feasibility estimate"*, and a carried
  row has read **"approved in Feasibility Estimate"** since that rework. Nothing caught it because
  this suite spends credits and is run deliberately — a stale assertion in a paid suite sits red, or
  unread, for weeks. Corrected, and asserted against `navigation.ts`'s label rather than a literal.
- **`vl-number` is a recorded miss.** The payment certificate states "interim payment certificate
  number 07" in a sentence of its own, retrieval reaches the document, and the model answers *"the
  passages that cover this do not state a figure for it"* — while reading the period end and four
  amounts off the same document correctly. Nudging retrieval to prefer the step's own documents was
  tried and **reverted**: it did not fix this and it destabilised two fields that had been steady.
  The value is printed on every live run so the miss stays visible, and it is not asserted, because
  an assertion written to pass would be the fixture bending to the platform.
- **DeepSeek was returning a trivial 20-token call in 31.6 seconds** for about half an hour on
  2026-08-14, which aborts a run at the 45s per-call ceiling. The platform handled it correctly —
  surfaced the provider's words, closed the run `failed`, kept the fields already read — and
  `checks/run-live.mjs` now stops with that explanation instead of crashing on the next assertion.
  Worth knowing before assuming a red live suite is a code change.
- **A React warning is a `console.error`, not an exception**, so `pageerror` never saw one and the
  whole class of "renders but is wrong" went past seventeen green suites. A reader found the first:
  the overview keyed its downstream links on `link.module`, and a neighbour that is a process area
  with no module has `module: undefined`, so the Cost Plan's two such links collided.
  `watchConsole()` now collects the warnings that are always a defect — key collisions, hydration
  mismatches, invalid DOM nesting — and `checks/signoff.mjs` fails on them. Verified by putting the bug
  back and watching it go red.
- **Old Vercel deployments accumulate.** Each deploy mints a permanent URL that Vercel never
  garbage-collects. `vercel remove <project> --safe --yes` keeps anything aliased and drops the rest.
- **`archive/first-attempt`** holds the scrapped first build. Do not merge it — it carries seed data
  that was deliberately deleted. It is kept because the money layer came from it.
- **Browser suites leave projects behind.** Each run creates one, and a database with 300 documents
  in it makes every screen unreadable while you are trying to judge one. `node
  scripts/clean-test-projects.mjs` removes them and their stored files. Run it after a `check`.

---

## 2026-09-01/02 — the bill, the chain, accounts, and the move to Pro

**Everything here post-dates every other section except "2026-09-02", which follows it.** Nine
commits, `a3c0f83..e4be318`, all on `home-ux` and all pushed. Production is live and current.

### The bill's sign-off gate is a way through, not a report

Every cell in the grid had always been an `<input>` — transparent border, transparent ground, so a
dense bill does not render as four hundred boxes. That trade costs nothing on a filled cell and
everything on an empty one: "measure" and "price" in grey read as a *status the platform is
reporting*, not a field being handed over, and a QS looking at a drafted bill could not tell the
cells were editable at all. Said in as many words by the person it happened to.

- An empty quantity or rate now draws itself as an amber box, and only while empty. Measured on the
  white grid: border 3,55:1, placeholder 5,16:1, a typed value 10,35:1.
- The gate lists each blocked row with **"Enter a quantity" / "Enter a rate"**, which unfolds the
  section if folded, scrolls to the row and puts the caret in the named column. It is a
  `bill:reveal` **event the grid listens for**, not a `querySelector` from the panel: a row inside a
  folded section is not in the DOM and only the grid can unfold it.
- The greyed button answers for itself in its `title`. The panel above it said why and was not read.
- The gate's last line branches on whether a priced source is on file. "File the priced source" is
  right with no cost plan and misleading with one — the first version said the first thing on a
  project in the second state.

### A signature is a version, not a door

`reviseBill` opens a new draft **from the signature rather than from the corpus**. The freeze stays
— `runs_frozen()` is a Postgres trigger and a signed bill is an issued instrument — but the only way
onward used to be "Draft again", which re-reads the documents and re-proposes every row, so a QS who
had measured four hundred cells measured them again. That was never integrity, only a missing
feature: a signed bill that changes is Revision B in every practice that has issued one.

The signed row's `output_*` becomes the revision's `proposed_*`. Three things travel so §1.3.1 still
holds: the **citation**, `quantity_source` / `rate_source` (a figure a person measured is not
re-stamped as the agent's), and a note naming the bill and signer it came from. Struck rows do not
travel. `parent_id` is remapped as rows are copied — carrying it verbatim makes every item a child
of a row in the *signed* bill, a foreign key that resolves, which is what would make it dangerous.

### The chain has a row-shaped carry, and the bill feeds D1.3

Every dependency was `FieldSpec.carriedFrom` — one named figure from an upstream run. A bill has no
named figures, it has rows, so **the platform's most consequential output could not be declared as
an input to anything**: Tender Analysis was startable on a project with no bill at all.
`RUN_MODULES` was the field sets alone, so `feedsInto("/bill")` searched a list its only reader
could never be in.

`ROW_CARRIES` in `lib/agent/bill.ts` is the missing shape. `chain.ts` reads it exactly as it reads a
field carry, so the gate, both chain directions and the menu keep falling out of one declaration. A
row carry **always** gates: tender documentation *is* the bill, sent out to be priced.

`CarriedSchedule` renders it — the whole signed bill, read-only, item count and frozen total, naming
the signature. Read-only because editing the schedule a tender rests on means revising the bill. It
reads through `loadSignedBill`, whose `signed_at is not null` sits in the where clause, so a
revision in progress cannot leak into a tender. The suite proves that: the schedule shows the frozen
figures *while an unsigned revision of the same bill exists*.

### Tender comparison — D1.3's second sub-process

`/tender-analysis` could record what a tender came to: eight fields read out of an adjudication
report somebody else wrote. That is a summary of a comparison and it cannot answer the question a QS
is paid for — **whether the number on the form is the number the rates produce**.

`tender_returns` + `tender_prices` (migration `0016`). A return holds **rates only**, keyed to the
bill rows they were quoted against. Not another `runs` row: a run is one module's output with one
signature and `loadLatestBill` takes the newest, so five tenderers would be five bills competing to
be *the* bill. `bill_run_id` records the issue of the bill the tender was invited on, so revising
does not silently re-base every price in the adjudication.

`tender_prices_extend` is a **third** statement of §5.2's single rounding point, against the
quantity the signature froze — never a working value. Checked against `extend()` on the same table
of values the bill's trigger is checked on: exact halves, negatives, six-place rates.

Two judgements, both chosen and both tested:

- **lowest is by extended total, not stated** — ranking on a figure whose arithmetic has not been
  checked is the mistake the arithmetic column exists to prevent;
- **an incomplete tender is never crowned** — a tenderer who priced two of nineteen items is always
  cheapest and never cheapest.

### The BPMN model finally has a page

`/process` renders L0 phases, L1 domains, L2 areas with their L3 sub-processes, and the
`feedsFrom`/`feedsInto` edges the gate is built on. It was the sidebar once, in this platform and v3
before it, and both removed it on measurement; the removal named where it belonged — *"a page
question, not a chrome question"* — and then nobody built the page, so `process-model.ts` was
correct research that no screen rendered.

Corrections made while building it: the model holds **19 areas, 12 with a page**, not the
"fifty-two" quoted in the removal commit and elsewhere in this file (that was v3's fuller corpus);
D1.2's third sub-process is **Preambles & Preliminaries**, not "Pricing", which the L2 source puts
*out* of scope; and two domains (D4 Engineering, D5 Construction Management) carry no areas and are
shown as gaps rather than filtered out, which the first draft did.

### Accounts — people sign in as themselves

Sign-in compared against `DEV_USER_EMAIL` / `DEV_USER_PASSWORD` and nothing else. Honest while one
person used it; a defect the moment a second does, because every signature names a signer and one
shared credential makes them all name the same person.

`users` (migration `0017`), **Settings › People** — not a page of its own, because every route is a
serverless function. scrypt with a per-row salt, each hash carrying its own cost parameters
(`scrypt$N$r$p$salt$hash`) so the cost can be raised later. The rule is **length alone**: a
capital-digit-symbol rule produces the same weak password on every system that asks for one, while
rejecting a stronger passphrase.

Removing access is **soft** — the row is what every signature points at. The **environment
credential stays and is listed in the table**: production has no shell, so it is the way back in,
and a break-glass credential nobody can see is the dangerous kind. A row's password beats it.

`lib/people.ts` holds the shape and rules with **no `db` import**, because a client component that
reaches into a module importing `db` returns 500 for the whole app — that has now happened three
times and typecheck catches none of them.

### The lockfile, and two guards that exist because reading found the bug

**CI had been red at `npm ci` for days** and nobody read it: the failure looked like a hundred
missing packages rather than "written on the wrong operating system". It never reached the step that
counts functions, so nobody could see whether a deploy still fit. npm resolves optional
platform-specific packages for the machine it runs on and prunes the rest; this repo is developed on
Windows and built on Linux.

Two wrong fixes before the right one, both worth knowing: `--package-lock-only` **prunes**, and
generating on **Node 24** produces a file Node 22 refuses. The fix is a full install on the version
CI runs — `docker run --rm -v "$PWD:/w" -w /w node:22-slim npm install --ignore-scripts`.

`scripts/check-lockfile.mjs` is the detector, in CI *before* `npm ci` and in `.githooks/pre-commit`.

`readEnv()` in `checks/helpers.mjs` now **refuses to run any browser suite against a non-local
database**. `vercel link` and `vercel integration add neon` each rewrote `.env.local` and pointed
`DATABASE_URL` at production; the suites create and delete projects wholesale. A migration was run
with that pointer in place and failed on an unrelated wrong password — luck, not a control.

### The move to Pro, and what it changed

The app builds **23 serverless functions**. Hobby allows 12 — and a thirteenth does not fail the
build, it deploys and production carries on serving the previous version. The old scope
`x4o-projects` was also carrying an **overdue balance**, the likelier reason production sat 16 days
stale.

Now on **`raymond-3084s-projects`** (Pro): project `qs-management-platform`, database
**`qs-platform-db`** (Neon), blob store `qs-platform-documents` (private). `CAP` in
`count-functions.mjs` reads `FUNCTION_CAP` and still defaults to 12, because assuming headroom is
how the wall gets met again.

**GitHub is deliberately disconnected.** It was connected on the new project and immediately
produced a *production* deployment from `home-ux`, which also explains the "Blocked" status: Vercel
refuses a git-triggered deploy when the commit author is not on the account. `deploy.mjs` parks
`.git` to get past that. Disconnecting restores the property the workflow rests on — pushing to
GitHub deploys nothing; only `npm run deploy` ships. `vercel git connect` puts it back.

`.env.production.local` was **removed from the working directory**: it held the *old* project's Neon
credentials, and `vercel build` reads it ahead of `.env.local`, so building here would have migrated
the database of the account we had just left.

### Verified

25/25 browser suites, 775 unit tests, typecheck, lint, `check-modules`, `check-lockfile` — all
green. Production health: `{"status":"ok","database":"reachable","agent":"configured"}`. 18
migrations committed against the new Neon, landed by a **preview deploy first**, verified, then
promoted.

## 2026-09-07 (later) — what the cost data needs to make sense, and an audit

Research and an audit, no code. Read this before touching the rate library or the factor table:
the two of them are the platform's weakest half, and the reasons are structural rather than a
matter of filling them in.

### The finding that matters most: the trades are invented

`TRADES` in `lib/rates.ts` lists twelve — Preliminaries, Earthworks, Concrete Work, Masonry,
Structural Steel, Roofing, Carpentry & Joinery, Finishes, Plumbing & Drainage, Electrical,
Mechanical, External Works. They are plausible and they are **not the standard**.

The ASAQS *Model Preambles for Trades* define nineteen lettered sections, and every South African
bill of quantities is organised by them:

> C Earthworks · D Concrete, Formwork and Reinforcement · E Precast Concrete · F Masonry ·
> G Waterproofing · H Roof Coverings · I Carpentry and Joinery · J Ceilings, Partitions and Access
> Flooring · K Floor Coverings, Wall Linings · L Ironmongery · M Structural Steelwork · N Metalwork ·
> O Plastering · P Tiling · Q Plumbing and Drainage · R Glazing · S Paintwork · T Paperhanging ·
> U External Works

**"Finishes" alone collapses six of them** — J, K, O, P, S and T. Eleven standard trades have no
home in the platform at all, and two of ours (Electrical, Mechanical) are not building trades in
that system; they are services, ordinarily let as subcontracts.

Three consequences, in the order a user meets them:

1. A QS filing a rate cannot find the trade they would look for, so they pick the nearest and the
   library's classification stops meaning anything.
2. A supplier schedule or a priced bill organised by ASAQS section — which is *all of them* — does
   not map on import, and `rate-import.ts` has nothing to map it to.
3. The trade filter on the library cannot answer the question a QS actually asks, which is "what do
   we hold for masonry", because masonry in their head is section F and in the platform it is a
   word somebody typed.

This is the single change that would do most for the rate library making sense, and it is small:
`TRADES` becomes the nineteen with their letters, with a migration mapping existing rows.

### Units are free text, matched by exact string, and fail silently

`priceResources` and `matchRates` compare `rate.unit.trim().toLowerCase()` against the component's.
Nothing normalises the form. **Measured, not assumed** — a throwaway test against the real function:

| Component asks for | Library holds | Matches |
|---|---|---|
| `m2` | `m2` | yes |
| `m2` | `m²` | **no** |
| `no` | `No.` | **no** |
| `hour` | `hr` | **no** |

Every one of `m²`, `No.` and `hr` is ordinary in a real supplier spreadsheet. The failure is silent
and, worse, *misreported*: the take-off says "no rate in the library prices this", which a reader
takes to mean the practice does not hold the rate — not that two spellings of one unit failed to
meet. A QS would go and file a rate they already have.

`take-off.ts` already has `normaliseUnit` (it strips full stops and spaces for the countable check)
and `rate-match.ts` does not use it. The fix is one shared normaliser handling the superscript
forms, the abbreviations and the punctuation, applied at both ends — and a canonical unit list
offered in the entry forms so the library stops accumulating variants in the first place.

### There is no way to fill the factor table

Rates have `rate-import.ts`, which reads a spreadsheet and was written because a practice will not
type a rate schedule. Factors have **only the one-at-a-time form**. A firm with two hundred
constants will not enter them, so the table will stay empty and the take-off will go on proposing
every line — which works, and is not what it was built for.

`rate-import.ts` is the shape to copy.

### Nothing connects the three descriptions

A bill item description, a rate library description and a factor's `work` are three free-text
strings related only by word-similarity scoring. A practice that phrases the same work three ways
gets three misses and no explanation. There is no shared vocabulary and no place to define one.

Worth thinking about before adding more matching cleverness: the ASAQS sections give a spine that
all three could hang from, which is another reason the trades matter.

### What the published constants actually say, and what that tells us

Researched to see whether the model's proposals are sane. They are, at the optimistic end:

- **Bricks per m²**: about 50–55 maxi bricks in a half-brick wall, roughly double in a one-brick
  wall. The model proposed **104** for one-brick, which is inside the published range.
- **Bricklayer output**: 350–500 bricks a day solo, 500–1 000 with an assistant. That is
  **1,96 hours per m²** of one-brick wall against **1,11** — a factor of two, and *both correct*,
  depending on whether there is an assistant in the gang.

  The model proposes **1,2 h/m²** and separately proposes a bricklayer's assistant, so it is
  answering the assisted case and its figure sits inside that band. An earlier draft of this
  section called it "at or past the top of the band"; that compared it against the *solo* range
  and was wrong. **The problem with the model's factors was never bias — it is that they move
  between asks** (0,10 then 0,15 for the mixer), and instability is what a practice's own figure
  fixes.
- **Mortar**: 1:4 to 1:5 cement to building sand is the SA standard mix.

So the honest position on the model's factors is not "wrong", it is **optimistic and unstable** —
which is what the `proposed, not the practice's own — check it` label already says, and why the
factor table is the right answer rather than better prompting.

### A published factor set — **built**, and two faults it uncovered

Settled and shipped rather than left as a proposal. The permission question was not a judgement
call in the end: **`DEFAULT_ASSUMPTIONS` is the precedent**, and its own note gives the reasoning —
*a defensible default is better than an empty field, provided it is visibly the platform's rather
than invisibly everybody's*. It ships eleven financial figures that decide whether a scheme passes
a gate. And §1.3's words are "*a project's* data exists because a run produced it": project data,
which must reach a document and a signature. A firm-level reference figure is a different category
and the platform already treats it as one.

The safeguard is that published factors live in **code**, never in `resource_factors`. A seeded row
would be editable, withdrawable, and indistinguishable in a year from one somebody vouched for.
This way the origin is structural: a factor is the practice's if and only if it is a row in the
table. Three origins now, in descending authority — the practice's, the platform's published, the
model's proposal — and every take-off line says which.

**Only two figures are published**: 51,9 bricks/m² half-brick and 103,9 one-brick, both derivable
from a 222 × 106 × 73 brick with 10 mm joints, and the tests re-derive them rather than restating
them. No labour and no plant, because the published band is a factor of two wide.

Building it surfaced two real faults, both found by **running** it:

- **Double counting on a name mismatch.** The model proposes "Stock bricks", a factor says "Stock
  brick", the override did not fire on an exact string, both survived, and the wall was given its
  bricks twice — with the total counting both. `resourceKey` in `factors.ts` now folds case,
  punctuation and a conservative trailing plural. A double-counted order is worse than a missing
  one, because nothing about it looks wrong.
- **Mortar was published and then withdrawn.** The volume was right (0,0435 m³/m² one-brick, the
  wall less the bricks) and it still double-counted, because the model decomposes mortar into
  cement and sand while a published "Mortar" line is the aggregate. Neither overrides the other.
  **The general rule is worth more than the two rows: a partial factor set and a proposed method
  are two decompositions of one piece of work, and merging them by name is only safe where the
  granularity agrees.** Anything added to the published set must be checked against what the method
  actually returns.

A **NUL byte** also got into `factors.ts` from a shell heredoc and made git treat the file as
binary — the third time this class of bug has appeared here. `git grep` reporting "Binary file …
matches" is the tell.

### The reasoning, kept — why a published set was allowable at all

§1.3 forbids seed data that a user could mistake for their own, and that rule should not bend. But
there is a legitimate third category between "the practice's" and "the model proposed it": a
**published** constant, from ASAQS or a textbook, attributed to its source and dated.

The take-off already distinguishes two origins on every line. Making it three costs almost nothing
and would give a new practice a usable library on day one that no one could mistake for their own
figures. `resource_factors.source` is already a required free-text column, so the data model needs
no change — only a flag or a reserved source vocabulary, and a third label.

---

## The audit

Measured on `26e5c17`. The findings above are unchanged by the factor work that followed; only
the counts moved.

### Shape

| | |
|---|---|
| Migrations | 22 |
| Browser suites | 31 written, **26 in `npm run check`** |
| Unit test files | 50 (979 tests) |
| Source modules | 193 |
| Serverless functions | 23, no cap on Pro |
| Nav items still `built: false` | 7 |

The **five** unrun suites (`large`, `production`, `run-live`, `direct-upload`, `shot`) are
deliberate — they cost money, need a deployed target, or are diagnostic. Worth knowing they exist
rather than discovering them. (An earlier draft of this line said four and then listed five;
31 written less 26 gated is five.)

### What is not built, and why it is not a defect

`/approvals`, `/benchmarks`, `/documents` (D3.1), `/cash-flow` (D1.7), `/take-off` (D1.2),
`/repetition` (D1.2), `/tender` (D1.3). Each is marked in the nav and each is reachable as a dimmed
row, so nothing pretends otherwise. **Cash Flow** and **Take-off** are the two with recorded design
questions rather than merely absent code — see "Next, in order".

### Gaps worth naming

- **`domain/risk.ts` has no unit test.** Three exports, and `report/viability.ts` imports
  `riskRegister` — so it reaches a document a client reads. Every other `domain/` module is tested
  against hand-worked examples; this one is not, and it is the one that prints.
- **Unit matching**, above. The most likely thing to make a user distrust the pricing.
- **`--n-500` on `--n-50` is 4,45:1** against §7.8's 4,5. Recent branches use `--n-600`; the
  app-wide sweep has never been done. Known, recorded, still outstanding.
- **Forty-odd `lib/` modules have no unit test file.** Most are covered by browser suites and that
  is fine — the list is not a to-do. It is worth a pass to find the ones that are *neither*, which
  is how `risk.ts` was found.

### The dependabot advisory, assessed rather than repeated

`@xmldom/xmldom` 0.8.14, **medium**: XML fragment injection via an invalid `EntityReference.nodeName`
during `requireWellFormed` serialization.

It arrives transitively through `mammoth` (the `.docx` reader) and nothing else. The flaw is in
**serialization**; mammoth parses and this codebase never serializes XML — no `XMLSerializer`, no
`DOMParser`, no direct `xmldom` import anywhere in `src/`.

Assessment: **very likely unreachable**, and not worth a risky bump of the document reader on a
platform whose corpus ingestion is load-bearing. Recorded here so the next session neither panics at
the badge nor upgrades `mammoth` without a reason. Re-check if anything ever writes XML.

## 2026-09-07 — the register, the engagement, and a take-off whose numbers are the practice’s

**This section post-dates every other one.** Ten commits on **`home-ux`**, pushed. Production runs
`08ba8d4` — the first seven — with migrations `0020` and `0021` applied. The three after it are
**not deployed**: `ba5e295` and `a903051` are documentation, and `26e5c17` is the published factor
set, which needs no migration.

**Production answers on two aliases**, both following every `--prod` deploy and both pointing at the
same deployment: `qs-management-platform-lilac.vercel.app` — the short one, and the one to hand
somebody — and `qs-management-platform-raymond-3084s-projects.vercel.app`, which is what
`deploy.mjs` probes because it carries the team slug and therefore moves if the project does.
`vercel alias ls` is how to check they still agree.

**How that deploy went, because the method is worth repeating.** Migration `0020` had never run
against production, so it went out as a **preview first** — the schema lands on the shared Neon
database while production carries on serving the code it already has — then promoted once the
preview came back healthy. The proof the migration ran is that the build succeeded at all:
`build` is `node scripts/migrate.mjs && next build`, chained, so a failed migration fails the build.

**And how it was verified**, which matters because the obvious check is worthless here. `vercel curl`
on a single path proves nothing — earlier in this session every path returned the same page and a
"pass" was very nearly reported off it. What discriminates is a **control**: `/reports` resolves to
the `(app)/reports` route and redirects to login, while a nonsense path returns a real `_not-found`
404. `/reports` did not exist before the deploy, so that pair is the proof the new code is live.

### Reports — generated and issued are different acts

A report is generated **live** from signed figures, and that stays: a live document cannot
contradict the figures, because it is derived from them at the moment it is asked for. But it
answers the wrong question a year later. *"What does this project come to"* is live. *"What did we
send the client in March"* is not, and re-generating cannot answer it — the figures have moved.

So `issued_documents` (migration `0020`) keeps the bytes as sent, who sent them, when, and
**which signed runs they were generated from**. That last column is why the table is not a file
cabinet: each of those runs is frozen by `runs_frozen()` and still readable, so a document issued
last March can still name the approved figures behind it (§1.3.1).

Two registers over the same rows, because they answer different questions. The project's report page
is *"what did we send this client"*; `/reports` is *"what has this practice sent"* — a director
checking what went out last month, or somebody looking for a document when they cannot remember
which job it was on. `/reports` also lists documents on **archived** projects, marked, which is the
one place that work is still findable.

Withdrawn, never deleted. A report that was sent cannot be unsent.

**`checks/issued.mjs` asserts the thing that would break silently:** it issues a bill, moves a rate
underneath it, and downloads again — same length, same checksum. A register that quietly
re-generated on download would look identical on screen and would have destroyed the only reason it
exists.

### The advisor knew where the job was and nothing about what the practice could do

`Brief.stages` was declared, documented as *"the stages this project runs"*, and **hardcoded to
`[]`** since it was written. The route already filtered the steps by engagement, so it never advised
on an out-of-scope step — but it would happily tell a practice engaged for a feasibility what to
expect at tender.

Three more facts it could not derive, all now in the brief: the **province** (rates are not
national), whether the **rate library** holds anything that can price this job, and whether anything
has been **issued**. All three are booleans, never counts — a number handed to the model is a number
that can come back out of it wearing the platform's voice. The eligibility SQL is a transcription of
`matchRates`, so the advisor and the pricing engine cannot disagree about whether a job is pricable.

The onboarding guide gets the one fact nothing else would tell a beginner: the rate library is
firm-level and empty until somebody imports a schedule. Deliberately **not** a sixth guided move —
a rate copied into every job is a rate that has to be corrected in every job.

### The engagement was settable once, and the overview offered to change it anyway

Two halves of one gap. Stages were set at creation and nowhere else, while the overview carried
*"Runs Feasibility & Inception — Change"* pointing at a settings page with no stages control. And a
step outside those stages was dimmed in the sidebar, filed under a disclosure on the board, and
**completely silent on its own page** — same header, same checklist, same live run panel.

Project Details edits the engagement now. A project nobody has narrowed shows every box ticked,
because that is what it runs, and **ticking every box collapses back to null** rather than storing
the list: the two say the same thing today and stop the moment the platform grows a seventh phase,
where a stored list would silently exclude it.

The off-stage page states the position and offers to widen in one click. `addStage` **unions rather
than replaces**, so a control reached from a page about one stage cannot set other work aside.

**It does not block, deliberately** — the same reason the board sets these aside rather than hiding
them. An engagement is answered once, at setup, by somebody who may not have the appointment in
front of them. Verified rather than asserted: the run control reads `Run extraction:true`
*identically* in scope and off stage, so the notice is additive and the chain is still the only gate.

### The take-off — and why the obvious build would have been the wrong one

*"How many bricks for 240 m² of one-brick wall"* is the calculation a QS does most often and least
enjoys doing by hand. The obvious way to make the advisor answer it is to ask the model, and that is
exactly the mistake ASAQS documented.

So nothing in the chain is remembered:

1. The model reads the **work** and the **quantity** out of the reader's own question.
2. `proposeMethod` — the *same call the pricing screen makes*, so a chat answer and a rate build-up
   cannot use different factors — says what **one unit** is made of, quantities only.
3. `domain/take-off.ts` does the arithmetic, tested against hand-worked examples.
4. `priceResources` prices it from the firm's own library, each row carrying its source and date.

Every line states its working — `104 per m2 × 240 m2 · +5% waste · at R 48 484,80 · Supplier quote ·
from 2026-01-01` — which is what earns a figure the right to be shown at all. It returns a
`ToolResult`, so the panel, `readAnswer` and the figure guard treat it exactly as they treat the six
gates; a second rendering path for numbers is precisely what should not exist.

**Two decisions worth not re-litigating:**

- **Waste reaches materials and stops there.** `buildUpRate` spreads it across the whole net,
  correctly, because it produces a *cost*. This produces an *order*, waste is cutting and breakage,
  and nobody orders five per cent more bricklayer — inflating the hours would overstate the
  programme in a way that looks right.
- **What to order is a separate figure from what is consumed.** 4 482,4 bricks is honest and
  unbuyable, so a countable resource carries whole units rounded **up**. Where the unit is not one
  `COUNTABLE` recognises there is **no** order figure rather than a guessed one — "order 4 488 m³ of
  concrete" would cost the reader confidence in every other figure on the page.

An unpriced resource contributes nothing and is counted out loud; a wholly unpriced take-off shows
**no total at all**, because `R 0,00` would be a figure and a wrong one.

**The first attempt failed** on *"how much cement for 18 m³ of 25 MPa concrete"* — the model refused
because "answer only from the passages" and nothing matched. The prompt now says in as many words
that a take-off needs no passage.

### The factors — where the take-off's numbers stopped being the model's

The take-off above rested on `proposeMethod`, and the argument for it was that a measurement factor
is a stable fact. **That argument holds for materials and fails for labour and plant.** Asked the
same question twice on the same day, the model returned 0,10 and then 0,15 hours of concrete mixer
per m² — a fifty per cent spread in a figure somebody might price from. 104 bricks in a square metre
is fixed by geometry; hours per square metre is a *productivity assumption*, and that depends on the
gang, the site, the access and the season.

So `resource_factors` (migration `0021`) holds what a firm has written down, with the standing of a
rate: firm-level, append-only, a required source and an effective date on every row (§6.3).
Revising a factor files a new row, so a take-off done last March can still be reproduced on the
assumptions that applied then. Entered under **Rate Library → Factors**, a tab rather than a route,
because the Cost Data area gets one function between all of it.

#### The correction that the tests exist for

They **replaced** the method wholesale at first, and it was wrong in a way that looked right. A
practice records its labour and plant factors — those are the ones worth recording, being the
unstable ones — and a take-off then returned a bricklayer, a mixer, and **no bricks at all**. The
answer looked complete. Not recording a material factor is the *normal* case, because geometry fixes
it and the model gets it right.

The design that survives is an **override, resource by resource**. Two questions with different
owners: *which resources this work involves* is the method and the model is good at it; *how much of
each* is the factor and the practice should win. A held factor the method never proposed is
appended, because a firm that wrote a resource down knows about it.

#### Everything says which of the two it is

`the practice's factor · Our own output records · from 2026-01-01` against `proposed, not the
practice's own — check it`. Marking only one would leave the other reading as authoritative by
default, which is the confident-looking uncertainty §1.3 exists to prevent.

#### Waste moved onto the factor

Brickwork runs at about five per cent and tiling at ten, and one allowance across a whole build-up
either overstates the bricks or understates the tiles. **Absent is not nought**: a factor stating no
allowance falls back to the method's, and a factor stating zero keeps the zero, because that is a
decision somebody made.

Note this is deliberately *not* how `buildUpRate` treats waste — that one spreads it across the whole
money net, correctly, because it produces a **cost**. This produces an **order**, and nobody orders
five per cent more bricklayer.

#### The panel, which is what prompted all of it

The advisor rendered "where this job is" above every answer — a leftover from when it answered one
fixed question, where the position genuinely *is* the premise of the counsel. A brick count arrived
below four lines of stage and document counts. It now leads only when it is the subject, and still
leads on an **outage**, where it is the whole useful result and the route goes out of its way to
return it.

The input said "Ask about this project's documents", written before the take-off existed, so the
only way to discover you could ask for a brick count was to be told — which is exactly how it was
discovered. The placeholder names both jobs now.

### Four things the next session should know

- **`npm run check` fires no real model questions, by standing convention** — `checks/advisor.mjs`
  says so explicitly: a browser check that asked a real question would put the gate at the mercy of
  a third party and cost money every run. The take-off's arithmetic, its request gate and its
  assembly are held in unit tests instead (`domain/take-off.test.ts`, `lib/factors.test.ts`,
  `lib/agent/resource-take-off.test.ts`). Do not "fix" this by adding a live call to the gate.
- **`resource_factors` is empty in every environment.** Nothing seeds it and nothing should (§1.3),
  so until a practice files factors the take-off proposes all of them and marks every line
  "proposed". A take-off that shows no "the practice's factor" line anywhere is working correctly,
  not broken.
- **`vercel curl` on one path proves nothing.** Every path can return the same page; a "pass" was
  nearly reported off exactly that earlier in this session. Verify a deploy with a **control** — a
  route that should exist beside a path that should not — and compare what comes back.
- **The `--n-500` finding still stands.** On the `--n-50` canvas it measures 4,45:1 against §7.8's
  4,5. Lines written on this branch use `--n-600`; the app-wide sweep has not been done.

### Verified

`npm run check` **827 assertions across 26 suites**, `npm test` **979 tests in 50 files**,
typecheck, lint, `check-modules`, `check-lockfile` — all green, test projects cleaned after each
run.

Verified live against the running platform rather than asserted:

- 240 m² of one-brick wall returns **26 208 bricks** (104 × 240 × 1,05) across six resources at
  **R 186 918,00**; 18 m³ of 25 MPa concrete correctly reports *"3 of 6 resources have no rate in
  the library"*; a question about a document does not trigger the take-off at all.
- Filing 1,45 h/m² for a bricklayer and 0,08 for a mixer **through the form** makes two consecutive
  asks identical at **R 192 210,00**, with those two lines marked as the practice's and the other
  four marked proposed. That repeatability is the whole point of the table.
- An issued bill downloaded back **byte-identical after a rate moved underneath it**.
- The off-stage notice does not gate anything: the run control reads `Run extraction:true`
  identically in scope and off stage.

## 2026-09-03 — cost management, and there is no pricing API

**This section post-dates every other one.** Six commits on **`cost-management`**, branched from
`home-ux` and pushed. Nothing here is deployed; production still runs `home-ux` at `2162e15`.

### The finding the whole branch is built on

The brief was *"integrate industry pricing APIs — AAQS, StatsSA, BER"*. **There are none.**

| Source | What it actually is |
|---|---|
| [AAQS](https://aaqs.org/pricing-data-2/) | A PDF cost guide (AECOM Africa PCC 2024/25) and an Excel questionnaire members *submit* to. |
| [BER BCIS](https://www.ber.ac.za/BCIS/Index/BER-Building-Cost-Index) | Login-gated quarterly subscription: a data file and a PDF, 27 items, Haylett components. *"Only one registered user is allowed per company."* |
| [StatsSA P0151.1](https://www.statssa.gov.za/publications/P01511/) | Monthly construction material price indices, published as PDFs. |

Not one offers a feed, so "moving away from manual scraping to automated API calls" has nothing to
call. What all three *do* offer is **a document on a schedule** — which is what this platform
already eats, and which fits §1.3.1 better than an API would: a rate that arrives with a source and
a date can be defended, and a figure fetched from an endpoint at an unrecorded moment cannot.

**So the import is the integration.** Do not go looking for these APIs again.

### The rate library — firm-level, and appended

`/rates` is one route holding the whole Cost Data area: current rates, regional analysis, trends,
the practice's assumptions, and the importer. One serverless function between all of it, because a
folder is a function.

**No `project_id`.** §4.5 and §6.3 make a rate set a firm asset; a rate copied into every job is a
rate that has to be corrected in every job. The reference prototype scopes rates to a project and
that is the thing deliberately not copied, along with its `numeric(18,2)` — a rate here is `bigint`
minor units plus the precision it is held at, the same pair `run_items` uses, so a rate moves
between the library and a bill row without being rounded on the way.

**Rows are appended, never updated.** "25 MPa concrete, Gauteng" was R1 700,00 in Q4 2022 and is
R1 850,00 now, and both are true. `ratesInForce` takes the newest row on or before a date, and a
future-dated rate is not in force — loading next quarter's guide early must not silently reprice
today's bill. Same shape as `assumptions`, and as `loadSignedFigures` taking the latest signature.

`source` is not nullable. It is the column that makes the library usable in an argument.

### The importer, and what real schedules do

CSV and XLSX, previewed before anything is written. The header is **found**, not assumed, because a
real schedule opens with a title and a blank line — and a row only counts as the header if it names
both a description and a rate, or a stray "Region" label above the table is taken for it and the
whole file imports one row late.

The delimiter is **detected**: an Excel set to a comma decimal, which is the South African default
(§7.7), writes semicolons, and a file importing as one column per row is the commonest failure.

Two judgements, opposite on purpose. A **province** it cannot match exactly is refused — "KZN" is
obvious to a reader and not a match this can make safely, and a rate filed under the wrong province
gets used. A **trade** it does not recognise imports unclassified, because §6.9 makes a
classification a dimension rather than a gate.

`xlsx.ts` gained a grid reader. `cellsOf` and `sheetsOf` are generators both the retrieval reader
and the grid reader consume — a second copy of that walk would drift silently, and a sheet that
indexes correctly while importing one column to the left is a wrong rate with nothing on screen to
say so.

### Settings is administration now

The ten financial assumptions moved to **Rate Library → Assumptions**. A prime lending rate is not
a preference: it sets an affordability ceiling, decides six gates and prints a verdict on a client's
report, so it belongs with the rates. Settings keeps People, and a signpost saying where they went.
`checks/settings.mjs` follows them and still asserts the thing it exists for — that a value set
there reaches the report.

### The BoQ summary, and two faults in the reference design

`bill-summary.tsx` gives the grid the summary the prototype has. **Two of its lines are not
reproduced, and both are arithmetic.**

*Preliminaries are counted twice* — priced as items in section 1 *and* added as a 12% uplift. In SA
practice preliminaries are measured items in Bill No. 1; the uplift is a concept-estimate
convention and applying it to a priced bill inflates a tender document.

*The totals do not reconcile* — its "Grand Total R273,1m" is built from a net of R198,7m, which is
the Building Package alone, while the strip beneath sums four packages to R342,5m. Both labelled
totals, neither derivable from the other.

The section strip replaces its package strip because **packages are not derivable** — nothing maps
a bill section to "Building" or "MEP", and inventing that mapping would be a declaration wearing a
derivation's clothes. VAT is off by default and labelled when on: §5.3 applies it at certificate
level, a tender is priced excluding it, and a headline that moves 15% on a forgotten checkbox gets
read into a recommendation.

### Web search — the key was fine, the protocol was wrong

`deepseek.ts` calls `https://api.deepseek.com/chat/completions`, which is OpenAI-shaped and does
**not** browse. DeepSeek runs the search itself on its **Anthropic**-compatible endpoint. Verified
by calling it, because the documentation contradicted itself on whether this was open to an API
caller or only inside Claude Code:

```
POST https://api.deepseek.com/anthropic/v1/messages
tools: [{ type: "web_search_20250305", name: "web_search" }]
→ server_tool_use, then web_search_tool_result blocks with titles and URLs
```

One key, two protocols. Nothing about the existing client changed.

It is a **fifth channel** and is kept apart from the four. `WebSource` is deliberately not `Source`:
a corpus passage has a document and a page and lives inside the practice, this has a URL and a time
and does not. It renders under *"From the web — not the practice's"*, every source is an openable
link, the fetch time is stamped on it. An answer citing no page is **refused** — the model replying
from memory is the exact shape this platform refuses everywhere else.

**A separate button, not a checkbox.** Ask reads the corpus and never leaves the building; Web sends
the words in the box out of it. §1.3.2 scopes retrieval in SQL and never by prompt, and a tick
somebody left on would quietly change which of those happened.

### Production is still behind Vercel SSO — deliberately, for now

Read the setting rather than guessing at it:

```json
"ssoProtection": { "deploymentType": "all_except_custom_domains" }
```

So **a custom domain is already exempt.** Attaching one makes production reachable with *no*
protection change, previews staying private. The account has no domains yet.

The alternative is `vercel project protection disable --sso`, which is project-wide and would
un-gate previews too. Either is safe as far as the data goes: the app authenticates itself —
`AppLayout` calls `requireSession()`, users are scrypt rows — so Vercel SSO is a *second* gate, and
what would become public is the login page and `/api/health`.

**Asked and deferred: not needed until somebody outside the Vercel team has to open it.** There is
an automation bypass secret on the project already (`protectionBypass`, `isEnvVar: true`), which is
how `deploy.mjs` health-checks through the gate.

### Two things about running the gate

- **The dev server goes stale.** After hours of recompiles two unrelated suites began timing out
  under the gate's load while passing alone. Restarting it made the whole gate green first time.
  Two suites failing under load and passing alone is the shape of a tired dev server, not a diff.
- **`waitUntil: "networkidle0"` is a proxy wait.** Every project screen carries the advisor, and its
  request holds a connection open on that page's account. `chain.mjs` now waits for the run region.

### Verified

25/25 browser suites, **846** unit tests, typecheck, lint, `check-modules`, `check-lockfile`. The
importer driven end to end through the screen; the web channel driven through the advisor panel on
a real project.

## 2026-09-02 — the module pages, and a deployment you can name

**This section post-dates every other one.** Three commits on `home-ux`. Production is unchanged
and nothing here has been deployed.

### The thirteen module pages had no shape

`ModulePage` renders thirteen: ten field-set steps, `/bill` with its item set, and `/inputs` and
`/site`, which run no agent at all. Everything else — the overview, the dashboard, the report, the
bill, the process model — opens by saying where the thing stands. A module page opened on its own
name over the project's, which the breadcrumb and the back button had each already said, and then
abandoned the panel language the rest of the app uses. On the two pages that run no agent that was
the whole screen: a title, an unlabelled box, and the words OPTIONAL and FILED on bare canvas.

The header now carries the stage and process area, the state, and what reads the step once it is
signed. All derived — the stage from L0 through `phaseOfModule`, the state from `stepState`, the
readers from `feedsInto`. The readiness list is one panel with a header strip, and the three groups
stay groups inside it: what they lacked was the container, not the distinction.

**Three things were written twice and are now written once.** `Panel` was on the dashboard and
again on the main page, whose copy admits it is *"the dashboard's language, kept"* — a third was
about to be written here, so it is `components/shell/panel.tsx`. `StepBadge` and the state sentence
lived on the project overview because the board was the only surface that ever stated a step's
position; clicking a row marked *"Waiting on Feasibility Estimate"* opened a page with no trace of
it. They are `components/project/step-badge.tsx` and `stepSummary` in `chain.ts`, beside the states
they describe, with eight tests over the branches.

*The main page keeps its own `Panel` variant.* It differs in how the count and the action render,
both settled and measured, and reconciling them is a decision about that screen.

### The bug that only looking at the screen would find

`/tender-analysis` painted "What this step needs" **amber — header strip, bar and all — while its
own header read "2/2 filed" and the line beside the bar read "Ready to start".** Every document was
in. The panel was coloured by `readiness.startable`, which folds two blockers into one flag: a
missing document *and* an unsigned upstream. The unsigned bill was turning the documents panel
amber, which tells a reader something is wrong with their documents when nothing is.

`criteria-status.ts` names that exact mistake in its own header — v3 gated a run button on
`startable` and printed *"needs a cost plan"* directly beneath *"Filed and indexed: the cost plan"*.
**Key on the blocker the reader can clear from where they are standing.** From that panel, that is a
missing document; the unsigned upstream is the page header's job and the run panel's banner's job.

Fixing the colour then exposed the sentence, which had two states where there are three. *"Ready to
start"* the moment the last document lands is wrong on a step with an unsigned upstream — the filing
is finished and the step still cannot run. The middle state is neutral: `--ok` would call it done
and `--warn` would demand an action nobody can take from there. It reads **"Required filing complete
— waiting on Bill of Quantities"**, and *required* because the bar counts optional documents too and
sits half full on a step whose mandatory rows are all in.

### Contrast, and a finding left standing

`--n-500` on the `--n-50` canvas measures **4,45:1**, and §7.8 asks 4,5. The header lines this work
writes use `--n-600` — **7,09:1** — the same correction the sidebar rows took. Inside a white panel
`--n-500` is 4,72:1 and stays: it is the canvas that is short, not the token.

**That role is still used app-wide** for the meta line under every page title, the project
overview's included. It was not widened beyond the lines this pass authored, and it is worth a
deliberate decision rather than a drive-by.

Measuring also *stopped* a change. The run panel had no ground of its own, so it sat grey while the
panels beside it were white — it is `--n-0` now. Its header stays untinted where theirs is `--n-50`,
because the blurb under its heading is `--n-500`: 4,72:1 on white, 4,45:1 on `--n-50`. The strip
that suits a title and a count would put body text under AA.

### `--recreate` left the gate red, and nobody could have guessed why

`checks/settings.mjs` asserts that a practice's stored assumption reaches the report, and the
affordability envelope it looks for only appears where an income band is **signed**. The seed script
stopped at documents, so after a `--recreate` that suite failed with **"no bond row"** — which reads
as a bug in the settings screen — and the gate stops at the first failure, so the two suites after
it never ran. `GREEN` came back 22 of 25 with one visible FAIL.

This file used to describe running and signing the two steps by hand afterwards. **A manual step
that a check depends on is a manual step somebody forgets**, so `seed-test-project.mjs` now does it:
run, correct the unit count, sign, then the cost plan. Two DeepSeek calls, a fraction of a cent, and
it skips a step that is already signed so a re-run costs nothing.

The correction is still a person's, and still correct: the brief states *"Units permitted by zoning
1 143 · Units proposed 1 046"* and the extractor refuses to choose between two candidates. It is
typed with `number()` from `test-scheme.mjs`, because §7.7 groups with U+00A0 and an ordinary space
would not match the figure the documents state.

One trap found while writing it, and it is the suites' own lesson again: committing an override runs
a server action and revalidates, and sign-off is **disabled while that is in flight**. Reading
`disabled` straight after the last correction reads the pending state and reports a perfectly
signable run as blocked. Wait on the outcome, never on a proxy.

### A deployment that says which commit it is

Every release in the Vercel dashboard was titled with its own id — `GtyssRqcp`, `HUiyZQrU4` — so
telling two apart meant opening both. The cause is the trick `deploy.mjs` exists for: Vercel names a
deployment after the commit it built, and parking `.git` is precisely what leaves it nothing to
read. The git facts are now read before the parking and passed as `--meta`.

**The keys were read off this account, not guessed.** The one deployment the GitHub integration made
before it was disconnected carries `githubCommitMessage`, `githubCommitRef`, `githubCommitSha`,
`githubOrg` and `githubRepo`. The **author** keys are on it too — and that deployment is the one
marked *Blocked*, refused on exactly the access check the parking avoids. So they are deliberately
not sent.

**Quoting is not optional here.** `vercel` is a `.cmd` shim and Node refuses to spawn one without
`shell: true` (CVE-2024-27980), so cmd.exe re-parses the argument list. Measured: `chore(repo):
commit as the work account, and refuse anything else` arrives as **eleven** arguments, and
`fix: a & b | c > d` truncates at `a` and then runs `b` as a command of its own.

**Unverified:** that the dashboard renders the label for a CLI deployment. The next preview settles
it; the fallback is `githubCommitMessage` alone.

### Two things worth knowing before the next session

- **The gate now runs to about ten minutes** and will be killed by a 10-minute command timeout
  mid-suite. Run it in the background, or the run dies at whichever suite it happened to reach and
  the output looks like a failure that is not one.
- **`npm test` failed once, immediately after the browser gate** — all 39 files identically, inside
  vitest's runner at the `describe()` call, before any project code ran. Three consecutive clean runs
  before and after. It reads as worker-pool startup under load rather than anything in the diff, and
  it was **not** root-caused. If it recurs, that is the thread to pull.

### A preview deployment that should not exist

`qs-management-platform-7uh547pv8` was created by accident while testing the labelling change: a
fake `vercel` was put on `PATH` to capture the arguments, and it never took effect, because
`spawnSync` with `shell: true` resolves through cmd.exe and reads the **Windows** `PATH`, not the
POSIX one set from Git Bash. The real CLI ran.

It is a preview, so nothing was promoted and production stayed on `5ykprdx16`; `.env.local` was
verified byte-identical afterwards. Delete it or leave it. **The lesson is not the quoting — it is
that a deploy path must not be exercised with the live CLI within reach.**

### Verified

25/25 browser suites (`GATE_EXIT=0`, zero FAILs), 783 unit tests, typecheck, lint, `check-modules`,
`check-lockfile`. `--recreate` run end to end: 15 documents, 27 passages, both cost-planning steps
signed, `units` = 1 046. All thirteen module pages looked at on the seeded project across the ready,
waiting, blocked and signed states, and at 1280 with the advisor open.

## 2026-09-22/23 — Quotations (D1.3): reading a response, checking it, and the workbook afterwards

**Four commits on `nav-usability`, pushed: `4285f5e`, `3c64b60`, `0c9320b`, `cab70d1`.** Migration
`0034` (`rfqs`, `rfq_responses`) reached production on 23 September, with the published cost data
(`5a3ab24`) in the same release. Two new dependencies, both server-side only: `tesseract.js` (OCR) and `exceljs`
(the workbook).

It started as a question from the practice — *can the platform review these two fee proposals and
recommend one* — and the honest answer was that a QS did it by hand that afternoon. The step exists
because that afternoon is repeatable, and because every finding in it was either arithmetic or a
comparison against what the RFQ asked for. Neither needs judgement. What it does need is that
nothing is taken on the model's word.

### The division of labour, which is the whole design

The model **describes**; `domain/quote-check.ts` **decides**. The reading returns each price line as
the response prints it — the figure verbatim, the words around it, and, where the document shows its
working, that working over the other lines' ids (`L1+L2+L3`, `L6*0.10`, `7454400 + 0.09*(BASIS -
94960000)`). It totals nothing. Every sum, percentage, discount, VAT line and fee formula is
recomputed here, twice: against the document's own figures, which is what finds *where* an error is,
and against the corrected figures above it, which is what the response actually comes to. A line
right on the figure it was given and wrong once the line above it is fixed is **consequential**, not
a second mistake. A figure whose words cannot be found in the document is **not found** and is not
checked. The ranking is a stated rule — scope covered, then requirements met, then lowest corrected
price — so the recommendation can be argued with rather than believed.

### Seven rules, each written from a document that broke the previous one

None of these came from imagination. Each is a false finding, or a missed one, on a real proposal:

- **A salutation is not a client.** Lemken is addressed "Dear Sir"; the reading called the
  *addressed to the client* requirement met. `isSalutation` refuses that, and a response the reading
  found no addressee in is *not stated* rather than met.
- **A placeholder never meets a requirement.** N.E.T carries "professional indemnity insurance of
  R[amount] per claim". `placeholder()` catches a template field left unfilled.
- **Citing a guideline is not calculating on it.** The same proposal's fees are hours × rates at
  about 43% of the ECSA guideline fee, while "rendered in accordance with" the 2025 guideline. The
  prompt now says a requirement is met only where the response *does* what it asks.
- **A rounded rate is not an error.** N.E.T's site staff are priced monthly (12 × R90 000) with an
  hourly rate of R511 shown for balancing — the amount over the hours, rounded. Checking 2 112 ×
  R511 produced three false errors. `roundedRate` treats the printed rate as the amount restated.
- **A discount is taken once.** Lemken's civil price is the line *after* its 15% discount; applying
  the discount again made the like-for-like rate 5,98% instead of 7,03%. `afterDiscount` walks the
  line's working for a discount line.
- **One line priced for two scope items prices neither** — but only where the items rest on
  different costs of works. N.E.T's design-office fee covers civil, geotechnical and structural, so
  it is not the civil fee; Lemken's single fee covers civil design *and* its stage 5, which is one
  discipline and is comparable.
- **A fee formula must reproduce the fee it prints** before the platform uses it. The reading once
  tied Lemken's formula to the contingencies line, and the recomputation was nonsense until the
  formula was tested against the printed fee (within 10%) and otherwise inferred from the lines.

### Images, and what OCR is allowed to conclude

Lemken prints its fee calculation only as a picture, so for a text-only model the proposal has no
fee calculation. `lib/ingest/image-text.ts` pulls the embedded images out with `unpdf`, upscales
them with `sharp` and reads them with Tesseract. The confidence number is the whole safeguard: a
table reads in the seventies and eighties, a site plan reads in the thirties and comes back as
`4 a = Ym ~S ba`. Below 60 the image is reported unread rather than guessed at, and below 150 000
pixels an unread image is not reported at all, because an unreadable logo is not a gap in a
proposal.

Two consequences are worth keeping:

- A figure found only in OCR text carries a note to confirm it by eye, and a working that fails on
  OCR'd figures is **check by eye**, never an asserted error. OCR read Lemken's "5%" as "55%" once;
  a misread is at least as likely as a mistake, so a person decides.
- **Which images went unread is the platform's statement, not the model's.** Told its own OCR text,
  the reading still listed the fee table it had just read as unseen. The model's word on images is
  filtered out and replaced with the OCR pass's own list.

With the image read, the platform reaches the two findings that had needed a human eye: the fee is
worked on R150 403 151,25 rather than the R151 020 251,25 the proposal states, and on the corrected
estimate it becomes R11 457 934,22, +R880 293,12 — the manual audit's figures to the cent.

### A second reading, hours, and the workbook

- **The review pass** reads each proposal as a document and lists what does not hang together: a
  role named two ways, a section cited and absent, an unfilled field, charges that can rise without
  a cap. Every finding must quote words that can be found in the text, or it is dropped. It found
  two things the manual audit missed (N.E.T's Annexure A described as both the CVs and the cost
  breakdown; the structural engineers' names spelled differently in two tables).
- **Counts are checked exactly.** Hours tables are transcribed as tables — rows of cells, and which
  rows each subtotal gathers — and the platform builds and checks every total. An hour out is an
  hour out, though it moves no price. Per-cell tallies were the first attempt and blew the model's
  8 000-token reply; the compact table form is what fits.
- **The workbook** (`lib/report/rfq-workbook.ts`, issued kind `rfq_comparison`) is the sheet a QS
  works in afterwards: every line recomputed as a live Excel formula over the response's own
  figures, the offers like for like, each firm's fee formula on one cost of works, a register of
  gaps with rand effect and severity, and the clarifications with room for the answers. Its sheets
  follow the responses — no cost of works, no cost-of-works sheet — so a materials quotation brings
  the four that always apply.

### The benchmark, which is what "unbiased" has to mean

`checks/rfq-parity-live.mts` evaluates the three Marshall Dam proposals and asserts **every finding
of the manual audit** (MPS/MD/RFQ-01 Rev 3) and the reverse — no arithmetic error the audit does not
have. 19 of 19 on each of its last five runs. It is the only honest answer to *does the platform
read them the way a QS does*: the prompts are identical for every response, each is evaluated alone
without sight of the others, the ranking is a rule, and the benchmark fails the moment the findings
drift. It spends credits, so it is not in `npm run check`.

Where the two disagreed, the documents decided: twice the platform was right (MUTEC's structural
stage 3 at 30%, so its stages total 105%; and the Annexure A contradiction), once the audit was
(Lemken's stages 1–6 include stage 5 for the civil works, so it covers more than the audit's "1 of
3" — corrected in the audit, not in the platform).

### What is not built, and should be said out loud

- **A scanned quotation with no text layer still fails.** `evaluateQuote` refuses before OCR runs,
  because OCR supplements text rather than replacing it. Falling back to OCR when there are no
  passages is the obvious next move.
- **No tariff library.** The platform reads each firm's printed fee formula but holds no ECSA
  tables, so it cannot say "this fee is 74% of the 2025 tariff" — which the practice's own
  comparison workbook does.
- **No weighted scoring.** The rule is scope, then requirements, then price. A 70/30 price-quality
  split is not in it.
- **Hours, not judgement.** The platform checks money and counts; it does not read unit rates for
  reasonableness, and it makes no finding on a firm's capability.
- **Proven on fee proposals.** A subcontractor's priced bill or a materials schedule will run
  through the same machinery, but the reading is untested there. The first of each kind should be
  checked by hand and added to the benchmark.

### Gotchas earned here

- **`npm install` on Windows breaks the lockfile for the runner**, and the pre-commit hook catches
  it (`@emnapi/runtime`, `@emnapi/core` go missing). `npm run lock` fixes it but runs the install
  against the mounted repo, which replaces the Windows `node_modules` with Linux binaries and stops
  the dev server. Copy `package.json` and `package-lock.json` into a scratch directory, run the same
  container there, and copy only the lockfile back.
- **Tesseract does not survive bundling.** It starts a worker thread from a path it builds at
  runtime and loads a WASM core the same way, so both packages are in `serverExternalPackages` and
  traced in by hand through `outputFileTracingIncludes` (`/projects/**`, which is the pattern that
  actually matched — the exact route key did not). Its English data is fetched on first use and
  cached in the temp directory: a cold production function will do that once, and that is the one
  part of this that cannot be tested until it is deployed.
- **The issued register now serves two media types.** A comparative evaluation is an `.xlsx`, so the
  download route sets the type from the kind. Anything else added there needs the same.


## 2026-09-23 — published cost data, and the rates that are not going to production

**`5a3ab24`, deployed.** The open item read *load the new simulated rates onto production*, and the
right answer turned out to be that it must not happen. Those rows carry `Simulated test data – not
a supplier quote`, and a live rate library is the one table in this platform a QS is entitled to
trust; seeding it with invented figures would be the worst kind of authority-borrowing this file
keeps warning about. They stay in development, and `checks/published-rates.mjs` now fails if
anything published is written into `rates`.

**What was needed instead was published data, and there is a good source.** The AECOM *Africa
Property & Construction Cost Guide 2025/26* is hosted publicly by the ASAQS, and its South African
cost section carries approximate inclusive building rates current to **1 July 2025**: offices,
retail, industrial, residential, hotels per key, schools, hospitals, prisons per inmate, airport
infrastructure, and the building-services rates for electrical, electronic, fire and
air-conditioning. 108 lines are transcribed into `lib/published-cost-data.ts`, with the guide's own
basis attached — excluding VAT, parking, site infrastructure and fees, on the SAPOA construction
area, Gauteng data where possible.

**Ranges stay ranges.** `published-factors.ts` refuses to ship the midpoint of a wide range, and the
same rule decides the shape here: `low` and `high` are both carried, and they are equal only where
the guide prints one figure. A low-rise office park is R11 300 to R13 900 per m², and R12 600 is a
number nobody published.

**The same file carries the BER and CPAP tender price escalation to 2029**, which is the figure a
cost plan's escalation allowance should be set from. BER is a tender price index, CPAP is a cost
index, and the gap between them is the market — the guide's own tender market indicator is BER over
CPAP. 2026 onwards is a forecast and is marked as one on the screen.

**Two tests, and one of them earns its keep.** The transcription is spot-checked against the guide,
but the useful one recomputes every published year-on-year change from the indices beside it and
requires them to agree within a tenth of a percent. A mistyped index fails it.

**It is on the Cost Data screen** under a new *Published rates* tab, with the escalation table
beneath the repricing trends. The panel says whose figures they are, what they exclude, and links
the guide, for the reason the published factors panel gives: a firm should see every figure the
platform would use on its behalf and decide what authority to give it.

**Where this leaves the four rate-library tasks.** None of them is done — the nineteen ASAQS lettered
trades, one unit normaliser at both ends, bulk import for factors, and the published factor set
(built earlier). This is a fifth thing, and it does not touch them. Do the trades first, as that
note says.

## Starting a new session

The interface prompt is the live one — that branch is what is deployed. The engine prompt is kept
for the case where somebody needs to work on `platform` itself.

### Continuing on the interface

> The QS platform is at `D:\Projects\qs-platform`. Work is on branch **`nav-usability`**, pushed to
> `origin/nav-usability` and ahead of `platform`. Repo `X4OConsulting/qs-management-platform`.
>
> **Production runs `5a3ab24`** — the Quotations step, the workbook and the published cost data —
> deployed 23 September. Migration `0034` landed with it: a preview first, so the schema reached the
> shared Neon database while production carried on serving the code it had, then promoted. Both
> aliases follow. `rfqs`, `rfq_responses`, `notifications`, `bill_elements` and `cost_plan_allowances`
> are all present on Neon, 35 migrations applied, and `rates` on production is **empty** — the
> library is the practice's to fill.
>
> **`npm run check:production` cannot run here.** It needs `VERCEL_AUTOMATION_BYPASS_SECRET` in
> `.env.production.local`, copied once from the dashboard; this machine has no such file, so the
> deploy was verified by the health endpoint, the alias list, a route-versus-control probe and a
> direct look at the production schema instead.
>
> **Production:** https://qs-management-platform-lilac.vercel.app — the short alias, and the one to
> hand somebody. It and `qs-management-platform-raymond-3084s-projects.vercel.app` are two aliases
> of the **same** deployment and both follow every `--prod` deploy; `deploy.mjs` probes the second
> because it carries the team slug. Vercel scope `raymond-3084s-projects` (Pro), database
> `qs-platform-db` (Neon), blob store `qs-platform-documents`. GitHub is **deliberately
> disconnected**, so pushing deploys nothing; `npm run deploy` is the only thing that ships.
>
> **Read first, and in this order:** `HANDOFF.md` — **"2026-09-22/23 — Quotations (D1.3)"**, which
> is the most recent work and the one with a benchmark to keep it honest; then **"2026-09-07 (later)
> — what the cost data needs
> to make sense, and an audit"**, which is the newest and is where your task comes from, then
> **"2026-09-07 — the register, the engagement, and a take-off whose numbers are the practice's"**,
> then **"2026-09-03 — cost management, and there is no pricing API"**, then **"2026-09-02 — the
> module pages, and a deployment you can name"**, then **"2026-09-01/02 — the bill, the chain,
> accounts, and the move to Pro"**, where several things listed elsewhere as "not built" now are.
> Then "The feasibility engine" and the five sections after it, then "The interface — branch
> `home-ux`" and "The advisor". Then `PLATFORM.md` §7 and §14.
>
> **Launch it before reading any component.** Three things must be up, in order, and the second is
> the one that bites: Docker Desktop, then `docker compose up -d db`, then `npm run dev`. Without
> Postgres every page returns a 500 that reads like an application bug — it has cost time three
> times. A fresh container needs `node scripts/migrate.mjs`, and `pg_isready` must actually say
> *accepting connections* first. Sign in with the credentials in `.env.local`.
>
> **Task: make the cost data make sense to a quantity surveyor.** The rate library and the resource
> factor table are the platform's weakest half, and the reasons are structural rather than a matter
> of filling them in. **Three are left** — the fourth was built on 7 September and is struck below,
> kept because the note under it is the one worth reading before adding a published constant. They
> are in dependency order, and the first is the spine the rest hang from:
>
> 1. **The trades are invented.** `TRADES` in `lib/rates.ts` lists twelve made-up ones. ASAQS *Model
>    Preambles for Trades* defines **nineteen lettered sections** (C Earthworks … U External Works)
>    and every South African bill is organised by them. Our "Finishes" collapses six of them. A QS
>    cannot file a rate where they would look for it, and no real supplier schedule maps on import.
>    Replace `TRADES` with the nineteen and their letters, and migrate existing rows.
> 2. **Units are free text matched by exact string, and fail silently.** Measured: `m²` does not
>    match `m2`, `No.` does not match `no`, `hr` does not match `hour`. All three are ordinary in a
>    supplier spreadsheet, and the take-off misreports the miss as "no rate in the library prices
>    this" — so a QS goes and files a rate they already hold. Two normalisers already exist and
>    neither is used here: `normaliseUnit` in `take-off.ts` (strips full stops and spaces) and
>    `resourceKey` in `factors.ts` (folds case, punctuation and a trailing plural, written after
>    "Stock bricks" and "Stock brick" double-counted a wall). **Make one, use it at both ends**, and
>    offer a canonical unit list in the entry forms so the library stops accumulating variants.
>    Note `m²` needs more than punctuation folding — the superscript has to map to `2`.
> 3. **There is no bulk import for factors**, only a one-at-a-time form, so the table will stay
>    empty and the take-off will go on proposing every line. `rate-import.ts` already reads a
>    spreadsheet for rates and is the shape to copy.
> 4. ~~**A published factor set is the missing middle.**~~ **Built** — see "A published factor set
>    — built, and two faults it uncovered". Three origins now, published factors live in code rather
>    than the table so the origin is structural, and only two figures are published because a
>    published constant has to be derivable. **Read the mortar note before adding any**: a partial
>    factor set and a proposed method are two decompositions of one piece of work, and merging them
>    by name double-counts wherever the granularity disagrees.
>
> Do them in that order and **stop after the first for a look** — the trades touch the library, the
> importer, the filters and existing rows, and it is the one worth agreeing before the rest is built
> on it.
>
> **One measured fact to keep you honest about why this matters.** Published SA output for a
> bricklayer is 350–500 bricks a day alone and 500–1 000 with an assistant — 1,96 hours per m² of
> one-brick wall against 1,11, a factor of two, and **both correct** depending on the gang. The
> model proposes 1,2 h/m² *and* proposes an assistant, so it is answering the assisted case and is
> not wrong. The fault is that it **moves between asks** — 0,10 then 0,15 hours of mixer on the
> same day. Instability, not bias, is what the factor table fixes, and it is why no labour constant
> is published: a midpoint of a range that wide would be invented precision wearing the platform's
> authority.
>
> **Production is three commits behind.** It runs `08ba8d4` on
> `qs-management-platform-lilac.vercel.app` — that alias and the long team-slugged one are the same
> deployment. Two of the three outstanding are documentation and the third is the published factor
> set, which needs **no migration**, so a plain `npm run deploy` is enough this time. Preview first
> whenever a migration *is* pending. **Deploying is the owner's call — ask, never assume.**
>
> **Also outstanding, not part of the task:** `domain/risk.ts` has no unit test and it feeds the
> client-facing viability report; the `--n-500` contrast sweep has never been done app-wide; and the
> dependabot badge is `@xmldom/xmldom` via `mammoth`, assessed as very likely unreachable — read the
> audit before touching it, and do not bump the document reader without a reason.
>
> **Before touching a page, launch it and look at the seeded project.** If the figures look wrong —
> a unit count that is not 1 046, a verdict that is not No-Go — it has picked up a stray signature.
> The fix is `--recreate`, not a database edit, and the platform will refuse the edit anyway. That
> now runs and signs the two cost-planning steps as well, so it leaves the project whole; it costs
> two DeepSeek calls and takes a few minutes.
>
> **How I work.** One screen at a time; do not build five things and hand me a list. Research before
> building UI, and say plainly when you have not. Verify, do not assert — if you claim something
> works, show me the run that proves it. Screenshot what you build and look at it. Comments explain
> why, not what. Go with what you judge best rather than asking me to confirm each step.
>
> **The gate, before every commit, on a real green result:** `npm run check` (**26** suites — assert
> the count with `test "$GREEN" = "26"`, and capture the exit code *inside* the redirect:
> `{ npm run check; echo "GATE_EXIT=$?"; } > check.out 2>&1`, because an `echo` chained after the
> redirect reports the echo's status and once reported a green gate that had failed — count
> `All checks passed`, not a tick character), `npm test` (**979**), `npm run typecheck`,
> `npm run lint`, `node scripts/check-modules.mjs`, `node scripts/check-lockfile.mjs`.
>
> **Run `npm run check` in the background.** It now takes about ten minutes, which is exactly the
> command timeout — a foreground run is killed mid-suite and the truncated output reads like a
> failure rather than an interruption.
>
> `checks/advisor.mjs` is the only one that spends money — a fraction of a cent, on DeepSeek.
> `checks/people.mjs` is the newest and asserts what fails silently: a password is not recoverable
> from the database, a deactivated account stops working, and posting to the action directly as a
> non-administrator creates nobody.
>
> **Four invariants that are enforced, not suggested** — read "Four invariants a design pass must
> not break" before touching the palette or any dialog:
>
> - `dialog:not(:modal) { display: none }` in `globals.css`. Do not remove it, and do not "fix" a
>   stuck dialog in a component again — it was tried twice.
> - The advisor states no figure. `readAdvice` enforces it; four unit tests and a browser check
>   cover it.
> - Colour means exactly one thing. No fifth semantic hue without answering what it *means*.
> - Nothing declared that can be derived. Stages, the setup checklist and the advisor's brief are
>   derivations with tests asserting the derivation rather than the list.
>
> **Contrast is measured, not eyeballed.** Every colour decision on this branch has a ratio behind
> it and `checks/chain.mjs` fails the stage band under 4.5:1. If you change a token, measure the
> roles it plays and put the numbers in the commit message.
>
> **Three traps that have each cost real time:**
>
> - **A client component must never import from a module that imports `db`** — not even a type or a
>   constant. It returns 500 for the whole app and typecheck does not catch it. It has happened
>   three times. `lib/people.ts` exists precisely to give the client half a db-free home.
> - **`package-lock.json` must be generated on Linux, with a full install** — `npm run lock`. A
>   plain `npm install` on Windows prunes the Linux-only packages and `npm ci` then fails on the
>   runner; `--package-lock-only` prunes too, which is how the `lock` script itself was wrong for a
>   while. `node scripts/check-lockfile.mjs` is the detector and runs in `.githooks/pre-commit`.
> - **`vercel link` and `vercel integration add` rewrite `.env.local`** and will point
>   `DATABASE_URL` at production. `readEnv()` now refuses to run a suite against a non-local host,
>   but if a Vercel command has just run, check the file. Local is
>   `postgresql://postgres:devpassword@localhost:5434/qs_platform?sslmode=disable`.
>
> **Do not push to `platform` without saying so, and ask before deploying.** Deploying is a
> deliberate act and it is mine. The safe order when I do ask: `npm run deploy -- --preview` lands
> the migration on Neon while production carries on serving what it has, verify it, then
> `npm run deploy` promotes and health-checks. `gh auth switch --user KeenanHusselmannX4O` before
> any GitHub operation. Never merge `archive/first-attempt`. `fixtures/` holds real client
> documents, so the repo stays private.
>
> **Run `node scripts/clean-test-projects.mjs` after a `check`** — the suites leave twenty-odd
> projects behind and they make every screen unreadable while you are trying to judge one.

### Continuing on the engine

Paste this:


> The QS platform is at `D:\Projects\qs-platform`, branch `platform`, repo
> `X4OConsulting/qs-management-platform`.
>
> **Read first:** `HANDOFF.md` (state, decisions, what is next), `PLATFORM.md` (the spec) and
> `README.md` (how to run it, and how two people work on it). All three are current as of
> 2026-08-18 and everything in them has been verified by a run.
>
> **Task:** start from "Next, in order" — **Excel / CSV import**. §12 calls it Tier 1 and
> non-negotiable, §1.2 settles that WinQS is not an integration target, and a bill is the thing a QS
> actually wants to bring in. The paste path in the bill grid is already the small version of it,
> and `quantity_source` / `rate_source` already carry `imported`.
>
> **Where things stand.** Thirteen modules, sign-off, the chain, money, the row-shaped run, the
> dashboard and **pricing** are built. Working tree clean, CI green. The bill is `run_items` plus a
> grid with Excel paste and a rounding trigger that `checks/bill.mjs` checks against `extend()` on
> every commit; pricing is that same grid's rate column, with a build-up behind a row and one act
> across a selection. Read "The row-shaped run — built", "The dashboard" and "Pricing" before
> touching any of them.
>
> **Production is behind.** The live deploy predates all of it — pushing deploys nothing here, by
> design. Deploying is a deliberate act and it is mine.
>
> **There are two of us now.** Raymond Crown is on the repo and works on branches; I merge and
> deploy. Do not push to `platform` without saying so, and do not deploy at all. `CONTRIBUTING.md`
> is that flow written as steps, and it is what a second person is pointed at.
>
> **Still open, from earlier tasks:**
>
> - **Take-off** waits on geometry (§10). It is what closes the gap the bill leaves: every quantity
>   on a bill drafted from a specification is currently a QS's to measure by hand.
> - **The Rate Library.** §4.8's *apply a rate set* is the half of bulk application that is not
>   built, because a rate set is a firm-level asset with its own provenance (§6.3) and no home yet.
>   `rate_source` already has `rate_set` and `library` in its check constraint. It needs a route,
>   which is the twelfth-function problem.
>
> *(Swap this whole block for whatever the one thing is. Otherwise start from "Next, in order".)*
>
> **How I work:**
> - Verify, do not assert. If you claim something works, show me the run that proves it.
> - One screen at a time. Do not build five things and hand me a list.
> - Gate every commit on a real green result: `npm run check` (**26 suites**), `npm test`,
>   `node scripts/check-modules.mjs`, `node scripts/check-lockfile.mjs`, `npm run typecheck`,
>   `npm run lint`. Capture the exit code *inside* the redirect —
>   `{ npm run check; echo "GATE_EXIT=$?"; } > check.out 2>&1` — never an `echo` chained onto the
>   end of a command, which reports the `echo`'s success. Run
>   `node scripts/clean-test-projects.mjs` afterwards.
> - Research before building UI, and say plainly when you have not.
> - Comments explain why, not what.
>
> **Gotchas:**
>
> - **After any pull, `npm run setup`** — `npm ci` plus the migrations. An unapplied migration is a
>   500 on the page that reads the new table, which reads as a bug in the code you just pulled.
> - **Functions: `vercel build && npm run functions`, and nothing else.** It sits at **23**, and
>   **on Pro there is no count limit** — the twelve this script warns about is Hobby's, and `CAP`
>   defaults to it deliberately because assuming headroom is how the wall got met the first time.
>   Adding a route is fine; know that you are adding one. The build's route table is **not** the
>   count: it marks statically prerendered pages `○` and those still get a function each. Two
>   counting methods have already been wrong here. A branch in `/projects/[id]/[module]` is still
>   the cheaper shape where a page is genuinely a project module. CI checks this on every push now.
>   **And `vercel build` migrates**: it runs `npm run build`, and Next loads `.env.production.local`
>   — which holds the real `DATABASE_URL` — ahead of `.env.local`, so the obvious command migrates
>   the instance production serves. Strip the database variables the way `gate.yml` does first.
> - **CI is `.github/workflows/gate.yml`** and runs the whole gate plus the function count. Its
>   function job pulls Vercel's project settings and then **strips every database variable** before
>   building, because `npm run build` migrates and the project's real `DATABASE_URL` is the instance
>   production serves. Do not remove that filter.
> - **Deploy with `npm run deploy`**, which parks `.git` for the duration. Production is
>   `https://qs-management-platform-raymond-3084s-projects.vercel.app`.
> - **`vercel env pull` writes `[SENSITIVE]`** for anything marked sensitive, and a value that is
>   subtly not a value produces no error — only an absence. It has cost an hour twice.
> - **Migrations must be replayable**, and the build runs them — so `npm run build` belongs in the
>   gate for anything touching the schema. Rebase before writing one: `drizzle/meta/_journal.json`
>   is a hand-edited list and two people appending the same index conflicts.
> - **`package-lock.json` must be generated on Linux** — `npm run lock`. A plain `npm install` on
>   Windows reverts it and `npm ci` then fails on the runner.
> - **The browser suites live in `checks/`** and need `npm run dev` running. Run
>   `scripts/clean-test-projects.mjs` after them.
> > - **Local Postgres is Docker**, and there are two stoppages, not one: **Docker Desktop itself**
>   quits, and then the container is not running either. `docker compose up -d db` brings it back —
>   a fresh container needs `node scripts/migrate.mjs`, and `pg_isready` must actually say
>   *accepting connections* before migrating or the migration dies on a startup packet. Every page
>   500s while it is down, which reads like an app bug rather than a stopped database. It has cost
>   time three times now.
> - **Branch protection is unavailable** on this plan — verified, not assumed: both
>   `/branches/platform/protection` and `/rulesets` return **403 "Upgrade to GitHub Pro or make this
>   repository public"**, so GitHub's own "Protect this branch" banner is an upsell rather than a
>   button that works. CI reports; it cannot block. What *is* in the way is a local `pre-push` hook
>   (`.githooks/pre-push`, installed by `npm run setup` through `core.hooksPath`) that refuses a
>   direct push to `platform` and prints the commands to move the commits onto a branch. It is a
>   courtesy, not a wall: `--no-verify` goes past it, and it does not exist in a clone where
>   `npm run setup` has not been run.
> - `gh auth switch --user KeenanHusselmannX4O` before any GitHub operation · never merge
>   `archive/first-attempt` · `fixtures/` holds real client documents, so the repo stays private.
