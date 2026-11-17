/**
 * Duplicate rows in a bill run – found by the audit of the Ridgeview bill.
 *
 * Neighbouring passages overlap, so the same line can be read twice; and a real bill repeats a
 * description in another section with another quantity, which is not a repeat at all.
 */

import { describe, expect, it } from "vitest";

import type { ItemResult } from "./bill";
import { decimalMarksOf, freshItems, withoutDuplicates } from "./extract-items";

const item = (description: string, over: Partial<ItemResult> = {}): ItemResult => ({
  section: "Earthworks",
  description,
  unit: "m³",
  quantity: null,
  quantityText: null,
  rate: null,
  rateText: null,
  confidence: 0.9,
  note: null,
  citation: null,
  ...over,
});

describe("duplicate bill rows", () => {
  it("drop the same line read twice, whatever the spacing and case", () => {
    const rows = [item("Excavate for footings", { quantityText: "9 414" }), item("excavate  for FOOTINGS", { quantityText: "9 414" })];
    expect(withoutDuplicates(rows)).toHaveLength(1);
  });

  it("keep a description repeated in another section", () => {
    const rows = [item("Excavate for footings", { section: "Block A" }), item("Excavate for footings", { section: "Block B" })];
    expect(withoutDuplicates(rows)).toHaveLength(2);
  });

  it("keep a description repeated with another quantity", () => {
    const rows = [item("Excavate for footings", { quantityText: "120" }), item("Excavate for footings", { quantityText: "80" })];
    expect(withoutDuplicates(rows)).toHaveLength(2);
  });

  it("drop an unmeasured reading of a line that was also read with its figures", () => {
    const cut = item("Excavate for footings");
    const whole = item("Excavate for footings", { quantityText: "9 414", rateText: "R 185,00" });
    expect(withoutDuplicates([cut, whole])).toEqual([whole]);
  });

  it("find a batch's new rows by identity, so an earlier row dropping out cannot cut one off", () => {
    const earlier = [item("Excavate for footings")];
    const whole = item("Excavate for footings", { quantityText: "9 414" });
    const next = item("Concrete in footings", { quantityText: "5 230" });
    expect(freshItems(earlier, [whole, next])).toEqual([whole, next]);
    expect(freshItems([whole], [item("Excavate for footings", { quantityText: "9 414" }), next])).toEqual([next]);
  });
});

describe("each document's decimal mark", () => {
  const passage = (documentId: string, body: string) => ({
    documentId,
    documentName: `${documentId}.pdf`,
    documentKind: "bill_of_quantities",
    page: 1,
    body,
  });

  it("is read over all of a document's passages, and per document", () => {
    const marks = decimalMarksOf([
      passage("sa", "Plaster to walls 1,250 m2"),
      passage("sa", "Rate R385,00 per m2"),
      passage("us", "Rate R385.00 per m2"),
      passage("mute", "Brickwork 1,250 m2"),
    ]);
    expect(marks.get("sa")).toBe(",");
    expect(marks.get("us")).toBe(".");
    expect(marks.get("mute")).toBeNull();
  });
});
