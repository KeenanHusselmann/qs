/**
 * Reading a money figure out of an answer a document gave — the boundary in front of `money.ts`.
 *
 * ── Why this is separate from `parseMoney` ─────────────────────────────────────────────────
 *
 * `parseMoney` takes a clean fixed-scale decimal and is deliberately strict: hand it
 * `"R186 420 000,00"` and it throws, which is correct for a bill cell somebody typed. But the
 * figures in this platform did not come from a cell. They came from a cost plan that says
 * *"R186 420 000,00 excluding VAT"*, a contract that says *"R42 000,00 per calendar day"*, and a
 * brief that says *"48 m2 and 62 m2"* — and every one of those has to be turned into a number, or
 * refused, before anything can be added up.
 *
 * ── It refuses. That is the whole design ───────────────────────────────────────────────────
 *
 * §5 is the one place in the product to be paranoid: "if a QS adds a column by hand and gets a
 * different answer, trust is gone permanently." The failure mode here is not an exception — it is a
 * misread thousands separator that is **silent**, survives review, and lands in a total nobody can
 * reproduce. So every rule below either reads a figure with certainty or hands back a refusal
 * saying what it could not decide, and the screen shows the refusal rather than a number.
 *
 * A refusal is not an error. It is one figure that a person has to read for themselves, on a page
 * that names it.
 */

import {
  MONEY_SCALE,
  QUANTITY_SCALE,
  money,
  parseMoney,
  percent,
  parseQuantity,
  parseRate,
  type Money,
  type Percent,
  type Quantity,
  type Rate,
} from "@/domain/money";

/** A figure read with certainty, or a reason nobody could read it with certainty. */
export type AmountReading =
  | { readonly ok: true; readonly amount: Money; readonly text: string }
  | { readonly ok: false; readonly reason: string; readonly text: string };

/** The same, for the two other kinds of figure a bill row carries. */
export type QuantityReading =
  | {
      readonly ok: true;
      readonly quantity: Quantity;
      readonly text: string;
      /**
       * Said where the source carried more decimal places than a quantity holds and the figure was
       * rounded to fit. Null where nothing was dropped, or where what was dropped was a
       * spreadsheet's own floating-point noise and the value is unchanged.
       */
      readonly rounded: string | null;
    }
  | { readonly ok: false; readonly reason: string; readonly text: string };

/** A percentage read with certainty — §4.8's waste, markup and bulk adjustment all arrive here. */
export type PercentReading =
  | { readonly ok: true; readonly percent: Percent; readonly text: string }
  | { readonly ok: false; readonly reason: string; readonly text: string };

export type RateReading =
  | {
      readonly ok: true;
      readonly rate: Rate;
      /** The unit the rate was stated per, where it said one — "cubic metre". */
      readonly per: string | null;
      readonly text: string;
    }
  | { readonly ok: false; readonly reason: string; readonly text: string };

/**
 * Currency marks stripped from the front. Only the front: a trailing "R" is not a currency symbol,
 * and something ending in a letter is a qualifier this refuses anyway.
 */
const CURRENCY = /^(?:zar|rand|r)\s*/i;

/**
 * Words that turn an amount into a **rate**, which must never be summed with amounts.
 *
 * `R42 000,00 per calendar day` is the penalty in a JBCC contract. Added into a total of elements it
 * contributes forty-two thousand rand of nothing — the number is real, and it is not a quantity of
 * money this project owes. Same for "per unit" and "per m²", which is how a cost plan states a rate
 * beside an amount.
 */
// `(?![a-z])` rather than `\b`: a word boundary after `m²` can never match, because `²` is not a
// word character and there is nothing after it to bound against. `R312,50/m²` read as an amount.
const PER_SOMETHING = /\bper\b|\/\s*(?:unit|m²|m2|sqm|day|month|week|annum|year)(?![a-z])/i;

/** A percentage is not an amount, however much it looks like one once the sign is dropped. */
const PERCENTAGE = /%|\bper\s*cent\b/i;

/** Everything that could be a number, so "how many are there" can be asked before reading one. */
const NUMERIC = /\d[\d\s., ]*\d|\d/g;

