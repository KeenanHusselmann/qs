import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { checkResponse, type QuoteExtraction, type QuoteLine } from "@/domain/quote-check";
import { rfqWorkbook, type WorkbookResponse } from "@/lib/report/rfq-workbook";
import type { RfqView } from "@/lib/rfq";
import { recommend } from "@/domain/quote-check";

const found = () => ({ page: 1 });
const line = (id: string, label: string, figure: string | null, extra: Partial<QuoteLine> = {}): QuoteLine => ({ id, label, role: "item", figure, quote: `${label} ${figure}`, ...extra });
const SCOPE = ["Civil engineering design"];
const REQS = ["Validity period"];

const extraction = (over: Partial<QuoteExtraction>): QuoteExtraction => ({
  supplier: "A firm", signatory: null, reference: "REF-1", date: "2 September 2026", addressedTo: "The client", validity: null,
  lines: [], totalExclVat: null, totalInclVat: null, basis: null, scope: [], extraScope: [], exclusions: [], assumptions: [], requirements: [],
  ...over,
});

/** A response priced on a cost of works, with a fee formula and a stage apportionment. */
const feeProposal = extraction({
  supplier: "Alpha Engineers",
  lines: [
    line("L1", "Roads", "R 100 000 000.00", { quantity: "76 375", rate: "1 315" }),
    line("L2", "Cost of works", "R 100 000 000.00", { role: "subtotal", expression: "L1" }),
    line("L3", "Fee on the cost of works", "R 7 454 400.00", { role: "fee", expression: "7454400" }),
    line("L4", "Stage 1 Inception", "R 745 440.00", { role: "fee", expression: "L3*0.10" }),
    line("L5", "Stage 3 Design development", "R 1 863 600.00", { role: "fee", expression: "L3*0.25" }),
    line("L6", "Stage 5 Contract administration", "R 1 863 600.00", { role: "fee", expression: "L3*0.25" }),
  ],
  totalExclVat: "L3",
  basis: { label: "Cost of works", figure: "R 100 000 000.00", quote: "cost of works R 100 000 000.00" },
  fee: { formula: "7454400 + 0.09*(BASIS - 94960000)", basisLine: "L2", feeLine: "L3" },
  discount: "15%",
  scope: [{ item: SCOPE[0]!, status: "included", quote: "civil design", priceLine: "L3", basis: "R 100 000 000.00" }],
  requirements: [{ requirement: REQS[0]!, status: "met", evidence: "valid 90 days" }],
  countTables: [
    {
      title: "Team hours",
      columns: ["St 1", "St 3", "Total h"],
      rows: [
        { label: "Engineer", cells: ["40", "120", "160"], lastIsTotal: true },
        { label: "Total", cells: ["40", "120", "161"], lastIsTotal: true, sums: [0] },
      ],
    },
  ],
  observations: [{ text: "Section 3.5 is referred to but not in the document.", quotes: ["see 3.5"] }],
});

/** A plain quotation: a price, no cost of works, no stages, no hours. */
const plain = extraction({
  supplier: "Beta Supplies",
  lines: [
    line("B1", "Item one", "R 10 000.00"),
    line("B2", "Item two", "R 5 000.00"),
    line("B3", "Total", "R 16 000.00", { role: "total", expression: "B1+B2" }),
  ],
  totalExclVat: "B3",
  scope: [{ item: SCOPE[0]!, status: "included", quote: "supplied", priceLine: "B3" }],
  requirements: [{ requirement: REQS[0]!, status: "not stated", evidence: null }],
});

function build(extractions: QuoteExtraction[]): { rfq: RfqView; responses: WorkbookResponse[] } {
  const results = extractions.map((e) => checkResponse(e, found));
  const responses: WorkbookResponse[] = extractions.map((e, i) => ({
    name: results[i]!.supplier,
    documentName: `${results[i]!.supplier}.pdf`,
    evaluatedAt: "2026-09-23T10:00:00.000Z",
    result: results[i]!,
    extraction: e,
  }));
  const rfq: RfqView = {
    id: "rfq-1",
    title: "Civil engineering services",
    scope: [...SCOPE],
    requirements: [...REQS],
    responses: [],
    evaluated: [],
    recommendation: recommend(results),
    decision: null,
    createdAt: "2026-09-23T08:00:00.000Z",
  };
  return { rfq, responses };
}

const subject = { practice: "Mzilikazi Property Services", projectName: "Marshall Dam", code: "MD-01", client: "The client", issuedBy: "The QS", issuedOn: "23 September 2026" };

async function open(bytes: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  return wb;
}

