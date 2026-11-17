/**
 * Evaluating a quotation – the RFQ agent (D1.3). PLATFORM.md §1.3.2, §5.
 *
 * The model reads one quotation against the RFQ – what was asked for, and what every response must
 * show – and describes it: who submitted it, its price lines as printed with how each is worked
 * out, which scope items it covers, what it excludes, which requirements it meets and on what
 * evidence. It totals nothing and compares nothing. `domain/quote-check.ts` checks every figure
 * against the document and does all the arithmetic; the recommendation is the platform's rule.
 */

import { asc, inArray } from "drizzle-orm";

import { db } from "@/db/client";
import { documents, passages } from "@/db/schema";
import { checkResponse, distinctFigure, type CheckedResponse, type LineRole, type QuoteExtraction, type RequirementStatus, type ScopeStatus } from "@/domain/quote-check";
import { addUsage, askForJson, type Usage } from "@/lib/agent/deepseek";
import { fence } from "@/lib/egress/fence";
import { locateQuote } from "@/lib/agent/grounding";
import { nearFigure } from "@/lib/agent/measure-drawings";
import { figuresAllowed, numbersIn } from "@/lib/agent/ask";
import { DEFAULT_FACTS } from "@/lib/rfq-defaults";
import { imageText, type ImageReading } from "@/lib/ingest/image-text";
import { read } from "@/lib/ingest/storage";

const MAX_CHARS = 60_000;