/**
 * Read a money figure from the text a document used.
 *
 * The order of the checks is the order in which a wrong answer would be most damaging: a rate summed
 * as an amount is worse than a refusal, an ambiguous separator is worse than a refusal, and a second
 * number in the string means nobody can say which one was meant.
 */
export function readAmount(text: string | null | undefined): AmountReading {
  const original = (text ?? "").trim();
  const refuse = (reason: string): AmountReading => ({ ok: false, reason, text: original });

  if (original === "") return refuse("There is no figure here.");

  if (PERCENTAGE.test(original)) {
    return refuse("This is a percentage, not an amount.");
  }

  if (PER_SOMETHING.test(original)) {
    return refuse("This is a rate — an amount per something — and cannot be added to amounts.");
  }

  /**
   * The sign comes off first, and both spellings of it count.
   *
   * §7.4's money cell writes a negative as `(1 234,56)` — accounting convention, and what a bill
   * shows for an omission. The brackets were being stripped further down as ordinary punctuation, so
   * the figure read back positive: an omission that silently changed sign would *increase* a total
   * it was meant to reduce. The formatter's own output is round-tripped in the tests for this
   * reason.
   */
  const bracketed = /^\((.*)\)$/.exec(original);
  const inner = (bracketed?.[1] ?? original).trim();
  const negative = bracketed !== null || inner.startsWith("-");
  const body = inner.replace(/^[-+]\s*/, "").replace(CURRENCY, "").trim();

  const numbers = body.match(NUMERIC) ?? [];
  if (numbers.length === 0) return refuse("No number in this value.");
  if (numbers.length > 1) {
    // "48 m2 and 62 m2", "between R540 000 and R680 000". Both figures are real and picking one is
    // a guess about which the reader meant.
    return refuse(`This holds ${numbers.length} figures, so which one is the amount is not decided.`);
  }

  const candidate = (numbers[0] ?? "").trim();

  // Anything left over that is not the number, the currency mark, or ordinary punctuation is a
  // qualifier — "excluding VAT", "estimated" — and changes what the figure means.
  const remainder = body.replace(candidate, "").replace(/[\s .,;:()-]/g, "");
  if (remainder !== "") {
    return refuse(`"${remainder}" qualifies this figure, so it is not read as a plain amount.`);
  }

  // Undecidable separators — the silent failure this whole module exists for. `separatorsOf` says
  // in words which of the two ways it could not be read; every decidable combination is read.
  const separators = separatorsOf(candidate);
  if (typeof separators !== "string") return refuse(separators.reason);

  try {
    return {
      ok: true,
      amount: parseMoney(negative ? `-${separators}` : separators),
      text: original,
    };
  } catch {
    return refuse(`"${candidate}" is not a figure this can read.`);
  }
}

/**
 * Whether a run of separated parts really is a thousands grouping.
 *
 * `1,234,567` is: one to three digits, then groups of exactly three. `11900,00500,00` is not — and
 * until this existed it was read as one. A rate typed over another in a grid cell produced
 * **R119 000 050 000,00** and nothing said a word, because repeated marks were taken as proof of
 * grouping without anybody checking that the groups were groups.
 *
 * Found by driving the pricing screen, not by reading this file: the cell held `1 500,00`, a
 * triple-click failed to select it (the thousands separator is a non-breaking space, and Chrome's
 * line selection will not cross one), and what landed was the two figures spliced together. The
 * interaction was one defect; **accepting the result was the dangerous one.**
 */
const groupingReason = (candidate: string) =>
  `"${candidate}" is not grouped the way any convention groups thousands, so what it is meant to say is not decided.`;

function thousandsGrouped(parts: readonly string[]): boolean {
  const [first, ...rest] = parts;
  return (
    parts.length > 1 &&
    first.length >= 1 &&
    first.length <= 3 &&
    rest.every((group) => group.length === 3)
  );
}

/** Why a figure's separators could not be normalised — a sentence, not a code. */
interface Undecidable {
  reason: string;
}

/**
 * What settles `1,234` when the string cannot: the decimal mark the rest of the document uses, or
 * `"whole"` when the figure is known to be a count of whole units.
 */
type Settle = "," | "." | "whole";

/** How the thousand-fold ambiguity may be settled from outside the figure. */
export interface ReadOptions {
  /** The decimal mark the source uses everywhere else – see `decimalMarkOf`. */
  readonly decimalMark?: "," | "." | null;
  /** The unit the figure is measured in, when it is a column of its own. */
  readonly unit?: string | null;
}

