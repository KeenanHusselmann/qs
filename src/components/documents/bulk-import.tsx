/**
 * Bringing a whole corpus in at once — PLATFORM.md §1.1, §1.3.2.
 *
 * ── Why this exists ────────────────────────────────────────────────────────────────────────
 *
 * A real feasibility arrives as a folder: a land-use submission with fourteen annexures, a market
 * study, bulk services reports, a geotech, drawings. Forty-odd files. Filing them one at a time,
 * choosing a kind from a select each time, is precisely the mechanical admin this platform is for.
 *
 * ── Three things the research is unanimous about ───────────────────────────────────────────
 *
 * 1. **Take the folder.** People have the documents arranged already; asking them to flatten and
 *    re-select is work the browser can do.
 * 2. **One review pass, not forty prompts.** The kind is guessed from the folder name, every guess
 *    is shown, and anything wrong is corrected in place before a byte is sent. §1.3 forbids a
 *    silent default — the guess saves typing, the human keeps the decision.
 * 3. **Per-file outcomes.** Thirty files where twenty-eight land and two fail is the normal case,
 *    and one "Import complete" hides the two. Each row carries its own state and its own reason,
 *    and a failed row can be retried without redoing the batch.
 *
 * Scanned PDFs are the expected failure here: they file, they parse to nothing, and the row says so
 * rather than reporting success for a document no search will ever find.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { CircleAlert, CircleCheck, FolderOpen, Loader2, RotateCcw, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { inferKind } from "@/lib/ingest/infer-kind";
import { fileDocument } from "@/lib/ingest/file-document";
import { ImportProgressDialog, type ImportProgress } from "@/components/documents/import-progress";
import { mb, overProxyLimit } from "@/lib/ingest/limits";
import { moduleOrder, placementFor, isUnreadable, isNotADocument, UNPLACED } from "@/lib/ingest/placement";
import { HANDLING, classOf } from "@/lib/ingest/document-class";
import { DOCUMENT_KINDS } from "@/lib/document-kinds";

type RowState = "ready" | "importing" | "done" | "failed";

interface Row {
  id: string;
  file: File;
  path: string;
  kind: string;
  /** What the guess was based on, so a reader can judge it rather than trust it. */
  because: string | null;
  state: RowState;
  note?: string;
  /**
   * A URL for the file sitting in the browser, so it can be opened before it is filed.
   *
   * `blob:` rather than a link to the platform, because at this point the platform has never seen
   * this document — there is nothing on the server to link to. The object URL points at the `File`
   * the drop already put in memory, so opening it copies nothing and costs nothing.
   *
   * Revoked when the row goes, or the browser holds the handle until the tab closes.
   */
  preview: string;
}

let counter = 0;