const SYSTEM = `You are a senior South African quantity surveyor evaluating a response to a request for quotation (RFQ). You are given the RFQ – what is being procured, the scope items every response must cover, the requirements every response must show – and the TEXT of one response, as numbered passages.

Describe the response. You do NO arithmetic and make NO comparison: the platform checks every figure and every sum you describe.

Passages headed "IMAGE on page N, read by OCR" are the words of a picture in the response – a fee table pasted as a screenshot, a letterhead – read by OCR. Use them as part of the response: a fee calculation shown as an image is still the fee calculation. OCR misreads digits and punctuation ("R237.400", "Rio5776411"): take a figure from an image only where it reads cleanly, copy its quote exactly as the OCR text has it, and leave out what is garbled. A letterhead's web address or e-mail domain ("www.mutec.co.za") names the firm.

Return:
- "supplier": the firm that submitted the response, as its name appears in the text – NEVER the client or person it is addressed to. A letterhead is often an image, so the firm's name may not be in the text at all: then "supplier" is null – do not guess it, and do not use the addressee. "signatory": the person who signed it and their title, or null. "reference", "date", "addressedTo" (the client or person it is addressed to, as written – a bare salutation such as "Dear Sir" is returned as it stands), "validity" (how long the price holds) – each as the document writes it, or null.
- "lines": EVERY price line in document order – items, subtotals, percentage additions (P&G, contingencies), discounts, reimbursables, VAT, totals, fee calculations, AND every table that apportions a fee by stage or by discipline. A table with several money columns ("Civil Fee", "Structural Fee", "Stage Total") is several sets of lines: every figure in EVERY column is a line (label it with the row and the column – "Stage 3 – structural"), every column total is a line whose expression sums that column's figures, and every row total is a line whose expression sums that row's figures. Leave no column out – a table the response prints is a table the checker adds up. For each:
  - "id": "L1", "L2", … in order;
  - "label": the line's own words, short;
  - "role": item | subtotal | adjustment | discount | vat | total | fee;
  - "figure": the amount EXACTLY as printed ("R 12 444 283.60", "R 7,770,189.00", "R252 531,14"), or null where the line prints none;
  - "quantity" and "rate": as printed, where the line is PRICED as a quantity times a rate; else null. Hours or quantities shown beside a lump sum, a monthly cost or an allowance "for balancing" or "for information" are not a quantity times a rate – null for both;
  - "expression": how the line is worked out, in the working the document's layout implies – over the ids of the lines it uses and the document's own numbers. A subtotal is the sum of the lines above it that it gathers ("L1+L2+L3+L4+L5"); a percentage line is that percentage of the line it applies to, written as a decimal ("L6*0.10"); a discount "L11*0.15"; a net figure "L11-L12"; a fee formula with its primary fee and percentage ("7454400 + 0.09*(150403151.25 - 94960000)"). A fee formula uses the figures the formula PRINTS – the cost of works it names, even where that differs from the estimate elsewhere in the response – written as numbers, never as the id of the estimate line. NEVER copy the line's own printed result into its expression, and never correct the document: if a subtotal gathers five items, sum all five even if its printed figure looks short – the checker finds errors. null for a line that is simply stated.
  - "quote": the document's words around the figure, copied CHARACTER FOR CHARACTER, at least 15 characters.
- "countTables": every table of COUNTS that is not money – hours per stage and per person, units, bays – TRANSCRIBED, not summed: {"title": short; "columns": the headers of the count columns only, in order ("St 1", …, "Total h"); "rows": every row in order, each {"label": short, "cells": its counts as printed, one per column, null for a blank; "lastIsTotal": true where the row's last cell is the total of its others; "sums": for a subtotal or total row, the 0-based indexes of the rows it gathers, else omitted}}. Leave money columns out – they are price lines. [] where there are none.
- "totalExclVat": the id of the line that is the price the respondent offers, excluding VAT – for a fee proposal the proposed fee, never the construction estimate. "totalInclVat": the id of the price including VAT, or null.
- "basis": where the price is a percentage of something (a fee on the cost of works), the value it is calculated on: {"label", "figure" as printed, "quote"}; else null.
- "scope": for EACH RFQ scope item, in the order given: {"item": the RFQ's words, "status": included | excluded | not stated, "quote": the response's words that show it, or null, "priceLine": the id of the line that prices this item on its own (a civil fee line for civil engineering), or null where the response does not price it separately, "basis": the cost of works of THAT item its price is calculated on, as printed (the civil works cost for a civil fee, the structural cost for a structural fee), or null, "derivedFrom": where the response does NOT price the item on its own but its breakdown lists who or what does that work – the team rows for civil engineering in a fee built from hours – the ids of those price lines; else []}. A response that prices only one service prices it in its total fee line.
- "extraScope": services the response prices that the RFQ did not ask for – short phrases – or [].
- "exclusions" and "assumptions": short phrases, as the response states them.
- "requirements": for EACH RFQ requirement, in the order given: {"requirement": the RFQ's words, "status": met | not met | not stated, "evidence": the response's words, or null}. "met" only where the response DOES what the requirement asks, not where it mentions it: fees "rendered in accordance with" a guideline but priced by the hour or as a lump sum are not fees calculated on it; a field left blank or as a placeholder ("R[amount]") is not met.
- "discount": the discount the response applies to its fees, as printed ("15%"), or null.
- "fee": where the fee is worked as a formula of the cost of works (a primary fee plus a percentage of the amount above a bracket), {"formula": that formula written over the word BASIS with the response's own numbers – "7454400 + 0.09*(BASIS - 94960000)"; "basisLine": the id of the line that is the construction estimate the fee should rest on (the response's own total cost of works); "feeLine": the id of the fee line before discount}; else null. Use the bracket figures the response itself prints.
- "facts": for EACH fact asked for, in the order given: {"fact": the fact's words, "value": as the response states it, or null, "quote": its words, or null}. A fact is often stated only inside a price line or its working – "25 000 m² site × R40/m²" states the site extent – so read the whole response for it before answering null.
- "unseen": what the response refers to but neither its text nor the OCR of its images contains – an annexure not attached, an image listed below as unread – "fee calculation table (shown as Image 1)", "area schedule (an image)" – short phrases, or []. These cannot be checked, and saying so is what stops them being taken as checked.
- "risks": what in the response a careful evaluator would question – a very deep discount, a fee outside the guideline's tariff, an estimate from rough rates, work the client must still pay for – each {"text": one short sentence, using only figures the response prints, "quote": the response's words}. NEVER a claim that figures do or do not add up, agree or match – the checker does every sum, and a risk that does arithmetic is a guess the report would repeat. [] where there are none.

Reply with json in exactly this shape:
{"discount":string|null,"fee":{"formula":string,"basisLine":string|null,"feeLine":string|null}|null,"facts":[{"fact":string,"value":string|null,"quote":string|null}],"risks":[{"text":string,"quote":string|null}],"unseen":[string],"supplier":string|null,"signatory":string|null,"reference":string|null,"date":string|null,"addressedTo":string|null,"validity":string|null,
 "lines":[{"id":string,"label":string,"role":string,"figure":string|null,"quantity":string|null,"rate":string|null,"expression":string|null,"quote":string|null}],
 "totalExclVat":string|null,"totalInclVat":string|null,"basis":{"label":string,"figure":string,"quote":string|null}|null,
 "scope":[{"item":string,"status":string,"quote":string|null,"priceLine":string|null,"basis":string|null}],"extraScope":[string],"exclusions":[string],"assumptions":[string],
 "requirements":[{"requirement":string,"status":string,"evidence":string|null}],
 "countTables":[{"title":string,"columns":[string],"rows":[{"label":string,"cells":[string|null],"lastIsTotal":boolean,"sums":[number]}]}]}`;

