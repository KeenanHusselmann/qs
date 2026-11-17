/**
 * Which absence a dead address is — the only thing the not-found page decides.
 *
 * "Not built yet" and "does not exist" send a reader different places: one is a gap in the platform,
 * the other a stale link. Getting it backwards tells somebody they mistyped a menu item.
 */

import { describe, expect, it } from "vitest";

import { readMissing } from "./not-found-panel";

const id = "d9058f92-170f-4001-8d63-c479c28097bd";

describe("reading a dead address", () => {
  /*
    Approvals and the Repetition Designer were listed as "not built" until the simplification of
    16 Nov 2026 removed them from the menu. An old link to either is now a plain dead address, and
    must not be announced as something still coming.
  */
  it("treats a removed page as gone, not as coming", () => {
    expect(readMissing("/approvals")).toEqual({ projectId: null, unbuilt: null });
  });

  it("treats a removed step as gone, and keeps the project", () => {
    expect(readMissing(`/projects/${id}/repetition`)).toEqual({ projectId: id, unbuilt: null });
    expect(readMissing(`/projects/${id}/programme`)).toEqual({ projectId: id, unbuilt: null });
  });

  it("keeps the project for a step that simply does not exist", () => {
    expect(readMissing(`/projects/${id}/nonsense`)).toEqual({ projectId: id, unbuilt: null });
  });

  it("does not call a built page unbuilt", () => {
    expect(readMissing("/rates").unbuilt).toBeNull();
    expect(readMissing(`/projects/${id}/bill`).unbuilt).toBeNull();
  });

  it("treats a typo as a typo", () => {
    expect(readMissing("/rates-typo")).toEqual({ projectId: null, unbuilt: null });
  });
});
