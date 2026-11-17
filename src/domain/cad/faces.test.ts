import { describe, expect, it } from "vitest";

import type { Entity } from "./dxf";
import { networkFaces } from "./faces";

const line = (x1: number, y1: number, x2: number, y2: number, handle: string): Entity => ({ kind: "line", handle, layer: "B", start: { x: x1, y: y1 }, end: { x: x2, y: y2 } });
const areas = (entities: Entity[], tol = 0.01) =>
  networkFaces(entities, "B", { tolerance: tol })
    .faces.map((f) => Math.round(f.area * 1e6) / 1e6)
    .sort((a, b) => a - b);

describe("regions of a line network – erven that share their boundaries", () => {
  it("finds two erven either side of a shared boundary, and not the outside", () => {
    // A 20 × 10 rectangle split down the middle: one line bounds both erven.
    const net = [line(0, 0, 20, 0, "S"), line(20, 0, 20, 10, "E"), line(20, 10, 0, 10, "N"), line(0, 10, 0, 0, "W"), line(10, 0, 10, 10, "MID")];
    expect(areas(net)).toEqual([100, 100]);
    const faces = networkFaces(net, "B", { tolerance: 0.01 }).faces;
    for (const f of faces) expect(f.handles).toContain("MID");
  });

  it("splits lines where they cross: a # of four lines over a frame gives nine regions", () => {
    const net = [
      line(0, 0, 30, 0, "f1"),
      line(30, 0, 30, 30, "f2"),
      line(30, 30, 0, 30, "f3"),
      line(0, 30, 0, 0, "f4"),
      line(10, -1, 10, 31, "v1"),
      line(20, -1, 20, 31, "v2"),
      line(-1, 10, 31, 10, "h1"),
      line(-1, 20, 31, 20, "h2"),
    ];
    expect(areas(net)).toEqual(Array(9).fill(100));
  });

  it("closes a T-junction drawn a hair short, within the snap tolerance", () => {
    const net = [line(0, 0, 20, 0, "S"), line(20, 0, 20, 10, "E"), line(20, 10, 0, 10, "N"), line(0, 10, 0, 0, "W"), line(10, 0.004, 10, 9.996, "MID")];
    expect(areas(net, 0.01)).toEqual([100, 100]);
  });

  it("ignores dead ends – a line that stops inside an erf bounds nothing", () => {
    const net = [line(0, 0, 10, 0, "S"), line(10, 0, 10, 10, "E"), line(10, 10, 0, 10, "N"), line(0, 10, 0, 0, "W"), line(5, 0, 5, 6, "STUB")];
    const faces = networkFaces(net, "B", { tolerance: 0.01 }).faces;
    expect(faces.map((f) => f.area)).toEqual([100]);
    expect(faces[0]!.handles).not.toContain("STUB");
  });

  it("reads a closed polyline as part of the network too", () => {
    const net: Entity[] = [
      { kind: "polyline", handle: "P", layer: "B", closed: true, vertices: [{ x: 0, y: 0, bulge: 0 }, { x: 10, y: 0, bulge: 0 }, { x: 10, y: 10, bulge: 0 }, { x: 0, y: 10, bulge: 0 }] },
      line(0, 5, 10, 5, "SPLIT"),
    ];
    expect(areas(net)).toEqual([50, 50]);
  });

  it("refuses a network over its budget rather than hanging on it", () => {
    const many = Array.from({ length: 50 }, (_, i) => line(i, 0, i, 1, `L${i}`));
    expect(networkFaces(many, "B", { tolerance: 0.01, maxSegments: 10 }).truncated).toMatch(/more than 10/);
  });
});
