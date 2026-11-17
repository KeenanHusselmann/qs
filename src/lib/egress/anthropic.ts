/**
 * Claude, for the work with legal or cost consequences — the "consequential" tier.
 *
 * The practice agreed (meeting of 2026-11) that generic reading goes to DeepSeek and anything that
 * carries legal or cost implications – evaluating a tender or quotation, measuring a take-off,
 * building up a rate, benchmarking – goes to a stronger model. This is that model's adapter.
 *
 * It lives inside `src/lib/egress` because only the gateway may hold a vendor SDK
 * (`scripts/check-egress.mjs`), and its HTTP goes through `outbound`, so the host check applies to
 * the SDK's own requests too. It is handed text the gateway has already guarded; it does not decide
 * what may be sent.
 *
 * ── Choices, and why ───────────────────────────────────────────────────────────────────────
 *
 *  - `claude-opus-5-5`, at effort "high": these are the calls whose mistakes cost money, and effort
 *    defaults to "medium" on this model, so it is set rather than left to the default.
 *  - Streaming with `finalMessage()`: a take-off reply can be long, and streaming keeps a long reply
 *    clear of HTTP timeouts. Nothing is shown token by token, so the events are not handled.
 *  - Server-side refusal fallbacks ("default"): if a safety classifier declines, the API re-runs the
 *    request on its default fallback model inside the same call, rather than the reader losing the
 *    task. A refusal that survives the fallback is reported as one.
 *  - No `temperature`: current Claude models reject sampling parameters. Determinism here comes
 *    from the grounding check, which every caller still runs on what comes back.
 *  - SDK retries left at 2: the SDK retries 429, 5xx and dropped connections itself.
 */

import Anthropic from "@anthropic-ai/sdk";

import { outbound } from "@/lib/egress/transport";

export const CLAUDE_MODEL = "claude-opus-5-5";

/** Claude Opus 5.5 list price, USD per million tokens – for the run's cost line. */
const USD_PER_MTOK = { input: 4, output: 20 } as const;

export function claudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let client: Anthropic | null = null;
function claude(): Anthropic {
  client ??= new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    // Every request the SDK makes leaves through the egress transport's host check.
    fetch: (input, init) => outbound("anthropic", input as string | URL | Request, init),
  });
  return client;
}

export type ClaudeReply =
  | { ok: true; text: string; usage: { input: number; output: number; usd: number } }
  | { ok: false; reason: "refusal" | "max_tokens" | "empty"; detail: string; usage: { input: number; output: number; usd: number } };

/**
 * One request, one reply as text. Throws the SDK's typed errors (`Anthropic.APIError` and its
 * subclasses, `Anthropic.APIUserAbortError`) for the caller to turn into words a reader can act on.
 */
export async function askClaude({
  system,
  user,
  maxTokens,
  signal,
  timeoutMs,
  effort = "high",
}: {
  system: string;
  user: string;
  maxTokens: number;
  signal?: AbortSignal;
  timeoutMs: number;
  /** From the purpose's policy – lower where the call shares a 60-second route (`policy.ts`). */
  effort?: "low" | "medium" | "high";
}): Promise<ClaudeReply> {
  const message = await claude()
    .beta.messages.stream(
      {
        model: CLAUDE_MODEL,
        // Room for adaptive thinking as well as the answer: the caller's budget is for the answer.
        max_tokens: Math.max(maxTokens * 4, 16_000),
        system,
        messages: [{ role: "user", content: user }],
        output_config: { effort },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      },
      { signal, timeout: timeoutMs },
    )
    .finalMessage();

  const usage = {
    input: message.usage.input_tokens,
    output: message.usage.output_tokens,
    usd: (message.usage.input_tokens * USD_PER_MTOK.input + message.usage.output_tokens * USD_PER_MTOK.output) / 1_000_000,
  };

  if (message.stop_reason === "refusal") {
    return { ok: false, reason: "refusal", detail: `refusal: ${message.stop_details?.category ?? "uncategorised"}`, usage };
  }

  const text = message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("")
    .trim();

  if (message.stop_reason === "max_tokens") {
    return { ok: false, reason: "max_tokens", detail: `stop_reason=max_tokens at ${maxTokens * 4}; ${text.length} characters returned`, usage };
  }
  if (!text) return { ok: false, reason: "empty", detail: `no text block; stop_reason=${message.stop_reason}`, usage };

  return { ok: true, text, usage };
}

/**
 * The JSON object in a reply. Claude has no JSON-object mode for free-form shapes, so the prompt
 * asks for JSON and the object is taken from the first "{" to the last "}" – which also survives a
 * reply wrapped in a code fence. Null when there is no parseable object.
 */
export function jsonIn(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export { Anthropic };
