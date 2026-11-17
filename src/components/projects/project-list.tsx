/**
 * The working list of projects — PLATFORM.md §4.4, and §4.1's "users have 5–50 projects".
 *
 * ── Why it grew columns ────────────────────────────────────────────────────────────────────
 *
 * It carried three — Project, Client, Documents — with no status, no stage, no progress and no
 * filter, while the Portfolio beside it carried all of that. So the page named *Projects* was the
 * least useful way to choose a project: a junior QS told to open "the Menlyn job" had to know its
 * name exactly and read down a column. At fifty jobs that is not navigation.
 *
 * Every column is a figure somebody can check, and each comes from one place: the status and stages
 * off the project row, the signatures and the things needing attention from `loadPortfolio` — the
 * same derivation the Portfolio and a project's dashboard read, so the three screens cannot disagree.
 *
 * ── The filter is client-side, and matches what a QS says ──────────────────────────────────
 *
 * Name, code or client, case-insensitive, anywhere in the word. The list is already on the page and
 * a round-trip per keystroke would buy nothing. A code is how a practice often names a job aloud.
 */

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";

export interface ProjectListRow {
  id: string;
  name: string;
  code: string | null;
  client: string | null;
  status: string;
  /** "Every stage", one stage's name, or the first and a count. */
  stages: string;
  documents: number;
  signed: number;
  signable: number;
  /** Things the Portfolio flags on this project — unsigned upstreams, holes, totals that disagree. */
  attention: number;
  /** A test project – listed and worked, left out of the firm's figures (audit C5). */
  test: boolean;
}

/** An archived project, as the filed section lists it. */
export interface ArchivedRow {
  id: string;
  name: string;
  code: string | null;
  client: string | null;
  documents: number;
}

const HEADINGS = ["Project", "Status", "Runs", "Signed off", "Documents", "Needs attention"] as const;

const matching = <T extends { name: string; code: string | null; client: string | null }>(
  rows: readonly T[],
  query: string,
) => {
  const needle = query.trim().toLowerCase();
  if (needle === "") return rows;
  return rows.filter((row) =>
    [row.name, row.code ?? "", row.client ?? ""].some((field) => field.toLowerCase().includes(needle)),
  );
};

/**
 * The working list, and the filed one under it – one filter over both.
 *
 * Round-1 testing: an archived project could not be found by its exact name. The archived section
 * existed, closed, and the filter above it only read the working list, so typing the name said
 * "no project" about a project that was on the page. The filter now reads both, and opens the
 * archived section itself when that is where the match is.
 */
