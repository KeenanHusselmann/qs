import { describe, expect, it } from "vitest";

import { base32Decode, base32Encode, codeAt, newSecret, otpauthUri, stepAt, verifyCode } from "./totp";

// RFC 6238 appendix B: the SHA-1 seed is the ASCII "12345678901234567890".
const RFC = Buffer.from("12345678901234567890");

describe("RFC 6238 test vectors (SHA-1, 8 digits)", () => {
  const vectors: [number, string][] = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];
  for (const [seconds, code] of vectors) {
    it(`T=${seconds} → ${code}`, () => expect(codeAt(RFC, stepAt(seconds * 1000), 8)).toBe(code));
  }
});

describe("base32", () => {
  it("round-trips any bytes", () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 17]);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
  });
  it("matches RFC 4648's example", () => expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI"));
  it("makes a 160-bit key, 32 characters", () => expect(newSecret()).toMatch(/^[A-Z2-7]{32}$/));
});

describe("verifyCode", () => {
  const secret = base32Decode(newSecret());
  const now = Date.UTC(2026, 10, 17, 12, 0, 15);
  const step = stepAt(now);

  it("accepts the current code, and one step either side", () => {
    expect(verifyCode(secret, codeAt(secret, step), now, null)).toBe(step);
    expect(verifyCode(secret, codeAt(secret, step - 1), now, null)).toBe(step - 1);
    expect(verifyCode(secret, codeAt(secret, step + 1), now, null)).toBe(step + 1);
  });
  it("refuses a code two steps old", () => expect(verifyCode(secret, codeAt(secret, step - 2), now, null)).toBeNull());
  it("refuses a code already used – no replay", () => expect(verifyCode(secret, codeAt(secret, step), now, step)).toBeNull());
  it("refuses anything that is not six digits", () => {
    expect(verifyCode(secret, "12345", now, null)).toBeNull();
    expect(verifyCode(secret, "abcdef", now, null)).toBeNull();
  });
  it("tolerates a space in the middle", () => {
    const code = codeAt(secret, step);
    expect(verifyCode(secret, `${code.slice(0, 3)} ${code.slice(3)}`, now, null)).toBe(step);
  });
});

it("builds the URI an authenticator scans", () => {
  expect(otpauthUri("ABC", "qs@example.com")).toBe(
    "otpauth://totp/Mzilikazi%20QS%20Platform%3Aqs%40example.com?secret=ABC&issuer=Mzilikazi%20QS%20Platform&algorithm=SHA1&digits=6&period=30",
  );
});
