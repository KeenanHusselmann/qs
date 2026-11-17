/**
 * Value engineering — the options considered for bringing a cost back to a budget (D1.1).
 *
 * ── A register, not an adjustment ──────────────────────────────────────────────────────────
 *
 * The practice's mapping of the QS scope names it twice: "value engineering if required for
 * budget" before the contract, and "advise on cost savings, i.e. post contract value engineering"
 * after it. Both are the same activity — a list of things that could be changed, what each would
 * save, and what each would cost besides money.
 *
 * The classic way it goes wrong is not arithmetic. A saving is agreed in a meeting, deducted from
 * the estimate, and six months later nobody can say which option it came from, whether the figure
 * was ever measured, or what was given up for it. So nothing here changes a cost plan. An accepted
 * option is a decision to make a change; the change reaches the money when somebody re-measures or
 * re-rates the work, which is a signed step of its own.
 *
 * ── The finding that matters ───────────────────────────────────────────────────────────────
 *
 * A gap closed entirely by options whose savings are estimates is not closed. That is the single
 * most useful thing this can say, and it is invisible in the total: R4 000 000 of accepted savings
 * against a R4 000 000 gap reconciles perfectly whether every figure was measured or every one was
 * somebody's feel for it. So the register reports the gap **and what the gap rests on**.
 */

import type { Money } from "@/domain/money";

export const VALUE_OPTION_STATUSES = ["proposed", "accepted", "rejected", "superseded"] as const;
export type ValueOptionStatus = (typeof VALUE_OPTION_STATUSES)[number];

/**
 * How a saving was arrived at, weakest last.
 *
 * Ordered, because the order is the point: the register reports the weakest basis any accepted
 * option rests on, and "weakest" needs a direction.
 */
export const SAVING_BASES = ["measured", "quotation", "rate", "estimate"] as const;
export type SavingBasis = (typeof SAVING_BASES)[number];

/** How firm each basis is, in the words a quantity surveyor would use to a client. */
export const BASIS_MEANS: Readonly<Record<SavingBasis, string>> = {
  measured: "measured from the drawings",
  quotation: "a supplier's or contractor's price",
  rate: "applied from the rate library",
  estimate: "an estimate nobody has measured",
};

export interface ValueOption {
  id: string;
  number: number;
  element: string | null;
  description: string;
  /** Cents. Positive saves; negative costs more and buys something else. */
  saving: Money;
  basis: SavingBasis;
  /** What it costs besides money. Null where nobody has said. */
  effect: string | null;
  status: ValueOptionStatus;
  raisedBy: string | null;
  decisionReason: string | null;
}

export interface Reconciliation {
  /** What the work is expected to cost now, before any of this. */
  current: Money | null;
  /** What it has to come to. */
  target: Money | null;
  /** target − current. Negative is over budget, which is the case value engineering exists for. */
  gap: Money | null;
  /** Savings on options that have been accepted. */
  accepted: Money;
  /** Savings still only proposed — what is on the table but not decided. */
  proposed: Money;
  /** The gap once the accepted savings are taken. Null where there is no target. */
  remaining: Money | null;
  /** Whether the accepted savings close the gap. Null where there is no target. */
  closed: boolean | null;
}

const ZERO = 0n as Money;
const sum = (options: readonly ValueOption[]): Money => options.reduce((total, o) => (total + o.saving) as Money, ZERO);

/**
 * What the register comes to, against the budget it is trying to reach.
 *
 * `current` and `target` are both optional, because a practice often starts listing options before
 * either is settled — and a register with no target still adds up its own savings. What it cannot
 * do without a target is say whether they are enough, and it says null rather than nought.
 */
export function reconcile(options: readonly ValueOption[], current: Money | null, target: Money | null): Reconciliation {
  const accepted = sum(options.filter((o) => o.status === "accepted"));
  const proposed = sum(options.filter((o) => o.status === "proposed"));
  const gap = current !== null && target !== null ? ((target - current) as Money) : null;
  // The gap is negative when over budget, and a saving is positive, so they add.
  const remaining = gap === null ? null : ((gap + accepted) as Money);

  return {
    current,
    target,
    gap,
    accepted,
    proposed,
    remaining,
    closed: remaining === null ? null : remaining >= 0n,
  };
}

export type Severity = "high" | "medium" | "low";

export interface Finding {
  id: string;
  severity: Severity;
  finding: string;
  matters: string;
  action: string;
}

/**
 * What a quantity surveyor would ask of this register before reporting it closed.
 *
 * Questions, never corrections — the same rule the bill rubric follows. Nothing here rejects an
 * option or changes a figure: an estimate is a legitimate basis early on, and an option with no
 * stated effect may simply be one nobody has written up yet. What is not legitimate is a client
 * being told the budget is met without being told what that rests on.
 */
