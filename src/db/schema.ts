/**
 * The schema, as far as the built screens need it.
 *
 * Two tables, because two screens exist. PLATFORM.md §6 describes twenty-five, and they arrive
 * with the modules that read them — a table nothing queries is a table nobody has checked.
 *
 * The §6.1 conventions apply from the first migration, because they are the expensive things to
 * retrofit: every row carries who made it, when, and a soft-delete stamp. Money columns are absent
 * only because nothing here holds money yet; when they arrive they are `bigint` minor units (§5.1).
 */

import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  date,
  doublePrecision,
  index,
  type AnyPgColumn,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type { BillRowType, QuantitySource, RateSource } from "@/lib/agent/bill";
import type { ComponentKind } from "@/lib/pricing";
import type { FieldState, RunStatus } from "@/lib/agent/run";
import type { ClaimKind, ClaimStatus, NoticeKind, NoticeStatus, Party } from "@/domain/claims";
import type { ComplianceStage, ComplianceStatus } from "@/domain/compliance";
import type { WebSource, WebStructured } from "@/lib/agent/search";
import type { WorkItemPriority, WorkItemStatus, WorkItemType } from "@/lib/work/items";
import type { SavingBasis, ValueOptionStatus } from "@/domain/value-engineering";
import type { ItemStatus, QueryPriority, QueryStatus, ReviewAssumptions, ReviewOption } from "@/domain/design-review";
import type { ClarificationStatus } from "@/domain/estimate-comparison";

/** §6.1 — on every table, no exceptions. */
const conventions = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  createdBy: text("created_by"),
  /** Never hard-delete (§13.4). A document a run cited must stay resolvable years later. */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
};

/**
 * Where a project sits in its life — PLATFORM.md §6.3.
 *
 * `archived` is deliberately a status rather than a soft delete. An archived project is finished
 * work a practice keeps: still readable, still citable, out of the working list. Deleting is a
 * separate act with a separate meaning, and conflating the two would make "tidy up my list"
 * indistinguishable from "this was a mistake".
 */
export const projectStatus = pgEnum("project_status", [
  "estimating",
  "tendering",
  "in_contract",
  "final_account",
  "closed",
  "archived",
]);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** Used in document numbering — certificates and variations carry it. */
    code: text("code"),
    client: text("client"),
    /**
     * What the project is held to, in cents (migration 0036).
     *
     * Nullable: most projects do not have one settled at the start, and a nought would be a budget
     * of nothing rather than no budget. It is what value engineering aims at - without it the
     * register can add up its savings and not say whether they are enough.
     */
    budget: bigint("budget", { mode: "bigint" }),
    status: projectStatus("status").notNull().default("estimating"),
    /** A test project: worked like any other, read by nothing firm-level (0044, audit C5). */
    isTest: boolean("is_test").notNull().default(false),
    /**
     * Which L0 phases this project runs through (migration `0012_project_stages.sql`).
     *
     * Phase *numbers*, not a new list of stage names: `process-model.ts` already carries the
     * seven-phase value chain and every module resolves to one through its process area, so a
     * second vocabulary would be the same fact written twice.
     *
     * **Null means every stage** — which is what a project created before this column existed
     * meant, so there is no backfill and no phase list copied into SQL. `stagesOf()` is the one
     * place that reading lives.
     */
    stages: integer("stages").array(),
    /**
     * The province the work is in — one of `REGIONS` in `lib/rates.ts`.
     *
     * Null means nobody said, which is not the same as national: `ratesInForce` treats a *rate*
     * with no region as eligible everywhere, and a project with none prices from the whole library
     * with the screen saying so. See `drizzle/0019_project_region.sql` for why it is not backfilled.
     */
    region: text("region"),
    /**
     * A project, or an ad hoc request (migration 0039): "here's the input, this is what I need" –
     * a folder of documents, the take-off and the assistant, without the service chain. Every
     * portfolio figure reads projects only (`listProjects`); ad hoc requests are listed apart.
     */
    kind: text("kind").$type<"project" | "adhoc">().notNull().default("project"),
    /** What was asked for, in the asker's words. Ad hoc requests only. */
    request: text("request"),
    /** Who asked – a name as said, usually not a user of the platform. */
    requestedBy: text("requested_by"),
    dueOn: date("due_on"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: text("closed_by"),
    ...conventions,
  },
  (t) => [index("projects_live_idx").on(t.createdAt).where(sql`deleted_at is null`)],
);

/**
 * A document in the project corpus (§1.3.2).
 *
 * `kind` is what makes it satisfy an entry criterion, and it is **never defaulted** — see the note
 * in `@/lib/document-kinds`. A document filed under a kind nothing looks for is invisible in the
 * worst way, because the person believes they have filed it.
 *
 * The file bytes are not here yet. Chunking, embedding and the retrieval index (§1.3.2) arrive with
 * the ingestion pipeline; this records that a document exists, what it is, and which project it
 * belongs to — which is what readiness needs to stop saying "missing".
 */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    /**
     * The bare name — `poa.pdf`, never a path. A browser sends the whole relative path here when
     * the file came from a directory picker; it is split on the way in (`nameAndOrigin`).
     */
    filename: text("filename").notNull(),
    /**
     * The path the document arrived under, when it arrived with one. **Provenance, not identity.**
     *
     * Kept because the folder a submission puts a document in is itself a statement — it is what
     * `inferKind` reads, and it is how a reader confirms that `ANNEXURE A` is the annexure they
     * think it is. Null for a file chosen one at a time, which has no path to record.
     */
    sourcePath: text("source_path"),
    /** One of DOCUMENT_KINDS. Not nullable, and with no default. */
    kind: text("kind").notNull(),
    byteSize: text("byte_size"),
    /**
     * Where the original bytes went — a Blob URL, or the storage key under `STORAGE_DIR`.
     *
     * `store()` has always returned this and nothing ever wrote it down, so the platform held every
     * original and could open none of them. Null means the retention failed and was reported at the
     * time (§1.3, never a silent gap), or that the row predates this column.
     */
    storageLocation: text("storage_location"),

    /**
     * Drawing operations in the PDF's content streams — the measurement that separates a reference
     * map from a technical drawing (1 230 against 2 256 170 on this corpus). See `geometry.ts`.
     * Measured for spatial kinds only: it costs seconds and answers nothing about a market study.
     *
     * **Null is not zero.** "Nothing to measure" and "nobody measured" are different facts, and the
     * import agent keeps a drawing it cannot vouch for rather than proposing it be archived.
     */
    drawingOps: integer("drawing_ops"),

    /**
     * A hash of what the document says, for finding the same document filed twice — the text, not
     * the bytes. Null where the text is too short for sameness to mean anything (`fingerprintOf`).
     */
    textFingerprint: text("text_fingerprint"),

    ...conventions,
  },
  (t) => [
    // The hot path: "what has this project got, and of what kind" — which is the question
    // readiness asks on every load.
    index("documents_project_kind_idx").on(t.projectId, t.kind).where(sql`deleted_at is null`),
  ],
);

/**
 * A retrievable passage from a filed document — PLATFORM.md §1.3.2.
 *
 * Retrieval is **hybrid** by design: lexical full-text and semantic vector search, fused. The
 * lexical half is here now, and it is the half that matters most for this domain — construction
 * documents are dense with exact identifiers (`SANS 1200`, `25 MPa/19mm`, `Erf 180`), and
 * embeddings blur `SANS 1200` into `SANS 10400`, which in a costing platform is not a near miss.
 *
 * The semantic half needs an embedding provider and lands with one. The column is not declared
 * until then: an always-null vector column would sit in every row implying a capability that does
 * not exist.
 */
