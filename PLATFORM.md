# PLATFORM.md

**The single source of truth for this platform. If this file and anything else disagree, this file wins.**

A cloud quantity-surveying and construction cost management system, built QS-first for South Africa
and the broader Commonwealth market.

> **The brief, in one sentence:** a cloud app where a quantity surveyor measures a building, produces
> a priced Bill of Quantities, and issues monthly payment certificates against it — faster and with
> less fear than in Excel.

Everything below is distilled from the source set in §16. Where sources conflicted, §15 records which
won and why.

---

## 1. The problem, and the prime directive

### 1.1 The problem being solved

**Quantity surveying is choked with mechanical admin, and that admin is expensive because it is
senior professional time spent on clerical work.**

The same figures get re-keyed between documents. Three thousand bill items get re-entered every
month to produce a certificate that differs from the last one in a handful of places. Four thousand
items get priced one at a time. Dimensions get squared and abstracted by hand. The same certificate
structure gets rebuilt twenty-four times over a project's life. None of it requires judgement, and
all of it consumes people whose judgement is the actual product.

**Automate the mechanical half and the same practice carries more projects with the same headcount.**
That is the cost saving, and it is the whole commercial case. Every target on the scoreboard below is
a measurement of that saving.

The judgement half — what to measure, what a rate should be, whether work is genuinely complete —
stays with the QS. We are removing the clerical load around it, not the professional decision inside
it.

### 1.2 On WinQS and the incumbents

WinQS, DimensionX and the rest were **reverse-engineered as reference** — to establish what the work
actually is, what a complete QS system has to cover, and where the incumbents leave gaps. That
exercise is finished, and §11 records what it produced.

**They are not integration targets and not systems to stay compatible with.** We are building a
product to solve the problem in §1.1, not a companion to somebody else's tool. Excel import matters
for migration and trust (§12) — that is a different thing from staying WinQS-shaped.

### 1.3 The operating model — agent runs, not forms

**This is an agent-driven platform. It is not a database with forms in front of it.**

Every workflow starts from **uploaded documents**. Agents parse, classify and extract; a human
confirms and fills gaps; deterministic rules decide; the platform issues an output. Nothing is
typed into a blank grid, and **nothing is pre-populated** — a project's data exists because a run
produced it and a human approved it.

```
Upload  →  Analyse                          →  Review              →  Generate                          →  Output
           parse · classify · extract           human confirms         shared truth · cost model             report + PDF
           eval→feedback · project memory       and fills gaps         gates · assure                        benchmark · audit seal
```

**The three human control points.** Nothing material happens without them:

| Control | Stage | The human owns |
|---|---|---|
| **A · Define** | Use case / agent setup | The goal and scope of the run |
| **B · Refine** | Rubric / review | The judging standard, and the confirmed data |
| **C · Authorise** | Output / uplift | The issued report; any agent improvement ships only when signed |

**Gates are rules; evaluations are tests. Do not conflate them.** A gate **blocks** — it is
non-negotiable and a failed gate stops the verdict. An evaluation **grades** — it scores the output
against a human-owned rubric and returns ASSURED / FLAGGED / NOT-ASSURED without blocking.

**Data treatment rules, carried directly from the proven engine:**

- **No blank forms.** Every field originates from an uploaded document, or is explicitly a gap
  flagged for a human to fill.
- **Traceability.** Each captured value keeps its source document, page and exact quote.
- **Self-challenge.** Extraction is audited by an LLM judge and challenged against the project's
  previous run; dropped values are carried forward and flagged rather than lost.
- **Report from review.** The output's numbers are the values the human confirmed, never a silent
  re-derivation.
- **Integrity over silence.** Where an input is missing the result is withheld and labelled, never
  presented as fact. An LLM outage is surfaced, never a silent gap.
- **Time-sensitive inputs** — prime rate, First Home Finance / SHRA parameters, municipal tariffs,
  NHBRC fees — are pulled fresh and dated, never carried forward.

**Consequence for this repo: there is no seed data.** Fixtures for a test are fixtures. A
development database is populated by *executing a run against real documents*, because a UI proven
against invented rows has been proven against nothing.

### 1.3.1 The service chain — how the agentic layer and the CMS are the same system

**This is the architecture.** It is carried from the v3 portal, where it is proven, and it is what
turns eleven CMS modules into one agent-driven platform rather than two products bolted together.

**Every module is a *service* — a step in a chain, addressed by its process code.** Feasibility is
D1.1. So is the Bill of Quantities, so are valuations, so are variations. They are not separate
kinds of thing: each is a step that an agent proposes into, a human confirms, and a signature
freezes.

**A run has four field maps, and the distinction between them is the whole design:**

| Map | What it is |
|---|---|
| `proposed` | What the agent extracted. Never edited — it is the record of what the machine said |
| `overrides` | What the human corrected or filled |
| `working` | `proposed` + `overrides`, **human wins**. What the screen renders |
| `output` | **NULL until sign-off.** Written once, frozen |

> **`output` being NULL while a run is a draft is what stops a downstream service reading
> unapproved figures.** Not a status check in application code that someone can forget — the
> downstream query finds nothing to read. That single decision is why the chain cannot leak
> unreviewed numbers into a bill or a certificate.

**The server owns the chain, and the client never recomputes it.** Whether a step can start depends
on which upstream runs are signed *and* which documents are actually filed. A client that decided
its own prerequisites could start a downstream step from nothing and call it approved. So the
server answers `startable`, `blocked_reason`, `upstream_ready`, `feeds_from`, `feeds_into`, and the
UI renders that answer.

**Step state is derived, never stored:** `signed_off · draft · ready · waiting · not_built`.
Defined once, so a dashboard tile and the board it opens cannot disagree about what "waiting"
means.

**Every field carries its provenance.** `source_doc`, `source_page`, `source_excerpt`,
`confidence`, and — when a figure was carried through from an upstream service rather than read
from a document — `carried_via`. Both are kept, because a figure's provenance is its original
document *and* the path it travelled, and collapsing them loses whichever the reader needed.

> **A figure that cannot be traced is worse than a gap**, because it survives review looking
> checked.

**Steps and registers are different.** A *step* runs the contract and freezes at sign-off. A
*register* is firm-wide and recomputed on every read — freezing it would let a lapsed insurance
certificate or an expired clearance keep passing. Render a register as available, never as a step
waiting to be started.

**An integrity agent watches the boundaries.** It looks for the class of bug that renders
perfectly: a figure that changed, vanished or went stale as it crossed from one service to the
next. Findings carry a **fingerprint of the situation** — the documents and versions involved, not
the finding's name — so an acknowledgement lands on what the reader was actually shown. If a
further document arrives afterwards the fingerprint differs and the finding comes back. A finding
is acknowledged by a named person with a reason, and **never deleted**.

**A run in flight survives everything.** Its state is a row in the database, not component state:
reload, another tab, another machine, a laptop that slept. And when a run has been open too long
with nothing written, the platform says *that* rather than showing a spinner that lies.

### 1.3.2 The knowledge layer — RAG over the project corpus

**The platform is a retrieval-augmented agent platform, not a one-pass extractor.** Documents are
ingested once into a project corpus that every service step can query, throughout the project's
life — not read once at upload and discarded.

```
Ingest          parse (PDF · DOCX · XLSX · drawings) → normalise → chunk → embed → index
Retrieve        per step, scoped to the project, hybrid lexical + semantic
Ground          every generated value cites the chunks it came from
Remember        a later run is challenged against the corpus and the runs before it
```

**Retrieval is hybrid, and that is not a detail.** Construction documents are dense with exact
identifiers — `SANS 1200`, `25 MPa/19mm`, `Erf 180`, `JBCC PBA 6.2`, `706ST-002 Rev B`, a rate of
`R185,50`. Pure vector search is **bad** at exactly these: embeddings blur `SANS 1200` into `SANS
10400` and `25 MPa` into `30 MPa`, and in a costing platform that is not a near-miss, it is a wrong
number. So retrieval runs lexical full-text **and** semantic search and fuses the results. The
lexical half is what makes a code or a rate findable; the semantic half is what finds
"waterproofing to substructure" when the document says "damp proofing below ground level".

**Grounding is where §1.3.1's provenance comes from.** A field's `source_doc`, `source_page`,
`source_excerpt` and `source_chunk` are not decoration added afterwards — they are the retrieved
chunks that produced the value. That is what makes the trace real: clicking an amount in a cost
report walks back to the passage in the document it was read from.

**A value the agent cannot ground, it does not assert.** No supporting chunk means a flagged gap
for a human to fill, not a plausible number. §1.3's integrity rule, applied to generation.

**Scoping is a hard boundary.** Retrieval is always scoped to one project. A figure from another
scheme surfacing in this one's cost plan is the failure mode that would end trust in the platform,
and it is prevented at the query, not by prompt instruction.

**What the agent does with the corpus** is more than extraction — it **ingests** (classifies and
reads what arrives), **analyses** (compares against benchmarks, the previous run, and the project's
own parameters), and **generates** (narrative, findings, the report), each grounded and each
reviewable.

**The corpus is the project's memory.** The next run of the same project is challenged against the
last: values that were captured before and are missing now are carried forward and flagged rather
than silently dropped.

**Where it lives: Postgres, with pgvector.** Not a separate vector database. §13.1 fixes a boring
stack and one managed platform, and pgvector runs on every Postgres host we would consider — local,
Neon, RDS, Render — so the portability rule holds. It also puts the chunks in the same transaction
as the run that cites them, which a separate store cannot promise. A dedicated vector database
earns its place at a scale we can measure our way to, not before.

