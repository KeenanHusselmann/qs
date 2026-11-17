/**
 * What a **row-shaped** run is — PLATFORM.md §1.3.3, §4.7, §5.2.
 *
 * ── Why the field set could not be stretched to cover this ─────────────────────────────────
 *
 * `run.ts` describes a run as "the fields it must return": ten for the feasibility estimate,
 * thirteen for the cost plan, each a named scalar with one value. That is the right shape for a cost
 * model and the wrong shape for a bill. §1.3.3 says it plainly — *"an agent proposes bill items from
 * the documents and the upstream cost plan"* — and an item is not a field. It is a row with a
 * description, a unit, a quantity, a rate and an amount; how many rows there are is discovered from
 * the documents; and the arithmetic is per row.
 *
 * Everything else is deliberately identical. The same `runs` row, the same signature, the same
 * freeze, the same four maps of §1.3.1 — `proposed` never edited, `overrides` where the human wins,
 * `working` derived, `output` frozen once. What changes is that a row carries five values, so
 * `working` is five coalesces rather than one.
 *
 * ── This module is the contract, not the work ──────────────────────────────────────────────
 *
 * As with `run.ts`: the types and the declarations are here because both sides of the wire need
 * them, the reading happens on the server, and `streamBill` is the client's half. Money crosses that
 * wire as **strings** — minor units, unparsed — because a `bigint` cannot be serialised into a client
 * component and a `number` is how a costing system starts quietly disagreeing with itself.
 */

import type { Citation } from "@/lib/agent/run";
import { extend, money, parseQuantity, rate, sum, type Money } from "@/domain/money";

/**
 * §4.7's row vocabulary. Rows of different types look different and mean different things, and a
 * heading carrying a quantity is a bug — the database says so too (`run_items_only_items_priced`).
 *
 * `heading` and `item` are what this platform writes today. The rest are named because they are the
 * domain's own list and a bill that could not eventually carry a provisional sum would not be a
 * bill; declaring them now is a check constraint rather than a migration on a signed table later.
 */
export type BillRowType =
  | "heading"
  | "item"
  | "subtotal"
  | "provisional_sum"
  | "prime_cost"
  | "note";

/**
 * Where a quantity came from — §6.3, and the one thing that genuinely is per cell.
 *
 * Not derivable from anything else on the row: a figure a QS typed and a figure they pasted out of a
 * spreadsheet are both overrides by the same person at the same moment, and only this says which.
 * `takeoff` is what a measured quantity will carry when take-off lands (§10); nothing writes it yet.
 */
export type QuantitySource = "manual" | "takeoff" | "imported" | "ai_derived";

/**
 * Where a **rate** came from — §6.3, and the exact parallel of the line above.
 *
 * §6.3 lists `manual | build_up | library | rate_set | tender` for a bill item's rate. Two more
 * belong to this platform and not to that list, because it was written for a world where nothing
 * read the documents: `ai_derived` is the agent's own proposal, and `imported` is a column pasted
 * out of a spreadsheet — which §12 calls the thing a QS with twenty years of bills actually needs.
 *
 * The last three are named and written by nothing today. They arrive with the Rate Library, and
 * naming them now is a check constraint rather than a migration on a signed table later.
 *
 * A build-up is the near miss that makes this a stored column rather than a derived one: a row with
 * one attached looks as though its rate must have come from it, right up until the QS types over
 * the top — which §4.8 requires be possible, and flagged.
 */
export type RateSource =
  | "ai_derived"
  | "manual"
  | "imported"
  | "build_up"
  | "library"
  | "rate_set"
  | "tender";

/** A rate and the scale it is held at — §5.1, as it crosses to the client. */
export interface WireRate {
  /** Minor units, as a decimal string. `bigint` does not survive the serialisation boundary. */
  value: string;
  precision: number;
}