export const passages = pgTable(
  "passages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    /** Position in the document. Stable, so a citation can be resolved again later. */
    seq: integer("seq").notNull(),
    /** Null where the format has no pages — a .docx has none until it is laid out. */
    page: integer("page"),
    body: text("body").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Retrieval is always scoped to one project (§1.3.2) — a figure from another scheme surfacing
    // in this one's cost plan is the failure that would end trust in the platform, and it is
    // prevented at the query rather than by prompt instruction.
    index("passages_project_idx").on(t.projectId),
    index("passages_document_idx").on(t.documentId, t.seq),
  ],
);

export type Passage = typeof passages.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type ProjectDocument = typeof documents.$inferSelect;

/**
 * A person ticking off a required input — PLATFORM.md §1.3.3.
 *
 * ── Why this is a table and not a checkbox ─────────────────────────────────────────────────
 *
 * The checklist ticks itself when a document lands and a passage in it grounds the criterion. That
 * covers the machine's half. The other half is the QS saying "I have dealt with this" — and the
 * moment that claim can affect whether a process may start, it stops being interface state and
 * becomes a record someone will be asked about months later. So it is stored with **who** and
 * **when**, in the same way §1.3.1 stores a sign-off.
 *
 * ── A tick is not evidence ─────────────────────────────────────────────────────────────────
 *
 * It never becomes `satisfied`. §1.3.2 reserves that for a passage that can be quoted, and a tick
 * has nothing to quote. It reads as `declared` — outlined rather than filled — so a reviewer
 * scanning the column can tell at a glance which items rest on a document and which rest on a
 * person. Where the criterion is not declarable (§1.3.3 — a client mandate is not something anyone
 * may assert), the tick is still recorded and still shown, but the item stays blocking: the record
 * of the claim is worth keeping even when the claim cannot clear the gate.
 */
export const criterionChecks = pgTable(
  "criterion_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** The criterion's stable id from the checklist — "d2.1-mandate". */
    criterionId: text("criterion_id").notNull(),

    /** Who. Not nullable: an unattributed tick is the thing this table exists to prevent. */
    checkedBy: text("checked_by").notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
    /** Optional word from the person, for why they are vouching for it. */
    note: text("note"),
  },
  (t) => [
    // One live tick per criterion per project. Unticking deletes rather than adding a second row —
    // the history that matters is in the audit log, not in duplicates here.
    uniqueIndex("criterion_checks_unique").on(t.projectId, t.criterionId),
  ],
);

export type CriterionCheck = typeof criterionChecks.$inferSelect;

/**
 * Whether a filed document covers a requirement, as the model read it — migration 0022.
 *
 * Only consulted where a document of an accepted kind matched none of the requirement's phrases.
 * `covered` is set only when the model's quote was located in the document. See the migration.
 */
export const documentCoverage = pgTable(
  "document_coverage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    criterionId: text("criterion_id").notNull(),
    covered: boolean("covered").notNull(),
    quote: text("quote"),
    page: integer("page"),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("document_coverage_unique").on(t.documentId, t.criterionId)],
);

export type DocumentCoverage = typeof documentCoverage.$inferSelect;

/**
 * What the advisor found on the web, kept for later questions – migration 0023 says why only that,
 * and why firm-wide. `search` is generated there and absent here, as `policy_passages.search` is.
 */
export const advisorNotes = pgTable("advisor_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").$type<"web">().notNull(),
  question: text("question").notNull(),
  questionKey: text("question_key").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  structured: jsonb("structured").$type<WebStructured | null>(),
  sources: jsonb("sources").$type<WebSource[]>().notNull().default([]),
  savedBy: text("saved_by").notNull(),
  savedAt: timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type AdvisorNote = typeof advisorNotes.$inferSelect;

/**
 * Project management – the work a job generates between its signed steps. Migration 0024 says why
 * one table holds six kinds of item, and why an item is owned by a person or a contact, never both.
 */
export const workItems = pgTable(
  "work_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    type: text("type").$type<WorkItemType>().notNull(),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").$type<WorkItemStatus>().notNull().default("todo"),
    priority: text("priority").$type<WorkItemPriority>().notNull().default("medium"),
    assigneeEmail: text("assignee_email"),
    assigneeContactId: uuid("assignee_contact_id").references(() => contacts.id, { onDelete: "set null" }),
    startDate: date("start_date"),
    dueDate: date("due_date"),
    module: text("module"),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    details: jsonb("details").$type<Record<string, string>>().notNull().default({}),
    source: text("source").$type<"manual" | "plan">().notNull().default("manual"),
    rank: doublePrecision("rank").notNull().default(0),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("work_items_project_number").on(t.projectId, t.number)],
);

export const workItemComments = pgTable("work_item_comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  itemId: uuid("item_id")
    .notNull()
    .references(() => workItems.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  author: text("author").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WorkItemRow = typeof workItems.$inferSelect;
export type WorkItemComment = typeof workItemComments.$inferSelect;

/**
 * A run of one service step over the project corpus — PLATFORM.md §1.3.1.
 *
 * ── Why a run is a row ─────────────────────────────────────────────────────────────────────
 *
 * It was component state, and component state is lost by a reload, invisible in a second tab, and
 * gone when a laptop sleeps. §1.3.1 requires the opposite: a run in flight survives everything,
 * because the thing it produces is what a QS is going to sign their name to.
 *
 * ── There is no `signed` status ────────────────────────────────────────────────────────────
 *
 * A signature is `signedBy` + `signedAt`. Adding `status = 'signed'` beside them would be two
 * places for one fact, and §6.5 is explicit that a stored copy of something derivable is a value
 * that can disagree with what it was derived from. `runState()` in `@/lib/agent/run` decides what a
 * run is, once, so a header and the row beneath it cannot differ.
 *
 * The database holds the same line: a check constraint allows only these three, and a trigger
 * refuses any update to a run that has been signed.
 */
export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** The nav href of the step this run belongs to — "/feasibility". */
    module: text("module").notNull(),
    status: text("status").$type<RunStatus>().notNull(),
    /** The provider's own words when a run stopped. §1.3 — an outage is surfaced, never a gap. */
    error: text("error"),

    /** What it spent, so a reloaded run shows the same footer as the one that ran it. */
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),

    /** The signature. Both or neither — a check constraint says so. */
    signedBy: text("signed_by"),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    /** Why it was signed although its money figures do not reconcile (0043). Null when they do. */
    signoffNote: text("signoff_note"),

    ...conventions,
  },
  (t) => [
    // "The latest run of this step on this project" — what every module page asks on load.
    index("runs_project_module_idx")
      .on(t.projectId, t.module, t.createdAt.desc())
      .where(sql`deleted_at is null`),
  ],
);

/**
 * One field of a run, carrying all four maps of §1.3.1.
 *
 * `proposed` is what the machine said and is never edited — a correction goes in `override_*`, and
 * a database trigger enforces that rather than trusting every future writer to remember. `working`
 * is not here at all: it is `override ?? proposed`, derived by `workingValue()` (§6.5).
 *
 * `output_value` is written once, at sign-off, and frozen with the rest of the row. Null inside a
 * signed run means the run was signed with the field unestablished — legitimate for an optional
 * field — which is why "is this signed" is `runs.signedAt` and never the nullness of this column.
 */
