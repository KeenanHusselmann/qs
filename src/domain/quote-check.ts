/**
 * Checking a quotation – D1.3, an RFQ response read and verified. PLATFORM.md §1.3.2, §5.
 *
 * ── The model describes the quotation; this checks it ─────────────────────────────────────
 *
 * The evaluating agent reads a quotation and returns its price lines as the document prints them –
 * each figure verbatim, with the words around it – and, for every line that is worked out from
 * others, how: `L1+L2+L3+L4+L5` for a subtotal, `L6*0.10` for ten per cent of it, `7454400 +
 * 0.09*(L9 - 94960000)` for an ECSA fee. It does no arithmetic. This file does all of it.
 *
 * Each line is checked twice:
 *
 *   - **locally** – its working against the document's *own* figures for the lines it reads. This
 *     is what finds where an error is: a subtotal that does not add up is wrong there, and the ten
 *     per cent taken of it afterwards is right about the figure it was given.
 *   - **carried forward** – its working against the *corrected* figures above it, which is what the
 *     quotation actually comes to once every error is put right. The ten per cent is then flagged
 *     as consequential, not as a second mistake.
 *
 * A stated figure that cannot be found in the document, or read without guessing, is not checked
 * and is said to be unreadable rather than taken on trust.
 *
 * ── Rands, to the cent ─────────────────────────────────────────────────────────────────────
 *
 * Stated figures are read by `readAmount` into cents. The working is evaluated in rands and rounded
 * to the cent once; a difference of a cent or less is agreement, up to a rand is rounding, and more
 * than a rand is an error worth a clarification.
 */

import { readAmount, readQuantity, readRate } from "@/domain/amount";
import { inSentence } from "@/domain/elemental-plan";
import { evaluate, namesIn, parseExpression } from "@/domain/measure-expression";

export type LineRole = "item" | "subtotal" | "adjustment" | "discount" | "vat" | "total" | "fee";

export interface QuoteLine {
  id: string;
  label: string;
  role: LineRole;
  /** The amount as printed – "R 12 444 283.60" – or null for a line that prints none. */
  figure: string | null;
  quantity?: string | null;
  rate?: string | null;
  /** How the document works the line out, over other lines' ids: "L1+L2", "L6*0.10". */
  expression?: string | null;
  /** The document's words around the figure, verbatim. */
  quote?: string | null;
}

/**
 * agrees – within a cent; rounding – within a rand; error – more; consequential – right about the
 * figure it was given, wrong once an error above it is corrected; not found – the figure's words are
 * not in the document; unreadable – the figure cannot be read without guessing; unchecked – a line
 * with no working to check it by; check by eye – a working that does not reconcile on figures OCR
 * read from an image, where a misread ("55%" for "5%") is as likely as a mistake.
 */
export type LineVerdict = "agrees" | "rounding" | "error" | "consequential" | "not found" | "unchecked" | "unreadable" | "check by eye";

export interface CheckedLine {
  id: string;
  label: string;
  role: LineRole;
  /** Cents, as the document states it. */
  stated: number | null;
  /** Cents, as its own working gives it from the document's figures. */
  computed: number | null;
  /** Cents, with every correction above it carried forward. */
  corrected: number | null;
  verdict: LineVerdict;
  working: string | null;
  note: string | null;
  /** Where the figure was found, when it was. */
  source: { page: number | null; image?: boolean } | null;
}

/** Where a quote was found in the document; injected so this stays free of the database. */
export type Locate = (quote: string, figure: string) => { page: number | null; image?: boolean } | null;

const cents = (rands: number) => Math.round(rands * 100);
const rands = (c: number) => c / 100;

function readFigure(text: string): number | null {
  const r = readAmount(text);
  return r.ok ? Number(r.amount) : null;
}

/** A quantity × rate line: both read without guessing, or not at all. */
function extension(line: QuoteLine): number | null {
  if (!line.quantity || !line.rate) return null;
  const q = readQuantity(line.quantity.replace(/[a-z²³/]+$/i, "").trim());
  const r = readRate(line.rate.replace(/\s*\/.*$/, "").trim());
  if (!q.ok || !r.ok) return null;
  const qty = Number(q.quantity) / 10_000;
  const rate = Number(r.rate.value) / 10 ** r.rate.precision;
  return cents(qty * rate);
}

/** Whether the printed rate is the stated amount over the quantity, rounded to the rate's own precision. */
function roundedRate(line: QuoteLine, stated: number): boolean {
  if (!line.quantity || !line.rate) return false;
  const q = readQuantity(line.quantity.replace(/[a-z²³/]+$/i, "").trim());
  const r = readRate(line.rate.replace(/\s*\/.*$/, "").trim());
  if (!q.ok || !r.ok) return false;
  const qty = Number(q.quantity) / 10_000;
  if (qty <= 0) return false;
  // To the places the rate is printed to – "511" is whole rands – not the places it is stored to.
  // One or two places only: "1,350" is thousands, not three decimals.
  const printed = /[.,](\d{1,2})\s*$/.exec(line.rate.replace(/\s*\/.*$/, "").trim())?.[1]?.length ?? 0;
  const rate = Number(r.rate.value) / 10 ** r.rate.precision;
  return Math.abs(Math.round((stated / 100 / qty) * 10 ** printed) / 10 ** printed - rate) < 1e-9;
}

