/**
 * Where a passage is allowed to end.
 *
 * A bill item reached a drafted bill reading "all (TOW) levels, foundation step levels and pier
 * positions from the land surveyor's pegs" — the back half of a description cut at `top-of-w`.
 * These hold the boundary to a word gap, which is what the splitter always claimed to do.
 */

import { describe, expect, it } from "vitest";

import { splitIntoPassages } from "@/lib/ingest/split";

const passagesOf = (text: string) => splitIntoPassages({ pages: [{ page: 1, text }] } as never);

/** A contractor's preliminaries: one long line, no blank lines, the shape that broke it. */
const ROW =
  "Setting out of the works, including establishing and confirming top-of-wall (TOW) levels, " +
  "foundation step levels and pier positions from the land surveyor's pegs, and maintaining " +
  "setting-out throughout | C48=Item | D48=1 | F48=0 ";

describe("a passage ends where a reader would stop", () => {
  const passages = passagesOf(ROW.repeat(20));

  it("splits a long line into several passages", () => {
    expect(passages.length).toBeGreaterThan(1);
  });

  it("never begins in the middle of a word", () => {
    /*
      The tell is the join: if a passage starts mid-word, the character before it in the source is
      a letter. Checked against the source rather than by eye, because "top-of-w" / "all" looks
      like two perfectly good words.
    */
    const source = ROW.repeat(20);
    for (const passage of passages.slice(1)) {
      const at = source.indexOf(passage.text);
      expect(at).toBeGreaterThan(-1);
      expect(source[at - 1]).toMatch(/\s/);
    }
  });

  it("never ends in the middle of a word", () => {
    const source = ROW.repeat(20);
    for (const passage of passages.slice(0, -1)) {
      const at = source.indexOf(passage.text);
      expect(source[at + passage.text.length]).toMatch(/\s/);
    }
  });

  it("does not lose the words at a boundary", () => {
    // The overlap exists so a phrase spanning a boundary appears whole in the next passage.
    expect(passages.some((p) => p.text.includes("top-of-wall (TOW) levels"))).toBe(true);
  });
});

describe("it still prefers the larger break", () => {
  it("breaks at a paragraph when there is one in the last third", () => {
    const text = `${"a ".repeat(500)}\n\n${"b ".repeat(500)}`;
    const [first] = passagesOf(text);
    expect(first.text.endsWith("a")).toBe(true);
    expect(first.text).not.toContain("b");
  });

  it("breaks at the end of a sentence in preference to any word gap", () => {
    const text = `${"word ".repeat(200)}End of it. ${"more ".repeat(200)}`;
    const [first] = passagesOf(text);
    expect(first.text.endsWith("End of it.")).toBe(true);
  });

  it("a short page is one passage and is not cut at all", () => {
    expect(passagesOf("A short preliminaries note.")).toEqual([
      { index: 0, page: 1, text: "A short preliminaries note." },
    ]);
  });
});
