"use client";

/**
 * The assistant on the overview and the path page — for somebody who may have no project yet.
 *
 * It answers construction questions (a term copied off the screen, where to get the data, how a
 * figure is worked out) and questions about the platform, and where the answer is "here is what that
 * step needs" the list comes from the platform's own criteria, never from the model — an invented
 * requirement sends somebody looking for a document nobody needs.
 *
 * Built from `shell/assistant-ui.tsx`, the same kit as the project advisor, so the two look and
 * behave as one assistant. Attachments are read for the question and never stored: there may be no
 * project here to file them into.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, Calculator, GitBranch, ListChecks } from "lucide-react";

import type { OnboardingAnswer } from "@/lib/agent/onboarding";
import {
  AssistantMessage,
  Composer,
  FailedMessage,
  FollowUps,
  GeneralGuidance,
  Thinking,
  ToolResultCard,
  UserBubble,
  revealLatest,
  toolTextForCopy,
  Welcome,
  generalText,
  type Suggestion,
  HeldFiles,
  ReadCoverage,
  keepFiles,
} from "@/components/shell/assistant-ui";
import { whyUnreachable } from "@/lib/unreachable";

const SUGGESTIONS: readonly Suggestion[] = [
  {
    icon: ListChecks,
    label: "What documents do I need to start a feasibility?",
    question: "What documents do I need to start a feasibility?",
  },
  { icon: BookOpen, label: "What does absorption rate mean?", question: "What does absorption rate mean?" },
  {
    icon: Calculator,
    label: "How many bricks for 240 m² of one-brick wall?",
    question: "How many bricks do I need for 240 m² of one-brick wall in stock brick?",
  },
  {
    icon: GitBranch,
    label: "Do I have to sign a step before the next one runs?",
    question: "Do I have to sign a step before the next one can run?",
  },
];

type Reply = OnboardingAnswer & { cost: number | null };

interface Exchange {
  id: number;
  question: string;
  files: File[];
  /** How many files this question read – kept ones included. */
  reading?: number;
  reply: Reply | null;
  failed: string | null;
}

/** The conversation, its sender and its reset — shared by the panel and the inline card. */
function useGuideConversation() {
  const [thread, setThread] = useState<Exchange[]>([]);
  const [asking, setAsking] = useState(false);
  const inFlight = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  // The files this conversation keeps reading, until one is removed.
  const [held, setHeld] = useState<File[]>([]);

  useEffect(() => () => inFlight.current?.abort(), []);

  const send = useCallback(
    async ({ question, files }: { question: string | null; files: File[] }) => {
      const text = (question ?? "").trim();
      if (text.length === 0) return;

      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;

      const id = nextId.current++;
      const history = thread.flatMap((exchange) => [
        { role: "user" as const, text: exchange.question },
        ...(exchange.reply
          ? [
              {
                role: "assistant" as const,
                text: [exchange.reply.general?.summary, exchange.reply.answer, exchange.reply.general?.explanation]
                  .filter(Boolean)
                  .join(" "),
              },
            ]
          : []),
      ]);

      const reading = keepFiles(held, files);
      if (files.length > 0) setHeld(reading);
      setThread((previous) => [...previous, { id, question: text, files, reading: reading.length, reply: null, failed: null }]);
      setAsking(true);
      const settle = (patch: Partial<Exchange>) =>
        setThread((previous) => previous.map((e) => (e.id === id ? { ...e, ...patch } : e)));

      try {
        let body: BodyInit;
        const headers: Record<string, string> = {};
        if (reading.length > 0) {
          const form = new FormData();
          form.set("question", text);
          form.set("history", JSON.stringify(history));
          for (const file of reading) form.append("files", file, file.name);
          body = form;
        } else {
          headers["content-type"] = "application/json";
          body = JSON.stringify({ question: text, history });
        }

        const response = await fetch("/api/onboarding", { method: "POST", headers, body, signal: controller.signal });

        // Parsed defensively: a framework 500 has no JSON body, and `.json()` would throw on it.
        const reply = (await response.json().catch(() => null)) as {
          answer?: Reply | null;
          unavailable?: string;
          error?: string;
        } | null;

        if (!response.ok) {
          settle({ failed: reply?.error ?? whyUnreachable(response.status, "The assistant") });
          return;
        }
        if (!reply?.answer) {
          settle({ failed: reply?.unavailable ?? "The assistant could not answer." });
          return;
        }
        settle({ reply: reply.answer });
      } catch (error) {
        if (controller.signal.aborted) return;
        settle({
          failed: `The request did not reach the server: ${error instanceof Error ? error.message : "unknown error"}.`,
        });
      } finally {
        if (!controller.signal.aborted) setAsking(false);
      }
    },
    [thread, held],
  );

  const reset = useCallback(() => {
    inFlight.current?.abort();
    setAsking(false);
    setThread([]);
    setHeld([]);
  }, []);

  return { thread, asking, send, reset, held, setHeld };
}

export type GuideConversation = ReturnType<typeof useGuideConversation>;
export { useGuideConversation };

/**
 * Where it is standing.
 *
 * In the panel the chrome and the reset belong to `AssistantPanel`, so the conversation is created by
 * `GuidePanel` and passed in. On the path page the guide stands alone and owns its own.
 */
