/**
 * Finding what identifies somebody in text that is about to leave the platform — ARC-005, "Detect".
 *
 * ── Deterministic, and deliberately narrow ─────────────────────────────────────────────────
 *
 * Every detector here is a pattern with a reason a false positive is unlikely: an SA ID has a date
 * and a checksum, a VAT number is only taken after the word VAT, a company registration has the
 * CIPC shape. A quantity surveyor's text is dense with numbers – "1 046 units", "R 4 512 300.00",
 * "9 414 m²" – and a detector that ate those would break the readings it exists to protect. So
 * these find what they can find with confidence, and the rest is Phase 2: classification at ingest,
 * and a name-recognition model run inside the platform (ARC-005 build plan).
 *
 * ── The classes ────────────────────────────────────────────────────────────────────────────
 *
 *   C2  commercial & juristic   company names (from contacts), CIPC registrations, VAT numbers
 *   C3  personal                people's names (contacts, users), emails, phones, SA IDs, bank accounts
 *   C4  special                 race and ownership on B-BBEE documents, health, criminal records
 *
 * C0 and C1 – published material and project measurements – are what is left, and are sent.
 */

export type DataClass = "C2" | "C3" | "C4";

export type DetectorKind =
  | "sa_id"
  | "phone"
  | "email"
  | "bank_account"
  | "vat"
  | "company_reg"
  | "person"
  | "organisation"
  | "special";

export interface Detection {
  kind: DetectorKind;
  cls: DataClass;
  start: number;
  end: number;
  text: string;
}

/** Names the platform already knows belong to someone: its contacts and its users. */
export interface KnownNames {
  people: readonly string[];
  organisations: readonly string[];
}

export const NO_NAMES: KnownNames = { people: [], organisations: [] };

export const CLASS_OF: Record<DetectorKind, DataClass> = {
  sa_id: "C3",
  phone: "C3",
  email: "C3",
  bank_account: "C3",
  person: "C3",
  vat: "C2",
  company_reg: "C2",
  organisation: "C2",
  special: "C4",
};

/** Luhn, as the SA ID number's last digit is computed. */
function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/**
 * An SA ID number: YYMMDD, four sequence digits, citizenship 0–2, a digit, and a Luhn check digit.
 * The date and the checksum together make a thirteen-digit figure that is not an ID very unlikely
 * to pass – which matters, because a bill can carry long reference numbers.
 */
export function isSaId(candidate: string): boolean {
  const digits = candidate.replace(/\s/g, "");
  if (!/^\d{13}$/.test(digits)) return false;
  const month = Number(digits.slice(2, 4));
  const day = Number(digits.slice(4, 6));
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  if (!"012".includes(digits[10]!)) return false;
  return luhn(digits);
}

interface Pattern {
  kind: DetectorKind;
  re: RegExp;
  /** Which capture group is the sensitive part. 0 = the whole match. */
  group?: number;
  accept?: (text: string) => boolean;
  /** Widen the span to the end of the sentence or line – for special data, the detail follows the keyword. */
  toSentenceEnd?: boolean;
}