export function BulkImport({ projectId }: { projectId: string }) {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  /**
   * The batch as a whole, for the dialog. The per-row notes are still the record of what happened
   * to each file; this is the thing a person watches while it runs and reads when it stops.
   */
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [dragging, setDragging] = useState(false);
  const [skipped, setSkipped] = useState(0);
  /** Plotter configs and editor backups that came in with the folder. Counted, never silent. */
  const [ignored, setIgnored] = useState(0);

  /**
   * Release the object URLs when this screen goes away.
   *
   * A `blob:` URL keeps its `File` alive until it is revoked or the document is destroyed. Sixty of
   * them left behind on every visit to the import screen is a leak that only shows up in a long
   * session, which is the kind that gets blamed on something else.
   */
  const handed = useRef(new Set<string>());
  useEffect(() => {
    const urls = handed.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  /** Revoke one, and stop tracking it. Called wherever a row leaves the list. */
  const release = (url: string) => {
    URL.revokeObjectURL(url);
    handed.current.delete(url);
  };

  function add(files: FileList | File[]) {
    const next: Row[] = [];
    let held = 0;
    let ignored = 0;

    for (const file of Array.from(files)) {
      // CAD files are kept out of the list rather than filling it with rows that can only fail.
      // Counted, not silently dropped — see `isUnreadable`.
      if (isUnreadable(file.name)) {
        held += 1;
        continue;
      }

      /**
       * Plotter configurations, pen tables and editor backups. A submission folder carries the
       * working directory of whoever drew the drawings, and `PlotCfgs/DWG To PDF.pc3` came in with
       * it. Offering that for classification asks a QS what kind of construction document a printer
       * driver is; there is no answer, so the row could never be cleared.
       */
      if (isNotADocument(file.name)) {
        ignored += 1;
        continue;
      }

      // webkitRelativePath carries the folder structure; a plain drop of loose files has none.
      const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      const guess = inferKind(path, DOCUMENT_KINDS);

      const preview = URL.createObjectURL(file);
      handed.current.add(preview);

      next.push({
        id: `row-${counter++}`,
        file,
        path,
        kind: guess.kind ?? "",
        because: guess.because,
        state: "ready",
        preview,
      });
    }

    setRows((current) => [...current, ...next]);
    if (held > 0) setSkipped((n) => n + held);
    if (ignored > 0) setIgnored((n) => n + ignored);
  }

  const update = (id: string, patch: Partial<Row>) =>
    setRows((current) => current.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  /**
   * File everything queued, or only what failed.
   *
   * Retrying the whole batch after two of fifty-nine failed means re-uploading fifty-seven
   * documents that are already filed, which on a real corpus is several minutes and a lot of
   * bandwidth for nothing. A failure is usually one document's problem — a reader that choked, a
   * connection that dropped — so the retry is scoped to the documents that actually have it.
   */
  async function importAll(only: "all" | "failed" = "all") {
    setBusy(true);

    const wanted = (row: Row) =>
      row.state !== "done" && Boolean(row.kind) && (only === "all" || row.state === "failed");

    const queued = rows.filter(wanted);
    const batch: ImportProgress = {
      total: queued.length,
      filed: 0,
      failed: [],
      unreadable: [],
      done: false,
    };
    setProgress({ ...batch });

    // Sequential, not parallel. Forty concurrent uploads of scanned PDFs is how you discover the
    // body-size limit and the function timeout at the same time, and the failures that come back
    // are about the browser rather than the documents.
    for (const row of rows) {
      if (!wanted(row)) continue;

      update(row.id, { state: "importing", note: undefined });
      batch.current = { name: row.file.name, size: row.file.size };
      setProgress({ ...batch });

      /**
       * Large documents no longer fail here.
       *
       * This refused anything over the platform's ~4.5 MB body limit — honestly, and with nothing
       * to offer — which meant the 22 MB market study and the 11.8 MB geotechnical report, two of
       * the documents a feasibility leans on hardest, could not be filed at all. They now go to
       * storage from the browser. `fileDocument` decides which way, on size alone.
       */
      const outcome = await fileDocument({
        projectId,
        file: row.file,
        kind: row.kind,
        path: row.path,
        // Only where the wait is long enough to need one. A 22 MB upload with no sign of movement
        // is indistinguishable from a hung one.
        onProgress: overProxyLimit(row.file.size)
          ? (fraction) => {
              update(row.id, {
                note: `${Math.round(fraction * 100)}% of ${mb(row.file.size)} sent to storage`,
              });
              batch.current = { name: row.file.name, size: row.file.size, fraction };
              setProgress({ ...batch });
            }
          : undefined,
      });

      if (!outcome.ok) {
        update(row.id, { state: "failed", note: outcome.error });
        batch.failed.push({ name: row.file.name, reason: outcome.error });
      } else {
        // A warning means it filed but nothing readable came out — usually a scan. Said plainly:
        // a document no search can reach must not read as a clean success.
        update(row.id, { state: "done", note: outcome.warning });
        batch.filed += 1;
        if (outcome.warning) {
          // The kind travels with it: it is what tells a drawing (working as designed) from a scan
          // (a real gap someone can close).
          batch.unreadable.push({ name: row.file.name, kind: row.kind, reason: outcome.warning });
        }
      }

      setProgress({ ...batch });
    }

    batch.current = undefined;
    batch.done = true;
    setProgress({ ...batch });

    setBusy(false);
    router.refresh();
  }

  /*
    Arranged the way the work is, not as a flat list of forty filenames.

    Step → requirement → file. A reader scanning it sees "Site & zoning wants a title deed and I
    have given it one" rather than forty rows of vocabulary they have to hold in their head. The
    grouping is derived from the criteria, so it cannot describe a filing the engine would not
    perform, and a file re-typed in the unplaced group moves into its step immediately — which is
    the whole point of grouping by meaning rather than by upload order.
  */
  const groups = (() => {
    const byModule = new Map<
      string,
      { label: string; order: number; criteria: Map<string, { label: string; rows: Row[] }> }
    >();

    for (const row of rows) {
      const place = row.kind
        ? placementFor(row.kind)
        : {
            module: UNPLACED,
            moduleLabel: "Not yet placed",
            criterionId: null,
            criterionLabel: "Tell us what these are",
          };

      const key = place.module;
      if (!byModule.has(key)) {
        byModule.set(key, {
          label: place.moduleLabel,
          order: moduleOrder(key),
          criteria: new Map(),
        });
      }

      const step = byModule.get(key)!;
      const criterionKey = place.criterionId ?? "unplaced";
      if (!step.criteria.has(criterionKey)) {
        step.criteria.set(criterionKey, { label: place.criterionLabel, rows: [] });
      }
      step.criteria.get(criterionKey)!.rows.push(row);
    }

    return [...byModule.entries()]
      .map(([key, m]) => ({ key, ...m, criteria: [...m.criteria.values()] }))
      .sort((a, b) => a.order - b.order);
  })();

  const unclassified = rows.filter((r) => !r.kind).length;
  const pending = rows.filter((r) => r.state !== "done" && r.kind).length;
  const done = rows.filter((r) => r.state === "done").length;
  const failed = rows.filter((r) => r.state === "failed").length;

  return (
    <div className="flex flex-col">
      <ImportProgressDialog progress={progress} onClose={() => setProgress(null)} />

      {/* ── The drop zone ──────────────────────────────────────────────────────────────── */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) add(e.dataTransfer.files);
        }}
        className={`flex flex-col items-center rounded-[var(--r-lg)] border border-dashed px-6 py-8 text-center transition-colors ${
          dragging
            ? "border-[var(--a-500)] bg-[var(--a-50)]"
            : "border-[var(--n-200)] bg-[var(--n-25)]"
        }`}
        style={{ transitionDuration: "var(--m-fast)" }}
      >
        <FolderOpen aria-hidden size={22} strokeWidth={1.5} className="text-[var(--n-400)]" />
        <p className="t-base mt-2 font-medium text-[var(--n-800)]">
          Drop the project folder here
        </p>
        <p className="t-sm mt-1 max-w-[52ch] text-[var(--n-500)]">
          Sub-folders come too. Each document&rsquo;s kind is read from the folder it sits in —
          you check them all on one screen before anything is filed.
        </p>

        {/* webkitdirectory is how a browser offers a folder. Non-standard, universally supported. */}
        <input
          ref={input}
          type="file"
          multiple
          // @ts-expect-error — directory pickers are not in the DOM types.
          webkitdirectory=""
          className="sr-only"
          onChange={(e) => {
            if (e.target.files?.length) add(e.target.files);
            e.target.value = "";
          }}
        />

        <button
          type="button"
          onClick={() => input.current?.click()}
          className="t-base mt-4 h-8 rounded-[var(--r-md)] bg-[var(--a-500)] px-3 font-medium text-white transition-colors hover:bg-[var(--a-600)]"
          style={{ transitionDuration: "var(--m-fast)" }}
        >
          Choose a folder
        </button>
      </div>

      {rows.length > 0 && (
        <>
          {/* ── What is about to happen, before it happens ──────────────────────────────── */}
          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="t-base font-medium text-[var(--n-800)]">
              {rows.length} {rows.length === 1 ? "file" : "files"}
            </span>
            {unclassified > 0 && (
              <span className="t-sm text-[var(--warn-700)]">
                {unclassified} need a kind before they can be filed
              </span>
            )}
            {done > 0 && <span className="t-sm text-[var(--ok-700)]">{done} filed</span>}
            {failed > 0 && <span className="t-sm text-[var(--err-700)]">{failed} failed</span>}
            {skipped > 0 && (
              <span className="t-sm text-[var(--n-500)]">
                {skipped} CAD {skipped === 1 ? "file" : "files"} skipped — file the PDF issue instead
              </span>
            )}
            {ignored > 0 && (
              <span className="t-sm text-[var(--n-500)]">
                {ignored} {ignored === 1 ? "file is" : "files are"} not documents — plotter settings
                and backups, left out
              </span>
            )}
          </div>

          <div className="mt-3 flex flex-col gap-4">
            {groups.map((group) => (
              <section
                key={group.key}
                className={`overflow-hidden rounded-[var(--r-lg)] border ${
                  group.key === UNPLACED
                    ? "border-[var(--warn-500)] bg-[var(--warn-50)]/30"
                    : "border-[var(--n-200)]"
                }`}
              >
                <header className="flex items-baseline justify-between border-b border-[var(--n-100)] px-3 py-2">
                  <h3 className="t-xl text-[var(--n-800)]">{group.label}</h3>
                  <span className="num t-md text-[var(--n-500)]">
                    {group.criteria.reduce((n, c) => n + c.rows.length, 0)}
                  </span>
                </header>

                {/*
                  Three levels, and only two of them used to be visible: the step's card and the
                  document rows. The requirement between them was a tinted strip in the lightest
                  grey the palette has, smaller and fainter than the filenames beneath it — the
                  label that organises the list rendered quieter than the things it organises. At a
                  squint it read as one column of blue names with no beginnings.

                  It is a heading now, and it is spaced like one: generous above, tight below, so
                  proximity binds it downward to its own rows instead of leaving every interval
                  equal. The rows hang off a hairline rule, which contains the group without making
                  it a card — a card inside a card is the lazy way to say "these belong together",
                  and it would put a border around all eight groups to solve a problem in one.

                  Sentence case rather than uppercase: these are full phrases — "Site location and
                  extent", "Environmental authorisation" — and uppercase costs a reader more on a
                  long string than the tidiness is worth.
                */}
                {group.criteria.map((criterion, index) => (
                  <div key={criterion.label}>
                    {/*
                      A banded heading rather than a card of its own. It spans the card, so the rule
                      above it is a real division across the whole width instead of an indent that
                      the eye has to infer, and the tint says "this is a heading" at a glance in a
                      list where the loudest thing on every other line is a blue filename.

                      Banded, not nested: a rounded bordered card inside a rounded bordered card
                      puts eight frames on screen to express one relationship, and the corners never
                      agree. The band and the rule do the same work with two flat edges.
                    */}
                    <h4
                      className={`t-lg bg-[var(--n-50)] px-4 py-2.5 text-[var(--n-800)] ${
                        index === 0 ? "" : "border-t border-[var(--n-200)]"
                      }`}
                    >
                      {criterion.label}
                    </h4>

                    <ul className="flex flex-col px-4">
                      {criterion.rows.map((row) => (
                        <li
                          key={row.id}
                          className="flex items-start gap-3 border-b border-[var(--n-100)] py-2.5 last:border-b-0"
                        >
                          <Status state={row.state} />

                          <span className="min-w-0 flex-1">
                            {/*
                              Openable before it is filed.

                              The three files a folder import cannot classify are the ones whose
                              names say nothing — "Sheet-Project Site.pdf", a drawing number. The
                              only way to know what they are is to look, and a QS was being asked
                              to choose a kind for a document they could not see. It opens from the
                              browser's own copy: nothing has been uploaded yet.
                            */}
                            <a
                              href={row.preview}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={`Open ${row.file.name} to see what it is`}
                              data-preview={row.id}
                              className="t-sm block truncate font-medium text-[var(--a-600)] underline decoration-[var(--n-300)] underline-offset-2 hover:decoration-[var(--a-600)]"
                            >
                              {row.file.name}
                            </a>
                            <span className="t-xs block truncate text-[var(--n-400)]">
                              {row.note ?? (row.because ? `from “${row.because}”` : row.path)}
                            </span>
                            {/* A drawing says what will happen to it. Filing one alongside the
                                market study, with no word about the difference, invites someone to
                                expect a run to read the site area out of it. */}
                            {row.kind && classOf(row.kind) === "spatial" && (
                              <span className="t-xs mt-0.5 inline-block rounded-[var(--r-sm)] bg-[var(--n-100)] px-1.5 text-[var(--n-600)]">
                                {HANDLING.spatial}
                              </span>
                            )}
                          </span>

                          {/* The guess, editable. Choosing here moves the file into its step. */}
                          <select
                            value={row.kind}
                            disabled={row.state === "importing" || row.state === "done"}
                            onChange={(e) => update(row.id, { kind: e.target.value })}
                            className={`t-sm h-7 w-[220px] shrink-0 rounded-[var(--r-sm)] border bg-[var(--n-0)] px-1.5 outline-none disabled:opacity-60 ${
                              row.kind ? "border-[var(--n-200)]" : "border-[var(--warn-500)]"
                            }`}
                          >
                            <option value="">Choose a kind…</option>
                            {DOCUMENT_KINDS.map((kind) => (
                              <option key={kind} value={kind}>
                                {kind}
                              </option>
                            ))}
                          </select>

                          <button
                            type="button"
                            aria-label={`Remove ${row.file.name}`}
                            disabled={busy}
                            onClick={() => {
                              release(row.preview);
                              setRows((c) => c.filter((r) => r.id !== row.id));
                            }}
                            className="grid size-6 shrink-0 place-items-center rounded-[var(--r-sm)] text-[var(--n-400)] transition-colors hover:bg-[var(--err-50)] hover:text-[var(--err-500)] disabled:opacity-40"
                            style={{ transitionDuration: "var(--m-fast)" }}
                          >
                            <X aria-hidden size={13} strokeWidth={2} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            ))}
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              disabled={busy || pending === 0}
              onClick={() => importAll("all")}
              className="t-base flex h-8 items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--a-500)] px-3 font-medium text-white transition-colors hover:bg-[var(--a-600)] disabled:opacity-50"
              style={{ transitionDuration: "var(--m-fast)" }}
            >
              {busy && <Loader2 aria-hidden size={14} strokeWidth={2} className="animate-spin" />}
              {busy ? "Filing…" : `File ${pending} ${pending === 1 ? "document" : "documents"}`}
            </button>

            {/*
              Only the ones that did not land. Re-running the whole batch after two of fifty-nine
              failed would re-upload fifty-seven documents that are already filed — minutes, and a
              lot of bandwidth, to fix two. A failure is usually one document's own problem.
            */}
            {!busy && failed > 0 && (
              <button
                type="button"
                onClick={() => importAll("failed")}
                data-retry-failed
                className="t-base flex h-8 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--err-500)] px-3 font-medium text-[var(--err-700)] transition-colors hover:bg-[var(--err-50)]"
                style={{ transitionDuration: "var(--m-fast)" }}
              >
                <RotateCcw aria-hidden size={14} strokeWidth={2} />
                Retry {failed} that failed
              </button>
            )}

            {!busy && rows.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  for (const r of rows) release(r.preview);
                  setRows([]);
                }}
                className="t-sm text-[var(--n-500)] hover:text-[var(--n-800)]"
              >
                Clear
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Status({ state }: { state: RowState }) {
  // Nudged to the cap height of the filename beside it, now that a row can be three lines tall.
  const shared = "mt-0.5 shrink-0";

  if (state === "importing")
    return (
      <Loader2
        aria-label="Filing"
        size={15}
        strokeWidth={2}
        className={`${shared} animate-spin text-[var(--a-500)]`}
      />
    );

  if (state === "done")
    return (
      <CircleCheck aria-label="Filed" size={15} strokeWidth={2} className={`${shared} text-[var(--ok-500)]`} />
    );

  if (state === "failed")
    return (
      <CircleAlert aria-label="Failed" size={15} strokeWidth={2} className={`${shared} text-[var(--err-500)]`} />
    );

  return <span aria-hidden className={`${shared} size-[15px] rounded-full border border-[var(--n-300)]`} />;
}
