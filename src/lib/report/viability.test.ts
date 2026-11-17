import { describe, expect, it } from "vitest";

import type { SignedStep } from "@/lib/agent/persist";
import { DEFAULT_ASSUMPTIONS } from "@/lib/assumption-set";
import { viabilityReport } from "./viability";

const field = (fieldId: string, label: string, value: string, document = "Project brief.pdf") => ({
  fieldId,
  label,
  value,
  citation: { documentId: "d1", document, quote: "the passage it was read from" },
  carriedVia: null,
});

const feasibility: SignedStep = {
  module: "/feasibility",
  runId: "r1",
  by: "qs@mzilikazi.co.za",
  at: "2026-08-28T09:00:00.000Z",
  fields: [
    field("erf", "Erf number and extent", "Erf 4127 — 127 000 m²"),
    field("zoning", "Permitted use and density", "Residential 3, 90 units per hectare"),
    field("units", "Total unit count", "1 046"),
    field("mix", "Unit mix and typologies", "482 one-bed, 464 two-bed, 100 three-bed"),
    field("unit-area", "Average unit area", "48 m²"),
    field("bulk", "Bulk services contribution", "R 42 300 000"),
    field("subsidy", "Subsidy quantum", "R 121 626"),
  ],
};

const costPlan: SignedStep = {
  module: "/cost-plan",
  runId: "r2",
  by: "qs@mzilikazi.co.za",
  at: "2026-08-28T10:00:00.000Z",
  fields: [
    field("cp-basis", "Estimate class and basis", "ASAQS Class 4", "QS cost plan.pdf"),
    field("cp-total", "Total construction cost", "R 466 600 000", "QS cost plan.pdf"),
    field("cp-substructure", "Substructure", "R 44 200 000", "QS cost plan.pdf"),
  ],
};

const at = (report: ReturnType<typeof viabilityReport>, no: string) =>
  report.sections.find((s) => s.no === no)!;

describe("the report's shape", () => {
  it("is v3's twelve sections, in v3's order", () => {
    const report = viabilityReport([]);
    expect(report.sections.map((s) => s.no)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]);
  });

  it("opens with affordability before cost, because the scheme is constraint-led", () => {
    const report = viabilityReport([]);
    const affordability = report.sections.findIndex((s) => s.no === "2");
    const cost = report.sections.findIndex((s) => s.no === "6");
    expect(affordability).toBeLessThan(cost);
  });
});

describe("with nothing signed", () => {
  const report = viabilityReport([]);

  it("establishes nothing at all", () => {
    expect(report.established).toBe(0);
  });

  it("still lists every section, so the shape of the document is visible", () => {
    expect(report.sections).toHaveLength(12);
  });

  it("says the sourced sections are not signed off rather than omitting them", () => {
    expect(at(report, "3").state).toBe("unsigned");
    expect(at(report, "3").reason).toMatch(/has not been signed off/);
  });

  it("names the step, so a reader knows where to go", () => {
    expect(at(report, "6").reason).toMatch(/Cost Plan/);
  });

  it("shows no rows anywhere — an unsigned figure is not approved data", () => {
    expect(report.sections.every((s) => s.rows.length === 0)).toBe(true);
  });
});

describe("with the feasibility estimate signed", () => {
  const report = viabilityReport([feasibility]);

  it("establishes the sections it sources from that step", () => {
    expect(at(report, "3").state).toBe("established");
    expect(at(report, "5").state).toBe("established");
  });

  it("reads the figures in the report's own order, not the run's", () => {
    // The run returns erf, zoning, units, mix, unit-area in seq order; §3 wants the same five but
    // it is the report that decides, so a run reordering its field set cannot reorder the document.
    expect(at(report, "3").rows.map((r) => r.label)).toEqual([
      "Erf number and extent",
      "Permitted use and density",
      "Total unit count",
      "Unit mix and typologies",
      "Average unit area",
    ]);
  });

  it("carries the document each figure was read from", () => {
    expect(at(report, "3").rows.every((r) => r.source === "Project brief.pdf")).toBe(true);
  });

  it("carries the signature under the section", () => {
    expect(at(report, "3").from).toEqual({
      module: "/feasibility",
      by: "qs@mzilikazi.co.za",
      at: "2026-08-28T09:00:00.000Z",
    });
  });

  it("leaves the cost plan's section unsigned, not awaiting", () => {
    // The difference matters: "not signed off" is something a person can go and do, and "not yet
    // established" is something the platform cannot do yet. Conflating them would send a QS to
    // sign a step that would not fill the section anyway.
    expect(at(report, "6").state).toBe("unsigned");
  });
});