const PATTERNS: readonly Pattern[] = [
  // Thirteen digits, optionally written 6-4-3. Never inside a longer run of digits.
  { kind: "sa_id", re: /(?<![\d])(\d{6}\s?\d{4}\s?\d{3})(?![\d])/g, group: 1, accept: isSaId },

  // The local part takes every character RFC 5322 allows unquoted, not only the common ones: a
  // partial match would leave half an address in the text and call it removed.
  { kind: "email", re: /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g },

  // +27 / 0027 and nine digits, or a local ten-digit number starting 0. Grouped 3-3-4 as they are
  // written, with spaces, dashes or brackets. Never after an R (a rand amount) or another digit.
  {
    kind: "phone",
    re: /(?<![\dR]\s?)(?<![\w+])(?:(?:\+27|0027)[\s-]?\(?0?\)?\d{2}|\(?0\d{2}\)?)[\s-]?\d{3}[\s-]?\d{4}(?![\d])/g,
  },

  // A bank account only where the text says it is one.
  {
    kind: "bank_account",
    re: /\b(?:acc(?:ount)?|a\/c)\.?\s*(?:no\.?|number|#)?\s*[:.]?\s*(\d[\d\s-]{5,15}\d)(?![\d])/gi,
    group: 1,
  },

  // An SA VAT number is ten digits starting with 4 – taken only after the word VAT, because a
  // bare ten-digit figure is as likely to be a quantity or an amount.
  {
    kind: "vat",
    re: /\bVAT\s*(?:reg(?:istration)?\.?\s*)?(?:no\.?|number|#)?\s*[:.]?\s*(4\d{9})(?![\d])/gi,
    group: 1,
  },

  // CIPC: 2016/482913/07, and the older CK form.
  { kind: "company_reg", re: /\b(?:CK\s?)?(?:19|20)\d{2}\/\d{6}\/\d{2}\b/g },

  /*
    Special personal information – POPIA s26. In QS work it arrives on B-BBEE certificates and
    affidavits (ownership by race and sex) and on OHS records (health). The B-BBEE *level* is kept,
    because tender scoring needs it; the ownership detail that reveals race is not.
  */
  {
    kind: "special",
    re: /\b\d{1,3}(?:[.,]\d+)?\s?%\s*(?:black|african|coloured|indian|white|asian)\b(?:\s+(?:women|woman|female|male|youth|people|persons?))*(?:[\s-]+owned|\s+ownership)?/gi,
  },
  {
    kind: "special",
    re: /\b(?:black|african|coloured|indian|white|asian)(?:\s+(?:women|woman|female|male|youth))?[\s-]+owned\b/gi,
  },
  { kind: "special", re: /\b(?:race|ethnicity|population group)\s*[:\-]\s*[A-Za-z]+/gi },
  {
    kind: "special",
    re: /\b(?:HIV(?:\/AIDS)?|medical (?:history|condition|records?)|chronic (?:illness|medication)|criminal record|previous convictions?|convicted of|biometric)\b/gi,
    toSentenceEnd: true,
  },
];

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A known name, as a whole phrase, case-insensitive. Short names are skipped: "Arch" or "Bob" would
 * match ordinary words, and a person's name is only taken as a whole (first and last) so "Grant"
 * alone is not a person.
 */
function nameMatchers(known: KnownNames): Pattern[] {
  const out: Pattern[] = [];
  const add = (kind: "person" | "organisation", names: readonly string[], ok: (n: string) => boolean) => {
    const unique = [...new Set(names.map((n) => n.trim()).filter(ok))]
      // Longest first, so "Kgosi Civils (Pty) Ltd" wins over "Kgosi Civils".
      .sort((a, b) => b.length - a.length);
    if (unique.length === 0) return;
    out.push({ kind, re: new RegExp(`(?<![\\w])(?:${unique.map(escapeRegex).join("|")})(?![\\w])`, "gi") });
  };
  add("person", known.people, (n) => n.length >= 6 && /\S+\s+\S{2,}/.test(n));
  add("organisation", known.organisations, (n) => n.length >= 4);
  return out;
}

function sentenceEnd(text: string, from: number): number {
  const rest = text.slice(from);
  const stop = rest.search(/[.;\n]/);
  return from + (stop === -1 ? Math.min(rest.length, 160) : Math.min(stop, 160));
}

/**
 * Every detection, sorted and non-overlapping. Where two overlap, the higher class wins, then the
 * longer span – a phone number inside a special-category sentence goes with the sentence.
 */
export function detect(text: string, known: KnownNames = NO_NAMES): Detection[] {
  const found: Detection[] = [];

  for (const p of [...PATTERNS, ...nameMatchers(known)]) {
    for (const m of text.matchAll(p.re)) {
      const part = p.group ? m[p.group] : m[0];
      if (!part || (p.accept && !p.accept(part))) continue;
      const start = m.index! + (p.group ? m[0].indexOf(part) : 0);
      const end = p.toSentenceEnd ? sentenceEnd(text, start + part.length) : start + part.length;
      found.push({ kind: p.kind, cls: CLASS_OF[p.kind], start, end, text: text.slice(start, end) });
    }
  }

  const rank = (d: Detection) => Number(d.cls.slice(1)) * 1e6 + (d.end - d.start);
  const kept: Detection[] = [];
  for (const d of found.sort((a, b) => rank(b) - rank(a))) {
    if (!kept.some((k) => d.start < k.end && k.start < d.end)) kept.push(d);
  }
  return kept.sort((a, b) => a.start - b.start);
}
