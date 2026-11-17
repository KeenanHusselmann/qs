import { describe, expect, it } from "vitest";

import { chooseAttached, figuresAllowed, numbersIn, readAnswer } from "./ask";
import type { Passage } from "@/lib/ingest/retrieve";

const passage = (documentId: string, index: number, body: string): Passage => ({ chunkId: `${documentId}:${index}`, documentId, page: index + 1, body, rank: 0 });
const names = new Map([["attachment:0", "Contract.pdf"]]);

describe("which parts of an attached document an answer reads", () => {
  it("reads the whole of a document that fits", () => {
    const doc = [passage("attachment:0", 0, "Agreement between the parties."), passage("attachment:0", 1, "Clause 14: retention is 5%.")];
    const out = chooseAttached(doc, ["retention"], 40_000, names);
    expect(out.passages).toHaveLength(2);
    expect(out.coverage).toEqual([{ name: "Contract.pdf", read: 2, total: 2 }]);
    expect(out.note).toBe("");
  });

  it("reads a long one by its opening and the parts that bear on the question, in document order", () => {
    const filler = "x".repeat(900);
    const doc = Array.from({ length: 40 }, (_, i) =>
      passage("attachment:0", i, i === 31 ? `Clause 31: the retention percentage is 5%. ${filler}` : `Clause ${i}: general conditions. ${filler}`),
    );
    const out = chooseAttached(doc, ["retention"], 3_000, names);
    expect(out.passages.map((p) => p.page)).toEqual([1, 2, 32]);
    expect(out.coverage).toEqual([{ name: "Contract.pdf", read: 3, total: 40 }]);
    expect(out.note).toMatch(/ONLY PART OF THE ATTACHED DOCUMENT/);
  });
});

describe("which figures an answer about an attachment may repeat", () => {
  const allowed = numbersIn([{ body: "The contract sum is R 12 450 000,00 excluding VAT. Retention: 5%. Completion 14 March 2027." }]);

  it("allows a figure the document writes, in the forms a reader repeats it", () => {
    expect(figuresAllowed("The contract sum is R 12 450 000,00.", allowed)).toBe(true);
    expect(figuresAllowed("The contract sum is R12,450,000.00.", allowed)).toBe(true);
    expect(figuresAllowed("The contract sum is R 12 450 000.", allowed)).toBe(true);
    expect(figuresAllowed("Completion is 14 March 2027, per clause 3.", allowed)).toBe(true);
  });

  it("refuses a figure the document does not write – a total, a conversion, a guess", () => {
    expect(figuresAllowed("Including VAT that is R 14 317 500,00.", allowed)).toBe(false);
    expect(figuresAllowed("Retention will be R 622 500.", allowed)).toBe(false);
  });

  it("keeps the sentences that quote the document and drops the one that computed", () => {
    const doc = [passage("attachment:0", 0, "The contract sum is R 12 450 000,00 excluding VAT.")];
    const answer = readAnswer(
      { answer: "The contract sum is R 12 450 000,00 excluding VAT (clause 3). With VAT it comes to R 14 317 500,00. It is a lump-sum contract.", cites: [1] },
      doc,
      names,
      null,
      [],
      { input: 0, output: 0 },
      [],
      { figures: numbersIn(doc), coverage: [{ name: "Contract.pdf", read: 1, total: 1 }] },
    );
    expect(answer.answer).toBe("The contract sum is R 12 450 000,00 excluding VAT (clause 3). It is a lump-sum contract.");
    expect(answer.attached).toEqual([{ name: "Contract.pdf", read: 1, total: 1 }]);
  });

  it("still allows no figure at all when nothing is attached", () => {
    const answer = readAnswer({ answer: "The sum is R 12 450 000,00. It is stated in the contract.", cites: [] }, [], names, null, [], { input: 0, output: 0 });
    expect(answer.answer).toBe("It is stated in the contract.");
  });
});
