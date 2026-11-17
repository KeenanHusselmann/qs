/**
 * A signature shown under the signer's name – and the email still, where nothing names it.
 */

import { describe, expect, it } from "vitest";

import { nameIn } from "./signers";

const names = new Map([["thandi@mzilikazi.co.za", "Thandi Nkosi"]]);

describe("the name a signature is shown under", () => {
  it("is the person's name, whatever the case or spacing of the stored email", () => {
    expect(nameIn(names, "Thandi@Mzilikazi.co.za ")).toBe("Thandi Nkosi");
  });

  it("is the email where nothing names it, never a blank", () => {
    expect(nameIn(names, "someone@elsewhere.co.za")).toBe("someone@elsewhere.co.za");
  });

  it("is nothing for a run nobody has signed", () => {
    expect(nameIn(names, null)).toBeNull();
  });
});
