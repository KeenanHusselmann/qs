/**
 * The cost report as the client receives it – what is on the page, read back out of the PDF.
 *
 * The figures are `domain/cost-control.ts`'s and are tested there. What is tested here is that the
 * document carries them: the answer, every line with its reason under it, and the decision.
 */

import { describe, expect, it } from "vitest";
import { extractText, getDocumentProxy } from "unpdf";

import { costCheck, type CostLineId } from "@/domain/cost-control";
import { elementalPlan, type PlanRow } from "@/domain/elemental-plan";
import { money, percent } from "@/domain/money";
import type { DecisionRecord } from "@/lib/cost-control";

import { costReportPdf } from "./cost-report-pdf";

const R = (rands: number) => money(BigInt(rands) * 100n);
const row = (id: string, element: PlanRow["element"], rands: number): PlanRow => ({ id, description: id, element, amount: R(rands) });

// Measured work R3 500 000; with 10% preliminaries and 5% contingency, R4 042 500 excluding VAT.
const plan = elementalPlan(
  [row("footings", "substructure", 1_000_000), row("walls", "superstructure", 2_000_000), row("plaster", "finishes", 300_000), row("joinery", "fittings", 200_000)],
  { preliminaries: percent(1000n), contingency: percent(500n), escalation: percent(0n), vat: percent(1500n) },
);
const check = costCheck(
  new Map([
    ["cp-total", "R 3 900 000"],
    ["cp-substructure", "R 900 000"],
    ["cp-superstructure", "R 2 000 000"],
    ["cp-finishes", "R 520 000"],
    ["cp-preliminaries", "R 350 000"],
    ["cp-contingency", "R 200 000"],
  ]),
  plan,
);

const subject = {
  practice: "Mzilikazi Quantity Surveyors",
  projectName: "Ridgeview Gardens",
  code: "RVG-001",
  client: "Ridgeview Developments",
  costPlan: "The Cost Plan signed off by A Surveyor on 2 November 2026",
  bill: "The draft Bill of Quantities – not yet signed off",
  issuedBy: "A Surveyor",
  issuedOn: "16 November 2026",
};

async function textOf(bytes: Buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text, totalPages } = await extractText(pdf, { mergePages: true });
  // The writer encodes cp1252; grouping spaces come back as ordinary spaces either way.
  return { text: text.replace(/ /g, " ").replace(/\s+/g, " "), totalPages };
}

describe("the cost report", () => {
  const notes = new Map<CostLineId, { note: string }>([["substructure", { note: "Pier footings enlarged to 1000 x 1800 on the signed engineer's detail" }]]);

  it("leads with the answer and carries every line", async () => {
    const { text, totalPages } = await textOf(costReportPdf(check, notes, null, subject));
    expect(totalPages).toBeLessThanOrEqual(2);
    expect(text).toContain("Cost Report");
    expect(text).toMatch(/The detailed estimate is R 142 500,00 \(3,7%\) over the cost plan's total/);
    for (const label of ["Substructure", "Superstructure", "Finishes and fittings", "Preliminaries and general", "Contingency"]) {
      expect(text).toContain(label);
    }
  });

  it("puts the reason for a movement under the line it explains", async () => {
    const { text } = await textOf(costReportPdf(check, notes, null, subject));
    const sub = text.indexOf("Substructure");
    const why = text.indexOf("Pier footings enlarged");
    expect(why).toBeGreaterThan(sub);
    expect(why).toBeLessThan(text.indexOf("Superstructure", sub));
  });

  it("says when no decision has been recorded, and states one that has", async () => {
    expect((await textOf(costReportPdf(check, notes, null, subject))).text).toMatch(/Not yet recorded/);

    const decision: DecisionRecord = {
      id: "d1",
      decision: "revise-budget",
      note: "The client accepts the larger footings the engineer signed.",
      revisedBudget: R(4_100_000),
      budget: R(3_900_000),
      detailed: R(4_042_500),
      verdict: "over-budget",
      costPlanRunId: "plan-1",
      by: "A Surveyor",
      at: "2026-11-16T09:00:00.000Z",
    };
    const { text } = await textOf(costReportPdf(check, notes, decision, subject));
    expect(text).toMatch(/Approve a revised budget: R 4 100 000,00 excluding VAT/);
    expect(text).toContain("The client accepts the larger footings");
  });
});
