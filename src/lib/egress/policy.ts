/**
 * What may leave, for what, and to whom — ARC-005, "Declare purpose" and "Check policy".
 *
 * Held in code on purpose: a change to what the platform sends to a vendor is reviewed like any
 * other change, in a pull request, rather than switched in a settings screen nobody audits.
 *
 * ── Purposes ───────────────────────────────────────────────────────────────────────────────
 *
 * Every outbound call names one. An unregistered purpose cannot be named (the type forbids it), and
 * each purpose says what it does with commercial (C2), personal (C3) and special (C4) information,
 * and the most text it may send. The rules follow ARC-005's "Rules per purpose" table.
 *
 * ── Vendors, and the basis for sending to them ─────────────────────────────────────────────
 *
 * Each vendor has a host (the only one `transport.ts` will reach for it), a region, and an
 * environment setting holding the practice's recorded basis for the transfer – POPIA s72, and GDPR
 * Chapter V where EU data subjects are involved: "s72(1)(a) agreement with DeepSeek, signed
 * 2026-11-20". **In production, a vendor with no basis recorded receives nothing.** The gateway
 * fails closed. In development and CI the basis is "development – no client data", which is what
 * those environments hold.
 */

import type { DataClass } from "@/lib/egress/detect";
import type { Treatment } from "@/lib/egress/transform";

export type VendorId = "deepseek" | "deepseek-search" | "anthropic" | "resend";

export interface Vendor {
  name: string;
  host: string;
  /** Where the vendor processes what it is sent, as an ISO country code – recorded on every call. */
  region: string;
  /** The environment variable holding the practice's recorded transfer basis. */
  basisEnv: string;
}

export const VENDORS: Record<VendorId, Vendor> = {
  deepseek: { name: "DeepSeek", host: "api.deepseek.com", region: "CN", basisEnv: "EGRESS_BASIS_DEEPSEEK" },
  // Same company, same key, same basis – a different endpoint, and a different purpose (web.search).
  "deepseek-search": { name: "DeepSeek web search", host: "api.deepseek.com", region: "CN", basisEnv: "EGRESS_BASIS_DEEPSEEK" },
  anthropic: { name: "Anthropic", host: "api.anthropic.com", region: "US", basisEnv: "EGRESS_BASIS_ANTHROPIC" },
  resend: { name: "Resend", host: "api.resend.com", region: "US", basisEnv: "EGRESS_BASIS_RESEND" },
};

/**
 * Generic work goes to the general model; work with legal or cost consequences goes to the stronger
 * one (meeting of 2026-11, "which model handles what": benchmarking counts as cost).
 */
export type Tier = "generic" | "consequential";

export interface Purpose {
  description: string;
  channel: "model" | "search" | "email";
  tier: Tier;
  /** What to do with each class found in the text. C0/C1 are always sent. */
  treat: Record<DataClass, Treatment>;
  /** The most characters of user text one call may send. Over it is refused: minimise first. */
  budget: number;
  /**
   * How hard the consequential model works on it (Claude's `output_config.effort`). Higher is
   * slower. Set per purpose because some run inside a route capped at 60 seconds (ARC-002): a rate
   * build-up asked for from the advisor shares that minute with two other calls.
   */
  effort?: "low" | "medium" | "high";
}

/** The usual model rule: parties aliased, people tokenised, special data dropped. */
const CURATED = { C2: "token", C3: "token", C4: "drop" } as const;
/** For measurement and scheduling, which never need to know who anybody is. */
const ANONYMOUS = { C2: "token", C3: "drop", C4: "drop" } as const;

export const PURPOSES = {
  "extract.field": { description: "Read one figure for a service step out of the corpus", channel: "model", tier: "generic", treat: CURATED, budget: 20_000 },
  "criteria.coverage": { description: "Judge whether a document covers an entry requirement", channel: "model", tier: "generic", treat: CURATED, budget: 30_000 },
  "bill.extract": { description: "Draft bill items from the corpus", channel: "model", tier: "generic", treat: ANONYMOUS, budget: 20_000 },
  "programme.extract": { description: "Read a contractor's programme activities", channel: "model", tier: "generic", treat: ANONYMOUS, budget: 20_000 },
  "measure.drawings": { description: "Measure a take-off from drawing text", channel: "model", tier: "consequential", treat: ANONYMOUS, budget: 250_000, effort: "high" },
  "cad.interpret": { description: "Label the layers and outlines of a CAD drawing", channel: "model", tier: "generic", treat: ANONYMOUS, budget: 60_000 },
  // Medium: a short method, and reached from the advisor's route, which is capped at 60 seconds.
  "rate.buildup": { description: "Propose the components of a rate build-up", channel: "model", tier: "consequential", treat: CURATED, budget: 10_000, effort: "medium" },
  "quote.evaluate": { description: "Evaluate a quotation or tender response against an RFQ", channel: "model", tier: "consequential", treat: CURATED, budget: 200_000, effort: "high" },
  "advisor.brief": { description: "Advise on a project's signed position", channel: "model", tier: "generic", treat: CURATED, budget: 40_000 },
  "advisor.ask": { description: "Answer a reader's question about a project", channel: "model", tier: "generic", treat: CURATED, budget: 120_000 },
  "onboarding.ask": { description: "Answer a question about using the platform", channel: "model", tier: "generic", treat: CURATED, budget: 120_000 },
  // The question reaches a public search engine, so nothing but public material may go.
  "web.search": { description: "Search the web for a reader's question", channel: "search", tier: "generic", treat: { C2: "refuse", C3: "refuse", C4: "refuse" }, budget: 2_000 },
  // The address is the envelope, not the content; the body names the task and the project only.
  "email.notify": { description: "Email a notification to its recipient", channel: "email", tier: "generic", treat: { C2: "drop", C3: "drop", C4: "drop" }, budget: 10_000 },
} as const satisfies Record<string, Purpose>;

export type PurposeId = keyof typeof PURPOSES;

/**
 * Which model a purpose's calls go to.
 *
 * Generic work: DeepSeek. Consequential work: Claude. Where Claude is not configured, development
 * and CI fall back to DeepSeek so the platform still runs without a second key; **production does
 * not** – it names Claude, and the missing key surfaces as a refusal the reader can see, rather than
 * a tender being evaluated by the model the practice decided it should not be.
 */
export function modelVendorFor(purpose: PurposeId, claudeConfigured: boolean): "deepseek" | "anthropic" {
  if (PURPOSES[purpose].tier !== "consequential") return "deepseek";
  if (claudeConfigured || process.env.NODE_ENV === "production") return "anthropic";
  return "deepseek";
}

/**
 * The practice's recorded basis for sending to this vendor, or null when there is none and the
 * call must not happen. Read on every call, so recording or withdrawing it takes effect at once.
 */
export function transferBasis(vendor: VendorId): string | null {
  const recorded = process.env[VENDORS[vendor].basisEnv]?.trim();
  if (recorded) return recorded;
  return process.env.NODE_ENV === "production" ? null : "development – no client data";
}