### 1.3.3 Entry criteria — what a process needs before it can start

**Every process area has a checklist of what it needs before it may begin.** Not a suggestion, and
not a form to fill in — a gate, in the §1.3 sense: it *blocks*.

This is the missing half of §1.3.1's `startable`. Whether a step can start depends on two things:
its upstream runs being signed, and **its inputs being present**. The first is the chain. This is
the second.

**A criterion is a required input, not a required document.** "Site and market data" may arrive as
a geotechnical report, a municipal fee schedule, or a market study — different documents satisfying
one criterion. So a criterion names what is needed and what evidence would satisfy it, and the
agent decides whether the corpus contains it.

| Field | |
|---|---|
| `label` | What is needed, in the QS's words — "Developer brief", "Municipal bulk contributions" |
| `mandatory` | Whether a gap **blocks** the run or merely flags it |
| `acceptedEvidence` | The document kinds that would satisfy it — how the agent knows what to look for |
| `declarable` | Whether a human may satisfy it **without** a document |
| `fallback` | What the platform does when it is absent but not mandatory |

**The intelligence is the matching.** The agent searches the project corpus (§1.3.2) for each
criterion and returns **satisfied · uncertain · missing**, citing the document, page and passage
that satisfied it. That citation is the same provenance record as any other value — a criterion
ticked with nothing behind it is exactly the untraceable figure §1.3.1 warns about.

**A human may declare, and it is recorded as a declaration.** Carried from v3's
`can_declare_without_documents`: sometimes the QS knows the zoning is right and the certificate is
in the post. They may say so — with a name and a reason, stored — and the criterion shows as
**declared**, never as satisfied. The two must remain distinguishable, because one is evidence and
the other is somebody's word.

> **The block is only ever a missing document.** An unsigned upstream cannot be declared past —
> that would let a step read figures a human never approved.

**Missing does not always mean stop.** §1.3's integrity rule applies: where an input is absent the
platform says what it will do instead. No QS cost plan means the cost is a benchmark and the
verdict is **withheld and labelled indicative** — the run proceeds, the output is honest about what
it rests on. That behaviour is the criterion's `fallback`, declared up front rather than decided
silently at report time.

**The checklist is configurable, per process, by the firm.** Practices differ, funders differ, and
a criterion nobody can edit becomes a criterion people work around. The platform ships defaults
drawn from the process model; a firm adds, removes and reorders them.

> **Shipped defaults are configuration, not seed data.** §1.3's "no seed data" rule is about
> fabricating a *project's* figures. A default checklist is a template — the same kind of thing as
> the ASAQS standard the library follows — and a firm edits it. Nothing here invents a project.

### 1.3.3 What this means for the CMS modules

The Bill of Quantities is **not** a blank grid a QS types into. It is a service:

- an agent proposes bill items from the documents and the upstream cost plan,
- the QS corrects and fills — their edits land in `overrides`, and the agent's proposal is still
  there underneath,
- sign-off freezes `output`,
- valuations downstream read only that frozen output,
- and every quantity on it still says which document, page and line it came from.

Same for valuations, variations and reports. **The CMS surface from §4 is real and unchanged — what
changes is where its data comes from and what governs it.** Manual entry never disappears: a QS
must always be able to measure by hand, and a hand-entered value is simply an override with a human
as its source.

### 1.4 Where this sits in the process model

The platform implements a documented BPMN hierarchy:
**L0** (7-phase construction value chain) → **L1** (8 professional domains, D1–D8) →
**L2** (52 process areas) → **L3** (109 sub-processes) → **L4** (109 tasks).

Only **D1 — QS & Cost Management** is deeply specified, and its first sub-process is the one we
build first:

> **D1.1-SP-001 — Feasibility Cost Estimate.** Eight steps: receive brief → site and market data →
> typology → benchmark rates → bulk services → fees, contingency and escalation → subsidy check →
> issue report.

**The QS-gate loop is the point.** At *"within budget?"* a No does not simply report failure — the
agent returns **spec-adjustment options** (reduce build rate via specification, reduce unit size,
shift the mix toward positive-headroom typologies) and loops back to Review for a human to act on.
That loop is the BPMN expression of the QS gate, and it is what makes this an agent rather than a
calculator.

Everything else in this document — the Bill of Quantities, valuations, variations — sits
**downstream of D1.1** in the same hierarchy, as further services in the chain of §1.3.1. It is all
still true, and it is not what gets built first.

**The goal is one system, not two.** The v3 portal proved the agentic chain — runs, proposals,
sign-off, provenance, integrity findings — across the process model. This platform takes that
machinery and extends it across the **full construction-management surface**: take-off, bills,
pricing, valuations, variations, reports. Not an agent product beside a CMS product; a CMS whose
every module is a step an agent proposes into and a human signs off.

### 1.5 The prime directive

**Small surface, deep quality.**

Massive results don't come from many features. They come from a few features so much better than the
spreadsheet the user has now that switching is obvious.

**The competition is Excel, not Procore.** Excel is fast, offline, keyboard-driven, infinitely
flexible, and already paid for. To beat it we must be faster at the specific job and remove a
specific fear — arithmetic errors, lost audit trail, version chaos.

Beat Excel at exactly three things:

1. **Structure it can't hold** — the bill hierarchy, the take-off → item link
2. **Memory it doesn't have** — carry-forward, audit trail, revision history
3. **Output it can't produce** — a professional printed bill, a compliant payment certificate

Everything else is a distraction until those three are excellent.

**What success sounds like:** one QS says to another, *"I did this month's valuations in forty
minutes."* That sentence is the entire growth strategy.

### The scoreboard

| Question | Target |
|---|---|
| Time to first printed bill, new user | < 30 min |
| Time to produce a monthly certificate | < 45 min (vs. half a day in Excel) |
| Dimension lines entered per minute, keyboard only | ≥ 8 |
| Grid usable at | 15,000 rows |
| Modules in v1 | ≤ 11 |
| Settings toggles in v1 | ≤ 10 |
| Would a user be upset if it vanished tomorrow? | Yes |

---

## 2. Scope

### 2.1 The eleven modules — this is v1, entire

Auth & Users · Dashboard · Projects · Item Library · Take-off · **Bill of Quantities** ·
Rates & Pricing · Valuations · Variations · Reports & Export · Settings

### 2.2 The "not yet" list

Explicitly out of scope for v1. Good ideas. Not now.

Scheduling / Gantt · Procurement & POs · BIM / 3D · AI take-off · 2D drawing take-off ·
Site diaries · RFIs & submittals · Photos · Safety · Time tracking · Client portal · Mobile app ·
Multi-currency · Multi-language · White-labelling · Marketplace / plugins · Tender issue &
comparison · Final account · CPAP auto-import · Subcontractor bills · Cost report

When one comes up: record it in the parking lot (§8) with a date and who asked, then move on.
**Recording it is how you say no without losing the idea.**

### 2.3 Explicitly never

| Item | Why |
|---|---|
| Full accounting / GL | Integrate with Sage and QuickBooks. Not our fight. |
| Payroll | Same. |
| BIM authoring | Autodesk owns this. Consume IFC; don't create models. |
| Enterprise CPM scheduling | P6 exists. Exchange with it. |
| Competing with Procore on execution | Different market, different buyer, 15 years of head start. |

### 2.4 The three-question test for any new feature

1. **Does a QS hit this in their first week?** If not — later.
2. **Does the product produce a wrong or unprofessional output without it?** If yes — now.
3. **Can it be a report or an export instead of a module?** If yes — make it a report.

Question 3 kills about half of all proposed features. Use it aggressively.

### 2.5 One way to do things

Every task gets exactly one path in the UI. No "you can do this from here, or there, or via bulk
edit, or from the drawer." Multiple paths triple the test surface and confuse users who are already
learning a new tool.

### 2.6 Settings are a failure to decide

Every toggle is a decision pushed onto the user. Pick a sensible default and ship. A setting is
justified only when two real customers genuinely, irreconcilably need opposite behaviour — and even
then prefer a per-project value over a global preference.

**The whole legitimate v1 list:** VAT %, retention %, contract type, decimal places, company
branding, row density.

---

## 3. Users & roles

Six roles. `Membership` joins a user to a tenant with a role; `ProjectAccess` scopes external users
to a single project.

| Role | Scope |
|---|---|
| `owner` | Everything, including billing |
| `admin` | Everything except billing |
| `qs` | Full project work, no user management |
| `viewer` | Read-only |
| `contractor` | Single project — tender pricing and own valuations only |
| `client` | Single project — issued documents only |

External users must never need to learn the full app, and must never cost a seat. Procore's
unlimited-user model exists precisely because per-seat pricing kills external adoption.

---

## 4. Modules & screens

Desktop-first. This is a data-entry tool used on a 24" monitor for hours. Mobile in v1 is
**read-only**; field capture arrives with the mobile app, Phase 7+.

### 4.1 App shell

- **Left sidebar**, 240px, collapsible to 56px, state persisted per user. Global nav when no project
  is open (Dashboard, Projects, Library, Settings); switches to project nav when one is (Overview,
  Take-off, Bill, Pricing, Valuations, Variations, Reports) with a "← All projects" link.
- **Top bar**, 56px: sidebar toggle · breadcrumb · project switcher (search-first — users have 5–50
  projects, a `<select>` is not acceptable) · global search (`⌘K`) · save-state indicator ·
  notifications · user menu.
- **Main pane** — the working area. Usually a dense table, full-bleed.
- **Right drawer**, 480px, resizable 360–800px. Slides in, never a centred modal. Overlays below
  1920px, pushes at ≥1920px. **The QS needs the list and the detail visible at once.**

