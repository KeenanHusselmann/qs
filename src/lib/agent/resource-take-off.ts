/**
 * "How many bricks do I need?" — the advisor's take-off channel (§4.8, §1.3.1).
 *
 * ── The one place the advisor is allowed to produce a figure ───────────────────────────────
 *
 * Everywhere else the rule is absolute: the model never writes a number, and `HAS_FIGURE` drops
 * any sentence that does. That rule exists because a figure a model remembered traces to nothing.
 *
 * This does not break it. **Nothing here is remembered.** The chain is:
 *
 *   1. The model names what the work is and how much of it there is — reading the reader's own
 *      question, not its memory. "One-brick wall in stock brick", "m2", "240".
 *   2. `proposeMethod` asks what ONE unit is made of, taking back quantities only. It is the same
 *      call the pricing screen makes, so the factor behind a chat answer and the factor behind a
 *      rate build-up cannot differ. This answers *which resources are involved*.
 *   3. **The practice's own factors override it, resource by resource** (`factorsFor`). That
 *      answers *how much of each*, which is a different question with a different owner — and one
 *      the firm should win, because its answer does not change between two identical asks.
 *   4. `takeOff` does the arithmetic in TypeScript, tested against hand-worked examples.
 *   5. `priceResources` prices it from the practice's own rate library — rows somebody curated,
 *      each carrying its source and its effective date.
 *
 * So the practice supplies the factors and the money, the model fills what the practice has not
 * written down yet, and the platform does the sums. Every figure states its own working in `from`,
 * which is what earns a tool result the right to show figures at all.
 *
 * ── Step 2 exists because step 3 is not stable for everything ──────────────────────────────
 *
 * A measurement factor was taken to be a stable fact, and for materials it is: 104 bricks in a
 * square metre of one-brick walling is fixed by geometry. **For labour and plant it is not.** Asked
 * the same question twice on the same day, the model returned 0,10 and then 0,15 hours of concrete
 * mixer per m² — a fifty per cent spread in a figure somebody might price from.
 *
 * Hours per square metre is a productivity *assumption*, and it belongs to the practice: it depends
 * on the gang, the site and the access. So a firm writes its own down (`resource_factors`), and
 * until it has, every proposed line says in words that it is proposed and should be checked.
 *
 * ── Why it returns a ToolResult ────────────────────────────────────────────────────────────
 *
 * Because it is one: a computation the advisor went and did, whose figures are exact and each of
 * which names its method. Reusing the shape means the panel, `readAnswer` and the figure guard all
 * treat it exactly as they treat the six gates — and a second rendering path for numbers that must
 * never be confused with the model's own words is precisely what should not exist.
 */

import {
  PERCENT_SCALE,
  percentFromRate,
  displayUnit,
  formatQuantity,
  formatRand,
  formatUnitRate,
  parseQuantity,
  rate as makeRate,
  type Percent,
} from "@/domain/money";
import { takeOff, type Factor } from "@/domain/take-off";
import { proposeMethod, type Method } from "@/lib/agent/build-up-method";
import type { ToolResult } from "@/lib/agent/tools";
import type { Usage } from "@/lib/agent/deepseek";
import { readQuantity } from "@/domain/amount";
import { quantityToNumeric } from "@/domain/money";
import { priceResources } from "@/lib/rate-match";
import type { LibraryRate } from "@/lib/rates";
import { asFactor, factorsFor, resourceKey, type ResourceFactor } from "@/lib/factors";
import { PUBLISHED_FACTORS } from "@/lib/published-factors";

/** What the model asked to have taken off, once it has been checked. */
export interface TakeOffRequest {
  /** The work, in the words a rate library would file it under. "One-brick wall in stock brick". */
  work: string;
  /** The unit that work is measured in — "m2", "m3", "m". */
  unit: string;
  /** How much of it. Held as text all the way to `parseQuantity`; never through a `number`. */
  quantity: string;
}

/**
 * A quantity the platform will scale by.
 *
 * Deliberately strict. A take-off is arithmetic presented as fact, so a request the model half
 * filled in must produce nothing rather than a plausible answer over a quantity nobody stated —
 * §1.3, and here it is the difference between "I could not work that out" and a confident order
 * for the wrong number of bricks.
 *
 * Negative is refused as well as unparseable: there is no such thing as minus 12 m² of wall, and a
 * take-off over one would return negative orders that read like a credit.
 */
const QUANTITY = /^\d{1,12}(?:[.,]\d{1,4})?$/;