/**
 * Units a bill measures to the whole unit – the standard system of measuring rounds lengths, areas,
 * volumes and counts to whole units, so `12,940 m²` cannot be twelve point nine four. Tonnes, hectares
 * and kilometres are left out: three places are ordinary there.
 */
const WHOLE_UNITS = /^(?:m|lm|m2|m²|sqm|m3|m³|nr|no\.?|item|each|ea|kg|pc|pcs|set)$/i;

/**
 * The decimal mark a document uses, read from its unambiguous figures – or null when they say
 * nothing, or say both.
 *
 * `385,00` and `1 234,56` can only use a decimal comma; `12.50`, `1,234.56` and `1,234,567` can only
 * use a decimal point. `1,234` counts for neither, which is the point. Only two places count as
 * evidence: `3.2` is as likely a clause number as a figure, and a clause number says nothing.
 */
export function decimalMarkOf(texts: readonly string[]): "," | "." | null {
  let comma = 0;
  let point = 0;
  for (const text of texts) {
    for (const match of text.match(NUMERIC) ?? []) {
      const figure = match.trim().replace(/[\s ]/g, "");
      if (/^\d+,\d{2}$/.test(figure) || /^\d{1,3}(?:\.\d{3})+,\d+$/.test(figure)) comma += 1;
      else if (/^\d+\.\d{2}$/.test(figure) || /^\d{1,3}(?:,\d{3})+\.\d+$/.test(figure)) point += 1;
      else if (/^\d{1,3}(?:,\d{3}){2,}$/.test(figure)) point += 1;
      else if (/^\d{1,3}(?:\.\d{3}){2,}$/.test(figure)) comma += 1;
    }
  }
  if (comma > 0 && point === 0) return ",";
  if (point > 0 && comma === 0) return ".";
  return null;
}

/**
 * The unit first, then the document. A hand-typed bill that writes `R385,00` beside `12,940 m²` has
 * mixed its conventions – round-1 testing did exactly that – and twelve point nine four square
 * metres is not a measurement anybody takes, so a whole-measure unit is the stronger evidence.
 */
function settleFrom(options: ReadOptions | undefined, unit: string | null): Settle | undefined {
  const measured = (options?.unit ?? unit ?? "").trim();
  if (measured !== "" && WHOLE_UNITS.test(measured)) return "whole";
  return options?.decimalMark ?? undefined;
}

/**
 * Normalise a number's separators, or say why they cannot be normalised.
 *
 * Returns a string `parseMoney` will accept — digits, at most one decimal mark — or the reason it
 * is not a figure anybody can read with certainty.
 */
