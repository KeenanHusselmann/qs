import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { detect, isSaId } from "./detect";
import { transform } from "./transform";

/** A valid SA ID: a real date, sequence, citizenship 0/1, an 8, and the Luhn check digit. */
const saId = fc
  .record({
    yy: fc.integer({ min: 0, max: 99 }),
    mm: fc.integer({ min: 1, max: 12 }),
    dd: fc.integer({ min: 1, max: 28 }),
    seq: fc.integer({ min: 0, max: 9999 }),
    citizen: fc.constantFrom("0", "1"),
  })
  .map(({ yy, mm, dd, seq, citizen }) => {
    const body = `${String(yy).padStart(2, "0")}${String(mm).padStart(2, "0")}${String(dd).padStart(2, "0")}${String(seq).padStart(4, "0")}${citizen}8`;
    for (let check = 0; check <= 9; check++) if (isSaId(body + check)) return body + check;
    throw new Error("no check digit");
  });

/** An SA phone number, written the ways people write them. */
const phone = fc
  .record({
    area: fc.integer({ min: 10, max: 89 }),
    a: fc.integer({ min: 0, max: 999 }),
    b: fc.integer({ min: 0, max: 9999 }),
    style: fc.constantFrom("local", "spaced", "dashed", "intl", "intl-spaced", "bracketed"),
  })
  .map(({ area, a, b, style }) => {
    const A = String(a).padStart(3, "0");
    const B = String(b).padStart(4, "0");
    switch (style) {
      case "local": return `0${area}${A}${B}`;
      case "spaced": return `0${area} ${A} ${B}`;
      case "dashed": return `0${area}-${A}-${B}`;
      case "intl": return `+27${area}${A}${B}`;
      case "intl-spaced": return `+27 ${area} ${A} ${B}`;
      default: return `(0${area}) ${A} ${B}`;
    }
  });

const sentence = (pii: string) => `Contact on site: ${pii} before Friday.`;
const curated = () => "token" as const;

describe("nothing generated survives the transform", () => {
  it("SA ID numbers", () => {
    fc.assert(
      fc.property(saId, (id) => {
        const text = sentence(id);
        const out = transform(text, detect(text), curated);
        expect("text" in out && !out.text.includes(id)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it("phone numbers", () => {
    fc.assert(
      fc.property(phone, (p) => {
        const text = sentence(p);
        const out = transform(text, detect(text), curated);
        expect("text" in out && !out.text.includes(p)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it("email addresses", () => {
    fc.assert(
      fc.property(fc.emailAddress(), (email) => {
        const text = `Send it to ${email} please`;
        const out = transform(text, detect(text), curated);
        expect("text" in out && !out.text.includes(email)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });
});

describe("the figures a QS reads are left alone", () => {
  const SAFE = [
    "Total tender sum (incl. VAT): R 4 512 300.00",
    "1 046 units over 8.5 ha, 9 414 m² of paving",
    "Contract period: 32 weeks from site handover",
    "Rate R 1 850,00 per m³; quantity 12 450",
    "Erf 4521, Extension 9, 127 000 m²",
    "Programme ref 2026/11/14, revision 03",
    "B-BBEE: Level 1",
    "Concrete 25 MPa, 0.15 m thick, 1 200 m²",
  ];
  for (const text of SAFE) {
    it(text, () => expect(detect(text)).toEqual([]));
  }

  it("does not take a thirteen-digit reference that fails the ID checksum", () => {
    expect(detect("Order 8506125123082 dispatched")).toEqual([]);
  });
});

describe("the worked example from ARC-005", () => {
  const passage = [
    "Tender submitted by Kgosi Civils (Pty) Ltd, reg. no. 2016/482913/07, VAT 4870291634.",
    "Contact: Lerato Kgosi, 083 555 0142, lerato@kgosi-civils.example",
    "Director ID: 8506125123081",
    "B-BBEE: Level 1, 100% black female owned",
    "Total tender sum (incl. VAT): R 4 512 300.00",
    "Contract period: 32 weeks from site handover",
  ].join("\n");
  const known = { people: ["Lerato Kgosi"], organisations: ["Kgosi Civils (Pty) Ltd"] };

  it("keeps every figure the comparison needs and removes or replaces everything else", () => {
    const out = transform(passage, detect(passage, known), (cls) => (cls === "C4" ? "drop" : "token"));
    if (!("text" in out)) throw new Error("refused");

    for (const kept of ["R 4 512 300.00", "32 weeks", "Level 1"]) expect(out.text).toContain(kept);
    for (const gone of ["Kgosi Civils", "2016/482913/07", "4870291634", "Lerato", "083 555 0142", "lerato@", "8506125123081", "black female"]) {
      expect(out.text).not.toContain(gone);
    }
    expect(out.text).toContain("PARTY_A");
    expect(out.text).toContain("[removed: special]");
    expect(out.counts["C4 removed"]).toBe(1);
  });
});
