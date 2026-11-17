/**
 * The risk register — derived, never invented.
 *
 * ── What this refuses to be ────────────────────────────────────────────────────────────────
 *
 * A generic construction risk matrix writes itself: contractor insolvency, weather delay, labour
 * unrest, material escalation, community disruption. Every one of those is a real risk on a real
 * South African site, and this platform has **no basis whatever** for any of them. It has not seen
 * the contractor, the site or the programme. Printing them would be a page of plausible sentences
 * that survive review looking checked, which §1.3.1 names as worse than a gap.
 *
 * So nothing here is composed. Every entry is derived from something the platform established, and
 * carries where it came from — a failed gate, a lever the sensitivity measured, a required figure
 * nobody signed, an assumption the model rests on. The register ends by naming what it does not
 * cover, because a risk register a reader mistakes for complete is itself the largest risk on it.
 *
 * ── Severity is measured, not judged ───────────────────────────────────────────────────────
 *
 * The usual matrix multiplies a likelihood by an impact, both scored one to five by somebody's
 * feel. The platform cannot feel, and a scored likelihood it invented would be the same fabrication
 * in a numeric costume.
 *
 * What it *can* do is rank by magnitude, which is arithmetic: a lever that moves equity NPV by
 * R86m outranks one that moves it by R23m, and a gate that has already failed outranks both
 * because it is not a risk at all — it is a finding. So entries carry a `kind` that says which of
 * those they are, and within a kind they are ordered by the money.
 */

import { formatRand, money, type Money } from "@/domain/money";
import type { Verdict } from "@/domain/gates";

/**
 * What sort of thing this is, which decides how a reader should treat it.
 *
 * The distinction the usual matrix loses: a failed gate is not a risk to be monitored, it is a
 * fact to be acted on, and putting the two in one column at the same weight is how a No-Go ends
 * up filed beside a note about the weather.
 */
export type RiskKind = "realised" | "exposure" | "unquantified" | "assumption";

export interface Risk {
  kind: RiskKind;
  /** What it is, in the reader's terms. */
  title: string;
  /** What it means for the scheme. */
  effect: string;
  /** Where this came from. Never absent — an entry without one does not belong here. */
  from: string;
  /** What to do. Null where there is nothing to do but know it. */
  action: string | null;
  /** For ordering within a kind. Money where there is money; zero where the risk is not sized. */
  magnitude: Money;
}

export interface RiskInputs {
  verdict: Verdict;
  /** The tornado, widest first. */
  levers: readonly { variable: string; range: string; spread: Money }[];
  /** The cash-flow model's own findings about itself. */
  warnings: readonly string[];
  /** Required figures with nobody's signature behind them. */
  unsigned: readonly string[];
  /** Lines the build-up assumed rather than read. */
  assumptions: readonly string[];
}

const KIND_ORDER: Record<RiskKind, number> = {
  realised: 0,
  exposure: 1,
  unquantified: 2,
  assumption: 3,
};

export function riskRegister(inputs: RiskInputs): Risk[] {
  const risks: Risk[] = [];

  /*
    ── Failed gates first, and called what they are ────────────────────────────────────────

    A gate that has failed is not a risk. It has happened. It leads the register because it is the
    thing to act on, and it is labelled `realised` so nobody reads it as something that might yet
    be avoided.
  */
  for (const gate of inputs.verdict.gates) {
    if (gate.state !== "fail") continue;

    risks.push({
      kind: "realised",
      title: `Gate ${gate.no} — ${gate.name}`,
      effect: gate.finding,
      from: `Tested against ${gate.threshold}`,
      action: gate.recommendation,
      magnitude: money(0n),
    });
  }

  /*
    ── What the answer is hostage to ───────────────────────────────────────────────────────

    Straight off the sensitivity, in the order it produced. The spread is the exposure in money,
    which is the only honest severity available: it is measured, not scored.
  */
  for (const lever of inputs.levers) {
    risks.push({
      kind: "exposure",
      title: `${lever.variable} moves ${lever.range}`,
      effect: `Equity NPV moves by ${formatRand(lever.spread)} across that range.`,
      from: "Sensitivity analysis — each input moved on its own",
      action:
        lever === inputs.levers[0]
          ? "The widest bar on the tornado. This is the assumption worth the most diligence before committing."
          : null,
      magnitude: lever.spread,
    });
  }

  /*
    ── What the model said about itself ────────────────────────────────────────────────────

    The cash flow raises its own findings — a sell-out beyond eight years, a horizon that ran out
    before the units did. They are risks in the ordinary sense and the platform did establish them,
    so they belong here rather than only in a caption nobody scrolls to.
  */
  for (const warning of inputs.warnings) {
    risks.push({
      kind: "exposure",
      title: "Absorption and programme",
      effect: warning,
      from: "The cash-flow model, on signed absorption and programme",
      action: null,
      magnitude: money(0n),
    });
  }

  /*
    ── Figures nobody has established ──────────────────────────────────────────────────────

    An unsigned required figure is a risk of a specific and under-appreciated kind: it is not that
    the number might be bad, it is that there is no number, so everything downstream of it is not
    conservative — it is absent. Gates depending on it report as not evaluated, and a reader
    skimming a register of passes could take that for a pass.
  */
  for (const field of inputs.unsigned) {
    risks.push({
      kind: "unquantified",
      title: `${field} is not established`,
      effect:
        "Nothing downstream of it can be tested. A gate that depends on it reports as not evaluated, which is not the same as passed.",
      from: "No signed figure on this project",
      action: `File the document that states it, run the step, and sign it.`,
      magnitude: money(0n),
    });
  }

  /*
    ── What the platform assumed ───────────────────────────────────────────────────────────

    Fee percentages, escalation, commission, the funding structure. Each is defensible and each is
    the platform's, not the client's. A reader who takes an assumption for a signed figure is
    carrying a risk they do not know they hold, and that is the whole reason these are listed.
  */
  for (const assumption of inputs.assumptions) {
    risks.push({
      kind: "assumption",
      title: assumption,
      effect: "Stated by the platform on a declared basis, not read from a signed document.",
      from: "Assumption",
      action: null,
      magnitude: money(0n),
    });
  }

  return risks.sort((a, b) => {
    const byKind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (byKind !== 0) return byKind;
    return b.magnitude > a.magnitude ? 1 : b.magnitude < a.magnitude ? -1 : 0;
  });
}

/**
 * What the register does not cover, said plainly.
 *
 * The most dangerous risk register is one a reader takes for complete. This platform has not seen
 * the site, the contractor or the programme, so the entire category of delivery risk is outside
 * it — and a page headed "Risk matrix" invites exactly the assumption that it is not.
 */
export const RISK_SCOPE =
  "This register is derived from what the platform established on this project: gates that failed, " +
  "inputs the sensitivity measured, figures nobody has signed, and lines the build-up assumed. It " +
  "contains nothing composed. It therefore does not cover delivery risk — contractor, site, labour, " +
  "weather, community — none of which this platform has seen. Those belong in a risk register kept " +
  "by the people who have.";

/** How a reader should treat each kind, in one word each. */
export const KIND_LABEL: Readonly<Record<RiskKind, string>> = {
  realised: "Already failing",
  exposure: "Sensitivity",
  unquantified: "Not established",
  assumption: "Assumption",
};
