/**
 * The advisor — the assistant panel on every project screen. A conversation, and only that.
 *
 * ── Why the job's status is not here ───────────────────────────────────────────────────────
 *
 * The status card (stage, documents, next step) sat above the conversation and then behind a tab,
 * and readers took it for part of the chat — an answer they had not asked for. The job's status is a
 * property of the project, so it lives on the project overview as the project agent
 * (`project-agent.tsx`), and this panel is only for questions.
 *
 * ── Ask anything, or ask the documents ─────────────────────────────────────────────────────
 *
 * A switch on the box says what the question is asked of. "Ask anything" answers from professional
 * knowledge, as a structured summary with links into the platform. "Project documents" answers only
 * from this project's filed documents, and lists the documents it read, openable.
 */

"use client";

import { handAttachment } from "@/lib/ingest/file-document";
import { overProxyLimit } from "@/lib/ingest/limits";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, BookOpen, Calculator, Check, ChevronRight, FileSearch, FileText, GitBranch, Globe, History, Loader2, Paperclip, Sparkles, Trash2 } from "lucide-react";

import type { Answer as Grounded } from "@/lib/agent/ask";
import type { RecalledNote } from "@/lib/agent/memory";
import type { WebAnswer, WebStructured } from "@/lib/agent/search";
import { DOCUMENT_KINDS } from "@/lib/document-kinds";
import { fileDocument } from "@/lib/ingest/file-document";
import { inferKind } from "@/lib/ingest/infer-kind";
import { documentHref } from "@/components/documents/document-link";
import { AssistantPanel } from "@/components/shell/assistant-panel";
import {
  AssistantMessage,
  Composer,
  FailedMessage,
  FollowUps,
  GeneralGuidance,
  SourceList,
  Thinking,
  ToolResultCard,
  UserBubble,
  Welcome,
  generalText,
  revealLatest,
  toolTextForCopy,
  type ComposerMode,
  type Suggestion,
  HeldFiles,
  ReadCoverage,
  keepFiles,
} from "@/components/shell/assistant-ui";
import { whyUnreachable } from "@/lib/unreachable";

interface Answer {
  /** Present for a typed question. */
  answer?: (Grounded & { cost: number | null }) | null;
  /** The web channel — a page and a moment, a weaker claim than a filed document (`search.ts`). */
  web?: (WebAnswer & { cost: number | null }) | null;
  unavailable?: string;
}

type Mode = "general" | "documents";

/** One exchange in the conversation. */
interface Exchange {
  id: number;
  question: string;
  files: File[];
  /** How many files this question read – the kept ones as well as any attached with it. */
  reading?: number;
  web: boolean;
  mode: Mode;
  reply: Answer | null;
  failed: string | null;
}

/** The questions a stuck reader actually arrives with. */
const SUGGESTIONS: readonly Suggestion[] = [
  { icon: BookOpen, label: "What does absorption rate mean?", question: "What does absorption rate mean?" },
  {
    icon: FileText,
    label: "Where do I get a bulk services contribution?",
    question: "Where do I get a bulk services contribution?",
  },
  { icon: GitBranch, label: "What is P&G, and who prices it?", question: "What is P&G, and who prices it?" },
  {
    icon: Calculator,
    label: "How many bricks for 240 m² of one-brick wall?",
    question: "How many bricks do I need for 240 m² of one-brick wall in stock brick?",
  },
];

const MODES: readonly ComposerMode[] = [
  { value: "general", label: "Ask anything", icon: Sparkles, placeholder: "Ask anything, or paste a term…" },
  {
    value: "documents",
    label: "Project documents",
    icon: FileSearch,
    placeholder: "Ask what this project's documents say…",
  },
];

