/**
 * The viability report as a downloaded document.
 *
 * v3 returns `application/pdf` from its report endpoint with a `Content-Disposition` naming the
 * file after the project, and that filename matters more than it looks: a QS saves it into a job
 * folder beside twenty other PDFs, and `report.pdf` is indistinguishable from every other one.
 *
 * ── Signed data only, on the server ────────────────────────────────────────────────────────
 *
 * The route reads the same `loadSignedFigures` the page does and builds the same
 * `viabilityReport` model, so the document a reader downloads is the document they were looking
 * at. Rendering happens here rather than in the browser because the writer is a Node module and
 * because a PDF assembled client-side could be assembled from whatever the client happened to
 * have.
 *
 * `requireSession()` guards it exactly as it guards the page. A report is the most sensitive thing
 * this platform produces, and a route that returned one without a session would be the one place
 * the guard was missing.
 */

import { notFound } from "next/navigation";

import { loadSignedFigures } from "@/lib/agent/persist";
import { requireSession } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { FIRM } from "@/lib/firm";
import { billPdf } from "@/lib/report/bill-pdf";
import { loadLatestBill } from "@/lib/agent/persist-bill";
import { db } from "@/db/client";
import { issuedDocuments } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { read } from "@/lib/ingest/storage";
import { renderViabilityPdf } from "@/lib/report/pdf";
import { currentAssumptions } from "@/lib/assumptions";
import { viabilityReport } from "@/lib/report/viability";
import { getProject } from "@/app/(app)/projects/actions";
import { carriesRowsFrom } from "@/lib/agent/bill";
import { loadSignedBill } from "@/lib/agent/persist-bill";
import { loadTenderReturns } from "@/lib/agent/persist-tender";
import { nameOf } from "@/lib/signers";
import { listParameters, listTakeoff } from "@/lib/takeoff";
import { evaluationInputs } from "@/lib/tender-evaluation";
import { takeoffPdf, takeoffWorkbook } from "@/lib/report/takeoff-export";
import { tenderEvaluationWorkbook } from "@/lib/report/tender-evaluation-workbook";
import { designReviewWorkbook } from "@/lib/report/design-review-workbook";
import { loadReview } from "@/lib/design-review";
import { estimateComparisonWorkbook } from "@/lib/report/estimate-comparison-workbook";
import { loadComparison } from "@/lib/estimate-comparison";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const session = await requireSession();
  const project = await getProject(id);
  if (!project) notFound();

  /** The job-folder filename. Anything not a letter, digit, space or dash is dropped. */
  const safe = (project.name || "Project").replace(/[^\w \-]/g, "").trim().replace(/\s+/g, "_");

  /*
    ── Two documents, one route ──────────────────────────────────────────────────────────────

    `?document=bill` renders the Bill of Quantities; anything else renders the viability report.

    A branch rather than a folder, because **a folder is a serverless function** — the count was
    once read as eleven when it was sixteen and deploys silently stopped. This endpoint is already
    "this project, as a PDF", and the two documents differ in what they are made of rather than in
    what they are for.
  */
  // `query`, not `params` — the route already destructures `params` for the project id.
  const query = new URL(request.url).searchParams;

  /*
    ── An issued document, exactly as it was sent ────────────────────────────────────────────

    Not regenerated. That is the whole point of the register: the figures move, so a report re-made
    today is not the report a client read in March, and "what did we send them" has to be answerable
    with the bytes rather than with a fresh render that happens to have the same title.

    A withdrawn document still downloads. It was sent, and somebody arguing about it needs to read
    the thing that was sent — withdrawing says it is no longer current, not that it never existed.
  */
  const issuedId = query.get("issued");
  if (issuedId) {
    const [record] = await db
      .select()
      .from(issuedDocuments)
      .where(and(eq(issuedDocuments.id, issuedId), eq(issuedDocuments.projectId, id)))
      .limit(1);

    if (!record) notFound();

    const bytes = await read(record.storageLocation);
    // Not every issued document is a PDF – a comparative evaluation is a workbook, and a browser
    // handed one labelled application/pdf saves a file Excel will not open.
    const workbook = record.kind === "rfq_comparison" || record.kind === "bill_workbook";
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": workbook ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf",
        "Content-Disposition": `attachment; filename="${safe}_${record.kind}.${workbook ? "xlsx" : "pdf"}"`,
        "Content-Length": String(bytes.length),
        // Immutable: these bytes are what was issued and will never differ.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  }

  /*
    The take-off, to compare offline (November meeting) – `?document=takeoff`, as a workbook by
    default because a comparison is worked in, or `&format=pdf` for the printed dimension sheet.
    Read on every request: a take-off is a working document and changes as it is measured.
  */
  if (query.get("document") === "takeoff") {
    const [items, parameters] = await Promise.all([listTakeoff(id), listParameters(id)]);
    const subject = {
      practice: FIRM.name,
      projectName: project.name,
      code: project.code ?? null,
      exportedOn: formatDate(new Date()),
      exportedBy: await nameOf(session.email),
    };
    const asPdf = query.get("format") === "pdf";
    const bytes = asPdf ? takeoffPdf(items, parameters, subject) : await takeoffWorkbook(items, parameters, subject);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": asPdf ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${safe}_Take-off.${asPdf ? "pdf" : "xlsx"}"`,
        "Content-Length": String(bytes.length),
        "Cache-Control": "no-store",
      },
    });
  }

  /*
    The tender evaluation (November meeting) – against the estimate, collusion indicators and the
    scoring template, from the signed bill the tenders were invited on and the returns against it.
  */
  /*
    A design review, as the practice's own seven-sheet workbook – `?document=design-review&review=`.
    Read on every request: a review is worked on as answers come in.
  */
  if (query.get("document") === "design-review") {
    const review = await loadReview(id, query.get("review") ?? "");
    if (!review) notFound();
    const bytes = await designReviewWorkbook(review, {
      practice: FIRM.name,
      projectName: project.name,
      exportedOn: formatDate(new Date()),
      exportedBy: await nameOf(session.email),
    });
    const name = review.title.replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "_").slice(0, 80) || "Design_Review";
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${name}.xlsx"`,
        "Content-Length": String(bytes.length),
        "Cache-Control": "no-store",
      },
    });
  }

  // An estimate comparison – the summary by element, each estimate's lines, the gap, clarifications.
  if (query.get("document") === "estimate-comparison") {
    const comparison = await loadComparison(id, query.get("comparison") ?? "");
    if (!comparison) notFound();
    const bytes = await estimateComparisonWorkbook(comparison, {
      practice: FIRM.name,
      projectName: project.name,
      exportedOn: formatDate(new Date()),
      exportedBy: await nameOf(session.email),
    });
    const name = comparison.title.replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "_").slice(0, 80) || "Estimate_Comparison";
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${name}.xlsx"`,
        "Content-Length": String(bytes.length),
        "Cache-Control": "no-store",
      },
    });
  }

  if (query.get("document") === "tender-evaluation") {
    const source = carriesRowsFrom("/tender-analysis");
    const carried = source ? await loadSignedBill(id, source) : null;
    if (!carried) notFound();
    const returns = await loadTenderReturns(id, carried.runId);
    const { items, tenders } = evaluationInputs(carried.rows, returns);
    const bytes = await tenderEvaluationWorkbook(items, tenders, {
      practice: FIRM.name,
      projectName: project.name,
      code: project.code ?? null,
      exportedOn: formatDate(new Date()),
      exportedBy: await nameOf(session.email),
    });
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${safe}_Tender_Evaluation.xlsx"`,
        "Content-Length": String(bytes.length),
        "Cache-Control": "no-store",
      },
    });
  }

  if (query.get("document") === "bill") {
    const bill = await loadLatestBill(id, "/bill");
    if (!bill) notFound();

    const pdf = billPdf(
      bill.rows,
      {
        practice: FIRM.name,
        projectName: project.name,
        code: project.code ?? null,
        title: "Bill of Quantities",
        signedBy: bill.signedBy ?? null,
        signedAt: bill.signedAt ? formatDate(new Date(bill.signedAt)) : null,
      },
      Boolean(bill.signedAt),
    );

    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safe}_Bill_of_Quantities.pdf"`,
        "Content-Length": String(pdf.length),
        // A draft bill changes as it is priced; a cached copy would be handed out after it had.
        "Cache-Control": "no-store",
      },
    });
  }

  const signed = await loadSignedFigures(id);
  /*
    The practice's assumptions, not the platform's.

    Read here rather than inside `viabilityReport`, which stays pure and synchronous — every unit
    test and the PDF fixture call it without a database, and making it async to fetch nine numbers
    would have put an await into the one function the whole document is derived by.
  */
  const report = viabilityReport(signed, await currentAssumptions());

  const pdf = renderViabilityPdf(report, {
    projectName: project.name,
    code: project.code ?? null,
    client: project.client ?? null,
    practice: FIRM.name,
    latestSignature: signed.length > 0 ? formatDate(signed[0].at) : null,
    issuedOn: formatDate(new Date()),
  });

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safe}_QS_Viability_Report.pdf"`,
      "Content-Length": String(pdf.length),
      // A report is a snapshot of what was signed when it was asked for, and what is signed
      // changes. A cached copy would be handed out after the next signature.
      "Cache-Control": "no-store",
    },
  });
}