export function readTakeOffRequest(raw: unknown): TakeOffRequest | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;

  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const work = text(o.work);
  const unit = text(o.unit);
  const quantity = text(o.quantity).replace(/\s/gu, "").replace(",", ".");

  if (work.length === 0 || unit.length === 0) return null;
  if (!QUANTITY.test(quantity)) return null;

  return { work, unit: unit.slice(0, 20), quantity };
}

/**
 * The same request, read from the question itself rather than from the model.
 *
 * Round-2 testing, N10: the suggested brick question came back as general guidance – the model
 * answered it as prose instead of asking for the take-off, and the reader saw no quantities, no
 * rate, no source. The shape of the question is fixed enough to read without a model: "how many
 * <resource> … for|in|on <quantity> <unit> of <work>". Where it reads, the platform takes off the
 * work whether or not the model asked; where it does not, nothing is invented.
 */
const TAKE_OFF_QUESTION =
  /\bhow\s+(?:many|much)\b[^?]*?\b(?:for|in|on|to)\s+(\d[\d\s\u00a0.,]*?)\s*(m²|m2|sqm|m³|m3|m|lm|no|nr)(?![a-z0-9])\.?\s*(?:of\s+)?([^?]+?)[?.!\s]*$/iu;

export function readTakeOffQuestion(question: string): TakeOffRequest | null {
  const match = TAKE_OFF_QUESTION.exec(question.trim());
  if (!match) return null;

  const [, figure, rawUnit, rawWork] = match;
  const unit = ({ "m²": "m2", sqm: "m2", "m³": "m3", lm: "m", nr: "no" } as Record<string, string>)[
    (rawUnit ?? "").toLowerCase()
  ] ?? (rawUnit ?? "").toLowerCase();
  const work = (rawWork ?? "").replace(/\s+/g, " ").trim();

  // The same reader the bill uses, with the unit: "1 250 m²" and "1,250 m²" are both twelve hundred
  // and fifty, and "12,5 m3" is a decimal. Nothing here is a second opinion on a separator.
  const quantity = readQuantity(figure ?? "", { unit });
  if (!quantity.ok) return null;

  return readTakeOffRequest({
    work: work.charAt(0).toUpperCase() + work.slice(1),
    unit,
    quantity: quantityToNumeric(quantity.quantity).replace(/\.?0+$/, ""),
  });
}

/**
 * The allowance actually applied, as a reader would write it.
 *
 * A held factor carries its own, and it is stored as a decimal fraction scaled by `PERCENT_SCALE`
 * — so it is divided back out rather than printed raw, which would have shown a five per cent
 * allowance as "500%". The method's whole number is used only where the factor states none.
 */
const wasteShown = (own: Percent | undefined, fallback: number): string => {
  if (own === undefined) return `${fallback}%`;
  const whole = Number(own) / 10 ** PERCENT_SCALE * 100;
  return `${Number(whole.toFixed(2)).toString().replace(".", ",")}%`;
};

/**
 * Where a factor came from, in descending order of what a reader should trust.
 *
 * `practice` is a row the firm filed and will stand behind. `published` is the platform's own,
 * derivable from a stated geometry and attributed on the line. Anything with neither was proposed
 * by the model for this question and says so.
 */
export type FactorOrigin = "practice" | "published";

export interface SourcedFactor {
  row: ResourceFactor;
  origin: FactorOrigin;
}

/*
  Resource *and* unit: "Cement" in kilograms and in pockets are two ways of stating one input, and
  a practice may hold both. `resourceKey` folds case, punctuation and a trailing plural, which is
  what stops "Stock bricks" and "Stock brick" being taken for two materials and the wall being
  given its bricks twice.
*/
const keyOf = resourceKey;

/** Nothing to compute from, said with what would fix it — the same shape `tools.ts` refuses in. */
const cannot = (why: string): ToolResult => ({
  tool: "take_off",
  title: "Resource take-off",
  findings: [],
  unavailable: why,
});

export interface TakeOffOutcome {
  result: ToolResult;
  /** What the method call cost. Charged whether or not the library could price the result. */
  usage: Usage;
}

/**
 * Take off the resources for a measured quantity of work.
 *
 * `library` is passed in rather than read here so this module stays free of the database, the way
 * `takeOff` itself stays free of both. The caller already holds the rates for the project's region.
 */
