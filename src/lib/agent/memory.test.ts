/**
 * The advisor's memory – what a saved web finding says, and which notes an answer rests on.
 *
 * The rule under test is provenance: a figure recalled from a note never reaches the panel without
 * the note beside it, dated and sourced.
 */

import { describe, expect, it } from "vitest";

import { memoryText, notesUsed, questionKey, webNote, wordsNeeded, type RecalledNote } from "./memory";

const found = {
  text: "",
  structured: {
    summary: "A 50 kg bag of general-purpose cement retails for about R 95,00–R 145,00.",
    points: ["PPC, AfriSam and Sephaku are the main brands"],
    table: {
      title: "Indicative 50 kg prices",
      columns: ["Brand | grade", "Price"],
      rows: [["PPC Surebuild 42,5N", "R 128,00/bag"]],
    },
    caveat: "Retail listings, not quotes.",
  },
  sources: [{ title: "Cement prices", url: "https://example.co.za/cement", retrievedAt: "2026-09-15T20:00:00.000Z" }],
};

const note = (code: string, body: string): RecalledNote => ({
  code,
  id: `id-${code}`,
  kind: "web",
  question: "cement prices",
  title: "cement prices",
  savedAt: "2026-09-15T20:00:00.000Z",
  structured: null,
  body,
  sources: [],
});

describe("a saved web finding", () => {
  it("is keyed so the same question refreshes one note", () => {
    expect(questionKey("  Cement COST, ZAR? ")).toBe(questionKey("cement cost zar"));
    expect(questionKey("cement cost")).not.toBe(questionKey("brick cost"));
  });

  it("is markdown with the answer, its table and its pages", () => {
    const { title, body } = webNote("What does cement cost?", found);
    expect(title).toBe("What does cement cost?");
    expect(body).toContain("# What does cement cost?");
    expect(body).toContain("- PPC, AfriSam and Sephaku are the main brands");
    // A pipe in a cell would split the column, so it is escaped.
    expect(body).toContain("| Brand \\| grade | Price |");
    expect(body).toContain("| PPC Surebuild 42,5N | R 128,00/bag |");
    expect(body).toContain("> Retail listings, not quotes.");
    expect(body).toContain("1. [Cement prices](https://example.co.za/cement)");
  });
});

describe("recalling notes", () => {
  it("needs one shared word for a short question and two for a longer one", () => {
    expect(wordsNeeded(0)).toBe(0);
    expect(wordsNeeded(2)).toBe(1);
    expect(wordsNeeded(3)).toBe(1);
    expect(wordsNeeded(6)).toBe(2);
  });

  it("says nothing about memory when nothing was recalled", () => {
    expect(memoryText([])).toBe("");
  });

  it("gives the model each note dated, under a code it can cite", () => {
    const text = memoryText([note("M1", "# cement prices\n\nR 128,00/bag")]);
    // "Sep" or "Sept" depending on the runtime's locale data – the date is what matters.
    expect(text).toMatch(/\[M1\] Web search on 15 Sept? 2026/);
    expect(text).toContain("R 128,00/bag");
    expect(text).toContain('"memory"');
  });
});

describe("the notes an answer rests on", () => {
  const notes = [note("M1", "PPC Surebuild R 128,00/bag"), note("M2", "Face brick R 5 200,00/1000")];

  it("are the ones the model named, and codes it invented are ignored", () => {
    expect(notesUsed(["M2", "M9"], notes, "").map((n) => n.code)).toEqual(["M2"]);
  });

  it("include a note whose figure the answer repeats without naming it", () => {
    expect(notesUsed([], notes, "A bag of PPC is about R 128,00.").map((n) => n.code)).toEqual(["M1"]);
  });

  it("do not include a note for a shared year or a small number", () => {
    const dated = [note("M1", "Tariff of 2024, clause 12")];
    expect(notesUsed([], dated, "The 2024 guideline, item 12.")).toEqual([]);
  });

  it("are none when the model used none", () => {
    expect(notesUsed(null, notes, "Cement is built into the concrete rate.")).toEqual([]);
  });
});
