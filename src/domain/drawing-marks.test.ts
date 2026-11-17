import { describe, expect, it } from "vitest";

import { calibrate, measureMark, metresPerUnitAtScale, polygonArea, polylineLength, readMark, PDF_POINT_METRES } from "./drawing-marks";

const DOC = "0b6c3a2e-7f4d-4c1a-9a8e-2b1f3c4d5e6f";

describe("drawing marks", () => {
  it("a 1:100 sheet: 72 points of paper is 2,54 m on site", () => {
    const s = metresPerUnitAtScale(100);
    expect(measureMark({ kind: "length", points: [[0, 0], [72, 0]], metresPerUnit: s })).toBeCloseTo(2.54, 10);
  });

  it("measures a polyline end to end", () => {
    expect(polylineLength([[0, 0], [3, 4], [3, 10]])).toBe(11);
  });

  it("measures an outline's area whichever way round it was clicked", () => {
    const square: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(polygonArea(square)).toBe(100);
    expect(polygonArea([...square].reverse())).toBe(100);
  });

  it("scales area by the square of the scale", () => {
    const s = 0.01; // a point is a centimetre on site
    expect(measureMark({ kind: "area", points: [[0, 0], [500, 0], [500, 200], [0, 200]], metresPerUnit: s })).toBeCloseTo(10, 10);
  });

  it("counts the points of a count", () => {
    expect(measureMark({ kind: "count", points: [[1, 1], [2, 2], [3, 3]], metresPerUnit: 1 })).toBe(3);
  });

  it("calibrates from two points a known distance apart", () => {
    expect(calibrate([0, 0], [300, 400], 5)).toBeCloseTo(0.01, 12);
    expect(calibrate([1, 1], [1, 1], 5)).toBeNull();
  });

  it("refuses a mark that cannot be worked from", () => {
    const good = { documentId: DOC, page: 1, kind: "length", points: [[0, 0], [10, 0]], metresPerUnit: PDF_POINT_METRES * 100 };
    expect(readMark(good).ok).toBe(true);
    expect(readMark({ ...good, metresPerUnit: 0 }).ok).toBe(false);
    expect(readMark({ ...good, points: [[0, 0]] }).ok).toBe(false);
    expect(readMark({ ...good, kind: "area" }).ok).toBe(false);
    expect(readMark({ ...good, points: [[0, Number.NaN], [1, 1]] }).ok).toBe(false);
    expect(readMark({ ...good, documentId: "x" }).ok).toBe(false);
  });
});
