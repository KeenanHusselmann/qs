import { describe, expect, it } from "vitest";

import { quoteOf, readAnswer, searchTerms, type Source } from "./ask";
import type { Passage } from "@/lib/ingest/retrieve";

const usage = { input: 0, output: 0 };

const passage = (n: number, body: string, page: number | null = 1): Passage => ({
  chunkId: `c${n}`,
  documentId: `d${n}`,
  page,
  body,
  rank: 1 / n,
});

const documents = new Map([
  ["d1", "Project brief.pdf"],
  ["d2", "QS cost plan.pdf"],
  ["d3", "Market study.pdf"],
]);

describe("turning a question into something Postgres can search", () => {
  it("keeps the words that discriminate", () => {
    expect(searchTerms("What is the total unit count?")).toEqual(["total", "unit", "count"]);
  });

  it("drops the words every question contains", () => {
    // "how many" is in half the questions a QS asks and narrows none of them.
    expect(searchTerms("How many units are there?")).toEqual(["units"]);
  });

  it("keeps domain words that look like stop words", () => {
    // "rate" and "cost" are short and common in English and are the whole question here.
    expect(searchTerms("What is the rate for superstructure?")).toContain("rate");
    expect(searchTerms("What is the rate for superstructure?")).toContain("superstructure");
  });

  it("does not repeat a word", () => {
    expect(searchTerms("cost of the cost plan cost")).toEqual(["cost", "plan"]);
  });

  it("caps a rambling question rather than OR-ing twenty clauses", () => {
    const long = "substructure superstructure finishes services external preliminaries contingency escalation bulk statutory";
    expect(searchTerms(long)).toHaveLength(8);
  });

  it("survives punctuation and returns nothing for a question made of stop words", () => {
    expect(searchTerms("What is that?!")).toEqual([]);
  });
});

describe("the answer, and the figure rule it is held to", () => {
  const passages = [
    passage(1, "Total unit count: 1 046 across three typologies."),
    passage(2, "Superstructure R 168 900 000."),
  ];

  it("keeps the sentences that point at a figure", () => {
    const out = readAnswer(
      { answer: "The total unit count is stated in the project brief.", cites: [1] },
      passages,
      documents,
      null,
      [],
      usage,
    );

    expect(out.answer).toBe("The total unit count is stated in the project brief.");
  });

  it("drops a sentence that states one", () => {
    /*
      The guard that makes the whole design work. The model is told not to write figures and mostly
      does not; this is what happens when it does. A number whose first appearance is a chat panel
      traces to nothing, and it would be wearing the platform's own voice.
    */
    const out = readAnswer(
      { answer: "The scheme has 1 046 units. The count is in the project brief.", cites: [1] },
      passages,
      documents,
      null,
      [],
      usage,
    );

    expect(out.answer).toBe("The count is in the project brief.");
    expect(out.answer).not.toMatch(/1 046/);
  });

  it("keeps the good sentences rather than discarding the whole answer", () => {
    // Two sound sentences and one that slipped is still worth two sentences.
    const out = readAnswer(
      {
        answer: "The brief states the count. It gives 1046 units. The mix is on the same page.",
        cites: [1],
      },
      passages,
      documents,
      null,
      [],
      usage,
    );

    expect(out.answer).toBe("The brief states the count. The mix is on the same page.");
  });

  it("still delivers the figure — verbatim, with its document", () => {
    /*
      The other half, and the reason the rule is not a limitation. The reader asked how many units
      and they get "1 046" — out of the database, in the document's own words, with the page. The
      model never said it.
    */
    const out = readAnswer(
      { answer: "The count is stated in the project brief.", cites: [1] },
      passages,
      documents,
      null,
      [],
      usage,
    );

    expect(out.sources[0]).toEqual<Source>({
      documentId: "d1",
      document: "Project brief.pdf",
      page: 1,
      quote: "Total unit count: 1 046 across three typologies.",
    });
  });

  it("puts what the model cited first", () => {
    const out = readAnswer(
      { answer: "The rate is in the cost plan.", cites: [2] },
      passages,
      documents,
      null,
      [],
      usage,
    );

    expect(out.sources[0].document).toBe("QS cost plan.pdf");
  });

  it("still shows what it did not cite", () => {
    // The model's choice of what to cite is a judgement, and the reader is entitled to make it.
    // Retrieval was scoped to this project in SQL, so everything retrieved is theirs to read.
    const out = readAnswer({ answer: "See the cost plan.", cites: [2] }, passages, documents, null, [], usage);
    expect(out.sources).toHaveLength(2);
  });

  it("ignores a citation pointing at a passage that does not exist", () => {
    const out = readAnswer({ answer: "See the brief.", cites: [7, 0, -1] }, passages, documents, null, [], usage);
    expect(out.sources.map((s) => s.document)).toEqual(["Project brief.pdf", "QS cost plan.pdf"]);
  });

  it("names a document that has since been deleted rather than dropping the passage", () => {
    const out = readAnswer(
      { answer: "It is in a filed document.", cites: [1] },
      [passage(9, "Total unit count: 1 046.")],
      documents,
      null,
      [],
      usage,
    );

    expect(out.sources[0].document).toBe("A document no longer filed");
  });
});

describe("when the corpus has nothing to say", () => {
  it("reports that it was not grounded", () => {
    /*
      A model asked about documents it was not given will answer from what it knows of South
      African practice in general, which is a plausible paragraph about somebody else's project.
      The panel needs to be able to say so.
    */
    const out = readAnswer({ answer: "Nothing filed covers that." }, [], documents, null, [], usage);

    expect(out.grounded).toBe(false);
    expect(out.sources).toEqual([]);
  });

  it("is grounded the moment a passage was retrieved", () => {
    const out = readAnswer({ answer: "See the brief." }, [passage(1, "Erf 4127.")], documents, null, [], usage);
    expect(out.grounded).toBe(true);
  });
});

