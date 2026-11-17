/**
 * The QS Viability Report — v3's structure, sourced from this platform's signed runs.
 *
 * ── The section order is v3's, and it is not arbitrary ─────────────────────────────────────
 *
 * Affordable housing is constraint-led, so the report opens with the affordability envelope and
 * only then reaches cost: the price ceiling is the binding input and every figure after it is
 * tested against it. Putting the cost estimate first would be a developer's report, which reads
 * the other way round — what it costs, then what it must sell for to work.
 *
 * ── Every section says where it comes from ─────────────────────────────────────────────────
 *
 * A section is in one of three states, and the difference is the whole point of the document:
 *
 *   `established`  — built from figures a named person signed. It carries the run and the date.
 *   `unsigned`     — the step exists and has not been signed off, so its figures are not approved
 *                    data and do not appear. The section names the step.
 *   `awaiting`     — the platform cannot produce this yet. It names what is missing.
 *
 * §1.3.1: a figure that cannot be traced is worse than a gap, because it survives review looking
 * checked. A viability report is precisely the document where that matters, so a section with
 * nothing behind it says so rather than being quietly omitted — an absent section reads as an
 * oversight, and a stated one reads as a finding.
 *
 * ── Why the engine sections are `awaiting` rather than absent ──────────────────────────────
 *
 * v3 computes eight of these twelve from a financial engine — the affordability envelope, the
 * B1–B7 cost build-up, the six gates, the scenarios. That engine is being ported (see
 * `domain/affordability.ts`, the first piece). Until each piece lands, the section it fills is
 * listed with the reason, so the shape of the finished document is visible from the first day
 * rather than appearing all at once at the end.
 */

import { affordabilityEnvelope } from "@/domain/affordability";
import { readAmount, readQuantity } from "@/domain/amount";
import { costStack, type CostLine } from "@/domain/cost-stack";
import { evaluateGates, type Verdict } from "@/domain/gates";
import { riskRegister, KIND_LABEL, RISK_SCOPE } from "@/domain/risk";
import { approvalProgramme, APPROVAL_SCOPE } from "@/domain/approvals";
import { AFFORDABLE_HURDLES, DEFAULT_FUNDING } from "@/domain/cashflow";
import { cumulativeCurves, projectScenario, scenarioGaps } from "@/lib/report/scenario";
import { DEFAULT_ASSUMPTIONS, type Assumptions } from "@/lib/assumption-set";
import { formatMoney, formatRand, money, type Money } from "@/domain/money";
import { labelOf } from "@/lib/chain";
import type { SignedStep } from "@/lib/agent/persist";
import { FEASIBILITY_FIELDS } from "@/lib/agent/run";

export type SectionState = "established" | "unsigned" | "awaiting";

export interface ReportRow {
  label: string;
  value: string;
  /** The document and passage the figure was read from, where it had one. */
  source: string | null;
}

export interface ReportSection {
  /** v3's numbering — kept, because it is how the document is referred to in a meeting. */
  no: string;
  title: string;
  state: SectionState;
  /** Why it is not established, in the reader's terms. Only when it is not. */
  reason: string | null;
  rows: ReportRow[];
  /** The step whose signature established it, for the trace line. */
  from?: { module: string; by: string; at: string; note?: string | null };
}

/**
 * What the cover leads with.
 *
 * The scheme and the conclusion — not how much of the document the platform managed to fill in.
 * A cover reading "10 of 12 sections established" is the platform talking about itself to a
 * reader who came to find out whether to build a thousand homes.
 */
export interface Headline {
  /** The scheme's size, as a reader thinks of it. */
  units: number | null;
  construction: Money | null;
  /** Go / Conditional / No-Go, or null while a gate is untested. */
  verdict: "go" | "conditional" | "no-go" | null;
  /** What is binding, named. Null where nothing fails. */
  binding: string | null;
  /** The one sentence the whole document comes to. */
  sentence: string;
}

/**
 * What the report draws, where the cash flow could be run.
 *
 * Built here rather than in the PDF because the scenario is already computed here for sections 8
 * and 9 — and a second construction would be a second model, which is how a chart comes to
 * disagree with the table above it.
 */