export function AdvisorPanel({ projectId, projectName }: { projectId: string; projectName: string }) {
  const [thread, setThread] = useState<Exchange[]>([]);
  const [asking, setAsking] = useState(false);
  // The files this conversation keeps reading – every question asks of them until one is removed.
  const [held, setHeld] = useState<File[]>([]);
  // Large kept files, uploaded once to the store: each question sends the pathname, not the bytes.
  const handed = useRef(new Map<File, string>());

  /** Stop keeping files – and delete any copy handed to the store for them. */
  const forget = useCallback(
    (files: readonly File[]) => {
      const pathnames = files.flatMap((f) => {
        const p = handed.current.get(f);
        handed.current.delete(f);
        return p ? [p] : [];
      });
      setHeld((h) => h.filter((f) => !files.includes(f)));
      if (pathnames.length > 0) {
        void fetch(`/api/projects/${projectId}/advice`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ discard: pathnames }),
        }).catch(() => {});
      }
    },
    [projectId],
  );
  const inFlight = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => () => inFlight.current?.abort(), []);

  const send = useCallback(
    async ({
      question,
      files,
      web,
      mode = "general",
    }: {
      question: string | null;
      files: File[];
      web: boolean;
      mode?: string;
    }) => {
      const text = (question ?? "").trim();
      if (text.length === 0) return;
      const asked: Mode = mode === "documents" ? "documents" : "general";

      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;

      const id = nextId.current++;
      // Earlier turns, as text. Only what was said — no figures are re-trusted from them.
      const history = thread.flatMap((exchange) => [
        { role: "user" as const, text: exchange.question },
        ...(exchange.reply?.answer
          ? [
              {
                role: "assistant" as const,
                text: [
                  exchange.reply.answer.general?.summary,
                  exchange.reply.answer.answer,
                  exchange.reply.answer.general?.explanation,
                ]
                  .filter(Boolean)
                  .join(" "),
              },
            ]
          : []),
        /*
          A web finding is part of the conversation too. Left out, "cement cost" asked straight after
          a web search for cement prices reached the advisor as if nothing had been found. Only the
          summary: the figures come back through the saved note, with its date and pages beside them.
        */
        ...(exchange.reply?.web
          ? [
              {
                role: "assistant" as const,
                text: `(From a web search) ${exchange.reply.web.structured?.summary ?? exchange.reply.web.text}`,
              },
            ]
          : []),
      ]);

      // What this question reads: the files kept from earlier questions, and any attached now.
      const reading = keepFiles(held, files);
      if (files.length > 0) setHeld(reading);

      setThread((previous) => [...previous, { id, question: text, files, reading: reading.length, web, mode: asked, reply: null, failed: null }]);
      setAsking(true);

      const settle = (patch: Partial<Exchange>) =>
        setThread((previous) => previous.map((e) => (e.id === id ? { ...e, ...patch } : e)));

      try {
        let body: BodyInit;
        const headers: Record<string, string> = {};

        if (reading.length > 0 && !web) {
          const form = new FormData();
          form.set("question", text);
          form.set("web", String(web));
          form.set("mode", asked);
          form.set("history", JSON.stringify(history));
          const stored: { pathname: string; name: string }[] = [];
          for (const file of reading) {
            let pathname = handed.current.get(file) ?? null;
            if (!pathname && overProxyLimit(file.size)) {
              pathname = await handAttachment(projectId, file);
              if (pathname) handed.current.set(file, pathname);
            }
            if (pathname) stored.push({ pathname, name: file.name });
            else form.append("files", file, file.name);
          }
          form.set("stored", JSON.stringify(stored));
          body = form;
        } else {
          headers["content-type"] = "application/json";
          body = JSON.stringify({ question: text, web, history, mode: asked });
        }

        const response = await fetch(`/api/projects/${projectId}/advice`, {
          method: "POST",
          headers,
          body,
          signal: controller.signal,
        });

        // Parsed defensively: a framework 500 has no JSON body, and `.json()` would throw on it.
        const reply = (await response.json().catch(() => null)) as (Answer & { error?: string }) | null;

        if (!response.ok || !reply) {
          settle({ failed: reply?.error ?? whyUnreachable(response.status, "The advisor") });
          return;
        }

        settle({ reply });
      } catch (error) {
        if (controller.signal.aborted) return;
        settle({
          failed: `The request did not reach the server: ${error instanceof Error ? error.message : "unknown error"}.`,
        });
      } finally {
        if (!controller.signal.aborted) setAsking(false);
      }
    },
    [projectId, thread, held],
  );

  const reset = () => {
    inFlight.current?.abort();
    setAsking(false);
    setThread([]);
    forget(held);
  };

  // Bring the newest exchange into view from its start.
  useEffect(() => {
    revealLatest(scroller.current);
  }, [thread]);

  const latest = thread.at(-1);
  const followUps = latest?.reply?.answer?.followUps ?? [];

  return (
    <AssistantPanel
      label="Advisor"
      offer="Ask the advisor anything"
      region="advisor"
      subtitle={projectName}
      expandable
      onReset={thread.length > 0 ? reset : undefined}
    >
      <div ref={scroller} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3.5 py-3.5">
        {thread.length === 0 ? (
          <Welcome
            region="advisor-suggestions"
            title="How can I help?"
            intro="Ask about any construction term or where to get the data — or switch to Project documents to ask what this job's documents say."
            suggestions={SUGGESTIONS}
            disabled={asking}
            onPick={(question) => void send({ question, files: [], web: false })}
          />
        ) : (
          <ol data-region="advisor-thread" className="flex flex-col gap-4">
            {thread.map((exchange) => (
              <li key={exchange.id} data-exchange={exchange.id} className="flex flex-col gap-2.5">
                <UserBubble
                  text={exchange.question}
                  files={exchange.files}
                  note={
                    exchange.web
                      ? "Asked of the web"
                      : exchange.mode === "documents"
                        ? "Asked of the project documents"
                        : undefined
                  }
                />
                {exchange.reply ? (
                  <Reply reply={exchange.reply} files={exchange.files} projectId={projectId} mode={exchange.mode} />
                ) : exchange.failed ? (
                  <FailedMessage reason={exchange.failed} />
                ) : (
                  <Thinking
                    label={
                      exchange.web
                        ? "Searching the web…"
                        : (exchange.reading ?? exchange.files.length) > 0
                          ? "Reading the attached document…"
                          : exchange.mode === "documents"
                            ? "Reading the project documents…"
                            : "Thinking…"
                    }
                  />
                )}
              </li>
            ))}
            {!asking && followUps.length > 0 && (
              <li>
                <FollowUps
                  questions={followUps}
                  onPick={(question) => void send({ question, files: [], web: false, mode: latest?.mode })}
                />
              </li>
            )}
          </ol>
        )}
      </div>

      <HeldFiles files={held} region="advisor" onRemove={(file) => forget([file])} />
      <Composer
        asking={asking}
        onSend={send}
        region="advisor-ask"
        who="advisor"
        placeholder="Ask anything, or paste a term…"
        ariaLabel="Ask the advisor anything about construction, this platform or this project"
        fileOnlyQuestion="What is this document, and what in it matters for this project?"
        // A kept document stays in the platform: the web is not asked while one is being read.
        allowWeb={held.length === 0}
        modes={MODES}
      />
    </AssistantPanel>
  );
}

