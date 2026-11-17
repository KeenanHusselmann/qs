/**
 * Project management items – reading a form, and the arithmetic the board and timeline rely on.
 */

import { describe, expect, it } from "vitest";

import { addDays, isOverdue, rankBetween, readItemInput, riskRating, timelineWindow } from "./items";

const MODULES = ["/feasibility", "/bill"];
const CONTACT = "0b8c8f7e-5e0c-4a53-9d2b-0f4c2a1e9a11";

describe("reading an item", () => {
  it("accepts a plain task with defaults", () => {
    const read = readItemInput({ type: "task", title: "  Chase the geotech report " }, MODULES);
    expect(read).toMatchObject({ ok: true, item: { title: "Chase the geotech report", status: "todo", priority: "medium", details: {} } });
  });

  it("says every field that is wrong at once", () => {
    const read = readItemInput(
      { type: "rfi", title: "", status: "somewhere", startDate: "2026-10-10", dueDate: "2026-10-01", module: "/nowhere" },
      MODULES,
    );
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(Object.keys(read.errors).sort()).toEqual(["details.question", "dueDate", "module", "status", "title"].sort());
    }
  });

  it("assigns to a person or a contact, never both", () => {
    const person = readItemInput({ type: "task", title: "x", assignee: "user:Thandi@Mzilikazi.co.za" }, MODULES);
    const contact = readItemInput({ type: "task", title: "x", assignee: `contact:${CONTACT}` }, MODULES);
    expect(person).toMatchObject({ ok: true, item: { assigneeEmail: "thandi@mzilikazi.co.za", assigneeContactId: null } });
    expect(contact).toMatchObject({ ok: true, item: { assigneeEmail: null, assigneeContactId: CONTACT } });
    expect(readItemInput({ type: "task", title: "x", assignee: "somebody" }, MODULES).ok).toBe(false);
  });

  it("keeps only the details the kind declares, and checks their choices", () => {
    const risk = readItemInput(
      { type: "risk", title: "Bulk water late", details: { likelihood: "high", impact: "medium", colour: "red" } },
      MODULES,
    );
    expect(risk).toMatchObject({ ok: true, item: { details: { likelihood: "high", impact: "medium" } } });
    expect(readItemInput({ type: "risk", title: "x", details: { likelihood: "very", impact: "low" } }, MODULES).ok).toBe(false);
  });
});

describe("the arithmetic", () => {
  it("rates a risk by likelihood and impact", () => {
    expect(riskRating({ likelihood: "high", impact: "high" })).toBe("high");
    expect(riskRating({ likelihood: "low", impact: "high" })).toBe("medium");
    expect(riskRating({ likelihood: "low", impact: "low" })).toBe("low");
    expect(riskRating({})).toBeNull();
  });

  it("drops a card between two others at the midpoint, and at either end past them", () => {
    expect(rankBetween(1, 2)).toBe(1.5);
    expect(rankBetween(null, 2)).toBe(1);
    expect(rankBetween(2, null)).toBe(3);
    expect(rankBetween(null, null)).toBe(0);
  });

  it("calls an open item overdue after its due date, never a done one", () => {
    expect(isOverdue({ status: "todo", dueDate: "2026-09-01" }, "2026-09-16")).toBe(true);
    expect(isOverdue({ status: "done", dueDate: "2026-09-01" }, "2026-09-16")).toBe(false);
    expect(isOverdue({ status: "todo", dueDate: "2026-09-16" }, "2026-09-16")).toBe(false);
  });

  it("draws a timeline from a Monday, at least four weeks wide", () => {
    const window = timelineWindow([{ startDate: "2026-09-17", dueDate: "2026-09-18" }], "2026-09-16");
    expect(window.from).toBe("2026-09-14"); // the Monday of that week
    expect(window.weeks).toBe(4);
    expect(window.to).toBe(addDays("2026-09-14", 27));
  });
});
