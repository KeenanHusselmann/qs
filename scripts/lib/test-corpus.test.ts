/**
 * The Ridgeview Gardens corpus — the official demonstration project's documents.
 *
 * ── What this holds ────────────────────────────────────────────────────────────────────────
 *
 * The corpus is committed, not generated on demand, because it is *input*: the checks run against
 * it, a demonstration is given from it, and a corpus that regenerated on every run would make
 * "did the extraction change, or did the document?" unanswerable. `make-test-corpus.mts` writes it
 * and this asserts that what was written still says what the platform needs it to say.
 *
 * Three separate claims, and they fail for different reasons:
 *
 *  1. **The PDFs are readable by the platform's own parser.** `unpdf` is what ingestion uses, so
 *     the test uses it too — a corpus that only a different reader can open is not a test corpus.
 *  2. **Each document classifies as itself.** `inferKind` scores the filename against the kinds
 *     the criteria accept. If it stops matching, dragging the folder in stops filing correctly,
 *     which is the flow this corpus exists to demonstrate.
 *  3. **The figures are present.** An extraction agent cannot return a unit count the document
 *     does not state. When a run comes back empty this is the first thing to rule out.
 *
 * ── Coverage is derived, never listed ──────────────────────────────────────────────────────
 *
 * The last test asks whether the corpus satisfies every *mandatory* criterion on the modules named
 * as the proof of value, and it computes that list from `DEFAULT_CRITERIA` rather than repeating
 * it. Adding a mandatory criterion to feasibility should fail this test until the corpus gains a
 * document that answers it — a hand-written list would simply go stale and keep passing.
 */

import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { extractText, getDocumentProxy } from "unpdf";

import { DOCUMENT_KINDS } from "@/lib/document-kinds";
import { DEFAULT_CRITERIA } from "@/lib/entry-criteria";
import { inferKind } from "@/lib/ingest/infer-kind";

import { SCHEME as S, money, number, verify } from "./test-scheme.mjs";

const DIR = "fixtures/ridgeview";

/** The areas Raymond named for the proof of value, and the modules that make them up. */
const PRIORITY_MODULES = [
  "/inputs",
  "/site",
  "/feasibility",
  "/cost-plan",
  "/bill",
  "/tender-analysis",
  "/contract",
  "/valuations",
  "/variations",
  "/cost-report",
];

const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".pdf"))
  .sort();

/** Read once — fifteen PDFs parsed per assertion would make this the slowest suite in the repo. */
const text = new Map<string, string>();

for (const file of files) {
  const proxy = await getDocumentProxy(new Uint8Array(readFileSync(`${DIR}/${file}`)));
  const { text: extracted } = await extractText(proxy, { mergePages: true });
  text.set(file, extracted);
}

/**
 * Compared with the spaces folded.
 *
 * The scheme formats money with U+00A0 (§7.7 — an ordinary space lets a figure wrap mid-number),
 * and the PDF writer transliterates it to an ordinary space, because that is what a real document
 * carries and what an extractor gets back. Both are right; comparing them without folding is what
 * is wrong, and it fails in a way that looks like a missing figure rather than a missing space.
 */
const flat = (value: string) => value.replace(/\s+/g, " ");
const carries = (file: string, needle: string) => flat(text.get(file) ?? "").includes(flat(needle));

describe("the scheme", () => {
  it("agrees with itself", () => {
    expect(verify()).toEqual([]);
  });
});

describe("the corpus", () => {
  it("is sixteen documents", () => {
    expect(files).toHaveLength(18);
  });

  it.each(files)("%s extracts text the platform can read", (file) => {
    expect((text.get(file) ?? "").length).toBeGreaterThan(500);
  });

  it.each(files)("%s classifies as itself", (file) => {
    expect(inferKind(file, DOCUMENT_KINDS as string[])?.kind).toBe(file.replace(/\.pdf$/, ""));
  });
});