function separatorsOf(candidate: string, settle?: Settle): string | Undecidable {
  // Spaces are always grouping. No convention uses a space as a decimal mark.
  const spaced = candidate.replace(/[\s ]/g, "");

  const dots = (spaced.match(/\./g) ?? []).length;
  const commas = (spaced.match(/,/g) ?? []).length;

  // Both marks present: the **last** one is the decimal mark and the other groups. True of both
  // conventions — 1.234.567,89 and 1,234,567.89 — so nothing is being assumed about locale.
  if (dots > 0 && commas > 0) {
    const decimal = spaced.lastIndexOf(".") > spaced.lastIndexOf(",") ? "." : ",";
    const grouping = decimal === "." ? "," : ".";
    const parts = spaced.split(grouping);

    // The last part carries the decimal mark and the fraction; what has to be a group of three is
    // the whole-number side of it. `1.234.567,89` passes; `11.9000,50` does not.
    const whole = [...parts.slice(0, -1), (parts.at(-1) ?? "").split(decimal)[0] ?? ""];

    if (!thousandsGrouped(whole)) {
      return { reason: groupingReason(candidate) };
    }

    return parts.join("").replace(decimal, ".");
  }

  const mark = dots > 0 ? "." : commas > 0 ? "," : null;
  if (mark === null) return spaced;

  const parts = spaced.split(mark);

  // More than one of the same mark can only be grouping — 1,234,567 or 1.234.567 — **and only if
  // the groups are groups**. See `thousandsGrouped` for the figure that got in when they were not.
  if (parts.length > 2) {
    return thousandsGrouped(parts) ? parts.join("") : { reason: groupingReason(candidate) };
  }

  const tail = parts[1] ?? "";

  /**
   * One mark, three digits after it, and nothing else to go on. `1,234`. This is the case no rule
   * can settle, and guessing either way is a factor of a thousand.
   *
   * Grouping is only plausible when the part *before* the mark is one to three digits — `1,234` and
   * `123,456` are groupable, `1234,567` is not — so the ambiguity is narrower than it first looks,
   * and everything outside it reads as a decimal.
   *
   * **A leading zero is never a thousands group.** No convention writes `0,001` to mean one, and
   * `formatRate` produces exactly that shape for a rate carried to three or more places — so the
   * rule as first written refused a figure this platform had itself written down. Found by the
   * round-trip property, which is what it is for.
   */
  if (
    tail.length === 3 &&
    parts[0].length >= 1 &&
    parts[0].length <= 3 &&
    !parts[0].startsWith("0")
  ) {
    /**
     * Unless something outside the string says which. The document's own unambiguous figures do –
     * `R385,00` beside `12,940` means its comma is a decimal mark – and so does a unit measured to
     * whole units, where three places of decimals is not a thing anybody measures. Both come from
     * the caller; the string alone still settles nothing.
     */
    if (settle === mark) return `${parts[0]}.${tail}`;
    if (settle === "whole" || (settle !== undefined && settle !== mark)) return parts.join("");

    /**
     * The silent one, and the reason this whole module exists.
     *
     * `1,234` is one thousand two hundred and thirty-four to a reader who groups with commas, and
     * one point two three four to a South African reader whose decimal mark is the comma. Both are
     * ordinary; the difference is a factor of a thousand; and nothing in the string decides it.
     */
    return {
      reason: `"${candidate}" could be a thousands separator or a decimal comma — a factor of a thousand apart, and the text does not say which.`,
    };
  }

  return `${parts[0]}.${tail}`;
}

/**
 * The one number inside a value, with its separators resolved — or the reason there is not one.
 *
 * Shared by all three readers, because the two failures worth being paranoid about are the same
 * whatever the figure means: **two numbers in one string**, where picking either is a guess about
 * what the reader meant, and **an ambiguous separator**, where the two readings are a factor of a
 * thousand apart. A second copy of this logic is how a bill and a cost plan come to disagree about
 * `1,234`.
 */
function soleFigure(
  body: string,
  settle?: Settle,
): { ok: true; value: string; decimals: number; candidate: string } | { ok: false; reason: string } {
  const numbers = body.match(NUMERIC) ?? [];
  if (numbers.length === 0) return { ok: false, reason: "No number in this value." };
  if (numbers.length > 1) {
    return {
      ok: false,
      reason: `This holds ${numbers.length} figures, so which one is meant is not decided.`,
    };
  }

  const candidate = (numbers[0] ?? "").trim();
  const value = separatorsOf(candidate, settle);

  if (typeof value !== "string") return { ok: false, reason: value.reason };

  return { ok: true, value, decimals: value.split(".")[1]?.length ?? 0, candidate };
}

/**
 * Read a quantity out of what a document said — "1 250 m³", "864", "12,5".
 *
 * A quantity is not money, so no currency mark is stripped and a **trailing unit is expected**: the
 * unit is a column of its own on a bill row, and a figure that arrives carrying its unit is the
 * normal case rather than a qualified one. What is still refused is everything that would make the
 * number itself uncertain — a second figure, an ambiguous separator, a percentage, or a ratio
 * ("0,8 bays per unit" is not a quantity of anything).
 *
 * More than four decimal places is rounded and **said**, not refused and not dropped quietly.
 *
 * ── Why this stopped being a refusal ───────────────────────────────────────────────────────
 *
 * It was one, on the reasoning that dropping a digit behind a reader's back is worse than handing
 * the figure back to them. The reasoning was right about "quietly" and wrong about "refuse": a
 * drafted bill of 160 rows came back with dozens of quantities unread, and every one of them was
 * a figure no quantity surveyor would have hesitated over. Two kinds arrived:
 *
 *  - `0.44999999999999996` and `0.28999999999999998` — a spreadsheet's own binary floating-point
 *    noise for 0,45 and 0,29. Calling those seventeen decimal places of precision and refusing
 *    them is the platform misreading its own input; nothing is lost by reading them as what they
 *    plainly are, so they are read silently.
 *  - `283.59045`, `14.1795225` — genuine computed take-off values, where the fifth place is five
 *    hundredths of a millimetre of concrete. Rounded to the scale, and the row says so, which is
 *    what "not quietly" actually asks for.
 *
 * What is still refused is everything that makes the number itself uncertain — a second figure, an
 * ambiguous separator, a percentage, a ratio. Those are doubts about *which number it is*, and no
 * amount of rounding settles one.
 */