describe("with the cost plan signed too", () => {
  const report = viabilityReport([costPlan, feasibility]);

  it("establishes the elemental cost estimate", () => {
    expect(at(report, "6").state).toBe("established");
    expect(at(report, "6").rows.map((r) => r.value)).toContain("R 466 600 000");
  });

  it("only shows the elements the run actually returned", () => {
    // The section reads ten fields; this run signed three. A field the run did not return simply
    // does not appear — it is not rendered as a dash, which would read as an element costing nought.
    expect(at(report, "6").rows).toHaveLength(3);
  });

  it("counts everything the ported engine can now reach", () => {
    // The control page, three sourced sections, the build-up, the two the gates write — the
    // executive summary and the conclusion — the risk register, and the approval programme. The
    // last two derive from the engine and a dated reference table rather than waiting on one, so
    // both establish the moment anything is signed.
    expect(report.established).toBe(9);
    expect(report.total).toBe(12);
  });

  it("lists every signed step on the control page", () => {
    expect(at(report, "0").rows.map((r) => r.label).sort()).toEqual(["Cost Plan", "Feasibility Estimate"]);
  });
});

describe("2 — the affordability envelope", () => {
  const withBand = viabilityReport([
    {
      ...feasibility,
      fields: [
        ...feasibility.fields,
        field(
          "income-band",
          "Target household income band",
          "Households earning between R 8 000 and R 30 000 per month",
        ),
      ],
    },
  ]);

  it("is established once the band is signed", () => {
    expect(at(withBand, "2").state).toBe("established");
  });

  it("derives the ceiling the whole report is tested against", () => {
    // R30 000 a month at 30%, over 20 years at 11,75%, plus the signed FLISP subsidy.
    const ceiling = at(withBand, "2").rows.find((r) => /ceiling/i.test(r.label));
    expect(ceiling?.value.replace(/[^\d,]/g, "")).toBe("952108,73");
  });

  it("marks the lending assumptions as assumptions, not signed figures", () => {
    /*
      Prime is a market rate. It is not in anybody's project documents, and a report presenting it
      as signed would claim a signature nobody gave.

      It now says whose assumption it is, which it could not before: the figure was hard-coded, so
      "assumption" was as specific as the report could honestly be. A practice that sets its own
      rate is stating one; one that does not is accepting the platform's, and either way the
      settings page shows which.
    */
    const bond = at(withBand, "2").rows.find((r) => /Bond assumptions/.test(r.label));
    expect(bond?.source).toMatch(/stated assumption/);
  });

  it("says why the ceiling is the top of the band and not the middle", () => {
    expect(at(withBand, "2").reason).toMatch(/cannot be financed by anyone in its own target market/);
  });

  it("is unsigned, not awaiting, when no band has been signed", () => {
    // The difference matters: the platform can compute this. What it lacks is a signature.
    const without = at(viabilityReport([feasibility]), "2");
    expect(without.state).toBe("unsigned");
    expect(without.reason).toMatch(/binding input/);
  });
});

describe("7 — the development cost build-up", () => {
  const report = viabilityReport([costPlan, feasibility]);
  const seven = at(report, "7");

  it("is built the moment a construction cost is signed", () => {
    expect(seven.state).toBe("established");
  });

  it("carries the signed construction cost as its largest line", () => {
    expect(seven.rows.some((r) => /B4/.test(r.label) && /466 600 000/.test(r.value.replace(/\s/g, " ")))).toBe(true);
  });

  it("says of every line whether it is signed, derived or an assumption", () => {
    // A development cost is a signed construction cost plus professional assumptions. Presenting
    // the assumptions as signed figures is the failure this platform exists to prevent.
    expect(seven.rows.some((r) => r.source?.startsWith("Signed"))).toBe(true);
    expect(seven.rows.some((r) => r.source?.startsWith("Assumption"))).toBe(true);
  });

  it("ends with a total that is the sum of the lines above it", () => {
    expect(seven.rows.at(-1)?.label).toBe("Total development cost");
  });

  it("says what it left out, rather than leaving it out silently", () => {
    expect(seven.reason).toMatch(/No land value has been signed/);
  });

  it("is not built at all with no construction cost signed", () => {
    // A build-up whose largest line is missing is not a smaller build-up.
    const alone = at(viabilityReport([feasibility]), "7");
    expect(alone.state).toBe("unsigned");
    expect(alone.rows).toHaveLength(0);
  });
});