export async function resourceTakeOff(
  request: TakeOffRequest,
  library: readonly LibraryRate[],
  options: { region?: string | null; asAt?: string } = {},
  signal?: AbortSignal,
  /*
    The practice's own factors.

    Consulted **first**, and where they cover the work the model is never called at all — which is
    faster, free, and above all *repeatable*: the same question asked twice gives the same answer,
    which is the property a proposed method does not have and the reason this table exists.
  */
  held: readonly ResourceFactor[] = [],
): Promise<TakeOffOutcome> {
  /*
    The practice's factors for this work, which **override** the method resource by resource — they
    do not replace it.

    This was replacement first, and that was wrong in a way worth recording. A firm that had written
    down only its labour and plant factors — the ones worth writing down, since those are the
    unstable ones — got a take-off consisting of a bricklayer and a mixer and *no bricks*. The
    answer looked complete. The materials had been dropped because nobody had recorded them, which
    is precisely backwards: not recording a material factor is the normal case, because geometry
    fixes it and the model gets it right.

    Two questions, and they have different owners. **Which resources does this work involve** is the
    method, and the model is good at it. **How much of each** is the factor, and for labour and
    plant it belongs to the practice. So the method is always asked for, and the practice's answer
    wins wherever it has one.
  */
  /*
    Three origins, in order of authority: the practice's, then the platform's published constants,
    then whatever the model proposes. A resource the practice has filed is never overridden by a
    published one, and a published one is never overridden by a proposal.
  */
  const practice = factorsFor(request.work, request.unit, held, options);
  const claimed = new Set(practice.map((f) => keyOf(f.resource, f.resourceUnit)));

  const own: SourcedFactor[] = [
    ...practice.map((row) => ({ row, origin: "practice" as const })),
    ...factorsFor(request.work, request.unit, PUBLISHED_FACTORS, options)
      .filter((row) => !claimed.has(keyOf(row.resource, row.resourceUnit)))
      .map((row) => ({ row, origin: "published" as const })),
  ];

  let method;
  try {
    method = await proposeMethod(request.work, request.unit, signal);
  } catch (error) {
    // §1.3 — an outage is a result that says so, never an empty answer dressed as one.
    return {
      result: cannot(
        `The method behind ${request.work} could not be worked out: ${
          error instanceof Error ? error.message : "the model could not be reached"
        }.`,
      ),
      usage: { input: 0, output: 0 },
    };
  }

  if (method.components.length === 0) {
    return {
      result: cannot(
        method.note ??
          `Nothing in "${request.work}" could be broken into resources. Describe it the way a bill item would — the material and the thickness, not just the element.`,
      ),
      usage: method.usage,
    };
  }

  return { result: takeOffFrom(method, request, library, options, own), usage: method.usage };
}

/**
 * Scale a method, price it, and write out the working — everything after the model call.
 *
 * Split from `resourceTakeOff` so it can be held to a table of known factors and known rates. The
 * model call is the one part that cannot be, so it is the only part left outside.
 */