/*
  The second reading – what a senior QS does after the numbers: reads the proposal as a document and
  asks what does not hang together. Its findings are held to the text like everything else: an
  observation whose words cannot be found in the response is dropped.
*/
const REVIEW = `You are a senior South African quantity surveyor reviewing a consultant's fee proposal after its arithmetic has been checked by others. Read it as a document and list what a careful reviewer would query IN THE DOCUMENT ITSELF:
- the same role, person, service or amount named or described differently in different places;
- a section, table, annexure or drawing referred to but not in the document;
- a statement of scope, basis or condition that another part of the document contradicts;
- a field left blank or as a template placeholder;
- a condition that lets the price rise later without a cap (time-based beyond an assumed period, fees adjusted if the estimate moves).
Do NOT check sums or percentages – that is done. Do NOT restate prices, discounts or scope gaps – those are reported elsewhere. Do NOT give opinions on the firm. The client a proposal is addressed to often heads its first page – that is the addressee, not a second party. Only what the document itself shows.

Each finding: {"text": one short sentence a client could act on, naming the places ("section 6 calls it … ; the team table calls it …"), using only figures the document prints; "quotes": 1–3 excerpts copied CHARACTER FOR CHARACTER from the document, each at least 15 characters, that show it}. At most 8, the most material first. [] where there are none.

Reply with json: {"observations":[{"text":string,"quotes":[string]}]}`;

const ROLES: readonly LineRole[] = ["item", "subtotal", "adjustment", "discount", "vat", "total", "fee"];
const text = (v: unknown): string | null => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(text).filter((s): s is string => s !== null) : []);