export function checkLines(lines: readonly QuoteLine[], locate: Locate): CheckedLine[] {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const out = new Map<string, CheckedLine>();

  // Stated figures first – every working reads them.
  for (const line of lines) {
    let stated: number | null = null;
    let note: string | null = null;
    let source: CheckedLine["source"] = null;
    if (line.figure) {
      stated = readFigure(line.figure);
      if (stated === null) note = `"${line.figure}" cannot be read as an amount without guessing.`;
      else if (line.quote) {
        source = locate(line.quote, line.figure);
        if (!source) note = "The figure's words were not found in the document.";
        // Read from a picture by OCR: found, but a misread digit is possible – a person confirms it.
        else if (source.image) note = `Read from an image on page ${source.page ?? "?"} by OCR – confirm it by eye.`;
      }
    }
    out.set(line.id, { id: line.id, label: line.label, role: line.role, stated, computed: null, corrected: null, verdict: "unchecked", working: line.expression ?? null, note, source });
  }

  // Local check: each working against the document's own figures.
  const statedValues = new Map([...out.values()].filter((c) => c.stated !== null).map((c) => [c.id, rands(c.stated!)]));
  const parsed = new Map<string, ReturnType<typeof parseExpression>>();
  for (const line of lines) {
    const c = out.get(line.id)!;
    if (line.expression) {
      const p = parseExpression(line.expression);
      parsed.set(line.id, p);
      if (!p.ok) {
        c.note = `The working "${line.expression}" does not read: ${p.reason}`;
        continue;
      }
      const e = evaluate(p.expr, statedValues);
      if (e.ok) c.computed = cents(e.value);
      else c.note = `The working "${line.expression}" cannot be evaluated: ${e.reason}`;
    } else {
      const x = extension(line);
      if (x !== null) {
        c.computed = x;
        c.working = `${line.quantity} × ${line.rate}`;
      }
    }
    if (c.stated === null) c.verdict = line.figure ? "unreadable" : "unchecked";
    else if (line.quote && !c.source) c.verdict = "not found";
    else if (c.computed === null) c.verdict = "unchecked";
    else {
      const diff = Math.abs(c.stated - c.computed);
      c.verdict = diff <= 1 ? "agrees" : diff <= 100 ? "rounding" : "error";
      // A rate printed as the amount divided by the quantity, rounded – "R 511/h" for R 1 080 000
      // over 2 112 hours – is the amount restated, not a second figure that disagrees with it.
      if (c.verdict === "error" && !line.expression && roundedRate(line, c.stated)) {
        c.verdict = "rounding";
        c.note = `The rate is the amount divided by the quantity, rounded to ${line.rate} – not a separate price.`;
      }
      // Not reconciling on what OCR read from a picture is not yet an error: a person reads the picture.
      if (c.verdict === "error" && c.source?.image) {
        c.verdict = "check by eye";
        c.note = `Read from an image on page ${c.source.page ?? "?"} by OCR, it does not reconcile as read (${line.expression ?? "its working"}) – possibly a misread; check the figure by eye.`;
      }
    }
  }

  // Carried forward: the corrected figure of each line, in dependency order.
  const corrected = new Map<string, number>();
  const pending = new Set(lines.map((l) => l.id));
  let progress = true;
  while (pending.size && progress) {
    progress = false;
    for (const id of [...pending]) {
      const line = byId.get(id)!;
      const c = out.get(id)!;
      const p = parsed.get(id);
      const reads = p && p.ok ? namesIn(p.expr).filter((n) => byId.has(n)) : [];
      if (!reads.every((n) => corrected.has(n))) continue;
      pending.delete(id);
      progress = true;
      let value: number | null = null;
      if (p && p.ok) {
        const values = new Map(statedValues);
        for (const n of reads) values.set(n, rands(corrected.get(n)!));
        const e = evaluate(p.expr, values);
        if (e.ok) value = cents(e.value);
      } else if (!line.expression) {
        value = extension(line);
      }
      // An error is put right; a line that agreed, or rounded, keeps what it states.
      const keep = c.stated !== null && (c.verdict === "agrees" || c.verdict === "rounding" || c.verdict === "unchecked" || c.verdict === "check by eye") && (value === null || c.computed === value);
      c.corrected = keep ? c.stated : (value ?? c.stated);
      if (c.corrected !== null) corrected.set(id, c.corrected);
      if (c.verdict !== "error" && c.stated !== null && c.corrected !== null && Math.abs(c.corrected - c.stated) > 100) c.verdict = "consequential";
      // Wrong against the printed figure above it, right against the corrected one: the quotation
      // worked this line from the right number and only the line above it misprints it.
      if (c.verdict === "error" && value !== null && c.stated !== null && Math.abs(c.stated - value) <= 1) {
        c.verdict = "agrees";
        c.corrected = c.stated;
        corrected.set(id, c.stated);
        c.note = "Right on the corrected figure above it – the error is in the line it reads, not here.";
      }
    }
  }
  for (const id of pending) {
    const c = out.get(id)!;
    c.corrected = c.stated;
    c.note = c.note ?? "Its working reads a line that could not be settled.";
  }
  return lines.map((l) => out.get(l.id)!);
}

