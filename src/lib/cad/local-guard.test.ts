import { describe, expect, it } from "vitest";

import { guardRequest, securityHeaders } from "./local-guard";

const PORT = 4317;
const ask = (method: string, host: string | undefined, origin?: string) => guardRequest({ method, host, origin }, PORT);

describe("who may talk to the local reader", () => {
  it("serves its own page, from this machine", () => {
    expect(ask("GET", "localhost:4317").allowed).toBe(true);
    expect(ask("GET", "127.0.0.1:4317").allowed).toBe(true);
    expect(ask("POST", "localhost:4317", "http://localhost:4317").allowed).toBe(true);
  });

  it("refuses a drawing posted by another web page open in the same browser", () => {
    expect(ask("POST", "localhost:4317", "https://evil.example").allowed).toBe(false);
    expect(ask("POST", "localhost:4317", "null").allowed).toBe(false);
    // A POST with no Origin at all is not a browser page of ours – curl from a script, say.
    expect(ask("POST", "localhost:4317").allowed).toBe(false);
  });

  it("refuses a DNS-rebinding request, which names the attacker's domain as its host", () => {
    expect(ask("GET", "evil.example:4317").allowed).toBe(false);
    expect(ask("POST", "evil.example:4317", "http://evil.example:4317").allowed).toBe(false);
  });

  it("refuses a request for another port or with no host", () => {
    expect(ask("GET", "localhost:3000").allowed).toBe(false);
    expect(ask("GET", undefined).allowed).toBe(false);
  });
});

describe("what the page may load", () => {
  it("runs only its own nonced script, frames nowhere and loads nothing from outside", () => {
    const csp = securityHeaders("abc123")["content-security-policy"]!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'nonce-abc123'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("connect-src 'self'");
  });
});
