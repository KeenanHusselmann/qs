import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { askClaude, CLAUDE_MODEL, jsonIn } from "./anthropic";
import { modelVendorFor } from "./policy";
import { addUsage, costOf } from "@/lib/agent/deepseek";

/** A Messages API stream, as server-sent events, ending with the given stop reason. */
function sse(text: string, stopReason: string, extra: Record<string, unknown> = {}): Response {
  const events: [string, unknown][] = [
    ["message_start", { type: "message_start", message: { id: "msg_test", type: "message", role: "assistant", model: CLAUDE_MODEL, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 0 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null, ...extra }, usage: { output_tokens: 500 } }],
    ["message_stop", { type: "message_stop" }],
  ];
  const body = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

let sent: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];

beforeEach(() => {
  sent = [];
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function respondWith(response: () => Response) {
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    sent.push({ url: request.url, headers: request.headers, body: JSON.parse(await request.text()) });
    return response();
  });
}

describe("askClaude", () => {
  it("sends what the practice decided – Opus 5.5, high effort, refusal fallbacks, no sampling – to Anthropic only", async () => {
    respondWith(() => sse('{"total": "R 4 512 300.00"}', "end_turn"));
    const reply = await askClaude({ system: "Reply in json.", user: "the tender", maxTokens: 2000, timeoutMs: 30_000 });

    expect(reply).toMatchObject({ ok: true, text: '{"total": "R 4 512 300.00"}' });
    const [call] = sent;
    expect(new URL(call!.url).host).toBe("api.anthropic.com");
    expect(call!.body).toMatchObject({ model: "claude-opus-5-5", output_config: { effort: "high" }, fallbacks: "default", system: "Reply in json." });
    expect(call!.body).not.toHaveProperty("temperature");
    expect(call!.headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
  });

  it("sends the purpose's effort, lower where the call shares a 60-second route", async () => {
    respondWith(() => sse("{}", "end_turn"));
    await askClaude({ system: "json", user: "x", maxTokens: 100, timeoutMs: 30_000, effort: "medium" });
    expect(sent[0]!.body).toMatchObject({ output_config: { effort: "medium" } });
  });

  it("prices the call at Claude's own rates", async () => {
    respondWith(() => sse("{}", "end_turn"));
    const reply = await askClaude({ system: "json", user: "x", maxTokens: 100, timeoutMs: 30_000 });
    // 1 000 in at $4/M + 500 out at $20/M
    expect(reply.usage.usd).toBeCloseTo(0.014, 6);
  });

  it("reports a refusal that survived the fallback as a refusal, not as an empty answer", async () => {
    respondWith(() => sse("", "refusal"));
    const reply = await askClaude({ system: "json", user: "x", maxTokens: 100, timeoutMs: 30_000 });
    expect(reply).toMatchObject({ ok: false, reason: "refusal" });
  });

  it("reports a reply cut off at the token cap", async () => {
    respondWith(() => sse('{"items": [', "max_tokens"));
    const reply = await askClaude({ system: "json", user: "x", maxTokens: 100, timeoutMs: 30_000 });
    expect(reply).toMatchObject({ ok: false, reason: "max_tokens" });
  });
});

describe("jsonIn", () => {
  it("reads an object wrapped in a code fence or preamble", () => {
    expect(jsonIn('Here it is:\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });
  it("is null for no object, rather than a guess", () => {
    expect(jsonIn("I could not find a figure.")).toBeNull();
    expect(jsonIn('{"a": ')).toBeNull();
  });
});

describe("modelVendorFor", () => {
  it("sends generic work to DeepSeek", () => {
    expect(modelVendorFor("extract.field", true)).toBe("deepseek");
  });
  it("sends work with cost or legal consequences to Claude", () => {
    for (const p of ["quote.evaluate", "measure.drawings", "rate.buildup"] as const) expect(modelVendorFor(p, true)).toBe("anthropic");
  });
  it("falls back to DeepSeek in development when Claude is not configured", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(modelVendorFor("quote.evaluate", false)).toBe("deepseek");
  });
  it("never falls back in production – a missing key is a visible refusal", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(modelVendorFor("quote.evaluate", false)).toBe("anthropic");
  });
});

describe("cost across vendors", () => {
  it("keeps a Claude call's price when two calls are summed", () => {
    vi.stubEnv("LLM_USD_PER_MTOK_IN", "0.27");
    vi.stubEnv("LLM_USD_PER_MTOK_OUT", "1.10");
    const claude = { input: 1000, output: 500, usd: 0.014 };
    const deepseek = { input: 1_000_000, output: 0 };
    expect(costOf(addUsage(claude, deepseek))).toBeCloseTo(0.284, 6);
  });
  it("is unpriced, not zero, when one half has no rates", () => {
    expect(costOf(addUsage({ input: 1, output: 1, usd: 0.1 }, { input: 1, output: 1 }))).toBeNull();
  });
});
