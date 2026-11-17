/**
 * Reading bill items out of the corpus — PLATFORM.md §1.3.2, §1.3.3, §5.
 *
 * ── The same three steps as `extract.ts`, over a different shape ───────────────────────────
 *
 * Retrieve, then ask, then **check**. The model is shown a handful of this project's passages and
 * nothing else, and is asked for the items of work they describe. What comes back is not believed:
 * every row's quote is located in the passages that were sent (`grounding.ts`), and the citation is
 * built from the passage it was found in rather than from anything the model said. A row that
 * cannot be grounded is discarded and counted, never shown.
 *
 * ── And then a fourth step this one needs and the field extractor does not ─────────────────
 *
 * A field's value is stored as text, exactly as the document wrote it — `R186 420 000,00` — because
 * §5.2's round-once rule is about `quantity × rate` at a bill item and nothing multiplied it. Here
 * something multiplies it. So the quantity and the rate have to become numbers, and that is done by
 * `readQuantity` and `readRate`, which **refuse rather than guess**: `1,234` is a thousand-fold
 * ambiguity nothing in the text settles, and a misread separator is silent, survives review and
 * lands in a total nobody can reproduce.
 *
 * A refused figure leaves the cell empty, keeps the document's own words beside it, and says why.
 * The QS reads the source and types the number. That is one figure a person has to settle, on a
 * screen that names it — which is the whole of §5's position, and much better than a confident
 * wrong number in a column of four thousand.
 */

import { isDocumentFurniture } from "@/domain/measurable";
import { isSpatial } from "@/lib/ingest/document-class";
import { locateQuote } from "@/lib/agent/grounding";
import { askForJson, type Usage } from "@/lib/agent/deepseek";
import { fence } from "@/lib/egress/fence";
import type { SourcePassage } from "@/lib/agent/extract";
import type { ItemResult, ItemSpec } from "@/lib/agent/bill";
import { decimalMarkOf, readQuantity, readRate } from "@/domain/amount";
import { quantityToNumeric } from "@/domain/money";

/** Below this a row is flagged for review. Not a probability — see `extract.ts`. */
const CONFIDENT = 0.75;

/**
 * Rows per call. Two passages hold at most a couple of dozen bill lines; a cap above that is what
 * stops the model summarising a long page, and a truncated JSON array loses every row in the batch.
 */
const MAX_ITEMS = 24;

/*
  Written against what the audit of the Ridgeview bill found, rule by rule:
  - six of twenty-two specification clauses were never proposed (rule 3);
  - external-works items came back with no unit, so nothing could price them (rule 7);
  - a bill has totals, collections and a summary on it, each a description beside an amount, and
    proposing one as an item double-counts its whole section (rule 5);
  - a passage is a slice of a document and can begin or end part-way through an item (rule 4).
*/
const SYSTEM = `You are a quantity surveyor's assistant drafting a bill of quantities from a project's own documents.

You are given numbered passages from ONE project and asked for the items of measurable construction work they describe. Rules, in order of importance:

1. Answer only from the passages given. You have no other knowledge of this project.
2. Quote VERBATIM. Each item's "quote" must be copied character for character from one passage – the item's description as the passage prints it, and its figures if they follow. Do not tidy it, do not paraphrase. An item whose quote is not in the passages is discarded.
3. List EVERY item in the passages, in the order they appear – every trade, every engineering service, every preliminaries item, provisional sum and prime cost sum. Never summarise, never stop early, never merge two items into one.
4. A passage can start or end part-way through an item. Skip an item whose description or figures are cut off at the very start or end of a passage; the neighbouring passage carries it whole.
5. NOT items: section totals, "carried to summary", "carried forward", "brought forward", collections, the summary of sections, the bill total, VAT, headings and column headings. Never return these.
6. NEVER invent a quantity or a rate. If a passage describes work with no quantity, "quantity" is null; with no rate, "rate" is null. An item nobody has measured is not an item measured at zero.
7. Copy figures exactly as the document writes them — "R 1 850,00", "9 414", "R 21,50". Do not convert them, do not change the separators, do not round. Where a line gives a rate and an amount, "rate" is the rate, never the amount.
8. A lump sum (preliminaries, a provisional sum, a prime cost sum) is one item: "unit": "sum", "quantity": "1", "rate": the sum as printed.
9. "unit" is ALWAYS given. Use the unit the document prints (m, m², m³, kg, t, no, sum). If it prints none, give the unit this work is conventionally measured in under the Standard System of Measuring Building Work – excavation, concrete and fill m³; walls, slabs, roofing, finishes, ceilings, paving and landscaping m²; gutters, pipes, kerbs and fencing m; reinforcement kg; counted fittings no – and set "confidence" no higher than 0.6.
10. "section" is the trade or element the passage puts the item under, in the document's own words, or null.
11. A passage that describes no measurable work returns no items. An empty list is a correct answer.

Reply with json in exactly this shape:
{"items": [{"section": string|null, "description": string, "unit": string, "quantity": string|null, "rate": string|null, "quote": string, "confidence": 0.0-1.0}]}`;

