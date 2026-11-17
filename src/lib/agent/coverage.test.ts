/**
 * A requirement met on the model's say-so is the failure this guards, so the reply is tested on the
 * side that matters: a "yes" counts only with a quote that is really in the document.
 */

import { describe, expect, it } from "vitest";

import { coveragePrompt, readCoverage } from "./coverage";
import { DEFAULT_CRITERIA } from "@/lib/entry-criteria";

const usage = { input: 10, output: 5 };

// The tester's document: states the market data, never says "market study".
const OUTLOOK = [
  {
    documentId: "doc-1",
    page: 2,
    body: "Sunridge Estate – Sales Outlook\nEnquiries from the Midrand show village support the absorption rate (12-15 units/month).",
  },
];

const market = DEFAULT_CRITERIA.find((c) => c.id === "d1.1-market")!;

describe("readCoverage", () => {
  it("accepts a yes whose quote is in the document, and returns the document's characters", () => {
    const result = readCoverage(
      { covered: true, quote: "support the absorption rate (12-15 units/month)" },
      OUTLOOK,
      usage,
    );
    expect(result.covered).toBe(true);
    expect(result.quote).toBe("support the absorption rate (12-15 units/month)");
    expect(result.page).toBe(2);
  });

  it("refuses a yes whose quote the document does not contain", () => {
    const result = readCoverage(
      { covered: true, quote: "The market study confirms strong demand in the catchment." },
      OUTLOOK,
      usage,
    );
    expect(result).toMatchObject({ covered: false, quote: null });
  });

  it("refuses a yes with no quote at all", () => {
    expect(readCoverage({ covered: true, quote: null }, OUTLOOK, usage).covered).toBe(false);
    expect(readCoverage({ covered: true }, OUTLOOK, usage).covered).toBe(false);
  });

  it("reads anything that is not a plain true as not covered", () => {
    expect(readCoverage({ covered: "yes", quote: "absorption rate (12-15 units/month)" }, OUTLOOK, usage).covered).toBe(false);
    expect(readCoverage(null, OUTLOOK, usage).covered).toBe(false);
  });
});

describe("coveragePrompt", () => {
  it("names the requirement and what would normally satisfy it, and carries the document", () => {
    const prompt = coveragePrompt(market, OUTLOOK);
    expect(prompt).toContain("Market data");
    expect(prompt).toContain("Market study");
    expect(prompt).toContain("12-15 units/month");
  });
});