### 4.2 Auth
Login · forgot/reset password · invite accept (set name + password from an emailed link).

### 4.3 Dashboard
Greeting, then recent projects: name, client, status pill, contract value, last certificate date.
Primary action **New Project**. Search and filter by status.

### 4.4 Projects
- **List** — sortable: name, client, status, value, last activity.
- **New project wizard**, 3 steps: (1) name, client, address, start date; (2) contract type
  (JBCC PBA / JBCC Minor Works / Other), VAT %, retention %, currency; (3) sections — one or more
  blocks, e.g. Block A, External Works.
- **Overview** — header, then tiles: total bill value, certified to date, variations total, current
  contract value. Quick links into each module.
- **Settings** — everything from the wizard, plus archive/delete.

### 4.5 Item Library
Two-pane: trade folder tree left, item table right (code, description, unit, default rate). Item
editor in the drawer. CSV/Excel import with a column-mapping step, preview, confirm.

Full-text search over 20,000+ items, as the user types.

### 4.6 Take-off
The classic dim sheet: `Times × Length × Width × Height = Quantity`, plus description and running
total. Rows added inline, keyboard-first — Tab across, Enter for a new row. Cells accept arithmetic
expressions (`3.2+1.8`), evaluated on blur, **raw expression preserved for the audit trail**.

Each sheet ties to a bill item and a section. Left panel lists sheets by trade. Toolbar: add,
duplicate, **nil** (zero the total, keep the working on record), delete. Footer shows the sheet total
and which bill item it feeds.

Supports deductions and **and-on / borrowed dimensions** — reusing a measured quantity elsewhere so
a change cascades. Cycles must be rejected on write.

### 4.7 Bill of Quantities

**The most important screen in the app.** It gets more attention than everything else combined. If
it's excellent we have a product with rough edges. If it's mediocre, nothing else saves us.

Columns: `Item ref | Description | Unit | Qty | Rate | Amount`.
Hierarchy: Section → Trade → Sub-heading → Item, collapsible and indented.

Row types look different: **heading** (bold, no quantities), **item**, **subtotal** (ruled line),
**provisional sum**, **prime cost**, **note**, **page break**.

Inline editing on description, quantity and rate. A quantity driven by a take-off sheet shows a link
icon and is **read-only** — click opens that sheet in the drawer. Right drawer on row click: full
description editor, rate build-up, notes, source take-off.

Sticky footer: section total, bill total, VAT, grand total.

Mandatory grid requirements are in §7.4. All of them.

### 4.8 Rates & Pricing
- **Rate build-up** — component rows (`Labour / Material / Plant / Subcontract / Other`) with
  quantity and unit rate, then waste %, markup %, computed rate. A manual "plug" override that is
  flagged, never hidden.
- **Pricing overview** — the whole bill with priced / unpriced (amber) / overridden state and a
  persistent unpriced count. Bulk actions: apply a rate set, apply % markup across a selection.

**Nobody prices 4,000 items one at a time.** Bulk application is not optional.

### 4.9 Valuations (payment certificates)
- **Certificate list** — number, period end, gross value, previously certified, due this
  certificate, status.
- **New certificate** — pick period end; the previous certificate carries forward automatically.
- **Valuation entry** — the bill again, with `% complete | Value this cert | Previously | Movement`.
  Enter a %, a quantity, or an amount; the others compute. Trade-level % cascades down to items.
- **Certificate summary** — work executed + materials on site + variations + dayworks = gross;
  less retention; less previously certified = **amount now due**; plus VAT.
- **Issue** locks it permanently. **Certificate PDF** in JBCC format with signature blocks.

### 4.10 Variations
List (VO no., description, date, value ±, status) and detail: description, reason, **instruction
reference and date** — the field you argue from in a dispute two years later — then a mini bill of
added items (library or new star rates) and omitted items picked from the bill.

Supports **quick variations**: an estimated amount certified before the detailed measure is done.
Real projects need this.

Approved variations flow automatically into the next certificate and into contract value.

### 4.11 Reports & Export
Report picker → paper-styled preview → Export PDF / Excel, with an options panel (include rates?
VAT? which sections?).

Reports: Bill of Quantities (blank / priced) · Certificate · Variation register · Cost summary by
trade · Cost per m² · Project financial summary.

### 4.12 Settings
**Company** (name, logo, address, VAT number, banking details — these print on certificates) ·
**Users** (list, invite, role, deactivate) · **Defaults** (retention %, VAT %, contract type, units,
decimal places) · **Standards** (classification the library follows; ASAQS is the SA default).

---

## 5. Money and arithmetic

**The single most important section in this document.** Get this wrong and nothing else matters,
because a QS who hand-adds a column and gets a different answer never trusts the product again.

### 5.1 Storage

| Thing | Type | Notes |
|---|---|---|
| **Money** | `bigint`, **minor units** (cents) | Never float. Never decimal-as-float. Always paired with a currency on the parent record. |
| **Quantities** | `numeric(18,4)` | Declared precision, never float. |
| **Rates** | `bigint` minor units + stored `rate_precision` | Usually 2; sometimes 4 for low-value high-volume items — bricks, fixings. |
| **Percentages** | `numeric(6,4)` | e.g. `0.1500` for 15%. |

### 5.2 The rounding policy — one rule, no exceptions

```
amount = round(quantity × rate)      ← rounded ONCE, at the bill item
```

Every downstream total sums **already-rounded item amounts**. Never round mid-formula within an
item. Never re-round a sum. Every total must be reproducible from its components by hand.

### 5.3 Contractual arithmetic

- **VAT** — applied at **certificate level, not per item**. 15% in SA at time of writing; stored per
  project, never read from settings at print time (a 2026 certificate must still reproduce exactly
  if the rate changes in 2027).
- **Retention** — typically 5–10%, capped by `retention_limit_rate`. Retention must never exceed
  `retention_limit_rate × contract_value`.
- **Defects liability period** — under JBCC this is **90 days from practical completion**, not the
  12 months common under UK/FIDIC forms. **Do not hard-code a default**; take it from the contract.
- **CPAP / Haylett escalation** — Phase 7+, but the formula must match the contract form exactly
  when it arrives.

Each of VAT, retention and escalation needs a documented, tested formula matching the contract form.

### 5.4 Testing

Write **property-based tests** for the money layer. This is the one place to be paranoid. It is also
on the short list of things that get tested thoroughly regardless of coverage targets (§13.3).

---

## 6. Domain model

### 6.1 Conventions — every table, no exceptions

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | primary key |
| `tenant_id` | uuid | on every table |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| `created_by` | uuid → user | |
| `deleted_at` | timestamptz null | **soft delete. Never hard-delete.** |

Nothing is ever really gone — soft-delete for 30 days minimum, with undo on everything destructive.

### 6.2 Entity map

```
Tenant
 └── User ── Membership(role) ── Project
                                   │
     ┌─────────────────────────────┼──────────────────────────┐
     │                             │                          │
     ├── Section ──── Bill ──── BillItem ──┬── Dimension ── DimensionLine
     │                             │       │
     │                             │       └── RateBuildUp ── RateComponent
     │                             │
     ├── Contract ──┬── Certificate ── CertificateLine ──┘
     │              │
     │              └── Variation ──── VariationItem
     │
     └── Document / Drawing (versioned)

LibraryItem (tenant-level, referenced by BillItem)
RateSet ── RateSetItem (tenant-level, applied in bulk)
AuditEvent (polymorphic, append-only)
```

**BillItem is the hub.** Everything downstream reads from it; everything upstream feeds it.

### 6.3 Key entities

**Tenant** — the company. Logo, registration and VAT numbers, address, banking details (all print on
documents), default currency, default VAT and retention rates, classification standard
(`ASAQS | NRM2 | SMM7 | CSI | CUSTOM`).

**Project** — name, `code` (used in document numbering), client, address, status
(`estimating | tendering | in_contract | final_account | closed | archived`), currency, VAT /
retention / retention-limit rates overriding tenant defaults, start and practical-completion dates,
gross floor area (for cost/m²).

**Section** — a block, building or area. Has a `multiplier` (default 1.0 — e.g. 12 identical floors)
and a floor area. Every measurement and bill item belongs to one.

**LibraryItem** — tenant-level reusable catalogue: code, long description (a paragraph, not a
label), unit, trade, default rate, classification code, version.

**Bill** — a container within a project. Type `boq | cost_plan | tender | contract | final_account`,
status `draft | issued | locked`, with `parent_bill_id` — a contract bill is a frozen copy of a
tender bill.

**BillItem** — the central record. `parent_id` for self-referencing hierarchy; **sparse
`sort_order`** (100, 200, 300) so inserts don't renumber everything; `item_ref`; `row_type`;
description; unit; `quantity` + `quantity_source` (`manual | takeoff | imported | ai_derived`);
`rate` + `rate_source` (`manual | build_up | library | rate_set | tender`); `amount` (computed and
stored); `library_item_id` as provenance only; **plus the classification columns in §6.9.**

**Dimension / DimensionLine** — the take-off. A `Dimension` is a sheet with a title, `is_nil` flag,
computed total, `source` (`manual | drawing_2d | bim | ai`) and an optional `drawing_id`. A
`DimensionLine` is a row: description, `times`, `length`, `width`, `height`, the raw `expression`,
computed quantity, `is_deduction`, and `borrowed_from_id` for the and-on pattern.

> **`source` is the whole forward-compatibility story for take-off.** A drawing-derived or
> AI-derived quantity is just another value on this field — not a parallel entity. This is why
> automated take-off can arrive later without reshaping the model.