export interface ReportCharts {
  /** Cumulative cost and revenue by month, in minor units. */
  cost: number[];
  revenue: number[];
  /** The tornado, widest lever first, relative to the base case. */
  levers: { label: string; low: number; high: number; shown: string }[];
}

export interface ViabilityReport {
  headline: Headline;
  /** Null where the four cash-flow inputs are not all signed. */
  charts: ReportCharts | null;
  sections: ReportSection[];
  /** How much of the document is actually established, for the control page. */
  established: number;
  total: number;
}

/** Which module supplies which section, where a section is read straight off signed figures. */
const SOURCE: Readonly<Record<string, string>> = {
  "3": "/feasibility",
  "5": "/feasibility",
  "6": "/cost-plan",
};

/** The fields each sourced section shows, in the order the report reads them. */
const FIELDS: Readonly<Record<string, readonly string[]>> = {
  "3": ["erf", "zoning", "units", "mix", "unit-area"],
  "5": ["bulk", "subsidy"],
  "6": [
    "cp-basis",
    "cp-substructure",
    "cp-superstructure",
    "cp-finishes",
    "cp-services",
    "cp-external-works",
    "cp-preliminaries",
    "cp-contingency",
    "cp-escalation",
    "cp-total",
  ],
};

/**
 * The engine each unbuilt section is waiting on.
 *
 * Named as the module that will produce it rather than as "coming soon": a reader who is told what
 * is missing can judge how much of the document they are holding, and a reader told "soon" cannot.
 */
const AWAITING: Readonly<Record<string, string>> = {};

/**
 * Why sections 8 and 9 cannot run, naming the inputs that stop them.
 *
 * It used to be one fixed sentence listing all four inputs whatever was missing, so a project with
 * three signed and one unreadable was told it lacked all four. Now each gap is named, with the
 * figure as signed where there is one, so the QS knows which field to correct.
 */
function awaitingCashFlow(gaps: readonly string[]): string {
  if (gaps.length === 0) return "The cash flow could not be built from the signed figures.";
  return (
    `The cash flow needs a signed selling price, absorption rate, programme and unit count, and a signed cost plan total. Missing or unreadable: ${gaps.join("; ")}. ` +
    "A signed run is frozen, so run the step again, correct the figure on its row and sign it."
  );
}

/** A rate as a percentage, with the comma decimal this document uses everywhere. */
const percent = (rate: number) => `${(rate * 100).toFixed(2).replace(/\.?0+$/, "").replace(".", ",")}%`;

const TITLES: readonly (readonly [string, string])[] = [
  ["0", "Report control page"],
  ["1", "Executive summary"],
  ["2", "Affordability envelope – the binding input"],
  ["3", "Site and statutory parameters"],
  ["4", "Statutory approval programme and holding cost"],
  ["5", "Bulk services and development charges"],
  ["6", "Elemental cost estimate"],
  ["7", "Total development cost build-up"],
  ["8", "Financial viability"],
  ["9", "Sensitivity and scenario analysis"],
  ["10", "Risk matrix"],
  ["11", "Conclusion and recommendation"],
];

/**
 * Build the report from what the project has signed.
 *
 * Takes the signed steps rather than a project id: the caller has already read them for the page
 * around it, and a function that issued its own query would read the same rows twice and could
 * disagree with the page it sits on.
 */
/** A signed figure by field id, across every signed step. */
function figure(signed: readonly SignedStep[], fieldId: string): string | null {
  for (const step of signed) {
    const found = step.fields.find((f) => f.fieldId === fieldId);
    if (found) return found.value;
  }
  return null;
}

/**
 * The two ends of a signed income band.
 *
 * A band is written as prose — "households earning between R8 000 and R30 000 per month" — so
 * both figures are read out of the one field rather than asking a QS to sign two. Where only one
 * figure is stated the band has no width, which is a single income and a legitimate answer.
 *
 * Returns null when nothing can be read with certainty. An envelope computed from a
 * half-understood band would produce a ceiling that looks authoritative and is not.
 */