export function readQuantity(text: string | null | undefined, options?: ReadOptions): QuantityReading {
  const original = (text ?? "").trim();
  const refuse = (reason: string): QuantityReading => ({ ok: false, reason, text: original });

  if (original === "") return refuse("There is no figure here.");
  if (PERCENTAGE.test(original)) return refuse("This is a percentage, not a quantity.");
  if (PER_SOMETHING.test(original)) {
    return refuse("This is a ratio — something per something — and is not a quantity on its own.");
  }

  /**
   * The unit comes off before the figures are counted, and it has to.
   *
   * A South African bill measures in `m2` and `m3` — the units with a **digit in them** — so
   * "864 m2" read as a plain string holds two numbers, and the two-figures rule refused the single
   * most ordinary quantity on a bill. Measured on the first test written for it.
   *
   * Only a trailing token, and only one: `1 250 m³` and `864 m2` lose their unit, `12,3456` has
   * nothing to lose, and a figure with words on both sides is still refused as qualified.
   */
  const trailing = /\s*([a-zA-Z]+[0-9²³]?\.?)$/.exec(original);
  const withoutUnit = original.replace(/\s*[a-zA-Z]+[0-9²³]?\.?$/, "").trim() || original;

  // `1,234` is still refused unless the document's convention or a whole-measure unit settles it.
  const figure = soleFigure(withoutUnit, settleFrom(options, trailing?.[1] ?? null));
  if (!figure.ok) return refuse(figure.reason);

  const negative = /^\(.*\)$/.test(original) || original.startsWith("-");

  let value = figure.value;
  let rounded: string | null = null;
  if (figure.decimals > QUANTITY_SCALE) {
    value = roundDecimals(figure.value, QUANTITY_SCALE);
    // Only worth saying where a reader would see a different number. A spreadsheet's float noise
    // rounds to the value it was always meant to be, and a note about it is noise of another kind.
    if (!isRepresentationNoise(figure.value, value)) {
      rounded = `Rounded to ${value.replace(".", ",")} — the document carries "${figure.candidate}".`;
    }
  }

  try {
    return { ok: true, quantity: parseQuantity(negative ? `-${value}` : value), text: original, rounded };
  } catch {
    return refuse(`"${figure.candidate}" is not a figure this can read.`);
  }
}

/**
 * Round a decimal string to `places`, half away from zero, without going through a float.
 *
 * Through a float is how `0.44999999999999996` got here in the first place; reading it back out
 * through another one would be a poor way to repair it.
 */
function roundDecimals(value: string, places: number): string {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  if (fraction.length <= places) return value;

  const kept = BigInt(whole + fraction.slice(0, places));
  const carries = Number(fraction[places]) >= 5;
  const digits = (carries ? kept + 1n : kept).toString().padStart(places + 1, "0");

  const head = digits.slice(0, digits.length - places);
  const tail = places > 0 ? digits.slice(digits.length - places) : "";
  return `${negative ? "-" : ""}${head}${tail ? `.${tail}` : ""}`;
}

/**
 * Whether what rounding dropped was a binary representation artefact rather than precision.
 *
 * A spreadsheet stores 0,45 as 0.44999999999999996 and 0,29 as 0.28999999999999998 — the value is
 * out by less than a billionth, which is not a measurement, it is how the number was stored. A
 * genuinely more precise figure (283.59045 against 283,5905) differs by far more than that.
 */
