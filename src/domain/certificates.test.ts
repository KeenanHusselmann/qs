import { describe, expect, it } from "vitest";

import { grossValuation, paymentCertificate, retentionReleasedAtCompletion } from "./certificates";
import { money } from "./money";

const R = (cents: bigint) => money(cents);

describe("a payment certificate, added up in the order it prints", () => {
  it("builds gross from its parts, holds retention, deducts what was certified, adds VAT", () => {
    const cert = paymentCertificate({
      parts: { workExecuted: R(40_000_000n), variations: R(1_500_000n), dayworks: R(250_000n), materialsOnSite: R(2_000_000n) },
      retentionRate: 1_000n, // 10%
      retentionLimit: null,
      previouslyCertified: R(25_000_000n),
    });
    expect(cert.gross).toBe(43_750_000n); // R 437 500,00
    expect(cert.retention).toBe(4_375_000n);
    expect(cert.net).toBe(39_375_000n);
    expect(cert.dueExVat).toBe(14_375_000n);
    expect(cert.vat).toBe(2_156_250n);
    expect(cert.due).toBe(16_531_250n);
    expect(cert.limited).toBe(false);
  });

  it("holds no more retention than the contract's limit, and says the limit bit", () => {
    const cert = paymentCertificate({
      parts: { workExecuted: R(100_000_000n), variations: null, dayworks: null, materialsOnSite: null },
      retentionRate: 1_000n,
      retentionLimit: R(5_000_000n),
      previouslyCertified: R(0n),
    });
    expect(cert.retentionAtRate).toBe(10_000_000n);
    expect(cert.retention).toBe(5_000_000n);
    expect(cert.limited).toBe(true);
  });

  it("rounds retention and VAT once each, half away from zero", () => {
    const cert = paymentCertificate({
      parts: { workExecuted: R(333n), variations: null, dayworks: null, materialsOnSite: null },
      retentionRate: 500n, // 5%: 16,65 cents → 17
      retentionLimit: null,
      previouslyCertified: R(0n),
    });
    expect(cert.retention).toBe(17n);
    expect(cert.vat).toBe(47n); // 15% of 316 = 47,4
  });

  it("prints an over-certification as a negative amount due rather than hiding it", () => {
    const cert = paymentCertificate({
      parts: { workExecuted: R(10_000_000n), variations: null, dayworks: null, materialsOnSite: null },
      retentionRate: 1_000n,
      retentionLimit: null,
      previouslyCertified: R(9_500_000n),
    });
    expect(cert.dueExVat).toBe(-500_000n);
    expect(cert.vat).toBe(-75_000n);
  });

  it("uses one definition of gross, which the cash flow reads too", () => {
    expect(grossValuation({ workExecuted: R(100n), variations: null, dayworks: R(5n), materialsOnSite: R(10n) })).toBe(115n);
  });
});

describe("practical completion", () => {
  it("releases half the retention held by default", () => {
    expect(retentionReleasedAtCompletion(R(4_375_001n))).toEqual({ retentionHeld: 4_375_001n, released: 2_187_501n, stillHeld: 2_187_500n });
  });
});
