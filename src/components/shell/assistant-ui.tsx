"use client";

/**
 * The pieces both assistants are built from — the project advisor and the overview assistant.
 *
 * ── Why one kit ────────────────────────────────────────────────────────────────────────────
 *
 * They answer from different sources, but a reader should meet one assistant: the same welcome, the
 * same bubbles, the same answer card and the same box to type in. They were two hand-built panels,
 * and each fix landed in one and not the other — the box grew on the advisor and stayed a single line
 * on the overview, and the pair was reported as neither looking good nor being easy to use.
 *
 * ── The look, and the reasons ──────────────────────────────────────────────────────────────
 *
 *  - The reader's message is a filled bubble on the right, the assistant's a white card on the left
 *    with its avatar. Who said what is legible at a glance, the way every chat tool has taught.
 *  - General knowledge is labelled on every answer, but as a quiet footnote. It was an all-caps
 *    heading above the answer, which made the label louder than the explanation it labelled.
 *  - The welcome offers questions as cards with an icon for the kind of question, because a blank
 *    box is not an invitation and a list of grey bars did not read as clickable.
 *  - The box is one rounded card: text, attach, send. One focus ring, on the card.
 */

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";

import { AdvisorMark } from "@/components/shell/advisor-mark";
import {
  ArrowRight,
  ArrowUp,
  Calculator,
  Check,
  Copy,
  Globe,
  Info,
  MapPin,
  Paperclip,
  CornerDownRight,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";

import type { General } from "@/lib/agent/ask";
import { processHrefOf } from "@/lib/navigation";
import type { ToolResult } from "@/lib/agent/tools";

/** What the server reads. Mirrors `READABLE_EXTENSIONS` in `ingest/parse.ts`. */
export const READABLE = ".pdf,.docx,.xlsx,.xlsm,.txt,.md,.csv";
export const MAX_FILES = 3;

// ── Avatar ──────────────────────────────────────────────────────────────────────────────────

export function AssistantAvatar({ size = 28 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full bg-[var(--ai-50)] text-[var(--ai-600)] ring-1 ring-[var(--ai-500)]/15"
      style={{ width: size, height: size }}
    >
      <AdvisorMark size={Math.round(size * 0.62)} strokeWidth={1.9} />
    </span>
  );
}

// ── Welcome ─────────────────────────────────────────────────────────────────────────────────

export interface Suggestion {
  icon: LucideIcon;
  /** What the card says. */
  label: string;
  /** What is asked. Usually the label. */
  question: string;
}

export function Welcome({
  title,
  intro,
  suggestions,
  onPick,
  disabled,
  region,
}: {
  title: string;
  intro: string;
  suggestions: readonly Suggestion[];
  onPick: (question: string) => void;
  disabled?: boolean;
  region: string;
}) {
  return (
    <div className="flex flex-col items-center px-1 pt-2 pb-2 text-center">
      <AssistantAvatar size={44} />
      <h3 className="t-lg mt-3 font-semibold text-[var(--n-800)]">{title}</h3>
      <p className="t-sm mt-1 max-w-[34ch] text-[var(--n-500)]">{intro}</p>

      <ul data-region={region} className="mt-5 flex w-full flex-col gap-2 text-left">
        {suggestions.map(({ icon: Icon, label, question }) => (
          <li key={label}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(question)}
              className="group flex w-full items-center gap-3 rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-0)] px-3 py-2.5 shadow-[var(--e-1)] transition-colors hover:border-[var(--ai-500)] hover:bg-[var(--ai-50)] disabled:opacity-50"
              style={{ transitionDuration: "var(--m-fast)" }}
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-[var(--r-md)] bg-[var(--n-50)] text-[var(--ai-600)] group-hover:bg-[var(--n-0)]">
                <Icon aria-hidden size={15} strokeWidth={2} />
              </span>
              <span className="t-sm min-w-0 flex-1 text-left text-[var(--n-800)]">{label}</span>
              <ArrowRight
                aria-hidden
                size={14}
                strokeWidth={2}
                className="shrink-0 text-[var(--n-400)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--ai-600)]"
              />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Messages ────────────────────────────────────────────────────────────────────────────────

export function UserBubble({ text, files = [], note }: { text: string; files?: readonly File[]; note?: string }) {
  return (
    <div className="flex flex-col items-end gap-1 pl-8">
      <p className="t-sm rounded-2xl rounded-br-md bg-[var(--ai-500)] px-3.5 py-2 whitespace-pre-wrap text-white shadow-[var(--e-1)]">
        {text}
      </p>
      {files.map((file) => (
        <span
          key={file.name}
          className="t-xs flex max-w-full items-center gap-1 rounded-[var(--r-full)] border border-[var(--n-200)] bg-[var(--n-0)] px-2 py-0.5 text-[var(--n-600)]"
        >
          <Paperclip aria-hidden size={11} strokeWidth={2} className="shrink-0" />
          <span className="truncate">{file.name}</span>
        </span>
      ))}
      {note && <span className="t-xs text-[var(--n-500)]">{note}</span>}
    </div>
  );
}

/**
 * The assistant's turn: its avatar, and a card holding whatever it said.
 *
 * `copyText` is what the copy button puts on the clipboard — the words, without the chrome.
 */
export function AssistantMessage({
  children,
  footer,
  copyText,
  tone = "normal",
}: {
  children: ReactNode;
  footer?: ReactNode;
  copyText?: string;
  tone?: "normal" | "error";
}) {
  return (
    <div className="flex items-start gap-2">
      <AssistantAvatar size={24} />
      <div
        className={`min-w-0 flex-1 rounded-2xl rounded-tl-md border px-3.5 py-3 shadow-[var(--e-1)] ${
          tone === "error"
            ? "border-[var(--err-700)]/20 bg-[var(--err-50)]"
            : "border-[var(--n-200)] bg-[var(--n-0)]"
        }`}
      >
        {children}
        {(footer || copyText) && (
          <div className="mt-3 flex items-center gap-2 border-t border-[var(--n-100)] pt-2">
            <span className="t-xs min-w-0 flex-1 text-[var(--n-400)]">{footer}</span>
            {copyText && <CopyButton text={copyText} />}
          </div>
        )}
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : "Copy the answer"}
      title={copied ? "Copied" : "Copy the answer"}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="grid size-6 shrink-0 place-items-center rounded-[var(--r-sm)] text-[var(--n-400)] transition-colors hover:bg-[var(--n-100)] hover:text-[var(--n-700)]"
    >
      {copied ? <Check aria-hidden size={13} strokeWidth={2.5} /> : <Copy aria-hidden size={13} strokeWidth={2} />}
    </button>
  );
}

/** The assistant is working. Three dots and what it is doing, so a long wait reads as progress. */
export function Thinking({ label }: { label: string }) {
  return (
    <div className="flex items-start gap-2" role="status">
      <AssistantAvatar size={24} />
      <div className="flex items-center gap-2.5 rounded-2xl rounded-tl-md border border-[var(--n-200)] bg-[var(--n-0)] px-3.5 py-2.5 shadow-[var(--e-1)]">
        {/* `thinking-dot` is defined in globals.css, with its reduced-motion form beside the spinner's. */}
        <span aria-hidden className="flex h-2 items-center gap-1">
          {[0, 180, 360].map((delay) => (
            <span
              key={delay}
              className="thinking-dot size-2 rounded-full bg-[var(--ai-500)]"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </span>
        <span className="t-sm text-[var(--n-600)]">{label}</span>
      </div>
    </div>
  );
}

/** A turn that failed, in the provider's or the server's own words. */
export function FailedMessage({ reason }: { reason: string }) {
  return (
    <AssistantMessage tone="error">
      <p role="alert" className="t-sm text-[var(--err-700)]">
        {reason}
      </p>
    </AssistantMessage>
  );
}

// ── What the platform computed ──────────────────────────────────────────────────────────────

/**
 * A result from one of the platform's engines — a take-off, the gates, the cash flow. Exact and
 * deterministic, and every line carries its method, which is what earns it the right to show figures.
 */
export function ToolResultCard({ tool }: { tool: ToolResult }) {
  return (
    <div data-region="advisor-tool" className="mt-3 rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-50)] p-3 first:mt-0">
      <p className="t-xs flex items-center gap-1.5 font-semibold text-[var(--n-700)]">
        <Calculator aria-hidden size={12} strokeWidth={2} />
        {tool.title}
      </p>
      {tool.unavailable ? (
        <p className="t-sm mt-2 text-[var(--warn-700)]">{tool.unavailable}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {tool.findings.map((finding) => (
            <li key={finding.label}>
              <span className="flex items-baseline justify-between gap-3">
                <span className="t-sm min-w-0 text-[var(--n-700)]">{finding.label}</span>
                <span className="t-sm num shrink-0 text-right font-semibold text-[var(--n-800)]">{finding.value}</span>
              </span>
              <span className="t-xs block text-[var(--n-500)]">{finding.from}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="t-xs mt-2 text-[var(--n-400)]">Computed by the platform, not written by the assistant.</p>
    </div>
  );
}

/** The words of a tool result, for the copy button. */
export function toolTextForCopy(tool: ToolResult | null | undefined): string {
  if (!tool) return "";
  return [tool.title, ...(tool.unavailable ? [tool.unavailable] : tool.findings.map((f) => `${f.label}: ${f.value}`))].join("\n");
}

/**
 * Bring the newest exchange into view from its start — the reader's question at the top of the
 * panel and the answer under it. Scrolling to the very bottom landed on the end of a long answer.
 */
export function revealLatest(scroller: HTMLElement | null) {
  /*
    The last exchange, by its own marker. It was `ol > li:last-child`, and the thread's last item is
    the "Ask next" follow-ups under the answer – so the scroll aimed at the follow-ups, below the
    answer, and every answer opened on its last lines.
  */
  const exchanges = scroller?.querySelectorAll("li[data-exchange]");
  const last = exchanges?.[exchanges.length - 1];
  if (!scroller || !last) return;
  const top = last.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 12;
  scroller.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
}

// ── General guidance ────────────────────────────────────────────────────────────────────────

/**
 * General guidance — the model's own professional knowledge, laid out to be scanned.
 *
 * ── The shape of a good summary ────────────────────────────────────────────────────────────
 *
 * It was one paragraph and a list, and a reader had to read the whole paragraph to find the
 * sentence they came for. Now: the direct answer first, in bold-weight type; the key points as
 * short lines; how it is worked out under its own heading; where to get the data; and where it goes
 * in this platform, with the steps as real links. The label that this is general knowledge, not the
 * reader's documents, stays on every answer as a footnote.
 *
 * The step chips open the step's explanation in the process model (`processHrefOf`), not the
 * project's page for it. They used to open the project page, which put the reader in the middle of
 * the work when they had asked how it is done. The explanation needs no project, so the chips now
 * show on the overview as well.
 */
export function GeneralGuidance({ general }: { general: General }) {
  const links = general.steps
    .map((step) => ({ ...step, href: processHrefOf(step.module) }))
    .filter((step) => step.href);

  return (
    <section data-region="advisor-general" className="flex flex-col gap-3">
      {general.summary && (
        <p className="t-base leading-snug font-medium text-[var(--n-900)]">{general.summary}</p>
      )}

      {general.keyPoints.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {general.keyPoints.map((point) => (
            <li key={point} className="t-sm flex items-start gap-2 text-[var(--n-800)]">
              <Check aria-hidden size={14} strokeWidth={2.5} className="mt-[3px] shrink-0 text-[var(--ok-700)]" />
              <span className="min-w-0">{point}</span>
            </li>
          ))}
        </ul>
      )}

      {general.explanation && (
        <div>
          <h4 className="t-xs font-semibold tracking-[0.02em] text-[var(--n-500)] uppercase">How it works</h4>
          <p className="t-sm mt-1 leading-relaxed text-[var(--n-700)]">{general.explanation}</p>
        </div>
      )}

      {general.whereToGet.length > 0 && (
        <div>
          <h4 className="t-xs font-semibold tracking-[0.02em] text-[var(--n-500)] uppercase">Where to get the data</h4>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {general.whereToGet.map((source) => (
              <li key={source} className="t-sm flex items-start gap-2 text-[var(--n-700)]">
                <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[var(--ai-500)]" />
                <span className="min-w-0">{source}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(general.inPlatform || links.length > 0) && (
        <div className="rounded-[var(--r-lg)] bg-[var(--a-50)] px-3 py-2.5">
          <p className="t-sm flex items-start gap-2 text-[var(--a-700)]">
            <MapPin aria-hidden size={14} strokeWidth={2} className="mt-0.5 shrink-0" />
            <span className="min-w-0">
              <span className="font-semibold">In this platform{general.inPlatform ? ": " : ""}</span>
              {general.inPlatform}
            </span>
          </p>
          {links.length > 0 && (
            <span className="mt-2 flex flex-wrap gap-1.5 pl-6">
              {links.map((step) => (
                <Link
                  key={step.module}
                  href={step.href!}
                  data-action="open-step"
                  title={`How ${step.label} is done, in the process model`}
                  className="t-xs flex items-center gap-1 rounded-[var(--r-full)] border border-[var(--a-100)] bg-[var(--n-0)] px-2.5 py-1 font-medium text-[var(--a-700)] transition-colors hover:border-[var(--a-500)]"
                >
                  {step.label}
                  <ArrowRight aria-hidden size={11} strokeWidth={2} />
                </Link>
              ))}
            </span>
          )}
        </div>
      )}

      {/*
        Where this sits in the process model — the whole process around the thing asked about, one
        click away. The model picks the node from the library's real codes; with none, the term is
        searched instead, so a process question always has somewhere to go.
      */}
      {(general.process.length > 0 || general.term) && (
        <div data-region="process-links" className="rounded-[var(--r-lg)] border border-[var(--ai-500)]/20 bg-[var(--ai-50)] px-3 py-2.5">
          <p className="t-xs flex items-center gap-1.5 font-semibold text-[var(--ai-700)]">
            <Workflow aria-hidden size={13} strokeWidth={2} />
            See the full process
          </p>
          <span className="mt-1.5 flex flex-col gap-1">
            {general.process.length > 0
              ? general.process.map((node) => (
                  <Link
                    key={node.code}
                    href={node.href}
                    data-action="open-process"
                    className="t-sm group flex items-center gap-2 text-[var(--ai-700)] hover:underline"
                  >
                    <span className="num t-xs shrink-0 rounded-[var(--r-sm)] bg-[var(--n-0)] px-1.5 py-0.5 font-semibold text-[var(--ai-600)]">
                      {node.code}
                    </span>
                    <span className="min-w-0 flex-1">{node.name}</span>
                    <ArrowRight aria-hidden size={12} strokeWidth={2} className="shrink-0 transition-transform group-hover:translate-x-0.5" />
                  </Link>
                ))
              : general.term && (
                  <Link
                    href={`/process?q=${encodeURIComponent(general.term)}`}
                    data-action="open-process"
                    className="t-sm flex items-center gap-2 text-[var(--ai-700)] hover:underline"
                  >
                    Search the process model for &ldquo;{general.term}&rdquo;
                    <ArrowRight aria-hidden size={12} strokeWidth={2} />
                  </Link>
                )}
          </span>
        </div>
      )}

      <p className="t-xs flex items-center gap-1 text-[var(--n-400)]">
        <Info aria-hidden size={11} strokeWidth={2} />
        General guidance, not from your documents
      </p>
    </section>
  );
}

/** The words of a general answer, for the copy button. */
export function generalText(general: General | null | undefined): string {
  if (!general) return "";
  return [
    general.summary,
    general.keyPoints.map((p) => `- ${p}`).join("\n"),
    general.explanation ? `How it works: ${general.explanation}` : "",
    general.whereToGet.length > 0 ? `Where to get the data:\n${general.whereToGet.map((s) => `- ${s}`).join("\n")}` : "",
    general.inPlatform ? `In this platform: ${general.inPlatform}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

// ── Follow-ups and sources ──────────────────────────────────────────────────────────────────

/** What the reader might ask next, one click each. Shown under the latest answer only. */
export function FollowUps({
  questions,
  onPick,
  disabled,
}: {
  questions: readonly string[];
  onPick: (question: string) => void;
  disabled?: boolean;
}) {
  if (questions.length === 0) return null;
  return (
    <div data-region="follow-ups" className="flex flex-col gap-1.5 pl-8">
      <p className="t-xs font-medium text-[var(--n-500)]">Ask next</p>
      {questions.map((question) => (
        <button
          key={question}
          type="button"
          disabled={disabled}
          onClick={() => onPick(question)}
          className="t-sm group flex items-center gap-2 rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-0)] px-3 py-1.5 text-left text-[var(--n-700)] transition-colors hover:border-[var(--ai-500)] hover:bg-[var(--ai-50)] hover:text-[var(--ai-700)] disabled:opacity-50"
          style={{ transitionDuration: "var(--m-fast)" }}
        >
          <CornerDownRight aria-hidden size={13} strokeWidth={2} className="shrink-0 text-[var(--n-400)] group-hover:text-[var(--ai-600)]" />
          <span className="min-w-0 flex-1">{question}</span>
        </button>
      ))}
    </div>
  );
}

export interface DocumentSource {
  document: string;
  page: number | null;
  quote: string;
  href: string | null;
  attached?: boolean;
}

/**
 * Where a documents answer came from: each document named, openable, with the passage that answered.
 * Only on a "Project documents" question — the reader asked what their documents say, so the
 * documents are the answer's evidence and belong under it.
 */
export function SourceList({ sources }: { sources: readonly DocumentSource[] }) {
  if (sources.length === 0) return null;
  return (
    <div data-region="advisor-sources" className="mt-3">
      <h4 className="t-xs font-semibold tracking-[0.02em] text-[var(--n-500)] uppercase">
        Sources · {sources.length}
      </h4>
      <ol className="mt-1.5 flex flex-col gap-2">
        {sources.map((source, index) => (
          <li key={`${source.document}-${index}`} className="rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-50)] px-2.5 py-2">
            <p className="t-xs flex items-center gap-1.5 font-medium text-[var(--n-800)]">
              <span className="num grid size-4 shrink-0 place-items-center rounded-full bg-[var(--ai-500)] text-[10px] text-white">
                {index + 1}
              </span>
              {source.href ? (
                <a href={source.href} target="_blank" rel="noreferrer" className="min-w-0 truncate text-[var(--ai-700)] hover:underline">
                  {source.document}
                </a>
              ) : (
                <span className="min-w-0 truncate">{source.document}</span>
              )}
              {source.page !== null && <span className="num shrink-0 text-[var(--n-500)]">p.{source.page}</span>}
              {source.attached && <span className="shrink-0 text-[var(--warn-700)]">attached</span>}
            </p>
            <p className="t-xs mt-1 line-clamp-3 whitespace-pre-line text-[var(--n-600)]">{source.quote}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ── The composer ────────────────────────────────────────────────────────────────────────────

/**
 * Where the reader writes.
 *
 * One rounded card: the text, and a toolbar of attach, web (where the route can search it) and a
 * round send button. Enter sends and Shift+Enter starts a new line. Files come in three ways — the
 * paperclip, dropped on the box, or pasted. The box grows with what is typed and shrinks after
 * sending; it has no drag handle.
 */
export function Composer({
  asking,
  onSend,
  region,
  who,
  placeholder,
  ariaLabel,
  fileOnlyQuestion,
  submitAction = "ask-question",
  allowWeb = false,
  chips,
  modes,
}: {
  asking: boolean;
  onSend: (input: { question: string | null; files: File[]; web: boolean; mode: string }) => void | Promise<void>;
  /** `data-region` of the form, for the suites. */
  region: string;
  /** "advisor", "assistant" — in the refusal for an unreadable file. */
  who: string;
  placeholder: string;
  ariaLabel: string;
  /** What a file sent with no words asks. */
  fileOnlyQuestion: string;
  submitAction?: string;
  /** The web button. Only where the route can search the web. */
  allowWeb?: boolean;
  /** Quick actions above the box, e.g. "What should I do next?". */
  chips?: ReactNode;
  /**
   * What the question is asked of, as an explicit switch — "Ask anything" or "Project documents".
   * The first is the default. Each carries its own placeholder so the box says what it will do.
   */
  modes?: readonly ComposerMode[];
}) {
  const [mode, setMode] = useState(modes?.[0]?.value ?? "general");
  const current = modes?.find((m) => m.value === mode);
  const [question, setQuestion] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [refused, setRefused] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, Math.round(window.innerHeight * 0.35))}px`;
  }, [question]);

  const add = (incoming: Iterable<File>) => {
    const accepted: File[] = [];
    const rejected: string[] = [];
    for (const file of incoming) {
      const extension = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
      if (READABLE.split(",").includes(extension)) accepted.push(file);
      else rejected.push(file.name);
    }
    setFiles((previous) => [...previous, ...accepted].slice(0, MAX_FILES));
    setRefused(
      rejected.length > 0
        ? `${rejected.join(", ")} cannot be read. The ${who} reads PDF, Word, Excel, text and CSV files.`
        : null,
    );
  };

  /*
    Web search is a switch, not a second send button. It was a button that sent the question to the
    web, greyed out until something was typed, and read as a toggle that never turned on. Now it is
    on or off, looks it, and Enter sends the question wherever it points. Never with an attachment:
    a file is the practice's and does not leave with the question.
  */
  const [webOn, setWebOn] = useState(false);
  const web = allowWeb && webOn && files.length === 0;

  const canSend = !asking && (question.trim().length > 0 || files.length > 0);

  const submit = () => {
    if (!canSend) return;
    const asked = question.trim();
    void onSend({ question: asked || fileOnlyQuestion, files, web, mode });
    setQuestion("");
    setFiles([]);
    setRefused(null);
  };

  return (
    <footer className="shrink-0 border-t border-[var(--n-200)] bg-[var(--n-0)] px-3 pt-2.5 pb-3">
      {(chips || modes) && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {modes && (
            <div
              role="radiogroup"
              aria-label="What to ask"
              data-region={`${region}-mode`}
              className="flex rounded-[var(--r-full)] border border-[var(--n-200)] bg-[var(--n-50)] p-0.5"
            >
              {modes.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={mode === value}
                  data-mode={value}
                  onClick={() => setMode(value)}
                  className={`t-xs flex items-center gap-1 rounded-[var(--r-full)] px-2.5 py-1 font-medium transition-colors ${
                    mode === value
                      ? "bg-[var(--n-0)] text-[var(--ai-700)] shadow-[var(--e-1)]"
                      : "text-[var(--n-600)] hover:text-[var(--n-900)]"
                  }`}
                  style={{ transitionDuration: "var(--m-fast)" }}
                >
                  <Icon aria-hidden size={12} strokeWidth={2} />
                  {label}
                </button>
              ))}
            </div>
          )}
          {chips}
        </div>
      )}

      <form
        data-region={region}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (e.dataTransfer.files.length === 0) return;
          e.preventDefault();
          setDragging(false);
          add(e.dataTransfer.files);
        }}
        /*
          One focus ring, on the card. The global `:focus-visible` outline is unlayered CSS and beats
          a Tailwind utility on the textarea, so the textarea's outline is turned off inline and the
          card carries the visible focus instead.
        */
        className={`rounded-2xl border bg-[var(--n-0)] shadow-[var(--e-1)] transition-[border-color,box-shadow] focus-within:border-[var(--ai-500)] focus-within:shadow-[0_0_0_3px_var(--ai-50)] ${
          dragging ? "border-[var(--ai-500)] bg-[var(--ai-50)]" : "border-[var(--n-200)]"
        }`}
        style={{ transitionDuration: "var(--m-fast)" }}
      >
        {files.length > 0 && (
          <ul data-region={`${region}-attachments`} className="flex flex-wrap gap-1.5 px-3 pt-2.5">
            {files.map((file, index) => (
              <li
                key={`${file.name}-${index}`}
                className="t-xs flex max-w-full items-center gap-1 rounded-[var(--r-full)] bg-[var(--n-100)] py-0.5 pr-0.5 pl-2 text-[var(--n-700)]"
              >
                <Paperclip aria-hidden size={11} strokeWidth={2} className="shrink-0" />
                <span className="truncate">{file.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => setFiles((previous) => previous.filter((_, i) => i !== index))}
                  className="grid size-4 shrink-0 place-items-center rounded-full hover:bg-[var(--n-200)]"
                >
                  <X aria-hidden size={10} strokeWidth={2.5} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <textarea
          ref={box}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          onPaste={(e) => {
            if (e.clipboardData.files.length > 0) {
              e.preventDefault();
              add(e.clipboardData.files);
            }
          }}
          rows={2}
          placeholder={web ? "Search the web – the question leaves the platform…" : (current?.placeholder ?? placeholder)}
          aria-label={ariaLabel}
          style={{ outline: "none" }}
          className="t-sm block min-h-[3.25rem] w-full resize-none rounded-2xl bg-transparent px-3.5 pt-3 pb-1 text-[var(--n-800)] placeholder:text-[var(--n-400)]"
        />

        <div className="flex items-center gap-1 px-2 pb-2">
          <input
            ref={picker}
            type="file"
            multiple
            accept={READABLE}
            className="hidden"
            onChange={(e) => {
              if (e.target.files) add(e.target.files);
              // Cleared so choosing the same file again still fires a change.
              e.target.value = "";
            }}
          />
          <ToolButton
            action="attach"
            label={`Attach a file (up to ${MAX_FILES}: PDF, Word, Excel, text or CSV)`}
            onClick={() => picker.current?.click()}
            disabled={files.length >= MAX_FILES}
          >
            <Paperclip aria-hidden size={16} strokeWidth={1.75} />
          </ToolButton>

          {/* On, it is filled and says so; off, it is a plain outline. Enter follows it. */}
          {allowWeb && (
            <button
              type="button"
              data-action="ask-web"
              aria-pressed={web}
              title={
                files.length > 0
                  ? "Web search is off while a file is attached – the file stays in the platform"
                  : web
                    ? "Web search is on – questions leave the platform. Click to turn off"
                    : "Turn on web search"
              }
              onClick={() => setWebOn(!webOn)}
              disabled={files.length > 0}
              className={`t-xs flex h-7 items-center gap-1 rounded-full border px-2.5 font-medium transition-colors disabled:opacity-40 ${
                web
                  ? "border-[var(--ai-500)] bg-[var(--ai-500)] text-white hover:bg-[var(--ai-600)]"
                  : "border-[var(--n-200)] text-[var(--n-600)] hover:border-[var(--n-300)] hover:text-[var(--n-900)]"
              }`}
              style={{ transitionDuration: "var(--m-fast)" }}
            >
              <Globe aria-hidden size={13} strokeWidth={2} />
              {web ? "Web on" : "Web"}
            </button>
          )}

          <button
            type="submit"
            data-action={submitAction}
            disabled={!canSend}
            aria-label="Ask"
            title="Ask (Enter)"
            className="ml-auto grid size-8 place-items-center rounded-full bg-[var(--ai-500)] text-white shadow-[var(--e-1)] transition-colors hover:bg-[var(--ai-600)] disabled:bg-[var(--n-200)] disabled:text-[var(--n-500)] disabled:shadow-none"
            style={{ transitionDuration: "var(--m-fast)" }}
          >
            <ArrowUp aria-hidden size={16} strokeWidth={2.25} />
          </button>
        </div>
      </form>

      {refused ? (
        <p role="alert" className="t-xs mt-1.5 text-[var(--err-700)]">
          {refused}
        </p>
      ) : (
        <p className="t-xs mt-1.5 text-center text-[var(--n-400)]">
          Enter to send · Shift+Enter for a new line
        </p>
      )}
    </footer>
  );
}

function ToolButton({
  action,
  label,
  onClick,
  disabled,
  children,
}: {
  action: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-action={action}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flex size-8 items-center justify-center rounded-full text-[var(--n-600)] transition-colors hover:bg-[var(--n-100)] hover:text-[var(--n-900)] disabled:opacity-40"
      style={{ transitionDuration: "var(--m-fast)" }}
    >
      {children}
    </button>
  );
}

/** One setting of the composer's "what to ask" switch. */
export interface ComposerMode {
  value: string;
  label: string;
  icon: LucideIcon;
  placeholder: string;
}

/** A quick action above the box. */
export function Chip({
  icon: Icon,
  label,
  onClick,
  disabled,
  action,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  action?: string;
}) {
  return (
    <button
      type="button"
      data-action={action}
      onClick={onClick}
      disabled={disabled}
      className="t-xs flex items-center gap-1.5 rounded-[var(--r-full)] border border-[var(--n-200)] bg-[var(--n-0)] px-2.5 py-1 font-medium text-[var(--n-700)] transition-colors hover:border-[var(--a-500)] hover:bg-[var(--a-50)] hover:text-[var(--a-700)] disabled:opacity-50"
      style={{ transitionDuration: "var(--m-fast)" }}
    >
      <Icon aria-hidden size={12} strokeWidth={2} />
      {label}
    </button>
  );
}

// ── Documents kept in a conversation ────────────────────────────────────────────────────────

/**
 * The files a conversation keeps reading. A file attached to one question is read with every
 * question after it, until it is removed – "and what does clause 14 say?" is asked of the document
 * the reader attached two questions ago, not of nothing. The newest win where there are more than
 * the route reads.
 */
export function keepFiles(held: readonly File[], added: readonly File[]): File[] {
  const key = (f: File) => `${f.name}:${f.size}`;
  const fresh = added.filter((f) => !held.some((h) => key(h) === key(f)));
  return [...held, ...fresh].slice(-MAX_FILES);
}

export function HeldFiles({ files, onRemove, region }: { files: readonly File[]; onRemove: (file: File) => void; region: string }) {
  if (files.length === 0) return null;
  return (
    <div data-region={`${region}-held`} className="flex flex-wrap items-center gap-1.5 border-t border-[var(--n-100)] bg-[var(--n-25)] px-3 py-2">
      <span className="t-xs text-[var(--n-600)]">Read with every question:</span>
      {files.map((file) => (
        <span key={`${file.name}:${file.size}`} data-held={file.name} className="t-xs inline-flex max-w-[16rem] items-center gap-1 rounded-[var(--r-full)] border border-[var(--n-200)] bg-[var(--n-0)] py-0.5 pr-1 pl-2 text-[var(--n-700)]">
          <Paperclip aria-hidden size={10} strokeWidth={2} className="shrink-0" />
          <span className="truncate">{file.name}</span>
          <button type="button" aria-label={`Stop reading ${file.name}`} onClick={() => onRemove(file)} className="rounded-[var(--r-full)] px-1 text-[var(--n-400)] hover:text-[var(--err-700)]">
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

/** How much of each attached file an answer read – all of it, or the parts about the question. */
export function ReadCoverage({ attached }: { attached: readonly { name: string; read: number; total: number }[] | undefined }) {
  if (!attached || attached.length === 0) return null;
  return (
    <p data-region="read-coverage" className="t-xs mt-2 text-[var(--n-500)]">
      {attached
        .map((a) =>
          a.read >= a.total
            ? `Read all of ${a.name}.`
            : `Read ${a.read} of the ${a.total} parts of ${a.name} – its opening and the parts about your question. Ask about another part by name to read it.`,
        )
        .join(" ")}
    </p>
  );
}