function incomeBand(signed: readonly SignedStep[]): { min: Money; max: Money } | null {
  const raw = figure(signed, "income-band");
  if (raw === null) return null;

  const amounts = (raw.match(/R\s?[\d\u00a0 .,]+/g) ?? [])
    .map((piece) => readAmount(piece))
    .flatMap((reading) => (reading.ok ? [reading.amount] : []));

  if (amounts.length === 0) return null;

  const sorted = [...amounts].sort((a, b) => (a > b ? 1 : a < b ? -1 : 0));
  return { min: sorted[0], max: sorted[sorted.length - 1] };
}

/**
 * The lending assumptions used to live here as a constant.
 *
 * They are the practice's now — `lib/assumption-set.ts` defines them and `assumptions.ts` reads
 * what has been set. The defaults are unchanged, so a practice that sets nothing gets exactly what
 * this file used to hard-code; the difference is that the report can now say whose figure it is.
 */

/**
 * The development cost build-up — section 7 — from what the project has signed.
 *
 * `readAmount` rather than a parse: it refuses a qualified figure rather than guessing at one,
 * so a cost plan total reading "R466 600 000 excluding VAT" produces no build-up instead of a
 * build-up that is short by the VAT nobody accounted for.
 */
/** A signed figure read as money, or nothing where it cannot be read with certainty. */
function readMoney(signed: readonly SignedStep[], fieldId: string): Money | null {
  const raw = figure(signed, fieldId);
  if (raw === null) return null;
  const reading = readAmount(raw);
  return reading.ok ? reading.amount : null;
}

function developmentCost(signed: readonly SignedStep[]) {
  const readMoneyHere = (fieldId: string) => {
    const raw = figure(signed, fieldId);
    if (raw === null) return null;
    const reading = readAmount(raw);
    return reading.ok ? reading.amount : null;
  };

  const units = (() => {
    const raw = figure(signed, "cp-units") ?? figure(signed, "units");
    if (raw === null) return null;
    const reading = readQuantity(raw);
    return reading.ok ? Math.round(Number(reading.quantity) / 10_000) : null;
  })();

  return costStack({
    construction: readMoneyHere("cp-total"),
    // Whether the signed plan already carries them, asked rather than assumed — assuming it
    // either way is how a contingency gets counted twice or not at all.
    constructionCarriesContingency:
      figure(signed, "cp-contingency") !== null || figure(signed, "cp-escalation") !== null,
    landValue: null,
    vatVendor: false,
    bulkContribution: readMoneyHere("bulk"),
    units,
    averageHomeValue: readMoneyHere("selling-price"),
    statedFeePercent: null,
  });
}

/** How a build-up line says where its figure came from. */
const PROVENANCE: Readonly<Record<CostLine["provenance"], string>> = {
  signed: "Signed",
  derived: "Derived",
  assumption: "Assumption",
};

/**
 * What the gates add up to, in one sentence.
 *
 * It refuses to say Go while a gate is untested, and says why. A verdict computed from half the
 * gates and printed as a verdict is the most expensive sentence this platform could produce — it
 * would read as "feasible" on a scheme nobody has tested for fundability.
 */
function verdictSentence(verdict: Verdict): string {
  if (verdict.overall === "no-go") {
    return (
      `Gate ${verdict.firstFailing} fails: ${verdict.bindingConstraint}. That is the binding ` +
      "constraint and the most valuable thing to change – a gate is a rule, so a scheme that " +
      "fails one is not partly feasible."
    );
  }

  if (verdict.overall === "go") {
    return "Every gate passed.";
  }

  return (
    `${verdict.evaluated} of ${verdict.total} gates evaluated, and every one of them passed. No ` +
    "verdict is stated: funding, return and resilience need the scenario model, and a scheme " +
    "nobody has tested for fundability must not be reported as feasible."
  );
}

/**
 * Money with its sign in front of the R, not after it.
 *
 * `R -64 665 533,31` is what a naive template produces and it is not how anybody writes money;
 * the sign belongs to the amount, so it goes first. Sensitivity ranges are the only place on this
 * report that carry negatives, and they carry a lot of them.
 */
function signedMoney(amount: Money): string {
  // `formatRand` is the one definition. This wrapper stays only because the call sites read better
  // with a name that says what the problem was.
  return formatRand(amount);
}

