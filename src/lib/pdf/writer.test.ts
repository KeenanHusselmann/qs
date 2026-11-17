import { describe, expect, it } from "vitest";

import { createPdf, pdfTextString } from "./writer";

describe("pdfTextString – the title a viewer shows", () => {
  it("keeps plain ASCII a literal, escaping the characters that would end it", () => {
    expect(pdfTextString("Bill of Quantities")).toBe("(Bill of Quantities)");
    expect(pdfTextString("Cost (draft) \\ v2")).toBe("(Cost \\(draft\\) \\\\ v2)");
  });

  it("writes anything else as UTF-16BE behind a byte-order mark", () => {
    // "A–B": A = 0041, en dash = 2013, B = 0042.
    expect(pdfTextString("A–B")).toBe("<FEFF004120130042>");
    expect(pdfTextString("Rényi")).toBe("<FEFF005200E9006E00790069>");
  });

  it("puts that form in the trailer, so an en dash is not mojibake", () => {
    const pdf = createPdf({ title: "Marshall Dam – Boundary Wall" });
    const bytes = pdf.build().toString("latin1");
    expect(bytes).toContain(`/Title ${pdfTextString("Marshall Dam – Boundary Wall")}`);
    expect(bytes).not.toContain("â€“");
  });
});
