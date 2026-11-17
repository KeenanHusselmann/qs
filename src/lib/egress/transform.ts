/**
 * Replacing what was detected, and putting it back in the answer — ARC-005, "Transform" and
 * "Send & restore".
 *
 * A token is a stand-in the model can read and repeat: "PERSON_1", "PARTY_A". The same original in
 * one request always gets the same token, so the model can still tell that two passages name the
 * same tenderer. Tokens are swapped back into the reply before anything else reads it – in
 * particular before `grounding.ts` looks for the quoted words in the original passages, which is
 * why a quote that crosses a token still grounds.
 *
 * What is dropped is not restorable, by design: "[removed]" is what the model sees and repeats, and
 * a quote that crosses it will not ground, which fails safe – the figure is refused, not invented.
 */

import type { DataClass, Detection, DetectorKind } from "@/lib/egress/detect";

export type Treatment = "send" | "token" | "drop" | "refuse";

export interface Transformed {
  text: string;
  /** token → original, for `restore`. Never stored, never logged. */
  tokens: ReadonlyMap<string, string>;
  /** What was found and what was done, by class – for the ledger. Counts, never content. */
  counts: Record<string, number>;
}

const PREFIX: Record<DetectorKind, string> = {
  person: "PERSON",
  organisation: "PARTY",
  email: "EMAIL",
  phone: "PHONE",
  bank_account: "ACCOUNT",
  vat: "VAT",
  company_reg: "REG",
  sa_id: "IDNUMBER",
  special: "SPECIAL",
};

/** Parties are lettered (PARTY_A … PARTY_Z, PARTY_AA …), as a tender report letters tenderers. */
function letter(n: number): string {
  let s = "";
  for (let i = n; i >= 0; i = Math.floor(i / 26) - 1) s = String.fromCharCode(65 + (i % 26)) + s;
  return s;
}

/**
 * Some things are never tokenised whatever the purpose says: an ID number has no use to a model
 * reading construction documents, and special data is never sent at all.
 */
function effective(kind: DetectorKind, treatment: Treatment): Treatment {
  if (treatment === "refuse" || treatment === "send") return treatment;
  if (kind === "sa_id" || kind === "special") return "drop";
  return treatment;
}

export function transform(
  text: string,
  detections: readonly Detection[],
  treatmentOf: (cls: DataClass) => Treatment,
): Transformed | { refused: Detection } {
  const tokens = new Map<string, string>();
  const byOriginal = new Map<string, string>();
  const perKind = new Map<DetectorKind, number>();
  const counts: Record<string, number> = {};

  let out = "";
  let at = 0;
  for (const d of detections) {
    const treatment = effective(d.kind, treatmentOf(d.cls));
    if (treatment === "refuse") return { refused: d };

    out += text.slice(at, d.start);
    at = d.end;

    if (treatment === "send") {
      out += d.text;
      counts[`${d.cls} sent`] = (counts[`${d.cls} sent`] ?? 0) + 1;
      continue;
    }
    if (treatment === "drop") {
      out += d.cls === "C4" ? "[removed: special]" : "[removed]";
      counts[`${d.cls} removed`] = (counts[`${d.cls} removed`] ?? 0) + 1;
      continue;
    }

    // Case-insensitive identity, so "KGOSI CIVILS" and "Kgosi Civils" are one party.
    const identity = `${d.kind}:${d.text.toLowerCase().replace(/\s+/g, " ")}`;
    let token = byOriginal.get(identity);
    if (!token) {
      const n = perKind.get(d.kind) ?? 0;
      perKind.set(d.kind, n + 1);
      token = `${PREFIX[d.kind]}_${d.kind === "organisation" ? letter(n) : n + 1}`;
      byOriginal.set(identity, token);
      tokens.set(token, d.text);
    }
    out += token;
    counts[`${d.cls} tokenised`] = (counts[`${d.cls} tokenised`] ?? 0) + 1;
  }
  out += text.slice(at);

  return { text: out, tokens, counts };
}

/** Put the originals back. Whole tokens only: PERSON_1 never matches inside PERSON_10. */
export function restore(text: string, tokens: ReadonlyMap<string, string>): string {
  if (tokens.size === 0) return text;
  const pattern = new RegExp(`\\b(?:${[...tokens.keys()].join("|")})\\b`, "g");
  return text.replace(pattern, (token) => tokens.get(token) ?? token);
}

/** Restore every string in a parsed reply, at any depth. */
export function restoreDeep(value: unknown, tokens: ReadonlyMap<string, string>): unknown {
  if (tokens.size === 0) return value;
  if (typeof value === "string") return restore(value, tokens);
  if (Array.isArray(value)) return value.map((v) => restoreDeep(v, tokens));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, restoreDeep(v, tokens)]));
  }
  return value;
}