**RateBuildUp / RateComponent** — build-up belongs to one BillItem (or a LibraryItem as a template),
with waste and markup rates, computed rate, and an `is_overridden` / `override_rate` pair. Components
are typed `labour | material | plant | subcontract | other`.

**RateSet / RateSetItem** — a named reusable price list applied in bulk. Also how a tender return is
stored (`type: internal | tender_return | contract`).

> **Rate provenance is part of the record, not metadata.** Every RateSet carries `source`,
> `effective_date`, `region`, `project_type`, `escalation_basis` and `approval_status`.
>
> This is not bookkeeping. §1.1's case rests on reusing historical rates instead of rebuilding them,
> and **a rate nobody can defend does not get reused** — a QS confronted with a bare number of
> unknown origin will re-derive it, which is exactly the admin we are removing. Provenance is what
> makes the automation trustworthy enough to actually save the time.

**Contract** — one active per project. Form (`jbcc_pba | jbcc_mwa | jbcc_nss | jbcc_ssw | fidic_red |
nec4 | bespoke`), edition, contractor, original value, retention and limit rates, CPAP applicability
and base date, payment terms, signed date.

**Certificate** — number (sequential per project), period end, status
(`draft | issued | paid | cancelled`), `previous_certificate_id` (the carry-forward chain),
`revision_of_id` and `revision`, the full money stack (work executed, materials on site, variations,
dayworks, gross, retention, previously certified, advance recovery, net due, VAT, total due), issue
stamp, and a `snapshot` jsonb holding **the full frozen state at issue**.

**CertificateLine** — contract quantity and rate frozen from the contract bill, `percent_complete`,
quantity and value this period, value previously, value to date.

**Variation** — number, title, description, reason, **`instruction_ref` and `instruction_date`**,
status (`draft | submitted | approved | rejected | superseded`), `is_quick_variation`, estimated and
net values, approval stamp, and `first_certificate_id`.

**AuditEvent** — append-only, never updated, never deleted. Polymorphic entity reference, action
(`create | update | delete | issue | approve | reject | lock`), a `{field: {from, to}}` changes blob,
user, IP, user agent, timestamp.

### 6.4 Invariants — enforce in the database, not just the app

1. **An issued Certificate and its lines are immutable.** Enforce with a trigger, not application
   logic. A correction is a new Certificate with `revision_of_id` set. *This is the most important
   invariant in the system.*
2. `BillItem.amount = round(quantity × rate)` — one rounding, at the item.
3. A Certificate's `previously_certified` equals the sum of the previous certificate's line
   `value_to_date` figures. (Certificate has no header `value_to_date` — derive it.)
4. `Dimension.borrowed_from_id` contains no cycles. Validate on write.
5. A BillItem with `quantity_source = 'takeoff'` has at least one linked Dimension, and its quantity
   is read-only in the UI.
6. Retention never exceeds `retention_limit_rate × contract_value`.
7. Every query is tenant-scoped.
8. Sequential numbers have no gaps within a project. A **cancelled** certificate keeps its number —
   burned, never reissued. A **revision** does not consume a new number: it reuses the parent's
   `number` and increments a separate `revision` int, displayed as "Certificate 07 Rev B".
9. Editing a LibraryItem never retroactively changes an existing BillItem. BillItem copies
   description and rate at insert time and keeps `library_item_id` as provenance only.

### 6.5 Store or derive?

| Value | Decision | Why |
|---|---|---|
| `BillItem.amount` | **Store** | Read constantly; recompute in a transaction on change |
| Section / bill subtotals | **Derive** | Changes too often to store reliably |
| `Dimension.total` | **Store** | Recomputed on line change |
| Certificate totals | **Store, frozen** | A legal snapshot — must never drift |
| Contract current value | **Derive** | `original + approved variations` |
| Cost per m² | **Derive** | Reporting only |

### 6.6 Forward-compatibility — add in Phase 0, unused until Phase 7+

Retrofitting these into a live financial schema costs far more than carrying them unused.

| Entity | Used from | Why now |
|---|---|---|
| `cost_code` (+ `cost_code_id` on BillItem) | Cost reporting | Forecasting and the cost ledger key off cost codes |
| `activity` (+ `bill_item_activity` with `quantity_split`) | Programme | Links bill items to programme activities |
| `document` / `drawing` (versioned, `supersedes_id`) | Drawing take-off | Take-off must reference the drawing it came off, from day one |
| `location` (finer than Section) | Cost reporting | Location-based costing |

### 6.7 Indexes that matter

```sql
create index on bill_item (bill_id, sort_order) where deleted_at is null;
create index on bill_item (bill_id, parent_id);
create index on bill_item (tenant_id, bill_id);
create index on dimension_line (dimension_id, sort_order);
create index on certificate_line (certificate_id, bill_item_id);
create index on audit_event (entity_type, entity_id, occurred_at desc);
create index on library_item using gin (to_tsvector('english', description));
```

### 6.8 Scale — design for these, not toy data

| Thing | Realistic volume |
|---|---|
| Bill items in one project | 2,000 – 15,000 |
| Dimension lines in one project | 10,000 – 100,000 |
| Library items | 20,000+ |
| Drawings per project | 500 – 5,000 sheets |
| Certificates per project | 12 – 36 |
| Concurrent editors on one bill | 2 – 5 |

### 6.9 Classifications are dimensions, not reports

**Element · trade · work group · WBS code · building · floor · zone · phase · work package ·
procurement package · cost status** are **attributes of one dataset**, pivotable at query time.
They are not separate report modules.

Both incumbent analyses arrived at this independently — WinQS ships it as a whole separate
"Advanced Cost Analysis" module because its architecture forces that; the DimensionX analysis says
plainly to *"treat these classifications as dimensions of the same data rather than separate
reports."* We get to do it the right way round because we are starting fresh.

**The test: adding a new way to slice the project must require no new report code.**

Get this wrong and §4.11's "cost summary by trade" and "cost per m²" become two bespoke reports —
and the third and fourth requests each need another. Get it right and an elemental analysis, a
benchmarking cut and a management summary are all one query with a different `group by`.

**In Phase 0**, `BillItem` carries these as nullable columns, indexed where they will be grouped on:

| Column | Notes |
|---|---|
| `element` | Substructure, frame, envelope, finishes — the elemental cost-plan axis |
| `trade` | The trade breakdown axis. Already how the library is organised |
| `work_group` | ASAQS work group |
| `wbs_code` | Free-text work breakdown reference |
| `work_package` | Procurement grouping |

Building / floor / zone come from `Section` and later the finer `location` table (§6.6); phase and
cost code are reserved there too. **All of them are nullable and unused by v1 UI** — cost analysis
itself is Phase 7+. What ships in Phase 0 is the *shape*, because adding classification columns and
their indexes to a live financial schema is the expensive version of this.

### 6.10 Seed data

**There is no seed data (§1.3).** A development database is populated by *executing a run against
real documents*. A UI proven against invented rows has been proven against nothing, and fabricating
a project's figures is exactly the blank-form behaviour the doctrine forbids.

**In practice:** development runs against a small corpus of real project documents held outside
version control (§14 confidentiality). Where a test needs deterministic input it uses an explicit
fixture, named as one.

**The volumes above still govern the design.** The grid, the indexes and the queries are built for
them, and load-tested against generated rows in a throwaway database — never against rows shown to
a user as if they were a project.

---

## 7. Design system

Numbers here are requirements, not suggestions.

### 7.1 Principles

1. **Density over whitespace.** A professional tool used eight hours a day. Screen space is for data.
2. **The grid is the interface.** Most screens are a table. Make the table excellent.
3. **Keyboard first.** Every frequent action has a shortcut; grids are fully navigable mouse-free.
4. **Drawer, not modal.**
5. **Colour means exactly one thing.** Never colour alone — always with text or an icon.
6. **The printout is the product.**
7. **Quiet by default.** No gradients, no shadows-on-shadows, no animation for its own sake. This is
   a financial instrument and should feel like one.

### 7.2 Tokens

**Colour** — neutral-first with a single accent. Deep slate-blue: serious, prints legibly, not a
startup purple.

```
--n-0:#ffffff  --n-25:#fcfcfd  --n-50:#f7f8fa  --n-100:#eff1f4  --n-200:#e2e5ea
--n-300:#c9ced6 --n-400:#9aa2ae --n-500:#6b7482 --n-600:#4d5561 --n-700:#343b45
--n-800:#21262e --n-900:#14181e

--a-50:#eef4fb  --a-100:#d6e6f6  --a-300:#7fb0e0
--a-500:#2f6fb5 (primary)  --a-600:#255a94 (hover)  --a-700:#1c4472 (active)

--ok-50:#e9f7ef   --ok-500:#1f8a4c   --ok-700:#166638
--warn-50:#fdf4e3 --warn-500:#b57d13 --warn-700:#8a5f0e
--err-50:#fdeceb  --err-500:#c93b34  --err-700:#9c2d27
--info-50:#eef4fb --info-500:#2f6fb5
```

**Semantic roles — fixed, do not improvise:**

| State | Colour | Where |
|---|---|---|
| Draft / neutral | Grey `--n-500` on `--n-50` | Unissued records |
| In progress / submitted | Accent `--a-500` on `--a-50` | Active workflow |
| Attention / unpriced / due soon | Amber `--warn-500` on `--warn-50` | Needs action |
| Approved / certified / paid | Green `--ok-500` on `--ok-50` | Complete |
| Rejected / overdue / over budget / omission | Red `--err-500` on `--err-50` | Negative |
| Issued / locked | `--n-600` + lock icon | Immutable |

