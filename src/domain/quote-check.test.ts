import { describe, expect, it } from "vitest";

import { checkLines, checkResponse, checkTallies, distinctFigure, tablesToTallies, isSalutation, placeholder, recommend, type QuoteExtraction, type QuoteLine } from "@/domain/quote-check";

const found = () => ({ page: 1 });
const line = (id: string, label: string, figure: string | null, extra: Partial<QuoteLine> = {}): QuoteLine => ({ id, label, role: "item", figure, quote: figure ? `${label} ${figure}` : null, ...extra });

// Lemken's Table 2 and Table 3, as the proposal prints them.
const lemken: QuoteLine[] = [
  line("L1", "Roads & Parking", "R 100 433 125.00", { quantity: "76 375", rate: "R 1 315.00" }),
  line("L2", "Stormwater reticulation", "R 15 525 000.00", { quantity: "3 000", rate: "R 5 175.00" }),
  line("L3", "Water Network", "R 4 151 500.00", { quantity: "1 900", rate: "R 2 185.00" }),
  line("L4", "Sewer Network", "R 4 700 500.00", { quantity: "1 700", rate: "R 2 765.00" }),
  line("L5", "BEW", "R 9 000 000.00"),
  line("L6", "Subtotal 1", "R 124 810 125.00", { role: "subtotal", expression: "L1+L2+L3+L4+L5" }),
  line("L7", "P & G's 10%", "R 12 481 012.50", { role: "adjustment", expression: "L6*0.10" }),
  line("L8", "Subtotal 2", "R 137 291 137.50", { role: "subtotal", expression: "L6+L7" }),
  line("L9", "Contingencies 10%", "R 13 729 113.75", { role: "adjustment", expression: "L8*0.10" }),
  line("L10", "Total construction cost ex VAT", "R 151 020 251.25", { role: "total", expression: "L8+L9" }),
  line("L11", "Fee calculated using ECSA guideline", "R 12 444 283.60", { role: "fee", expression: "7454400 + 0.09*(150403151.25 - 94960000)" }),
  line("L12", "Discount proposed 15%", "R 1 866 642.50", { role: "discount", expression: "L11*0.15" }),
  line("L13", "Proposed fee (EXC VAT)", "R 10 577 641.10", { role: "total", expression: "L11-L12" }),
];

describe("checking a quotation's arithmetic", () => {
  it("finds the R9 000 000 left out of Lemken's subtotal, and nowhere else", () => {
    const out = checkLines(lemken, found);
    const l = Object.fromEntries(out.map((x) => [x.id, x]));
    expect(l.L1!.verdict).toBe("agrees");
    expect(l.L6).toMatchObject({ verdict: "error", stated: 12_481_012_500, computed: 13_381_012_500 });
    // The ten per cent is right about the figure it was given – consequential, not a second error.
    expect(l.L7).toMatchObject({ verdict: "consequential", corrected: 1_338_101_250 });
    expect(l.L10).toMatchObject({ verdict: "consequential", corrected: 16_191_025_125 });
    expect(l.L11!.verdict).toBe("agrees");
    // 15% of R12 444 283,60 is R1 866 642,54; the proposal says ,50 – four cents, rounding.
    expect(l.L12!.verdict).toBe("rounding");
    expect(l.L13!.verdict).toBe("agrees");
    expect(out.filter((x) => x.verdict === "error").map((x) => x.id)).toEqual(["L6"]);
  });

  it("finds MUTEC's R440, and that its VAT was worked on the right figure", () => {
    const out = checkLines(
      [
        line("M1", "Civil engineering fee", "R 7,770,189.00", { role: "fee" }),
        line("M2", "Structural engineering fee", "R 13,621,678.00", { role: "fee" }),
        line("M3", "Sub-total 1", "R 21,391,867.00", { role: "subtotal", expression: "M1+M2" }),
        line("M4", "Reimbursable expenses", "R 850,000.00"),
        line("M5", "Sub-total 2", "R 22,241,867.00", { role: "subtotal", expression: "M3+M4" }),
        line("M6", "Less 35% discount", "R 7,784,653.45", { role: "discount", expression: "M5*0.35" }),
        line("M7", "Total fees (excl. VAT)", "R 14,457,653.55", { role: "total", expression: "M5-M6" }),
        line("M8", "VAT @ 15%", "R 2,168,582.03", { role: "vat", expression: "M7*0.15" }),
      ],
      found,
    );
    const m = Object.fromEntries(out.map((x) => [x.id, x]));
    expect(m.M7).toMatchObject({ verdict: "error", stated: 1_445_765_355, computed: 1_445_721_355, corrected: 1_445_721_355 });
    // 15% of the stated R14 457 653,55 is R2 168 648,03; the quotation's R2 168 582,03 is 15% of the right one.
    // Right on the corrected total – so it agrees, and says the error is the line above it.
    expect(m.M8!.verdict).toBe("agrees");
    expect(m.M8!.corrected).toBe(216_858_203);
    expect(m.M8!.note).toMatch(/error is in the line it reads/);
  });

  it("does not check a figure it cannot find or read", () => {
    const out = checkLines([line("X1", "Total", "R 1 250.00", {})], () => null);
    expect(out[0]!.verdict).toBe("not found");
    const unread = checkLines([line("X2", "Total", "twelve million", { expression: "1" })], found);
    expect(unread[0]!.verdict).toBe("unreadable");
  });
});

