import { describe, expect, it } from "vitest";

import { chooseScale, DRAW, pdfPageToDrawing, statedScales, type PdfOpCodes, type PdfTextItem } from "./pdf-geometry";
import { readDrawing } from "./read-drawing";

// Codes as unpdf 1.8's pdf.js numbers them; the adapter takes them as input, so any numbering works.
const OPS: PdfOpCodes = {
  save: 10,
  restore: 11,
  transform: 12,
  setLineWidth: 2,
  constructPath: 91,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  setStrokeRGBColor: 58,
  setFillRGBColor: 59,
  stroke: 20,
  closeStroke: 21,
  fill: 22,
  eoFill: 23,
  fillStroke: 24,
  eoFillStroke: 25,
  closeFillStroke: 26,
  closeEOFillStroke: 27,
  endPath: 28,
};

/** A page as an operator list: [code, args] pairs. */
const page = (...ops: [number, unknown[]][]) => ({ fnArray: ops.map((o) => o[0]), argsArray: ops.map((o) => o[1]) });
const path = (paint: number, ...data: number[]): [number, unknown[]] => [OPS.constructPath, [paint, [new Float32Array(data)], null]];
/** A rectangle in points, closed. */
const rectPts = (x: number, y: number, w: number, h: number) => [DRAW.moveTo, x, y, DRAW.lineTo, x + w, y, DRAW.lineTo, x + w, y + h, DRAW.lineTo, x, y + h, DRAW.closePath];
const mmToPt = 72 / 25.4;

