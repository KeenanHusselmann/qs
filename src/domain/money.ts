/**
 * Money and quantity arithmetic.
 *
 * PLATFORM.md §5 is the specification for this file. It is the one place in the product to be
 * paranoid: if a QS adds a column by hand and gets a different answer, trust is gone permanently.
 *
 * ── Why there is no decimal library here ──────────────────────────────────────────────────
 *
 * §5.1 fixes the storage: money in minor units, quantities at four decimal places, rates as
 * integers with a declared precision. Every one of those is a *fixed-scale integer*, so all the
 * arithmetic below is exact integer arithmetic on `bigint`.
 *
 * A decimal library exists to give you exact arithmetic at arbitrary, varying precision. We do not
 * have arbitrary precision — we have three known scales fixed by the schema. Scaling by hand is
 * what such a library would do internally, and doing it explicitly means the single rounding point
 * required by §5.2 is visible in the code rather than buried in a library's configuration.
 *
 * `number` appears nowhere in any calculation. It is binary floating point, it cannot represent
 * 0.1, and it is how a costing system quietly starts producing bills that do not add up.
 */

// ── Scales ────────────────────────────────────────────────────────────────────────────────

/** Decimal places on a money value. Minor units — cents. §5.1 */
export const MONEY_SCALE = 2;

/** Decimal places on a quantity. `numeric(18,4)` in the schema. §5.1 */
export const QUANTITY_SCALE = 4;

/** Decimal places on a percentage. `numeric(6,4)` — 0.1500 is 15%. §5.1 */
export const PERCENT_SCALE = 4;

/**
 * Money, in minor units. R1 234,56 is `123456n`.
 *
 * A branded alias rather than a class: it is a `bigint` at runtime with no wrapper cost, and the
 * brand stops a raw quantity being passed where an amount belongs.
 */
export type Money = bigint & { readonly __brand: "Money" };

/** A quantity, scaled by 10^QUANTITY_SCALE. 12.3456 is `123456n`. */
export type Quantity = bigint & { readonly __brand: "Quantity" };

/**
 * A unit rate, scaled by its own `precision` rather than a fixed one.
 *
 * §5.1: usually 2 decimal places, sometimes 4 for low-value high-volume items — bricks, fixings —
 * where rounding the *rate* to cents would compound visibly across thousands of bill lines.
 * The precision travels with the value because it is stored per rate, not per system.
 */
export interface Rate {
  readonly value: bigint;
  readonly precision: number;
}

export const money = (minorUnits: bigint): Money => minorUnits as Money;
export const quantity = (scaled: bigint): Quantity => scaled as Quantity;

export const rate = (value: bigint, precision = MONEY_SCALE): Rate => {
  if (!Number.isInteger(precision) || precision < 0 || precision > 6) {
    throw new RangeError(`Rate precision must be an integer 0-6, got ${precision}`);
  }
  return { value, precision };
};

export const ZERO_MONEY = money(0n);
export const ZERO_QUANTITY = quantity(0n);

// ── Rounding ──────────────────────────────────────────────────────────────────────────────

/**
 * Divide, rounding half away from zero.
 *
 * Half-away-from-zero ("commercial rounding") rather than banker's rounding: it is what a QS gets
 * from a hand calculation and from Excel's ROUND, and §5.2's requirement is that a total be
 * reproducible by hand. Banker's rounding is better for large statistical aggregates and worse
 * here, because it would disagree with the person checking the column.
 *
 * Symmetric across zero, so an omission of -R5.435 rounds to -R5.44 exactly as the addition of
 * R5.435 rounds to R5.44. Asymmetry here would make a variation's additions and omissions fail
 * to cancel.
 */
/**
 * Half-away-from-zero integer division — the one rounding rule in the product.
 *
 * Exported because the affordability envelope needs it and copying it would be the second copy of
 * the rule §5.2 exists to state once. Everything derived from money rounds *here*, so a figure a
 * QS re-computes by hand agrees with the screen.
 */
