import { describe, expect, it } from "vitest";

import { isDocumentFurniture } from "@/domain/measurable";

/** The eight rows that opened a drafted bill, word for word off the contractors' spreadsheets. */
const FURNITURE = [
  "BILLS OF QUANTITIES",
  "MARSHALL DAM RESIDENTIAL ESTATE — PERIMETER BOUNDARY WALL (PORTION 22 OF ERF 27, CORNUBIA)",
  "EMPLOYER: Mzilikazi Property Services (Pty) Ltd / Sagole Capital Partners (to be confirmed)",
  "ARCHITECTURAL CONSULTANT: Mzilikazi Property Services (Pty) Ltd — drawing MDE_140926_REV7",
  "STRUCTURAL ENGINEER: NAKO Iliso — North-West Boundary Wall Structural Details, Rev 0, 14 July 2026",
  "BILLS PREPARED BY: Ndlovu Engineering Techniks (Pty) Ltd",
  "DATE: 21 September 2026",
  "OPTION: B — CEMENT STOCK BRICK SUPERSTRUCTURE (fully plastered and painted)",
];

/** Real items from the same bills. Dropping one of these would be the expensive mistake. */
const WORK = [
  "One-brick walling in stock brick",
  "Trenches for strip footings and pier footings, including stepped trench bottoms",
  "Soft rock (provisional)",
  "Hard rock (provisional)",
  "Digging up and removing rubbish, debris, vegetation, hedges, shrubs, bush, etc and trees not exceeding 200 mm girth over a strip approximately 3 m wide along the wall line",
  "Sides of trench excavations not exceeding 1,5 m deep",
  "Keeping excavations free of all water other than subterranean water",
  "Dis-establishment of the contractor on completion, including removal of all temporary works",
  "25 MPa concrete in strip footings",
  "Y12 reinforcement to footings",
  "Plaster: 12 mm steel-floated class II to both faces",
  "DPC, 375 micron USB green, 230 mm wide",
];

describe("a cover page is not a bill of work", () => {
  it.each(FURNITURE)("sets aside %s", (line) => {
    expect(isDocumentFurniture(line)).toBe(true);
  });
});

describe("and real work is kept", () => {
  it.each(WORK)("keeps %s", (line) => {
    expect(isDocumentFurniture(line)).toBe(false);
  });

  it("keeps a description that merely contains a colon", () => {
    expect(isDocumentFurniture("Excavate trench: in soft material")).toBe(false);
  });

  it("keeps a one-word entry, which is as likely an abbreviation as a heading", () => {
    expect(isDocumentFurniture("DPC")).toBe(false);
  });

  it("keeps an upper-case description that carries any lower case at all", () => {
    expect(isDocumentFurniture("25 MPa CONCRETE in strip footings")).toBe(false);
  });

  it("says nothing about an empty description – that is a different fault", () => {
    expect(isDocumentFurniture("   ")).toBe(false);
  });
});
