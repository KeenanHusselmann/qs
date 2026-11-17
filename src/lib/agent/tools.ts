/**
 * What the advisor can go and work out for itself.
 *
 * ── Not web search, and why ────────────────────────────────────────────────────────────────
 *
 * The obvious external tool is a web search, and this platform has no key for one — so it is not
 * built here, rather than built and left unable to run. When a key exists it slots in beside these
 * as one more entry in `TOOLS`, with one difference that matters: a figure off the web has
 * provenance too, but it is a *source and a date*, not a signature, and it would have to be
 * labelled that way everywhere it appeared.
 *
 * What the platform does have is better for the question a QS actually asks. Four engines, ported
 * and tested, that compute exact answers from figures somebody signed: the affordability envelope,
 * the development cost build-up, the cash flow, and the six gates. A model asked "is this viable?"
 * can now go and find out instead of being agreeable about it.
 *
 * ── A third channel, and the same rule ─────────────────────────────────────────────────────
 *
 * `ask.ts` has two channels: the model's words, which state no figure, and passages from the
 * documents, which do. A tool result is the third, and it earns its figures the same way — by
 * carrying where they came from. Every line names its method and every tool names the signed
 * fields it was computed from. A reader can follow any number here back to a signature.
 *
 * The model still may not state a figure. It says *"the return gate fails"* — a conclusion, which
 * is its job — and the numbers behind that arrive underneath, computed, not asserted.
 *
 * ── Deterministic, so the answer is the same every time ────────────────────────────────────
 *
 * None of these calls a model. They are the same functions the report and the project pages run,
 * so the advisor cannot tell a reader something the report contradicts. That is the whole reason
 * to give a model tools rather than let it reason about figures: reasoning is where it is weakest
 * and arithmetic is where the platform is strongest.
 */

import { affordabilityEnvelope } from "@/domain/affordability";
import { formatRand, money, type Money } from "@/domain/money";
import { projectScenario } from "@/lib/report/scenario";
import { viabilityReport } from "@/lib/report/viability";
import type { SignedStep } from "@/lib/agent/persist";

/** One line of a tool's answer: a figure, and how it was arrived at. */
export interface Finding {
  label: string;
  value: string;
  /** The method, or the signed field. Never absent — a figure without one does not belong here. */
  from: string;
}

export interface ToolResult {
  tool: string;
  title: string;
  findings: Finding[];
  /** What stopped it, where it could not run. The panel says so rather than showing nothing. */
  unavailable: string | null;
}

export interface Tool {
  name: string;
  /** What it answers, in the words the model is choosing between. */
  when: string;
  run: (signed: readonly SignedStep[]) => ToolResult;
}

// One formatter, from `domain/money`. See `formatRand` for what writing it by hand cost.
const R = formatRand;
const pct = (v: number | null) =>
  v === null ? "not established" : `${(v * 100).toFixed(1).replace(".", ",")}%`;

/** Nothing to compute from — said plainly, with what would fix it. */
const cannot = (tool: string, title: string, why: string): ToolResult => ({
  tool,
  title,
  findings: [],
  unavailable: why,
});