**Spacing** — base unit 4px, every gap a multiple:
`4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64`

**Typography** — Inter (required for real tabular figures; any substitute must have them).

| Token | Size / line-height | Weight | Use |
|---|---|---|---|
| `--t-xs` | 11 / 16 | 400 | Dense metadata, badges |
| `--t-sm` | 12 / 16 | 400 | Captions, grid headers, help text |
| `--t-base` | **13 / 18** | 400 | **Grid body — the most-used size in the app** |
| `--t-md` | 14 / 20 | 400 | Forms, body copy |
| `--t-lg` | 16 / 22 | 600 | Section headings |
| `--t-xl` | 20 / 28 | 600 | Page titles |
| `--t-2xl` | 28 / 34 | 600 | KPI numbers |

**Never below 11px anywhere. Never below 13px for anything read repeatedly.**
All numerics: `font-variant-numeric: tabular-nums; text-align: right;`

**Radius** 3 / 5 / 8 / 999px · **Motion** 60ms hover, 150ms dropdown, 200ms drawer — nothing longer,
and respect `prefers-reduced-motion` · **Z-index** base 0 · sticky 10 · dropdown 100 · drawer 200 ·
modal 300 · toast 400 · tooltip 500.

Prefer borders to shadows for structure.

### 7.3 Layout & breakpoints

Top bar 56px · sidebar 240px / 56px collapsed · drawer 480px (resizable 360–800) · page gutter 24px
desktop, 16px mobile · forms max 720px centred, grids full-bleed.

| Name | Width | Behaviour |
|---|---|---|
| Field | <768px | Single column, read + field capture only. No grid editing. |
| Tablet | 768–1279px | Sidebar auto-collapses. Read-heavy. |
| Desktop | 1280–1919px | Full app. Drawer overlays. |
| Wide | ≥1920px | Full app. Drawer pushes content. |

**Primary design target: 1440 × 900.**

### 7.4 The data grid — mandatory requirements

| Property | Value |
|---|---|
| Row height | **32px** default · 28px compact · 40px comfortable (persisted per user) |
| Header | 36px, 12px, weight 600, uppercase, letter-spacing 0.03em |
| Cell padding | 6px vertical / 12px horizontal |
| Font | 13px |
| Borders | Between rows only; no vertical borders except group boundaries |
| Zebra striping | **Off** — it fights hierarchy indentation |
| Hover | `--n-25`, 60ms |
| Selected row | `--a-50` bg, 2px `--a-500` left border |
| Focused cell | 2px `--a-500` inset ring |
| Sticky header + totals footer | Yes; footer 40px, `--n-50`, strong top border |
| Virtualisation | **Required** |

**All of these are mandatory:**
- 15,000 rows without lag
- Full keyboard navigation
- Inline editing, no modal
- **Paste a multi-cell block from Excel** — if a QS can't paste a column from Excel, they won't use
  the product
- Undo/redo across ≥50 operations
- Collapse/expand groups with subtotals that stay correct
- Right-aligned tabular numerals in every numeric column
- Columns resizable, reorderable, hideable — persisted per user per grid

**Keyboard map:**

| Key | Action |
|---|---|
| `↑ ↓ ← →` | Move cell |
| `Tab` / `Shift+Tab` | Next / previous cell, wraps rows |
| `Enter` | Edit → commit and move down |
| `Escape` | Cancel edit |
| `⌘/Ctrl + C / V` | Copy / paste, multi-cell blocks from Excel |
| `⌘/Ctrl + D` | Fill down |
| `⌘/Ctrl + Z / Shift+Z` | Undo / redo |
| `Space` | Toggle row selection |
| `⌘/Ctrl + A` | Select all |
| `⌘/Ctrl + ↑/↓` | First / last row |
| `Alt + ←/→` | Collapse / expand group |
| `Delete` | Clear cell contents |

**Money cell:** right-aligned, tabular, thousands separator, 2dp, currency symbol in the header only,
negatives as `(1 234,56)` in `--err-500`.

**Hierarchy rows:** 16px indent per level, chevron for collapsible groups, heading rows bold with no
numeric values, subtotal rows with a strong top border and `--n-50` background.

### 7.5 Other components

- **Right drawer** — header (title, ref, status pill, close), scrollable body, sticky action footer.
  **Arrow keys in the list move the drawer's record without closing it** — this is what makes
  reviewing 200 records tolerable. `Escape` closes.
- **Status pill** — 20px, `--r-full`, 11px/500, semantic 50-tint bg with 500-tint text.
  **Always includes text.**
- **Ball-in-court chip** — 24px avatar + name + elapsed time. Amber past due, red past 2× due. The
  single highest-value accountability component in construction software.
- **Empty state** — centred, max 360px: icon, headline saying what goes here, one line of
  explanation, primary action, optional "or import from Excel". **Every list gets one. No blank
  canvases anywhere.**
- **Numeric inputs accept arithmetic expressions**, evaluated on blur, raw expression preserved.
- **Save indicator** — "All changes saved" / "Saving…" / "Offline — 3 pending".
- **Skeletons**, not spinners, wherever the shape is known.

### 7.6 Print / document preview

Renders on `--n-100` with a white A4 sheet (210 × 297mm), page boundaries visible. Serif or clean
sans at 9–10pt equivalent. Repeating column headers on every page. **"Carried forward" /
"Brought forward" subtotals across page breaks.** Footer with practice name, project, page X of Y,
generation date. Signature blocks on certificates.

**This screen gets as much design attention as the grid.** Budget real engineering time — it is not
"just a PDF export."

### 7.7 Voice

| Rule | Example |
|---|---|
| Buttons are verbs | "Issue certificate", not "Submit" |
| Say the domain word | "Bill of Quantities", not "Item list" |
| Errors say what to do next | "Rate required before this item can be certified" |
| Confirmations state the consequence | "Issue certificate 07? It cannot be edited afterwards." |
| Numbers use locale format | `R 1 234 567,89` |
| Dates | `12 Aug 2026` in UI · ISO in exports · never `08/12/26` |
| No exclamation marks, no emoji, no "Oops" | This is a legal-document tool |

### 7.8 Accessibility — non-negotiable

WCAG 2.2 AA. Text contrast ≥4.5:1, UI ≥3:1. Visible focus on every interactive element. Full keyboard
operability including grids and drawers. Proper table semantics with `aria-rowcount`/`aria-colcount`
when virtualised. Screen-reader announcements for autosave, errors and row-count changes. Never
colour alone. Respect `prefers-reduced-motion` and `prefers-color-scheme`. Min tap target 44×44px.

### 7.9 Performance budgets — requirements, not aspirations

| Metric | Target | Ceiling |
|---|---|---|
| First contentful paint | <1.0s | 2.0s |
| Time to interactive | <2.0s | 3.5s |
| Grid render, 10,000 rows | <300ms | 800ms |
| **Keystroke → cell update** | **<16ms** | 50ms |
| Autosave round trip | <500ms | 2s |
| Drawer open (first paint) | <100ms | 200ms |
| Search results | <200ms | 500ms |
| PDF, 200-page bill | <5s | 15s (else background + notify) |
| JS bundle, initial | <250KB gzip | 400KB |

A QS enters thousands of lines. **200ms of latency per keystroke is a dealbreaker no feature can
offset.**

### 7.10 Component build order

1. Tokens, theme, typography scale
2. Button, input, select, checkbox
3. **Data grid** — budget the most time here by a wide margin
4. Right drawer
5. Status pill, ball-in-court chip
6. App shell
7. Empty states, skeletons, toasts
8. Library item picker
9. Dimension entry row
10. Print / document preview
11. KPI tile, charts

---

## 8. Build order

Finish each phase **completely** before starting the next. A half-built valuations module produces
wrong numbers on a legal document — worse than no module at all.

> **Correction of record.** An earlier version of this table put the Bill of Quantities first,
> inherited from a source document that describes a conventional QS application. That is the wrong
> starting point for **this** platform: §1.3 makes it agent-driven and §1.4 makes **D1.1-SP-001**
> the first process in the model we implement. The BoQ is real and downstream. Phase 1 below is the
> feasibility run.

| Phase | What | Weeks |
|---|---|---|
| **0** | **Foundation** — schema with the full conventions, auth, design tokens, base inputs, app shell, CI, error tracking. **No seed data** (§1.3) — a development database is filled by executing a run | 2–3 |
| **1** | **D1.1-SP-001 — the feasibility run.** Upload → Analyse → Review → Generate → Output, end to end, with the QS-gate loop returning spec-adjustment options rather than a bare failure | — |
| **2** | **Bill of Quantities** — project CRUD + wizard, sections, library with CSV import, **the data grid at full spec**, bill structure, library picker, manual quantity/rate entry, live totals, print preview + branded PDF, Excel import and export, audit trail | 6–8 |
| **3** | **Take-off** — dim sheets, entry grid, deductions, and-on with cycle validation, sheet→item link, change cascade, sheet printout | 3–4 |
| **4** | **Rates & pricing** — build-up editor, plug override, rate sets applied in bulk, bulk markup, unpriced highlighting, tenant-level rate library, pricing overview | 3–4 |
| **5** | **Valuations — JBCC PBA only** (§17.1) — contract setup, certificate list and creation, **carry-forward**, valuation entry with trade cascade, materials on site, retention with limit, advance recovery, summary, **issue → immutable lock**, revisions, JBCC PDF, payment recording | 6–8 |
| **6** | **Variations** — CRUD with instruction ref, additions/omissions/star rates, **generic approval engine built once and reused**, status history, auto-flow into certificates, quick variations, register, contract value updates | 3–4 |
| **7** | **Reports & polish** — report library, options and saved configs, Excel export everywhere, share-by-link, dashboard, onboarding with templates, empty/skeleton/error states, performance pass | 3–4 |

