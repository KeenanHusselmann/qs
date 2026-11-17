/**
 * An ad hoc request's front page: what was asked, the inputs it came with, and the ways to answer it.
 *
 * The request is the brief. Below it, its inputs – the folder the meeting asked for, kept as context
 * for every follow-up – and the two things these requests are answered with: a take-off from the
 * drawings, and the assistant, which reads the inputs and the request together.
 */

import Link from "next/link";
import { ArrowRight, CalendarClock, FileText, FolderOpen, Ruler, User } from "lucide-react";

import type { Project, ProjectDocument } from "@/db/schema";
import { dueLine } from "@/lib/adhoc";
import { formatDate } from "@/lib/dates";
import { AnsweredToggle } from "@/components/adhoc/answered-toggle";
import { OpenAssistant } from "@/components/shell/open-assistant";

export function AdhocOverview({ project, documents }: { project: Project; documents: readonly ProjectDocument[] }) {
  const base = `/projects/${project.id}`;
  const due = project.closedAt ? null : dueLine(project.dueOn, new Date().toISOString().slice(0, 10));

  return (
    <div data-region="adhoc-overview" className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-8 pt-4 pb-8">
      <OpenAssistant />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="t-xs font-semibold tracking-[0.04em] text-[var(--a-700)] uppercase">Ad hoc request</p>
          <h1 className="t-xl mt-0.5 break-words text-[var(--n-800)]">{project.name}</h1>
          <p className="t-sm mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[var(--n-600)]">
            {project.requestedBy && (
              <span className="inline-flex items-center gap-1"><User aria-hidden size={13} /> Asked by {project.requestedBy}</span>
            )}
            <span>Opened {formatDate(project.createdAt)}</span>
            {due && (
              <span className={`inline-flex items-center gap-1 ${due.overdue ? "font-medium text-[var(--err-700)]" : ""}`}>
                <CalendarClock aria-hidden size={13} /> {due.text}
              </span>
            )}
            {project.closedAt && <span className="font-medium text-[var(--ok-700)]">Answered {formatDate(project.closedAt)}</span>}
          </p>
        </div>
        <AnsweredToggle id={project.id} answered={project.closedAt !== null} />
      </header>

      <section data-region="adhoc-request" className="rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-0)] px-5 py-4">
        <h2 className="t-sm font-semibold text-[var(--n-700)]">What is needed</h2>
        <p className="t-base mt-1.5 whitespace-pre-wrap text-[var(--n-800)]">{project.request}</p>
      </section>

      <section data-region="adhoc-inputs" className="rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-0)]">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--n-200)] px-5 py-2.5">
          <h2 className="t-sm font-semibold text-[var(--n-700)]">The inputs <span className="font-normal text-[var(--n-500)]">· {documents.length}</span></h2>
          <Link href={`${base}/corpus`} className="t-sm inline-flex items-center gap-1 text-[var(--a-700)] hover:underline">
            <FolderOpen aria-hidden size={13} /> Add or manage files
          </Link>
        </div>
        {documents.length === 0 ? (
          <p className="t-sm px-5 py-4 text-[var(--n-600)]">
            Nothing filed yet. File the drawings, specifications or emails the request came with – the assistant and the take-off read from them.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--n-100)]">
            {documents.map((d) => (
              <li key={d.id} className="flex items-center gap-2.5 px-5 py-2">
                <FileText aria-hidden size={14} className="shrink-0 text-[var(--n-500)]" />
                <span className="t-sm min-w-0 flex-1 truncate text-[var(--n-800)]">{d.filename}</span>
                <span className="t-xs shrink-0 text-[var(--n-500)]">{d.kind}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Link href={`${base}/take-off`} data-region="adhoc-takeoff" className="group flex flex-col gap-1 rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-0)] px-5 py-4 hover:border-[var(--a-300)]">
          <span className="t-base inline-flex items-center gap-1.5 font-semibold text-[var(--n-800)]">
            <Ruler aria-hidden size={15} /> Measure from the drawings
            <ArrowRight aria-hidden size={14} className="text-[var(--n-400)] group-hover:text-[var(--a-600)]" />
          </span>
          <span className="t-sm text-[var(--n-600)]">Quantities, tonnages and counts off the filed drawings – exportable to Excel to send on.</span>
        </Link>
        <div className="flex flex-col gap-1 rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-0)] px-5 py-4">
          <span className="t-base font-semibold text-[var(--n-800)]">Ask the assistant</span>
          <span className="t-sm text-[var(--n-600)]">It reads this request and its inputs. Ask it to list, compare or summarise – every figure comes with the passage it was read from.</span>
        </div>
      </section>
    </div>
  );
}