export const TOOLS: readonly Tool[] = [
  {
    name: "gates",
    when: "whether the scheme is viable, whether it passes, what is blocking it, go or no-go",
    run: (signed) => {
      const report = viabilityReport(signed);
      const section = report.sections.find((s) => s.no === "11");

      if (!section || section.state !== "established") {
        return cannot(
          "gates",
          "The six gates",
          "No gate could be evaluated. They test signed figures against thresholds, and nothing they need has been signed yet.",
        );
      }

      return {
        tool: "gates",
        title: "The six gates",
        findings: section.rows.map((row) => ({
          label: row.label,
          value: row.value,
          from: row.source ?? "Derived from signed figures",
        })),
        unavailable: null,
      };
    },
  },

  {
    name: "cost",
    when: "what the development costs, cost per unit, the build-up, fees, what is on top of construction",
    run: (signed) => {
      const report = viabilityReport(signed);
      const section = report.sections.find((s) => s.no === "7");

      if (!section || section.state !== "established") {
        return cannot(
          "cost",
          "Development cost build-up",
          "No construction cost has been signed, so there is no build-up to compute.",
        );
      }

      return {
        tool: "cost",
        title: "Development cost build-up",
        // Head and tail: the build-up runs to twenty lines and the panel is a column. The total is
        // the line a reader came for, so it is kept whichever end it falls at.
        findings: [...section.rows.slice(0, 6), ...section.rows.slice(-1)].map((row) => ({
          label: row.label,
          value: row.value,
          from: row.source ?? "Derived",
        })),
        unavailable: null,
      };
    },
  },

  {
    name: "affordability",
    when: "what buyers can afford, the price ceiling, the income band, bond, what the market can finance",
    run: (signed) => {
      const report = viabilityReport(signed);
      const section = report.sections.find((s) => s.no === "2");

      if (!section || section.state !== "established") {
        return cannot(
          "affordability",
          "Affordability envelope",
          "The target household income band has not been signed. It is the binding input — every cost is tested against the price it implies.",
        );
      }

      return {
        tool: "affordability",
        title: "Affordability envelope",
        findings: section.rows.map((row) => ({
          label: row.label,
          value: row.value,
          from: row.source ?? "Derived",
        })),
        unavailable: null,
      };
    },
  },

  {
    name: "cashflow",
    when: "funding, peak funding, interest, IRR, NPV, return, how long it takes to sell, the downside",
    run: (signed) => {
      const scenario = projectScenario(signed);

      if (!scenario) {
        return cannot(
          "cashflow",
          "Cash flow and return",
          "The cash flow needs a signed selling price, absorption rate, programme and unit count. Without all four there is no defensible way to model when money moves.",
        );
      }

      const base = scenario.scenarios.base;

      return {
        tool: "cashflow",
        title: "Cash flow and return",
        findings: [
          {
            label: "Peak funding requirement",
            value: `${R(base.peakFunding)} at month ${base.peakFundingMonth}`,
            from: "Deepest point of the ungeared cash flow",
          },
          {
            label: "Sells out in",
            value: `month ${base.selloutMonth}`,
            from: "Signed absorption rate against the signed unit count",
          },
          {
            label: "Finance cost",
            value: R(base.totalInterest),
            from: "60/40 at prime-plus — a stated assumption, not a signed figure",
          },
          {
            label: "Margin on cost",
            value: pct(base.marginOnCost),
            from: "Derived",
          },
          {
            label: "Equity IRR",
            value: pct(base.equityIrrPa),
            from: "After the debt is repaid",
          },
          {
            label: "NPV to equity",
            value: `${R(base.npvEquityAtHurdle)} at 14%`,
            from: "The levered measure — the unlevered one cannot see the finance cost",
          },
          {
            label: "Most sensitive assumption",
            value: scenario.levers[0]?.variable ?? "not established",
            from: `Moves equity NPV by ${R(scenario.levers[0]?.spread ?? money(0n))}`,
          },
        ],
        unavailable: null,
      };
    },
  },
];

/** What the model is offered, in the prompt. */
export const toolMenu = (): string =>
  TOOLS.map((t) => `- "${t.name}": ${t.when}`).join("\n");

/**
 * Run the tool the model named, or nothing.
 *
 * An unknown name is silently no tool rather than an error: the model choosing badly is a worse
 * answer, not a broken request, and a five-hundred over a mistyped string would lose the reader
 * the passages as well.
 */
export function runTool(name: unknown, signed: readonly SignedStep[]): ToolResult | null {
  const tool = TOOLS.find((t) => t.name === name);
  return tool ? tool.run(signed) : null;
}

/** The tool's answer, as the model is shown it on the second pass. */
export function toolText(result: ToolResult): string {
  if (result.unavailable) {
    return `TOOL "${result.tool}" COULD NOT RUN: ${result.unavailable}`;
  }

  return [
    `TOOL "${result.tool}" — ${result.title}:`,
    ...result.findings.map((f) => `${f.label}: ${f.value} (${f.from})`),
  ].join("\n");
}

/**
 * Affordability from a band, for callers that have one without a whole report.
 *
 * Exported because the envelope is the one engine a caller may reasonably want on its own —
 * §1.3.1's binding input, and the figure everything else is tested against.
 */
export function ceilingFor(bandMin: Money, bandMax: Money, subsidy: Money): Money | null {
  return affordabilityEnvelope({
    incomeBandMin: bandMin,
    incomeBandMax: bandMax,
    primeRatePa: 0.1175,
    lendingMarginPa: 0,
    bondTermYears: 20,
    instalmentToIncomePct: 30,
    deposit: money(0n),
    subsidyQuantum: subsidy,
  }).ceilingPerUnit;
}

/** Names only, for the guard that decides whether a reply asked for something real. */
export const TOOL_NAMES: readonly string[] = TOOLS.map((t) => t.name);

/** A gate result the panel can colour without re-deriving anything. */
export function gatesFailing(result: ToolResult): boolean {
  return result.tool === "gates" && result.findings.some((f) => /fail/i.test(f.value));
}