const MAX_PASSAGE_CHARS = 1_400;

function prompt(spec: ItemSpec, passages: readonly SourcePassage[]): string {
  const numbered = passages
    .map((p, i) => fence(`passage [${i + 1}]`, p.body.slice(0, MAX_PASSAGE_CHARS)))
    .join("\n\n");

  return `Each item wanted is ${spec.wants}.
Return at most ${MAX_ITEMS} items from these passages.

Passages:

${numbered}`;
}

interface RawItem {
  section: string | null;
  description: string;
  unit: string | null;
  quantity: string | null;
  rate: string | null;
  quote: string;
  confidence: number;
}

const asText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/** What the model is contracted to return. Checked, never assumed. */
function readReply(json: unknown): RawItem[] | null {
  if (typeof json !== "object" || json === null) return null;

  const items = (json as { items?: unknown }).items;
  if (!Array.isArray(items)) return null;

  return items.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const row = entry as Record<string, unknown>;

    const description = asText(row.description);
    const quote = asText(row.quote);
    // A row with no description is not a bill item, and a row with no quote cannot be grounded.
    // Both are dropped here rather than counted as discarded: nothing was proposed.
    if (!description || !quote) return [];

    const confidence = Number(row.confidence);

    return [
      {
        section: asText(row.section),
        description,
        unit: asText(row.unit),
        quantity: asText(row.quantity),
        rate: asText(row.rate),
        quote,
        confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
      },
    ];
  });
}

export interface ItemExtraction {
  items: ItemResult[];
  /**
   * Rows the model offered whose quote is not in the filed documents.
   *
   * Counted and reported rather than silently dropped. §1.3.2 forbids asserting what cannot be
   * grounded; it does not follow that the reader should be unable to tell a careful agent from a
   * quiet one — "the documents describe no work" and "four rows were made up and caught" send a QS
   * to completely different places.
   */
  discarded: number;
  /**
   * Rows the model offered that are the document's furniture, not work - a cover page's heading,
   * an employer's name, the date the bill was drawn.
   *
   * Counted apart from `discarded` because they are a different fault with a different remedy.
   * An ungrounded row means the agent said something the documents do not; one of these means the
   * agent read the title block as a bill, and every word of it really is in the document.
   */
  furniture: number;
  usage: Usage;
}

/**
 * Draft the rows one batch of passages describes.
 *
 * Throws only for an outage (see `deepseek.ts`). Every other outcome — including the model inventing
 * a line item — is a result the reader gets to see.
 */