**v1 ≈ 26–35 weeks.**

### Exit criteria

- **Phase 0** — a developer logs in, sees an empty shell, and the seeded 15,000-item bill exists.
- **Phase 1** — a QS produces a printed, priced 1,500-item bill in under 4 hours; the grid is
  comfortable at 15,000 rows; the PDF is indistinguishable from a professionally produced bill; an
  existing Excel bill imports without re-keying. **This is the first sellable product — consider
  shipping it alone.**
- **Phase 2** — ≥8 dimension lines per minute, keyboard only. Editing a dimension visibly updates
  the bill.
- **Phase 3** — a 4,000-item bill priced from a saved rate set in under 10 minutes.
- **Phase 4** — a monthly certificate on a 3,000-item bill in under 45 minutes. An issued
  certificate cannot be altered by any path. **A practising QS confirms the JBCC output is
  compliant.**
- **Phase 5** — an approved variation appears in the next certificate with no manual re-entry.
- **Phase 6** — a new user produces a printable output within 30 minutes of signup, unassisted.

### Stop. Do not start Phase 7 until

10 paying customers · 3 of them have completed a full project lifecycle in the product · weekly
certificates are being issued by people who are not you · you know from usage data which two things
they ask for most.

### Phase 7+ parking lot, best guess at order

Tender issue & comparison (6–8w) · Final account (4–6w) · **CPAP / Haylett auto-import (2–3w)** ·
Subcontractor bills (4–6w) · **2D drawing take-off (8–12w)** · Cost report / budget vs actual (4–6w) ·
Mobile app (8–10w)

Then: client portal · multi-currency · AI take-off · FIDIC & NEC forms · cost plans / elemental
estimating · programme · procurement · accounting integration · RFIs & submittals · document version
control · daily logs · safety · BIM/IFC take-off · public API & webhooks.

### Parked deliberately — from the incumbent analysis

Capabilities the incumbents have that we are **choosing** not to build in v1. Recorded so they are
decisions rather than oversights.

| Capability | Why parked |
|---|---|
| **Configurable bill layouts** — architectural vs engineering formats, configurable columns, wording and units | v1 ships one bill layout, done well. Real WinQS capability and a genuine ask in engineering work; revisit when a customer with civils work turns up |
| **JBCC notifications, recovery statements, completion certificates** | v1 issues payment certificates only. **Note the adjacency:** Phase 4 already calculates advance-payment recovery, so the recovery *statement* is a printout of something we will already hold — likely a Phase 6 report rather than new machinery |
| **ASAQS Model Bills / JBCC prelims as shipped content** | **Deliberate exclusion, not an oversight.** §2 and §9 hold the line: standards are referenced by code and section, never embedded. Firms' own libraries get first-class support; published standards get a pointer |
| **Richer quantity basis** — benchmark, assumed, awaiting design information | Ours is `manual \| takeoff \| imported \| ai_derived`. The wider set matters for elemental cost planning, which is Phase 7+. Extend the enum then |
| **Tender analysis specifics** — highest/lowest rate per item, % variance by section, user-defined abnormality thresholds, "items making up X% of value" | Tender is Phase 7+. Recorded here in detail so the analysis does not have to be re-derived from the incumbent when it arrives |
| **Estimate ↔ BoQ linkage** — a composite elemental rate deriving from its underlying bill items | The heart of WinQS's cost-planning module and genuinely good. Belongs with cost plans, Phase 7+ |

### Parking lot log

Anything requested but out of scope goes here immediately, with a date and who asked.

| Date | Request | From | Notes |
|---|---|---|---|
| | | | |

### Release cadence

Weekly to production once Phase 1 ships. Feature flags only for genuinely incomplete work, removed
within two weeks. **Never deploy on a Friday, and never during month-end week** — when every user is
issuing certificates.

---

## 9. Vocabulary

Construction terminology is jurisdiction-specific and unforgiving. **Use the user's word, not a
generic software word.** The wrong word tells a professional the product wasn't built by someone who
understands their work, and they will not forgive it.

### 9.1 Naming rules for the codebase

| Concept | Use | Never |
|---|---|---|
| The measured schedule | `Bill`, `BillItem` | `LineItem`, `Task`, `Entry` |
| A measurement | `Dimension`, `DimensionLine` | `Measurement`, `Row` |
| The payment document | `Certificate` | `Invoice`, `Payment`, `Bill` |
| A scope change | `Variation` | `ChangeOrder` (unless US-localised) |
| A catalogue entry | `LibraryItem` | `Product`, `Template`, `Preset` |
| The price of an item | `rate` | `price`, `cost`, `unitPrice` |
| Quantity × rate | `amount` | `total`, `value`, `sum` |
| Money withheld | `retention` | `holdback`, `retainage` |
| A saved price list | `RateSet` | `PriceList`, `Pricebook` |
| Pre-measure estimated variation | `quick variation` | `provisional variation` |

> **"Bill" is dangerously overloaded.** In QS usage it's the Bill of Quantities; in accounting it's
> an invoice. Never use `Bill` for anything financial here.

**Exception to the `value` ban:** `Certificate` and `CertificateLine` use `value_this_period`,
`value_previously`, `value_to_date`, `gross_value` — established certificate terminology, keep them.
The ban applies to bill-item arithmetic, where the correct word is `amount`.

### 9.2 Terms that must be got right

**Take-off** — measuring quantities from drawings. **Squaring** — multiplying dimensions out.
**Abstracting** — collecting squared dimensions into item totals. **Billing** — writing them up
formally. **And-on / borrowed dimension** — reusing a measured quantity so a change cascades.
**Nil-ing** — zeroing a sheet's total while keeping the detail on record. **Star rate** — a newly
negotiated rate for work with no comparable bill item. **Prelims** — project-wide costs not attached
to a work item; typically 8–15% of a contract. **Provisional sum** — allowance for work not yet
designed. **Prime cost (PC) sum** — allowance for goods from a nominated supplier.
**Remeasurement** — measuring what was built rather than what was drawn. **Dayworks** — work paid at
cost of labour + materials + plant plus a percentage.

**SA-specific:** **ASAQS** (publishes the model bills / standard system of measurement) ·
**SACQSP** (statutory registration body) · **JBCC** (the dominant SA building contract suite:
PBA, MWA, N/S Subcontract, Small & Simple Works) · **CPAP** (the formula-based escalation mechanism)
· **Haylett formula and indices** (from Stats SA) · **SANS 1200** (civils measurement) ·
**Principal Agent** (administers the contract and issues certificates — often the architect,
frequently the QS).

---

## 10. Drawing intelligence

**Phase 7+ for the feature. Phase 0 for the schema.** The `document`/`drawing` tables and
`Dimension.source` exist from the first migration precisely so this can arrive without reshaping
anything.

What follows is **measured, not assumed** — probed against a real A1 architectural drawing
(Monaghan Farm staff housing, 706ST-002B Rev B, floor plan at 1:100 plus four elevations). It is
recorded here because it changes what the eventual feature can promise.

### 10.1 There is no extractable text

```
117,756 vector paths · 0 images · 0 text blocks
```

Every character on the sheet — notes, dimension values, room labels, title block — is drawn as
**stroked line segments in a CAD stick font**. There is no font, no encoding, no text layer.

**Any approach built on PDF text extraction returns nothing on this file, and this file is typical
of plotted CAD output. OCR against rendered raster is mandatory.**

### 10.2 But the geometry is exact

100% strokes, zero fills, pure black, 117,756 straight segments and zero curves. This is a
monochrome pen-plot: **we have the CAD geometry itself, not an image of it.**

Separating drawing geometry from glyph strokes is trivial by bounding box:

```
115,063 paths < 12pt bbox   → stick-font glyph strokes
  2,693 paths larger        → building geometry, dimension lines, borders
  1,589 segments > 20pt, of which 96% axis-aligned (712 h · 813 v · 64 diagonal)
```

Pen weight survives plotting as a proxy for CAD layer — walls at 0.96pt, dimension lines at 0.48pt.

### 10.3 Walls are findable

At 1:100 a 230mm brick wall is 6.52pt on paper. Searching parallel axis-aligned pairs with
overlapping runs, then merging bins that plotting jitter split:

```
6.53pt × 191 pairs = 230.4mm   ← external / party wall
2.55pt × 200 pairs =  90.0mm   ← internal wall
```

Both real wall thicknesses fall out of the geometry, landing on standard SA masonry dimensions to
within half a millimetre.

### 10.4 Scale must be self-calibrated

The plan's overall dimension is annotated `35245`mm. At 1:100 that is 999.1pt. A segment of
**999.1pt** exists — an exact match, 0.01% drift.

So the drawing is plotted true to its stated scale — **but we verified rather than trusted, which is
the point.** Plots get resized to fit paper, reissued at other sheet sizes, and stamped "DO NOT
SCALE" for good reason. A stated scale is a hint; a calibration measured off the drawing's own
dimension lines is evidence a QS can check by hand.

Tolerance must be tight (0.5%, not 5%): for any annotated dimension, segment length varies
continuously, so something always lands near 1:500 by coincidence. A warning that fires wrongly is
worse than no warning.

### 10.5 What this means for the feature

