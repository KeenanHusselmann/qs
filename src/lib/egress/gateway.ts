/**
 * The outbound gateway — ARC-005. Everything the platform sends to an outside service passes here.
 *
 *   declare purpose → check policy → detect → transform → minimise → fence → (send) → restore → record
 *
 * `prepare` is the decision, and is pure so it can be tested exhaustively. `guard` is the same
 * decision with the world attached: the names the platform knows, who the call is for, and the
 * ledger row. A caller sends only what `guard` returns, and restores the reply with its tokens.
 *
 * ── It fails closed ────────────────────────────────────────────────────────────────────────
 *
 * No recorded transfer basis, an over-budget request, a class the purpose refuses, a ledger that
 * cannot be written: each is a refusal, recorded where it can be, and surfaced to the reader in
 * words. "We did not send it" is never turned into an empty answer – callers turn `EgressRefused`
 * into the same visible refusal as an outage, for the reason `deepseek.ts` gives.
 */

import { createHash } from "node:crypto";

import { db } from "@/db/client";
import { egressEvents } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { detect, type DataClass, type KnownNames } from "@/lib/egress/detect";
import { UNTRUSTED_RULE } from "@/lib/egress/fence";
import { knownNames } from "@/lib/egress/known-names";
import { PURPOSES, transferBasis, VENDORS, type PurposeId, type VendorId } from "@/lib/egress/policy";
import { currentScope } from "@/lib/egress/scope";
import { transform } from "@/lib/egress/transform";

/** A call the gateway would not make. `message` is for the reader; `detail` for the log. */
export class EgressRefused extends Error {
  readonly detail: string;
  constructor(message: string, detail: string) {
    super(message);
    this.name = "EgressRefused";
    this.detail = detail;
  }
}

export type Prepared =
  | { ok: true; system: string; text: string; tokens: ReadonlyMap<string, string>; counts: Record<string, number>; sha256: string }
  | { ok: false; message: string; detail: string; counts: Record<string, number> };

const CLASS_WORDS: Record<DataClass, string> = {
  C2: "a company's registration, VAT number or name",
  C3: "a person's name, email, phone number or ID number",
  C4: "special personal information (race, health or a criminal record)",
};

/** The decision, with nothing attached. Pure: same input, same answer. */
export function prepare(input: {
  purpose: PurposeId;
  vendor: VendorId;
  system?: string;
  text: string;
  known: KnownNames;
  basis: string | null;
}): Prepared {
  const purpose = PURPOSES[input.purpose];
  const vendor = VENDORS[input.vendor];

  if (input.basis === null) {
    return {
      ok: false,
      message: `Sending to ${vendor.name} is switched off on this deployment until the practice records its legal basis for the transfer. Nothing was sent.`,
      detail: `${vendor.basisEnv} is not set (POPIA s72). purpose=${input.purpose}`,
      counts: {},
    };
  }

  // Minimise: the purpose's budget is the most it may send. Over it is a fault in the caller, which
  // should have chosen fewer passages – never silently truncated, which would cut instructions off.
  if (input.text.length > purpose.budget) {
    return {
      ok: false,
      message: "There was more to send than this task is allowed to send in one go, so nothing was sent. Choose fewer documents or a smaller selection and try again.",
      detail: `${input.text.length} characters over the ${purpose.budget} budget for ${input.purpose}.`,
      counts: {},
    };
  }

  const detections = detect(input.text, input.known);
  const result = transform(input.text, detections, (cls) => purpose.treat[cls]);

  if ("refused" in result) {
    const counts = { [`${result.refused.cls} found`]: 1 };
    return {
      ok: false,
      message:
        input.purpose === "web.search"
          ? `This question was not searched because it contains ${CLASS_WORDS[result.refused.cls]}, and a web search sends the question to a public search engine. Rephrase it without that and search again.`
          : `This was not sent because it contains ${CLASS_WORDS[result.refused.cls]}, which this task may not send.`,
      detail: `${input.purpose}: ${result.refused.kind} (${result.refused.cls}) refused.`,
      counts,
    };
  }

  // The fence rule rides on every model call, so no prompt that carries a document goes without it.
  const system = purpose.channel === "model" && input.system !== undefined ? `${input.system}\n\n${UNTRUSTED_RULE}` : (input.system ?? "");
  const sha256 = createHash("sha256").update(system).update("\n\n").update(result.text).digest("hex");

  return { ok: true, system, text: result.text, tokens: result.tokens, counts: result.counts, sha256 };
}

/** Who the call is for: the project an entry point named, and the person it named or who is signed in. */
async function attribution(): Promise<{ projectId: string | null; actor: string | null }> {
  const scope = currentScope();
  if (scope?.actor) return scope;
  // Outside a request (a cron sweep, an `after()` callback) there is no session to read; that is
  // recorded as no actor rather than treated as a failure.
  const session = await getSession().catch(() => null);
  return { projectId: scope?.projectId ?? null, actor: session?.email ?? null };
}

async function record(row: typeof egressEvents.$inferInsert): Promise<void> {
  await db.insert(egressEvents).values(row);
}

/**
 * Decide, record, and hand back what may be sent. Throws `EgressRefused` for anything that must not
 * leave – including a ledger that cannot be written, because a transfer with no record is the thing
 * the ledger exists to prevent.
 */
export async function guard(input: { purpose: PurposeId; vendor: VendorId; system?: string; text: string }): Promise<Prepared & { ok: true }> {
  const vendor = VENDORS[input.vendor];
  const basis = transferBasis(input.vendor);
  const who = await attribution();

  let known: KnownNames;
  try {
    known = await knownNames();
  } catch (error) {
    throw new EgressRefused(
      "The platform could not check this for personal information, so nothing was sent. Try again in a moment.",
      `known names unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const prepared = prepare({ ...input, known, basis });
  const base = { purpose: input.purpose, vendor: input.vendor, region: vendor.region, projectId: who.projectId, actor: who.actor, basis };

  try {
    await record(
      prepared.ok
        ? { ...base, classes: prepared.counts, charsOut: prepared.system.length + prepared.text.length, sha256: prepared.sha256, decision: "allowed" }
        : { ...base, classes: prepared.counts, charsOut: 0, decision: "refused", reason: prepared.detail },
    );
  } catch (error) {
    throw new EgressRefused(
      "The platform could not record this transfer, so nothing was sent. Try again in a moment.",
      `egress ledger write failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!prepared.ok) throw new EgressRefused(prepared.message, prepared.detail);
  return prepared;
}