export async function extractItems(
  spec: ItemSpec,
  retrieved: readonly SourcePassage[],
  signal?: AbortSignal,
  marks?: ReadonlyMap<string, "," | "." | null>,
): Promise<ItemExtraction> {
  // A drawing is measured, not read (§1.3.2). Its text is a title block, and inviting a model to
  // draft bill items off a legend is exactly how a plausible wrong row gets in.
  const passages = retrieved.filter((p) => !isSpatial(p.documentKind));
  if (passages.length === 0) return { items: [], discarded: 0, furniture: 0, usage: { input: 0, output: 0 } };

  const { json, usage } = await askForJson({ purpose: "bill.extract",
    system: SYSTEM,
    user: prompt(spec, passages),
    // A dozen rows of description, unit, quantity, rate and a quote each. The field extractor's 600
    // would truncate the array mid-object, which JSON mode reports as an unparseable reply.
    maxTokens: 4_000,
    signal,
  });

  const reply = readReply(json);
  if (!reply) return { items: [], discarded: 0, furniture: 0, usage };

  const items: ItemResult[] = [];
  let discarded = 0;
  let furniture = 0;

  for (const raw of reply.slice(0, MAX_ITEMS)) {
    /*
      A cover page is not work.

      Checked before the quote is located, because these rows pass that check: the words really are
      in the document. What they are not is something a contractor can price.
    */
    if (isDocumentFurniture(raw.description)) {
      furniture += 1;
      continue;
    }

    /**
     * The check that earns the rest of it. The quote is located in the passages the model was given,
     * by string matching — code that has no opinion and cannot be persuaded — and the citation is
     * built from the passage it was found in, so it cannot point at the wrong document even if the
     * model says otherwise.
     */
    const grounded = locateQuote(raw.quote, passages);
    if (!grounded) {
      discarded += 1;
      continue;
    }

    const source = passages.find((p) => p.documentId === grounded.passage.documentId)!;

    /**
     * `12,940 m²` is settled by the document, not by guessing: its own unambiguous figures say which
     * mark is its decimal, and a unit measured to whole units cannot carry three places. The mark is
     * read over the whole document where the caller has it, over this batch otherwise.
     */
    const decimalMark = marks?.has(source.documentId)
      ? (marks.get(source.documentId) ?? null)
      : decimalMarkOf(passages.filter((p) => p.documentId === source.documentId).map((p) => p.body));
    const quantity = raw.quantity === null ? null : readQuantity(raw.quantity, { decimalMark, unit: raw.unit });
    const unitRate = raw.rate === null ? null : readRate(raw.rate, { decimalMark });

    /**
     * Why a figure is not in its cell, in the reader's words.
     *
     * "The document states no quantity" and "the document states one this cannot read with
     * certainty" are different facts and they lead to different actions — measure it, or read the
     * line and type what it says.
     */
    const notes = [
      quantity === null
        ? null
        : quantity.ok
          ? // A figure that was rounded to fit the column says so. Silence here would be the
            // "quietly" the refusal it replaced was written to prevent.
            quantity.rounded
          : `Quantity not read — ${quantity.reason}`,
      unitRate === null ? null : unitRate.ok ? null : `Rate not read — ${unitRate.reason}`,
      raw.confidence >= CONFIDENT
        ? null
        : "The passage was found but does not state this plainly. Check it before signing.",
    ].filter((note): note is string => note !== null);

    items.push({
      section: raw.section,
      description: raw.description,
      // The rate's own per-phrase is the fallback: "R1 850,00 per cubic metre" states the unit as
      // surely as a separate field would, and a row that has one should not arrive without it.
      unit: raw.unit ?? (unitRate?.ok ? (unitRate.per ?? null) : null),
      quantity: quantity?.ok ? quantityToNumeric(quantity.quantity) : null,
      quantityText: raw.quantity,
      rate: unitRate?.ok
        ? { value: unitRate.rate.value.toString(), precision: unitRate.rate.precision }
        : null,
      rateText: raw.rate,
      confidence: raw.confidence,
      note: notes.length > 0 ? notes.join(" · ") : null,
      citation: {
        documentId: source.documentId,
        document: source.documentName,
        page: source.page ?? undefined,
        // The document's own characters, from the passage the quote was found in.
        quote: grounded.quote,
      },
    });
  }

  return { items, discarded, furniture, usage };
}

/** Each document's decimal mark, read over every passage of it the run holds. */
export function decimalMarksOf(passages: readonly SourcePassage[]): Map<string, "," | "." | null> {
  const bodies = new Map<string, string[]>();
  for (const passage of passages) bodies.set(passage.documentId, [...(bodies.get(passage.documentId) ?? []), passage.body]);
  return new Map([...bodies].map(([id, texts]) => [id, decimalMarkOf(texts)]));
}

/**
 * The same row, twice — because neighbouring passages overlap, and both can describe the same work.
 *
 * ── Keyed on the section and the measure, not the description alone ───────────────────────
 *
 * It was the description alone, which is wrong for a bill: "Excavate in all materials…" under Block
 * A and again under Block B are two items with two quantities, and the second was dropped. A repeat
 * now has to be the same description in the same section with the same quantity and rate as written.
 * Whitespace and case are folded because a model tidies both between calls.
 *
 * One exception keeps overlap from double-counting: a reading with no quantity and no rate is dropped
 * when the same description in the same section has figures, because it is the same line read from
 * the passage that cut it off. The one with figures wins, wherever it came in the list.
 */
export function withoutDuplicates(items: readonly ItemResult[]): ItemResult[] {
  const fold = (text: string | null) => (text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const line = (item: ItemResult) => `${fold(item.section)}|${fold(item.description)}`;
  const measured = new Set(items.filter((i) => i.quantityText || i.rateText).map(line));
  const seen = new Set<string>();

  return items.filter((item) => {
    const bare = !item.quantityText && !item.rateText;
    if (bare && measured.has(line(item))) return false;

    const key = `${line(item)}|${fold(item.quantityText)}|${fold(item.rateText)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The rows of a new batch worth writing: not repeats of what earlier batches proposed, nor of each
 * other.
 *
 * By identity, not by position. `withoutDuplicates([...earlier, ...batch]).slice(earlier.length)`
 * was the old way, and it is wrong the moment an earlier row can drop out – an unmeasured reading
 * giving way to a measured one – because the slice then starts one row late and cuts a new row off.
 */
export function freshItems(earlier: readonly ItemResult[], batch: readonly ItemResult[]): ItemResult[] {
  const kept = new Set(withoutDuplicates([...earlier, ...batch]));
  return batch.filter((item) => kept.has(item));
}