/** What the agent proposed for one row. Never edited — the record of what the machine said. */
export interface ProposedRow {
  description: string | null;
  unit: string | null;
  /** `numeric(18,4)` as a string — "1250.0000". Never a `number`. */
  quantity: string | null;
  rate: WireRate | null;
  /**
   * What the document actually said, where the figure could not be read as a number.
   *
   * `readAmount` refuses rather than guesses: "R1 850,00 per cubic metre" is a *rate*, "1,234" is a
   * thousand-fold ambiguity nothing in the text settles. A refused figure leaves the cell empty and
   * puts the document's own words beside it, so the QS reads the source rather than the platform's
   * guess at it.
   */
  quantityText: string | null;
  rateText: string | null;
  confidence: number;
  note: string | null;
}

export interface OverrideRow {
  description: string | null;
  unit: string | null;
  quantity: string | null;
  rate: WireRate | null;
  reason: string | null;
  by: string;
  at: string;
}

/** One row of a bill, with all four maps of §1.3.1 as they are stored. */
export interface BillRow {
  id: string;
  seq: number;
  parentId: string | null;
  rowType: BillRowType;
  itemRef: string | null;
  proposed: ProposedRow;
  /** The passage the row was read from. Per row, not per cell (§1.3.2). */
  citation: Citation | null;
  override: OverrideRow | null;
  quantitySource: QuantitySource;
  rateSource: RateSource;
  /** `round(quantity × rate)`, written by the database and by nothing else. Minor units. */
  amount: string | null;
  /** Frozen at sign-off. Null in a draft, and null on a row that was struck out. */
  output: {
    description: string | null;
    unit: string | null;
    quantity: string | null;
    rate: WireRate | null;
    amount: string | null;
  } | null;
  /** Struck through rather than deleted — `proposed` is what makes the bill reviewable. */
  omitted: { by: string; at: string } | null;
}

/** A bill as a run, rather than as a grid somebody is holding in a tab. */
export interface PersistedBill {
  id: string;
  module: string;
  status: "running" | "review" | "failed";
  error: string | null;
  startedAt: string;
  lastWriteAt: string;
  signedBy: string | null;
  signedAt: string | null;
  spend: { input: number; output: number; rand: number | null } | null;
  rows: BillRow[];
}

/**
 * `working` — proposed plus overrides, human wins (§1.3.1), for five values instead of one.
 *
 * One function, used by the screen, by the sign-off gate and by the totals. The database applies the
 * same rule in the extension trigger, which is the one place two implementations exist — and
 * `checks/bill.mjs` is what stops them drifting.
 */
export function workingRow(row: BillRow): {
  description: string | null;
  unit: string | null;
  quantity: string | null;
  rate: WireRate | null;
} {
  return {
    description: row.override?.description ?? row.proposed.description,
    unit: row.override?.unit ?? row.proposed.unit,
    quantity: row.override?.quantity ?? row.proposed.quantity,
    rate: row.override?.rate ?? row.proposed.rate,
  };
}

/** The cells a person may correct. One list, so the grid, the paste and the writer agree. */
export const EDITABLE_CELLS = ["description", "unit", "quantity", "rate"] as const;
export type EditableCell = (typeof EDITABLE_CELLS)[number];

export const CELL_LABEL: Readonly<Record<EditableCell, string>> = {
  description: "Description",
  unit: "Unit",
  quantity: "Qty",
  rate: "Rate",
};

/** Rows that count: items, not struck out. Headings and notes carry no money by construction. */
export const pricedRows = (rows: readonly BillRow[]): BillRow[] =>
  rows.filter((row) => row.rowType === "item" && !row.omitted);

/**
 * The bill total — **derived, never stored** (§6.5), and a sum of already-rounded amounts (§5.2).
 *
 * Nothing here rounds. That happened once, per item, in the database, and re-rounding a sum is the
 * thing §5.2 forbids by name. A row with no amount contributes nothing and is *not* treated as
 * nought — the gate below refuses to sign a bill that still contains one.
 */
export function billTotal(rows: readonly BillRow[], signed = false): Money {
  return sum(
    pricedRows(rows)
      .map((row) => (signed ? row.output?.amount : row.amount))
      .filter((amount): amount is string => amount !== null && amount !== undefined)
      .map((amount) => money(BigInt(amount))),
  );
}