export function divideRounded(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError("Division by zero in money arithmetic");

  const negative = numerator < 0n !== denominator < 0n;
  const absNumerator = numerator < 0n ? -numerator : numerator;
  const absDenominator = denominator < 0n ? -denominator : denominator;

  // Add half the divisor before truncating — integer half-up on the absolute value.
  const rounded = (absNumerator * 2n + absDenominator) / (absDenominator * 2n);

  return negative ? -rounded : rounded;
}

function pow10(exponent: number): bigint {
  if (exponent < 0) throw new RangeError(`Negative exponent: ${exponent}`);
  return 10n ** BigInt(exponent);
}

// ── The extension — the single most important function in the product ─────────────────────

/**
 * `amount = round(quantity × rate)` — PLATFORM.md §5.2.
 *
 * **This is the only place in the entire system where rounding happens.** Every downstream total
 * sums already-rounded amounts (see `sum`). Nothing rounds mid-formula within an item, and nothing
 * ever re-rounds a sum. Invariant 2 in §6.4 is the database's restatement of this function.
 *
 * The whole calculation is one exact integer division, so there is no intermediate value to lose
 * precision in:
 *
 *     amount_minor = round( qty_scaled × rate_value / 10^(rate.precision + QUANTITY_SCALE - MONEY_SCALE) )
 *
 * Worked example — 12.3456 units at R0,4567 each, a rate carried to 4 places:
 *
 *     qty  12.3456  → 123456n   (scaled 10^4)
 *     rate R0,4567  →   4567n   (precision 4)
 *     123456 × 4567 = 563 823 552
 *     10^(4 + 4 - 2) = 10^6
 *     563 823 552 / 10^6 = 563.823552  → 564n  = R5,64
 *
 * Which is what 12,3456 × R0,4567 = R5,6382… rounds to, and what the QS's calculator shows.
 */
export function extend(qty: Quantity, unitRate: Rate): Money {
  const divisorExponent = unitRate.precision + QUANTITY_SCALE - MONEY_SCALE;

  if (divisorExponent < 0) {
    // A rate coarser than whole currency units would scale *up*. No such rate exists in the
    // schema, but failing loudly beats silently multiplying.
    throw new RangeError(`Rate precision ${unitRate.precision} is below the money scale`);
  }

  return money(divideRounded(qty * unitRate.value, pow10(divisorExponent)));
}

// ── Aggregation ───────────────────────────────────────────────────────────────────────────

/**
 * Add already-rounded amounts.
 *
 * Deliberately trivial, and deliberately named so that reaching for anything cleverer is a visible
 * decision. §5.2: every downstream total sums already-rounded item amounts. There is no rounding
 * here because there is nothing left to round — that already happened, once, in `extend`.
 */
export function sum(amounts: readonly Money[]): Money {
  let total = 0n;
  for (const amount of amounts) total += amount;
  return money(total);
}

/** Sum quantities. Exact — quantities share one fixed scale, so this cannot lose precision. */
export function sumQuantities(quantities: readonly Quantity[]): Quantity {
  let total = 0n;
  for (const q of quantities) total += q;
  return quantity(total);
}

// ── Percentages — retention, VAT, markup, waste ───────────────────────────────────────────

/**
 * A percentage held at PERCENT_SCALE. 15% is `1500n`, i.e. 0.1500.
 *
 * Stored as the decimal fraction rather than "15", matching `numeric(6,4)` in the schema, so the
 * value in the database and the value in code read identically.
 */
export type Percent = bigint & { readonly __brand: "Percent" };

export const percent = (scaled: bigint): Percent => scaled as Percent;

/** Build a Percent from a human figure: `percentFromRate(15)` is 15%. */
export const percentFromRate = (wholePercent: number): Percent => {
  const scaled = divideRounded(
    BigInt(Math.round(wholePercent * 1e6)) * pow10(PERCENT_SCALE),
    100n * 1_000_000n,
  );
  return percent(scaled);
};

/**
 * Apply a percentage to an amount, rounding to minor units.
 *
 * Retention and VAT are computed on totals rather than per item, so this rounds — but it rounds a
 * *derived* figure, not a re-rounding of a sum. §5.3: VAT is applied at certificate level, never
 * per item, precisely so this happens once per certificate.
 */
export function applyPercent(amount: Money, pct: Percent): Money {
  return money(divideRounded(amount * pct, pow10(PERCENT_SCALE)));
}