/** The model's reply read defensively, and held to the RFQ's own items – in its order, none added or lost. */
export function readExtraction(json: unknown, scope: readonly string[], requirements: readonly string[], facts: readonly string[] = DEFAULT_FACTS): QuoteExtraction {
  const o = (json ?? {}) as Record<string, unknown>;
  const lines = (Array.isArray(o.lines) ? o.lines : []).map((raw, i) => {
    const l = (raw ?? {}) as Record<string, unknown>;
    const role = text(l.role) as LineRole | null;
    return {
      id: text(l.id) ?? `L${i + 1}`,
      label: text(l.label) ?? `Line ${i + 1}`,
      role: role && ROLES.includes(role) ? role : ("item" as LineRole),
      figure: text(l.figure),
      quantity: text(l.quantity),
      rate: text(l.rate),
      expression: text(l.expression),
      quote: text(l.quote),
    };
  });
  const scopeRead = (Array.isArray(o.scope) ? o.scope : []) as Record<string, unknown>[];
  const reqRead = (Array.isArray(o.requirements) ? o.requirements : []) as Record<string, unknown>[];
  const statusOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => {
    const s = text(v)?.toLowerCase() as T | undefined;
    return s && allowed.includes(s) ? s : fallback;
  };
  const basis = (o.basis ?? null) as Record<string, unknown> | null;
  const fee = (o.fee ?? null) as Record<string, unknown> | null;
  const factsRead = (Array.isArray(o.facts) ? o.facts : []) as Record<string, unknown>[];
  return {
    supplier: text(o.supplier),
    signatory: text(o.signatory),
    reference: text(o.reference),
    date: text(o.date),
    addressedTo: text(o.addressedTo),
    validity: text(o.validity),
    lines,
    totalExclVat: text(o.totalExclVat),
    totalInclVat: text(o.totalInclVat),
    basis: basis && text(basis.figure) ? { label: text(basis.label) ?? "Basis", figure: text(basis.figure)!, quote: text(basis.quote) } : null,
    scope: scope.map((item, i) => {
      const r = scopeRead[i] ?? scopeRead.find((s) => text(s.item)?.toLowerCase() === item.toLowerCase()) ?? {};
      return { item, status: statusOf<ScopeStatus>(r.status, ["included", "excluded", "not stated"], "not stated"), quote: text(r.quote), priceLine: text(r.priceLine), basis: text(r.basis), derivedFrom: list(r.derivedFrom) };
    }),
    extraScope: list(o.extraScope),
    exclusions: list(o.exclusions),
    assumptions: list(o.assumptions),
    requirements: requirements.map((requirement, i) => {
      const r = reqRead[i] ?? reqRead.find((s) => text(s.requirement)?.toLowerCase() === requirement.toLowerCase()) ?? {};
      return { requirement, status: statusOf<RequirementStatus>(r.status, ["met", "not met", "not stated"], "not stated"), evidence: text(r.evidence) };
    }),
    discount: text(o.discount),
    fee: fee && text(fee.formula) ? { formula: text(fee.formula)!, basisLine: text(fee.basisLine), feeLine: text(fee.feeLine) } : null,
    facts: facts.map((fact, i) => {
      const r = factsRead[i] ?? factsRead.find((f) => text(f.fact)?.toLowerCase() === fact.toLowerCase()) ?? {};
      return { fact, value: text(r.value), quote: text(r.quote) };
    }),
    unseen: list(o.unseen),
    countTables: (Array.isArray(o.countTables) ? o.countTables : []).map((raw, i) => {
      const t = (raw ?? {}) as Record<string, unknown>;
      const rows = (Array.isArray(t.rows) ? t.rows : []).map((rr, k) => {
        const r = (rr ?? {}) as Record<string, unknown>;
        const sums = Array.isArray(r.sums) ? r.sums.filter((n): n is number => Number.isInteger(n) && (n as number) >= 0) : [];
        return { label: text(r.label) ?? `Row ${k + 1}`, cells: (Array.isArray(r.cells) ? r.cells : []).map((c) => text(c)), lastIsTotal: r.lastIsTotal === true, sums };
      });
      return { title: text(t.title) ?? `Table ${i + 1}`, columns: list(t.columns), rows };
    }),
    risks: (Array.isArray(o.risks) ? o.risks : []).flatMap((raw) => {
      const k = (raw ?? {}) as Record<string, unknown>;
      return text(k.text) ? [{ text: text(k.text)!, quote: text(k.quote) }] : [];
    }),
  };
}

interface Passage {
  documentId: string;
  page: number | null;
  body: string;
  /** Read by OCR from a picture in the document. */
  image?: boolean;
}

/** The review pass's reply, read defensively. */
export function readObservations(json: unknown): { text: string; quotes: string[] }[] {
  const o = (json ?? {}) as { observations?: unknown };
  return (Array.isArray(o.observations) ? o.observations : []).flatMap((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const t = text(r.text);
    const quotes = list(r.quotes);
    return t && quotes.length ? [{ text: t, quotes }] : [];
  }).slice(0, 8);
}