/**
 * A range figure in millions.
 *
 * Full cents on a sensitivity range put three long numbers in one cell, which wrapped into the
 * source column and read as one run-on string. A tornado is a statement about magnitude — the
 * cents are noise in it, and the precision is available in the model for anyone who needs it.
 */
function inMillions(amount: Money): string {
  const m = Number(amount) / 100 / 1e6;
  const sign = m < 0 ? "−" : "";
  // Comma decimal separator — §7.7, and the same figure appears two lines above as
  // "R 574 832 147,84". Two separators in one table reads as two different documents.
  return `${sign}R ${Math.abs(m).toFixed(1).replace(".", ",")}m`;
}

/** The two charts, from the scenario, or nothing where it could not be run. */
function chartsFor(scenario: ReturnType<typeof projectScenario>): ReportCharts | null {
  if (!scenario) return null;

  const curves = cumulativeCurves(scenario);
  const base = Number(scenario.scenarios.base.npvEquityAtHurdle);

  return {
    ...curves,
    /*
      Relative to the base case, so the bars run either side of zero rather than all being one
      length from the origin. A tornado's whole shape is the distance travelled, not the level.
    */
    levers: scenario.levers.map((lever) => ({
      label: `${lever.variable} ${lever.range}`,
      low: Number(lever.low) - base,
      high: Number(lever.high) - base,
      shown: inMillions(lever.spread),
    })),
  };
}

