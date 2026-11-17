/**
 * The model call — PLATFORM.md §1.3.
 *
 * ── Why there is no SDK here ───────────────────────────────────────────────────────────────
 *
 * DeepSeek speaks the OpenAI chat-completions shape, and what this platform asks of it is one
 * request with one JSON object back. A provider SDK would add a dependency, a client object and a
 * retry policy of its own in exchange for `fetch` with three headers.
 *
 * ── An outage is a result, not a gap ───────────────────────────────────────────────────────
 *
 * §1.3's rule: an LLM outage is surfaced, never hidden. Every failure here throws something the
 * caller has to handle, and the run turns it into a refusal the reader can see. What must never
 * happen is a failed call becoming an empty answer — "the corpus does not say" and "we could not
 * ask" are different facts, and a cost model built on the second while being told the first is
 * exactly the confident wrong number this platform exists to prevent.
 */

import { Anthropic, askClaude, claudeConfigured, jsonIn } from "@/lib/egress/anthropic";
import { EgressRefused, guard, type Prepared } from "@/lib/egress/gateway";
import { modelVendorFor, PURPOSES, type Purpose, type PurposeId } from "@/lib/egress/policy";
import { restoreDeep } from "@/lib/egress/transform";
import { outbound } from "@/lib/egress/transport";

const ENDPOINT = "https://api.deepseek.com/chat/completions";

/** Nothing here is worth waiting on for longer than this. Ten fields, one call each. */
const TIMEOUT_MS = 45_000;

/**
 * A failed call, in words the person who pressed the button can act on.
 *
 * ── Why `message` is not the technical one ─────────────────────────────────────────────────
 *
 * These messages are printed to a quantity surveyor, under a button they pressed, in place of the
 * work they asked for. "The model's reply was not the JSON it was asked for" told that reader
 * three things they have no use for — that there is a model, that it replies, that the reply is
 * JSON — and nothing they could do about it. It named the shape of the answer rather than the
 * reason there wasn't one.
 *
 * So `message` says what happened and what to do, in the vocabulary the rest of the product uses
 * ("the agent", the thing the corpus page already says reads documents). `detail` carries the
 * status codes, provider wording and exception text to the server log, where the person who needs
 * them is looking.
 */
export class ModelUnavailable extends Error {
  /** The technical cause, for the log. Never printed to a reader. */
  readonly detail: string | null;

  constructor(message: string, detail: string | null = null) {
    super(message);
    this.name = "ModelUnavailable";
    this.detail = detail;
  }
}

export interface Usage {
  input: number;
  output: number;
  /**
   * What the call cost in USD, where the vendor's price is known to the code (Claude). Absent for
   * DeepSeek, whose rates are configured (`costOf`). Carried so a run that used the stronger model is
   * not priced at the cheaper one's rates – an understatement of roughly fifteen times.
   */
  usd?: number | null;
}

/** Two calls' usage as one, keeping the cost honest when they were priced differently. */
export function addUsage(a: Usage, b: Usage): Usage {
  const ca = costOf(a);
  const cb = costOf(b);
  return { input: a.input + b.input, output: a.output + b.output, usd: ca === null || cb === null ? null : ca + cb };
}

export interface Completion {
  /** Parsed from the model's reply. Shape is the caller's to check — see `extract.ts`. */
  json: unknown;
  usage: Usage;
}

/**
 * Ask for one JSON object.
 *
 * The word "json" has to appear in the prompt. That is not a style choice — DeepSeek rejects the
 * request outright without it:
 *
 *     Prompt must contain the word 'json' in some form to use 'response_format' of type
 *     'json_object'.
 *
 * Asserted here rather than left to each caller to remember, because the failure is a 400 at
 * runtime on a prompt that reads perfectly well.
 */