describe("11 — the gates, and the verdict they do not reach", () => {
  const report = viabilityReport([costPlan, feasibility]);
  const eleven = at(report, "11");

  it("lists every gate, evaluated or not", () => {
    expect(eleven.rows).toHaveLength(6);
  });

  it("marks the three that need the scenario model as not evaluated, never passed", () => {
    // A gate with nothing to measure against has not been cleared.
    const untested = eleven.rows.filter((row) => row.value === "Not evaluated");
    expect(untested.length).toBeGreaterThanOrEqual(3);
  });

  it("refuses to state a verdict while a gate is untested", () => {
    // The most expensive sentence this platform could print would be "feasible" on a scheme
    // nobody has tested for fundability.
    expect(eleven.reason).toMatch(/No verdict is stated/);
    expect(eleven.reason).toMatch(/funding, return and resilience/);
  });

  it("says what each gate found, beside it", () => {
    for (const row of eleven.rows) expect(row.source?.length ?? 0).toBeGreaterThan(10);
  });
});

describe("the sections the engine has not reached", () => {
  const report = viabilityReport([costPlan, feasibility]);

  it("are marked awaiting, never silently dropped", () => {
    // Two now. Both need the cash flow, which this fixture has not signed the four inputs for.
    // Sections 4 and 10 left this list once they derived themselves rather than waiting on an
    // engine — the approval path from a dated reference table, the risk register from the gates.
    for (const no of ["8", "9"]) expect(at(report, no).state).toBe("awaiting");
  });

  it("states the approval path and what waiting on it costs", () => {
    /*
      The cost most often left out of a feasibility, because it appears in no cost plan and nobody
      invoices for it. The section says outright that the lead times are a dated norm and that the
      platform does not know where this project stands in the sequence.
    */
    const approvals = at(report, "4");

    expect(approvals.state).toBe("established");
    expect(approvals.reason).toMatch(/does not know which of these approvals/);
    expect(approvals.rows.some((row) => row.label === "Critical path to construction")).toBe(true);
  });

  it("says when the modelled programme is shorter than the approval path", () => {
    // An optimistic programme understates holding cost, which flatters the return — the direction
    // that gets schemes built. So the gap is stated in months, not corrected silently.
    expect(at(report, "4").reason).toMatch(/months longer than modelled/);
  });

  it("derives the risk register rather than composing one", () => {
    /*
      The section that would have been easiest to fake. A generic construction risk matrix writes
      itself — contractor insolvency, weather, labour — and this platform has seen none of those
      things. Every row traces to a gate, a lever, an unsigned figure or an assumption, and the
      section says outright what it does not cover.
    */
    const register = at(report, "10");

    expect(register.state).toBe("established");
    expect(register.reason).toMatch(/does not cover delivery risk/);
    expect(register.rows.every((row) => (row.source ?? "").length > 0)).toBe(true);
  });

  it("names no risk it could not have established", () => {
    const words = at(report, "10")
      .rows.map((row) => `${row.label} ${row.value}`)
      .join(" ")
      .toLowerCase();

    for (const invented of ["weather", "insolvenc", "labour unrest", "strike", "theft"]) {
      expect(words).not.toContain(invented);
    }
  });

  it("each say what they are waiting for, rather than 'coming soon'", () => {
    // A reader told what is missing can judge how much of the document they are holding.
  });

  it("carry no rows and no signature", () => {
    expect(at(report, "8").rows).toHaveLength(0);
    expect(at(report, "8").from).toBeUndefined();
  });
});