/** The same sum, for one heading's own rows. Derived on every read, like every other subtotal. */
export function sectionTotal(rows: readonly BillRow[], headingId: string, signed = false): Money {
  return billTotal(
    rows.filter((row) => row.parentId === headingId),
    signed,
  );
}

/**
 * Whether this bill can be signed, and what is stopping it.
 *
 * The field-set version of this asks "which required fields have no working value". A bill has no
 * required fields — it has rows — so the rule becomes: **no item row may go to sign-off without a
 * working quantity and rate.** An item with a description and no measure is a line somebody has yet
 * to do the work for, and freezing it would put a hole in the middle of a total every downstream
 * step reads as approved.
 *
 * Headings and notes are exempt by construction, which is what `row_type` is for. A struck row is
 * exempt because it is not in the bill. And a bill with no item rows at all is refused: signing an
 * empty bill would produce an approved total of nought over a job that has not been measured.
 */
export function blockingRows(rows: readonly BillRow[]): {
  rows: { id: string; description: string; missing: string; cells: EditableCell[] }[];
  empty: boolean;
} {
  const priced = pricedRows(rows);

  return {
    empty: priced.length === 0,
    rows: priced.flatMap((row) => {
      const working = workingRow(row);
      /*
        The columns as well as the words.

        The prose is what a reader is told; the columns are where the gate can *send* them. A panel
        holding only "a quantity and a rate" had to parse its own sentence back into columns to do
        that, so both come from one place and cannot disagree.
      */
      const cells: EditableCell[] = [
        ...(working.quantity === null ? (["quantity"] as const) : []),
        ...(working.rate === null ? (["rate"] as const) : []),
      ];

      if (cells.length === 0) return [];

      return [
        {
          id: row.id,
          description: working.description ?? "An unnamed item",
          missing: cells.map((c) => (c === "quantity" ? "a quantity" : "a rate")).join(" and "),
          cells,
        },
      ];
    }),
  };
}

/**
 * The item reference for every row, **derived from position** — "1.2" is the second item of the
 * first section.
 *
 * Nothing numbers a bill yet. `item_ref` is a column and it is null on every row, so the choice was
 * an empty column on the most important screen in the app or a reference that moves when a row is
 * inserted above it. This is the second, and the cost is stated rather than hidden: a QS who quotes
 * "1.2" in a meeting is quoting a position, not a name. A **stable** reference belongs at the moment
 * a bill is issued, which is the moment it freezes — `item_ref` is written then, and every caller
 * falls back to it the instant anything writes one.
 *
 * Here rather than in a grid because two screens render these rows now (§4.7 and §4.8), and two
 * numberings of one bill is the drift a QS would notice first and trust least.
 */
export function itemReferences(rows: readonly BillRow[]): Map<string, string> {
  const refs = new Map<string, string>();

  let section: string | null = null;
  let sectionNumber = 0;
  let itemNumber = 0;

  for (const row of rows) {
    if (row.rowType === "heading") {
      section = row.id;
      sectionNumber += 1;
      itemNumber = 0;
      refs.set(row.id, String(sectionNumber));
      continue;
    }

    if (row.parentId !== section) {
      section = row.parentId;
    }

    itemNumber += 1;
    refs.set(row.id, sectionNumber === 0 ? String(itemNumber) : `${sectionNumber}.${itemNumber}`);
  }

  return refs;
}

/**
 * `round(quantity × rate)` in TypeScript, over the wire types.
 *
 * The **database** computes the stored amount; this exists so the screen can show what an amount
 * *would* be while a cell is being edited, and so a test can assert the two agree. `extend()` is
 * still the only function that rounds.
 */
export function extendRow(qty: string | null, unitRate: WireRate | null): Money | null {
  if (qty === null || unitRate === null) return null;

  // `parseQuantity` rather than splitting on the decimal point by hand. `numeric(18,4)` arrives as
  // "1250.0000" and a second parser for a format the database already fixed is a second place for
  // the sign, the scale or a truncation to be got wrong.
  return extend(parseQuantity(qty), rate(BigInt(unitRate.value), unitRate.precision));
}