export function Guide({
  beside = "steps",
  conversation,
}: {
  beside?: "steps" | "overview" | "panel";
  conversation?: GuideConversation;
} = {}) {
  const own = useGuideConversation();
  const { thread, asking, send, held, setHeld } = conversation ?? own;
  const inPanel = beside === "panel";
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    revealLatest(scroller.current);
  }, [thread]);

  const body = (
    <>
      {thread.length === 0 ? (
        <Welcome
          region="guide-suggestions"
          title="How can I help?"
          intro={
            beside === "steps"
              ? "The steps above come from your projects. Ask me anything else — a construction term, where to get the data, or what a step needs."
              : "Ask about any construction term, where to get the data for it, or how to use this platform."
          }
          suggestions={SUGGESTIONS}
          disabled={asking}
          onPick={(question) => void send({ question, files: [] })}
        />
      ) : (
        <ol data-region="guide-thread" className="flex flex-col gap-4">
          {thread.map((exchange) => (
            <li key={exchange.id} data-exchange={exchange.id} className="flex flex-col gap-2.5">
              <UserBubble
                text={exchange.question}
                files={exchange.files}
                note={exchange.files.length > 0 ? "Kept for the rest of this conversation" : undefined}
              />
              {exchange.reply ? (
                <Answer reply={exchange.reply} />
              ) : exchange.failed ? (
                <FailedMessage reason={exchange.failed} />
              ) : (
                <Thinking label={(exchange.reading ?? exchange.files.length) > 0 ? "Reading the attached document…" : "Thinking…"} />
              )}
            </li>
          ))}
          {/* What the reader might ask next — under the latest answer only, once it has arrived. */}
          {!asking && (thread.at(-1)?.reply?.followUps.length ?? 0) > 0 && (
            <li>
              <FollowUps
                questions={thread.at(-1)!.reply!.followUps}
                onPick={(question) => void send({ question, files: [] })}
              />
            </li>
          )}
        </ol>
      )}
    </>
  );

  const composer = (
    <>
    <HeldFiles files={held} region="guide" onRemove={(file) => setHeld((h) => h.filter((f) => f !== file))} />
    <Composer
      asking={asking}
      onSend={send}
      region="guide-ask"
      who="assistant"
      submitAction="ask-guide"
      placeholder="Ask anything, or paste a term…"
      ariaLabel="Ask the assistant about construction or how to use this platform"
      fileOnlyQuestion="What is this document, and what does it mean for a project?"
    />
    </>
  );

  if (inPanel) {
    return (
      <section data-region="guide" className="flex min-h-0 flex-1 flex-col">
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-3.5 py-4">
          {body}
        </div>
        {composer}
      </section>
    );
  }

  return (
    <section
      data-region="guide"
      className="overflow-hidden rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-50)] shadow-[var(--e-1)]"
    >
      <div ref={scroller} className="max-h-[70vh] overflow-y-auto px-4 py-5">
        {body}
      </div>
      {composer}
    </section>
  );
}

function Answer({ reply }: { reply: Reply }) {
  const empty = !reply.general && !reply.answer && !reply.needs && !reply.tool;
  return (
    <div data-region="guide-answer">
      <AssistantMessage
        footer={
          reply.cost !== null ? `R ${reply.cost.toFixed(4)} · ${reply.usage.input} in, ${reply.usage.output} out` : undefined
        }
        copyText={[generalText(reply.general), reply.answer, toolTextForCopy(reply.tool)].filter(Boolean).join("\n\n") || undefined}
      >
        {reply.general && !reply.attached?.length && <GeneralGuidance general={reply.general} />}
        {reply.answer && (
          <p
            className={`t-sm leading-relaxed text-[var(--n-800)] ${
              reply.general ? "mt-3 border-t border-[var(--n-100)] pt-3" : ""
            }`}
          >
            {reply.answer}
          </p>
        )}
        <ReadCoverage attached={reply.attached} />
        {reply.general && (reply.attached?.length ?? 0) > 0 && (
          <div className="mt-3 border-t border-[var(--n-100)] pt-3">
            <GeneralGuidance general={reply.general} />
          </div>
        )}

        {reply.tool && <ToolResultCard tool={reply.tool} />}

        {/* What the platform requires — from the criteria, not from the model. */}
        {reply.needs && (
          <div className="mt-3 rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-50)] p-3">
            <p className="t-xs flex items-center gap-1.5 font-semibold text-[var(--n-700)]">
              <ListChecks aria-hidden size={12} strokeWidth={2} />
              {reply.needs.moduleLabel} needs
            </p>
            <ul className="mt-2 flex flex-col gap-2.5">
              {reply.needs.requirements.map((requirement) => (
                <li key={requirement.label}>
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="t-sm font-medium text-[var(--n-800)]">{requirement.label}</span>
                    {!requirement.mandatory && (
                      <span className="t-xs rounded-[var(--r-full)] bg-[var(--n-100)] px-1.5 py-0.5 text-[var(--n-600)]">
                        optional
                      </span>
                    )}
                  </span>
                  <span className="t-xs mt-0.5 block text-[var(--n-600)]">{requirement.detail}</span>
                  <span className="t-xs block text-[var(--n-500)]">Any one of: {requirement.accepts.join(" · ")}</span>
                </li>
              ))}
            </ul>
            <p className="t-xs mt-2 text-[var(--n-400)]">From the platform&rsquo;s own checklist for that step.</p>
          </div>
        )}

        {empty && (
          <p className="t-sm text-[var(--n-600)]">I couldn&rsquo;t find anything to say about that. Try asking another way.</p>
        )}
      </AssistantMessage>
    </div>
  );
}