// ── Scope, requirements and the whole response ──────────────────────────────────────────────

export type ScopeStatus = "included" | "excluded" | "not stated";
export type RequirementStatus = "met" | "not met" | "not stated";

export interface QuoteExtraction {
  /** The firm that submitted it – null where its name is not in the text (a letterhead image). */
  supplier: string | null;
  /** Who signed it, where stated – the name there is when the firm's is not. */
  signatory?: string | null;
  reference: string | null;
  date: string | null;
  addressedTo: string | null;
  validity: string | null;
  lines: QuoteLine[];
  /** The id of the line that is the price excluding VAT. */
  totalExclVat: string | null;
  totalInclVat: string | null;
  /** What a fee is a percentage of – the cost of works – where the quotation states one. */
  basis: { label: string; figure: string; quote: string | null } | null;
  /**
   * Each RFQ scope item: whether it is covered, and – for the like-for-like comparison – the line
   * that prices it and the figure that price is calculated on (a civil fee on the civil works).
   */
  scope: { item: string; status: ScopeStatus; quote: string | null; priceLine?: string | null; basis?: string | null; derivedFrom?: string[] }[];
  /** Services priced beyond what the RFQ asked for – why two totals may not be comparable. */
  extraScope: string[];
  exclusions: string[];
  assumptions: string[];
  requirements: { requirement: string; status: RequirementStatus; evidence: string | null }[];
  /** A discount applied to every fee line, as printed ("15%"), so a scope item's net price can be worked out. */
  discount?: string | null;
  /**
   * A fee worked as a formula of the cost of works – ECSA's primary fee plus a percentage of the
   * excess – written over BASIS; the line that is the cost of works the fee should rest on; and the
   * line that is the fee before discount. Lets the fee be recomputed on the corrected cost of works.
   */
  fee?: { formula: string; basisLine: string | null; feeLine: string | null } | null;
  /** The facts every response should agree on – the site extent, the construction estimate – as each states them. */
  facts?: { fact: string; value: string | null; quote: string | null }[];
  /** Risks the response itself carries – a deep discount, a fee outside the tariff – with its own words. */
  risks?: { text: string; quote: string | null }[];
  /** What the response refers to but its text does not contain – a fee table shown as an image. Not checked. */
  unseen?: string[];
  /**
   * Tables of counts – hours per stage, units, bays – with their row and column totals. Checked
   * exactly: an hour out is an hour out, though it moves no price.
   */
  tallies?: { id: string; label: string; figure: string | null; expression?: string | null; quote?: string | null }[];
  /** The same, transcribed as tables – the compact form a model can return for a large hours table. */
  countTables?: CountTable[];
  /** What a careful reader would query in the document itself – a role named two ways, a section cited that is not there. Each already found in the text. */
  observations?: { text: string; quotes: string[] }[];
}

export interface CheckedResponse {
  supplier: string;
  /** False where the firm's name is not in the response's text and the name shown is a stand-in. */
  named: boolean;
  signatory: string | null;
  reference: string | null;
  date: string | null;
  addressedTo: string | null;
  validity: string | null;
  lines: CheckedLine[];
  /** Cents. */
  statedTotal: number | null;
  correctedTotal: number | null;
  statedInclVat: number | null;
  correctedInclVat: number | null;
  basis: { label: string; value: number | null; figure: string } | null;
  /** The price as a percentage of the basis, to two places – "7,03" – where there is one. */
  effectiveRate: number | null;
  scope: QuoteExtraction["scope"];
  extraScope: string[];
  exclusions: string[];
  assumptions: string[];
  requirements: QuoteExtraction["requirements"];
  errors: CheckedLine[];
  /** Each scope item's net price and what it is calculated on – for comparing only what every response prices. */
  scopePrices: { item: string; net: number | null; basis: number | null; rate: number | null; derived?: boolean }[];
  /** The fee recomputed on the corrected cost of works, where an error changed it. Cents. */
  feeImpact: { basisUsed: number | null; basisStated: number | null; basisCorrected: number; grossOnCorrected: number; netOnCorrected: number; change: number } | null;
  /** The fee calculated on a figure other than the cost of works the response itself states. */
  basisMismatch: { used: number; stated: number } | null;
  facts: NonNullable<QuoteExtraction["facts"]>;
  risks: NonNullable<QuoteExtraction["risks"]>;
  unseen: string[];
  tallies: CheckedTally[];
  observations: NonNullable<QuoteExtraction["observations"]>;
}

export interface CheckedTally {
  id: string;
  label: string;
  stated: number | null;
  computed: number | null;
  verdict: "agrees" | "error" | "unchecked" | "unreadable";
  working: string | null;
}