/**
 * The modules whose run proposes **rows** rather than fields.
 *
 * A module is run-producing because it declares what a run of it establishes — a `FieldSpec[]` in
 * `FIELD_SETS`, or an `ItemSpec` here. `chain.ts` reads both and everything else falls out of that:
 * what gates what, what may be signed, what the panel renders.
 *
 * ── Why the bill does not wait for a signed cost plan ──────────────────────────────────────
 *
 * `upstreamPending` gates a step on the upstreams it **carries a required figure from**, and a bill
 * carries none: it is measured from drawings and a specification, and the elemental cost plan is a
 * parallel estimate of the same work rather than an input the bill cannot be produced without. Real
 * jobs bill from drawings with no elemental plan signed, and gating on one would make that
 * impossible in order to enforce a sequence nobody works to. The chain still names D1.1 above it,
 * because it does feed it — `feedsFrom` is "provides data to", and only `requiredCarriesFrom` is a
 * gate. That distinction is already the one variations and valuations rest on.
 */
export interface ItemSpec {
  /**
   * What to search the corpus for. **The words a priced document uses**, not a description of a
   * bill — the same rule and the same recall bias as `FieldSpec.terms`, for the same reason: an
   * extra passage costs a few tokens and the model says it holds no items, while a missed one is
   * indistinguishable on screen from the documents not describing any work.
   */
  terms: readonly string[];
  /** What a row of this bill *is*, in the reader's words. The prompt and the empty state share it. */
  wants: string;
  /**
   * The kinds of document that **measure** the work – their rows carry quantities and rates. When
   * one is filed, items are read from these alone and every passage of them is read.
   */
  measured: readonly string[];
  /**
   * The kinds that **describe** the work without measuring it. Read only when nothing measured is
   * filed: reading both proposes every item twice, once from the clause and once from the bill line,
   * in different words that no duplicate check can match – a bill that double-counts.
   */
  described: readonly string[];
  /*
    Nothing else is read. The run used to search the whole corpus, and a contract instruction's
    "Omit: vinyl tiling, 14 959 m² at R 385,00/m²" reads exactly like a bill line – so a variation
    issued seven months after the bill was proposed as an item of the bill it varies. Cost plans,
    valuations, cost reports and tender schedules are the same trap: amounts against descriptions,
    and none of them a measured item of this bill.
  */
}

export const ITEM_SETS: Readonly<Record<string, ItemSpec>> = {
  "/bill": {
    wants:
      "a measurable item of construction work — what is to be built, in what unit it is measured, how much of it, and at what rate",
    measured: ["Bill of quantities", "Priced bill"],
    described: ["Specification", "Finishes schedule", "Typology schedule"],
    terms: [
      "per cubic metre",
      "per square metre",
      "per linear metre",
      "rate of",
      "supply and lay",
      "supply and install",
      "excavation",
      "concrete",
      "brickwork",
      "external walls",
      "internal partitions",
      "surface beds",
      "strip footings",
      "reinforcement",
      "formwork",
      "roof covering",
      "floor finishes",
      "wall finishes",
      "provisional sum",
      "prime cost",
      "measured in accordance",
      "bill of quantities",
    ],
  },
};

/** Whether this module's run is row-shaped. */
export const producesItems = (module: string): boolean => module in ITEM_SETS;

/**
 * The steps that open from **another step's signed rows** rather than from the corpus.
 *
 * ── The carry the platform did not have ────────────────────────────────────────────────────
 *
 * `FieldSpec.carriedFrom` carries one named figure out of an upstream run, and every dependency in
 * this platform was expressed that way. A bill has no named figures — it has four hundred rows — so
 * the most consequential output the platform produces could not be declared as an input to
 * anything. The consequence was visible on the chain: D1.2 feeds D1.3 in the process model, the
 * BPMN's own flow ends `QA Check --> |Pass| D1.3 Tender Documentation`, and Tender Analysis was
 * startable on a project with no bill at all, because `upstreamPending` had nothing to read.
 *
 * ── Why this is a gate and not merely an edge ──────────────────────────────────────────────
 *
 * `chain.ts` is careful that "provides data to" is not "must come first" — variations feed
 * valuations and a first certificate has no variations, so gating there would block a normal
 * month's work. A row carry is the other case, and it is the strict one: tender documentation *is*
 * the bill, sent out to be priced. There is no version of D1.3 that proceeds without it, so unlike
 * an optional carried field this always gates.
 *
 * ── Declared, because it cannot be derived ─────────────────────────────────────────────────
 *
 * The process model has D1.3 `reads: ["Bill of Quantities", …]`, which is prose for a reader, and
 * D1.2 holds four nav items so an area edge resolves to no single module. Deriving the carry would
 * mean matching a module against an English phrase. One line, stated, beside the row-shaped runs it
 * joins — and `chain.ts` reads it the same way it reads a field's `carriedFrom`, so the gate, the
 * chain and the menu all fall out of this rather than being three lists that can disagree.
 */
