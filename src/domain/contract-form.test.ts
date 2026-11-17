import { describe, expect, it } from "vitest";

import { contractFamily, contractTerms, noticeTimeBar } from "./contract-form";

describe("the family of contract, from the words on its cover", () => {
  it("reads the forms used in South Africa", () => {
    expect(contractFamily("JBCC Principal Building Agreement, edition 6.2")).toBe("jbcc");
    expect(contractFamily("FIDIC Conditions of Contract for Construction (Red Book), 1999")).toBe("fidic");
    expect(contractFamily("NEC4 Engineering and Construction Contract")).toBe("nec");
    expect(contractFamily("GCC 2015")).toBe("gcc");
    expect(contractFamily(null)).toBe("unknown");
  });
});

describe("the terms that follow", () => {
  it("names FIDIC's certificates and certifier, and its notice bar by edition", () => {
    const red = contractTerms("FIDIC Red Book 1999");
    expect(red).toMatchObject({ paymentCertificate: "Interim Payment Certificate", completionCertificate: "Taking-Over Certificate", certifier: "The Engineer", noticeDays: 28, noticeClause: "Sub-Clause 20.1" });
    expect(contractTerms("FIDIC Red Book 2017").noticeClause).toBe("Sub-Clause 20.2.1");
  });

  it("keeps the JBCC names, with no bar asserted, for everything else", () => {
    expect(contractTerms("JBCC PBA 6.2")).toMatchObject({ paymentCertificate: "Payment Certificate", noticeDays: null });
  });
});

describe("the notice time bar", () => {
  const fidic = contractTerms("FIDIC 1999");
  it("is late past 28 days after the event, and in time on the 28th", () => {
    expect(noticeTimeBar(fidic, "2026-10-01", "2026-10-29")).toEqual({ late: false, days: 28 });
    expect(noticeTimeBar(fidic, "2026-10-01", "2026-10-30")).toEqual({ late: true, days: 29 });
  });
  it("says nothing where the form sets no bar or the event date is not known", () => {
    expect(noticeTimeBar(contractTerms("JBCC"), "2026-10-01", "2026-12-01")).toBeNull();
    expect(noticeTimeBar(fidic, null, "2026-12-01")).toBeNull();
  });
});