function isRepresentationNoise(exact: string, rounded: string): boolean {
  const places = (s: string) => s.split(".")[1]?.length ?? 0;
  const scale = Math.max(places(exact), places(rounded));
  const scaled = (s: string) => {
    const [whole, fraction = ""] = s.replace("-", "").split(".");
    return BigInt(whole + fraction.padEnd(scale, "0"));
  };
  const apart = scaled(exact) - scaled(rounded);
  return (apart < 0n ? -apart : apart) * 1_000_000_000n < 10n ** BigInt(scale);
}

/**
 * Read a unit rate — "R1 850,00 per cubic metre", "R312,50/m²", "845".
 *
 * ── Why the rule that refuses an amount is the rule that *defines* a rate ──────────────────
 *
 * `readAmount` refuses "R42 000,00 per calendar day" precisely because it is a rate, and summing it
 * with amounts contributes forty-two thousand rand of nothing. Here the per-phrase is the point: it
 * is read, kept, and handed back so the caller can check it against the unit the row claims.
 *
 * ── The scale comes from the figure, not from a setting ───────────────────────────────────
 *
 * §5.1: a rate carries its own precision — usually two places, sometimes four for low-value
 * high-volume items where rounding the rate itself would compound across thousands of lines. So the
 * number of decimal places the document wrote is the scale the rate is stored at, floored at the
 * money scale and refused above six.
 */
export function readRate(
  text: string | null | undefined,
  options?: Pick<ReadOptions, "decimalMark">,
): RateReading {
  const original = (text ?? "").trim();
  const refuse = (reason: string): RateReading => ({ ok: false, reason, text: original });

  if (original === "") return refuse("There is no figure here.");
  if (PERCENTAGE.test(original)) return refuse("This is a percentage, not a rate.");

  // The per-phrase comes off first and is kept. `/m²` and `per cubic metre` are the same statement.
  const perPhrase = /\bper\s+([a-z²³0-9\s]+)$|\/\s*([a-z²³0-9]+)$/i.exec(original);
  const per = (perPhrase?.[1] ?? perPhrase?.[2])?.trim() ?? null;
  const withoutPer = perPhrase ? original.slice(0, perPhrase.index).trim() : original;

  const bracketed = /^\((.*)\)$/.exec(withoutPer);
  const inner = (bracketed?.[1] ?? withoutPer).trim();
  const negative = bracketed !== null || inner.startsWith("-");
  const body = inner.replace(/^[-+]\s*/, "").replace(CURRENCY, "").trim();

  // A rate is money per unit, never a count, so only the document's convention can settle `1,234`.
  const figure = soleFigure(body, options?.decimalMark ?? undefined);
  if (!figure.ok) return refuse(figure.reason);

  // Anything else left over qualifies the figure — "excluding VAT", "estimated" — and changes what
  // it means. Same rule as `readAmount`, and the reason is the same: a qualified rate priced as a
  // plain one is a wrong amount on every row that uses it.
  const remainder = body.replace(figure.candidate, "").replace(/[\s .,;:()-]/g, "");
  if (remainder !== "") {
    return refuse(`"${remainder}" qualifies this figure, so it is not read as a plain rate.`);
  }

  if (figure.decimals > 6) {
    return refuse(`"${figure.candidate}" carries ${figure.decimals} decimal places and a rate is held to 6.`);
  }

  const precision = Math.max(MONEY_SCALE, figure.decimals);

  try {
    return {
      ok: true,
      rate: parseRate(negative ? `-${figure.value}` : figure.value, precision),
      per,
      text: original,
    };
  } catch {
    return refuse(`"${figure.candidate}" is not a figure this can read.`);
  }
}

/**
 * Read a percentage a person typed — "5", "12,5", "8%", "-3".
 *
 * ── Why the caller supplies the band ──────────────────────────────────────────────────────
 *
 * Because the database does too, and the two must not be able to disagree. Waste and markup are
 * `check (>= 0 and <= 1)` in `0011_pricing.sql`; a bulk adjustment may go down as well as up but
 * never past -100%, where a rate would change sign. Passing the band in means one implementation of
 * the reading and one sentence per refusal, rather than a band checked in whichever caller
 * remembered to.
 *
 * A percentage is entered as the whole number a QS says out loud — 5 means 5%, not 500%. The
 * `Percent` returned is the decimal fraction §5.1 stores, so nothing downstream has to remember
 * which of the two it is holding.
 */
