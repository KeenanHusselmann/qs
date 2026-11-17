import { describe, expect, it } from "vitest";

import { ADHOC_MODULES, dueLine, inAdhocScope } from "./adhoc";
import { PROJECT_NAV } from "./navigation";

describe("an ad hoc request's modules", () => {
  it("are the request, its inputs and the take-off", () => {
    for (const m of ["", "/corpus", "/take-off"]) expect(inAdhocScope(m)).toBe(true);
  });

  it("are none of the service chain", () => {
    for (const m of ["/feasibility", "/bill", "/valuations", "/tender", "/settings"]) expect(inAdhocScope(m)).toBe(false);
  });

  it("all exist, built, in the project navigation – a typo here would be a missing page", () => {
    const built = new Set(PROJECT_NAV.flatMap((g) => g.items).filter((i) => i.built).map((i) => i.href));
    for (const m of ADHOC_MODULES) expect(built.has(m)).toBe(true);
  });
});

describe("dueLine", () => {
  it("is nothing without a date", () => expect(dueLine(null, "2026-11-12")).toBeNull());
  it("says today", () => expect(dueLine("2026-11-12", "2026-11-12")).toEqual({ text: "Due today", overdue: false }));
  it("names a later date", () => expect(dueLine("2026-11-14", "2026-11-12")?.overdue).toBe(false));
  it("says overdue, and from when", () => {
    const line = dueLine("2026-11-10", "2026-11-12");
    expect(line?.overdue).toBe(true);
    expect(line?.text).toMatch(/^Overdue since/);
  });
});