/** "6 090", "1,267", "12.5" – a count as printed, or null where it cannot be read without guessing. */
function readCount(figure: string | null): number | null {
  if (!figure) return null;
  let t = figure.replace(/[\s\u00a0]/g, "").replace(/[a-z²³]+\.?$/i, "");
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, "");
  else if (/^\d+,\d{1,2}$/.test(t)) t = t.replace(",", ".");
  const n = Number(t);
  return /^-?\d+(\.\d+)?$/.test(t) && Number.isFinite(n) ? n : null;
}

/**
 * A table of counts as the response prints it – hours per person per stage – transcribed, not
 * summed: rows of cells, whether each row's last cell is its total, and which rows each subtotal
 * row gathers. The totals are the platform's to check, not the model's to vouch for.
 */
export interface CountTable {
  title: string;
  columns: string[];
  rows: { label: string; cells: (string | null)[]; lastIsTotal?: boolean; sums?: number[] }[];
}

/** A table of counts as tallies: each figure a tally, each row total and each subtotal cell a sum of the ones it gathers. */
export function tablesToTallies(tables: readonly CountTable[]): NonNullable<QuoteExtraction["tallies"]> {
  const out: NonNullable<QuoteExtraction["tallies"]> = [];
  tables.forEach((table, t) => {
    const id = (r: number, c: number) => `C${t + 1}R${r + 1}K${c + 1}`;
    table.rows.forEach((row, r) => {
      const last = row.cells.length - 1;
      row.cells.forEach((figure, c) => {
        const parts: string[] = [];
        // A subtotal row: each of its cells is the same column summed over the rows it gathers.
        if (row.sums?.length) for (const s of row.sums) if (table.rows[s]?.cells[c] != null) parts.push(id(s, c));
        // A row total: the row's other cells summed. Where a subtotal's own total is also a row
        // total, the column sum is checked and the row sum with it (a second tally).
        const across = row.lastIsTotal && c === last && last > 0 ? row.cells.slice(0, last).map((v, k) => (v != null ? id(r, k) : null)).filter((x): x is string => x !== null) : [];
        out.push({ id: id(r, c), label: `${table.title} – ${row.label} – ${table.columns[c] ?? `column ${c + 1}`}`, figure, expression: parts.length ? parts.join("+") : across.length ? across.join("+") : null });
        if (parts.length && across.length) out.push({ id: `${id(r, c)}X`, label: `${table.title} – ${row.label} – ${table.columns[c] ?? `column ${c + 1}`} (across the row)`, figure, expression: across.join("+") });
      });
    });
  });
  return out;
}

/** Each total in a table of counts against the rows it gathers – exactly. */
export function checkTallies(tallies: NonNullable<QuoteExtraction["tallies"]>): CheckedTally[] {
  const values = new Map<string, number>();
  for (const t of tallies) {
    const v = readCount(t.figure);
    if (v !== null) values.set(t.id, v);
  }
  return tallies.map((t) => {
    const stated = readCount(t.figure);
    let computed: number | null = null;
    if (t.expression) {
      const p = parseExpression(t.expression);
      if (p.ok) {
        const e = evaluate(p.expr, values);
        if (e.ok) computed = Math.round(e.value * 10_000) / 10_000;
      }
    }
    const verdict = stated === null ? (t.figure ? "unreadable" : "unchecked") : computed === null ? "unchecked" : Math.abs(stated - computed) < 1e-6 ? "agrees" : "error";
    return { id: t.id, label: t.label, stated, computed, verdict, working: t.expression ?? null };
  });
}