// ── One reply ───────────────────────────────────────────────────────────────────────────────

function costLine(cost: number | null | undefined, usage?: { input: number; output: number }) {
  // Shown because it is spent on a click. A cost nobody can see is a cost nobody controls.
  return cost !== null && cost !== undefined && usage ? `R ${cost.toFixed(4)} · ${usage.input} in, ${usage.output} out` : undefined;
}

function Reply({ reply, files, projectId, mode }: { reply: Answer; files: File[]; projectId: string; mode: Mode }) {
  if (reply.web) {
    return (
      <AssistantMessage footer={costLine(reply.web.cost, reply.web.usage)} copyText={reply.web.text}>
        <FromTheWeb found={reply.web} />
      </AssistantMessage>
    );
  }

  if (reply.answer) {
    const answer = reply.answer;
    const documentsAnswer = mode === "documents";
    // An answer about an attached document is the answer, whatever else came with it.
    const attachmentAnswer = (answer.attached?.length ?? 0) > 0;
    // In documents mode the project answer is the answer; otherwise it is shown only without guidance.
    const note = documentsAnswer || attachmentAnswer || !answer.general ? answer.answer : "";
    const empty =
      !answer.general && !answer.answer && !answer.tool && answer.recalled.length === 0 && (!documentsAnswer || answer.sources.length === 0);

    return (
      <AssistantMessage
        footer={costLine(answer.cost, answer.usage)}
        copyText={[generalText(answer.general), note, toolTextForCopy(answer.tool)].filter(Boolean).join("\n\n") || undefined}
      >
        {!documentsAnswer && !attachmentAnswer && answer.general && (
          <GeneralGuidance general={answer.general} />
        )}
        {note && (
          <p data-region="advisor-answer" className={`t-sm leading-relaxed whitespace-pre-line text-[var(--n-800)] ${!documentsAnswer && !attachmentAnswer && answer.general ? "mt-3" : ""}`}>
            {note}
          </p>
        )}
        {attachmentAnswer && <ReadCoverage attached={answer.attached} />}
        {attachmentAnswer && answer.general && (
          <div className="mt-3 border-t border-[var(--n-100)] pt-3">
            <GeneralGuidance general={answer.general} />
          </div>
        )}
        {answer.tool && <ToolResultCard tool={answer.tool} />}
        {answer.recalled.length > 0 && <Remembered notes={answer.recalled} />}
        {(documentsAnswer || attachmentAnswer) && (
          <SourceList
            sources={answer.sources.map((source) => ({
              document: source.document,
              page: source.page,
              quote: source.quote,
              attached: source.attached,
              href: source.attached ? null : documentHref(projectId, source.documentId, source.document),
            }))}
          />
        )}
        {empty && (
          <p className="t-sm text-[var(--n-600)]">
            {documentsAnswer
              ? "Nothing in this project's filed documents covers that. File the document it would be in, or switch to Ask anything."
              : "I couldn't find anything to say about that. Try asking another way, or name the term or step you're stuck on."}
          </p>
        )}
        {files.length > 0 && <FileOffer files={files} projectId={projectId} />}
      </AssistantMessage>
    );
  }

  return (
    <AssistantMessage tone="error">
      <Unavailable reason={reply.unavailable} />
    </AssistantMessage>
  );
}