export const ROW_CARRIES: Readonly<Record<string, string>> = {
  "/tender-analysis": "/bill",
};

/** The step whose signed rows this one opens from, if it is that kind of step. */
export const carriesRowsFrom = (module: string): string | undefined => ROW_CARRIES[module];

export const itemSpecFor = (module: string): ItemSpec | undefined => ITEM_SETS[module];

/** One row, as the stream reports it the moment it settles. */
export interface ItemResult {
  /** The heading it belongs under, as the passage grouped it. Null for an ungrouped row. */
  section: string | null;
  description: string;
  unit: string | null;
  quantity: string | null;
  quantityText: string | null;
  rate: WireRate | null;
  rateText: string | null;
  confidence: number;
  note: string | null;
  citation: Citation | null;
}

export interface BillEvent {
  type: "item" | "done" | "error";
  item?: ItemResult;
  error?: string;
  /** On `done`: what the run spent, and how many passages it read to find these rows. */
  spend?: { input: number; output: number; rand: number | null };
  read?: number;
  /**
   * Rows the model offered whose quote was not in the filed documents, and which were therefore
   * never written. Reported rather than swallowed — "the documents describe no work" and "four rows
   * were invented and caught" send a QS to completely different places.
   */
  discarded?: number;
  /** Cover-page lines offered as work and set aside. A different fault from a discarded row. */
  furniture?: number;
  /** On `done`: the documents were longer than one run reads, so the rest were not read. */
  unread?: boolean;
  /**
   * On `done`: whether the rows came from a measured bill or from documents that only describe the
   * work. From descriptions, every item arrives with no quantity – which is correct, and which the
   * panel has to explain, or it reads as a run that failed to find the figures.
   */
  from?: "measured" | "described";
}

/**
 * Post to a route that answers in NDJSON, and yield its events as they arrive.
 *
 * Shared with `streamRun`. Both open a run that streams, both have to survive a chunk splitting a
 * line mid-character, and both turn a refusal into an event of their own shape — which is why the
 * caller supplies that rather than this making an assumption about their event type.
 */
export async function* streamNdjson<T>(
  url: string,
  refusal: (message: string) => T,
): AsyncGenerator<T> {
  let response: Response;
  try {
    response = await fetch(url, { method: "POST" });
  } catch {
    yield refusal("The run did not reach the server. Check the connection.");
    return;
  }

  if (!response.ok || !response.body) {
    // The server refuses in words — a missing key, a corpus with nothing in it — and those words are
    // the whole point, so they are read out rather than replaced with a status code.
    const said = await response.text().catch(() => "");
    yield refusal(said.trim() || `The server refused the run (HTTP ${response.status}).`);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // A chunk can split a line anywhere, including mid-character; the last fragment stays in the
    // buffer until its newline arrives.
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        yield JSON.parse(line) as T;
      } catch {
        // A half-written line is a bug on the sending side, not something to show a QS. Skipped
        // rather than crashing a run that produced twenty good rows.
      }
    }
  }

  if (buffer.trim()) {
    try {
      yield JSON.parse(buffer) as T;
    } catch {
      /* as above */
    }
  }
}

/** Open a bill run and yield its rows as they are read. */
export const streamBill = (projectId: string, module: string): AsyncGenerator<BillEvent> =>
  streamNdjson<BillEvent>(
    `/api/projects/${projectId}/runs?module=${encodeURIComponent(module)}`,
    (error) => ({ type: "error", error }),
  );
