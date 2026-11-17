/**
 * Two checked responses for `checks/rfq.mjs`, made by the platform's own checker from extractions
 * written the way the reading agent returns them – so the page is tested on real results without
 * spending a model call. Prints them as JSON.
 */

import { checkResponse, type QuoteExtraction, type QuoteLine } from "../../src/domain/quote-check";

const found = () => ({ page: 1 });
const line = (id: string, label: string, figure: string | null, extra: Partial<QuoteLine> = {}): QuoteLine => ({ id, label, role: "item", figure, quote: figure ? `${label} ${figure}` : null, ...extra });
const SCOPE = ["Civil engineering design", "Structural engineering design"];
const REQS = ["Validity period", "Professional indemnity insurance"];

const base = (over: Partial<QuoteExtraction>): QuoteExtraction => ({
  supplier: null,
  signatory: null,
  reference: null,
  date: null,
  addressedTo: "Mzilikazi Developments",
  validity: null,
  lines: [],
  totalExclVat: null,
  totalInclVat: null,
  basis: null,
  scope: [],
  extraScope: [],
  exclusions: [],
  assumptions: [],
  requirements: [],
  ...over,
});

const alpha = checkResponse(
  base({
    supplier: "Alpha Consulting Engineers",
    signatory: "A. Mokoena Pr Eng",
    reference: "AC-114",
    date: "2 September 2026",
    lines: [
      line("A1", "Civil design fee", "R 400 000.00", { role: "fee" }),
      line("A2", "Structural design fee", "R 250 000.00", { role: "fee" }),
      line("A3", "Total fees (excl. VAT)", "R 660 000.00", { role: "total", expression: "A1+A2" }),
    ],
    totalExclVat: "A3",
    scope: [
      { item: SCOPE[0]!, status: "included", quote: "civil design", priceLine: "A1" },
      { item: SCOPE[1]!, status: "included", quote: "structural design", priceLine: "A2" },
    ],
    requirements: [
      { requirement: REQS[0]!, status: "met", evidence: "valid for 90 days" },
      { requirement: REQS[1]!, status: "not stated", evidence: null },
    ],
  }),
  found,
);

const beta = checkResponse(
  base({
    signatory: "B. Naidoo",
    reference: "Q-0098",
    date: "5 September 2026",
    lines: [
      line("B1", "Civil design fee", "R 380 000.00", { role: "fee" }),
      line("B2", "Total fees (excl. VAT)", "R 380 000.00", { role: "total", expression: "B1" }),
    ],
    totalExclVat: "B2",
    scope: [
      { item: SCOPE[0]!, status: "included", quote: "civil design", priceLine: "B1" },
      { item: SCOPE[1]!, status: "excluded", quote: "structural by others" },
    ],
    requirements: [
      { requirement: REQS[0]!, status: "not stated", evidence: null },
      { requirement: REQS[1]!, status: "met", evidence: "PI cover R5m" },
    ],
  }),
  found,
  "Beta quotation",
);

console.log(JSON.stringify({ scope: SCOPE, requirements: REQS, alpha, beta }));