/**
 * Retention, capped by its contractual limit. §6.4 invariant 6.
 *
 * The limit is expressed as a percentage of the contract value, not an absolute — so the cap has
 * to be computed before it can be applied. Returning the capped figure rather than throwing is
 * correct: reaching the retention limit is normal contractual behaviour, not an error.
 */
export function retention(
  grossValue: Money,
  retentionRate: Percent,
  limitRate: Percent,
  contractValue: Money,
): Money {
  const calculated = applyPercent(grossValue, retentionRate);
  const cap = applyPercent(contractValue, limitRate);
  return calculated > cap ? cap : calculated;
}

// ── Derived indicators — a figure *about* a total, never a figure *in* one ────────────────

/**
 * An amount per one of something — cost per unit, cost per square metre.
 *
 * ── Why a second rounding site does not breach §5.2 ────────────────────────────────────────
 *
 * §5.2's rule is about the **extension**: `amount = round(quantity × rate)`, rounded once at the
 * bill item, and no total ever re-rounded. This does not participate in that chain. Its output is
 * never summed, never stored, never carried into a certificate — it is an indicator computed *from*
 * a total for a reader to compare against a benchmark, which is exactly the standing `applyPercent`
 * already has and for the same stated reason.
 *
 * It is here rather than in the screen that wants it because `divideRounded` is private, and a
 * second half-away-from-zero division written by hand somewhere else is how two surfaces come to
 * disagree about the last cent of a figure a QS is reading off a dashboard.
 *
 * One exact integer division, so nothing is lost on the way:
 *
 *     per_minor = round( amount_minor × 10^QUANTITY_SCALE / qty_scaled )
 *
 * Worked example — R186 420 000,00 over 1 046 units:
 *
 *     amount  18 642 000 000n            (minor units)
 *     qty     1 046 → 10 460 000n        (scaled 10^4)
 *     18 642 000 000 × 10 000 = 186 420 000 000 000
 *     186 420 000 000 000 / 10 460 000 = 17 822 179,73…  → 17 822 180n = R178 221,80
 *
 * A quantity of nought or less is refused rather than returned as anything. Nought units is not a
 * scheme with an infinite cost per unit; it is a figure nobody has established, and the caller's
 * job is to say so on the screen rather than to print a number.
 */
export function perUnit(amount: Money, per: Quantity): Money {
  if (per <= 0n) {
    throw new RangeError(`Cannot divide an amount by a quantity of ${formatQuantity(per)}`);
  }
  return money(divideRounded(amount * pow10(QUANTITY_SCALE), per));
}

/**
 * Quantity × quantity — a gross floor area from a unit count and an average unit area.
 *
 * Exact whenever one factor is a whole number, which a unit count always is: the scaled product
 * carries 2 × QUANTITY_SCALE places and dividing by 10^QUANTITY_SCALE leaves `units × area_scaled`,
 * an integer. Half-away-from-zero elsewhere, matching every other rounding in this file, so a
 * fractional count cannot produce an area that rounds one way here and another way by hand.
 */
export function multiplyQuantities(a: Quantity, b: Quantity): Quantity {
  return quantity(divideRounded(a * b, pow10(QUANTITY_SCALE)));
}

// ── The rate build-up — PLATFORM.md §4.8 ──────────────────────────────────────────────────

/** One component of a build-up: how much of it goes into **one unit** of the bill item, at what rate. */
export interface BuildUpLine {
  readonly quantity: Quantity;
  readonly rate: Rate;
}

/** The column a QS would write on paper, so a screen can show the working rather than an answer. */
export interface BuiltUpRate {
  /** What each component costs per unit of the item, in the order given. */
  readonly lines: readonly Money[];
  /** The components, added up. */
  readonly net: Money;
  /** `net × waste`. */
  readonly waste: Money;
  /** `(net + waste) × markup` — a markup is taken on delivered cost, and waste is part of that. */
  readonly markup: Money;
  /** `net + waste + markup`, which is the rate this build-up produces. */
  readonly rate: Rate;
}

