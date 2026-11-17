/**
 * The four situations "not searchable" used to collapse into one number.
 *
 * The one that matters is the scan: it is a real gap a person can close by finding the digital
 * original. A drawing in the same list is working exactly as designed, and reporting it as a
 * problem sends someone looking for a fix to something that is not broken.
 */

import { describe, expect, it } from "vitest";

import { EXPLANATIONS, reasonFor } from "./readability";

describe("reasonFor", () => {
  it("calls a drawing a drawing, whatever its extension", () => {
    expect(reasonFor("2500041-CT-001-A1-revE.pdf", "Concept drawings")).toBe("drawing");
    expect(reasonFor("Nako Iliso Logo.jpg", "Locality map")).toBe("drawing");
  });

  it("names a spreadsheet that would not open", () => {
    // Reached only where the parse failed. An .xlsx is read now, so the ones landing here are a
    // legacy .xls, an .ods, or a workbook with a password on it — and the last is worth saying,
    // because the sender can fix it in a minute.
    expect(reasonFor("Bulk Infra Planning Cost Estimates Rev 4.xls", "Bulk infrastructure cost estimate")).toBe(
      "spreadsheet",
    );
    expect(reasonFor("Cost plan.ods", "Bulk infrastructure cost estimate")).toBe("spreadsheet");
    expect(
      reasonFor("Protected estimate.xlsx", "Bulk infrastructure cost estimate", "This workbook is password-protected"),
    ).toBe("spreadsheet");
  });

  it("names an image", () => {
    expect(reasonFor("Pasted Image #1 2227A9F5.jpg", "Project brief")).toBe("image");
    expect(reasonFor("Mosaic 1-part1x1.png", "Project brief")).toBe("image");
  });

  it("names a scan, the one worth acting on", () => {
    expect(reasonFor("TITLE DEED - (Extract).pdf", "Title deed")).toBe("scan");
  });

  it("falls back without pretending to know", () => {
    expect(reasonFor("notes.rtf", "Project brief")).toBe("unreadable");
  });
});

describe("what each explanation says", () => {
  it("tells a reader what it costs them, not what it costs the index", () => {
    for (const [reason, { one, many, meaning }] of Object.entries(EXPLANATIONS)) {
      expect(one.length, reason).toBeGreaterThan(10);
      expect(many.length, reason).toBeGreaterThan(10);
      expect(meaning.length, reason).toBeGreaterThan(40);
      // "Searchable" is the platform's word for its own internals, and explains nothing.
      expect(`${one} ${many} ${meaning}`.toLowerCase(), reason).not.toContain("searchable");
    }
  });

  it("counts one of a thing without saying \"1 Spreadsheets\"", () => {
    for (const [reason, { one, many }] of Object.entries(EXPLANATIONS)) {
      expect(one, reason).not.toBe(many);
      // Both are fragments the count is read into: "1 spreadsheet…", "3 spreadsheets…".
      expect(one[0], reason).toBe(one[0]!.toLowerCase());
    }
  });

  it("says plainly that a drawing is not a problem", () => {
    expect(EXPLANATIONS.drawing.meaning).toMatch(/nothing is wrong/i);
  });

  it("gives the scan a next step, because it has one", () => {
    expect(EXPLANATIONS.scan.meaning).toMatch(/original/i);
  });
});