export function takeOffFrom(
  method: Pick<Method, "components" | "wastePercent">,
  request: TakeOffRequest,
  library: readonly LibraryRate[],
  options: { region?: string | null; asAt?: string } = {},
  /*
    The practice's own factors for this work, matched to the method's components by resource.

    A held factor **overrides** the component of the same resource and unit; one the method never
    proposed is added, because a practice that has written a resource down knows about it and the
    model forgetting it is not a reason to leave it out. Every line then says which of the two it
    came from — a held factor and a proposed one are different kinds of claim, one the practice
    will stand behind and one a starting point somebody should check, and presenting them
    identically is exactly the confident-looking uncertainty §1.3 forbids.
  */
  held: readonly SourcedFactor[] = [],
): ToolResult {
  const heldBy = new Map(held.map((f) => [keyOf(f.row.resource, f.row.resourceUnit), f]));
  const used = new Set<string>();

  /*
    The components actually taken off: the method's, plus anything held that it did not propose.

    Built as a list of pairs so the held row travels beside the component it replaced rather than
    being looked up again later by a key that might not round-trip.
  */
  const lines: { component: Method["components"][number]; own: SourcedFactor | null }[] = [];

  for (const component of method.components) {
    const key = keyOf(component.description, component.unit);
    const own = heldBy.get(key) ?? null;
    if (own) used.add(key);
    lines.push({ component, own });
  }

  for (const [key, found] of heldBy) {
    if (used.has(key)) continue;
    lines.push({
      component: {
        kind: found.row.kind,
        description: found.row.resource,
        unit: found.row.resourceUnit,
        quantity: found.row.quantity,
      },
      own: found,
    });
  }

  /*
    Priced by the same function the pricing screen uses, so a resource the build-up can price and
    one this can price are the same set. A second matcher would drift, and the first anyone would
    know of it is a chat answer disagreeing with the rate on the row.
  */
  const priced = priceResources(lines.map((l) => l.component), library, options);

  const factors: Factor[] = lines.map(({ component, own }) =>
    // A held row carries its own waste allowance; a proposed component has only the method's.
    own ? asFactor(own.row) : {
      kind: component.kind,
      description: component.description,
      unit: component.unit,
      perUnit: parseQuantity(component.quantity),
    },
  );

  /*
    Keyed by the factor object rather than by description.

    A method can legitimately name the same material twice at different specifications, and a
    lookup by description would price both from whichever row matched first. `priceResources`
    returns one entry per component in order, so position is the identity — captured here once
    instead of being searched for inside the resolver.
  */
  const libraryRateOf = new Map(factors.map((factor, i) => [factor, priced[i]?.rate ?? null]));

  const scaled = takeOff(
    factors,
    parseQuantity(request.quantity),
    request.unit,
    percentFromRate(method.wastePercent),
    (factor) => {
      const found = libraryRateOf.get(factor);
      return found ? makeRate(found.rate, found.ratePrecision) : null;
    },
  );

  const findings = scaled.resources.map((resource, i) => {
    const libraryRate = libraryRateOf.get(resource.factor) ?? null;

    /*
      The working, written out.

      `from` is what makes a figure on this panel legitimate: a reader can check "104 per m² × 240"
      on a calculator and can look the rate up in the library by its source and date. A resource
      line without it would be exactly the remembered number this whole design refuses.
    */
    const source = lines[i]?.own ?? null;

    const working = [
      // `104/m² × 240 m²` — a factor says what it is per, and a unit is written as a reader writes it.
      `${formatQuantity(resource.factor.perUnit, 0)}/${displayUnit(request.unit)} × ${formatQuantity(scaled.work, 0)} ${displayUnit(request.unit)}`,
      /*
        Where the factor came from, said on every line.

        A practice's own factor is a figure it will stand behind. A proposed one is a starting
        point — stable for materials, where geometry fixes it, and a productivity *assumption* for
        labour and plant, which is the case the reader most needs to know to check. Marking only
        one of the two would leave the other reading as authoritative by default.
      */
      source === null
        ? "proposed, not the practice's own — check it"
        : source.origin === "practice"
          ? `the practice's factor · ${source.row.source} · from ${source.row.effectiveDate}`
          : `published · ${source.row.source} · file your own to override it`,
      resource.gross === resource.net
        ? null
        : `+${wasteShown(resource.factor.waste, method.wastePercent)} waste`,
      /*
        The rate and what it comes to, both with their R: `R 95,00/hour = R 36 480,00`. It printed the
        total alone as "at R 36 480,00", which read as though that were the rate.
      */
      libraryRate
        ? `${formatUnitRate(makeRate(libraryRate.rate, libraryRate.ratePrecision), libraryRate.unit)} = ${formatRand(resource.cost!)} · ${libraryRate.source}${libraryRate.region ? ` · ${libraryRate.region}` : ""} · from ${libraryRate.effectiveDate}`
        : "no rate in the library prices this",
    ]
      .filter(Boolean)
      .join(" · ");

    return {
      label: resource.factor.description,
      // The order figure leads where there is one: it is the number somebody acts on.
      value:
        resource.order === null
          ? `${formatQuantity(resource.gross, 2)} ${displayUnit(resource.factor.unit)}`
          : `${resource.order.toLocaleString("en-ZA").replace(/,/g, " ")} ${displayUnit(resource.factor.unit)}`,
      from: working,
    };
  });

  /*
    The total is a finding rather than a separate field, so it travels through the same guard and
    renders in the same list. It says out loud when it is partial — §1.3, an incomplete total that
    looks finished is worse than none.
  */
  if (scaled.unpriced < scaled.resources.length) {
    findings.push({
      label: scaled.unpriced === 0 ? "Estimated cost" : "Estimated cost, partial",
      value: formatRand(scaled.cost),
      from:
        scaled.unpriced === 0
          ? `Every resource priced from the firm's rate library${options.region ? `, ${options.region}` : ""}`
          : `${scaled.unpriced} of ${scaled.resources.length} resources have no rate in the library and contribute nothing to this total`,
    });
  }

  return {
    tool: "take_off",
    title: `${request.work} — ${formatQuantity(scaled.work, 2)} ${displayUnit(request.unit)}`,
    findings,
    unavailable: null,
  };
}