export function ProjectList({
  rows,
  archived = [],
}: {
  rows: readonly ProjectListRow[];
  archived?: readonly ArchivedRow[];
}) {
  const [query, setQuery] = useState("");
  const [opened, setOpened] = useState(false);

  const shown = useMemo(() => matching(rows, query), [rows, query]);
  const filed = useMemo(() => matching(archived, query), [archived, query]);
  const searching = query.trim() !== "";

  return (
    <div className="mt-5 flex flex-col gap-3">
      <label className="flex h-9 w-full max-w-[360px] items-center gap-2 rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] px-3 focus-within:border-[var(--a-500)]">
        <Search aria-hidden size={15} strokeWidth={1.75} className="shrink-0 text-[var(--n-500)]" />
        <input
          data-region="project-filter"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a project by name, code or client"
          aria-label="Find a project by name, code or client"
          className="t-base min-w-0 flex-1 bg-transparent outline-none placeholder:text-[var(--n-500)]"
        />
      </label>

      {rows.length === 0 ? (
        <p data-region="all-archived" className="t-sm px-3 py-2 text-[var(--n-600)]">
          Every project is archived. They are listed under Archived below.
        </p>
      ) : (
      <table data-region="project-list" className="w-full table-fixed border-collapse">
        {/*
          Sized for 1024, the narrowest `checks/viewport.mjs` holds, where the table gets ~740px.
          One-word headers cannot wrap, so they set the floor: "Documents" needs 94px and had 74
          at 10%. Two-word headers wrap onto a second line and cost nothing.
        */}
        <colgroup>
          <col className="w-[31%]" />
          <col className="w-[12%]" />
          <col className="w-[17%]" />
          <col className="w-[12%]" />
          <col className="w-[14%]" />
          <col className="w-[14%]" />
        </colgroup>
        <thead>
          <tr className="h-9 text-left">
            {HEADINGS.map((heading) => (
              <th
                key={heading}
                scope="col"
                className="t-sm border-b border-[var(--n-200)] px-3 font-semibold tracking-[0.03em] text-[var(--n-600)] uppercase"
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <tr key={row.id} className="border-b border-[var(--n-100)] hover:bg-[var(--n-25)]">
              <td className="min-w-0 px-3 py-2">
                <Link
                  href={`/projects/${row.id}`}
                  className="t-base block truncate font-medium text-[var(--a-600)] hover:underline"
                >
                  {row.name}
                </Link>
                <span className="t-sm block truncate text-[var(--n-600)]">
                  {row.test && (
                    <span data-test-project className="t-xs mr-1.5 rounded-[var(--r-sm)] bg-[var(--n-100)] px-1.5 py-0.5 text-[var(--n-600)]">
                      Test
                    </span>
                  )}
                  {[row.code, row.client].filter(Boolean).join(" · ") || "No client recorded"}
                </span>
              </td>
              <td className="t-sm px-3 py-2 text-[var(--n-700)]">{row.status}</td>
              <td className="t-sm truncate px-3 py-2 text-[var(--n-700)]" title={row.stages}>
                {row.stages}
              </td>
              <td className="num t-sm px-3 py-2 text-[var(--n-700)]">
                {row.signed} of {row.signable}
              </td>
              <td className="num t-sm px-3 py-2">
                {/* Zero is said, not left blank — an empty cell reads as "unknown". */}
                <span className={row.documents ? "text-[var(--n-700)]" : "text-[var(--n-600)]"}>
                  {row.documents}
                </span>
              </td>
              <td className="t-sm px-3 py-2">
                {row.attention > 0 ? (
                  <Link
                    href={`/projects/${row.id}/dashboard`}
                    className="font-medium text-[var(--warn-700)] hover:underline"
                  >
                    {row.attention} {row.attention === 1 ? "thing" : "things"}
                  </Link>
                ) : (
                  <span className="text-[var(--n-600)]">Nothing</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      )}

      {rows.length > 0 && shown.length === 0 && (
        <p data-region="project-filter-empty" className="t-sm px-3 py-4 text-[var(--n-600)]">
          {filed.length > 0
            ? `No working project matches “${query.trim()}” – ${filed.length === 1 ? "an archived one does" : `${filed.length} archived ones do`}, below.`
            : `No project’s name, code or client contains “${query.trim()}”, archived or not.`}
        </p>
      )}

      {archived.length > 0 && (!searching || filed.length > 0) && (
        <details
          data-region="archived"
          className="group mt-3"
          open={opened || (searching && filed.length > 0)}
          onToggle={(event) => {
            if (!searching) setOpened(event.currentTarget.open);
          }}
        >
          <summary className="t-sm flex w-fit cursor-pointer list-none items-center gap-1.5 text-[var(--n-600)] hover:text-[var(--n-800)] [&::-webkit-details-marker]:hidden">
            <ChevronRight
              aria-hidden
              size={13}
              strokeWidth={2}
              className="transition-transform group-open:rotate-90"
              style={{ transitionDuration: "var(--m-fast)" }}
            />
            Archived
            <span className="num t-xs rounded-[var(--r-full)] bg-[var(--n-100)] px-1.5 py-0.5 text-[var(--n-600)]">
              {searching ? `${filed.length} of ${archived.length}` : archived.length}
            </span>
          </summary>

          <p className="t-sm mt-2 max-w-[70ch] text-[var(--n-500)]">
            Finished work the practice keeps. Still readable, still citable, and out of the working
            list – open one to restore it.
          </p>

          <table className="mt-3 w-full border-collapse">
            <tbody>
              {filed.map((project) => (
                <tr key={project.id} className="h-9 border-b border-[var(--n-100)] hover:bg-[var(--n-25)]">
                  <td className="px-3">
                    <Link href={`/projects/${project.id}`} className="t-base text-[var(--a-600)] hover:underline">
                      {project.name}
                    </Link>
                    {project.code && <span className="t-sm ml-2 text-[var(--n-500)]">{project.code}</span>}
                    {/* Said in words as well as by where it sits – §7.1 #5, never colour or position alone. */}
                    <span className="t-xs ml-2 rounded-[var(--r-sm)] bg-[var(--n-100)] px-1.5 py-0.5 text-[var(--n-600)]">
                      Archived
                    </span>
                  </td>
                  <td className="t-base px-3 text-[var(--n-600)]">{project.client ?? "–"}</td>
                  <td className="num t-base px-3 text-[var(--n-500)]">{project.documents}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
