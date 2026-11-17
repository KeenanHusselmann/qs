/**
 * The QS Viability Report — PLATFORM.md §7.6.
 *
 * ── "The printout is the product" ──────────────────────────────────────────────────────────
 *
 * §7.1 #6, and §7.6 asks that this screen get as much design attention as the grid: a white A4
 * sheet on a tinted ground with its boundaries visible, a footer carrying the practice, the
 * project and the date. What a QS issues is a document, and a document that looks like a web page
 * on paper is the one thing the section rules out.
 *
 * ── Nothing here is generated ──────────────────────────────────────────────────────────────
 *
 * No model is called and nothing is computed that a person has not signed. Every figure on the
 * sheet is read from `output_value` on a run whose `signed_at is not null`, and carries the
 * document it came from. §1.3.1 — a figure that first appeared in a report traces to nothing and
 * would be read as though it did, wearing the platform's own voice.
 *
 * That is also why it renders instantly and why there is no "producing…" state. v3 generates its
 * report because v3 computes it; this reads approved data back, which is a query.
 *
 * ── What is not on it yet, and why it says so ──────────────────────────────────────────────
 *
 * Eight of v3's twelve sections come from a financial engine that is being ported one piece at a
 * time. Each of those sections is on the sheet, numbered, saying what it is waiting for. An absent
 * section reads as an oversight; a stated one reads as a finding, and a QS can see at a glance how
 * much of the document they are holding.
 */

import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";

import { PrintButton } from "@/components/report/print-button";
import { IssuedRegister } from "@/components/report/issued-register";
import { listIssued } from "@/app/(app)/projects/[id]/document-actions";
import { loadSignedFigures } from "@/lib/agent/persist";
import { requireSession } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { currentAssumptions } from "@/lib/assumptions";
import { viabilityReport, type ReportSection } from "@/lib/report/viability";
import { getProject } from "@/app/(app)/projects/actions";

export default async function ReportPage({ params }: PageProps<"/projects/[id]/report">) {
  const { id } = await params;

  await requireSession();
  const project = await getProject(id);
  if (!project) notFound();

  const signed = await loadSignedFigures(id);
  /*
    The practice's assumptions, not the platform's.

    Read here rather than inside `viabilityReport`, which stays pure and synchronous — every unit
    test and the PDF fixture call it without a database, and making it async to fetch nine numbers
    would have put an await into the one function the whole document is derived by.
  */
  const report = viabilityReport(signed, await currentAssumptions());

  const issued = signed.length > 0 ? signed[0].at : null;

  return (
    <div className="mx-auto max-w-[1280px] px-8 py-6">
      {/*
        The controls sit on the canvas, never on the sheet. Anything on the sheet is part of the
        document, and a Print button that printed itself is the oldest mistake in this genre.
      */}
      <div data-region="report-controls" className="mb-5 flex flex-wrap items-center gap-3 print:hidden">
        <Link
          href={`/projects/${id}/feasibility`}
          className="t-sm flex h-8 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] px-2.5 font-medium text-[var(--n-700)] transition-colors hover:bg-[var(--n-50)]"
          style={{ transitionDuration: "var(--m-fast)" }}
        >
          <ArrowLeft aria-hidden size={14} strokeWidth={2} />
          Feasibility Estimate
        </Link>

        <p className="t-sm text-[var(--n-500)]">
          {report.established} of {report.total} sections established from signed figures.
        </p>

        {/*
          A plain link, not a fetch. The browser's own download puts the file where the reader
          expects it, under the filename the route names — a script-assembled blob lands as an
          untitled download and loses the job-folder name, which is most of the point.
        */}
        <a
          href={`/projects/${id}/report/pdf`}
          data-action="download-pdf"
          className="t-sm ml-auto flex h-8 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] px-2.5 font-medium text-[var(--n-700)] transition-colors hover:bg-[var(--n-50)]"
          style={{ transitionDuration: "var(--m-fast)" }}
        >
          <Download aria-hidden size={14} strokeWidth={2} />
          Download PDF
        </a>

        <PrintButton />
      </div>

      {/*
        ── The register, above the sheet ─────────────────────────────────────────────────────

        The sheet below is the report as it stands *now*, generated live from what is signed. This
        is the record of what was actually sent, and it sits above because "what did we issue" is
        the question somebody arrives with when a client disagrees — and the live sheet cannot
        answer it. Printed on `--n-100`, so a panel here reads as chrome around the document rather
        than as part of it.
      */}
      <div className="mx-auto mb-6 w-full max-w-[210mm] print:hidden">
        <IssuedRegister projectId={id} documents={await listIssued(id)} />
      </div>

      {/*
        The sheet. 210mm is A4's width and the shadow is the page boundary §7.6 asks to be visible —
        the one place in this platform where a shadow is structure rather than decoration.
      */}
      <article
        data-region="report-sheet"
        className="mx-auto w-full max-w-[210mm] bg-[var(--n-0)] px-[18mm] py-[16mm] shadow-[var(--e-2)] print:max-w-none print:px-0 print:py-0 print:shadow-none"
      >
        <header className="border-b-2 border-[var(--n-800)] pb-3">
          <p className="t-xs font-semibold tracking-[0.08em] text-[var(--n-500)] uppercase">
            Quantity Surveyor&rsquo;s Viability Report
          </p>
          <h1 className="t-xl mt-1 font-semibold text-[var(--n-900)]">{project.name}</h1>
          <p className="t-sm mt-0.5 text-[var(--n-600)]">
            {[project.code, project.client].filter(Boolean).join(" · ") || "No code or client recorded"}
          </p>
        </header>

        {/*
          What the document is, said before the first figure. A viability report that did not state
          the basis of its own figures would be the thing §14 calls a plausible-looking version of
          something that works.
        */}
        <p className="t-sm mt-4 leading-relaxed text-[var(--n-700)]">
          Every figure in this report is read from a run that a named person has signed off, and
          carries the document it was read from. Nothing is estimated here and nothing is computed
          that is not stated below. Sections without approved figures behind them say so rather than
          being omitted.
        </p>

        {issued && (
          <p className="t-sm mt-2 text-[var(--n-500)]">
            Latest signature {formatDate(issued)}. Issued {formatDate(new Date())}.
          </p>
        )}

        <div className="mt-6 flex flex-col">
          {report.sections.map((section) => (
            <Section key={section.no} section={section} />
          ))}
        </div>

        {/* §7.6 — the footer belongs to the document. */}
        <footer className="mt-8 flex flex-wrap items-baseline justify-between gap-2 border-t border-[var(--n-300)] pt-3">
          <p className="t-xs text-[var(--n-500)]">
            Mzilikazi Quantity Surveyors · {project.name}
            {project.code ? ` · ${project.code}` : ""}
          </p>
          <p className="t-xs text-[var(--n-500)]">{formatDate(new Date())}</p>
        </footer>
      </article>
    </div>
  );
}