export function viabilityReport(
  signed: readonly SignedStep[],
  /*
    The practice's assumptions, where it has set any.

    Defaulted, so a caller that does not care — every unit test, the PDF fixture — gets the
    platform's own figures without reaching for a database. The report states which set it used;
    see the basis section.
  */
  assumed: Assumptions = DEFAULT_ASSUMPTIONS,
): ViabilityReport {
  const byModule = new Map(signed.map((step) => [step.module, step]));
  const stack = developmentCost(signed);

  /**
   * The gates, from what is signed.
   *
   * Cost per unit is the *development* cost, not the construction cost — Gate 1 asks whether a
   * buyer can finance the thing, and a buyer finances the whole of it. Testing construction cost
   * against the ceiling would clear a scheme that fails the moment fees and statutory land on it.
   */
  const band = incomeBand(signed);

  const units = (() => {
    const raw = figure(signed, "cp-units") ?? figure(signed, "units");
    if (raw === null) return null;
    const reading = readQuantity(raw);
    return reading.ok ? Math.round(Number(reading.quantity) / 10_000) : null;
  })();

  const ceiling =
    band === null
      ? null
      : affordabilityEnvelope({
          incomeBandMin: band.min,
          incomeBandMax: band.max,
          primeRatePa: assumed.primeRatePa,
          lendingMarginPa: assumed.lendingMarginPa,
          bondTermYears: assumed.bondTermYears,
          instalmentToIncomePct: assumed.instalmentToIncomePct,
          deposit: money(0n),
          subsidyQuantum: readMoney(signed, "subsidy") ?? money(0n),
        }).ceilingPerUnit;

  /*
    The cash flow, where this project has signed enough to run one.

    Built once and shared: sections 8 and 9 read it, and gates 3, 4 and 5 are evaluated from it.
    Two separate constructions would be two models, and the section and the gate that disagreed
    would both look authoritative.
  */
  const scenario = projectScenario(signed, assumed);

  const verdict = evaluateGates({
    scenarios: scenario?.scenarios ?? null,
    affordabilityCeiling: ceiling,
    costPerUnit:
      stack.totalDevelopmentCost !== null && units !== null && units > 0
        ? money(stack.totalDevelopmentCost / BigInt(units))
        : null,
    bulk: readMoney(signed, "bulk"),
    units,
    incomeBandMax: band?.max ?? null,
  });

  const sections = TITLES.map(([no, title]): ReportSection => {
    // ── 0 — the control page, which is established as soon as anything is ────────────────
    if (no === "0") {
      const rows = signed.map((step) => ({
        label: labelOf(step.module),
        value: `Signed by ${step.by}`,
        source: null,
      }));

      return {
        no,
        title,
        state: signed.length > 0 ? "established" : "unsigned",
        reason: signed.length > 0 ? null : "Nothing on this project has been signed off yet.",
        rows,
      };
    }

    // ── 11 — the gates, and what they say ────────────────────────────────────────────
    if (no === "11") {
      if (verdict.evaluated === 0) {
        return {
          no,
          title,
          state: "unsigned",
          reason:
            "No gate could be evaluated. They test signed figures against thresholds, and nothing they need has been signed yet.",
          rows: [],
        };
      }

      const rows: ReportRow[] = verdict.gates.map((gate) => ({
        label: `Gate ${gate.no}  ${gate.name}`,
        value:
          gate.state === "pass" ? "Passed" : gate.state === "fail" ? "Failed" : "Not evaluated",
        source: gate.finding,
      }));

      return {
        no,
        title,
        state: "established",
        reason: verdictSentence(verdict),
        rows,
      };
    }

    // ── 1 — the executive summary, written from the verdict ──────────────────────────
    if (no === "1") {
      if (verdict.evaluated === 0) {
        return {
          no,
          title,
          state: "unsigned",
          reason:
            "The summary is written from the gates, and none could be evaluated yet.",
          rows: [],
        };
      }

      const rows: ReportRow[] = [
        {
          label: "Gates evaluated",
          value: `${verdict.evaluated} of ${verdict.total}`,
          /*
            What the unevaluated gates are waiting on, read off the gates themselves.

            This line used to say "the rest need the scenario model", which was true until the
            model was ported and then quietly stopped being true — on this project the model runs
            and the gates that cannot be evaluated are waiting on a signed income band instead.
            A hard-coded reason is a second record of the same fact, and it is the one that rots.
          */
          source:
            verdict.evaluated === verdict.total
              ? "Derived"
              : `Derived – ${verdict.gates
                  .filter((gate) => gate.state === "not-evaluated")
                  .map((gate) => gate.name.toLowerCase())
                  .join(", ")} could not be tested`,
        },
        {
          label: "Gates passed",
          value: String(verdict.gates.filter((gate) => gate.state === "pass").length),
          source: "Derived",
        },
        {
          label: "Binding constraint",
          value: verdict.bindingConstraint ?? "None of the gates evaluated is binding",
          source: verdict.firstFailing === null ? "Derived" : `Gate ${verdict.firstFailing}`,
        },
      ];

      return {
        no,
        title,
        state: "established",
        reason: verdictSentence(verdict),
        rows,
      };
    }

    // ── 2 — the affordability envelope ───────────────────────────────────────────────
    if (no === "2") {
      const band = incomeBand(signed);

      if (band === null) {
        return {
          no,
          title,
          state: "unsigned",
          reason:
            "The target household income band has not been signed. It is the binding input – every cost is tested against the price it implies – so nothing below it can be established without it.",
          rows: [],
        };
      }

      const subsidy = readMoney(signed, "subsidy") ?? money(0n);

      const envelope = affordabilityEnvelope({
        incomeBandMin: band.min,
        incomeBandMax: band.max,
        primeRatePa: assumed.primeRatePa,
        lendingMarginPa: assumed.lendingMarginPa,
        bondTermYears: assumed.bondTermYears,
        instalmentToIncomePct: assumed.instalmentToIncomePct,
        deposit: money(0n),
        subsidyQuantum: subsidy,
      });

      const rows: ReportRow[] = [
        {
          label: "Target household income",
          value: `R\u00a0${formatMoney(band.min)} to R\u00a0${formatMoney(band.max)} a month`,
          source: "Signed",
        },
        {
          label: "Bond assumptions",
          value: `${(assumed.primeRatePa * 100).toFixed(2).replace(".", ",")}% over ${assumed.bondTermYears} years, ${assumed.instalmentToIncomePct}% of income`,
          source: "The practice's stated assumption – a market rate is not a figure in the documents",
        },
        {
          label: "Supportable bond",
          value: `R\u00a0${formatMoney(envelope.supportableBondMin)} to R\u00a0${formatMoney(envelope.supportableBondMax)}`,
          source: "Derived – present value of the qualifying instalment",
        },
        ...(subsidy > 0n
          ? [
              {
                label: "Subsidy quantum",
                value: `R\u00a0${formatMoney(subsidy)}`,
                source: "Signed",
              },
            ]
          : []),
        {
          label: "Affordability ceiling per unit",
          value: `R\u00a0${formatMoney(envelope.ceilingPerUnit)}`,
          source: "Derived – the top of the band, plus deposit and subsidy",
        },
      ];

      return {
        no,
        title,
        state: "established",
        reason:
          "The ceiling is the top of the band: a scheme priced above it cannot be financed by " +
          "anyone in its own target market. Every cost in this report is tested against it.",
        rows,
      };
    }

    // ── 7 — the development cost build-up ────────────────────────────────────────────
    if (no === "7") {
      if (stack.totalDevelopmentCost === null) {
        return {
          no,
          title,
          state: "unsigned",
          reason: stack.notes[0] ?? "No construction cost has been signed.",
          rows: [],
        };
      }

      const rows: ReportRow[] = stack.lines.map((line) => ({
        label: `${line.code}  ${line.description}`,
        value: `R\u00a0${formatMoney(line.amount)}`,
        // A line whose basis is simply that it was signed says so once, not twice.
        source:
          line.basis === "Signed"
            ? PROVENANCE[line.provenance]
            : `${PROVENANCE[line.provenance]} – ${line.basis}`,
      }));

      rows.push({
        label: "Total development cost",
        value: `R\u00a0${formatMoney(stack.totalDevelopmentCost)}`,
        source: "The sum of the lines above",
      });

      return {
        no,
        title,
        state: "established",
        // The notes are how the build-up says what it left out and what it counted once.
        reason: stack.notes.length > 0 ? stack.notes.join(" ") : null,
        rows,
      };
    }

    /*
      ── 4 — the approval path, and what waiting on it costs ─────────────────────────────

      Nothing is built until the approvals are through, and the land and statutory charges are
      committed long before that. On thin affordable-housing margins the holding cost over that
      period is frequently what decides viability, and it is the cost most often left out because
      it appears in no cost plan and nobody invoices for it.

      The lead times are a dated reference table, like the SARS and NHBRC schedules. What the
      section will not say is where *this* project stands in the sequence — that is a programme
      somebody signs, and none has been.
    */
    if (no === "4") {
      /*
        Nothing signed, no approval path.

        The register is a reference table and needs no signature, so this section would establish
        itself on an empty project — a statutory programme for a scheme that does not exist. The
        rule the whole document runs on is that a section is established from figures somebody
        signed; a table the platform brought with it does not make a report about anybody's job.
      */
      if (signed.length === 0) {
        return {
          no,
          title,
          state: "unsigned",
          reason:
            "Nothing has been signed, so there is no scheme to state an approval path for. The " +
            "path itself is a standard one and appears here as soon as the project has figures.",
          rows: [],
        };
      }

      const programme = approvalProgramme({
        committedUpFront: stack.land !== null && stack.statutory !== null
          ? money(stack.land + stack.statutory + stack.bulk)
          : null,
        holdingRatePa: assumed.primeRatePa,
        modelledPreDevelopmentMonths: assumed.preDevelopmentMonths,
      });

      const rows: ReportRow[] = programme.steps.map((step) => ({
        label: step.approval,
        value: `${step.leadMonths} months · complete by month ${step.finishMonth}`,
        source: step.note,
      }));

      rows.push({
        label: "Critical path to construction",
        value: `${programme.criticalPathMonths} months`,
        source: "The longest chain through the register – what actually decides when work can start",
      });

      if (programme.holdingCost !== null) {
        rows.push({
          label: "Holding cost over that period",
          value: signedMoney(programme.holdingCost),
          source: `Committed land, bulk and statutory carried at ${(assumed.primeRatePa * 100).toFixed(2).replace(".", ",")}% – the practice's stated assumption`,
        });
      }

      return {
        no,
        title,
        state: "established",
        reason: programme.divergence
          ? `${APPROVAL_SCOPE} ${programme.divergence}`
          : APPROVAL_SCOPE,
        rows,
      };
    }

    /*
      ── 10 — the risk register, derived and never composed ──────────────────────────────

      A generic construction risk matrix writes itself and would be a page of plausible sentences
      this platform has no basis for. Every entry here comes from something it established: a gate
      that failed, a lever the sensitivity measured, a required figure nobody signed, a line the
      build-up assumed. The section ends by naming what it does not cover, because a register a
      reader takes for complete is the largest risk on it.
    */
    if (no === "10") {
      const risks = riskRegister({
        verdict,
        levers: scenario?.levers ?? [],
        warnings: scenario?.scenarios.base.warnings ?? [],
        /*
          Required feasibility figures with nothing signed behind them.

          Read off the field specs rather than listed here — a second list would fall out of step
          with the run panel the first time a field was added, and the register would quietly stop
          reporting the gap it exists to report.
        */
        unsigned: FEASIBILITY_FIELDS.filter(
          (field) => field.required && figure(signed, field.id) === null,
        ).map((field) => field.label),
        /*
          The assumed lines, with the basis that makes each defensible.

          "Professional fees" alone would read as a gap; "B5.1 Architect — 2.25% of construction"
          reads as a choice somebody can argue with, which is what an assumption on a report is
          for. Capped, because thirteen fee lines is a list rather than a risk.
        */
        assumptions: stack.lines
          .filter((line) => line.provenance === "assumption")
          .slice(0, 6)
          .map((line) => `${line.code} ${line.description} – ${line.basis}`),
      });

      /*
        Nothing signed, nothing derived.

        With an empty project the register would list every required field as unquantified and
        call itself established — which is not a risk register, it is the readiness checklist in a
        different hat. A risk is derived *from* something the platform established; the absence of
        everything is a different fact, and the checklist is where it belongs.
      */
      if (signed.length === 0 || risks.length === 0) {
        return {
          no,
          title,
          state: "unsigned",
          reason:
            "Nothing has been signed, so there is nothing to derive a risk from. This register is " +
            "built from established figures and composes none of its own.",
          rows: [],
        };
      }

      return {
        no,
        title,
        state: "established",
        reason: RISK_SCOPE,
        rows: risks.map((risk) => ({
          label: `${KIND_LABEL[risk.kind]} – ${risk.title}`,
          value: risk.effect,
          source: risk.action ? `${risk.from}. ${risk.action}` : risk.from,
        })),
      };
    }

    // ── 8 — financial viability, from the cash flow ──────────────────────────────────
    if (no === "8" && scenario) {
      const base = scenario.scenarios.base;
      // Comma decimal separator, as everywhere else in this document.
      const pct = (v: number | null) =>
        v === null ? "Not established" : `${(v * 100).toFixed(1).replace(".", ",")}%`;
      // Defaulted exactly as the model defaults them, so the words name the figures it ran on.
      const funding = scenario.inputs.funding ?? DEFAULT_FUNDING;
      const hurdles = scenario.inputs.hurdles ?? AFFORDABLE_HURDLES;

      return {
        no,
        title,
        state: "established",
        /*
          The sentence a nominal margin hides.

          A long sell-out earns a large margin and can still destroy value, because the money was
          out for a decade. Saying both figures side by side, with the sell-out that explains
          them, is the difference between a viability section and a flattering one.
        */
        /*
          The assumption figures come from the inputs the model ran on, not from literals. They were
          written in as "5%", "3%", "60/40" and "14%" – the platform's defaults – so a practice that
          set its own assumptions got a report whose words contradicted its figures.
        */
        reason:
          `Modelled over ${base.months} months on a single-phase programme, selling out in month ` +
          `${base.selloutMonth}. Escalation at ${percent(scenario.inputs.priceEscalationPa)} a year and ` +
          `${percent(scenario.inputs.salesCommission)} selling commission are stated assumptions, not signed figures.`,
        rows: [
          {
            label: "Peak funding requirement",
            value: `R ${formatMoney(base.peakFunding)} at month ${base.peakFundingMonth}`,
            source: "Derived – deepest point of the ungeared cash flow",
          },
          {
            label: "Finance cost over the programme",
            value: `R ${formatMoney(base.totalInterest)}`,
            source: `Derived – ${funding.debtPct}/${funding.equityPct} debt to equity at ${percent(funding.interestRatePa)}, a stated assumption`,
          },
          {
            label: "Gross development value",
            value: `R ${formatMoney(base.totalRevenue)}`,
            source: "Derived – signed price on the signed absorption rate, escalated",
          },
          {
            label: "Total cost including finance",
            value: `R ${formatMoney(base.totalCostInclFinance)}`,
            source: "Derived",
          },
          {
            label: "Profit",
            value: `${signedMoney(base.profit)} – ${pct(base.marginOnCost)} on cost`,
            source: "Derived",
          },
          {
            label: "Equity IRR",
            value: pct(base.equityIrrPa),
            source: "Derived – after debt is repaid",
          },
          {
            label: "NPV to equity",
            value: `${signedMoney(base.npvEquityAtHurdle)} at ${percent(hurdles.discountRatePa)}`,
            source: "Derived – the levered measure; the unlevered one cannot see the finance cost",
          },
        ],
      };
    }

    // ── 9 — sensitivity, which is the section a financier reads first ────────────────
    if (no === "9" && scenario) {
      const { downside, upside, base } = scenario.scenarios;

      return {
        no,
        title,
        state: "established",
        reason:
          `Each input moved on its own against equity NPV. ${scenario.levers[0].variable} moves ` +
          `the answer furthest, so it is the assumption worth the most diligence. The downside ` +
          `moves four together – price −10%, build +10%, slowest absorption, rate +2 points – ` +
          `because in a downturn they arrive together.`,
        rows: [
          ...scenario.levers.map((lever) => ({
            label: `${lever.variable} ${lever.range}`,
            value: `${inMillions(lever.low)} to ${inMillions(lever.high)}`,
            source: `Moves equity NPV by ${inMillions(lever.spread)}`,
          })),
          {
            label: "Downside case",
            value: `${(downside.marginOnCost * 100).toFixed(1).replace(".", ",")}% margin, sells out in month ${downside.selloutMonth}`,
            source: "Derived – four adverse moves together",
          },
          {
            label: "Upside case",
            value: `${(upside.marginOnCost * 100).toFixed(1).replace(".", ",")}% margin, sells out in month ${upside.selloutMonth}`,
            source: "Derived – price +5% and faster absorption; no cost saving assumed",
          },
          {
            label: "Base case",
            value: `${(base.marginOnCost * 100).toFixed(1).replace(".", ",")}% margin, sells out in month ${base.selloutMonth}`,
            source: "Derived",
          },
        ],
      };
    }

    if ((no === "8" || no === "9") && !scenario) {
      return { no, title, state: "awaiting", reason: awaitingCashFlow(scenarioGaps(signed)), rows: [] };
    }

    const sourced = SOURCE[no];

    if (!sourced) {
      return { no, title, state: "awaiting", reason: AWAITING[no] ?? null, rows: [] };
    }

    const step = byModule.get(sourced);

    if (!step) {
      return {
        no,
        title,
        state: "unsigned",
        reason: `${labelOf(sourced)} has not been signed off, so its figures are not approved data.`,
        rows: [],
      };
    }

    // The order is the report's, not the run's — a section reads in the order a QS expects to find
    // things, and a field the run did not return simply does not appear.
    const wanted = FIELDS[no] ?? [];
    const rows = wanted
      .map((id) => step.fields.find((f) => f.fieldId === id))
      .filter((f): f is NonNullable<typeof f> => Boolean(f))
      .map((f) => ({
        label: f.label,
        value: f.value,
        source: f.citation?.document ?? (f.carriedVia ? `Carried from ${labelOf(f.carriedVia)}` : null),
      }));

    return {
      no,
      title,
      state: rows.length > 0 ? "established" : "unsigned",
      reason:
        rows.length > 0
          ? null
          : `${labelOf(sourced)} is signed off but returned none of the figures this section reads.`,
      rows,
      // The signer's reason travels with the signature: a report must not show a total that does
      // not reconcile without saying why it was signed anyway (audit C3).
      from: { module: step.module, by: step.by, at: step.at, note: step.note },
    };
  });

  return {
    headline: {
      units,
      construction: stack.construction > 0n ? stack.construction : null,
      verdict: verdict.overall,
      binding: verdict.bindingConstraint,
      sentence: verdictSentence(verdict),
    },
    charts: chartsFor(scenario),
    sections,
    established: sections.filter((s) => s.state === "established").length,
    total: sections.length,
  };
}