describe("the figures a run has to find", () => {
  const expected: [string, string, string][] = [
    // The binding input. It became a required field on the feasibility run, so a corpus that
    // stopped stating it would produce a viability report with no affordability section and no
    // ceiling for anything else to be tested against.
    ["Project brief.pdf", "target income band floor", money(S.incomeBandLow)],
    ["Project brief.pdf", "target income band ceiling", money(S.incomeBandHigh)],
    ["Market study.pdf", "target income band", money(S.incomeBandHigh)],

    ["Project brief.pdf", "total unit count", number(S.units)],
    ["Project brief.pdf", "average unit area", `${S.averageUnitArea} m²`],
    ["Project brief.pdf", "erf extent", number(S.erfExtent)],
    ["Project brief.pdf", "absorption rate", String(S.absorption)],
    ["Project brief.pdf", "programme duration", String(S.programmeMonths)],
    ["Project brief.pdf", "subsidy quantum", money(S.subsidyQuantum)],
    ["Market study.pdf", "achievable selling price", money(S.averageSellingPrice)],
    ["Zoning certificate.pdf", "permitted density", String(S.permittedDensity)],
    ["QS cost plan.pdf", "total construction cost", money(S.constructionCost)],
    ["QS cost plan.pdf", "substructure", money(S.elements[0].amount)],
    ["QS cost plan.pdf", "superstructure", money(S.elements[1].amount)],
    ["QS cost plan.pdf", "estimate class", "Class 4"],
    ["Tender return.pdf", "tender closing date", S.tenderClosing],
    ["Adjudication report.pdf", "recommended tenderer", S.recommendedTender.name],
    ["Adjudication report.pdf", "lowest tender", money(S.lowestTender.corrected)],
    ["Signed contract.pdf", "contract sum", money(S.contractSum)],
    ["Signed contract.pdf", "retention limit", money(S.retentionLimit)],
    ["Signed contract.pdf", "practical completion", S.practicalCompletion],
    ["Measurement record.pdf", "value of work executed", money(S.workExecuted)],
    ["Measurement record.pdf", "certificate number", S.certificateNumber],
    ["Contract instruction.pdf", "net value", money(S.variationValue)],

    // The measured bill. Without quantities and rates in the corpus the bill step can propose items
    // and never sign one: every row arrives unmeasured.
    ["Bill of quantities.pdf", "bill total", money(S.billTotal, 2)],
    ["Bill of quantities.pdf", "excavation quantity", `m³ ${number(9_414)} ${money(185, 2)}`],
    ["Bill of quantities.pdf", "reinforcement rate", `kg ${number(620_000)} ${money(21.5, 2)}`],
    ["Bill of quantities.pdf", "vinyl rate VO-04 omits at", money(385, 2)],
    ["Bill of quantities.pdf", "preliminaries sum", money(41_200_000, 2)],
    ["Contract instruction.pdf", "instruction reference", S.instructionRef],
    ["Cost report.pdf", "forecast final cost", money(S.forecastFinalCost)],
    ["Cost report.pdf", "variance against budget", money(S.varianceAgainstBudget)],
  ];

  it.each(expected)("%s states the %s", (file, _label, needle) => {
    expect(carries(file, needle)).toBe(true);
  });
});

describe("coverage of the priority processes", () => {
  /** What the corpus can satisfy, from the filenames the classifier reads. */
  const kinds = new Set(files.map((f) => f.replace(/\.pdf$/, "")));

  const mandatory = DEFAULT_CRITERIA.filter(
    (c) => PRIORITY_MODULES.includes(c.module) && c.weight === "mandatory",
  );

  it("has mandatory criteria to cover", () => {
    expect(mandatory.length).toBeGreaterThan(10);
  });

  it.each(mandatory.map((c) => [c.module, c.label, c.acceptedEvidence] as const))(
    "%s — %s is answered by a document in the corpus",
    (_module, _label, accepted) => {
      expect(accepted.some((kind) => kinds.has(kind))).toBe(true);
    },
  );
});