describe("reading geometry out of a plotted PDF", () => {
  it("turns a closed path into an outline at its real size: 80 × 40 mm on paper at 1:100 is 8 × 4 m = 32 m²", () => {
    const ops = page([OPS.setStrokeRGBColor, ["#000000"]], [OPS.setLineWidth, [0.5]], path(OPS.stroke, ...rectPts(10, 10, 80 * mmToPt, 40 * mmToPt)));
    const { drawing } = pdfPageToDrawing(ops, OPS, [], { scale: 100, page: 1 });
    const r = readDrawing(drawing);
    expect(r.units.name).toBe("millimetres");
    expect(r.loops).toEqual([expect.objectContaining({ area: 32, perimeter: 24, layer: "stroke #000000 0.50pt" })]);
  });

  it("applies the current transform, including a form XObject's matrix, and undoes it on restore", () => {
    const ops = page(
      [OPS.save, []],
      [OPS.transform, [2, 0, 0, 2, 0, 0]], // everything after is doubled…
      [OPS.paintFormXObjectBegin, [[1, 0, 0, 1, 100, 0], null]], // …and moved
      path(OPS.fill, ...rectPts(0, 0, 10 * mmToPt, 10 * mmToPt)),
      [OPS.paintFormXObjectEnd, []],
      [OPS.restore, []],
      path(OPS.fill, ...rectPts(0, 0, 10 * mmToPt, 10 * mmToPt)), // back to identity
    );
    const { drawing } = pdfPageToDrawing(ops, OPS, [], { scale: 1, page: 1 });
    const areas = readDrawing(drawing).loops.map((l) => l.area).sort();
    // 20 × 20 mm doubled = 400 mm² = 0.0004 m²; 10 × 10 mm = 0.0001 m².
    expect(areas).toEqual([0.0001, 0.0004]);
  });

  it("names each path's layer for its pen – stroke colour and weight, or fill colour", () => {
    const ops = page(
      [OPS.setStrokeRGBColor, ["#B4A35C"]],
      [OPS.setLineWidth, [0.6]],
      path(OPS.stroke, DRAW.moveTo, 0, 0, DRAW.lineTo, 100, 0),
      [OPS.setFillRGBColor, ["#8dc63f"]],
      path(OPS.fill, ...rectPts(0, 0, 50, 50)),
    );
    const { drawing } = pdfPageToDrawing(ops, OPS, [], { scale: 1, page: 1 });
    expect(drawing.layers).toEqual(["fill #8dc63f", "stroke #b4a35c 0.60pt", "text"]);
  });

  it("closes a filled path even without closePath – a fill is a region", () => {
    const ops = page(path(OPS.fill, DRAW.moveTo, 0, 0, DRAW.lineTo, 100, 0, DRAW.lineTo, 100, 100, DRAW.lineTo, 0, 100));
    const { stats } = pdfPageToDrawing(ops, OPS, [], { scale: 1, page: 1 });
    expect(stats.closed).toBe(1);
  });

  it("leaves out clipping paths and specks, and counts both", () => {
    const ops = page(path(OPS.endPath, ...rectPts(0, 0, 500, 500)), path(OPS.stroke, DRAW.moveTo, 0, 0, DRAW.lineTo, 0.1, 0.1));
    const { drawing, stats } = pdfPageToDrawing(ops, OPS, [], { scale: 1, page: 1 });
    expect(drawing.entities).toHaveLength(0);
    expect(stats).toMatchObject({ unpainted: 1, specks: 1 });
  });

  it("flattens a curve close to the true arc, and marks it as curved", () => {
    // A quarter circle of radius 100 pt as the usual cubic (k ≈ 0.5523), closed back through the centre.
    const k = 0.5523 * 100;
    const ops = page(path(OPS.fill, DRAW.moveTo, 0, 0, DRAW.lineTo, 100, 0, DRAW.curveTo, 100, k, k, 100, 0, 100, DRAW.closePath));
    // At 1:1000, so the area is hundreds of m² and the four-place rounding of the report is negligible.
    const { drawing, curvedHandles } = pdfPageToDrawing(ops, OPS, [], { scale: 1000, page: 1, curveSteps: 32 });
    const r = readDrawing(drawing);
    const truePt2 = (Math.PI * 100 * 100) / 4;
    const mmPerPt = (25.4 / 72) * 1000;
    const measuredPt2 = (r.loops[0]!.area! * 1e6) / mmPerPt ** 2;
    expect(Math.abs(measuredPt2 - truePt2) / truePt2).toBeLessThan(0.002);
    expect(curvedHandles.size).toBe(1);
  });

  it("refuses a path format it does not know rather than misreading it", () => {
    expect(() => pdfPageToDrawing(page(path(OPS.stroke, 9, 0, 0)), OPS, [], { scale: 1, page: 1 })).toThrow(/format has changed/);
  });

  it("ignores a malformed transform instead of turning every coordinate into NaN", () => {
    const ops = page([OPS.transform, ["x", 0, 0, 1, 0, 0]], path(OPS.fill, ...rectPts(0, 0, 10 * mmToPt, 10 * mmToPt)));
    expect(readDrawing(pdfPageToDrawing(ops, OPS, [], { scale: 1, page: 1 }).drawing).loops[0]!.area).toBe(0.0001);
  });

  it("places text in the same space, so a label can be checked against the outline it sits in", () => {
    // 160 × 200 mm on paper at 1:1000 is 160 × 200 m = 3,2 ha.
    const texts: PdfTextItem[] = [{ str: "ERF 1 3.20 Ha", transform: [10, 0, 0, 10, 50, 50], height: 10 }];
    const ops = page(path(OPS.stroke, ...rectPts(0, 0, 160 * mmToPt, 200 * mmToPt)));
    const r = readDrawing(pdfPageToDrawing(ops, OPS, texts, { scale: 1000, page: 1 }).drawing);
    expect(r.areaChecks).toEqual([expect.objectContaining({ stated: 32_000, agrees: true })]);
    // pdf.js stores coordinates as 32-bit floats, so the area is 32 000 to within a fraction of a cm².
    expect(r.areaChecks[0]!.computed).toBeCloseTo(32_000, 2);
  });
});

describe("the scale, read from the sheet and never assumed", () => {
  it("finds scales as printed, and not slopes", () => {
    expect(statedScales([{ str: "SITE DEVELOPMENT PLAN 1:1250", transform: [] }, { str: "SCALE 1 : 3000", transform: [] }])).toEqual([1250, 3000]);
    expect(chooseScale(statedScales([{ str: "BATTER 1:3 MAX", transform: [] }, { str: "PLAN 1:500", transform: [] }]))).toMatchObject({ scale: 500 });
  });

  it("withholds the scale when the sheet prints two, or none", () => {
    expect(chooseScale([1250, 3000])).toMatchObject({ scale: null, reason: expect.stringMatching(/more than one scale/) });
    expect(chooseScale([])).toMatchObject({ scale: null, reason: expect.stringMatching(/prints no scale/) });
  });

  it("leaves areas unmeasured without a scale", () => {
    const { drawing } = pdfPageToDrawing(page(path(OPS.fill, ...rectPts(0, 0, 100, 100))), OPS, [], { scale: null, page: 1 });
    expect(readDrawing(drawing).loops[0]!.area).toBeNull();
  });
});
