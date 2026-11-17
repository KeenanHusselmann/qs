/**
 * Time-based one-time codes (RFC 6238, HMAC-SHA1, 6 digits, 30 s) – what Google and Microsoft
 * Authenticator generate. Pure: no database, no clock it does not take as an argument.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const STEP_SECONDS = 30;
const DIGITS = 6;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error("Not a base32 key.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A fresh 160-bit key, as base32 – the length RFC 4226 recommends for SHA-1. */
export const newSecret = (): string => base32Encode(randomBytes(20));

/** The code for one time step. `digits` is only ever not 6 in the RFC's own test vectors. */
export function codeAt(secret: Buffer, step: number, digits = DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", secret).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(binary).padStart(digits, "0");
}

export const stepAt = (unixMs: number): number => Math.floor(unixMs / 1000 / STEP_SECONDS);

/**
 * The step a code is valid for, or null. One step either side allows for a phone clock a little
 * out; a step at or before `lastUsed` is refused, so a code seen over a shoulder cannot be replayed.
 */
export function verifyCode(secret: Buffer, code: string, unixMs: number, lastUsed: number | null): number | null {
  const typed = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(typed)) return null;
  const now = stepAt(unixMs);
  for (const step of [now, now - 1, now + 1]) {
    if (lastUsed !== null && step <= lastUsed) continue;
    const expected = Buffer.from(codeAt(secret, step));
    if (timingSafeEqual(expected, Buffer.from(typed))) return step;
  }
  return null;
}

/** What an authenticator app scans. */
export const otpauthUri = (secret: string, account: string, issuer = "Mzilikazi QS Platform"): string =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