describe("the comparative evaluation workbook", () => {
  it("recomputes each line as a live formula over the response's own figures", async () => {
    const { rfq, responses } = build([feeProposal, plain]);
    const wb = await open(await rfqWorkbook(rfq, responses, subject));
    const ws = wb.getWorksheet("Fee Recalculation")!;

    // Beta's total is B1+B2 in the document; in the sheet it is the sum of those two rows.
    let total: ExcelJS.Row | undefined;
    ws.eachRow((row) => {
      if (row.getCell(1).value === "Total") total = row;
    });
    expect(total).toBeDefined();
    const formula = (total!.getCell(6).value as { formula: string }).formula;
    expect(formula).toMatch(/^F\d+\+F\d+$/);
    // The rows it points at are the two item rows, and they carry the printed figures.
    const [a, b] = formula.match(/\d+/g)!.map(Number);
    expect(ws.getRow(a!).getCell(5).value).toBe(10_000);
    expect(ws.getRow(b!).getCell(5).value).toBe(5_000);
    // The check is a formula too, so a reader can change a figure and watch the verdict follow.
    expect((total!.getCell(8).value as { formula: string }).formula).toContain("error");
    // And the platform's own verdict is beside it.
    expect(total!.getCell(9).value).toBe("error");
  });

  it("puts each firm's own fee formula over one cost of works, with the discount taken once", async () => {
    const { rfq, responses } = build([feeProposal, plain]);
    const wb = await open(await rfqWorkbook(rfq, responses, subject));
    const ws = wb.getWorksheet("Fee Recalculation")!;
    let fee: ExcelJS.Row | undefined;
    ws.eachRow((row) => {
      if (String(row.getCell(1).value ?? "").startsWith("Fee on that cost of works")) fee = row;
    });
    expect(fee).toBeDefined();
    // BASIS became the input cell above it, and nothing else in the formula changed.
    expect((fee!.getCell(6).value as { formula: string }).formula).toMatch(/^7454400 \+ 0\.09\*\(E\d+ - 94960000\)$/);
    const net = ws.getRow(fee!.number + 1);
    expect(String(net.getCell(1).value)).toContain("15%");
    expect((net.getCell(6).value as { formula: string }).formula).toBe(`F${fee!.number}*0.85`);
  });

  it("carries the counts, the document queries and the gaps into a register with severities", async () => {
    const { rfq, responses } = build([feeProposal, plain]);
    const wb = await open(await rfqWorkbook(rfq, responses, subject));
    const ws = wb.getWorksheet("Gaps and Anomalies")!;
    const rows: string[] = [];
    ws.eachRow((row) => rows.push(`${row.getCell(2).value} | ${row.getCell(3).value} | ${row.getCell(7).value}`));
    const text = rows.join("\n");
    expect(text).toMatch(/Beta Supplies \| Total does not add up \| High/);
    expect(text).toMatch(/Alpha Engineers \| Team hours – Total – Total h: 161 stated, 160 .* \| Low/);
    expect(text).toMatch(/Alpha Engineers \| Section 3\.5 is referred to but not in the document\. \| Medium/);
    expect(text).toMatch(/Beta Supplies \| Validity period: not stated \| Medium/);
  });

  it("brings only the sheets the responses support", async () => {
    const rich = await open(await rfqWorkbook(...(({ rfq, responses }) => [rfq, responses, subject] as const)(build([feeProposal, plain]))));
    expect(rich.worksheets.map((w) => w.name)).toEqual([
      "Summary",
      "Fee Recalculation",
      "Like for Like",
      "Cost of Works",
      "Stage Apportionment",
      "Resources and Rates",
      "Scope and Compliance",
      "Gaps and Anomalies",
      "Clarifications",
      "Basis and Notes",
    ]);

    // A quotation with a price and nothing else brings none of the fee sheets.
    const { rfq, responses } = build([plain]);
    const bare = await open(await rfqWorkbook(rfq, responses, subject));
    expect(bare.worksheets.map((w) => w.name)).toEqual(["Summary", "Fee Recalculation", "Like for Like", "Scope and Compliance", "Gaps and Anomalies", "Clarifications", "Basis and Notes"]);
  });

  it("leaves the budget and the practice's own estimate as input cells the summary reads", async () => {
    const { rfq, responses } = build([feeProposal, plain]);
    const wb = await open(await rfqWorkbook(rfq, responses, subject));
    const like = wb.getWorksheet("Like for Like")!;
    let budget: ExcelJS.Row | undefined;
    like.eachRow((row) => {
      if (String(row.getCell(1).value ?? "").startsWith("Client budget")) budget = row;
    });
    expect(budget).toBeDefined();
    expect(budget!.getCell(2).value).toBeNull();
    expect((budget!.getCell(2).fill as ExcelJS.FillPattern).fgColor?.argb).toBe("FFFFF3D1");
    // The summary reads the variance from this sheet rather than restating it.
    const summary = wb.getWorksheet("Summary")!;
    let variance: ExcelJS.Row | undefined;
    summary.eachRow((row) => {
      if (String(row.getCell(1).value ?? "").startsWith("Over / (under)")) variance = row;
    });
    expect((variance!.getCell(2).value as { formula: string }).formula).toContain("'Like for Like'!");
  });
});
