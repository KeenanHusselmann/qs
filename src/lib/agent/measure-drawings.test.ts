/**
 * Which sheets a measurement reads.
 *
 * A reply has a length limit, and a real corpus runs past it: five drawings on one project
 * produced an answer that stopped mid-structure and none of it could be used. Measuring a chosen
 * few is the way out, so what has to hold is that choosing actually narrows what is sent — and
 * that it narrows the *drawings* only, because a specification is not a sheet somebody picks, it
 * is what the chosen sheets are measured against.
 *
 * Exercised against the selection rule rather than the database: the query is Drizzle's, and what
 * could break here is the filtering.
 */

import { describe, expect, it } from "vitest";

import { isSpatial } from "@/lib/ingest/document-class";

/** The rule `drawingPassages` applies, over rows shaped as it selects them. */
const keep = (rows: readonly { documentId: string; documentKind: string }[], only?: readonly string[]) => {
  const wanted = only && only.length > 0 ? new Set(only) : null;
  const kept = wanted ? rows.filter((r) => !isSpatial(r.documentKind) || wanted.has(r.documentId)) : rows;
  return [...kept.filter((r) => isSpatial(r.documentKind)), ...kept.filter((r) => !isSpatial(r.documentKind))];
};

/** Marshall Dam, as filed: five drawings and the written documents beside them. */
const rows = [
  { documentId: "wall", documentKind: "Working drawings" },
  { documentId: "survey", documentKind: "Land surveyor's drawing" },
  { documentId: "servitude", documentKind: "Working drawings" },
  { documentId: "render", documentKind: "Project presentation" },
  { documentId: "layout", documentKind: "Layout plan" },
  { documentId: "report", documentKind: "Engineering services report" },
  { documentId: "brief", documentKind: "Project brief" },
];

describe("choosing which sheets to measure", () => {
  it("sends everything when nothing is chosen", () => {
    expect(keep(rows)).toHaveLength(rows.length);
    expect(keep(rows, [])).toHaveLength(rows.length);
  });

  it("sends only the drawings chosen", () => {
    const kept = keep(rows, ["wall"]).map((r) => r.documentId);
    expect(kept).toContain("wall");
    expect(kept).not.toContain("survey");
    expect(kept).not.toContain("servitude");
  });

  it("keeps the written documents whatever is chosen", () => {
    // A specification is not a sheet a reader picks - it is what the sheets are measured against,
    // and dropping it would change how the chosen drawings are read.
    const kept = keep(rows, ["wall"]).map((r) => r.documentId);
    expect(kept).toContain("report");
    expect(kept).toContain("brief");
  });

  it("puts the drawings first, as the unchosen order does", () => {
    // The order is load-bearing: the drawings are what is measured, and a specification beside
    // them only describes it.
    const kinds = keep(rows, ["wall", "survey"]).map((r) => r.documentKind);
    const lastDrawing = kinds.map(isSpatial).lastIndexOf(true);
    const firstWritten = kinds.map(isSpatial).indexOf(false);
    expect(lastDrawing).toBeLessThan(firstWritten);
  });

  it("choosing every drawing is the same as choosing none", () => {
    const all = rows.filter((r) => isSpatial(r.documentKind)).map((r) => r.documentId);
    expect(keep(rows, all).map((r) => r.documentId).sort()).toEqual(keep(rows).map((r) => r.documentId).sort());
  });

  it("a choice that matches no drawing still sends the written documents", () => {
    // Not an empty read: the refusal a caller gets should be about finding nothing to measure,
    // which is a different thing from having sent nothing.
    const kept = keep(rows, ["nothing-like-this"]).map((r) => r.documentId);
    expect(kept.filter((id) => ["wall", "survey", "servitude", "layout"].includes(id))).toEqual([]);
    expect(kept).toContain("report");
  });

  it("an artist's impression is not a sheet to choose between", () => {
    /*
      The 3D render is filed as a Project presentation, which `isSpatial` does not count as a
      drawing - so it is never offered as a sheet and never withheld as one. That is right: a bill
      is not measured off an impression, and this test exists because the first version of the one
      above assumed it would be.
    */
    expect(keep(rows, ["wall"]).map((r) => r.documentId)).toContain("render");
  });
});
