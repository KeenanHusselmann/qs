import { describe, expect, it } from "vitest";

import {
  ASSUMPTION_SPECS,
  DEFAULT_ASSUMPTIONS,
  fromInput,
  showAssumption,
  toInput,
} from "./assumption-set";

const spec = (key: string) => ASSUMPTION_SPECS.find((s) => s.key === key)!;

describe("what a person types, and what is stored", () => {
  it("takes a percentage in the unit a QS thinks in", () => {
    // Nobody types 0,1175 for prime. They type 11,75.
    expect(fromInput(spec("primeRatePa"), "11.75")).toBeCloseTo(0.1175, 6);
    expect(toInput(spec("primeRatePa"), 0.1175)).toBe("11.75");
  });

  it("takes a comma decimal, because that is how the platform writes them", () => {
    // Every figure on this platform reads "11,75%". A field refusing what it prints is a trap.
    expect(fromInput(spec("primeRatePa"), "11,75")).toBeCloseTo(0.1175, 6);
  });

  it("leaves counts alone", () => {
    expect(fromInput(spec("bondTermYears"), "20")).toBe(20);
    expect(fromInput(spec("preDevelopmentMonths"), "6")).toBe(6);
  });

  it("round-trips every default", () => {
    for (const s of ASSUMPTION_SPECS) {
      const stored = DEFAULT_ASSUMPTIONS[s.key];
      expect(fromInput(s, toInput(s, stored))).toBeCloseTo(stored, 6);
    }
  });
});

describe("the guard against a decimal in the wrong place", () => {
  it("refuses a prime rate of 1175%", () => {
    /*
      The error this exists for. A rate a hundred times too large fails nothing: it produces an
      affordability ceiling near zero, every scheme fails Gate 1, and the report is confident and
      wrong. Nothing downstream would catch it, because a low ceiling is a legitimate answer.
    */
    expect(fromInput(spec("primeRatePa"), "1175")).toBeNull();
  });

  it("refuses a rate of nothing", () => {
    expect(fromInput(spec("primeRatePa"), "0")).toBeNull();
  });

  it("refuses what is not a number at all", () => {
    for (const junk of ["", "  ", "prime", "11.75%", "1e400"]) {
      expect(fromInput(spec("primeRatePa"), junk)).toBeNull();
    }
  });

  it("keeps the bands wide, because this is not a judgement about the practice", () => {
    // 2% and 35% are both defensible in some market. The guard catches keystrokes, not policy.
    expect(fromInput(spec("primeRatePa"), "2")).toBeCloseTo(0.02, 6);
    expect(fromInput(spec("primeRatePa"), "35")).toBeCloseTo(0.35, 6);
  });

  it("bounds every setting, so none is unguarded", () => {
    for (const s of ASSUMPTION_SPECS) {
      expect(s.max).toBeGreaterThan(s.min);
      expect(fromInput(s, String(s.unit === "percent" ? s.max * 100 + 1 : s.max + 1))).toBeNull();
    }
  });
});

describe("how a value reads on screen", () => {
  it("writes a rate the platform's way", () => {
    // Comma decimal, §7.7 — the same figure appears on the report beside signed money.
    expect(showAssumption(spec("primeRatePa"), 0.1175)).toBe("11,75%");
  });

  it("carries the unit, so a bare number is never ambiguous", () => {
    expect(showAssumption(spec("bondTermYears"), 20)).toBe("20 years");
    expect(showAssumption(spec("preDevelopmentMonths"), 6)).toBe("6 months");
  });
});

describe("every setting says what it moves", () => {
  it("because nine unexplained numbers invite an idle edit", () => {
    /*
      These set an affordability ceiling, pass or fail six gates, and print a verdict on a client's
      report. A settings page that listed them without saying so would be a control panel nobody
      should be handed.
    */
    for (const s of ASSUMPTION_SPECS) {
      expect(s.moves.length).toBeGreaterThan(40);
      expect(s.label.length).toBeGreaterThan(3);
    }
  });

  it("covers every figure the engines take", () => {
    // A default with no spec is a figure nobody can change and nobody can see.
    const specced = new Set(ASSUMPTION_SPECS.map((s) => s.key));
    for (const key of Object.keys(DEFAULT_ASSUMPTIONS)) expect(specced.has(key as never)).toBe(true);
  });
});