export function reviewRegister(options: readonly ValueOption[], r: Reconciliation): Finding[] {
  const findings: Finding[] = [];
  const add = (id: string, severity: Severity, finding: string, matters: string, action: string) =>
    findings.push({ id, severity, finding, matters, action });

  const acceptedOptions = options.filter((o) => o.status === "accepted");

  /*
    The gap closed on estimates.

    The finding this file exists for. A reconciliation that balances tells you nothing about how
    firm the figures under it are, and this is exactly the moment a client is told the budget is
    met.
  */
  if (r.closed === true && acceptedOptions.length > 0) {
    const soft = acceptedOptions.filter((o) => o.basis === "estimate");
    if (soft.length > 0) {
      const share = Number(sum(soft)) / Number(sum(acceptedOptions) || 1n);
      add(
        "closed-on-estimates",
        share > 0.5 ? "high" : "medium",
        `The budget is met, and ${soft.length} of the ${acceptedOptions.length} accepted option${acceptedOptions.length === 1 ? "" : "s"} ${soft.length === 1 ? "rests" : "rest"} on an estimate nobody has measured.`,
        "A gap closed by estimates reconciles perfectly and can still be wrong by the whole amount. It is the moment a client is told the budget is met.",
        "Measure or price the accepted options before reporting the budget met, or report it met subject to those figures.",
      );
    }
  }

  // An option that saves money and says nothing about what it costs has not been thought about.
  const silent = options.filter((o) => o.status !== "rejected" && (o.effect === null || o.effect.trim() === ""));
  if (silent.length > 0) {
    add(
      "no-effect-stated",
      "medium",
      `${silent.length} option${silent.length === 1 ? "" : "s"} say${silent.length === 1 ? "s" : ""} nothing about what ${silent.length === 1 ? "it costs" : "they cost"} besides money.`,
      "Every real value engineering option trades something — a finish, a span, a programme, a risk. One with nothing said has either not been thought about or has had its cost left out of the paper.",
      "Say what each one gives up, so the client is choosing rather than just saving.",
    );
  }

  // Over budget, and not enough on the table to fix it even if everything were accepted.
  if (r.gap !== null && r.gap < 0n) {
    const everything = (r.gap + r.accepted + r.proposed) as Money;
    if (everything < 0n) {
      add(
        "not-enough-on-the-table",
        "high",
        "Accepting every option on the register would still leave the project over budget.",
        "A register that cannot close the gap is telling you the answer is not in this list — the design, the scope or the budget has to move.",
        "Put the remainder to the client as a scope or budget decision rather than looking for more savings.",
      );
    }
  }

  // Options that undo each other. Two accepted options on the same element is not wrong, but it is
  // the shape double-counting takes, and the total cannot tell them apart.
  const byElement = new Map<string, ValueOption[]>();
  for (const o of acceptedOptions) {
    if (!o.element) continue;
    byElement.set(o.element, [...(byElement.get(o.element) ?? []), o]);
  }
  const doubled = [...byElement.entries()].filter(([, list]) => list.length > 1);
  if (doubled.length > 0) {
    add(
      "same-element-twice",
      "low",
      `${doubled.length} element${doubled.length === 1 ? " carries" : "s carry"} more than one accepted option: ${doubled.map(([e, list]) => `${e} (${list.length})`).join("; ")}.`,
      "Two savings on the same element are often the same saving counted twice — a cheaper finish and a reduced area of that finish overlap, and the total cannot tell.",
      "Check they are independent, or combine them into one option with one figure.",
    );
  }

  // An accepted option nobody recorded a reason for.
  const unreasoned = acceptedOptions.filter((o) => !o.decisionReason || o.decisionReason.trim() === "");
  if (unreasoned.length > 0) {
    add(
      "no-reason-recorded",
      "low",
      `${unreasoned.length} accepted option${unreasoned.length === 1 ? " has" : "s have"} no reason recorded.`,
      "Value engineering decisions are revisited when the thing that was given up starts to matter, and by then nobody remembers the trade that was made.",
      "Record who wanted it and why, in a sentence.",
    );
  }

  const order = { high: 0, medium: 1, low: 2 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** The weakest basis any accepted option rests on — what the reconciliation is really worth. */
export function weakestBasis(options: readonly ValueOption[]): SavingBasis | null {
  const accepted = options.filter((o) => o.status === "accepted");
  if (accepted.length === 0) return null;
  return accepted.reduce<SavingBasis>(
    (worst, o) => (SAVING_BASES.indexOf(o.basis) > SAVING_BASES.indexOf(worst) ? o.basis : worst),
    SAVING_BASES[0],
  );
}
