/**
 * The elemental cost plan, as issued.
 *
 * Read back out of the PDF rather than asserted on the layout calls: what matters is what a reader
 * of the document sees, and only the text a PDF reader extracts says that.
 */

import { describe, expect, it } from "vitest";
import { extractText, getDocumentProxy } from "unpdf";

import { elementalPlan, type PlanRow } from "@/domain/elemental-plan";
import { money, percent, quantity } from "@/domain/money";
import { elementalPlanPdf, type ElementalPlanSubject } from "@/lib/report/elemental-plan-pdf";

const R = (rand: number) => money(BigInt(Math.round(rand * 100)));
const row = (description: string, element: PlanRow["element"], rand: number): PlanRow => ({ id: description, description, element, amount: R(rand) });

/*
  Chosen so the per-metre figures can be checked by hand over the boundary wall's 491,05 m:
  491 050 is R1 000 a metre, 245 525 is R500 and 98 210 is R200.
*/
const rows = [
  row("Concrete strip footing", "substructure", 491_050),
  row("One-brick walling", "superstructure", 245_525),
  row("Plaster to both faces", "finishes", 98_210),
];
const allowances = { preliminaries: percent(1200n), contingency: percent(500n), escalation: percent(0n), vat: percent(1500n) };
const wall = quantity(4_910_500n);

const subject: ElementalPlanSubject = {
  practice: "Mzilikazi Property Services",
  projectName: "Marshall Dam",
  code: "MD-01",
  client: null,
  basis: "Revised from the measured bill",
  allowances: { preliminaries: "12", contingency: "5", escalation: "0", vat: "15", typical: false },
  measure: { label: "m" },
  issuedBy: "qs@mzilikazi.co.za",
  issuedOn: "16 November 2026",
};

const textOf = async (pdf: Buffer): Promise<string> => {
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const { text } = await extractText(doc, { mergePages: true });
  return text;
};

describe("the elemental cost plan, as issued", () => {
  it("prints the cost per metre of wall for each element, in the table", async () => {
    const text = await textOf(elementalPlanPdf(elementalPlan(rows, allowances, wall), subject));

    expect(text).toContain("Per m (R)");
    expect(text).toMatch(/Substructure[^\n]*491 050,00[^\n]*1 000,00/);
    expect(text).toMatch(/Superstructure[^\n]*245 525,00[^\n]*500,00/);
    expect(text).toMatch(/Finishes[^\n]*98 210,00[^\n]*200,00/);
  });

  /** September review §8: the per-metre figures were a grey line under the totals, where nobody comparing looks. */
  it("no longer buries them in a line under the totals", async () => {
    const text = await textOf(elementalPlanPdf(elementalPlan(rows, allowances, wall), subject));
    expect(text).not.toMatch(/Per m: Substructure/);
    // The whole plan per metre stays, under the totals – it is a total, not an element.
    expect(text).toMatch(/per m excluding VAT/);
  });

  it("has no per-unit column when the plan has no measure", async () => {
    const text = await textOf(elementalPlanPdf(elementalPlan(rows, allowances), { ...subject, measure: null }));
    expect(text).not.toMatch(/Per .* \(R\)/);
    expect(text).toMatch(/Substructure[^\n]*491 050,00/);
  });

  it("uses en dashes, not em dashes", async () => {
    const text = await textOf(elementalPlanPdf(elementalPlan(rows, allowances, wall), subject));
    expect(text).not.toContain("—");
    expect(text).toMatch(/–\s+Elemental Cost Plan\s+–\s+Page 1 of 1/);
  });
});
