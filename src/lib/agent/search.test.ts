/**
 * Reading a web search reply — PLATFORM.md §1.3, §6.3.
 *
 * The shape is asserted here rather than in `checks/`, because `checks/advisor.mjs` is the one
 * suite that spends money and one is enough. What matters is the provenance: a result with no URL
 * is a claim with nowhere to check it, and an answer with no result at all is the model replying
 * from memory — which is the confident wrong figure this platform exists to refuse.
 */

import { describe, expect, it } from "vitest";

import { ModelUnavailable } from "./deepseek";
import { readWebAnswer, readWebStructured } from "./search";

const reply = (content: unknown[], usage = { input_tokens: 11, output_tokens: 7 }) => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  content,
  usage,
});

const searched = (results: unknown[]) => ({
  type: "web_search_tool_result",
  tool_use_id: "call_1",
  content: results,
});

describe("reading a web answer", () => {
  it("takes the model's text and the pages behind it", () => {
    const answer = readWebAnswer(
      reply([
        { type: "server_tool_use", name: "web_search", input: { query: "BER BCIS" } },
        searched([
          { type: "web_search_result", title: "BER Building Cost Index", url: "https://www.ber.ac.za/BCIS/" },
        ]),
        { type: "text", text: "The BCIS is published quarterly by the BER." },
      ]),
    );

    expect(answer.text).toBe("The BCIS is published quarterly by the BER.");
    expect(answer.sources).toHaveLength(1);
    expect(answer.sources[0]?.url).toBe("https://www.ber.ac.za/BCIS/");
    expect(answer.sources[0]?.title).toBe("BER Building Cost Index");
  });

  /**
   * The other half of the provenance a signature would carry. A rate found on the web is true as at
   * a moment, and without that moment it is indistinguishable from a figure somebody approved.
   */
  it("stamps every source with when it was fetched", () => {
    const before = Date.now();
    const answer = readWebAnswer(
      reply([searched([{ url: "https://example.co.za/a", title: "A" }]), { type: "text", text: "x" }]),
    );

    const at = Date.parse(answer.sources[0]!.retrievedAt);
    expect(at).toBeGreaterThanOrEqual(before - 1000);
    expect(at).toBeLessThanOrEqual(Date.now() + 1000);
  });

  /**
   * The assertion this reader exists for. The model can answer without ever calling the tool, which
   * produces fluent prose resting on nothing — so that is a failure to find, not a finding.
   */
  it("refuses an answer that cites no page at all", () => {
    expect(() => readWebAnswer(reply([{ type: "text", text: "Construction costs rose about 8%." }]))).toThrow(
      ModelUnavailable,
    );
  });

  /** A result with no URL is a claim with nowhere to check it. */
  it("drops a result that has no URL", () => {
    expect(() =>
      readWebAnswer(reply([searched([{ title: "Somewhere", url: "" }]), { type: "text", text: "x" }])),
    ).toThrow(ModelUnavailable);
  });

  it("counts one page reached twice as one source", () => {
    const answer = readWebAnswer(
      reply([
        searched([
          { url: "https://example.co.za/a", title: "A" },
          { url: "https://example.co.za/a", title: "A again" },
          { url: "https://example.co.za/b", title: "B" },
        ]),
        { type: "text", text: "x" },
      ]),
    );

    expect(answer.sources.map((s) => s.url)).toEqual([
      "https://example.co.za/a",
      "https://example.co.za/b",
    ]);
  });

  it("falls back to the URL where a result carries no title", () => {
    const answer = readWebAnswer(
      reply([searched([{ url: "https://example.co.za/a" }]), { type: "text", text: "x" }]),
    );
    expect(answer.sources[0]?.title).toBe("https://example.co.za/a");
  });

  it("joins several text blocks rather than keeping only the first", () => {
    const answer = readWebAnswer(
      reply([
        searched([{ url: "https://example.co.za/a", title: "A" }]),
        { type: "text", text: "One." },
        { type: "text", text: "Two." },
      ]),
    );
    expect(answer.text).toBe("One.\n\nTwo.");
  });

  it("reports the tokens the call used", () => {
    const answer = readWebAnswer(
      reply([searched([{ url: "https://e.co/a", title: "A" }]), { type: "text", text: "x" }], {
        input_tokens: 40,
        output_tokens: 9,
      }),
    );
    expect(answer.usage).toEqual({ input: 40, output: 9 });
  });

  /** An outage is a result, not a gap (§1.3) — malformed is not "nothing found". */
  it("refuses a reply that is not a message", () => {
    expect(() => readWebAnswer(null)).toThrow(ModelUnavailable);
    expect(() => readWebAnswer("not a message")).toThrow(ModelUnavailable);
  });
});

describe("the structured web answer", () => {
  const shaped = {
    summary: "SANS 50197-1 classes cement as CEM I to CEM V.",
    points: ["CEM II is the general-purpose choice", "  ", 7],
    table: {
      title: "Indicative 50 kg prices",
      columns: ["Class", "Price"],
      rows: [["32,5N", "R 95,00–R 145,00/bag"], ["42,5N", "R 100,00–R 145,00/bag"], ["too", "many", "cells"]],
    },
    caveat: "Retail listings, not quotes.",
  };

  it("reads the parts after the model announces its search", () => {
    const answer = readWebAnswer(
      reply([
        { type: "text", text: "I'll search for that." },
        searched([{ url: "https://example.co.za/a", title: "A" }]),
        { type: "text", text: "```json\n" + JSON.stringify(shaped) + "\n```" },
      ]),
    );
    expect(answer.structured?.summary).toBe(shaped.summary);
    // Blank and non-string points are dropped, not rendered as empty bullets.
    expect(answer.structured?.points).toEqual(["CEM II is the general-purpose choice"]);
    // A row that does not match its columns would draw misaligned, so it is left out.
    expect(answer.structured?.table?.rows).toHaveLength(2);
    expect(answer.text).toContain("32,5N\tR 95,00–R 145,00/bag");
    expect(answer.text).not.toContain("I'll search");
  });

  it("drops a table with fewer than two columns or no rows", () => {
    expect(readWebStructured(JSON.stringify({ ...shaped, table: { columns: ["Only"], rows: [["x"]] } }))?.table).toBeNull();
    expect(readWebStructured(JSON.stringify({ ...shaped, table: { columns: ["A", "B"], rows: [] } }))?.table).toBeNull();
  });

  it("is no structure at all without a summary, or when the text is prose", () => {
    expect(readWebStructured(JSON.stringify({ ...shaped, summary: "" }))).toBeNull();
    expect(readWebStructured("Cement costs about R 100,00/bag.")).toBeNull();
    expect(readWebStructured("{ not json }")).toBeNull();
  });
});