/**
 * Filing an attachment, offered after it has been asked about — never done on its own. The kind is
 * guessed from the filename and shown in a select so the reader decides; a wrong kind would satisfy
 * the wrong requirement.
 */
function FileOffer({ files, projectId }: { files: File[]; projectId: string }) {
  return (
    <div data-region="advisor-file-offer" className="mt-3 rounded-[var(--r-lg)] border border-dashed border-[var(--n-300)] p-2.5">
      <p className="t-xs text-[var(--n-600)]">
        Attachments are read in this conversation, never filed on their own. File one to add it to the project.
      </p>
      <ul className="mt-2 flex flex-col gap-2">
        {files.map((file) => (
          <FileRow key={file.name} file={file} projectId={projectId} />
        ))}
      </ul>
    </div>
  );
}

function FileRow({ file, projectId }: { file: File; projectId: string }) {
  const router = useRouter();
  const [kind, setKind] = useState(() => inferKind(file.name, DOCUMENT_KINDS).kind ?? "");
  const [state, setState] = useState<{ status: "idle" | "filing" | "filed" | "failed"; note?: string }>({
    status: "idle",
  });

  return (
    <li className="flex flex-col gap-1.5">
      <span className="t-xs flex min-w-0 items-center gap-1 font-medium text-[var(--n-800)]">
        <Paperclip aria-hidden size={11} strokeWidth={2} className="shrink-0" />
        <span className="truncate">{file.name}</span>
      </span>

      {state.status === "filed" ? (
        <span className="t-xs flex items-center gap-1 text-[var(--ok-700)]">
          <Check aria-hidden size={12} strokeWidth={2.5} />
          Filed as {kind}
        </span>
      ) : (
        <span className="flex items-center gap-1.5">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            disabled={state.status === "filing"}
            aria-label={`What ${file.name} is`}
            className="t-xs h-8 min-w-0 flex-1 rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] px-2 text-[var(--n-800)]"
          >
            <option value="">What is it?</option>
            {DOCUMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <button
            type="button"
            data-action="file-attachment"
            disabled={!kind || state.status === "filing"}
            onClick={async () => {
              setState({ status: "filing" });
              const outcome = await fileDocument({ projectId, file, kind }).catch(
                (error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : "unknown error" }) as const,
              );
              if (!outcome.ok) {
                setState({ status: "failed", note: outcome.error ?? "It could not be filed." });
                return;
              }
              setState({ status: "filed", note: "warning" in outcome ? outcome.warning : undefined });
              router.refresh();
            }}
            className="t-xs flex h-8 shrink-0 items-center gap-1 rounded-[var(--r-md)] bg-[var(--a-500)] px-2.5 font-medium text-white transition-colors hover:bg-[var(--a-600)] disabled:opacity-50"
            style={{ transitionDuration: "var(--m-fast)" }}
          >
            {state.status === "filing" && <Loader2 aria-hidden size={11} strokeWidth={2} className="animate-spin" />}
            File it
          </button>
        </span>
      )}

      {state.note && (
        <p className={`t-xs ${state.status === "failed" ? "text-[var(--err-700)]" : "text-[var(--warn-700)]"}`}>
          {state.note}
        </p>
      )}
    </li>
  );
}