const response = (supplier: string, lines: QuoteLine[], total: string, scope: ("included" | "excluded" | "not stated")[], extra: string[] = [], basis: string | null = null): QuoteExtraction => ({
  supplier,
  reference: null,
  date: null,
  addressedTo: null,
  validity: null,
  lines,
  totalExclVat: total,
  totalInclVat: null,
  basis: basis ? { label: "Cost of works", figure: basis, quote: null } : null,
  scope: ["Civil engineering design", "Structural engineering", "Construction monitoring"].map((item, i) => ({ item, status: scope[i]!, quote: null })),
  extraScope: extra,
  exclusions: [],
  assumptions: [],
  requirements: [
    { requirement: "Validity period", status: "not stated", evidence: null },
    { requirement: "B-BBEE status", status: "not stated", evidence: null },
  ],
});

describe("recommending", () => {
  const L = checkResponse(response("Lemken Group", lemken, "L13", ["included", "not stated", "included"], [], "R 150 403 151.25"), found);
  const M = checkResponse(
    response("MUTEC", [line("M1", "Total fees (excl. VAT)", "R 14,457,213.55", { role: "total" })], "M1", ["included", "included", "included"], [], "R 706 498 725"),
    found,
  );

  it("prefers the response that covers the scope, and says the totals are not comparable when scopes differ", () => {
    const r = recommend([L, M]);
    expect(r.preferred).toBe(1);
    expect(r.comparable).toBe(false);
    expect(r.headline).toMatch(/cannot be ranked on price as submitted/);
    expect(r.headline).toMatch(/MUTEC is provisionally preferred/);
    expect(r.clarifications[0]).toMatch(/price the same scope on a common basis/);
    expect(r.clarifications.some((c) => /Lemken Group: confirm subtotal 1 – the quotation states R 124 810 125,00, and its own figures give R 133 810 125,00/.test(c))).toBe(true);
    expect(r.clarifications.some((c) => /Lemken Group: confirm whether the price includes structural engineering/.test(c))).toBe(true);
    expect(r.clarifications.some((c) => /MUTEC: the response does not show – validity period; B-BBEE status/.test(c))).toBe(true);
  });

  it("recommends the lowest corrected price outright when the scopes are the same", () => {
    const cheap = checkResponse(response("A", [line("A1", "Total", "R 900 000.00", { role: "total" })], "A1", ["included", "included", "included"]), found);
    const dear = checkResponse(response("B", [line("B1", "Total", "R 1 000 000.00", { role: "total" })], "B1", ["included", "included", "included"]), found);
    const r = recommend([dear, cheap]);
    expect(r).toMatchObject({ preferred: 1, comparable: true, ranking: [1, 0] });
    expect(r.headline).toMatch(/^A is recommended/);
  });

  it("never takes the addressee for the respondent", () => {
    const client = checkResponse({ ...response("Tigane Developers", [line("T1", "Total", "R 1 000.00", { role: "total" })], "T1", ["included", "included", "included"]), addressedTo: "Tigane Developers", signatory: "K Nthejane" }, found, "Fees Proposal.pdf");
    expect(client).toMatchObject({ supplier: "Fees Proposal.pdf", named: false, signatory: "K Nthejane" });
    expect(recommend([client]).clarifications[0]).toMatch(/firm's name is not in the response's text \(signed by K Nthejane\) – confirm who submitted it/);
  });

  it("gives each response's price as a percentage of its own basis", () => {
    expect(L.effectiveRate).toBe(7.03);
  });
});

