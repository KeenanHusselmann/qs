import { describe, expect, it } from "vitest";

import { TOOLS, TOOL_NAMES, gatesFailing, runTool, toolMenu, toolText } from "./tools";
import type { SignedStep } from "./persist";

const field = (fieldId: string, label: string, value: string) => ({
  fieldId,
  label,
  value,
  citation: { documentId: "d1", document: "Project brief.pdf", quote: "the passage", page: 1 },
  carriedVia: null,
});

/** Ridgeview, with everything the four engines need. */
const feasibility: SignedStep = {
  module: "/feasibility",
  runId: "r1",
  by: "qs@mzilikazi.co.za",
  at: "2026-08-28T09:00:00.000Z",
  fields: [
    field("units", "Total unit count", "1 046"),
    field("unit-area", "Average unit area", "48 m²"),
    field("selling-price", "Achievable selling price", "R 737 558"),
    field("absorption", "Absorption rate", "144 units per annum"),
    field("programme", "Programme duration", "36 months"),
    field("bulk", "Bulk services contribution", "R 42 300 000"),
    field("income-band", "Target household income", "between R 8 000 and R 30 000 per month"),
  ],
};

const costPlan: SignedStep = {
  module: "/cost-plan",
  runId: "r2",
  by: "qs@mzilikazi.co.za",
  at: "2026-08-28T10:00:00.000Z",
  fields: [
    field("cp-total", "Total construction cost", "R 466 600 000"),
    field("cp-units", "Total unit count", "1 046"),
  ],
};

const signed = [feasibility, costPlan];

describe("what the advisor can go and work out", () => {
  it("offers a tool per question a QS actually asks", () => {
    expect(TOOL_NAMES).toEqual(["gates", "cost", "affordability", "cashflow"]);
  });

  it("describes each one in the words the model is choosing between", () => {
    const menu = toolMenu();
    for (const name of TOOL_NAMES) expect(menu).toContain(`"${name}"`);
    // The menu is what the model matches a question against, so it carries the question's words.
    expect(menu).toMatch(/viable/);
    expect(menu).toMatch(/peak funding/);
  });

  it("names a method on every figure it reports", () => {
    /*
      The rule that earns a tool result the right to carry figures at all. `ask.ts` lets the model
      state none; these are shown because each one says where it came from, exactly as a passage
      carries its document and page.
    */
    for (const tool of TOOLS) {
      const result = tool.run(signed);
      for (const finding of result.findings) {
        expect(finding.from.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("the gates tool", () => {
  const result = runTool("gates", signed)!;

  it("runs all six", () => {
    expect(result.unavailable).toBeNull();
    expect(result.findings).toHaveLength(6);
  });

  it("reports the failure rather than a summary of it", () => {
    // Ridgeview passes on cost and fails on return, which is the finding the whole engine exists
    // to produce. A tool that reported "some gates failed" would have answered nothing.
    expect(gatesFailing(result)).toBe(true);
    expect(result.findings.find((f) => f.label.startsWith("Gate 4"))?.value).toMatch(/Failed/i);
  });

  it("says it could not run rather than passing on nothing", () => {
    const bare = runTool("gates", [])!;
    expect(bare.findings).toEqual([]);
    expect(bare.unavailable).toMatch(/nothing they need has been signed/);
  });
});

describe("the cash-flow tool", () => {
  it("answers the funding question with the peak and the month", () => {
    const result = runTool("cashflow", signed)!;

    expect(result.unavailable).toBeNull();
    expect(result.findings.find((f) => f.label === "Peak funding requirement")?.value).toMatch(
      /at month \d+/,
    );
  });

  it("names the assumption the answer is most hostage to", () => {
    const result = runTool("cashflow", signed)!;
    expect(result.findings.find((f) => f.label === "Most sensitive assumption")?.value).toBe(
      "Selling price",
    );
  });

  it("labels the funding structure as an assumption, not a signed figure", () => {
    // A reader must be able to tell which figures somebody signed and which the platform assumed.
    const result = runTool("cashflow", signed)!;
    expect(result.findings.find((f) => f.label === "Finance cost")?.from).toMatch(
      /stated assumption, not a signed figure/,
    );
  });

  it("refuses to model when an input would have to be invented", () => {
    const short = {
      ...feasibility,
      fields: feasibility.fields.filter((f) => f.fieldId !== "absorption"),
    };
    const result = runTool("cashflow", [short, costPlan])!;

    expect(result.findings).toEqual([]);
    expect(result.unavailable).toMatch(/selling price, absorption rate, programme and unit count/);
  });
});

describe("the cost and affordability tools", () => {
  it("gives the build-up and keeps the total whichever end it falls at", () => {
    const result = runTool("cost", signed)!;

    expect(result.unavailable).toBeNull();
    expect(result.findings.at(-1)?.label).toMatch(/Total development cost/);
  });

  it("gives the ceiling the whole verdict rests on", () => {
    const result = runTool("affordability", signed)!;
    expect(result.unavailable).toBeNull();
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it("says the band is what is missing, not that the scheme is unaffordable", () => {
    // Different facts. One is a gap in the record; the other is a finding about the development.
    const noBand = {
      ...feasibility,
      fields: feasibility.fields.filter((f) => f.fieldId !== "income-band"),
    };
    const result = runTool("affordability", [noBand, costPlan])!;

    expect(result.unavailable).toMatch(/has not been signed/);
  });
});

describe("a tool the model asked for badly", () => {
  it("is no tool rather than an error", () => {
    // The model choosing badly is a worse answer, not a broken request — and a failure here would
    // lose the reader the passages as well.
    expect(runTool("web_search", signed)).toBeNull();
    expect(runTool(null, signed)).toBeNull();
    expect(runTool(42, signed)).toBeNull();
    expect(runTool("", signed)).toBeNull();
  });
});

describe("how a tool result reaches the model on the second pass", () => {
  it("carries the method beside every figure", () => {
    const text = toolText(runTool("cashflow", signed)!);

    expect(text).toMatch(/TOOL "cashflow"/);
    // `\s`, not a space: money groups with U+00A0 (§7.7) and a literal space never matches.
    expect(text).toMatch(/Peak funding requirement: R\s.+ \(Deepest point/);
  });

  it("says plainly when it could not run", () => {
    // So the model answers "the cash flow cannot be modelled yet, because…" rather than guessing.
    const text = toolText(runTool("cashflow", [])!);
    expect(text).toMatch(/COULD NOT RUN/);
  });
});
