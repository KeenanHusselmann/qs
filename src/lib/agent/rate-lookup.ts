/**
 * "What do bricks cost?" – the advisor's rate lookup, answered from the firm's Rate Library.
 *
 * ── Why this exists ────────────────────────────────────────────────────────────────────────
 *
 * The advisor had a take-off channel ("how many bricks for 240 m²") and nothing for the plainer
 * question a QS asks first: what does it cost. That question fell through to general guidance –
 * "a brick rate depends on type, region and quantity" – while the answer sat in the firm's own
 * library. Reported by a tester asking "bricks cost zar" on the overview.
 *
 * ── Read, not asked ────────────────────────────────────────────────────────────────────────
 *
 * The question is read by its shape, as `readTakeOffQuestion` reads a take-off: a price word
 * (cost, price, rate, how much) and a subject. The subject's words are matched against the
 * library's descriptions and trades; every rate shown is a row somebody curated, with its source,
 * region and effective date, and the model is told not to restate them. Where nothing matches, the
 * lookup says so and names where to add one – it never falls back to a remembered price.
 */

import { formatUnitRate, rate as makeRate } from "@/domain/money";
import { readTakeOffQuestion } from "@/lib/agent/resource-take-off";
import type { ToolResult } from "@/lib/agent/tools";
import { ratesInForce, type LibraryRate } from "@/lib/rates";

const PRICE = /\b(cost|costs|price|prices|priced|pricing|rate|rates|how\s+much\s+(?:is|are|does|do)|what\s+does\s+.+\s+cost|per\s+(?:m²|m2|m3|m³|no|1\s?000|thousand|bag|kg|ton|tonne))\b/i;

const STOP = new Set([
  "what", "whats", "what's", "is", "are", "the", "a", "an", "of", "for", "in", "to", "do", "does", "how", "much", "cost", "costs", "price", "prices",
  "priced", "pricing", "rate", "rates", "current", "currently", "typical", "average", "standard", "zar", "rand", "rands", "r", "per", "sa", "south",
  "africa", "african", "today", "now", "please", "me", "give", "show", "tell", "about", "and", "or", "our", "my", "firm", "library", "each", "unit",
  "m2", "m²", "m3", "m³", "no", "kg", "bag", "bags", "1000", "thousand", "various", "different", "types", "type", "kinds", "kind", "all", "list",
]);

/** A word's library form: lower case, a plain plural taken off. "Bricks" is "brick"; "glass" stays. */
const stem = (word: string) => {
  const w = word.toLowerCase();
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
};

/** The subject of a price question, as words to match – or null where it is not one. */
export function readRateQuestion(question: string): string[] | null {
  const q = question.trim();
  if (!PRICE.test(q)) return null;
  // "How many bricks for 240 m²" is a take-off, and has its own channel.
  if (readTakeOffQuestion(q)) return null;
  const terms = [...new Set(q.split(/[^A-Za-z0-9²³-]+/).filter((w) => w.length > 1 && !STOP.has(w.toLowerCase())).map(stem))];
  return terms.length > 0 ? terms.slice(0, 6) : null;
}

/**
 * The library's rates for a subject, best matches first: a row matching more of the words ranks
 * higher, then the national rate before a regional one, then by description. The project's
 * province, where there is one, keeps its own and the national rates and drops other provinces'.
 */
export function rateLookup(
  terms: readonly string[],
  library: readonly LibraryRate[],
  options: { region?: string | null; limit?: number } = {},
): ToolResult {
  const inForce = ratesInForce(library).filter((r) => !options.region || r.region === null || r.region === options.region);
  const scored = inForce
    .map((row) => {
      const words = new Set(`${row.description} ${row.trade ?? ""}`.split(/[^A-Za-z0-9²³-]+/).map(stem));
      // Whole words only: a prefix match put "Bricklayer" in the answer to what bricks cost.
      const hits = terms.filter((t) => words.has(t));
      // A row that is *named* for the subject outranks one that only mentions it. Named means the
      // subject is the head noun – the last word of the name before its first comma or preposition:
      // "Cement, 42,5N" and "Clay stock brick" are a cement and a brick; "Cement plaster to walling"
      // is a plaster and "Brick pier" is a pier, whatever word they start with.
      const name = row.description.split(",")[0]!.split(/\s+(?:in|to|for|with|of|on)\s+/i)[0]!;
      const head = name.split(/[^A-Za-z0-9²³-]+/).filter(Boolean).pop() ?? "";
      const leads = stem(head) === terms[0] ? 1 : 0;
      return { row, hits: hits.length * 2 + (hits.length > 0 ? leads : 0) };
    })
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits || Number(a.row.region !== null) - Number(b.row.region !== null) || a.row.description.localeCompare(b.row.description));

  const best = scored.length > 0 ? scored[0]!.hits : 0;
  const rows = scored.filter((s) => s.hits === best).slice(0, options.limit ?? 12).map((s) => s.row);
  const subject = terms.join(" ");

  if (rows.length === 0) {
    return {
      tool: "rate_lookup",
      title: `Rates for “${subject}”`,
      findings: [],
      unavailable: `The firm's Rate Library has no rate matching “${subject}”. Add one under Rate Library – with its source and date – and it will be quoted here and priced into bills.`,
    };
  }

  return {
    tool: "rate_lookup",
    title: `Rates for “${subject}” in the firm's Rate Library`,
    findings: rows.map((r) => ({
      label: r.description,
      value: formatUnitRate(makeRate(r.rate, r.ratePrecision), r.unit),
      from: [r.source, r.region ?? "national", `from ${r.effectiveDate}`].join(" · "),
    })),
    unavailable: null,
  };
}