export const runFields = pgTable(
  "run_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),

    /** The field's stable id in the module's field set — "erf". */
    fieldId: text("field_id").notNull(),
    /** Its position in that set, so a frozen run keeps the order it was read in. */
    seq: integer("seq").notNull(),
    /**
     * The label at proposal time, copied for the reason §6.4 #9 gives for BillItem copying its
     * description: the field set will change, and a signed record that renders as "erf" because its
     * spec was renamed has stopped being a record of what anybody signed.
     */
    label: text("label").notNull(),

    proposedState: text("proposed_state").$type<FieldState>().notNull(),
    proposedValue: text("proposed_value"),
    proposedConfidence: real("proposed_confidence").notNull().default(0),
    /** Why it landed where it did — including a quote that was caught not being in the corpus. */
    proposedNote: text("proposed_note"),

    /**
     * The retrieval record the value came from (§1.3.2) — provenance, not decoration.
     *
     * The document name is kept beside its id because `on delete set null` is the right behaviour
     * for a deleted document and a citation that can no longer say which document it was is not.
     */
    sourceDocumentId: uuid("source_document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    sourceDocument: text("source_document"),
    sourcePage: integer("source_page"),
    sourceExcerpt: text("source_excerpt"),

    /**
     * The path a figure travelled, when it came from an upstream service rather than a document.
     *
     * Kept **beside** `source_*` rather than instead of it (§1.3.1): the original document is what
     * tells a reader whether the figure is true, and the path is what tells them who approved it.
     * Null for a value this step read itself.
     */
    carriedVia: text("carried_via"),
    carriedFromRunId: uuid("carried_from_run_id"),

    overrideValue: text("override_value"),
    overrideReason: text("override_reason"),
    /** A hand-entered value is an override with a person as its source (§1.3.3). */
    overrideBy: text("override_by"),
    overrideAt: timestamp("override_at", { withTimezone: true }),

    outputValue: text("output_value"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // One proposal per field per run — a second would make `working` ambiguous.
    uniqueIndex("run_fields_unique").on(t.runId, t.fieldId),
  ],
);

/**
 * One row of a bill — the row-shaped run of PLATFORM.md §1.3.3, beside `run_fields` rather than
 * inside it (migration `0010_run_items.sql`).
 *
 * ── Why a sibling table ────────────────────────────────────────────────────────────────────
 *
 * `run_fields` is one row per *named field of a fixed set*. A bill is N items discovered from the
 * documents, each with five values and its own arithmetic, and N is not known in advance. Bending
 * `run_fields` to hold it — synthetic ids like `item.3.quantity` — would have been the first
 * dishonest thing in this schema.
 *
 * The four maps of §1.3.1 are unchanged. What changes is that a row carries five values, so
 * `working` is five `coalesce`s instead of one and `output_*` freezes five columns instead of one.
 *
 * ── `amount` is written by the database, never by this application ─────────────────────────
 *
 * §5.2: `amount = round(quantity × rate)`, rounded once, at the item. The trigger in that migration
 * is the only thing that writes this column — an insert or an update supplying one is overwritten.
 * `extend()` in `@/domain/money` is the same rule in TypeScript, and `checks/bill.mjs` asserts the
 * two agree on the values where roundings drift: the exact halves, and the negatives.
 */
export const runItems = pgTable(
  "run_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),

    /** Sparse — 100, 200, 300 (§6.3), so inserting into the middle renumbers nothing. */
    seq: integer("seq").notNull(),
    /** Section → Trade → Item (§4.7). Null at the top of the bill. */
    parentId: uuid("parent_id").references((): AnyPgColumn => runItems.id, {
      onDelete: "cascade",
    }),
    rowType: text("row_type").$type<BillRowType>().notNull(),
    itemRef: text("item_ref"),

    proposedDescription: text("proposed_description"),
    proposedUnit: text("proposed_unit"),
    /**
     * `numeric(18,4)` (§5.1), and drizzle hands it back as a **string**. That is what we want: a
     * quantity that passed through a JavaScript number on its way here would already be wrong.
     */
    proposedQuantity: numeric("proposed_quantity", { precision: 18, scale: 4 }),
    proposedRate: bigint("proposed_rate", { mode: "bigint" }),
    /** §5.1 — the scale a rate is held at travels with it. 185000 is R1 850,00 at 2, R18,5000 at 4. */
    proposedRatePrecision: integer("proposed_rate_precision"),
    /** The document's own words, kept for the figures `readAmount` refused to turn into a number. */
    proposedQuantityText: text("proposed_quantity_text"),
    proposedRateText: text("proposed_rate_text"),
    proposedConfidence: real("proposed_confidence").notNull().default(0),
    proposedNote: text("proposed_note"),

    /** Per row, not per cell: five citations to one passage is duplication the grid cannot carry. */
    sourceDocumentId: uuid("source_document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    sourceDocument: text("source_document"),
    sourcePage: integer("source_page"),
    sourceExcerpt: text("source_excerpt"),

    overrideDescription: text("override_description"),
    overrideUnit: text("override_unit"),
    overrideQuantity: numeric("override_quantity", { precision: 18, scale: 4 }),
    overrideRate: bigint("override_rate", { mode: "bigint" }),
    overrideRatePrecision: integer("override_rate_precision"),
    overrideReason: text("override_reason"),
    overrideBy: text("override_by"),
    overrideAt: timestamp("override_at", { withTimezone: true }),

    /** §6.3 — read by an agent, typed by a person and pasted from a spreadsheet are three claims. */
    quantitySource: text("quantity_source").$type<QuantitySource>().notNull().default("ai_derived"),
    /** The same question about the other figure (§4.8, §6.3) — and a build-up is why it is stored. */
    rateSource: text("rate_source").$type<RateSource>().notNull().default("ai_derived"),

    /** Written by the trigger. Never set from here — see the note above. */
    amount: bigint("amount", { mode: "bigint" }),

    outputDescription: text("output_description"),
    outputUnit: text("output_unit"),
    outputQuantity: numeric("output_quantity", { precision: 18, scale: 4 }),
    outputRate: bigint("output_rate", { mode: "bigint" }),
    outputRatePrecision: integer("output_rate_precision"),
    outputAmount: bigint("output_amount", { mode: "bigint" }),

    /** Struck through, never deleted: `proposed` is the record of what the machine said. */
    omittedAt: timestamp("omitted_at", { withTimezone: true }),
    omittedBy: text("omitted_by"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("run_items_run_seq_idx").on(t.runId, t.seq)],
);

/**
 * A rate, built up from what it is made of — PLATFORM.md §4.8 (migration `0011_pricing.sql`).
 *
 * One per bill row, which the unique constraint states rather than leaving to the writer: two
 * build-ups behind one rate would be two derivations of a figure that can only have had one.
 *
 * ── The computed rate is not here, and that is deliberate ──────────────────────────────────
 *
 * It is `sum(component quantity × component rate)` plus waste plus markup — a derivation over rows
 * three lines away, and §6.5's answer for a value that changes as fast as its inputs is *derive*.
 * `buildUpRate()` in `@/domain/money` is the one statement of it. What is stored is the figure the
 * arithmetic uses: `run_items.override_rate`, applied from here, and extended once by the trigger.
 */
export const rateBuildUps = pgTable("rate_build_ups", {
  id: uuid("id").primaryKey().defaultRandom(),
  runItemId: uuid("run_item_id")
    .notNull()
    .unique()
    .references(() => runItems.id, { onDelete: "cascade" }),

  /** §5.1 — the decimal fraction, not the whole percent. `0.0500` is 5%. */
  wasteRate: numeric("waste_rate", { precision: 6, scale: 4 }).notNull().default("0"),
  markupRate: numeric("markup_rate", { precision: 6, scale: 4 }).notNull().default("0"),

  /**
   * §4.8's **plug** — "a manual override that is flagged, never hidden".
   *
   * Here as well as on the row because the two say different things. The row's `override_rate` is
   * the figure the extension uses; this is the QS's standing statement that they are not using the
   * build-up's answer, which survives the next component edit where a rate typed into the grid
   * would simply be recomputed away.
   */
  plugRate: bigint("plug_rate", { mode: "bigint" }),
  plugRatePrecision: integer("plug_rate_precision"),

  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * One line of a build-up — §4.8's five kinds.
 *
 * The quantity is per **one unit of the bill item**: 0,35 t of cement in a cubic metre of concrete,
 * not in the whole of the substructure. That is what makes the sum a rate rather than an amount.
 *
 * Quantity and rate are both nullable, because a component being typed is incomplete — and an
 * incomplete component contributes **nothing** rather than nought. The editor counts them and says
 * so, since a rate quietly short by one line is the confident wrong number §5 exists to prevent.
 */
export const rateComponents = pgTable(
  "rate_components",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    buildUpId: uuid("build_up_id")
      .notNull()
      .references(() => rateBuildUps.id, { onDelete: "cascade" }),

    /** Dense, unlike `run_items.seq`: five rows retyped in place, never a list inserted into. */
    seq: integer("seq").notNull(),
    kind: text("kind").$type<ComponentKind>().notNull(),
    description: text("description"),
    quantity: numeric("quantity", { precision: 18, scale: 4 }),
    rate: bigint("rate", { mode: "bigint" }),
    ratePrecision: integer("rate_precision"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("rate_components_build_up_seq_idx").on(t.buildUpId, t.seq)],
);

export type RunRow = typeof runs.$inferSelect;
export type RunFieldRow = typeof runFields.$inferSelect;
export type RunItemRow = typeof runItems.$inferSelect;
export type RateBuildUpRow = typeof rateBuildUps.$inferSelect;
export type RateComponentRow = typeof rateComponents.$inferSelect;

/**
 * The firm's own standards — the rubric advice is given under.
 *
 * ── Separate from the project corpus, structurally ─────────────────────────────────────────
 *
 * A policy is firm-wide, which is the opposite of everything else here. The cheap way to hold that
 * is a nullable `documents.projectId`, and it is the wrong way: every retrieval scopes with
 * `projectId = $1`, and that predicate is what stops one scheme's figures surfacing in another's
 * report. A nullable column turns each of those into an OR that somebody eventually forgets.
 *
 * These tables cannot leak into a project search because a project search does not read them.
 */
export const policies = pgTable("policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  filename: text("filename").notNull(),
  /** What it governs — so the advisor can name the standard it is citing. */
  kind: text("kind").notNull(),
  /** Kept whole as well as chunked: the policies page shows the document, not its passages. */
  body: text("body").notNull(),
  /**
   * The date the firm adopted it.
   *
   * A standard superseded last year is not the standard, and one with no date cannot be told from
   * one that is current. Nullable because a policy filed without a date is still better held than
   * refused — the page says the date is missing rather than pretending it is current.
   */
  effectiveFrom: date("effective_from"),
  filedBy: text("filed_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  /** Soft: a withdrawn policy is still what advice was given under last month. */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const policyPassages = pgTable("policy_passages", {
  id: uuid("id").primaryKey().defaultRandom(),
  policyId: uuid("policy_id")
    .notNull()
    .references(() => policies.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  page: integer("page"),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /*
    `search` is a generated column, declared in migration 0013 and deliberately absent here: the
    application never writes it, and describing it as writable would invite exactly that. Referenced
    as raw SQL where it is queried, the same way `chunks.search` is.
  */
});

/**
 * The practice's directory — who the work is done with and for.
 *
 * ── It does not own the client name ────────────────────────────────────────────────────────
 *
 * `projects.client` already records who a project is for, and the viability report's "prepared
 * for" line reads it. This table does not replace that: a project keeps its own client name, and
 * the directory finds the projects that name a contact rather than the other way round.
 *
 * One fact, one owner. A second copy would disagree the first time somebody corrected one of them,
 * and the report would then be right or wrong depending on which screen you looked at.
 */
export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** The organisation. A practice deals with companies; the person is who answers there. */
  organisation: text("organisation").notNull(),
  /**
   * Nullable, deliberately.
   *
   * Plenty of entries are an organisation with nobody named yet. Inventing a person to satisfy a
   * not-null is how "Accounts" ends up in a report as somebody's name.
   */
  person: text("person"),
  role: text("role"),
  /** client · consultant · contractor · supplier · authority */
  kind: text("kind").notNull(),
  email: text("email"),
  phone: text("phone"),
  note: text("note"),
  addedBy: text("added_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  /** Soft: a supplier the practice has stopped using is still who a rate came from. */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/**
 * The practice's own assumptions — appended, never overwritten.
 *
 * The report says "a stated assumption" on figures that were, until now, written into the source
 * by whoever built the platform. A practice that cannot change its own prime rate is not stating
 * an assumption; it is accepting somebody else's.
 *
 * The current value for a key is its newest effective row. The rows behind it are the record of
 * what the practice assumed when an older report was written — which matters because the report is
 * generated live from signed figures, so a changed assumption changes every report printed from
 * now on. The history is what lets a reader see that a figure moved, and when.
 */
export const assumptions = pgTable("assumptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Matches the key in `lib/assumptions.ts`. Text, so a new assumption is a data change. */
  key: text("key").notNull(),
  /**
   * Text, not numeric.
   *
   * These are rates, counts and percentages at different scales, and one numeric column would need
   * a precision that fits all of them or would silently round the ones it does not.
   */
  value: text("value").notNull(),
  effectiveFrom: date("effective_from").notNull(),
  setBy: text("set_by").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A tenderer's return, priced against a signed bill — §1.4 (D1.3), §5.2.
 *
 * See `drizzle/0016_tender_returns.sql` for why this is not another `runs` row: a run is one
 * module's output with one signature, so five tenderers would be five bills competing to be *the*
 * bill. A return holds rates only. Every quantity in the comparison comes from the one signed bill
 * all of them priced, which is the only thing that makes the columns comparable.
 */
export const tenderReturns = pgTable(
  "tender_returns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** The issue of the bill this tender was invited on. A revision must not re-base a price. */
    billRunId: uuid("bill_run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    tenderer: text("tenderer").notNull(),
    /** What the tenderer says it comes to, as submitted and uncorrected. Minor units. */
    statedSum: bigint("stated_sum", { mode: "bigint" }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("tender_returns_project_idx").on(t.projectId, t.billRunId)],
);

/** One tenderer's rate against one bill item. A missing row is a rate not quoted. */
export const tenderPrices = pgTable(
  "tender_prices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    returnId: uuid("return_id")
      .notNull()
      .references(() => tenderReturns.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => runItems.id, { onDelete: "cascade" }),
    rate: bigint("rate", { mode: "bigint" }),
    /** §5.1 — the scale travels with the rate, exactly as on a bill row. */
    ratePrecision: integer("rate_precision").notNull().default(2),
    /** `round(bill.output_quantity × rate)`, written by the trigger and by nothing else. */
    amount: bigint("amount", { mode: "bigint" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("tender_prices_return_idx").on(t.returnId)],
);

/**
 * People who can sign in — §1.3.1, §13.1.
 *
 * See `drizzle/0017_users.sql` for why this exists and why the environment credential stays. In
 * short: every signature in this platform names a signer, and one shared login makes every one of
 * them name the same person.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Lower-cased on the way in; unique on that basis. */
    email: text("email").notNull(),
    name: text("name").notNull(),
    /** `N$r$p$salt$hash` — scrypt, parameters carried with the hash. Never the password. */
    passwordHash: text("password_hash").notNull(),
    /** Can add and deactivate people. The environment credential is one without a row. */
    isAdmin: boolean("is_admin").notNull().default(false),
    /** Soft: a deactivated person keeps their name on everything they signed. */
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    deactivatedBy: text("deactivated_by"),
    /** Two-step sign-in (0047): the authenticator key, sealed (`lib/secret-box`); never in the clear. */
    totpSecret: text("totp_secret"),
    /** Set once the person has entered a working code; until then the key does nothing. */
    totpEnabledAt: timestamp("totp_enabled_at", { withTimezone: true }),
    /** The last time step accepted, so a code cannot be used twice. */
    totpLastStep: bigint("totp_last_step", { mode: "number" }),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("users_email_key").on(sql`lower(${t.email})`)],
);

/** Single-use links to choose one's own password (0046, audit C7) – `lib/password-links.ts`. */
export const passwordLinks = pgTable(
  "password_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    purpose: text("purpose").$type<"invite" | "reset">().notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [index("password_links_user").on(t.userId)],
);

/**
 * The firm's rate library — PLATFORM.md §4.5, §4.8, §6.3.
 *
 * See `drizzle/0018_rates.sql` for the two decisions that shape it: there is **no `project_id`**,
 * because a rate set is a firm asset and a rate copied into every job is a rate that has to be
 * corrected in every job; and rows are **appended, never updated**, because a price is a fact
 * about a date and the figure a signed bill was priced against must stay readable.
 *
 * `rate` / `ratePrecision` is the same pair `runItems` uses (§5.1) — minor units plus the scale
 * they are held at, so a rate can move between the library and a bill row without being rounded on
 * the way.
 */
/**
 * The practice's own resource factors — how much of a resource one unit of work consumes.
 *
 * ── Why these are firm data and not the model's ────────────────────────────────────────────
 *
 * `build-up-method.ts` asks a model what a unit of work is made of, on the grounds that a
 * measurement factor is a stable fact. That holds for materials — 104 bricks in a square metre of
 * one-brick walling is fixed by geometry — and **it does not hold for labour and plant**. Asked
 * twice on the same day it returned 0,10 and then 0,15 hours of mixer per m², a fifty per cent
 * spread in a figure somebody might price from.
 *
 * Hours per square metre is a *productivity assumption*, and that belongs to the practice: it
 * depends on the gang, the site and the access, and a firm that has been building for twenty years
 * knows its own better than any general answer. So it is held here with the standing of a rate —
 * stated, attributable, dated — and the take-off says which of the two any line came from.
 *
 * Firm-level and append-only, for the same reasons `rates` is both. See `0021_resource_factors.sql`.
 */
export const resourceFactors = pgTable(
  "resource_factors",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** The work this is a factor for — "One-brick wall in stock brick", as a bill item reads. */
    work: text("work").notNull(),
    workUnit: text("work_unit").notNull(),

    /** One of COMPONENT_KINDS. Validated by the application; §6.9 keeps it out of the schema. */
    kind: text("kind").$type<ComponentKind>().notNull(),

    /** The resource, in the words the rate library files it under, so it can be priced. */
    resource: text("resource").notNull(),
    resourceUnit: text("resource_unit").notNull(),

    /** Per **one** unit of the work. `numeric(18,4)`, handed back as a string — never a float. */
    quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),

    /**
     * This resource's own cutting-and-breakage allowance, as a decimal fraction (§5.1).
     *
     * Per factor, not per method: brickwork runs at about five per cent and tiling at ten, and one
     * number across a whole build-up either overstates the bricks or understates the tiles. Null
     * means none was stated and the method's own allowance applies — absent is not nought.
     */
    wasteRate: numeric("waste_rate", { precision: 6, scale: 4 }),

    /** Province. Null means no regional basis was stated — read exactly as `rates.region` is. */
    region: text("region"),
    /** Required. §6.3 — a factor nobody can attribute is a factor nobody can defend. */
    source: text("source").notNull(),
    effectiveDate: date("effective_date").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").notNull(),
    /** Withdrawing a factor is a different act from revising it. §6.1 — never hard-delete. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("resource_factors_work_idx")
      .on(t.workUnit, t.effectiveDate.desc())
      .where(sql`deleted_at is null`),
  ],
);

export type ResourceFactorRow = typeof resourceFactors.$inferSelect;

export const rates = pgTable(
  "rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null where a rate has not been classified. §6.9 — a classification is a dimension. */
    trade: text("trade"),
    description: text("description").notNull(),
    unit: text("unit").notNull(),

    rate: bigint("rate", { mode: "bigint" }).notNull(),
    /** 185000 is R1 850,00 at 2 and R18,5000 at 4. The scale travels with the figure. */
    ratePrecision: integer("rate_precision").notNull().default(2),

    /** Province. Null means no regional basis was stated — not that it applies everywhere. */
    region: text("region"),
    /** Required. §6.3 — a rate nobody can attribute is a rate nobody can defend. */
    source: text("source").notNull(),
    effectiveDate: date("effective_date").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").notNull(),
    /** Withdrawing a rate is a different act from repricing it. §6.1 — never hard-delete. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("rates_current_idx").on(t.trade, t.region, t.effectiveDate.desc()),
    index("rates_description_idx").on(t.description),
  ],
);

/**
 * A document the practice has issued — PLATFORM.md §4.11, §1.3.1.
 *
 * See `drizzle/0020_issued_documents.sql` for why a live-generated report also needs storing: "what
 * does this project come to" is a live question and "what did we send the client in March" is not,
 * and re-generating cannot answer the second because the figures have moved.
 *
 * `signedRunIds` is what makes this more than a file cabinet. Every run it names is frozen by
 * `runs_frozen()` and still readable, so a stored document can say which approved figures it rests
 * on rather than merely existing.
 */
export const issuedDocuments = pgTable(
  "issued_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    /** `viability_report`, `bill_of_quantities`, and whatever a practice issues next. */
    kind: text("kind").notNull(),
    title: text("title").notNull(),

    /** A Blob key or a path under `STORAGE_DIR`, exactly as `documents` holds it. */
    storageLocation: text("storage_location").notNull(),
    byteSize: integer("byte_size").notNull(),

    /** The signed runs it was generated from. Empty is legitimate — and worth a second look. */
    signedRunIds: uuid("signed_run_ids").array().notNull().default([]),

    issuedBy: text("issued_by").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),

    /** Superseded, never removed. A report that was sent cannot be unsent. */
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    withdrawnBy: text("withdrawn_by"),
  },
  (t) => [
    index("issued_documents_project_idx")
      .on(t.projectId, t.issuedAt.desc())
      .where(sql`withdrawn_at is null`),
  ],
);

/**
 * The construction programme – D2.5. Migration 0025: a run of activities mirroring `run_items`,
 * whose signature freezes the baseline, and an append-only record of progress against it.
 */
export const programmeActivities = pgTable(
  "programme_activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    ref: text("ref"),
    proposedName: text("proposed_name"),
    proposedStart: date("proposed_start"),
    proposedFinish: date("proposed_finish"),
    proposedStartText: text("proposed_start_text"),
    proposedFinishText: text("proposed_finish_text"),
    proposedMilestone: boolean("proposed_milestone").notNull().default(false),
    proposedConfidence: real("proposed_confidence").notNull().default(0),
    proposedNote: text("proposed_note"),
    sourceDocumentId: uuid("source_document_id").references(() => documents.id, { onDelete: "set null" }),
    sourceDocument: text("source_document"),
    sourcePage: integer("source_page"),
    sourceExcerpt: text("source_excerpt"),
    overrideName: text("override_name"),
    overrideStart: date("override_start"),
    overrideFinish: date("override_finish"),
    overrideMilestone: boolean("override_milestone"),
    overrideBy: text("override_by"),
    overrideAt: timestamp("override_at", { withTimezone: true }),
    /** Minor units. Null is "share the remainder pro rata", which is not nought. */
    value: bigint("value", { mode: "bigint" }),
    outputName: text("output_name"),
    outputStart: date("output_start"),
    outputFinish: date("output_finish"),
    outputMilestone: boolean("output_milestone"),
    omittedAt: timestamp("omitted_at", { withTimezone: true }),
    omittedBy: text("omitted_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("programme_activities_run_seq_idx").on(t.runId, t.seq)],
);

export const programmeProgress = pgTable(
  "programme_progress",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    activityId: uuid("activity_id")
      .notNull()
      .references(() => programmeActivities.id, { onDelete: "cascade" }),
    asAt: date("as_at").notNull(),
    start: date("start"),
    finish: date("finish"),
    percent: integer("percent").notNull(),
    note: text("note"),
    recordedBy: text("recorded_by").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("programme_progress_activity_idx").on(t.activityId, t.asAt, t.recordedAt)],
);

/**
 * Notices and claims – D6.1. Migration 0026: two registers per project, and an assessed claim is
 * frozen by trigger, because its award is what moves the completion date.
 */
export const contractNotices = pgTable(
  "contract_notices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    kind: text("kind").$type<NoticeKind>().notNull(),
    fromParty: text("from_party").$type<Party>().notNull(),
    receivedOn: date("received_on").notNull(),
    clause: text("clause"),
    subject: text("subject").notNull(),
    eventOn: date("event_on"),
    status: text("status").$type<NoticeStatus>().notNull().default("received"),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    note: text("note"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("contract_notices_project_number").on(t.projectId, t.number)],
);

export const contractClaims = pgTable(
  "contract_claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    noticeId: uuid("notice_id").references(() => contractNotices.id, { onDelete: "set null" }),
    kind: text("kind").$type<ClaimKind>().notNull(),
    clause: text("clause"),
    description: text("description").notNull(),
    lodgedOn: date("lodged_on").notNull(),
    eventFrom: date("event_from"),
    eventTo: date("event_to"),
    daysClaimed: integer("days_claimed"),
    amountClaimed: bigint("amount_claimed", { mode: "bigint" }),
    daysAwarded: integer("days_awarded"),
    amountAwarded: bigint("amount_awarded", { mode: "bigint" }),
    assessment: text("assessment"),
    assessedBy: text("assessed_by"),
    assessedAt: timestamp("assessed_at", { withTimezone: true }),
    status: text("status").$type<ClaimStatus>().notNull().default("lodged"),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("contract_claims_project_number").on(t.projectId, t.number)],
);

/**
 * Take-off – dimension sheets (D1.2). Migration 0027: the quantity is derived from the lines on
 * every read, never stored; an item may feed one bill row, recorded as a 'takeoff' quantity.
 */
export const takeoffItems = pgTable(
  "takeoff_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    section: text("section"),
    description: text("description").notNull(),
    unit: text("unit").notNull(),
    drawingId: uuid("drawing_id").references(() => documents.id, { onDelete: "set null" }),
    billItemId: uuid("bill_item_id").references(() => runItems.id, { onDelete: "set null" }),
    sentQuantity: numeric("sent_quantity", { precision: 18, scale: 4 }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    sentBy: text("sent_by"),
    /** "manual", or "drawings" where the measuring agent wrote it (migration 0030). */
    origin: text("origin").notNull().default("manual"),
    /** The assumed figures its quantity rests on, in words. */
    note: text("note"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("takeoff_items_project_number").on(t.projectId, t.number)],
);

export const takeoffDimensions = pgTable(
  "takeoff_dimensions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => takeoffItems.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    location: text("location"),
    timesing: numeric("timesing", { precision: 18, scale: 4 }).notNull().default("1"),
    length: numeric("length", { precision: 18, scale: 4 }),
    width: numeric("width", { precision: 18, scale: 4 }),
    depth: numeric("depth", { precision: 18, scale: 4 }),
    deduct: boolean("deduct").notNull().default(false),
    /** The mark on a drawing this line was measured from, if any (0045) – `domain/drawing-marks`. */
    mark: jsonb("mark"),
    /** How the agent worked the line out – "2 × panel_length × wall_height". */
    working: text("working"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("takeoff_dimensions_item_seq").on(t.itemId, t.seq)],
);

/** Which element each bill row belongs to, for the elemental cost plan (migration 0031). */
export const billElements = pgTable("bill_elements", {
  runItemId: uuid("run_item_id")
    .primaryKey()
    .references(() => runItems.id, { onDelete: "cascade" }),
  element: text("element").notNull(),
  setBy: text("set_by").notNull(),
  setAt: timestamp("set_at", { withTimezone: true }).notNull().defaultNow(),
});

/** What the elemental cost plan adds to the measured work, per project (migration 0031). */
export const costPlanAllowances = pgTable("cost_plan_allowances", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  preliminaries: numeric("preliminaries", { precision: 6, scale: 4 }).notNull(),
  contingency: numeric("contingency", { precision: 6, scale: 4 }).notNull(),
  escalation: numeric("escalation", { precision: 6, scale: 4 }).notNull(),
  vat: numeric("vat", { precision: 6, scale: 4 }).notNull(),
  measureLabel: text("measure_label"),
  measureValue: numeric("measure_value", { precision: 18, scale: 4 }),
  setBy: text("set_by").notNull(),
  setAt: timestamp("set_at", { withTimezone: true }).notNull().defaultNow(),
});

/** An element's unit quantity, where a QS set one other than its principal measured item (migration 0032). */
export const elementQuantities = pgTable(
  "element_quantities",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    element: text("element").notNull(),
    quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
    unit: text("unit").notNull(),
    label: text("label").notNull(),
    setBy: text("set_by").notNull(),
    setAt: timestamp("set_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.element] })],
);

/** Why a line of the cost check moved, one current note per line (migration 0042). */
export const costMovementNotes = pgTable(
  "cost_movement_notes",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    line: text("line").notNull(),
    note: text("note").notNull(),
    setBy: text("set_by").notNull(),
    setAt: timestamp("set_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.line] })],
);

/** The client's cost decisions, appended and never changed – the latest is in force (migration 0042). */
export const costDecisions = pgTable(
  "cost_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    decision: text("decision").notNull(),
    note: text("note").notNull().default(""),
    revisedBudget: bigint("revised_budget", { mode: "bigint" }),
    budget: bigint("budget", { mode: "bigint" }),
    detailed: bigint("detailed", { mode: "bigint" }).notNull(),
    verdict: text("verdict").notNull(),
    costPlanRunId: uuid("cost_plan_run_id").references(() => runs.id, { onDelete: "set null" }),
    billRunId: uuid("bill_run_id").references(() => runs.id, { onDelete: "set null" }),
    decidedBy: text("decided_by").notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("cost_decisions_project").on(t.projectId, t.decidedAt)],
);

/** The bell, and the email behind it (migration 0033). */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipient: text("recipient").notNull(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    href: text("href"),
    actor: text("actor"),
    dedupeKey: text("dedupe_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
    emailError: text("email_error"),
  },
  (t) => [index("notifications_recipient_created").on(t.recipient, t.createdAt)],
);

/** A sign-in the server can end (migration 0037). The cookie carries `id`; a request checks it is live. */
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedReason: text("revoked_reason"),
  userAgent: text("user_agent"),
  ip: text("ip"),
});

/** Failed sign-ins, for throttling (migration 0037). Pruned after a day. */
export const loginFailures = pgTable(
  "login_failures",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    email: text("email").notNull(),
    ip: text("ip"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("login_failures_email_at").on(t.email, t.at), index("login_failures_ip_at").on(t.ip, t.at)],
);

/**
 * The outbound ledger (migration 0038, ARC-005). One row per attempt to send to an outside service.
 * Append-only – a trigger refuses update and delete. Counts and a hash, never the text.
 */
export const egressEvents = pgTable("egress_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  purpose: text("purpose").notNull(),
  vendor: text("vendor").notNull(),
  region: text("region").notNull(),
  projectId: uuid("project_id"),
  actor: text("actor"),
  classes: jsonb("classes").$type<Record<string, number>>().notNull().default({}),
  charsOut: integer("chars_out").notNull().default(0),
  sha256: text("sha256"),
  basis: text("basis"),
  decision: text("decision").$type<"allowed" | "refused">().notNull(),
  reason: text("reason"),
});

/** Whether a person wants their notifications by email too. No row means yes (migration 0033). */
export const notificationSettings = pgTable("notification_settings", {
  recipient: text("recipient").primaryKey(),
  email: boolean("email").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A request for quotation – what is procured, and what every response must cover (migration 0034). */
export const rfqs = pgTable(
  "rfqs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    scope: jsonb("scope").$type<string[]>().notNull().default([]),
    requirements: jsonb("requirements").$type<string[]>().notNull().default([]),
    decidedResponseId: uuid("decided_response_id"),
    decisionReason: text("decision_reason"),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("rfqs_project").on(t.projectId)],
);

/** A response to an RFQ – a filed quotation, what was read from it and what checking it found (migration 0034). */
export const rfqResponses = pgTable("rfq_responses", {
  id: uuid("id").primaryKey().defaultRandom(),
  rfqId: uuid("rfq_id")
    .notNull()
    .references(() => rfqs.id, { onDelete: "cascade" }),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  supplier: text("supplier"),
  extraction: jsonb("extraction"),
  result: jsonb("result"),
  evaluatedAt: timestamp("evaluated_at", { withTimezone: true }),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  error: text("error"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/** What a take-off from drawings rests on – read, derived and assumed figures (migration 0030). */
export const takeoffParameters = pgTable(
  "takeoff_parameters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    label: text("label").notNull(),
    status: text("status").$type<"read" | "derived" | "assumed">().notNull(),
    value: numeric("value", { precision: 18, scale: 4 }).notNull(),
    unit: text("unit").notNull(),
    figure: text("figure"),
    expression: text("expression"),
    quote: text("quote"),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    page: integer("page"),
    assumption: text("assumption"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("takeoff_parameters_project_name").on(t.projectId, t.name)],
);

/** Compliance register – health and safety and statutory approvals (migration 0028). */
export const complianceItems = pgTable("compliance_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  key: text("key"),
  title: text("title").notNull(),
  source: text("source"),
  area: text("area").$type<"health_and_safety" | "statutory">().notNull(),
  stage: text("stage").$type<ComplianceStage>().notNull(),
  responsible: text("responsible"),
  status: text("status").$type<ComplianceStatus>().notNull().default("required"),
  neededBy: date("needed_by"),
  submittedOn: date("submitted_on"),
  approvedOn: date("approved_on"),
  expiresOn: date("expires_on"),
  reference: text("reference"),
  documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
  note: text("note"),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Site meetings and their minutes (migration 0028). */
export const siteMeetings = pgTable(
  "site_meetings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    kind: text("kind").$type<"site" | "progress" | "design" | "client" | "handover">().notNull().default("site"),
    heldOn: date("held_on").notNull(),
    venue: text("venue"),
    chair: text("chair"),
    attendees: text("attendees"),
    apologies: text("apologies"),
    nextOn: date("next_on"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("site_meetings_project_number").on(t.projectId, t.number)],
);

export const meetingItems = pgTable(
  "meeting_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => siteMeetings.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    section: text("section"),
    text: text("text").notNull(),
    actionBy: text("action_by"),
    dueOn: date("due_on"),
    workItemId: uuid("work_item_id").references(() => workItems.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("meeting_items_meeting_seq").on(t.meetingId, t.seq)],
);

/** The Tender Room – a tender on a signed bill, its tenderers, addenda and returns (migration 0029). */
export const tenders = pgTable("tenders", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  billRunId: uuid("bill_run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "restrict" }),
  reference: text("reference").notNull(),
  closingAt: timestamp("closing_at", { withTimezone: true }).notNull(),
  validityDays: integer("validity_days").notNull().default(90),
  briefingAt: timestamp("briefing_at", { withTimezone: true }),
  briefingVenue: text("briefing_venue"),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  issuedBy: text("issued_by"),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  openedBy: text("opened_by"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tenderInvitees = pgTable("tender_invitees", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenderId: uuid("tender_id")
    .notNull()
    .references(() => tenders.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  company: text("company").notNull(),
  contactName: text("contact_name"),
  email: text("email"),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  tenderSum: bigint("tender_sum", { mode: "bigint" }),
  qualifications: text("qualifications"),
  declinedAt: timestamp("declined_at", { withTimezone: true }),
  returnId: uuid("return_id").references(() => tenderReturns.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tenderAddenda = pgTable("tender_addenda", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenderId: uuid("tender_id")
    .notNull()
    .references(() => tenders.id, { onDelete: "cascade" }),
  number: integer("number").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  issuedBy: text("issued_by").notNull(),
});

export const tenderAcknowledgements = pgTable(
  "tender_acknowledgements",
  {
    addendumId: uuid("addendum_id")
      .notNull()
      .references(() => tenderAddenda.id, { onDelete: "cascade" }),
    inviteeId: uuid("invitee_id")
      .notNull()
      .references(() => tenderInvitees.id, { onDelete: "cascade" }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.addendumId, t.inviteeId] })],
);

/**
 * The other documents a response is made of.
 *
 * A submission is often a set: the fee proposal that carries the price, a technical proposal that
 * carries the scope and the registrations, an organogram that carries the team. They are one
 * response — filed as three they would be three respondents, two of them priceless, and the
 * ranking would compare a submission with parts of itself.
 *
 * The priced document stays on `rfq_responses.document_id`, because that is the one the price is
 * read from and the one a clarification is addressed about. These are read with it.
 */
export const rfqResponseDocuments = pgTable(
  "rfq_response_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    responseId: uuid("response_id")
      .notNull()
      .references(() => rfqResponses.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("rfq_response_documents_response").on(t.responseId)],
);


/**
 * Value engineering - the options considered for bringing a cost back to a budget (D1.1).
 *
 * Migration 0036. A register, not an adjustment: nothing here changes a cost plan. An accepted
 * option is a decision to make a change, and the change reaches the money when somebody
 * re-measures or re-rates the work.
 */
export const valueOptions = pgTable(
  "value_options",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Per project, so an option can be called "VE 7" in a meeting. */
    number: integer("number").notNull(),
    /** The cost plan element it bears on, in the plan's own vocabulary. */
    element: text("element"),
    description: text("description").notNull(),
    /** Cents. Positive saves; negative costs more and buys something else. */
    saving: bigint("saving", { mode: "bigint" }).notNull(),
    basis: text("basis").$type<SavingBasis>().notNull().default("estimate"),
    /** What it costs besides money. Every real option trades something. */
    effect: text("effect"),
    status: text("status").$type<ValueOptionStatus>().notNull().default("proposed"),
    raisedBy: text("raised_by"),
    decisionReason: text("decision_reason"),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("value_options_project_number").on(t.projectId, t.number)],
);


// ── Design review ─────────────────────────────────────────────────────────────────────────
// A draft bill read line by line against the design (`domain/design-review.ts`, migration 0040).
// Per-option figures are decimal strings keyed by option, never JSON numbers.

export const designReviews = pgTable("design_reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  subject: text("subject"),
  options: jsonb("options").$type<ReviewOption[]>().notNull().default([]),
  baseOption: text("base_option"),
  recommendation: text("recommendation"),
  limitations: text("limitations"),
  parameterColumns: jsonb("parameter_columns").$type<string[]>().notNull().default([]),
  assumptions: jsonb("assumptions").$type<Partial<ReviewAssumptions>>().notNull().default({}),
  sourceFile: text("source_file"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const reviewSources = pgTable("review_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  reviewId: uuid("review_id")
    .notNull()
    .references(() => designReviews.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  ref: text("ref").notNull(),
  discipline: text("discipline"),
  document: text("document").notNull(),
  dated: text("dated"),
  status: text("status"),
  notes: text("notes"),
  location: text("location"),
});

export const reviewParameters = pgTable("review_parameters", {
  id: uuid("id").primaryKey().defaultRandom(),
  reviewId: uuid("review_id")
    .notNull()
    .references(() => designReviews.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  parameter: text("parameter").notNull(),
  values: jsonb("values").$type<Record<string, string>>().notNull().default({}),
  status: text("status"),
  consequence: text("consequence"),
});

export const reviewItems = pgTable("review_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  reviewId: uuid("review_id")
    .notNull()
    .references(() => designReviews.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  ref: text("ref").notNull(),
  bill: text("bill").notNull(),
  itemNumbers: jsonb("item_numbers").$type<Record<string, string>>().notNull().default({}),
  description: text("description").notNull(),
  unit: text("unit"),
  quantities: jsonb("quantities").$type<Record<string, string | null>>().notNull().default({}),
  designSource: text("design_source"),
  requirement: text("requirement"),
  status: text("status").$type<ItemStatus>(),
  finding: text("finding"),
  action: text("action"),
  rates: jsonb("rates").$type<Record<string, string | null>>().notNull().default({}),
  rateBasis: text("rate_basis"),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reviewQueries = pgTable(
  "review_queries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => designReviews.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    topic: text("topic"),
    query: text("query").notNull(),
    raisedTo: text("raised_to"),
    affects: text("affects"),
    priority: text("priority").$type<QueryPriority>(),
    sourceRef: text("source_ref"),
    response: text("response"),
    status: text("status").$type<QueryStatus>().notNull().default("Open"),
    answeredBy: text("answered_by"),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("review_queries_number").on(t.reviewId, t.number)],
);

export const reviewAdjustments = pgTable("review_adjustments", {
  id: uuid("id").primaryKey().defaultRandom(),
  reviewId: uuid("review_id")
    .notNull()
    .references(() => designReviews.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  ref: text("ref").notNull(),
  queryNumber: integer("query_number"),
  description: text("description").notNull(),
  unit: text("unit"),
  quantities: jsonb("quantities").$type<Record<string, string | null>>().notNull().default({}),
  rates: jsonb("rates").$type<Record<string, string | null>>().notNull().default({}),
  basis: text("basis"),
});

// ── Estimate comparison ───────────────────────────────────────────────────────────────────
// Estimates for the same works side by side (`domain/estimate-comparison.ts`, migration 0041).
// Figures are decimal strings read exactly by the domain, never JSON numbers.

export const estimateComparisons = pgTable("estimate_comparisons", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  subject: text("subject"),
  elements: jsonb("elements").$type<string[]>().notNull().default([]),
  commonUnits: text("common_units"),
  unitLabel: text("unit_label").notNull().default("units"),
  alternativeContingency: text("alternative_contingency"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const comparisonEstimates = pgTable("comparison_estimates", {
  id: uuid("id").primaryKey().defaultRandom(),
  comparisonId: uuid("comparison_id")
    .notNull()
    .references(() => estimateComparisons.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  name: text("name").notNull(),
  preparedBy: text("prepared_by"),
  dated: text("dated"),
  basis: text("basis"),
  units: text("units"),
  preliminaries: text("preliminaries").notNull().default("0.1000"),
  contingency: text("contingency").notNull().default("0.1000"),
  derivedFrom: uuid("derived_from").references((): AnyPgColumn => comparisonEstimates.id, { onDelete: "set null" }),
});

export const comparisonLines = pgTable("comparison_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  estimateId: uuid("estimate_id")
    .notNull()
    .references(() => comparisonEstimates.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  element: text("element").notNull(),
  description: text("description").notNull(),
  quantity: text("quantity"),
  unit: text("unit"),
  rate: text("rate"),
  lumpSum: text("lump_sum"),
});

export const comparisonCorrections = pgTable("comparison_corrections", {
  id: uuid("id").primaryKey().defaultRandom(),
  estimateId: uuid("estimate_id")
    .notNull()
    .references(() => comparisonEstimates.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  ref: text("ref").notNull(),
  element: text("element").notNull(),
  description: text("description").notNull(),
  amount: text("amount").notNull(),
  basis: text("basis"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const comparisonClarifications = pgTable(
  "comparison_clarifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    comparisonId: uuid("comparison_id")
      .notNull()
      .references(() => estimateComparisons.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    estimate: text("estimate"),
    observation: text("observation").notNull(),
    evidence: text("evidence"),
    consequence: text("consequence"),
    response: text("response"),
    status: text("status").$type<ClarificationStatus>().notNull().default("Open"),
    answeredBy: text("answered_by"),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("comparison_clarifications_number").on(t.comparisonId, t.number)],
);