- The **manual path must always exist.** QSs don't trust black boxes, and an automated quantity is
  worthless without a reviewable dimension calculation behind it.
- Every extracted quantity is a **proposal with confidence and provenance**, accepted by a human.
  That is what `Dimension.source` and the versioned `drawing` table are for.
- **Cross-checks exist in the drawing itself and should be used:** dimension chains must sum to
  their stated overall; the schedule of areas is a stated total to check computed areas against;
  plan and elevations share dimensions; multiple independent scale calibrations must agree or the
  sheet is not uniformly scaled and we say so.
- **A vector CAD plot is the good case.** Scanned and image-only PDFs need a different front end and
  will always be less reliable. The pipeline must detect which it has and report it.
- **DWG/DXF/IFC are strictly better inputs than PDF** — they carry layers, blocks and object
  semantics we are reconstructing by inference. PDF is what we can rely on receiving, not what we
  would choose.

---

## 11. Market context

Construction software splits into six layers — Design & BIM, Preconstruction, Project execution,
Field-first, Financial & ERP, Payments & risk. Almost every product lives in one or two and pretends
to cover the rest.

**The gap this platform is built into:**

1. **US platforms can't do quantity surveying.** Procore and Autodesk Construction Cloud have no
   Bill of Quantities, no JBCC/FIDIC certificate, no CPAP, no remeasurement, no final account. In
   every Commonwealth and Middle-Eastern market that is the core professional workflow.
2. **SA/Commonwealth QS platforms can't do project execution.** WinQS and QS Plus have no RFI
   workflow, no drawing version control, no mobile field app, no client portal. Candy is the
   exception on reach (RIB has moved it toward cloud) but remains estimating-and-planning, not
   field execution.
3. **Nobody has combined them.** A product doing a proper Bill of Quantities *and* a proper RFI, in
   one cloud app, does not currently exist in any market.
4. **Pricing is the wedge.** Procore wins on unlimited users priced by construction volume. SA QS
   software is still largely per-seat, WinQS on hardware dongles. Unlimited users on a volume-priced
   subscription would be structurally disruptive here.
5. **AI take-off resets the field.** Any estimating product built in 2026 requiring 100% manual
   measurement is born obsolete. Build the manual path first — it must always exist — but model an
   AI-derived quantity as just another `source` value.

**Sequencing implication:** build the QS core first — it's the defensible, hard, unserved bit — keep
the execution layer's data model in mind, and add it once the core has users. **Do not try to
out-Procore Procore on day one.**

### What to steal, specifically

**Ball-in-court** (Procore) — every record shows whose desk it's on right now. One UI concept that
does more for accountability than any dashboard. **Unlimited users** (Procore) — everything else
follows from it. **Drawing version control with auto-overlay** (Procore) — upload a revised sheet, it
auto-detects the number, supersedes the old one, carries markups forward. **The unalterable audit
trail** and correspondence-as-legal-record framing (Oracle Aconex). **Studio Sessions** (Bluebeam) —
a whole team marking up one drawing live. **The task primitive** (Fieldwire) — one concept endlessly
reused, versus Procore's fifteen record types. **Marketing a number, not a feature list** (Raken:
"the daily report takes 5 minutes instead of 45"). **WIP and over/under-billing reports** (Sage) —
how a contractor's banker judges them, and almost no PM tool produces them properly.

### Why construction software dies

1. **Office-first design** — built for a desk; doesn't work in mud, in gloves, on a ladder.
2. **No user benefit** — feeds management dashboards, gives the crew nothing back.
3. **Login overload** — for a subcontractor you are login number seven.
4. **Process misalignment** — *when the software fights the workflow, the workflow wins.*
5. **Data silos** — disconnected tools get abandoned first.

---

## 12. Integrations

### Tier 1 — do these or the product doesn't sell

**Excel / CSV import & export**, bidirectional, on every list — the universal escape hatch,
non-negotiable · **PDF export**, branded and print-accurate · **Email** — send documents and
certificates from the app · **Accounting: QuickBooks Online, Xero, Sage/Pastel** · **File storage:
Google Drive, OneDrive/SharePoint, Dropbox** · **Calendar: Google / Outlook**

> Import/export feels like it helps users leave. It's the opposite — it's the only reason they'll
> risk coming in. **A QS with 20 years of bills will not adopt a product that can't ingest them.**

**What Excel import is for, precisely:** migration and trust. A QS arrives with existing bills and
must be able to bring them in without re-keying, and must believe they can get their data back out.
It is not a commitment to stay structurally compatible with another vendor's export format (§1.2) —
the importer maps *into* our structure, and where a source file carries something we don't model, we
say so rather than distorting the schema to hold it.

### Tier 2 — expected by mid-market

Bluebeam round-trip · MS Project + Primavera P6 (XER/XML) · IFC import · Payments (Stripe; in SA
PayFast, Yoco, Ozow) · E-signature (DocuSign, Adobe Sign) · SSO (Google, Entra, SAML) ·
**WhatsApp Business API — in South Africa this outranks Slack by a wide margin** · Slack / Teams

### Tier 3 — differentiators

**Stats SA Haylett indices** for CPAP (SA-specific, genuinely defensible) · materials supplier
catalogues (Builders, Cashbuild, BUCO) · bargaining council wage rates · weather API · payroll
(SimplePay) · CRM · BI export

### Per-integration quality bar

Field mapping user-visible and editable · sync direction explicit · conflicts surface for human
resolution, never silent overwrite · failures visible in the UI with retry, **never fail silently** ·
sync history log · disconnect leaves data intact · sandbox mode.

---

## 13. Engineering rules

### 13.1 The stack — chosen once, not revisited

**No Kubernetes, no microservices. A monolith until there is a measured, specific reason otherwise.**

| Layer | Choice | Why |
|---|---|---|
| Repo | `X4OConsulting/qs-management-platform`, private | Company IP, same org as related work |
| App | **Next.js (App Router) + TypeScript strict** | One framework for UI and server. Runs as a plain Node server in a container, not serverless |
| **Data grid** | **AG Grid Enterprise** | Ships §7.4's mandatory list — range selection, Excel clipboard, undo/redo, tree data with aggregation, column state persistence — out of the box. §13.2 names the grid as a place a library is always right. Licence ~$1k/dev/yr; cheap against the months those features cost to build |
| Database | **PostgreSQL 16 + pgvector** | Relational to its bones, and the corpus lives in the same database as the runs that cite it (§1.3.2). Host is interchangeable — pgvector runs on local, Neon, RDS and Render alike |
| Retrieval | **Hybrid — Postgres FTS + pgvector**, fused | Exact identifiers (`SANS 1200`, `25 MPa`, a rate) are what lexical search is for; embeddings blur them. §1.3.2 |
| ORM | **Drizzle** | TypeScript-first schema, readable SQL migrations committed to the repo |
| Styling | **Tailwind**, tokens from §7.2 | Density enforced by tokens, not ad-hoc classes |
| **PDF** | **Headless Chrome + server-composed pages** | Domain code computes pagination and carried-forward subtotals, then emits explicit page elements Chrome renders. **Print output and on-screen preview are the same HTML and CSS** — which is what §7.6 requires — and pagination stays a tested domain calculation, not a CSS side effect |
| Hosting | **Single container** (Railway or Render) | One long-running Node process. Headless Chrome and background jobs need no special handling, and there are no cold starts to fight against the <5s PDF budget |
| Decimal maths | A decimal library for quantity arithmetic | Money is `bigint` minor units (§5.1); quantities are `numeric(18,4)` and need exact decimal handling in TS |

**Deliberately not chosen yet:** auth provider, error tracking, email delivery. Each is a Phase 0
task with an obvious default and no architectural consequence.

### 13.2 Code discipline

- **No premature abstraction.** Write it concretely, write it concretely a second time, **abstract on
  the third occurrence**, never before.
- **No dependency without justification.** Can it be 40 lines of our own code? Then write the 40
  lines. Exceptions where a library is always right: the data grid, PDF generation, date handling,
  decimal maths, auth.
- Smallest change that works. One concern per commit. If a file passes ~400 lines, ask whether it's
  doing two jobs.
- **Match existing patterns over introducing a better one** — consistency beats local optimality.
- Don't refactor unrelated code in a feature change.

### 13.3 Test what breaks trust

Don't chase coverage. Test these **thoroughly**: all money and quantity arithmetic · certificate
generation end to end · carry-forward between certificates · permissions and tenant isolation ·
import/export round-trips · the grid at 15,000 rows.

Everything else gets light testing. That list gets paranoid testing.

### 13.4 Never lose a user's work

Autosave everything — **no explicit save button anywhere**. Optimistic UI. Connection drop queues
locally and retries with a visible "3 changes pending". Undo on everything destructive including
deletes. Soft-delete for 30 days.

### 13.5 Observability from day one

Error tracking, structured logs, one dashboard with six numbers: signups, projects created, bills
printed, certificates issued, p95 grid render time, error rate. Look at them weekly.

### 13.6 When uncertain about domain rules — ask, don't guess

Construction contract logic is unintuitive and jurisdiction-specific. Getting retention, CPAP or a
certificate calculation wrong produces a **legally incorrect document**. A wrong guess is worse than
a delay.

---

## 14. Definition of done

A feature is done when **all** of these are true:

- [ ] Works with realistic data volumes (§6.8), not 5 test rows
- [ ] Keyboard accessible end to end
- [ ] Loading, empty and error states exist
- [ ] Money maths tested
- [ ] Autosaves; survives a refresh mid-edit
- [ ] Exports to Excel/PDF if it's a list or a document
- [ ] Audit trail written if it touches money or a contract
- [ ] Works at 1280px wide
- [ ] **Someone who is not the builder completed the task without help**