/**
 * Build a unit rate from its components — §4.8: "component rows with quantity and unit rate, then
 * waste %, markup %, computed rate".
 *
 * ── Why this is a third rounding site and still does not breach §5.2 ───────────────────────
 *
 * §5.2 governs the **extension**: `amount = round(quantity × rate)`, rounded once at the bill item,
 * and no total ever re-rounded. This sits on the other side of that rule. It produces the *rate* —
 * an **input** to the extension, not a step within it — and the item's amount is still computed
 * exactly once afterwards, by the trigger in `0010_run_items.sql`, from the single figure returned
 * here. The same standing `applyPercent` and `perUnit` already have, and for the same stated reason.
 *
 * ── Why every component rounds ────────────────────────────────────────────────────────────
 *
 * Because that is what the paper does. A QS building up a rate writes a rand figure against each
 * component, adds the column, adds waste, adds markup — and §5.2's actual requirement is that the
 * answer be reproducible by hand. Carrying the components at full precision and rounding once at
 * the end would give a rate occasionally a cent away from the one written beside it on the screen,
 * which is the disagreement this whole file exists to prevent.
 *
 * ── The result is held at the money scale, and that is a decision ──────────────────────────
 *
 * §5.1 allows a rate four decimal places for low-value high-volume items. A build-up cannot use
 * them: it is a sum of *costs*, and a cost is an amount of money, which is held in cents. The
 * precision that matters is on the components — 55 bricks at R1,8500 each is exact — and it is the
 * sum that lands on the cent. A rate genuinely needing four places is one somebody types or one a
 * document states, and both of those routes stay open.
 *
 * Worked example — one cubic metre of 25 MPa concrete:
 *
 *     0,3500 t  cement @ R2 400,00  →     R840,00
 *     0,7000 m³ sand   @   R180,00  →     R126,00
 *     2,5000 h  labour @    R85,00  →     R212,50
 *                                   net  R1 178,50
 *     waste 5%                           +  R58,93   (1 178,50 × 0,05 = 58,925 → 58,93)
 *     markup 12%                         + R148,49   (1 237,43 × 0,12 = 148,4916 → 148,49)
 *                                   rate R1 385,92
 */
export function buildUpRate(
  lines: readonly BuildUpLine[],
  waste: Percent,
  markup: Percent,
): BuiltUpRate {
  const lineCosts = lines.map((line) => extend(line.quantity, line.rate));
  const net = sum(lineCosts);

  const wasteAmount = applyPercent(net, waste);
  const markupAmount = applyPercent(money(net + wasteAmount), markup);

  return {
    lines: lineCosts,
    net,
    waste: wasteAmount,
    markup: markupAmount,
    rate: rate(net + wasteAmount + markupAmount, MONEY_SCALE),
  };
}

/**
 * Move a rate by a percentage — §4.8's "apply % markup across a selection".
 *
 * **The precision is kept**, not normalised to the money scale. §5.1 gives a rate four places
 * precisely for the low-value high-volume items where rounding to cents compounds across thousands
 * of lines, and an escalation that quietly flattened those to two places would do the compounding
 * it exists to avoid.
 *
 * A fourth rounding site, with the same standing as `buildUpRate` above: it produces a rate, which
 * is an input to the extension rather than a step inside it, and the item's amount is still
 * computed exactly once from the result.
 */
export function adjustRate(unitRate: Rate, pct: Percent): Rate {
  const movement = divideRounded(unitRate.value * pct, pow10(PERCENT_SCALE));
  return rate(unitRate.value + movement, unitRate.precision);
}

// ── Parsing and formatting ────────────────────────────────────────────────────────────────

/**
 * Parse a fixed-scale decimal string into a scaled bigint.
 *
 * Digit-by-digit rather than via `parseFloat`, because the moment a value passes through a
 * JavaScript `number` it may already be wrong. Accepts an optional sign, spaces and thousands
 * separators, and both `.` and `,` as the decimal mark — SA convention is the comma, and a QS
 * pasting from Excel will produce either.
 */