describe("a reply that cannot be used", () => {
  it("comes back empty rather than half-formed", () => {
    // Every sentence stated a figure. `askOrExplain` turns this into a refusal the panel shows.
    const out = readAnswer({ answer: "It is 1046. The rate is R2 700." }, [], documents, null, [], usage);
    expect(out.answer).toBe("");
  });

  it("survives a reply that is not shaped like a reply at all", () => {
    for (const junk of [null, undefined, {}, { answer: 42 }, { answer: "", cites: "no" }]) {
      expect(() => readAnswer(junk, [], documents, null, [], usage)).not.toThrow();
    }
  });
});

describe("quoting a chunk that was split on length", () => {
  it("drops a leading part-word and marks the cut", () => {
    // Chunking splits on characters, not on language. "nsion 9, 127 000 m²" is what a reader saw.
    expect(quoteOf("nsion 9, 127 000 m² Permitted use")).toBe("… 9, 127 000 m² Permitted use");
  });

  it("leaves a passage that begins on a real word alone", () => {
    expect(quoteOf("Extension 9, 127 000 m².")).toBe("Extension 9, 127 000 m².");
  });

  it("does not mistake a capitalised opening for a fragment", () => {
    // A chunk starting mid-sentence but on a whole word is fine, and most start capitalised.
    expect(quoteOf("MZILIKAZI QUANTITY SURVEYORS")).toBe("MZILIKAZI QUANTITY SURVEYORS");
  });

  it("leaves the end alone, because a cut there cannot be told from a word", () => {
    /*
      A trailing trim was written and removed. "MZILIKAZI QUANTITY SURVEYORS" ends on a whole word
      with no punctuation and is indistinguishable from a word cut in half, so trimming took real
      text as often as broken text. A partial word at the end costs a reader nothing; a missing
      one can cost them the figure.
    */
    expect(quoteOf("Bulk services contribution R 42 300 000 and the remain")).toBe(
      "Bulk services contribution R 42 300 000 and the remain",
    );
  });

  it("never loses a figure to the trim", () => {
    // The whole point of showing a passage is the number in it. The trim may only remove a token
    // that was already broken — never one a reader could read.
    const body = "nsion 9 Bulk services contribution R 42 300 000 per the agreement.";
    expect(quoteOf(body)).toContain("R 42 300 000");
  });
});

/*
  ── General guidance — the channel a tester was missing ─────────────────────────────────────

  A reader who copied "absorption rate" off the screen was told nothing in the documents matched.
  The general channel explains the term and where its data comes from, and may use numbers a
  standard is named by. What it may never do is repeat this project's own figure in the model's
  voice — that still reaches the reader only as a quote with its document.
*/
describe("general guidance", () => {
  const passages = [
    passage(1, "The total unit count is 240."),
    passage(3, "Absorption rate 12-15 units/month. Expected selling price R850 000 per unit."),
  ];

  it("explains a term even when no document answers it", () => {
    const out = readAnswer(
      {
        answer: "None of the filed documents defines it.",
        general: {
          explanation: "The absorption rate is how quickly units sell in a market. It drives the cash flow.",
          whereToGet: ["A market study or absorption analysis by a property economist"],
          inPlatform: "File it against Market data on the Feasibility Estimate.",
        },
      },
      [],
      documents,
      null,
      [],
      usage,
    );

    expect(out.general?.explanation).toMatch(/how quickly units sell/);
    expect(out.general?.whereToGet).toHaveLength(1);
    expect(out.general?.inPlatform).toMatch(/Market data/);
  });

  it("keeps a standard's number, because a general explanation needs one", () => {
    const out = readAnswer(
      { answer: "", general: { explanation: "Energy use is governed by SANS 10400-XA.", whereToGet: [] } },
      passages,
      documents,
      null,
      [],
      usage,
    );

    expect(out.general?.explanation).toBe("Energy use is governed by SANS 10400-XA.");
  });

  it("drops a sentence that repeats this project's figure, however it is spaced", () => {
    const out = readAnswer(
      {
        answer: "",
        general: {
          explanation:
            "Absorption is the pace of sales. On this scheme it is 12-15 units a month. The selling price here is R850000.",
          whereToGet: ["Your sales outlook states 240 units", "A property economist's market study"],
        },
      },
      passages,
      documents,
      null,
      [],
      usage,
    );

    expect(out.general?.explanation).toBe("Absorption is the pace of sales.");
    expect(out.general?.whereToGet).toEqual(["A property economist's market study"]);
  });

  it("is null when the model gave nothing usable", () => {
    const out = readAnswer({ answer: "x", general: { explanation: "", whereToGet: [] } }, passages, documents, null, [], usage);
    expect(out.general).toBeNull();
    expect(readAnswer({ answer: "x", general: "null" }, passages, documents, null, [], usage).general).toBeNull();
  });

  it("marks a passage from an attachment as attached, never as a filed document", () => {
    const attached: Passage = { chunkId: "a", documentId: "attachment:0", page: null, body: "Bulk contribution R2 400 000.", rank: 0 };
    const out = readAnswer(
      { answer: "The attached schedule states the contribution.", cites: [1] },
      [attached],
      new Map([["attachment:0", "Bulk schedule.xlsx"]]),
      null,
      [],
      usage,
    );

    expect(out.sources[0]).toMatchObject({ document: "Bulk schedule.xlsx", attached: true });
  });
});
