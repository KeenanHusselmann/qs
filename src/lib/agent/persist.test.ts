import { describe, expect, it } from "vitest";

import { citationOf } from "./persist";

/**
 * The citation a stored row carries, and the state that broke it.
 *
 * A figure carried from an upstream step brings its *original* citation with it — the document the
 * number was actually read from, not just "the feasibility estimate". That works until the document
 * is deleted, at which point `on delete set null` clears the foreign key and keeps the name, which
 * is the designed behaviour and the whole reason the name is stored beside the id.
 *
 * The read coerced that null to `""` to satisfy a `string` type. The empty string is not null, so
 * every `?? null` downstream passed it through, and it reached a `uuid` column and failed the
 * insert — killing the run and printing a page of SQL at a quantity surveyor.
 */
describe("the citation on a stored row", () => {
  const read = {
    sourceExcerpt: "Total unit count: 1 046",
    sourceDocumentId: "3f1a9c22-0f61-4a2e-9d2c-6f0b7a5e4c11",
    sourceDocument: "Project brief.pdf",
    sourcePage: 4,
  };

  it("carries the document, the page and the passage", () => {
    expect(citationOf(read)).toEqual({
      documentId: "3f1a9c22-0f61-4a2e-9d2c-6f0b7a5e4c11",
      document: "Project brief.pdf",
      page: 4,
      quote: "Total unit count: 1 046",
    });
  });

  it("keeps null as null when the document has been deleted", () => {
    // The regression. `""` here is what crashed the carry: not null, so nothing downstream
    // caught it, and not a uuid, so Postgres would not take it.
    const orphaned = citationOf({ ...read, sourceDocumentId: null });

    expect(orphaned?.documentId).toBeNull();
    expect(orphaned?.documentId).not.toBe("");
  });

  it("still says which document it was, because that is the provenance", () => {
    // A citation whose document is gone is not a citation with nothing in it. The name is what
    // tells a reader whether to trust the figure; the id only decides whether it is a link.
    const orphaned = citationOf({ ...read, sourceDocumentId: null });

    expect(orphaned?.document).toBe("Project brief.pdf");
    expect(orphaned?.quote).toBe("Total unit count: 1 046");
  });

  it("names the absence when even the name is gone", () => {
    const nameless = citationOf({ ...read, sourceDocumentId: null, sourceDocument: null });
    expect(nameless?.document).toBe("A document no longer filed");
  });

  it("has no citation without a passage", () => {
    // A document name on its own does not say where in it the figure was, and §1.3.1 wants the
    // passage. A row with a name and no quote is not provenance.
    expect(citationOf({ ...read, sourceExcerpt: null })).toBeNull();
    expect(citationOf({ ...read, sourceExcerpt: "" })).toBeNull();
  });

  it("omits a page it does not have rather than reporting page nought", () => {
    expect(citationOf({ ...read, sourcePage: null })?.page).toBeUndefined();
  });
});
