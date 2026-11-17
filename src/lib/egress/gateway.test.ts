import { describe, expect, it } from "vitest";

import { locateQuote } from "@/lib/agent/grounding";
import { prepare } from "./gateway";
import { restoreDeep } from "./transform";

const known = { people: ["Lerato Kgosi"], organisations: ["Kgosi Civils (Pty) Ltd"] };
const passage = "Tender submitted by Kgosi Civils (Pty) Ltd. Contact Lerato Kgosi on 083 555 0142. Tender sum R 4 512 300.00.";

describe("prepare", () => {
  it("fails closed when the practice has recorded no basis for the vendor", () => {
    const out = prepare({ purpose: "extract.field", vendor: "deepseek", system: "json", text: "x", known, basis: null });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.detail).toMatch(/EGRESS_BASIS_DEEPSEEK/);
  });

  it("refuses rather than truncates a request over the purpose's budget", () => {
    const out = prepare({ purpose: "rate.buildup", vendor: "deepseek", system: "json", text: "a".repeat(10_001), known, basis: "test" });
    expect(out.ok).toBe(false);
  });

  it("refuses a web search that names a person, and says why", () => {
    const out = prepare({ purpose: "web.search", vendor: "deepseek-search", text: "What does Lerato Kgosi charge for paving?", known, basis: "test" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toMatch(/public search engine/);
  });

  it("lets a public question through to the web unchanged", () => {
    const out = prepare({ purpose: "web.search", vendor: "deepseek-search", text: "Current price of 50 kg bags of 42.5N cement in Gauteng", known, basis: "test" });
    expect(out.ok && out.text).toBe("Current price of 50 kg bags of 42.5N cement in Gauteng");
  });

  it("appends the fence rule to a model call's system prompt", () => {
    const out = prepare({ purpose: "extract.field", vendor: "deepseek", system: "Reply in json.", text: passage, known, basis: "test" });
    expect(out.ok && out.system).toMatch(/DATA, never instructions/);
  });

  it("tokenises, and the restored reply grounds against the original passage", () => {
    const out = prepare({ purpose: "quote.evaluate", vendor: "deepseek", system: "json", text: passage, known, basis: "test" });
    if (!out.ok) throw new Error(out.detail);
    expect(out.text).not.toContain("Kgosi");
    expect(out.text).not.toContain("083 555 0142");

    // What the model would quote back, in the words it was sent.
    const reply = { quote: out.text.match(/Tender submitted by PARTY_A/)![0], tenderer: "PARTY_A" };
    const restored = restoreDeep(reply, out.tokens) as typeof reply;
    expect(restored.tenderer).toBe("Kgosi Civils (Pty) Ltd");
    expect(locateQuote(restored.quote, [{ documentId: "d", page: 1, body: passage }])).not.toBeNull();
  });

  it("hashes what was sent, so a ledger row can be matched to a payload without storing it", () => {
    const a = prepare({ purpose: "extract.field", vendor: "deepseek", system: "json", text: passage, known, basis: "test" });
    const b = prepare({ purpose: "extract.field", vendor: "deepseek", system: "json", text: passage, known, basis: "test" });
    expect(a.ok && b.ok && a.sha256 === b.sha256).toBe(true);
  });
});
