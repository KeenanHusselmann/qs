/**
 * The agent proposes archiving, so the expensive error is a false positive: a QS acting on
 * "reference only" and losing the one signed copy. These tests lean on that side — the measured
 * numbers from the real corpus are used as-is rather than rounded to make a threshold look tidy.
 */

import { describe, expect, it } from "vitest";

import { judge, revisionOf, type DocumentSignals } from "./import-agent";

/** Measured, from two A1 sheets of the same real project. See the module docstring. */
const REFERENCE_MAP_OPS = 1_230;
const TECHNICAL_DRAWING_OPS = 2_256_170;

const doc = (over: Partial<DocumentSignals> & { id: string }): DocumentSignals => ({
  filename: `${over.id}.pdf`,
  kind: "Project brief",
  spatial: false,
  pages: 4,
  characters: 8_000,
  operations: null,
  filedAt: new Date("2026-08-01T09:00:00Z"),
  ...over,
});

const verdictOf = (results: ReturnType<typeof judge>, id: string) =>
  results.find((r) => r.id === id)!;

describe("revisionOf", () => {
  it("reads the revision off a real drawing filename", () => {
    const revision = revisionOf("2500041-CT-001-A1-revE-for info.pdf");
    expect(revision?.stem).toBe("2500041 ct 001 a1 for info");
    expect(revision?.order).toBe(5);
  });

  it("orders letters and numbers within their own scheme", () => {
    expect(revisionOf("sheet-revA.pdf")!.order).toBeLessThan(revisionOf("sheet-revE.pdf")!.order);
    expect(revisionOf("plan_v2.pdf")!.order).toBeLessThan(revisionOf("plan_v10.pdf")!.order);
  });

  it("groups revisions of one sheet under one stem", () => {
    expect(revisionOf("layout rev A.pdf")!.stem).toBe(revisionOf("layout rev D.pdf")!.stem);
  });

  it("is null where there is no revision to read", () => {
    expect(revisionOf("title deed.pdf")).toBeNull();
  });
});

describe("judge — what a drawing carries", () => {
  it("calls a reference map reference-only, on its geometry", () => {
    const results = judge([
      doc({ id: "map", spatial: true, kind: "Locality map", operations: REFERENCE_MAP_OPS, characters: 183 * 6 }),
    ]);

    expect(verdictOf(results, "map").verdict).toBe("reference-only");
    expect(verdictOf(results, "map").detail).toContain("1,230");
  });

  it("keeps a technical drawing, on the same measurement", () => {
    const results = judge([
      doc({ id: "sheet", spatial: true, kind: "Services layout", operations: TECHNICAL_DRAWING_OPS, characters: 438 * 6 }),
    ]);

    expect(verdictOf(results, "sheet").verdict).toBe("carries-data");
  });

  it("does not separate them on text density, which is why operations are counted", () => {
    // Both are "a page with a title block and some labels" — 183 and 438 words. Judged on text
    // alone these two are the same document, and one of them is the site's entire geometry.
    const results = judge([
      doc({ id: "map", spatial: true, operations: REFERENCE_MAP_OPS, characters: 183 * 6 }),
      doc({ id: "sheet", spatial: true, operations: TECHNICAL_DRAWING_OPS, characters: 438 * 6 }),
    ]);

    expect(verdictOf(results, "map").verdict).not.toBe(verdictOf(results, "sheet").verdict);
  });

  it("keeps a drawing nobody has measured, rather than guessing", () => {
    const results = judge([doc({ id: "unmeasured", spatial: true, operations: null, characters: 40 })]);

    expect(verdictOf(results, "unmeasured").verdict).toBe("carries-data");
    expect(verdictOf(results, "unmeasured").detail).toMatch(/not counted/i);
  });
});

describe("judge — text documents", () => {
  it("calls a cover sheet reference-only", () => {
    const results = judge([doc({ id: "cover", characters: 120, pages: 1 })]);
    expect(verdictOf(results, "cover").verdict).toBe("reference-only");
  });

  it("keeps a real document", () => {
    const results = judge([doc({ id: "brief", characters: 8_000 })]);
    expect(verdictOf(results, "brief").verdict).toBe("carries-data");
  });

  it("keeps an unreadable document — it may need OCR, not archiving", () => {
    const results = judge([doc({ id: "scan", characters: 0, pages: 0 })]);

    expect(verdictOf(results, "scan").verdict).toBe("carries-data");
    expect(verdictOf(results, "scan").detail).toMatch(/OCR/);
  });
});

describe("judge — duplicates and revisions", () => {
  it("keeps the first filed and calls the rest copies", () => {
    const results = judge(
      [
        doc({ id: "first", filename: "deed.pdf", filedAt: new Date("2026-08-01T09:00:00Z") }),
        doc({ id: "second", filename: "deed (1).pdf", filedAt: new Date("2026-08-01T10:00:00Z") }),
      ],
      [["first", "second"]],
    );

    expect(verdictOf(results, "first").verdict).toBe("carries-data");
    expect(verdictOf(results, "second").verdict).toBe("duplicate");
    expect(verdictOf(results, "second").relatedId).toBe("first");
    expect(verdictOf(results, "second").detail).toContain("deed.pdf");
  });

  it("supersedes every earlier revision, naming the one that replaces it", () => {
    const results = judge([
      doc({ id: "a", filename: "2500041-CT-001-A1-revA.pdf" }),
      doc({ id: "c", filename: "2500041-CT-001-A1-revC.pdf" }),
      doc({ id: "e", filename: "2500041-CT-001-A1-revE.pdf" }),
    ]);

    expect(verdictOf(results, "a").verdict).toBe("superseded");
    expect(verdictOf(results, "c").verdict).toBe("superseded");
    expect(verdictOf(results, "e").verdict).toBe("carries-data");
    expect(verdictOf(results, "a").detail).toContain("revE");
  });

  it("does not supersede a lone revision", () => {
    const results = judge([doc({ id: "only", filename: "layout-revB.pdf" })]);
    expect(verdictOf(results, "only").verdict).toBe("carries-data");
  });

  it("calls a copy a duplicate rather than a thin document", () => {
    // Both verdicts would fit; they send the reader to different actions, and duplicate is the
    // one that names the other document.
    const results = judge(
      [
        doc({ id: "first", filename: "index.pdf", characters: 100 }),
        doc({ id: "copy", filename: "index copy.pdf", characters: 100, filedAt: new Date("2026-08-02T09:00:00Z") }),
      ],
      [["first", "copy"]],
    );

    expect(verdictOf(results, "copy").verdict).toBe("duplicate");
  });

  it("returns exactly one judgement per document, in order", () => {
    const documents = [doc({ id: "a" }), doc({ id: "b" }), doc({ id: "c" })];
    const results = judge(documents);

    expect(results.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});