export function readPercent(
  text: string | null | undefined,
  band: { min: number; max: number },
): PercentReading {
  const original = (text ?? "").trim();
  const refuse = (reason: string): PercentReading => ({ ok: false, reason, text: original });

  if (original === "") return refuse("There is no figure here.");

  // The per-cent mark comes off with the sign: "8%" and "8" are the same statement, and a bulk
  // adjustment is legitimately negative.
  const unmarked = original.replace(/%\s*$/, "").replace(/\bper\s*cent\b/i, "").trim();
  const negative = unmarked.startsWith("-");
  const body = unmarked.replace(/^[-+]\s*/, "").trim();

  const figure = soleFigure(body);
  if (!figure.ok) return refuse(figure.reason);

  const remainder = body.replace(figure.candidate, "").replace(/[\s .,;:()-]/g, "");
  if (remainder !== "") {
    return refuse(`"${remainder}" qualifies this figure, so it is not read as a plain percentage.`);
  }

  // PERCENT_SCALE holds four places on the *fraction*, which is two on the percentage. 12,55% is
  // 0,1255 and lands exactly; 12,555% would not, and truncating it silently is how a markup ends up
  // a hundredth of a per cent away from the one somebody typed.
  if (figure.decimals > 2) {
    return refuse(
      `"${figure.candidate}" carries ${figure.decimals} decimal places and a percentage is held to 2.`,
    );
  }

  /**
   * Hundredths of a percent, which is also exactly the scaled `Percent` — and that coincidence is
   * why there is no division here.
   *
   * A percentage is entered as the whole number a QS says out loud, and stored as the decimal
   * fraction §5.1 specifies: 15 becomes 0,1500. Dividing by a hundred would mean a `number`, and
   * `number` appears in no calculation in this codebase. Scaling the typed figure by 100 lands on
   * the same integer: 12,5% → 1250 → `0.1250`.
   */
  const [whole = "0", fraction = ""] = figure.value.split(".");
  const magnitude = BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
  const scaled = negative ? -magnitude : magnitude;

  if (scaled < BigInt(band.min) * 100n || scaled > BigInt(band.max) * 100n) {
    return refuse(
      `A percentage here has to be between ${band.min}% and ${band.max}%, and this is ${negative ? "-" : ""}${figure.value}%.`,
    );
  }

  return { ok: true, percent: percent(scaled), text: original };
}

/**
 * A step's own arithmetic: do the parts add up to the whole it states?
 *
 * ── Why a mismatch is a finding and not an error ───────────────────────────────────────────
 *
 * A cost plan states a total, and it states the elements that make it. They should agree. When they
 * do not, the platform is in no position to say which is wrong: the plan may carry an element this
 * field set does not ask for, the total may include VAT the elements exclude, or somebody may have
 * mistyped. Every one of those is a real thing that happens to real cost plans.
 *
 * So the difference is reported, with both figures and the refusals that were skipped, and the QS
 * decides. Correcting either number is a correction they sign for. What the platform must never do
 * is quietly overwrite one with the other, or present a total nobody signed as though it were one.
 */
export interface Reconciliation {
  /** The elements that could be read, summed. */
  elements: Money;
  /** How many elements contributed, and how many could not be read. */
  counted: number;
  refused: { label: string; reason: string; text: string }[];
  /** What the document itself says the total is, where it says one. */
  stated: Money | null;
  /** `stated - elements`. Null when there is nothing to compare against. */
  difference: Money | null;
}

export function reconcile(
  fields: readonly { label: string; value: string | null; money?: "element" | "total" }[],
): Reconciliation {
  const refused: Reconciliation["refused"] = [];
  let elements = money(0n);
  let counted = 0;
  let stated: Money | null = null;

  for (const field of fields) {
    if (!field.money) continue;

    const reading = readAmount(field.value);

    if (!reading.ok) {
      // A total that cannot be read is still worth reporting as a refusal — it is the figure the
      // comparison was going to be made against.
      refused.push({ label: field.label, reason: reading.reason, text: reading.text });
      continue;
    }

    if (field.money === "total") {
      stated = reading.amount;
      continue;
    }

    elements = money(elements + reading.amount);
    counted += 1;
  }

  return {
    elements,
    counted,
    refused,
    stated,
    difference: stated === null ? null : money(stated - elements),
  };
}
