/**
 * What a read activity becomes – no model needed to prove it.
 */

import { describe, expect, it } from "vitest";

import { freshActivities, readActivity, withoutDuplicateActivities } from "./extract-activities";
import type { ActivityResult } from "./programme";

const raw = (over: Partial<Parameters<typeof readActivity>[0]> = {}) => ({
  ref: "1.2",
  name: "Brickwork to Block A",
  start: "Mon 12/08/26",
  finish: "Fri 26/09/26",
  milestone: false,
  quote: "1.2 Brickwork to Block A Mon 12/08/26 Fri 26/09/26",
  confidence: 0.9,
  ...over,
});

describe("reading one activity", () => {
  it("reads MS Project's dates day first, and keeps the document's words", () => {
    const read = readActivity(raw(), null);
    expect(read.start).toBe("2026-08-12");
    expect(read.finish).toBe("2026-09-26");
    expect(read.startText).toBe("Mon 12/08/26");
    expect(read.note).toBeNull();
  });

  it("leaves a date it cannot read empty, with the reason, rather than guessing", () => {
    const read = readActivity(raw({ finish: "wk 14" }), null);
    expect(read.start).toBe("2026-08-12");
    expect(read.finish).toBeNull();
    expect(read.finishText).toBe("wk 14");
    expect(read.note).toMatch(/Finish not read/);
  });

  it("gives a milestone its one date at both ends", () => {
    const read = readActivity(raw({ name: "Practical completion", start: "30 Apr 2027", finish: null, milestone: true }), null);
    expect(read.start).toBe("2027-04-30");
    expect(read.finish).toBe("2027-04-30");
  });

  it("refuses both dates when the finish precedes the start as printed", () => {
    const read = readActivity(raw({ start: "26/09/26", finish: "12/08/26" }), null);
    expect(read.start).toBeNull();
    expect(read.finish).toBeNull();
    expect(read.note).toMatch(/before it starts/);
  });

  it("flags a low-confidence reading for a person", () => {
    expect(readActivity(raw({ confidence: 0.4 }), null).note).toMatch(/Check it before signing/);
  });
});

describe("the same activity twice", () => {
  const a: ActivityResult = readActivity(raw(), null);
  const b: ActivityResult = readActivity(raw({ quote: "different overlap" }), null);
  const c: ActivityResult = readActivity(raw({ ref: "1.3", name: "Roof" }), null);

  it("keeps one of two readings of the same ref and name", () => {
    expect(withoutDuplicateActivities([a, b, c])).toHaveLength(2);
  });

  it("and reports only the fresh rows of a batch", () => {
    expect(freshActivities([a], [b, c])).toEqual([c]);
  });
});