export async function askForJson({
  purpose,
  system,
  user,
  maxTokens = 600,
  signal,
  timeoutMs = TIMEOUT_MS,
}: {
  /**
   * What this call is for (ARC-005). The gateway checks the purpose's rules, removes or tokenises
   * what identifies people and companies, records the call, and refuses anything the rules forbid.
   */
  purpose: PurposeId;
  system: string;
  user: string;
  maxTokens?: number;
  signal?: AbortSignal;
  /** A long answer – a whole take-off – takes longer than a field; the default suits a field. */
  timeoutMs?: number;
}): Promise<Completion> {
  /*
    Which model. Generic reading goes to DeepSeek; work with legal or cost consequences goes to
    Claude (`modelVendorFor`, ARC-005 policy). The name of this function and file predate the
    second vendor – every call site imports it from here, so it routes rather than moves.
  */
  const vendor = modelVendorFor(purpose, claudeConfigured());

  if (vendor === "anthropic" && !claudeConfigured()) {
    throw new ModelUnavailable(
      "This task uses the stronger model, which is not switched on for this deployment, so nothing was read. This is a setting, not an empty result.",
      `ANTHROPIC_API_KEY is not set; ${purpose} is a consequential purpose.`,
    );
  }

  const key = process.env.DEEPSEEK_API_KEY;
  if (vendor === "deepseek" && !key) {
    throw new ModelUnavailable(
      "The agent is not switched on for this deployment, so the documents could not be read. Nothing was read — this is a setting, not an empty corpus.",
      "DEEPSEEK_API_KEY is not set in this environment.",
    );
  }

  if (!/json/i.test(system) && !/json/i.test(user)) {
    // A programming error, not an outage — but it reaches a reader the same way, so it says
    // something a reader can act on and leaves the invariant itself in the log.
    throw new ModelUnavailable(
      "The agent was asked a malformed question, so nothing was read. This is a fault in the platform – please report it.",
      "A JSON-mode prompt must contain the word 'json'; DeepSeek refuses the request otherwise.",
    );
  }

  // Nothing reaches the vendor but what the gateway hands back – with the fence rule appended to the
  // system prompt, personal and company identifiers replaced, and a ledger row written.
  const sent = await guard({ purpose, vendor, system, text: user }).catch((error: unknown) => {
    if (error instanceof EgressRefused) throw new ModelUnavailable(error.message, error.detail);
    throw error;
  });

  if (vendor === "anthropic") return askClaudeForJson(sent, maxTokens, signal, timeoutMs, (PURPOSES[purpose] as Purpose).effort);

  const timeout = AbortSignal.timeout(timeoutMs);
  const abort = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await outbound("deepseek", ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: sent.system },
          { role: "user", content: sent.text },
        ],
        response_format: { type: "json_object" },
        // Reading a figure out of a document is not a creative task. The same corpus should give
        // the same answer twice, or a reviewer cannot tell a corrected value from a re-roll.
        temperature: 0,
        max_tokens: maxTokens,
      }),
      signal: abort,
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new ModelUnavailable(
      timedOut
        ? `The agent did not answer within ${Math.round(timeoutMs / 60_000) || 1} minute${timeoutMs >= 120_000 ? "s" : ""}, so the attempt was stopped. A large set of documents sometimes needs a second run.`
        : "The agent could not be reached – usually a connection that dropped. Try again in a moment.",
      error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    );
  }

  if (!response.ok) {
    /*
      Why the status is read rather than printed.

      A depleted balance and a malformed request are both 4xx and send the reader to completely
      different places — one is "top up the account", the other is "this is a bug, report it". The
      old message passed the provider's own words straight through, which covered every case by
      making the reader work out which one they were in. These say which one they are in; the
      provider's wording goes to the log.
    */
    const provider = await response
      .json()
      .then((body) => (body as { error?: { message?: string } })?.error?.message ?? null)
      .catch(() => null);

    const said = (provider ?? "").toLowerCase();
    const reason =
      response.status === 402 || said.includes("insufficient balance")
        ? "The agent's account is out of credit, so nothing could be read. Top it up and run this again."
        : response.status === 401 || response.status === 403
          ? "The agent's credentials were refused, so nothing could be read. This is a setting on the deployment, not something to retry."
          : response.status === 429
            ? "The agent is handling too much at once. Wait a minute and run this again."
            : response.status >= 500
              ? "The agent is unavailable at the moment. Nothing was read – try again shortly."
              : "The agent refused the request, so nothing was read.";

    throw new ModelUnavailable(reason, `HTTP ${response.status}${provider ? `: ${provider}` : ""}`);
  }

  const body = (await response.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const choice = body.choices?.[0];
  const content = choice?.message?.content;
  if (!content) throw new ModelUnavailable("The agent returned nothing at all. Try again.", "No content in the first choice.");

  /*
    The answer that stopped in the middle.

    `max_tokens` caps the reply, and a reply that reaches the cap is cut wherever it happened to
    be — mid-number, mid-description. What comes back is a truncated structure that fails to
    parse, so this used to surface as "the reply was not the JSON it was asked for": a complaint
    about the format of an answer whose real problem was its length. The reader was told the
    agent had misbehaved when the truth was that the job was bigger than the room allowed for it,
    which has an entirely different remedy.

    Checked before parsing, because the parse failure is the symptom and this is the cause.
  */
  if (choice?.finish_reason === "length") {
    throw new ModelUnavailable(
      "There was more work on these documents than one reading can return, so the answer stopped part-way and none of it could be used. Measure a smaller selection of sheets – the drawings that describe one element – and run it again.",
      `finish_reason=length at max_tokens=${maxTokens}; ${content.length} characters returned.`,
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    // Whatever came back was not a complete answer, and a half-answer grounds nothing. Treated as
    // an outage rather than a finding, for the same reason: it is not evidence about the documents.
    throw new ModelUnavailable(
      "The agent's answer came back incomplete and could not be used. Nothing was changed – run it again.",
      `Unparseable reply, ${content.length} characters, finish_reason=${choice?.finish_reason ?? "unknown"}.`,
    );
  }

  return {
    // Tokens swapped back before any caller reads the reply – in particular before grounding looks
    // for the quoted words in the original passages.
    json: restoreDeep(json, sent.tokens),
    usage: {
      input: body.usage?.prompt_tokens ?? 0,
      output: body.usage?.completion_tokens ?? 0,
    },
  };
}

/**
 * The consequential tier: the same contract as the DeepSeek path above – one JSON object back, an
 * outage thrown as `ModelUnavailable` in words a reader can act on, tokens restored before anyone
 * reads it – over Claude (`egress/anthropic.ts`).
 */
async function askClaudeForJson(
  sent: Prepared & { ok: true },
  maxTokens: number,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  effort: Purpose["effort"],
): Promise<Completion> {
  let reply;
  try {
    reply = await askClaude({ system: sent.system, user: sent.text, maxTokens, signal, timeoutMs, effort });
  } catch (error) {
    // Most specific first: the status decides where the reader is sent, as in the DeepSeek path.
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    if (error instanceof Anthropic.APIUserAbortError || error instanceof Anthropic.APIConnectionTimeoutError) {
      throw new ModelUnavailable(`The agent did not answer within ${Math.round(timeoutMs / 60_000) || 1} minute${timeoutMs >= 120_000 ? "s" : ""}, so the attempt was stopped.`, detail);
    }
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      throw new ModelUnavailable("The stronger model's credentials were refused, so nothing could be read. This is a setting on the deployment, not something to retry.", detail);
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new ModelUnavailable("The agent is handling too much at once. Wait a minute and run this again.", detail);
    }
    if (error instanceof Anthropic.BadRequestError && /credit|billing|balance/i.test(error.message)) {
      throw new ModelUnavailable("The stronger model's account is out of credit, so nothing could be read. Top it up and run this again.", detail);
    }
    if (error instanceof Anthropic.APIError && (error.status ?? 0) >= 500) {
      throw new ModelUnavailable("The agent is unavailable at the moment. Nothing was read – try again shortly.", detail);
    }
    if (error instanceof Anthropic.APIConnectionError) {
      throw new ModelUnavailable("The agent could not be reached – usually a connection that dropped. Try again in a moment.", detail);
    }
    if (error instanceof Anthropic.APIError) throw new ModelUnavailable("The agent refused the request, so nothing was read.", detail);
    throw new ModelUnavailable("The agent could not be reached. Try again in a moment.", detail);
  }

  if (!reply.ok) {
    throw new ModelUnavailable(
      reply.reason === "refusal"
        ? "The model declined this request, so nothing was read. A person should do this one by hand."
        : reply.reason === "max_tokens"
          ? "There was more work on these documents than one reading can return, so the answer stopped part-way and none of it could be used. Measure a smaller selection and run it again."
          : "The agent returned nothing at all. Try again.",
      reply.detail,
    );
  }

  const json = jsonIn(reply.text);
  if (json === null) {
    throw new ModelUnavailable(
      "The agent's answer came back incomplete and could not be used. Nothing was changed – run it again.",
      `No JSON object in a ${reply.text.length}-character reply.`,
    );
  }

  return { json: restoreDeep(json, sent.tokens), usage: reply.usage };
}

/**
 * What a run cost, in rands, when the rates are configured.
 *
 * Returns null rather than zero when they are not: a run that cost nothing and a run whose cost
 * nobody priced are different, and showing R0.00 for the second is a small lie in a platform whose
 * whole argument is that numbers carry their provenance.
 */
export function costOf(usage: Usage): number | null {
  // Priced at the call, by the vendor that ran it (Claude), or summed by `addUsage`.
  if (usage.usd !== undefined) return usage.usd;
  const perMillionIn = Number(process.env.LLM_USD_PER_MTOK_IN);
  const perMillionOut = Number(process.env.LLM_USD_PER_MTOK_OUT);
  if (!Number.isFinite(perMillionIn) || !Number.isFinite(perMillionOut)) return null;

  return (usage.input / 1_000_000) * perMillionIn + (usage.output / 1_000_000) * perMillionOut;
}