describe("the checks my own audit made", () => {
  // Lemken as the audit read it: the fee formula on BASIS, the construction estimate at L10, 15% off.
  const lemkenFull: QuoteExtraction = {
    ...response("Lemken Group", lemken, "L13", ["included", "not stated", "not stated"], [], "R 150 403 151.25"),
    discount: "15%",
    fee: { formula: "7454400 + 0.09*(BASIS - 94960000)", basisLine: "L10", feeLine: "L11" },
    facts: [{ fact: "Site extent", value: "12,9 ha", quote: null }],
    risks: [],
  };
  lemkenFull.scope[0] = { ...lemkenFull.scope[0]!, priceLine: "L11", basis: "R 150 403 151.25" };
  const mutecFull: QuoteExtraction = {
    ...response("MUTEC", [line("M1", "Adjusted civil fee", "R 7,770,189.00", { role: "fee" }), line("M2", "Structural fee", "R 13,621,678.00", { role: "fee" }), line("M3", "Total fees (excl. VAT)", "R 14,457,213.55", { role: "total" })], "M3", ["included", "included", "included"], ["Reimbursable expenses"], "R 706 498 725"),
    discount: "35%",
    facts: [{ fact: "Site extent", value: "177 488 m²", quote: null }],
    risks: [{ text: "Structural fee negotiated above the guideline's top bracket (R3 000 000 plus 2%)", quote: null }],
  };
  mutecFull.scope[0] = { ...mutecFull.scope[0]!, priceLine: "M1", basis: "R 70,414,825" };
  const L = checkResponse(lemkenFull, found);
  const M = checkResponse(mutecFull, found);

  it("recomputes Lemken's fee on the corrected cost of works: R11 457 934,22, R880 293 more", () => {
    expect(L.feeImpact).toMatchObject({ basisCorrected: 16_191_025_125, grossOnCorrected: 1_347_992_261, netOnCorrected: 1_145_793_422 });
    expect(L.feeImpact!.change).toBe(1_145_793_422 - 1_057_764_110);
    expect(L.basisMismatch).toEqual({ used: 15_040_315_125, stated: 15_102_025_125 });
  });

  it("compares the civil fees like for like: 7,03% against 7,17%", () => {
    const r = recommend([L, M]);
    expect(r.likeForLike[0]!.item).toBe("Civil engineering design");
    expect(r.likeForLike[0]!.prices.map((p) => [p.supplier, p.net, p.rate])).toEqual([
      ["Lemken Group", 1_057_764_106, 7.03],
      ["MUTEC", 505_062_285, 7.17],
    ]);
    expect(r.reasons.some((x) => /Lemken Group R 10 577 641,06 \(7,03% of R 150 403 151,25\); MUTEC R 5 050 622,85 \(7,17% of R 70 414 825,00\)/.test(x))).toBe(true);
  });

  it("finds the fee formula in the fee line itself when it is not named", () => {
    const unnamed = checkResponse({ ...lemkenFull, fee: null }, found);
    expect(unnamed.basisMismatch).toEqual({ used: 15_040_315_125, stated: 15_102_025_125 });
    expect(unnamed.feeImpact!.netOnCorrected).toBe(1_145_793_422);
  });

  it("flags the facts the responses disagree on, and carries each response's risks", () => {
    const r = recommend([L, M]);
    expect(r.differences).toEqual([{ fact: "Site extent", values: [{ supplier: "Lemken Group", value: "12,9 ha" }, { supplier: "MUTEC", value: "177 488 m²" }] }]);
    expect(r.clarifications.some((c) => /All respondents: confirm the site extent – 12,9 ha \(Lemken Group\) against 177 488 m² \(MUTEC\)/.test(c))).toBe(true);
    expect(r.clarifications.some((c) => /Lemken Group: confirm the fee on the corrected cost of works – on R 161 910 251,25 .* R 11 457 934,22 after its discount \(\+R 880 293,12 on the offer\)/.test(c))).toBe(true);
    expect(r.risks).toEqual([{ supplier: "MUTEC", text: "Structural fee negotiated above the guideline's top bracket (R3 000 000 plus 2%)" }]);
  });
});

