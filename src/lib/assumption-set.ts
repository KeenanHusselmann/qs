/**
 * The figures the platform assumes, and what each one moves.
 *
 * ── Constants only, no database ────────────────────────────────────────────────────────────
 *
 * The settings form is a client component and needs the definitions. Anything server-only lives in
 * `assumptions.ts` — the contacts directory returned 500 on every page in the app, login included,
 * because a client component imported a constant from a module that imports `db`.
 *
 * ── Why each carries a `moves` line ────────────────────────────────────────────────────────
 *
 * A settings page of nine numbers with no context invites somebody to change one to see what
 * happens. Saying what each figure decides — "the price ceiling every cost is tested against" —
 * turns an idle edit into a considered one, and is the difference between a settings page and a
 * control panel nobody should be given.
 */

export interface Assumptions {
  /** The lending rate an affordability envelope is built on. */
  primeRatePa: number;
  lendingMarginPa: number;
  bondTermYears: number;
  instalmentToIncomePct: number;
  /** What selling prices are assumed to do over the sell-out. */
  priceEscalationPa: number;
  salesCommission: number;
  /** Approvals before construction starts, in the cash flow. */
  preDevelopmentMonths: number;
  /** Development finance. */
  financeRatePa: number;
  debtPct: number;
  /** The rate a return is discounted at before it counts as a return. */
  discountRatePa: number;
}

export type AssumptionKey = keyof Assumptions;

/**
 * The platform's own figures, and the only ones in force until a practice sets its own.
 *
 * These are the values that were hard-coded in `viability.ts`, `scenario.ts` and `cashflow.ts`.
 * They remain the defaults because a defensible default is better than an empty field — but they
 * are now visibly the platform's, on a page that says so, rather than invisibly everybody's.
 */
export const DEFAULT_ASSUMPTIONS: Assumptions = {
  primeRatePa: 0.1175,
  lendingMarginPa: 0,
  bondTermYears: 20,
  instalmentToIncomePct: 30,
  priceEscalationPa: 0.05,
  salesCommission: 0.03,
  preDevelopmentMonths: 6,
  financeRatePa: 0.1175,
  debtPct: 60,
  discountRatePa: 0.14,
};

export interface AssumptionSpec {
  key: AssumptionKey;
  label: string;
  /** What it decides. The reason somebody should think before changing it. */
  moves: string;
  /** How it is entered and shown. */
  unit: "percent" | "months" | "years" | "share";
  group: "Lending" | "Market" | "Funding";
  /** Outside this and it is a typing accident, not a policy. */
  min: number;
  max: number;
}

/**
 * Every assumption, in the order a QS would review them.
 *
 * Lending first because the affordability envelope is the binding input — §1.3.1's constraint-led
 * order, the same one the report's sections follow.
 */
export const ASSUMPTION_SPECS: readonly AssumptionSpec[] = [
  {
    key: "primeRatePa",
    label: "Prime lending rate",
    moves:
      "The price ceiling every cost is tested against, and the rate committed money is held at over the approval period.",
    unit: "percent",
    group: "Lending",
    min: 0.01,
    max: 0.4,
  },
  {
    key: "lendingMarginPa",
    label: "Lending margin over prime",
    moves: "Added to prime when working out what a household can borrow.",
    unit: "percent",
    group: "Lending",
    min: 0,
    max: 0.15,
  },
  {
    key: "bondTermYears",
    label: "Bond term",
    moves: "How long a buyer repays over. A longer term raises the ceiling and the total interest.",
    unit: "years",
    group: "Lending",
    min: 5,
    max: 30,
  },
  {
    key: "instalmentToIncomePct",
    label: "Instalment to income",
    moves:
      "The share of household income a lender will let go to the bond. The single largest lever on the affordability ceiling.",
    unit: "share",
    group: "Lending",
    min: 10,
    max: 45,
  },
  {
    key: "priceEscalationPa",
    label: "Selling price escalation",
    moves:
      "What prices do over the sell-out. On a long absorption this compounds for years and materially changes gross development value.",
    unit: "percent",
    group: "Market",
    min: 0,
    max: 0.2,
  },
  {
    key: "salesCommission",
    label: "Selling commission",
    moves: "Taken off every sale before it reaches the cash flow.",
    unit: "percent",
    group: "Market",
    min: 0,
    max: 0.12,
  },
  {
    key: "preDevelopmentMonths",
    label: "Pre-development period",
    moves:
      "Months of approvals before construction starts. Section 4 compares it against the statutory path and reports the gap in holding cost.",
    unit: "months",
    group: "Market",
    min: 0,
    max: 60,
  },
  {
    key: "financeRatePa",
    label: "Development finance rate",
    moves: "Interest on the facility. Runs for every month the money is in the ground.",
    unit: "percent",
    group: "Funding",
    min: 0.01,
    max: 0.4,
  },
  {
    key: "debtPct",
    label: "Debt share",
    moves: "How much of the cost is borrowed. The rest is equity, drawn first.",
    unit: "share",
    group: "Funding",
    min: 0,
    max: 100,
  },
  {
    key: "discountRatePa",
    label: "Discount rate",
    moves:
      "The return a scheme must beat before it counts as a return. Gate 4 fails a scheme whose NPV at this rate is negative.",
    unit: "percent",
    group: "Funding",
    min: 0.01,
    max: 0.5,
  },
];

/** How a value is written on screen. */
export function showAssumption(spec: AssumptionSpec, value: number): string {
  switch (spec.unit) {
    case "percent":
      return `${(value * 100).toFixed(2).replace(".", ",")}%`;
    case "share":
      return `${value}%`;
    case "years":
      return `${value} years`;
    case "months":
      return `${value} months`;
  }
}

/** What a person types, in the unit they think in. */
export const toInput = (spec: AssumptionSpec, value: number): string =>
  spec.unit === "percent" ? String(Number((value * 100).toFixed(4))) : String(value);

/** Back from what they typed. Null where it is not a number, or outside the sane band. */
export function fromInput(spec: AssumptionSpec, typed: string): number | null {
  const raw = Number(typed.trim().replace(",", "."));
  if (!Number.isFinite(raw)) return null;

  const value = spec.unit === "percent" ? raw / 100 : raw;

  /*
    Bounded, because these are typed by hand into a field that decides a verdict.

    Not a judgement about which rate a practice should use — the bands are wide. It is a guard
    against a decimal in the wrong place, which is the error that would silently pass every gate.
  */
  return value >= spec.min && value <= spec.max ? value : null;
}