That last one is the real test. The rest are prerequisites for it.

### The anti-patterns — the specific ways this project fails

| Anti-pattern | What it looks like | Antidote |
|---|---|---|
| **Procore envy** | "We should add RFIs / photos / scheduling" in month two | §2.2 — write it in the parking lot |
| **Demo-driven development** | Building what looks good in a screenshot | Build what a QS uses on a Tuesday |
| **The 90% module** | Five modules each 90% done | Finish one. Ship it. Then start the next. |
| **Settings creep** | A preferences page with 40 toggles | §2.6 |
| **Float money** | `0.1 + 0.2 !== 0.3` in a certificate | §5 |
| **Toy-data design** | Grid designed against 20 rows, dies at 5,000 | Seed 15,000 rows from day one |
| **The rewrite** | "The architecture is wrong" in month six | §13.1, §13.2 |
| **Feature flags as indecision** | Everything behind a flag, nothing finished | Ship or delete |
| **Ignoring the printout** | Beautiful UI, embarrassing PDF | §7.6 |
| **Building for the buyer, not the user** | Dashboards for the director, friction for the QS | The daily user decides whether it survives |

---

## 15. Decisions and conflicts resolved

Where sources disagreed, this is what was chosen and why. Recorded so it isn't re-litigated.

| # | Conflict | Resolution |
|---|---|---|
| 1 | **Money storage.** An earlier working decision used Postgres `numeric` + decimal.js for both money and quantities. | **`bigint` minor units for money and rates; `numeric(18,4)` for quantities** (§5.1). The deciding factor is the rounding policy that comes with it — round once at the item, never re-round a sum. `numeric` alone doesn't specify where rounding happens, and that is precisely what makes a hand-added column match. |
| 2 | **`Measurement` as a traceability entity.** An earlier model proposed a separate `Measurement` entity with persistent identity across drawing revisions. | **Dropped.** `Dimension` / `DimensionLine` with a `source` field carries the same capability with one fewer entity, and the vocabulary rules explicitly ban the word `Measurement` (§9.1). Persistent identity lives on `Dimension`; the drawing link is `drawing_id`. |
| 3 | **When drawing take-off gets built.** An earlier plan put a drawing engine on a parallel track from day one. | **Phase 7+ for the feature; Phase 0 for the schema** (§6.6, §10). The forward-compatibility tables and `Dimension.source` carry the option forward at near-zero cost. The engine itself waits for paying customers. |
| 4 | **Service architecture.** An earlier design had a separate Python service alongside the web app. | **Monolith** (§13.1). Moot for v1 given #3. Revisit only when drawing analysis is actually being built, and only with a measured reason. |
| 5 | **Multi-tenancy enforcement.** Source documents require query-layer enforcement, tested explicitly. Current direction is single-tenant for the foreseeable future. | **Columns now, enforcement later.** `tenant_id` on every table from the first migration — the part that is expensive to retrofit. RLS and query-layer enforcement deferred. **This is an open item** (§17). |
| 6 | **Roles.** Two source documents listed 4 and 6 roles. | **Six** (§3), plus `Membership` and `ProjectAccess`. |
| 7 | **Two versions of the UI spec.** | The **later** one governs: adds `final_account` / `archived` statuses, dayworks in the certificate stack, JBCC N/S, project `code`, gross floor area. |
| 8 | **Defects liability period.** | **90 days under JBCC**, not the 12 months common under UK/FIDIC forms. **Do not hard-code** — take it from the contract (§5.3). |

---

## 16. Source documents

Everything above is distilled from these. They remain useful for depth; this file governs.

| Source | What it contributed |
|---|---|
| `claude.md` | The prime directive, scope rules, the three-question test, money rules, engineering rules, anti-patterns, definition of done |
| `design_2.md` | Modules and screens, app shell, users and roles |
| `data-model.md` | Schema, entities, invariants, store-vs-derive, indexes, seed data |
| `design-system.md` | Tokens, layout, grid spec, print, accessibility, performance budgets |
| `roadmap.md` | Phases, exit criteria, parking lot, release cadence, risk register |
| `glossary.md` | Vocabulary and the codebase naming rules |
| `mastermind.md` | Market map, platform teardowns, component library, user flows, integrations, why software gets abandoned |
| `WinQS features from a QS's perspective.docx` | The incumbent's real capability surface — the functional benchmark, and the continuity argument |
| `Dimension X - Features.docx` | The drawing-to-final-account traceability argument; revision-to-variation as a workflow |
| `706ST-002B.pdf` | The measured drawing findings in §10 — probed directly, not assumed |
| Replit prototype | Repetition logic for estate-scale housing, unit normalisation, standards mapping with confidence, tender outlier detection. Ideas only — no code carried over |

**Provenance rule for new sources:** when the next piece of context arrives, record what that source
is *good for* before extracting from it. Each existing source has a different job — build target,
functional benchmark, strategic argument, prior attempt, market reference. Naming the job stops them
being read as interchangeable requirement lists.

---

## 17. Decisions taken, and what remains open

### 17.1 Settled

| Question | Decision | Consequence |
|---|---|---|
| **First customer** | **Mzilikazi internal first**, commercialise once it earns its keep | Phase 0 stays single-tenant: `tenant_id` columns everywhere, **no enforcement layer**. Saves a week now; §17.2 #1 is the trigger to revisit |
| **WinQS relationship** | **Reference only** (§1.2). Reverse-engineered to establish what the work is; not an integration target | Excel import is a **migration and trust** feature (§12), not a bidirectional structural constraint. The bill's structure is ours to design against the problem in §1.1, not shaped by another vendor's export format |
| **Contract forms** | **JBCC PBA only** for v1 | One certificate layout, one retention treatment, one rule set to get right and have verified. Minor Works, N/S Subcontract, FIDIC and NEC all become Phase 7+ |
| **Bill grid** | **AG Grid Enterprise** | §7.4's mandatory list ships out of the box. Budget time instead for making it match the design tokens |
| **PDF** | **Headless Chrome + server-composed pagination** | Preview and print are the same HTML/CSS. Carried-forward subtotals are domain logic with tests, not a CSS artefact |
| **Hosting** | **Single container** (Railway or Render) | Next.js runs as a Node server, not serverless. Simplifies PDF rendering and background jobs |
| **Repo** | `X4OConsulting/qs-management-platform`, private | — |

### 17.2 Still open — none blocks Phase 0

1. **When multi-tenancy gets enforced.** Columns exist from the first migration; the enforcement
   layer is deferred (§15 #5). **The trigger is the first external customer** — decide before, not
   after. `claude.md` is unambiguous that a tenant leak is company-ending.
2. **The product's name.** No branding anywhere yet, deliberately. The repo name is descriptive, not
   a brand. Cheap to decide later; expensive to decide badly now.
3. **Who reviews the JBCC certificate output** before Phase 4 ships. The exit criteria require a
   practising QS to confirm compliance. With Mzilikazi as first customer this may be in-house — but
   it should be a named person, not a role.
4. **AG Grid Enterprise licence** — purchased under which entity, and for how many developers.
   Needed before Phase 1, not Phase 0.
5. **Which admin costs most.** §1.1 names the mechanical work in general terms. Timing the real
   thing — how long a certificate actually takes today, where the hours go in a take-off — turns the
   scoreboard from plausible targets into measured ones. Worth doing against a live Mzilikazi
   project before Phase 4.

---

## 18. What is load-bearing

More context will arrive and reshape parts of this. That is expected. But some decisions are cheap
to reverse and some are not — so that new context can be absorbed without re-deriving which walls
are structural.

**Expensive to reverse — change deliberately:**

0a. **The knowledge layer** (§1.3.2) — documents chunked, embedded and indexed per project, with
   every generated value grounded in the chunks that produced it. Provenance *is* the retrieval
   record, so a value captured without it can never have one reconstructed. Ingesting a corpus
   without chunk-level grounding means re-ingesting every document to fix it.

0. **The service chain** (§1.3.1) — `proposed` / `overrides` / `working` / `output`, with `output`
   NULL until sign-off, and the server owning `startable`. This is the spine everything else hangs
   from. Retrofitting provenance and a sign-off gate onto modules already written as plain CRUD
   means rewriting every one of them, and any data captured in the meantime has no provenance to
   recover. **Listed first because it is the most expensive thing on this list to get wrong.**

1. **Money as integer minor units, and the round-once-at-the-item rule** (§5). Changing numeric
   representation once there are signed certificates means re-deriving stored amounts and
   reconciling against issued documents.
2. **`tenant_id` on every table** (§6.1). Backfilling it across a live financial schema is a
   migration nobody wants.
3. **Issued documents immutable, designed in from the first migration** (§6.4 #1). Once certificates
   have been issued against mutable data, the audit trail cannot be reconstructed.
4. **`Dimension.source` and the versioned `drawing` table** (§6.6). Without them, drawing-derived and
   AI-derived take-off can't be added without reshaping the take-off model.
5. **Soft delete and the append-only audit trail** (§6.1, §6.3). Retrofitting history onto records
   that were hard-deleted is impossible.
6. **The eleven-module scope line** (§2). Not technically hard to change — but every past product in
   this space died of scope, and this is the decision that protects all the others.

**Expected to move:** every screen layout · the phase durations · the parking-lot ordering · the
component build order · integrations beyond Tier 1 · everything in §10 beyond the measured findings
· the colour palette (roles are fixed, values are a starting point).

---

*When in doubt: fewer things, done properly, that print beautifully.*