describe("what a reading cannot be trusted to judge", () => {
  it("a response addressed only 'Dear Sir' names no client", () => {
    const q: QuoteExtraction = {
      supplier: "Lemken Group (Pty) Ltd", signatory: null, reference: null, date: null, addressedTo: "Dear Sir", validity: null,
      lines: [], totalExclVat: null, totalInclVat: null, basis: null, scope: [], extraScope: [], exclusions: [], assumptions: [],
      requirements: [{ requirement: "Addressed to the client and the project", status: "met", evidence: "Dear Sir" }],
    };
    expect(checkResponse(q, found).requirements[0]).toMatchObject({ status: "not met" });
    expect(checkResponse({ ...q, addressedTo: "Tigane Developers, Att. Mr T Masie" }, found).requirements[0]!.status).toBe("met");
    expect(checkResponse({ ...q, addressedTo: null }, found).requirements[0]!.status).toBe("not stated");
    expect(isSalutation("Sir/Madam")).toBe(true);
    expect(isSalutation("Mr T Masie")).toBe(false);
  });

  it("a rand-and-cents figure of seven digits stands as its own evidence; a short one does not", () => {
    expect(distinctFigure("R442 704,54")).toBe(true);
    expect(distinctFigure("R 12 444 283.60")).toBe(true);
    expect(distinctFigure("R 45")).toBe(false);
    expect(distinctFigure("R 1 315.00")).toBe(false);
    expect(distinctFigure("15%")).toBe(false);
  });
});

describe("a time-based or allowance line, and a price shared across scope", () => {
  it("a rate that is the amount over the hours, rounded, is rounding – not an error", () => {
    const out = checkLines(
      [
        line("S1", "Resident Engineer – civils", "1 080 000", { quantity: "2 112", rate: "511" }),
        line("S2", "Coordinator allowance", "600 000", { quantity: "444", rate: "1 350" }),
      ],
      found,
    );
    expect(out[0]!.verdict).toBe("rounding");
    // 600 000 / 444 = 1 351,35 – not 1 350 rounded, so that one stays an error to put to the firm.
    expect(out[1]!.verdict).toBe("error");
  });

  it("an unfilled template field does not meet the requirement", () => {
    const q: QuoteExtraction = {
      supplier: "N.E.T", signatory: null, reference: null, date: null, addressedTo: "Mzilikazi Property Services", validity: null,
      lines: [line("A", "Design office", "R 6 920 100.00", { role: "fee" })], totalExclVat: "A", totalInclVat: null, basis: null,
      scope: [
        { item: "Civil", status: "included", quote: null, priceLine: "A", basis: "R 92 180 584" },
        { item: "Structural", status: "included", quote: null, priceLine: "A", basis: "R 295 265 800" },
      ],
      extraScope: [], exclusions: [], assumptions: [],
      requirements: [{ requirement: "Professional indemnity insurance", status: "met", evidence: "insurance of R[amount] per claim" }],
    };
    const r = checkResponse(q, found);
    expect(r.requirements[0]!.status).toBe("not met");
    expect(placeholder("Signed ______")).toBe(true);
    expect(placeholder("Ndlovu Engineering Techniks (Pty) Ltd")).toBe(false);
    // One design-office fee named for civil and structural prices neither on its own.
    expect(r.scopePrices.map((p) => p.net)).toEqual([null, null]);
  });
});

describe("counts, derived shares and figures read from an image", () => {
  it("finds N.E.T's site-staff hours one out, exactly", () => {
    const t = checkTallies([
      { id: "T1", label: "Stage 5 – resident engineer civils", figure: "1 943" },
      { id: "T2", label: "Stage 5 – resident engineer structural", figure: "2 915" },
      { id: "T3", label: "Stage 5 – supervising", figure: "1 166" },
      { id: "T4", label: "Stage 5 – coordinator", figure: "67" },
      { id: "T5", label: "Stage 5 – site staff subtotal", figure: "6 090", expression: "T1+T2+T3+T4" },
      { id: "T6", label: "Design office total", figure: "4,976", expression: "4976" },
    ]);
    expect(t.find((x) => x.id === "T5")).toMatchObject({ verdict: "error", stated: 6090, computed: 6091 });
    expect(t.find((x) => x.id === "T6")!.verdict).toBe("agrees");
  });

  it("assembles a share the response does not price on its own from the lines it names – and says so", () => {
    const q: QuoteExtraction = {
      supplier: "N.E.T", signatory: null, reference: null, date: null, addressedTo: "Mzilikazi Property Services", validity: null,
      lines: [
        line("L1", "Project director / lead civil", "1 071 000"),
        line("L2", "Roads engineer", "880 200"),
        line("L3", "Structural engineer", "1 197 000"),
        line("L4", "Design office", "3 148 200", { expression: "L1+L2+L3" }),
      ],
      totalExclVat: "L4", totalInclVat: null, basis: null,
      scope: [{ item: "Civil", status: "included", quote: null, priceLine: null, basis: "R 92 180 584", derivedFrom: ["L1", "L2"] }],
      extraScope: [], exclusions: [], assumptions: [], requirements: [],
    };
    const r = checkResponse(q, found);
    expect(r.scopePrices[0]).toMatchObject({ net: 195_120_000, derived: true, rate: 2.12 });
  });

  it("a figure found only in what OCR read from a picture is marked to be confirmed by eye", () => {
    const out = checkLines([line("F1", "Fee", "R12,444,283.6", { role: "fee" })], () => ({ page: 3, image: true }));
    expect(out[0]!.note).toMatch(/Read from an image on page 3 by OCR/);
  });
});