/** A web answer's table. Money cells are kept on one line and set in tabular figures. */
function WebTable({ table }: { table: NonNullable<WebStructured["table"]> }) {
  return (
    <div data-region="web-table">
      {table.title && <h4 className="t-xs font-semibold tracking-[0.02em] text-[var(--n-500)] uppercase">{table.title}</h4>}
      <div className="mt-1.5 overflow-x-auto rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)]">
        <table className="t-xs w-full border-collapse text-left">
          <thead className="bg-[var(--n-50)]">
            <tr>
              {table.columns.map((column) => (
                <th key={column} scope="col" className="px-2.5 py-1.5 font-semibold whitespace-nowrap text-[var(--n-700)]">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, r) => (
              <tr key={r} className="border-t border-[var(--n-100)]">
                {row.map((cell, c) => (
                  <td
                    key={c}
                    className={`px-2.5 py-1.5 align-top text-[var(--n-800)] ${c === 0 ? "font-medium" : ""} ${
                      /^[\s~≈]*R\s?\d/.test(cell) ? "num whitespace-nowrap" : ""
                    }`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * The saved web findings an answer rests on – `lib/agent/memory.ts`.
 *
 * Each says it was remembered, from a web search, and when: a price recalled is a price found on
 * that date, not today. The table comes back as it was found; the rest of the note and its pages are
 * one click away, and so is forgetting it when it is wrong or out of date.
 */
function Remembered({ notes }: { notes: readonly RecalledNote[] }) {
  const [forgotten, setForgotten] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<string | null>(null);
  // Read once, when the answer is shown: how old a note is does not need to tick.
  const [now] = useState(() => Date.now());

  const forget = async (id: string) => {
    setFailed(null);
    const response = await fetch(`/api/advisor-notes/${id}`, { method: "DELETE" }).catch(() => null);
    if (response?.ok) setForgotten((previous) => new Set(previous).add(id));
    else setFailed("The note could not be forgotten. Try again.");
  };

  return (
    <div data-region="advisor-remembered" className="mt-3 flex flex-col gap-2">
      {notes.map((note) => {
        const found = new Date(note.savedAt);
        const days = Math.floor((now - found.getTime()) / 86_400_000);

        return (
          <section
            key={note.id}
            data-note={note.id}
            className="rounded-[var(--r-lg)] border border-[var(--warn-500)]/25 bg-[var(--warn-50)]/40 px-3 py-2.5"
          >
            <p className="t-xs flex items-center gap-1.5 font-semibold text-[var(--warn-700)]">
              <History aria-hidden size={12} strokeWidth={2} />
              Remembered from a web search ·{" "}
              {found.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
              {days > 90 && <span className="font-normal"> · over three months old, search again</span>}
            </p>

            {forgotten.has(note.id) ? (
              <p className="t-xs mt-1 text-[var(--n-600)]">Forgotten. The advisor will not use it again.</p>
            ) : (
              <>
                {note.structured?.table && (
                  <div className="mt-2">
                    <WebTable table={note.structured.table} />
                  </div>
                )}

                <details className="group mt-1.5">
                  <summary className="t-xs inline-flex cursor-pointer list-none items-center gap-1 text-[var(--n-600)] hover:text-[var(--n-900)] [&::-webkit-details-marker]:hidden">
                    <ChevronRight aria-hidden size={12} strokeWidth={2} className="transition-transform group-open:rotate-90" />
                    What was found, and {note.sources.length} {note.sources.length === 1 ? "source" : "sources"}
                  </summary>
                  <div className="mt-2 flex flex-col gap-2">
                    <p className="t-xs text-[var(--n-500)]">Asked: &ldquo;{note.question}&rdquo;</p>
                    {note.structured ? (
                      <>
                        <p className="t-sm text-[var(--n-800)]">{note.structured.summary}</p>
                        {note.structured.points.length > 0 && (
                          <ul className="t-xs ml-4 list-disc text-[var(--n-700)]">
                            {note.structured.points.map((point) => (
                              <li key={point}>{point}</li>
                            ))}
                          </ul>
                        )}
                        {note.structured.caveat && <p className="t-xs text-[var(--warn-700)]">{note.structured.caveat}</p>}
                      </>
                    ) : null}
                    <WebSources sources={note.sources} />
                    <button
                      type="button"
                      data-action="forget-note"
                      onClick={() => void forget(note.id)}
                      className="t-xs inline-flex w-fit items-center gap-1 rounded-[var(--r-md)] px-1.5 py-1 text-[var(--n-600)] hover:bg-[var(--n-100)] hover:text-[var(--err-700)]"
                    >
                      <Trash2 aria-hidden size={12} strokeWidth={2} />
                      Forget this – it is wrong or out of date
                    </button>
                  </div>
                </details>
              </>
            )}
          </section>
        );
      })}
      {failed && (
        <p role="alert" className="t-xs text-[var(--err-700)]">
          {failed}
        </p>
      )}
    </div>
  );
}

// ── The web, and an outage ──────────────────────────────────────────────────────────────────

/**
 * What the web said – the one channel the practice cannot stand behind. Every source is a link.
 *
 * Laid out like the advisor's other answers: the answer first, the points as a list, a table where
 * the results are comparable figures, the caveat set apart, and the pages numbered beneath. A model
 * that replied in prose is shown as prose – the structure is never invented from it.
 */
function FromTheWeb({ found }: { found: WebAnswer & { cost: number | null } }) {
  const shaped = found.structured;
  const heading = "t-xs font-semibold tracking-[0.02em] text-[var(--n-500)] uppercase";

  return (
    <section data-region="advisor-web" className="flex flex-col gap-3">
      <p className="t-xs flex items-center gap-1.5 font-semibold text-[var(--warn-700)]">
        <Globe aria-hidden size={12} strokeWidth={2} />
        From the web, not the practice
      </p>

      {shaped ? (
        <>
          <p className="t-base leading-snug font-medium text-[var(--n-900)]">{shaped.summary}</p>

          {shaped.points.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {shaped.points.map((point) => (
                <li key={point} className="t-sm flex items-start gap-2 text-[var(--n-800)]">
                  <Check aria-hidden size={14} strokeWidth={2.5} className="mt-[3px] shrink-0 text-[var(--ok-700)]" />
                  <span className="min-w-0">{point}</span>
                </li>
              ))}
            </ul>
          )}

          {shaped.table && <WebTable table={shaped.table} />}

          {shaped.caveat && (
            <p className="t-xs flex items-start gap-1.5 rounded-[var(--r-md)] bg-[var(--warn-50)] px-2.5 py-2 text-[var(--warn-700)]">
              <AlertTriangle aria-hidden size={12} strokeWidth={2} className="mt-0.5 shrink-0" />
              {shaped.caveat}
            </p>
          )}
        </>
      ) : (
        found.text && <p className="t-sm leading-relaxed text-[var(--n-800)]">{found.text}</p>
      )}

      <div>
        <h4 className={heading}>Sources</h4>
        <WebSources sources={found.sources.slice(0, SOURCES_SHOWN)} />
        {/* The rest behind one click – a search can return a dozen pages, and the first few carry it. */}
        {found.sources.length > SOURCES_SHOWN && (
          <details className="group mt-1">
            <summary className="t-xs inline-flex cursor-pointer list-none items-center gap-1 text-[var(--n-500)] hover:text-[var(--n-800)] [&::-webkit-details-marker]:hidden">
              <ChevronRight aria-hidden size={12} strokeWidth={2} className="transition-transform group-open:rotate-90" />
              {found.sources.length - SOURCES_SHOWN} more {found.sources.length - SOURCES_SHOWN === 1 ? "source" : "sources"}
            </summary>
            <WebSources sources={found.sources.slice(SOURCES_SHOWN)} from={SOURCES_SHOWN} />
          </details>
        )}
      </div>

      {found.sources[0] && (
        <p className="t-xs text-[var(--n-400)]">
          Read {new Date(found.sources[0].retrievedAt).toLocaleString("en-ZA")}. Not signed off – check it before relying on it.
        </p>
      )}
    </section>
  );
}

const SOURCES_SHOWN = 4;

/** Numbered links to the pages, each with its site. `from` continues the numbering. */
function WebSources({ sources, from = 0 }: { sources: WebAnswer["sources"]; from?: number }) {
  return (
    <ol className="mt-1.5 flex flex-col gap-1">
      {sources.map((source, index) => (
        <li key={source.url} className="t-xs flex items-baseline gap-2">
          <span className="num shrink-0 text-[var(--n-400)]">{from + index + 1}</span>
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer noopener"
            title={source.title}
            className="min-w-0 truncate text-[var(--a-700)] hover:underline"
          >
            {source.title}
          </a>
          <span className="ml-auto shrink-0 text-[var(--n-400)]">{hostOf(source.url)}</span>
        </li>
      ))}
    </ol>
  );
}

/** The site a source is on, without the `www.` – enough to judge it at a glance. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function Unavailable({ reason }: { reason?: string }) {
  return (
    <div data-region="advisor-unavailable">
      <p className="t-sm font-semibold text-[var(--err-700)]">The advisor couldn&rsquo;t answer</p>
      {/* The provider's own words. §1.3 — an outage is surfaced, never dressed as an empty answer. */}
      <p className="t-xs mt-1 text-[var(--n-700)]">{reason}</p>
      <p className="t-xs mt-1.5 text-[var(--n-500)]">Try again in a moment.</p>
    </div>
  );
}
