import { describe, expect, it } from "vitest";
import { extractText, getDocumentProxy } from "unpdf";

import type { SignedStep } from "@/lib/agent/persist";
import { renderViabilityPdf } from "./pdf";
import { viabilityReport } from "./viability";

const field = (fieldId: string, label: string, value: string, document = "QS cost plan.pdf") => ({
  fieldId,
  label,
  value,
  citation: { documentId: "d1", document, quote: "the passage it was read from" },
  carriedVia: null,
});

const costPlan: SignedStep = {
  module: "/cost-plan",
  runId: "r1",
  by: "qs@mzilikazi.co.za",
  at: "2026-08-28T10:00:00.000Z",
  fields: [
    field("cp-basis", "Estimate class and basis", "ASAQS Class 4"),
    field("cp-substructure", "Substructure", "R 44 200 000"),
    field("cp-superstructure", "Superstructure", "R 168 900 000"),
    field("cp-preliminaries", "Preliminaries and general", "R 41 200 000"),
    field("cp-total", "Total construction cost", "R 466 600 000"),
  ],
};

const SUBJECT = {
  projectName: "Ridgeview Gardens",
  code: "RVG-001",
  client: "Ridgeview Housing Development Company (Pty) Ltd",
  practice: "Mzilikazi Property Services",
  latestSignature: "28 Aug 2026",
  issuedOn: "28 Aug 2026",
};

/** Render once — five pages of PDF parsed per assertion would make this the slowest suite here. */
const render = async (signed: SignedStep[]) => {
  const bytes = renderViabilityPdf(viabilityReport(signed), SUBJECT);
  const proxy = await getDocumentProxy(new Uint8Array(bytes));
  const { text, totalPages } = await extractText(proxy, { mergePages: true });
  return { bytes, text: text.replace(/\s+/g, " "), pages: totalPages };
};

const signed = await render([costPlan]);
const empty = await render([]);

describe("the document", () => {
  it("is a PDF", () => {
    expect(signed.bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(signed.bytes.subarray(-6).toString("latin1").trim()).toBe("%%EOF");
  });

  it("opens with a cover naming who it is for and what it is about", () => {
    expect(signed.text).toContain("QUANTITY SURVEYOR'S VIABILITY REPORT");
    expect(signed.text).toContain("prepared for");
    expect(signed.text).toContain("Ridgeview Housing Development Company (Pty) Ltd");
    expect(signed.text).toContain("in respect of");
    expect(signed.text).toContain("Ridgeview Gardens");
  });

  it("states the accuracy it claims, on the cover", () => {
    // A Class 4/5 estimate read as a tender price is the misuse this line exists to prevent.
    expect(signed.text).toContain("ASAQS Class 4/5");
    expect(signed.text).toMatch(/±15–25%|\+15–25%/);
  });

  it("carries a contents page, because a report is referred to by section number", () => {
    expect(signed.text).toContain("CONTENTS");
    expect(signed.text).toContain("Affordability envelope");
    expect(signed.text).toContain("Conclusion and recommendation");
  });

  it("numbers every page against the total", () => {
    // A printed copy can be checked for completeness. "Page 3" alone cannot be.
    expect(signed.text).toMatch(/Page 1 of \d+/);
    expect(signed.text).toContain(`Page ${signed.pages} of ${signed.pages}`);
  });

  it("names the practice in the running footer", () => {
    expect(signed.text).toContain("Mzilikazi Property Services");
  });
});

describe("the figures on it", () => {
  it("reproduces what was signed", () => {
    expect(signed.text).toContain("R 466 600 000");
    expect(signed.text).toContain("R 168 900 000");
  });

  it("carries the document each figure was read from", () => {
    expect(signed.text).toContain("QS cost plan.pdf");
  });

  it("names who signed the section", () => {
    expect(signed.text).toContain("qs@mzilikazi.co.za");
  });

  it("draws the elemental breakdown from the signed elements", () => {
    // The label is the tell that the chart rendered; the bars themselves are rectangles and carry
    // no text of their own beyond the figure written at the end of each.
    expect(signed.text).toContain("Elemental breakdown");
  });
});

describe("what it refuses to imply", () => {
  it("states every unestablished section rather than dropping it", () => {
    for (const title of [
      "Executive summary",
      "Affordability envelope",
      "Financial viability",
      "Risk matrix",
      "Conclusion and recommendation",
    ]) {
      expect(signed.text).toContain(title);
    }
  });

  it("says what each is waiting for", () => {
    /*
      What a waiting section names has moved, and the move is the point.

      It used to read "needs the scenario model" — a statement about this platform, true while the
      model was unported. The model exists now, so on a fixture like this one, which has signed a
      cost plan and nothing else, what is actually missing is *signed data*. Naming the four inputs
      tells a reader what to go and do; naming an engine they cannot see tells them to wait.
    */
    expect(signed.text).toContain("selling price, absorption rate, programme and unit count");

    /*
      And the section nothing models yet still says so plainly.

      One, not two: the risk register used to sit here and now derives itself from the gates, the
      sensitivity and the assumptions. What remains unmodelled is the statutory approval programme.
    */
    expect(signed.text).toMatch(/not modelled yet/i);
  });

  it("puts no figure on a section nothing supports", () => {
    // v3 prints "— indic." under `_benchmark_only` rather than a phantom loss. Same rule: a
    // section with no signed figures behind it carries words, never a number.
    const viability = signed.text.slice(signed.text.indexOf("8 Financial viability"));
    expect(viability.slice(0, 120)).not.toMatch(/R\s?\d/);
  });

  it("renders at all with nothing signed, and claims nothing", () => {
    expect(empty.text).toContain("QUANTITY SURVEYOR'S VIABILITY REPORT");
    expect(empty.text).toContain("0 of 12");
    expect(empty.text).not.toMatch(/R\s?\d/);
  });
});

describe("the professional furniture", () => {
  it("states the basis of its own figures", () => {
    expect(signed.text).toContain("BASIS AND LIMITING CONDITIONS");
    expect(signed.text).toContain("No figure in this report was produced by this report");
  });

  it("limits reliance to the addressee", () => {
    expect(signed.text).toContain("Reliance is limited to the addressee");
  });

  it("says a not-established section is not nil", () => {
    // The single most dangerous misreading of this document.
    expect(signed.text).toContain("They are not nil");
  });

  it("carries a glossary, because the reader is often the client", () => {
    expect(signed.text).toContain("Glossary");
    expect(signed.text).toContain("ASAQS");
    expect(signed.text).toContain("Class 4/5");
  });
});