function parseScaled(input: string, scale: number, label: string): bigint {
  const cleaned = input.trim().replace(/[\s ]/g, "");
  if (cleaned === "") throw new SyntaxError(`Empty ${label}`);

  // Bracketed negatives are accounting convention and appear in pasted data: (1 234,56)
  const bracketed = /^\((.*)\)$/.exec(cleaned);
  const body = bracketed?.[1] ?? cleaned;
  const negative = bracketed !== null || body.startsWith("-");
  const unsigned = body.replace(/^[+-]/, "");

  // One decimal mark only. A thousands separator that survived cleaning would produce two.
  const match = /^(\d*)(?:[.,](\d*))?$/.exec(unsigned);
  if (!match || (match[1] === "" && (match[2] ?? "") === "")) {
    throw new SyntaxError(`Not a valid ${label}: ${JSON.stringify(input)}`);
  }

  const whole = match[1] || "0";
  const fraction = match[2] ?? "";

  // Truncate rather than round: a value arriving with more places than the column holds is a
  // problem with the input, and silently rounding it would hide that from whoever pasted it.
  const padded = (fraction + "0".repeat(scale)).slice(0, scale);
  const scaled = BigInt(whole) * pow10(scale) + BigInt(padded || "0");

  return negative ? -scaled : scaled;
}

export const parseMoney = (input: string): Money =>
  money(parseScaled(input, MONEY_SCALE, "amount"));

export const parseQuantity = (input: string): Quantity =>
  quantity(parseScaled(input, QUANTITY_SCALE, "quantity"));

export const parseRate = (input: string, precision = MONEY_SCALE): Rate =>
  rate(parseScaled(input, precision, "rate"), precision);

/**
 * Read a percentage held as the decimal fraction — `"0.0500"` is 5%.
 *
 * This is what a `numeric(6,4)` column hands back, and it is also the shape `percentFromRate`
 * produces. That one takes a JavaScript `number` and is therefore only safe for a literal a
 * developer typed; anything arriving from the database or from a person goes through here, where
 * the digits are read one at a time and never pass through binary floating point.
 */
export const parsePercent = (input: string): Percent =>
  percent(parseScaled(input, PERCENT_SCALE, "percentage"));

function formatScaled(value: bigint, scale: number, groupThousands: boolean): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const divisor = pow10(scale);

  const whole = (absolute / divisor).toString();
  const fraction = (absolute % divisor).toString().padStart(scale, "0");

  // Non-breaking space as the thousands separator, per §7.7's `R 1 234 567,89`. A normal space
  // would let a number wrap across lines in a table cell.
  const grouped = groupThousands ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ") : whole;
  const body = scale > 0 ? `${grouped},${fraction}` : grouped;

  return negative ? `-${body}` : body;
}

/**
 * Format money for display. §7.7 and §7.4's money cell.
 *
 * `accounting: true` renders negatives as `(1 234,56)` — the convention for an omission in a bill,
 * and what §7.4 specifies for the grid's money cell.
 */
export function formatMoney(
  amount: Money,
  options: { accounting?: boolean; symbol?: string } = {},
): string {
  const { accounting = false, symbol } = options;
  const body = formatScaled(amount, MONEY_SCALE, true);

  if (accounting && amount < 0n) {
    const withoutSign = body.slice(1);
    return symbol ? `(${symbol} ${withoutSign})` : `(${withoutSign})`;
  }

  /*
    The sign goes in front of the symbol, not between it and the digits.

    `R -24 224 386,96` is what the obvious concatenation gives, and it is not how anybody
    writes money — the sign belongs to the amount. This was written wrong in three separate
    places before it was written once here, which is the argument for it living in this file.
  */
  if (symbol && amount < 0n) return `−${symbol} ${body.slice(1)}`;

  return symbol ? `${symbol} ${body}` : body;
}

/**
 * Money with the currency on it, signed correctly — the ordinary way to print an amount.
 *
 * Callers were writing `R${formatMoney(x)}` by hand, which is right until the amount is negative
 * and then prints the minus after the R. A negative NPV is not an edge case on a feasibility
 * platform; it is the finding.
 */
export const formatRand = (amount: Money): string => formatMoney(amount, { symbol: "R" });

/**
 * Format a quantity, trimming trailing zeros to at least `minDecimals`.
 *
 * A bill reads `12,35` and `4` rather than `12,3500` and `4,0000` — but the underlying value keeps
 * all four places, so the extension is unaffected by how it is displayed.
 */
