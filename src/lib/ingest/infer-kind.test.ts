/**
 * Guessing a document's kind, tested against the paths a real submission actually contains.
 *
 * Every path below is from the reference corpus, verbatim. The module's premise is that the folder
 * carries the professional's own classification, so the test has to use their folder names rather
 * than tidy inventions — the tidy ones all passed while eleven real rows sat unclassified.
 *
 * The false-positive cases matter as much as the matches. §1.3: a wrong kind satisfies a criterion
 * with the wrong document, which is worse than leaving it for a person.
 */

import { describe, expect, it } from "vitest";

import { inferKind } from "./infer-kind";

/** The kinds the checklist accepts, as `document-kinds.ts` derives them. */
const KINDS = [
  "Bulk infrastructure cost estimate",
  "Bulk services agreement",
  "Concept drawings",
  "Environmental impact assessment",
  "Geotechnical report",
  "Land use layout plan",
  "Layout plan",
  "Locality map",
  "Locality plan",
  "Market study",
  "Phasing plan",
  "Power of attorney",
  "QS cost plan",
  "Record of decision",
  "Site development plan",
  "Site location plan",
  "Stormwater management report",
  "Title deed",
  "Traffic impact assessment",
  "Water use licence",
];

const guess = (path: string) => inferKind(path, KINDS).kind;

describe("the folder carries the classification", () => {
  it("reads a kind spelled out in the folder", () => {
    expect(guess("SUBMISSION/ANNEXURE E - GEOTECHNICAL REPORT/230-25.R01.pdf")).toBe(
      "Geotechnical report",
    );
  });

  it("forgives the spelling a real folder was given", () => {
    // Both from the reference corpus: a typo, and an American spelling against our own.
    expect(guess("SUBMISSION/ANNEXURE F - ENVIRONMENTAL IMPACT ASSESMENT/eia.pdf")).toBe(
      "Environmental impact assessment",
    );
    expect(guess("SUBMISSION/ANNEXURE H - WATER USE LICENSE/wula.pdf")).toBe("Water use licence");
  });
});

describe("abbreviations, because that is how the folders are named", () => {
  it("reads TIA as a traffic impact assessment", () => {
    expect(
      guess("Bulk Services Planning/Roads/359 Kings Estate Residential Development_TIA_Dec 2025_Draft.pdf"),
    ).toBe("Traffic impact assessment");
  });

  it("reads a folder named ROD as a record of decision", () => {
    expect(
      guess("02 March LAND USE SUBMISSION FOLDER FINAL/ANNEXURE G - ROD/ROD_EIA DC 29 0017 10 ENVIRONMENTAL AUTHORIZATION.pdf"),
    ).toBe("Record of decision");
  });

  it("reads SWMP as a stormwater management report", () => {
    expect(guess("Bulk Services Planning/Stormwater/SWMP - Standard/SWMP.txt")).toBe(
      "Stormwater management report",
    );
  });

  it("does not match an abbreviation inside a longer word", () => {
    // "rod" must not be found in "Rodney". Tokens are matched whole.
    expect(guess("Correspondence/Rodney Meeting Notes.pdf")).not.toBe("Record of decision");
  });
});

describe("a generic noun is optional, but only with two distinctive words behind it", () => {
  it("classifies a site location drawing that never says the word plan", () => {
    expect(guess("Talani QS - for Feasibility/Sheet-Project Site Location.pdf")).toBe(
      "Site location plan",
    );
  });

  it("classifies a land use layout that never says the word plan", () => {
    expect(guess("Talani QS - for Feasibility/Copy of RSD2025-13KZN-005 - LAND USE-Layout1.pdf")).toBe(
      "Land use layout plan",
    );
  });

  it("still requires the noun where only one distinctive word would remain", () => {
    // "QS cost plan" would otherwise reduce to "cost", and match any folder of cost estimates.
    expect(guess("Fees/Cost Summary March.pdf")).not.toBe("QS cost plan");
    // "Layout plan" would otherwise reduce to "layout", and match every drawing in a set.
    expect(guess("Drawings/Layout1.pdf")).not.toBe("Layout plan");
  });

  it("prefers the more specific kind when both could match", () => {
    // Three distinctive words beat one, so the land-use layout wins over a bare layout plan.
    expect(guess("LAND USE SUBMISSION/Land Use Layout.pdf")).toBe("Land use layout plan");
  });
});

describe("no guess is a real answer", () => {
  it("declines a filename that says nothing about its kind", () => {
    expect(guess("Talani QS - for Feasibility/Copy of Wewe King_s Estate FTS Proposal.pdf")).toBeNull();
    expect(guess("Talani QS - for Feasibility/Sheet-Project Site.pdf")).toBeNull();
  });

  it("declines a drawing number with no folder to explain it", () => {
    expect(guess("Bulk Services Planning/Stormwater/2500041-CT-001-A1-revE-for info.pdf")).toBeNull();
  });

  it("names the evidence it used, so a reader can judge the guess", () => {
    const { kind, because } = inferKind("SUBMISSION/ANNEXURE E - GEOTECHNICAL REPORT/230-25.pdf", KINDS);
    expect(kind).toBe("Geotechnical report");
    expect(because).toBe("ANNEXURE E - GEOTECHNICAL REPORT");
  });
});