/**
 * One numbered section.
 *
 * The state is carried in words as well as in colour — §7.1 #5 — because this document is printed,
 * and a tint that distinguishes an established section from a waiting one on screen is a slightly
 * different grey on a laser printer.
 */
function Section({ section }: { section: ReportSection }) {
  const established = section.state === "established";

  return (
    <section
      data-section={section.no}
      data-state={section.state}
      className="break-inside-avoid border-t border-[var(--n-200)] py-3 first:border-t-0"
    >
      <div className="flex items-baseline gap-2">
        <span className="t-sm num w-6 shrink-0 font-semibold text-[var(--n-500)]">{section.no}</span>
        <h2 className="t-base font-semibold text-[var(--n-800)]">{section.title}</h2>

        {!established && (
          <span className="t-xs ml-auto shrink-0 rounded-[var(--r-sm)] bg-[var(--warn-50)] px-1.5 py-0.5 font-medium text-[var(--warn-700)]">
            {section.state === "unsigned" ? "Not signed off" : "Not yet established"}
          </span>
        )}
      </div>

      {section.reason && (
        <p className="t-sm mt-1 pl-8 text-[var(--n-600)]">{section.reason}</p>
      )}

      {section.rows.length > 0 && (
        <table className="mt-2 w-full table-fixed">
          <colgroup>
            <col className="w-[38%]" />
            <col className="w-[34%]" />
            <col className="w-[28%]" />
          </colgroup>
          <tbody>
            {section.rows.map((row) => (
              <tr key={row.label} className="align-top">
                <td className="t-sm py-1 pl-8 text-[var(--n-600)]">{row.label}</td>
                <td className="t-sm num py-1 font-medium text-[var(--n-900)]">{row.value}</td>
                <td className="t-xs py-1 text-[var(--n-500)]">{row.source ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* The trace line. A section is only as good as the signature under it. */}
      {section.from && (
        <p className="t-xs mt-1.5 pl-8 text-[var(--n-500)]">
          From {section.from.by} on {formatDate(section.from.at)}.
          {section.from.note && (
            <span className="mt-0.5 block text-[var(--n-700)]">Signed with a difference: {section.from.note}</span>
          )}
        </p>
      )}
    </section>
  );
}