export function formatQuantity(qty: Quantity, minDecimals = 2): string {
  const full = formatScaled(qty, QUANTITY_SCALE, true);
  const [whole = "0", fraction = ""] = full.split(",");

  const trimmed = fraction.replace(/0+$/, "");
  const kept = trimmed.padEnd(Math.min(minDecimals, QUANTITY_SCALE), "0");

  return kept === "" ? whole : `${whole},${kept}`;
}

export function formatRate(unitRate: Rate): string {
  return formatScaled(unitRate.value, unitRate.precision, true);
}

/**
 * A unit as a reader writes it: `m2` → `m²`, `m3` → `m³`. Anything else is left as it was stored.
 *
 * Stored units stay ASCII because they are matched on (`rate-match.ts`); this is display only.
 */
export function displayUnit(unit: string): string {
  /*
    As a whole token anywhere in the text, not only as the whole of it: a plan's measure is typed
    by a person – "m2 gross floor area", "R/m2", "sqm" – and a keyboard has no ². Anchoring on the
    whole string left every such label printing "m2", which reads as a typo on a cost report.
  */
  return unit
    .trim()
    .replace(/(?<![\w])(?:m\^?2|sq\.?\s?m)(?![\w])/gi, "m²")
    .replace(/(?<![\w])(?:m\^?3|cu\.?\s?m)(?![\w])/gi, "m³");
}

/**
 * A rate for reading — `R 150,00/hour`, `R 1 250,00/m²`.
 *
 * A bare `36 480,00` beside a quantity left the reader to work out whether it was a rate or a total,
 * and in what. Every money figure says it is rands, and every rate says what it is per. Two decimals
 * at least, as money is written; more only where the rate genuinely has them (`R 0,0450/l`).
 */
export function formatUnitRate(unitRate: Rate, unit: string): string {
  const full = formatScaled(unitRate.value, unitRate.precision, true);
  const [whole = "0", fraction = ""] = full.split(",");
  const kept = fraction.replace(/0+$/, "").padEnd(2, "0");
  const negative = whole.startsWith("-");
  const body = `${negative ? whole.slice(1) : whole},${kept}`;
  // Written the way `formatMoney` writes money: a non-breaking space after the R so it never wraps
  // away from its digits, and a true minus in front of the symbol rather than after it.
  return `${negative ? "−" : ""}R ${body}/${displayUnit(unit)}`;
}

/**
 * A percentage as a person writes it: `1500n` (0,1500) reads "15". Trailing zeros trimmed, because
 * a waste allowance is "5%" and not "5,0000%".
 */
export function formatPercent(pct: Percent): string {
  const asHundredths = formatScaled(pct * 100n, PERCENT_SCALE, false);
  const [whole = "0", fraction = ""] = asHundredths.split(",");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed === "" ? whole : `${whole},${trimmed}`;
}

/**
 * A percentage as the plain fixed-scale decimal a `numeric(6,4)` column holds — "0.0500".
 *
 * The sibling of `quantityToNumeric`, and here for the same reason: this module owns the scale, and
 * a second conversion written in whichever caller needed it first is how a rate ends up stored a
 * hundred times too large.
 */
export function percentToNumeric(pct: Percent): string {
  const negative = pct < 0n;
  const absolute = negative ? -pct : pct;
  const divisor = pow10(PERCENT_SCALE);
  const whole = (absolute / divisor).toString();
  const fraction = (absolute % divisor).toString().padStart(PERCENT_SCALE, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/**
 * A quantity as the plain fixed-scale decimal a `numeric(18,4)` column holds — "1250.0000".
 *
 * Not `formatQuantity`, which is for a person: it groups thousands with a non-breaking space and
 * uses the comma decimal mark of §7.7, and a database would reject both. This module owns the scale,
 * so the conversion belongs here rather than in whichever caller happens to need it first.
 */
export function quantityToNumeric(qty: Quantity): string {
  const negative = qty < 0n;
  const absolute = negative ? -qty : qty;
  const divisor = pow10(QUANTITY_SCALE);

  const whole = (absolute / divisor).toString();
  const fraction = (absolute % divisor).toString().padStart(QUANTITY_SCALE, "0");

  return `${negative ? "-" : ""}${whole}.${fraction}`;
}