/** "15%", "0.15" or "15" – a fraction, or null where it cannot be read. */
function fraction(text: string | null | undefined): number | null {
  if (!text) return null;
  const n = Number(text.replace(/[%\s]/g, "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return null;
  return n > 1 ? n / 100 : n;
}

/** An unfilled template field: "R[amount]", "[insert date]", "XXXX", "________". */
export function placeholder(text: string | null): boolean {
  return /\[[^\]]{0,40}\]|\bX{3,}\b|_{4,}|<[^>]{1,30}>/.test(text ?? "");
}

/** "Dear Sir", "Sir/Madam", "To whom it may concern" – a greeting, not a client. */
export function isSalutation(addressee: string | null): boolean {
  return /^\s*(dear\s+)?(sirs?|madam|sir\s*(\/|or)\s*madam|to whom it may concern)\s*[,.]?\s*$/i.test(addressee ?? "");
}

/**
 * A figure specific enough to stand as its own evidence: rands and cents, seven digits or more –
 * "R442 704,54". A table cell has no words around it, and a figure like that does not occur by
 * chance; "R 45" or "15%" would, and still needs its words.
 */
export function distinctFigure(figure: string | null): boolean {
  if (!figure) return false;
  const digits = figure.replace(/\D/g, "");
  return /[.,]\d{2}\s*$/.test(figure.trim()) && digits.length >= 7;
}

export function checkResponse(q: QuoteExtraction, locate: Locate, fallbackName = "Unnamed respondent"): CheckedResponse {
  const lines = checkLines(q.lines, locate);
  const line = (id: string | null) => (id ? lines.find((l) => l.id === id) ?? null : null);
  const total = line(q.totalExclVat);
  const incl = line(q.totalInclVat);
  const basisValue = q.basis ? readFigure(q.basis.figure) : null;
  const correctedTotal = total?.corrected ?? total?.stated ?? null;
  // The addressee is the client, never the respondent – a model that read the letter's "To:" as
  // its sender would otherwise recommend the client to themselves.
  const named = Boolean(q.supplier && q.supplier.toLowerCase() !== (q.addressedTo ?? "").toLowerCase());
  return {
    supplier: named ? q.supplier! : fallbackName,
    named,
    signatory: q.signatory ?? null,
    reference: q.reference,
    date: q.date,
    addressedTo: q.addressedTo,
    validity: q.validity,
    lines,
    statedTotal: total?.stated ?? null,
    correctedTotal,
    statedInclVat: incl?.stated ?? null,
    correctedInclVat: incl?.corrected ?? incl?.stated ?? null,
    basis: q.basis ? { label: q.basis.label, value: basisValue, figure: q.basis.figure } : null,
    effectiveRate: basisValue && correctedTotal ? Math.round((correctedTotal / basisValue) * 10_000) / 100 : null,
    scope: q.scope,
    extraScope: q.extraScope,
    exclusions: q.exclusions,
    assumptions: q.assumptions,
    /*
      Addressed to the client only where it names one, whatever the reading made of it: "Dear Sir"
      names nobody, and a response the reading found no addressee in is not shown to be addressed.
    */
    requirements: q.requirements.map((r) => {
      if (r.status !== "met") return r;
      // A template left unfilled – "cover of R[amount] per claim" – shows the requirement is not met.
      if (placeholder(r.evidence)) return { ...r, status: "not met" as const, evidence: `Left as a placeholder: ${r.evidence}` };
      if (!/addressed/i.test(r.requirement)) return r;
      if (isSalutation(q.addressedTo)) return { ...r, status: "not met" as const, evidence: `Addressed only "${q.addressedTo!.trim()}" – no client named` };
      if (!q.addressedTo?.trim()) return { ...r, status: "not stated" as const, evidence: "No addressee found in the response" };
      return r;
    }),
    errors: lines.filter((l) => l.verdict === "error"),
    ...priceBreakdown(q, lines, basisValue, correctedTotal),
    facts: q.facts ?? [],
    risks: q.risks ?? [],
    unseen: q.unseen ?? [],
    tallies: checkTallies([...(q.tallies ?? []), ...tablesToTallies(q.countTables ?? [])]),
    observations: q.observations ?? [],
  };
}

/**
 * The like-for-like figures and the fee recomputed – everything that needs more than one line.
 *
 * A scope item's net price is its priced line, corrected, less the discount the response applies to
 * every fee. The fee recomputed evaluates the response's own formula on the corrected cost of works
 * and applies the same discount, so what an error in the estimate does to the fee is stated in rand.
 */
function priceBreakdown(q: QuoteExtraction, lines: CheckedLine[], basisValue: number | null, correctedTotal: number | null) {
  const line = (id: string | null | undefined) => (id ? lines.find((l) => l.id === id) ?? null : null);
  const keep = 1 - (fraction(q.discount) ?? 0);
  const value = (l: CheckedLine | null) => l?.corrected ?? l?.stated ?? null;

  // A line named as the price of two scope items prices neither on its own – a design-office fee
  // covering civil and structural is not the civil fee.
  // Whether a line's working reaches a discount line – the price it states is then the net one.
  const afterDiscount = (id: string | null | undefined, seen = new Set<string>()): boolean => {
    const l = id ? q.lines.find((x) => x.id === id) : undefined;
    if (!l || seen.has(l.id)) return false;
    seen.add(l.id);
    if (l.role === "discount") return true;
    const p = l.expression ? parseExpression(l.expression) : null;
    return p?.ok ? namesIn(p.expr).some((n) => afterDiscount(n, seen)) : false;
  };
  // Shared across items priced on different costs of works (civil on R 92 m, structural on R 295 m)
  // – not a line that prices one discipline's design and its stage 5 together, as a civil fee for
  // stages 1–6 does.
  const bases = new Map<string, Set<string>>();
  for (const s of q.scope) if (s.priceLine && s.status === "included") bases.set(s.priceLine, (bases.get(s.priceLine) ?? new Set()).add(s.basis ? String(readFigure(s.basis) ?? s.basis) : ""));
  const shared = new Set([...bases].filter(([, b]) => [...b].filter(Boolean).length > 1).map(([id]) => id));
  const scopePrices = q.scope.map((s) => {
    const priced = s.priceLine && shared.has(s.priceLine) ? null : value(line(s.priceLine));
    // A line already after the discount – "proposed fee = fee less 15%" – is not discounted twice.
    const net = s.status === "included" && priced !== null ? Math.round(priced * (afterDiscount(s.priceLine) ? 1 : keep)) : null;
    const basis = s.basis ? readFigure(s.basis) : null;
    if (net === null && s.status === "included" && s.derivedFrom?.length) {
      // Not priced on its own, but the response's breakdown names the lines that make it up: their
      // sum, after the discount, labelled derived – an indication for comparing, never a price offered.
      const parts = s.derivedFrom.map((id) => value(line(id)));
      if (parts.every((p) => p !== null)) {
        const d = Math.round(parts.reduce((a, b) => a! + b!, 0)! * keep);
        return { item: s.item, net: d, basis, rate: basis ? Math.round((d / basis) * 10_000) / 100 : null, derived: true };
      }
    }
    return { item: s.item, net, basis, rate: net !== null && basis ? Math.round((net / basis) * 10_000) / 100 : null };
  });

  let feeImpact: CheckedResponse["feeImpact"] = null;
  let basisMismatch: CheckedResponse["basisMismatch"] = null;
  /*
    The reading's fee formula is taken only where it holds: on the response's own estimate it must
    give (within 10%) the fee the response prints. A formula tied to the wrong line – contingencies
    for the cost of works – gives a fee a fraction of the printed one, and would recompute nonsense.
    Otherwise the formula is found from the lines themselves.
  */
  const holds = (f: QuoteExtraction["fee"]) => {
    if (!f?.formula) return false;
    const p = parseExpression(f.formula);
    const cow = line(f.basisLine);
    const printedFee = line(f.feeLine)?.stated ?? null;
    if (!p.ok || !cow || cow.stated === null) return false;
    if (printedFee === null) return true;
    const e = evaluate(p.expr, new Map([["BASIS", rands(cow.stated)]]));
    return e.ok && Math.abs(cents(e.value) - printedFee) <= printedFee * 0.1;
  };
  const inferred = inferFee(q, lines);
  const fee = holds(q.fee) ? q.fee : holds(inferred) ? inferred : null;
  if (fee) {
    const p = parseExpression(fee.formula);
    const cow = line(fee.basisLine);
    if (p.ok && cow && cow.stated !== null) {
      const at = (c: number) => {
        const e = evaluate(p.expr, new Map([["BASIS", rands(c)]]));
        return e.ok ? cents(e.value) : null;
      };
      /*
        The figure the fee was actually calculated on, worked back from the fee the response prints
        through its own formula – not taken on the model's say-so. A fee formula is linear within a
        bracket, so two points find it exactly.
      */
      // The figure the fee line itself prints, where it prints one near the estimate – exact – and
      // otherwise the figure worked back from the printed fee.
      // Only a figure the response prints: working a basis back through a formula is defeated by the
      // first complexity factor applied after it, and a false mismatch is worse than none.
      const used = literalNear(q.lines.find((l) => l.id === fee.feeLine)?.expression ?? null, cow.stated) ?? cow.stated;
      if (Math.abs(used - cow.stated) > 100) basisMismatch = { used, stated: cow.stated };
      const corrected = cow.corrected ?? cow.stated;
      const gross = at(corrected);
      // Recomputed only where an arithmetic error moved the cost of works.
      if (gross !== null && Math.abs(corrected - cow.stated) > 100) {
        const net = Math.round(gross * keep);
        feeImpact = { basisUsed: used, basisStated: cow.stated, basisCorrected: corrected, grossOnCorrected: gross, netOnCorrected: net, change: correctedTotal !== null ? net - correctedTotal : 0 };
      }
    }
  }
  // A fee worked on a figure other than the estimate is a percentage of that figure: the rate is
  // taken on what the fee was calculated on (R 150 403 151,25), not on the estimate beside it.
  const mismatch = basisMismatch as CheckedResponse["basisMismatch"];
  const rated = mismatch
    ? scopePrices.map((s) => (s.net !== null && s.basis === mismatch.stated ? { ...s, basis: mismatch.used, rate: Math.round((s.net / mismatch.used) * 10_000) / 100 } : s))
    : scopePrices;
  return { scopePrices: rated, feeImpact, basisMismatch };
}

/**
 * A fee formula the response prints but the reader did not name: a fee line whose working carries a
 * figure within 10% of one of the response's own totals – that figure is the cost of works it was
 * calculated on, the total is the estimate it should rest on, and the working over BASIS is the
 * formula. Found from the lines themselves, so the fee is recomputed whether or not it was flagged.
 */
function inferFee(q: QuoteExtraction, lines: CheckedLine[]): QuoteExtraction["fee"] {
  const totals = lines.filter((l) => (l.role === "total" || l.role === "subtotal") && l.stated !== null);
  for (const f of q.lines) {
    if (f.role !== "fee" || !f.expression) continue;
    for (const m of f.expression.matchAll(/\d+(?:\.\d+)?/g)) {
      const literal = Math.round(Number(m[0]) * 100);
      if (literal < 100_000_000) continue;
      // The nearest of the response's totals – a subtotal ten per cent off is not the estimate.
      const cow = totals
        .filter((t) => t.id !== f.id && Math.abs(t.stated! - literal) <= t.stated! * 0.1)
        .sort((x, y) => Math.abs(x.stated! - literal) - Math.abs(y.stated! - literal))[0];
      if (cow) return { formula: f.expression.replace(m[0], "BASIS"), basisLine: cow.id, feeLine: f.id };
    }
  }
  return null;
}

/** A figure written into a working within 10% of a cost of works – the basis it prints outright. Cents. */
function literalNear(expression: string | null, near: number): number | null {
  if (!expression) return null;
  let best: number | null = null;
  for (const m of expression.matchAll(/\d+(?:\.\d+)?/g)) {
    const literal = Math.round(Number(m[0]) * 100);
    if (Math.abs(literal - near) <= near * 0.1 && (best === null || Math.abs(literal - near) < Math.abs(best - near))) best = literal;
  }
  return best;
}

// ── The recommendation ──────────────────────────────────────────────────────────────────────

export interface Recommendation {
  /** Index into the responses, or null where none can be recommended. */
  preferred: number | null;
  comparable: boolean;
  headline: string;
  reasons: string[];
  clarifications: string[];
  /** Responses in order of preference, by index. */
  ranking: number[];
  /** The scope items every response prices, and each response's net price and rate for them. */
  likeForLike: { item: string; prices: { supplier: string; net: number | null; basis: number | null; rate: number | null; derived?: boolean }[] }[];
  /** Facts the responses state differently – the site extent, the estimate – which a price comparison rests on. */
  differences: { fact: string; values: { supplier: string; value: string }[] }[];
  /** Risks each response carries, in its own words. */
  risks: { supplier: string; text: string }[];
}

const count = (n: number) => n.toLocaleString("en-ZA", { maximumFractionDigits: 4 }).replace(/,/g, " ").replace(".", ",");

const rand = (c: number) => {
  const neg = c < 0;
  const [w, f] = (Math.abs(c) / 100).toFixed(2).split(".");
  return `${neg ? "-" : ""}R ${w!.replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${f}`;
};

/**
 * Rank the responses and say which to prefer, and why – by a rule a reader can check.
 *
 * Responses covering more of the required scope rank first, then those meeting more requirements,
 * then the lowest corrected price. Where the responses price different scopes – a required item
 * one covers and another does not, or services priced beyond the request – their totals are not
 * comparable, and the preference is provisional and conditional on the clarifications, which this
 * writes from the findings: every arithmetic error, every scope item not covered, every requirement
 * not shown.
 */
export function recommend(responses: readonly CheckedResponse[]): Recommendation {
  const priced = responses.map((r, i) => ({ r, i })).filter(({ r }) => r.correctedTotal !== null);
  const covered = (r: CheckedResponse) => r.scope.filter((s) => s.status === "included").length;
  const met = (r: CheckedResponse) => r.requirements.filter((s) => s.status === "met").length;
  const ranking = [...priced]
    .sort((a, b) => covered(b.r) - covered(a.r) || met(b.r) - met(a.r) || a.r.correctedTotal! - b.r.correctedTotal!)
    .map(({ i }) => i);

  const clarifications: string[] = [];
  for (const r of responses) {
    if (!r.named) clarifications.push(`${r.supplier}: the firm's name is not in the response's text${r.signatory ? ` (signed by ${r.signatory})` : ""} – confirm who submitted it.`);
    const totalIsAnError = r.errors.some((e) => e.stated === r.statedTotal);
    for (const e of r.errors) {
      clarifications.push(`${r.supplier}: confirm ${inSentence(e.label)} – the quotation states ${rand(e.stated!)}, and its own figures give ${rand(e.computed!)}.`);
    }
    if (!totalIsAnError && r.correctedTotal !== null && r.statedTotal !== null && Math.abs(r.correctedTotal - r.statedTotal) > 100) {
      clarifications.push(`${r.supplier}: confirm the price excluding VAT – ${rand(r.statedTotal)} as stated, ${rand(r.correctedTotal)} with the arithmetic corrected.`);
    }
    for (const s of r.scope.filter((s) => s.status !== "included")) {
      clarifications.push(`${r.supplier}: ${s.status === "excluded" ? "price" : "confirm whether the price includes"} ${inSentence(s.item)}.`);
    }
    for (const l of r.lines.filter((l) => l.verdict === "check by eye")) {
      clarifications.push(`${r.supplier}: check ${inSentence(l.label)} by eye – read from an image, ${rand(l.stated!)} does not reconcile with its working as read (${rand(l.computed!)}).`);
    }
    for (const u of r.unseen) {
      clarifications.push(`${r.supplier}: ${inSentence(u)} is not in the response's text (an image, most often), so it was not checked – ask for it as text, or check it by eye.`);
    }
    if (r.basisMismatch) {
      clarifications.push(`${r.supplier}: confirm the cost of works the fee is calculated on – ${rand(r.basisMismatch.used)}, where the response's own estimate is ${rand(r.basisMismatch.stated)}.`);
    }
    if (r.feeImpact) {
      clarifications.push(
        `${r.supplier}: confirm the fee on the corrected cost of works – on ${rand(r.feeImpact.basisCorrected)} the response's own formula gives ${rand(r.feeImpact.grossOnCorrected)}, ${rand(r.feeImpact.netOnCorrected)} after its discount (${r.feeImpact.change >= 0 ? "+" : "−"}${rand(Math.abs(r.feeImpact.change))} on the offer).`,
      );
    }
    // One question per table: an hour out shows in its column, its row and the grand total at once.
    const byTable = new Map<string, CheckedTally[]>();
    for (const t of r.tallies.filter((t) => t.verdict === "error")) {
      const table = t.label.split(" – ")[0]!;
      if (!t.label.endsWith("(across the row)")) byTable.set(table, [...(byTable.get(table) ?? []), t]);
    }
    for (const [table, wrong] of byTable) {
      clarifications.push(
        `${r.supplier}: confirm the ${inSentence(table)} – ${wrong.map((t) => `${t.label.split(" – ").slice(1).join(", ")} is ${count(t.stated!)} where its figures give ${count(t.computed!)}`).join("; ")} (a count – no effect on the price).`,
      );
    }
    for (const o of r.observations) clarifications.push(`${r.supplier}: ${inSentence(o.text)}`);
    const missing = r.requirements.filter((q) => q.status !== "met").map((q) => inSentence(q.requirement));
    if (missing.length) clarifications.push(`${r.supplier}: the response does not show – ${missing.join("; ")}.`);
  }

  // Facts the responses state differently – each a question for all of them.
  const differences: Recommendation["differences"] = [];
  const factNames = [...new Set(responses.flatMap((r) => r.facts.map((f) => f.fact)))];
  for (const fact of factNames) {
    const values = responses.flatMap((r) => {
      const v = r.facts.find((f) => f.fact === fact)?.value;
      return v ? [{ supplier: r.supplier, value: v }] : [];
    });
    const distinct = new Set(values.map((v) => v.value.replace(/\s+/g, "").toLowerCase()));
    if (values.length > 1 && distinct.size > 1) {
      differences.push({ fact, values });
      clarifications.push(`All respondents: confirm the ${inSentence(fact)} – ${values.map((v) => `${v.value} (${v.supplier})`).join(" against ")}.`);
    }
  }
  const risks = responses.flatMap((r) => r.risks.map((k) => ({ supplier: r.supplier, text: k.text })));

  // The scope items every priced response covers – the only prices that compare directly.
  const shared = (responses[0]?.scope ?? []).map((s) => s.item).filter((item) => responses.every((r) => r.scope.find((s) => s.item === item)?.status === "included"));
  const likeForLike = shared
    .map((item) => ({ item, prices: responses.map((r) => ({ supplier: r.supplier, ...(r.scopePrices.find((p) => p.item === item) ?? { net: null, basis: null, rate: null }) })) }))
    .filter((l) => l.prices.some((p) => p.net !== null));

  if (priced.length === 0) {
    return { preferred: null, comparable: false, headline: "No response states a price that could be read, so none can be recommended.", reasons: [], clarifications, ranking, likeForLike, differences, risks };
  }

  const scopeKey = (r: CheckedResponse) => r.scope.map((s) => (s.status === "included" ? "1" : "0")).join("");
  const sameScope = new Set(priced.map(({ r }) => scopeKey(r))).size === 1;
  const extra = priced.filter(({ r }) => r.extraScope.length > 0);
  const comparable = sameScope && extra.length === 0;
  if (!comparable) clarifications.unshift("All respondents: price the same scope on a common basis, so the totals can be compared and each part awarded on its own.");

  const best = responses[ranking[0]!]!;
  const reasons: string[] = [];
  const allScope = best.scope.length;
  reasons.push(`${best.supplier} covers ${covered(best)} of the ${allScope} required scope items${best.requirements.length ? ` and shows ${met(best)} of the ${best.requirements.length} requirements` : ""}.`);
  reasons.push(`Its price excluding VAT is ${rand(best.correctedTotal!)}${best.errors.length ? ` with the arithmetic corrected (${best.errors.length} error${best.errors.length === 1 ? "" : "s"} found)` : ", and its arithmetic checks"}.`);
  for (const i of ranking.slice(1)) {
    const r = responses[i]!;
    const why = covered(r) < covered(best) ? `covers ${covered(r)} of ${allScope} scope items` : met(r) < met(best) ? `shows ${met(r)} of ${r.requirements.length} requirements` : `is dearer at ${rand(r.correctedTotal!)}`;
    reasons.push(`${r.supplier} ranks lower: it ${why}${r.correctedTotal !== null ? ` (${rand(r.correctedTotal)} excluding VAT, corrected)` : ""}.`);
  }
  // Like for like: what each response asks for the scope they all price, and as a percentage of what it is worked on.
  for (const l of likeForLike) {
    reasons.push(
      `On the scope every response prices – ${inSentence(l.item)}: ${l.prices
        .map((p) => `${p.supplier} ${p.net !== null ? `${"derived" in p && p.derived ? "about " : ""}${rand(p.net)}` : "not priced separately"}${p.rate !== null ? ` (${p.rate.toFixed(2).replace(".", ",")}% of ${rand(p.basis!)})` : ""}${"derived" in p && p.derived ? " – derived from its breakdown, not a price it offers" : ""}`)
        .join("; ")}.`,
    );
  }
  const headline = comparable
    ? `${best.supplier} is recommended${best.errors.length || clarifications.length ? ", subject to the clarifications below" : ""}.`
    : `The responses cannot be ranked on price as submitted – ${!sameScope ? "they cover different parts of the required scope" : "some price services beyond the request"}. ${best.supplier} is provisionally preferred, subject to the clarifications below.`;

  return { preferred: ranking[0]!, comparable, headline, reasons, clarifications, ranking, likeForLike, differences, risks };
}
