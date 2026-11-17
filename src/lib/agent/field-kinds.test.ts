import { describe, expect, it } from "vitest";

import { FIELD_SETS_BY_MODULE } from "./run";
import { FIELD_KINDS, checkFieldValue } from "./field-kinds";

describe("field kinds", () => {
  it("every field in every field set declares a kind", () => {
    const missing = Object.values(FIELD_SETS_BY_MODULE)
      .flat()
      .map((field) => field.id)
      .filter((id) => !(id in FIELD_KINDS));
    expect(missing).toEqual([]);
  });

  it("names nothing that is not a field", () => {
    const ids = new Set(Object.values(FIELD_SETS_BY_MODULE).flat().map((field) => field.id));
    expect(Object.keys(FIELD_KINDS).filter((id) => !ids.has(id))).toEqual([]);
  });
});

describe("checkFieldValue", () => {
  it("refuses a number as the list of tenderers – the audit's C4 case", () => {
    expect(checkFieldValue("names", "421000").ok).toBe(false);
    expect(checkFieldValue("names", "Group Five, WBHO, Murray & Roberts").ok).toBe(true);
  });

  it("reads money the way a document's amount is read, refusing what is uncertain", () => {
    expect(checkFieldValue("money", "R186 420 000,00").ok).toBe(true);
    expect(checkFieldValue("money", "1,234").ok).toBe(false);
    expect(checkFieldValue("money", "R42 000,00 per calendar day").ok).toBe(false);
  });

  it("takes a count as a whole number, grouped or not", () => {
    expect(checkFieldValue("count", "1 046").ok).toBe(true);
    expect(checkFieldValue("count", "1046").ok).toBe(true);
    expect(checkFieldValue("count", "10,5").ok).toBe(false);
    expect(checkFieldValue("count", "about 1000").ok).toBe(false);
  });

  it("holds a percentage between 0 and 100", () => {
    expect(checkFieldValue("percent", "5%").ok).toBe(true);
    expect(checkFieldValue("percent", "5").ok).toBe(true);
    expect(checkFieldValue("percent", "150%").ok).toBe(false);
  });

  it("reads dates day first and refuses the ones that are not", () => {
    expect(checkFieldValue("date", "31/03/2027").ok).toBe(true);
    expect(checkFieldValue("date", "12 Aug 2026").ok).toBe(true);
    expect(checkFieldValue("date", "08/14/2026").ok).toBe(false);
    expect(checkFieldValue("date", "next spring").ok).toBe(false);
  });

  it("refuses an empty value whatever the kind, and leaves prose alone", () => {
    expect(checkFieldValue("text", "  ").ok).toBe(false);
    expect(checkFieldValue("text", "JBCC PBA, edition 6.2").ok).toBe(true);
  });
});
