/**
 * Quotations – parity with the manual audit, live (D1.3).
 *
 *     npx tsx checks/rfq-parity-live.mts
 *
 * Spends model credits, so it is not in `npm run check`. The three Marshall Dam fee proposals,
 * filed on a project with the engineering RFQ, are evaluated as the platform evaluates them, and
 * every finding of the manual audit (MPS/MD/RFQ-01 Rev 2) is asserted – each error, each gap, each
 * query – together with the reverse: no arithmetic error the audit does not have. A finding the
 * platform misses, or one it invents, is a failure; the score is how many of the audit's findings
 * it reached.
 *
 * The same prompts, rules and checks run for every response, each evaluated on its own without
 * sight of the others; the ranking is the platform's stated rule. Parity here is what shows the
 * output is the audit's, not the model's leaning.
 */

import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const { default: postgres } = await import("postgres");
const { evaluateQuote } = await import("../src/lib/agent/evaluate-quote");
const { recommend } = await import("../src/domain/quote-check");
type Checked = Awaited<ReturnType<typeof evaluateQuote>>["result"];

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const FILES = { lemken: "J0140_01_000_Marshall Dam residence - fee proposal Rev 0.pdf", mutec: "Fees Proposal - Marshall Dam Development.pdf", net: "20260921_Marshall_Dam_Fee_Proposal_Rev00.pdf" };

// The latest RFQ on a project holding all three.
const [rfq] = await sql`
  select r.id, r.title, r.scope, r.requirements, r.project_id from rfqs r
  where r.deleted_at is null and (select count(distinct d.filename) from documents d where d.project_id = r.project_id and d.deleted_at is null and d.filename in ${sql(Object.values(FILES))}) = 3
  order by r.created_at desc limit 1`;
if (!rfq) throw new Error("No RFQ with the three Marshall Dam proposals – run checks/rfq-live.mjs and file the N.E.T proposal first.");

const results: Record<keyof typeof FILES, Checked> = {} as never;
for (const [key, filename] of Object.entries(FILES) as [keyof typeof FILES, string][]) {
  const [doc] = await sql`select id from documents where project_id = ${rfq.project_id} and filename = ${filename} and deleted_at is null limit 1`;
  const t = Date.now();
  const out = await evaluateQuote(doc!.id, rfq as unknown as { title: string; scope: string[]; requirements: string[] });
  results[key] = out.result;
  console.log(`  ${key.padEnd(6)} evaluated in ${((Date.now() - t) / 1000).toFixed(0)}s – ${out.usage.input} in / ${out.usage.output} out`);
}
const { lemken: L, mutec: M, net: N } = results;
const rec = recommend([L, M, N]);

let reached = 0;
let findings = 0;
let fails = 0;
const expect = (label: string, ok: boolean, detail = "") => {
  findings++;
  if (ok) reached++;
  else fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};
const guard = (label: string, ok: boolean, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};
const diff = (r: Checked) => r.errors.map((e) => Math.abs((e.computed ?? 0) - (e.stated ?? 0)));
const req = (r: Checked, re: RegExp) => r.requirements.find((q) => re.test(q.requirement))?.status;
const civil = (r: Checked) => r.scopePrices[0];
const errs = (r: Checked) => r.errors.map((e) => `${e.label} ${e.stated}/${e.computed}`).join(" | ");

console.log("\n  Lemken Group");
expect("Subtotal 1 leaves out the R 9 000 000", diff(L).includes(900_000_000), errs(L));
expect(
  "fee from the image: worked on R 150 403 151,25, not its stated estimate – or recomputed on the corrected one",
  Math.abs((L.basisMismatch?.used ?? 0) - 15_040_315_125) <= 100 || Math.abs((L.feeImpact?.netOnCorrected ?? 0) - 1_145_793_422) <= 100,
  JSON.stringify({ mismatch: L.basisMismatch, impact: L.feeImpact }),
);
expect("civil fee 7,03% of the cost of works its fee uses", Math.abs((civil(L)?.rate ?? 0) - 7.03) <= 0.02, JSON.stringify(civil(L)));
expect("\"Dear Sir\" – not addressed to the client", req(L, /addressed/i) !== "met", req(L, /addressed/i));
// Its stages 1–6 for the civil works include stage 5 for them; the audit (Rev 2) had counted 1 of 3
// and was corrected in Rev 3. What is certain: civil priced, structural not.
expect("prices civil engineering, not structural", L.scope[0]?.status === "included" && L.scope[1]?.status !== "included", L.scope.map((s) => s.status).join(", "));
guard("no arithmetic error the audit does not have", diff(L).every((d) => d === 900_000_000), errs(L));

console.log("\n  MUTEC");
expect("named MUTEC (from its letterhead)", M.named && /mutec/i.test(M.supplier), M.supplier);
expect("total excl. VAT R 440 overstated", diff(M).includes(44_000), errs(M));
expect("structural stage column adds to R 9 296 795,26", M.errors.some((e) => e.computed === 929_679_526), errs(M));
expect("civil fee 7,17% of its estimate", Math.abs((civil(M)?.rate ?? 0) - 7.17) <= 0.02, JSON.stringify(civil(M)));
expect("covers 3 of 3 scope items", M.scope.filter((s) => s.status === "included").length === 3);
guard("no arithmetic error the audit does not have", M.errors.every((e) => Math.abs((e.computed ?? 0) - (e.stated ?? 0)) === 44_000 || [929_679_526, 1_434_741_809].includes(e.computed ?? 0)), errs(M));

console.log("\n  Ndlovu Engineering Techniks");
expect("the site-staff hours one out", N.tallies.some((t) => t.verdict === "error"), N.tallies.filter((t) => t.verdict === "error").map((t) => `${t.label} ${t.stated}/${t.computed}`).join(" | "));
expect("PI cover left as a placeholder – not met", req(N, /indemnity/i) === "not met", req(N, /indemnity/i));
expect("fees not calculated on the ECSA guideline – not met", req(N, /guideline/i) !== "met", req(N, /guideline/i));
expect("no date or reference", req(N, /dated/i) !== "met", req(N, /dated/i));
expect("queries the document: the supervising role named two ways, or section 3.5 cited and absent", N.observations.some((o) => /architect|3\.5/i.test(o.text)), N.observations.map((o) => o.text).join(" | "));
expect("civil not priced on its own – derived at about 4%, or said to be not priced separately", civil(N)?.net === null || (civil(N)?.derived === true && (civil(N)?.rate === null || ((civil(N)?.rate ?? 0) > 3 && (civil(N)?.rate ?? 0) < 5.5))), JSON.stringify(civil(N)));
expect("covers 3 of 3 scope items", N.scope.filter((s) => s.status === "included").length === 3);
guard("no arithmetic error the audit does not have (the R 600 allowance query at most)", diff(N).every((d) => d === 60_000), errs(N));

console.log("\n  Recommendation");
expect("N.E.T provisionally preferred, not comparable as submitted", rec.preferred === 2 && !rec.comparable, rec.headline);
expect("MUTEC second, Lemken third", rec.ranking[1] === 1 && rec.ranking[2] === 0, JSON.stringify(rec.ranking));

console.log(`\n  Parity: ${reached} of ${findings} audit findings reached.`);
await sql.end();
console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} failed.`);
process.exit(fails ? 1 : 0);