export async function evaluateQuote(
  documentId: string,
  rfq: { title: string; scope: readonly string[]; requirements: readonly string[] },
  signal?: AbortSignal,
  /**
   * The rest of the submission – a technical proposal, an organogram, a schedule of rates. Read
   * with the priced document and after it, because the price is read from that one and a figure
   * found in a supporting document is not the offer.
   */
  supporting: readonly string[] = [],
): Promise<{ extraction: QuoteExtraction; result: CheckedResponse; usage: Usage; partial: boolean }> {
  const ids = [documentId, ...supporting.filter((id) => id !== documentId)];
  const files = await db
    .select({ id: documents.id, name: documents.filename, location: documents.storageLocation })
    .from(documents)
    .where(inArray(documents.id, ids));
  const nameOfDocument = new Map(files.map((f) => [f.id, f.name]));
  const doc = files.find((f) => f.id === documentId);
  const all = (
    await db
      .select({ documentId: passages.documentId, page: passages.page, body: passages.body })
      .from(passages)
      .where(inArray(passages.documentId, ids))
      .orderBy(asc(passages.seq))
  ).sort((a, b) => ids.indexOf(a.documentId) - ids.indexOf(b.documentId));
  if (all.length === 0) throw new Error(`${doc?.name ?? "The quotation"} has no text to read yet – a large file takes a moment after filing, and a scan with no text cannot be read.`);

  const sent: Passage[] = [];
  let used = 0;
  for (const p of all) {
    if (used + p.body.length > MAX_CHARS) break;
    sent.push(p);
    used += p.body.length;
  }

  /*
    The pictures, read. A fee table pasted as a screenshot is part of the proposal; without this it
    was "not checked" and a person had to read it. What does not read cleanly is named to the model
    as unread, so it reports it rather than guessing at it.
  */
  let unreadImages: (ImageReading["unread"][number] & { document?: string })[] = [];
  let readImages: string[] = [];
  for (const file of files.filter((f) => f.location && /\.pdf$/i.test(f.name))) {
    try {
      const images = await imageText(await read(file.location!), { signal });
      const where = file.id === documentId ? "" : ` of ${file.name}`;
      unreadImages = [...unreadImages, ...images.unread.map((u) => ({ ...u, document: file.id === documentId ? undefined : file.name }))];
      readImages = [...readImages, ...images.read.map((im) => `page ${im.page}${where}`)];
      for (const im of images.read) {
        const body = `IMAGE on page ${im.page}${where}, read by OCR (confidence ${im.confidence}%) – misreads possible:\n${im.text}`;
        if (used + body.length > MAX_CHARS + 20_000) break;
        sent.push({ documentId: file.id, page: im.page, body, image: true });
        used += body.length;
      }
    } catch {
      // OCR is an addition: a proposal whose images cannot be read is still read for its text.
    }
  }

  const user = [
    `RFQ: ${rfq.title}`,
    `SCOPE ITEMS every response must cover:\n${rfq.scope.map((s, i) => `${i + 1}. ${s}`).join("\n") || "(none listed)"}`,
    `REQUIREMENTS every response must show:\n${rfq.requirements.map((s, i) => `${i + 1}. ${s}`).join("\n") || "(none listed)"}`,
    `FACTS to read from the response:\n${DEFAULT_FACTS.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
    `THE RESPONSE – ${doc?.name ?? "quotation"}:`,
    sent
      .map((p, i) => {
        const from = p.documentId === documentId ? "" : ` of ${nameOfDocument.get(p.documentId) ?? "a supporting document"}`;
        return fence(`[${i + 1}]${p.page ? ` page ${p.page}` : ""}${from}`, p.body);
      })
      .join("\n\n"),
    supporting.length
      ? `This response is ${ids.length} documents: the priced one, ${doc?.name ?? "the quotation"}, and ${files.filter((f) => f.id !== documentId).map((f) => f.name).join("; ")}. The passages say which they come from. The PRICE is what the priced document offers – a figure in a supporting document is evidence, never the offer – but scope, requirements and facts may be shown by any of them.`
      : "",
    readImages.length ? `Images READ by OCR (their text is in the passages above – never list them as unseen): ${readImages.join(", ")}.` : "",
    unreadImages.length ? `Images that could NOT be read (a drawing, a photograph or a faint scan): ${unreadImages.map((u) => `page ${u.page}${u.document ? ` of ${u.document}` : ""}`).join(", ")}.` : "",
    "Describe this response. Reply in json.",
  ].join("\n\n");

  // The two readings are independent, so they run side by side.
  const [described, reviewed] = await Promise.all([
    askForJson({ purpose: "quote.evaluate", system: SYSTEM, user, maxTokens: 8_000, timeoutMs: 240_000, signal }),
    askForJson({ purpose: "quote.evaluate", system: REVIEW, user: `${fence(`THE PROPOSAL – ${doc?.name ?? "quotation"}`, sent.map((p) => p.body).join("\n\n"))}\n\nReview it. Reply in json.`, maxTokens: 2_000, timeoutMs: 240_000, signal }).catch(() => null),
  ]);
  // Summed with `addUsage` so a run on the stronger model is priced at its own rates.
  const usage: Usage = reviewed ? addUsage(described.usage, reviewed.usage) : described.usage;
  const read_ = readExtraction(described.json, rfq.scope, rfq.requirements);
  // A risk or an observation is the model's sentence, so it may carry only figures the document prints (the figure rule).
  const printed = numbersIn(sent);
  const extraction: QuoteExtraction = {
    ...read_,
    risks: (read_.risks ?? []).filter((k) => figuresAllowed(k.text, printed)),
    /*
      Which images went unread is the platform's to say – it ran the OCR. The reading still names
      what is missing altogether (an annexure not attached); its word on images is replaced, because
      it would list a fee table as unseen with the table's text in front of it.
    */
    unseen: [
      ...(read_.unseen ?? []).filter((u) => !/\b(image|picture|screenshot|figure \d)/i.test(u)),
      ...unreadImages.map((u) => `the image on page ${u.page}${u.document ? ` of ${u.document}` : ""} (a drawing, table or photograph – OCR confidence ${u.confidence}%)`),
    ],
    observations: readObservations(reviewed?.json).filter((o) => figuresAllowed(o.text, printed) && o.quotes.every((q) => locateQuote(q, sent))),
  };
  const result = checkResponse(
    extraction,
    (quote, figure) => {
      const at = (p: Passage) => ({ page: p.page, image: p.image === true });
      const found = locateQuote(quote, sent);
      if (found) return at(found.passage);
      const near = nearFigure(quote, figure, sent);
      if (near) return at(near);
      // A table cell quoted as its bare figure: found where that exact figure is printed.
      if (!distinctFigure(figure)) return null;
      const f = figure.replace(/\s+/g, "");
      const hit = sent.find((p) => {
        /*
          Only the spaces inside a figure are closed up – after the "R", and before a group of three
          digits – so the gaps between a row's cells, and between one row and the next ("…178,39
          3. Design…"), stay as the figure's edges.
        */
        const body = p.body.replace(/\s+/g, " ").replace(/(?<=R) (?=\d)/g, "").replace(/(?<=\d) (?=\d{3}(?!\d))/g, "");
        for (let at = body.indexOf(f); at >= 0; at = body.indexOf(f, at + 1)) {
          const left = /^\d/.test(f) ? !/\d/.test(body[at - 1] ?? "") : true;
          if (left && !/\d/.test(body[at + f.length] ?? "")) return true;
        }
        return false;
      });
      return hit ? at(hit) : null;
    },
    (doc?.name ?? "Unnamed respondent").replace(/\.[a-z0-9]+$/i, ""),
  );
  return { extraction, result, usage, partial: sent.length < all.length };
}