describe("a table of counts, transcribed", () => {
  it("checks each row total and each subtotal column – N.E.T's site staff", () => {
    const t = checkTallies(
      tablesToTallies([
        {
          title: "Site staff hours",
          columns: ["St 1", "St 2", "St 3", "St 4", "St 5", "St 6", "Total h"],
          rows: [
            { label: "RE civils", cells: ["0", "0", "0", "0", "1 943", "169", "2 112"], lastIsTotal: true },
            { label: "RE structural", cells: ["0", "0", "0", "0", "2 915", "253", "3 168"], lastIsTotal: true },
            { label: "Supervising", cells: ["0", "0", "0", "0", "1 166", "101", "1 267"], lastIsTotal: true },
            { label: "Coordinator", cells: ["0", "89", "133", "133", "67", "22", "444"], lastIsTotal: true },
            { label: "Sub-total", cells: ["0", "89", "133", "133", "6 090", "546", "6 992"], lastIsTotal: true, sums: [0, 1, 2, 3] },
          ],
        },
      ]),
    );
    const wrong = t.filter((x) => x.verdict === "error").map((x) => `${x.label}: ${x.stated}/${x.computed}`);
    expect(wrong).toEqual([
      "Site staff hours – Sub-total – St 5: 6090/6091",
      "Site staff hours – Sub-total – St 6: 546/545",
      "Site staff hours – Sub-total – Total h: 6992/6991",
      "Site staff hours – Sub-total – Total h (across the row): 6992/6991",
    ]);
  });
});

describe("the discount taken once", () => {
  it("a price line that is already after the discount is not discounted again", () => {
    const base: Omit<QuoteExtraction, "scope"> = {
      supplier: "Lemken", signatory: null, reference: null, date: null, addressedTo: null, validity: null,
      lines: lemken, totalExclVat: "L13", totalInclVat: null, basis: null, extraScope: [], exclusions: [], assumptions: [], requirements: [], discount: "15%",
    };
    const net = checkResponse({ ...base, scope: [{ item: "Civil", status: "included", quote: null, priceLine: "L13", basis: "R 150 403 151.25" }] }, found).scopePrices[0]!;
    const gross = checkResponse({ ...base, scope: [{ item: "Civil", status: "included", quote: null, priceLine: "L11", basis: "R 150 403 151.25" }] }, found).scopePrices[0]!;
    expect(net.net).toBe(1_057_764_110);
    expect(gross.net).toBe(1_057_764_106);
    expect(net.rate).toBe(7.03);
  });
});

describe("a working read from an image", () => {
  it("that does not reconcile is checked by eye, not called an error", () => {
    const out = checkLines(
      [line("F", "Proposed fee", "R10,577,641.1", { role: "total" }), line("S1", "Stage 1", "R528,882.1", { expression: "F*0.55" })],
      (quote) => ({ page: 3, image: /Stage/.test(quote) }),
    );
    expect(out[1]).toMatchObject({ verdict: "check by eye", corrected: 52_888_210 });
    expect(checkResponse({ supplier: "L", signatory: null, reference: null, date: null, addressedTo: null, validity: null, lines: [line("F", "Proposed fee", "R10,577,641.1", { role: "total" })], totalExclVat: "F", totalInclVat: null, basis: null, scope: [], extraScope: [], exclusions: [], assumptions: [], requirements: [] }, found).errors).toEqual([]);
  });
});