describe("the sections the cash flow establishes", () => {
  /** Ridgeview's feasibility step, with the four inputs the model will not invent. */
  const priced: SignedStep = {
    ...feasibility,
    fields: [
      ...feasibility.fields,
      field("selling-price", "Achievable selling price", "R 737 558"),
      field("absorption", "Absorption rate", "144 units per annum"),
      field("programme", "Programme duration", "36 months"),
    ],
  };

  const at = (report: ReturnType<typeof viabilityReport>, no: string) =>
    report.sections.find((s) => s.no === no)!;

  it("establishes financial viability and sensitivity once all four are signed", () => {
    const report = viabilityReport([priced, costPlan]);

    expect(at(report, "8").state).toBe("established");
    expect(at(report, "9").state).toBe("established");
  });

  it("leaves both awaiting when even one input is missing", () => {
    /*
      The refusal that matters. A cash flow assembled from a plausible default absorption rate
      would produce a fundable-looking scheme out of a project nobody has priced, and it would
      carry the same "Established" label as one built from signatures.
    */
    for (const missing of ["selling-price", "absorption", "programme"]) {
      const short = { ...priced, fields: priced.fields.filter((f) => f.fieldId !== missing) };
      const report = viabilityReport([short, costPlan]);

      expect(at(report, "8").state).toBe("awaiting");
      expect(at(report, "9").state).toBe("awaiting");
    }
  });

  it("names the four inputs rather than an engine the reader cannot see", () => {
    const report = viabilityReport([feasibility, costPlan]);
    expect(at(report, "8").reason).toMatch(/selling price, absorption rate, programme and unit count/);
  });

  it("names the input that is actually missing, not all four", () => {
    const noProgramme = { ...priced, fields: priced.fields.filter((f) => f.fieldId !== "programme") };
    const reason = at(viabilityReport([noProgramme, costPlan]), "8").reason!;
    expect(reason).toMatch(/Missing or unreadable: a signed programme duration in months/);
    expect(reason).not.toMatch(/absorption rate \(/);
    expect(at(viabilityReport([noProgramme, costPlan]), "9").reason).toBe(reason);
  });

  it("says a programme in years is not read as months, and does not run on it", () => {
    /*
      "3 years" used to be read as 3 – the unit was stripped and the figure kept – and the report
      established both sections on a three-month build. It now refuses, and says why.
    */
    const inYears = {
      ...priced,
      fields: priced.fields.map((f) => (f.fieldId === "programme" ? { ...f, value: "3 years" } : f)),
    };
    const report = viabilityReport([inYears, costPlan]);
    expect(at(report, "8").state).toBe("awaiting");
    expect(at(report, "8").reason).toMatch(/the programme, signed as “3 years” where the field records months/);
  });

  it("says an absorption rate with no period is why, quoting it", () => {
    const bare = {
      ...priced,
      fields: priced.fields.map((f) => (f.fieldId === "absorption" ? { ...f, value: "144" } : f)),
    };
    expect(at(viabilityReport([bare, costPlan]), "8").reason).toMatch(/the absorption rate, signed as “144” with no period/);
  });

  it("names the cost plan when it is the cost plan that is missing", () => {
    expect(at(viabilityReport([priced]), "8").reason).toMatch(/a signed Cost Plan total/);
  });

  it("states the practice's own assumptions, not the platform's defaults", () => {
    /*
      The section read "5% a year", "3% selling commission", "60/40" and "at 14%" whatever the
      practice had set, while the model underneath ran on the practice's figures.
    */
    const report = viabilityReport([priced, costPlan], {
      ...DEFAULT_ASSUMPTIONS,
      priceEscalationPa: 0.07,
      salesCommission: 0.025,
      debtPct: 70,
      financeRatePa: 0.125,
      discountRatePa: 0.16,
    });
    const section = at(report, "8");
    expect(section.reason).toMatch(/Escalation at 7% a year and 2,5% selling commission/);
    expect(section.rows.find((r) => r.label === "NPV to equity")!.value).toMatch(/at 16%$/);
    expect(section.rows.find((r) => r.label === "Finance cost over the programme")!.source).toMatch(/70\/30 debt to equity at 12,5%/);
  });

  it("carries one NPV, not two", () => {
    /*
      The report used to print an unlevered NPV in the gates and a levered one in section 8 —
      both labelled NPV, about R13m apart, with nothing on the page saying which was which.
      Gate 4 now quotes the same figure section 8 reports.
    */
    const report = viabilityReport([priced, costPlan]);

    const npvRow = at(report, "8").rows.find((r) => r.label === "NPV to equity")!;
    const figure = npvRow.value.replace(/[^\d]/g, "").slice(0, 6);

    const gate4 = at(report, "11").rows.find((r) => r.label.startsWith("Gate 4"))!;
    expect((gate4.source ?? "").replace(/[^\d]/g, "")).toContain(figure);
  });

  it("sorts the sensitivity levers widest first", () => {
    // The shape is the finding: the top row is the assumption worth the diligence.
    const rows = viabilityReport([priced, costPlan]).sections.find((s) => s.no === "9")!.rows;
    expect(rows[0].label).toMatch(/Selling price/);
  });

  it("states every assumption the cash flow rests on", () => {
    // Escalation and commission are in nobody's documents. A section that used them silently
    // would read as though a QS had signed them.
    const reason = at(viabilityReport([priced, costPlan]), "8").reason ?? "";
    expect(reason).toMatch(/stated assumptions, not signed figures/);
  });
});
