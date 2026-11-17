/**
 * Encrypting a small secret at rest – AES-256-GCM under a key derived from SESSION_SECRET.
 *
 * Used for authenticator keys: stored in the clear, a copy of the database alone could mint sign-in
 * codes. Encrypted, it needs the deployment's secret as well. Each value carries its own random IV,
 * and GCM's tag means a tampered value fails to open rather than opening wrong.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const key = (purpose: string): Buffer => {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET is not set, so secrets cannot be stored.");
  return createHash("sha256").update(`${purpose}:${secret}`).digest();
};

/** `v1.<iv>.<tag>.<ciphertext>`, base64url – versioned so the scheme can change without guessing. */
export function seal(plain: string, purpose: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(purpose), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), body].map((part) => (typeof part === "string" ? part : part.toString("base64url"))).join(".");
}

export function open(sealed: string, purpose: string): string {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || body === undefined) throw new Error("Not a sealed value.");
  const decipher = createDecipheriv("aes-256-gcm", key(purpose), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}
