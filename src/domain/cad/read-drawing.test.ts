import { describe, expect, it } from "vitest";

import { DxfUnreadable, parseDxf, plainText } from "./dxf";
import { findLoops, loopArea, signedArea } from "./geometry";
import { readDrawing, statedArea } from "./read-drawing";
import { renderSvg } from "./render";
import { rect, writeDxf, type DxfShape } from "./write-dxf";

const MM = 4;
const read = (entities: DxfShape[], extra: Partial<Parameters<typeof writeDxf>[0]> = {}) =>
  readDrawing(parseDxf(writeDxf({ insunits: MM, entities, ...extra })));

describe("reading the file", () => {
  it("refuses a binary DXF with what to do about it", () => {
    expect(() => parseDxf("AutoCAD Binary DXF\r\n\u001a\u0000")).toThrow(DxfUnreadable);
    expect(() => parseDxf("AutoCAD Binary DXF\r\n")).toThrow(/ASCII DXF/);
  });

  it("refuses something that is not a DXF at all", () => {
    expect(() => parseDxf("hello\nworld\n")).toThrow(DxfUnreadable);
  });

  it("reads Windows line endings, padded group codes and a byte-order mark", () => {
    const text = "﻿" + writeDxf({ insunits: MM, entities: [rect("A-WALL", 0, 0, 1000, 1000)] }).replace(/\n/g, "\r\n");
    const d = parseDxf(text);
    expect(d.insunits).toBe(4);
    expect(d.entities).toHaveLength(1);
  });

  it("counts what it does not read rather than dropping it", () => {
    const d = parseDxf(
      writeDxf({
        insunits: MM,
        entities: [
          { type: "RAW", lines: [0, "HATCH", 8, "A-HATCH"] },
          { type: "RAW", lines: [0, "HATCH", 8, "A-HATCH"] },
          { type: "RAW", lines: [0, "SPLINE", 8, "A-WALL"] },
        ],
      }),
    );
    expect(d.skipped).toEqual({ HATCH: 2, SPLINE: 1 });
  });

  it("leaves paper space out, and says so", () => {
    const d = parseDxf(writeDxf({ insunits: MM, entities: [{ type: "RAW", lines: [0, "LINE", 67, 1, 8, "0", 10, 0, 20, 0, 11, 1, 21, 1] }] }));
    expect(d.entities).toHaveLength(0);
    expect(d.notes.join(" ")).toMatch(/paper space/);
  });

  it("reads the old POLYLINE form, VERTEX records and all", () => {
    const d = parseDxf(writeDxf({ insunits: MM, entities: [{ type: "POLYLINE", layer: "A", closed: true, points: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]] }] }));
    const r = readDrawing(d);
    expect(r.loops[0]!.area).toBe(12);
  });
});

describe("text as a person reads it", () => {
  it("unpicks MTEXT formatting and unicode escapes", () => {
    expect(plainText("{\\fArial|b1;BEDROOM}\\P12,0 m\\U+00B2")).toBe("BEDROOM\n12,0 m²");
    expect(plainText("%%c50 BAR @ 200%%%")).toBe("⌀50 BAR @ 200%");
  });

  it("finds one printed area, in South African or plain form", () => {
    expect(statedArea("BEDROOM 12,5 m²")).toEqual({ value: 12.5, printed: "12,5", perUnit: 1 });
    expect(statedArea("GFA 1 234,5m2")).toEqual({ value: 1234.5, printed: "1 234,5", perUnit: 1 });
    expect(statedArea("STORE 6 sqm")).toEqual({ value: 6, printed: "6", perUnit: 1 });
  });

  it("reads hectares, as site development plans print erf areas, into m²", () => {
    expect(statedArea("1.89 Ha")).toEqual({ value: 18_900, printed: "1.89", perUnit: 10_000 });
    expect(statedArea("ERF 102 CONS. 9.37 Ha")).toMatchObject({ value: 93_700 });
  });

  it("does not read an erf's zoning digit into its area – 'G.R.4 1.89 Ha' is 1,89 ha, not 41,89", () => {
    expect(statedArea("ERF 101 G.R.4 1.89 Ha")).toEqual({ value: 18_900, printed: "1.89", perUnit: 10_000 });
    // A space groups thousands only before exactly three digits.
    expect(statedArea("4 1.89 Ha")!.value).toBe(18_900);
  });

  it("will not choose between two areas, or guess an ambiguous one", () => {
    expect(statedArea("12 m² + 4 m²")).toBeNull();
    expect(statedArea("UNIT 1,250 m²")).toEqual({ value: null, printed: "1,250", perUnit: 1 });
    expect(statedArea("BEDROOM 2")).toBeNull();
  });
});

describe("areas – each against a figure worked by hand", () => {
  it("a 10 × 5 m rectangle drawn in millimetres is 50 m², 30 m round", () => {
    const r = read([rect("A-FOOTPRINT", 0, 0, 10_000, 5_000, "2A1")]);
    expect(r.units).toMatchObject({ name: "millimetres", statedBy: "drawing" });
    expect(r.loops).toEqual([expect.objectContaining({ id: "L1", layer: "A-FOOTPRINT", handles: ["2A1"], area: 50, perimeter: 30, net: 50, source: "polyline" })]);
  });

  it("is the same whichever way round the outline was drawn", () => {
    const ccw = [{ x: 0, y: 0, bulge: 0 }, { x: 2, y: 0, bulge: 0 }, { x: 2, y: 1, bulge: 0 }, { x: 0, y: 1, bulge: 0 }];
    expect(signedArea(ccw)).toBe(2);
    expect(signedArea([...ccw].reverse())).toBe(-2);
  });

  it("adds a curved segment exactly: a 2 × 1 m room with a semicircular bay is 2 + π/2 m²", () => {
    // Bottom edge bulges outward. Anticlockwise ring, so a positive bulge turns outward.
    const r = read([{ type: "LWPOLYLINE", layer: "A-ROOM", closed: true, points: [[0, 0, 1], [2000, 0], [2000, 1000], [0, 1000]] }]);
    expect(r.loops[0]!.area).toBe(Math.round((2 + Math.PI / 2) * 1e4) / 1e4);
    // Perimeter: three straight sides (1 + 2 + 1) and a half circle of radius 1.
    expect(r.loops[0]!.perimeter).toBe(Math.round((4 + Math.PI) * 1e4) / 1e4);
  });

  it("takes a curved segment away when it bulges inward", () => {
    const r = read([{ type: "LWPOLYLINE", layer: "A-ROOM", closed: true, points: [[0, 0, -1], [2000, 0], [2000, 1000], [0, 1000]] }]);
    expect(r.loops[0]!.area).toBe(Math.round((2 - Math.PI / 2) * 1e4) / 1e4);
  });

  it("a circle of radius 3 m is 9π m²", () => {
    const r = read([{ type: "CIRCLE", layer: "A-TANK", center: [5000, 5000], radius: 3000 }]);
    expect(r.loops[0]!.area).toBe(Math.round(9 * Math.PI * 1e4) / 1e4);
  });

  it("takes a courtyard off the building around it", () => {
    const r = read([rect("A-FOOTPRINT", 0, 0, 20_000, 20_000, "OUT"), rect("A-FOOTPRINT", 7_500, 7_500, 5_000, 5_000, "IN")]);
    const outer = r.loops.find((l) => l.handles[0] === "OUT")!;
    const inner = r.loops.find((l) => l.handles[0] === "IN")!;
    expect(outer).toMatchObject({ area: 400, net: 375, holes: [inner.id], inside: null });
    expect(inner).toMatchObject({ area: 25, inside: outer.id });
  });

  it("does not take a loop on another layer off – a room is not a hole in its building", () => {
    const r = read([rect("A-FOOTPRINT", 0, 0, 20_000, 20_000), rect("A-ROOM", 1_000, 1_000, 4_000, 3_000)]);
    expect(r.loops.find((l) => l.layer === "A-FOOTPRINT")!.net).toBe(400);
  });
});

describe("loops drawn as loose lines", () => {
  const room = (jitter = 0): DxfShape[] => [
    { type: "LINE", layer: "A-WALL", handle: "1", from: [0, 0], to: [6000, 0] },
    // Drawn the other way round, as walls often are.
    { type: "LINE", layer: "A-WALL", handle: "2", from: [6000, 4000], to: [6000, 0] },
    { type: "LINE", layer: "A-WALL", handle: "3", from: [6000, 4000], to: [0, 4000] },
    { type: "LINE", layer: "A-WALL", handle: "4", from: [0, 4000 - jitter], to: [0, 0] },
  ];

  it("joins four lines that meet into a 6 × 4 m room of 24 m²", () => {
    const r = read(room());
    expect(r.loops).toEqual([expect.objectContaining({ source: "chain", area: 24, perimeter: 20 })]);
    expect([...r.loops[0]!.handles].sort()).toEqual(["1", "2", "3", "4"]);
  });

  it("snaps a hairline gap under a millimetre, and no more", () => {
    expect(read(room(0.4)).loops).toHaveLength(1);
    const r = read(room(5));
    expect(r.loops).toHaveLength(0);
    expect(r.open).toHaveLength(1);
    expect(r.open[0]!.gapMetres).toBeGreaterThan(0.004);
  });

  it("joins a line and an arc: a D-shaped room", () => {
    // Straight wall along the x axis, then a half circle back over the top: π·r²/2 with r = 2 m.
    const r = read([
      { type: "LINE", layer: "A-WALL", from: [-2000, 0], to: [2000, 0] },
      { type: "ARC", layer: "A-WALL", center: [0, 0], radius: 2000, start: 0, end: 180 },
    ]);
    expect(r.loops[0]!.area).toBe(Math.round(2 * Math.PI * 1e4) / 1e4);
  });

  it("will not measure a junction where three walls meet – which room is which is a judgement", () => {
    const r = read([...room(), { type: "LINE", layer: "A-WALL", handle: "5", from: [3000, 0], to: [3000, 4000] }]);
    // The partition's ends land mid-wall, not on a node, so the four outer walls still close.
    expect(r.loops).toHaveLength(1);
    const t = read([...room(), { type: "LINE", layer: "A-WALL", handle: "5", from: [0, 0], to: [-2000, 0] }]);
    expect(t.loops).toHaveLength(0);
    expect(t.junctions[0]).toMatchObject({ layer: "A-WALL", meeting: 3 });
  });

  it("keeps layers apart: walls on two layers do not make a room between them", () => {
    const parts = room();
    (parts[3] as { layer: string }).layer = "A-WALL-EXT";
    const r = read(parts);
    expect(r.loops).toHaveLength(0);
  });

  it("walks a reversed curved run the right way: area unchanged by drawing direction", () => {
    const d = parseDxf(
      writeDxf({
        insunits: MM,
        entities: [
          { type: "LWPOLYLINE", layer: "W", closed: false, points: [[0, 0, 1], [2000, 0], [2000, 1000]] },
          { type: "LWPOLYLINE", layer: "W", closed: false, points: [[0, 0], [0, 1000], [2000, 1000]] },
        ],
      }),
    );
    const { loops } = findLoops(d.entities, 1);
    expect(loops).toHaveLength(1);
    expect(loopArea(loops[0]!)).toBeCloseTo((2 + Math.PI / 2) * 1e6, 3);
  });
});

describe("units are read, never assumed", () => {
  it("gives no area where the drawing does not say what a unit is", () => {
    const r = readDrawing(parseDxf(writeDxf({ insunits: null, entities: [rect("A", 0, 0, 10, 5)] })));
    expect(r.units).toMatchObject({ statedBy: null, name: "not stated", metresPerUnit: null });
    expect(r.loops[0]!.area).toBeNull();
    expect(r.notes.join(" ")).toMatch(/State the units/);
  });

  it("measures once the caller states them, and says the caller did", () => {
    const r = readDrawing(parseDxf(writeDxf({ insunits: null, entities: [rect("A", 0, 0, 10, 5)] })), { units: "m" });
    expect(r.units.statedBy).toBe("caller");
    expect(r.loops[0]!.area).toBe(50);
  });

  it("refuses a units code it does not convert", () => {
    const r = read([rect("A", 0, 0, 10, 5)], { insunits: 9 });
    expect(r.units.metresPerUnit).toBeNull();
    expect(r.units.name).toMatch(/unsupported/);
  });
});

describe("the drawing's own cross-check – a printed area against the outline around it", () => {
  it("agrees within the rounding of the figure as printed", () => {
    const r = read([rect("A-ROOM", 0, 0, 4000, 3000, "R1"), { type: "TEXT", layer: "A-TEXT", handle: "T1", at: [500, 1500], height: 200, text: "BEDROOM 12,0 m²" }]);
    expect(r.areaChecks).toEqual([expect.objectContaining({ textHandle: "T1", stated: 12, computed: 12, agrees: true })]);
  });

  it("flags a schedule figure the geometry does not support, and by how much", () => {
    const r = read([rect("A-ROOM", 0, 0, 3000, 4500), { type: "MTEXT", layer: "A-TEXT", at: [500, 2000], height: 200, text: "LOUNGE\\P15,0m2" }]);
    expect(r.areaChecks[0]).toMatchObject({ stated: 15, computed: 13.5, difference: -1.5, agrees: false });
    expect(r.areaChecks[0]!.reason).toMatch(/less than printed by 1.5/);
  });

  it("checks against the smallest outline the label sits in, net of any courtyard", () => {
    const r = read([
      rect("A-FOOTPRINT", 0, 0, 20_000, 20_000),
      rect("A-FOOTPRINT", 7_500, 7_500, 5_000, 5_000),
      { type: "TEXT", layer: "A-TEXT", at: [2000, 2000], height: 300, text: "GFA 375 m²" },
    ]);
    expect(r.areaChecks[0]).toMatchObject({ computed: 375, agrees: true });
  });

  it("says so when a label sits in no outline", () => {
    const r = read([{ type: "TEXT", layer: "A-TEXT", at: [0, 0], height: 200, text: "SITE 900 m²" }]);
    expect(r.areaChecks[0]).toMatchObject({ agrees: null, reason: expect.stringMatching(/not inside/) });
  });
});

describe("blocks – a unit drawn once and inserted many times", () => {
  const unitA = { name: "UNIT-A", shapes: [rect("A-UNIT", 0, 0, 6000, 9000, "UA"), { type: "TEXT", layer: "A-TEXT", at: [1000, 4000], height: 300, text: "UNIT A 54,0 m²" }] as DxfShape[] };

  it("counts inserts and gives each a footprint from the block's outline", () => {
    const r = read(
      [
        { type: "INSERT", layer: "A-UNITS", handle: "I1", block: "UNIT-A", at: [0, 0] },
        { type: "INSERT", layer: "A-UNITS", handle: "I2", block: "UNIT-A", at: [6000, 0] },
        { type: "INSERT", layer: "A-UNITS", handle: "I3", block: "UNIT-A", at: [12000, 0] },
      ],
      { blocks: [unitA] },
    );
    expect(r.blocks).toEqual([expect.objectContaining({ name: "UNIT-A", inserts: 3, handles: ["I1", "I2", "I3"], footprint: 54, totalFootprint: 162 })]);
    // The label inside the block is checked against the block's own outline.
    expect(r.areaChecks[0]).toMatchObject({ block: "UNIT-A", stated: 54, computed: 54, agrees: true });
  });

  it("scales a footprint by the insert's scale", () => {
    const r = read([{ type: "INSERT", layer: "A-UNITS", block: "UNIT-A", at: [0, 0], scale: [2, 2] }], { blocks: [unitA] });
    expect(r.blocks[0]!.totalFootprint).toBe(216);
  });

  it("counts a block it cannot find, and says it was not measured", () => {
    const r = read([{ type: "INSERT", layer: "A-UNITS", block: "XREF-UNIT", at: [0, 0] }]);
    expect(r.blocks[0]).toMatchObject({ inserts: 1, footprint: null });
    expect(r.notes.join(" ")).toMatch(/XREF-UNIT/);
  });
});

describe("a hostile drawing – it must not hang, crash or lie", () => {
  it("reads a run of a hundred thousand digits without backtracking for minutes", () => {
    const started = performance.now();
    expect(statedArea("1".repeat(100_000) + " x")).toBeNull();
    expect(statedArea("9 ".repeat(50_000))).toBeNull();
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("drops a polyline whose coordinates are not finite numbers, and counts it", () => {
    const d = parseDxf(writeDxf({ insunits: MM, entities: [{ type: "RAW", lines: [0, "LWPOLYLINE", 8, "A", 70, 1, 10, "1e999", 20, 0, 10, 5, 20, 5, 10, 0, 20, 5] }] }));
    expect(d.entities).toHaveLength(0);
    expect(d.skipped).toEqual({ "LWPOLYLINE (unreadable coordinates)": 1 });
  });

  it("follows a chain of a hundred and fifty thousand lines without overflowing the stack", () => {
    const lines: DxfShape[] = Array.from({ length: 150_000 }, (_, i) => ({ type: "LINE", layer: "A-WALL", from: [i * 10, 0], to: [(i + 1) * 10, 0] }));
    const r = read(lines);
    expect(r.open).toHaveLength(1);
    expect(r.open[0]!.handles).toHaveLength(150_000);
  });

  it("stops drawing a nested-block bomb at its budget, and says so", () => {
    // Ten inserts of a block of ten inserts, eight deep: 10⁸ lines from a few kilobytes.
    const blocks = Array.from({ length: 8 }, (_, level) => ({
      name: `B${level}`,
      shapes: level === 7 ? [{ type: "LINE" as const, layer: "A", from: [0, 0] as [number, number], to: [1, 0] as [number, number] }] : Array.from({ length: 10 }, (_, k) => ({ type: "INSERT" as const, layer: "A", block: `B${level + 1}`, at: [k * 2, level] as [number, number] })),
    }));
    const d = parseDxf(writeDxf({ insunits: MM, blocks, entities: Array.from({ length: 10 }, (_, k) => ({ type: "INSERT" as const, layer: "A", block: "B0", at: [k * 100, 0] as [number, number] })) }));
    const started = performance.now();
    const { svg, notes } = renderSvg(d);
    expect(performance.now() - started).toBeLessThan(15_000);
    expect(notes.join(" ")).toMatch(/only the first/);
    expect(svg.startsWith("<svg")).toBe(true);
  });

  it("refuses a snap tolerance that would divide by nothing", () => {
    expect(() => findLoops([], 0)).toThrow(RangeError);
    expect(() => findLoops([], Number.NaN)).toThrow(RangeError);
  });
});

describe("the picture of the evidence", () => {
  it("draws what was measured, picked out, with y turned the right way up", () => {
    const d = parseDxf(writeDxf({ insunits: MM, entities: [rect("A", 0, 0, 1000, 500, "P1"), rect("A", 2000, 0, 1000, 500, "P2")] }));
    const { svg } = renderSvg(d, { highlight: ["P2"] });
    expect(svg.startsWith("<svg")).toBe(true);
    // One picked shape, filled; one plain.
    expect(svg.match(/stroke="#4a7722"/g)).toHaveLength(1);
    expect(svg).toContain("M2000 0L3000 0L3000 -500L2000 -500Z");
  });

  it("draws a block where it was inserted, offset by its base point", () => {
    const d = parseDxf(
      writeDxf({
        insunits: MM,
        blocks: [{ name: "B", base: [100, 100], shapes: [{ type: "LINE", layer: "A", from: [100, 100], to: [200, 100] }] }],
        entities: [{ type: "INSERT", layer: "A", block: "B", at: [5000, 0] }],
      }),
    );
    expect(renderSvg(d).svg).toContain("M5000 0L5100 0");
  });

  it("tags each shape with the handles that pick it, so a page can highlight without reading again", () => {
    const d = parseDxf(
      writeDxf({
        insunits: MM,
        blocks: [{ name: "B", shapes: [{ type: "LINE", layer: "A", handle: "L1", from: [0, 0], to: [100, 0] }] }],
        entities: [rect("A", 0, 0, 1000, 500, "P1"), { type: "INSERT", layer: "A", handle: "I9", block: "B", at: [5000, 0] }],
      }),
    );
    const { svg } = renderSvg(d);
    // A closed outline carries its own handle and is marked fillable.
    expect(svg).toMatch(/<path d="M0 0L1000 0L1000 -500L0 -500Z"[^>]* data-h="P1" data-z=""/);
    // A shape inside a block is picked by the insert that placed it, as `highlight` picks it.
    expect(svg).toMatch(/<path d="M5000 0L5100 0"[^>]* data-h="I9 L1"\/>/);
    // Tagging changes nothing else: nothing is picked until something is asked for.
    expect(svg).not.toContain('stroke="#4a7722"');
  });

  it("in compact form, keeps only pickable shapes as elements and merges the rest", () => {
    const d = parseDxf(
      writeDxf({
        insunits: MM,
        blocks: [{ name: "B", shapes: [{ type: "LINE", layer: "A", handle: "L1", from: [0, 0], to: [100, 0] }] }],
        entities: [
          rect("A", 0, 0, 1000, 500, "P1"),
          { type: "LINE", layer: "A", handle: "X1", from: [0.123456, 0], to: [10, 0] },
          { type: "LINE", layer: "A", handle: "X2", from: [0, 2000], to: [10, 2000] },
          { type: "INSERT", layer: "A", handle: "I9", block: "B", at: [5000, 0] },
        ],
      }),
    );
    const { svg } = renderSvg(d, { pickable: new Set(["P1", "I9"]), width: 1400 });
    // The pickable outline and the insert keep their own elements and tags…
    expect(svg).toMatch(/<path d="M0 0L1000 0L1000-500L0-500Z" data-h="P1" data-z=""\/>/);
    expect(svg).toMatch(/<path d="M5000 0L5100 0" data-h="I9"\/>/);
    // …and the two loose lines are one path with no tag of their own, rounded to a tenth of a pixel:
    // 5 406 units across 1 400 px is 0,39 a tenth, so one decimal place – 0,123456 is drawn at 0,1.
    expect(svg).toContain('<path d="M0.1 0L10 0M0-2000L10-2000"/>');
    expect(svg).not.toContain("X1");
    expect(svg.match(/<path /g)).toHaveLength(3);
    // The plain linework's attributes are said once, on the group, not on every shape.
    expect(svg.match(/stroke="#838c99"/g)).toHaveLength(1);
  });

  it("in compact form, still picks out what is highlighted", () => {
    const d = parseDxf(writeDxf({ insunits: MM, entities: [rect("A", 0, 0, 1000, 500, "P1"), rect("A", 2000, 0, 1000, 500, "P2")] }));
    const { svg } = renderSvg(d, { pickable: new Set(["P1", "P2"]), highlight: ["P2"] });
    expect(svg.match(/stroke="#4a7722"/g)).toHaveLength(1);
    expect(svg).toContain('d="M2000 0L3000 0L3000-500L2000-500Z" fill="#8dc63f"');
  });

  it("escapes a handle, and leaves off one that could not be a single token", () => {
    const d = parseDxf(writeDxf({ insunits: MM, entities: [rect("A", 0, 0, 10, 10, 'a"b'), rect("A", 20, 0, 10, 10, "c d")] }));
    const { svg } = renderSvg(d);
    expect(svg).toContain('data-h="a&quot;b"');
    expect(svg).not.toContain("c d");
  });

  it("escapes drawing text so a label cannot break the picture", () => {
    const d = parseDxf(writeDxf({ insunits: MM, entities: [{ type: "TEXT", layer: "A", at: [0, 0], height: 10, text: "<script>&" }] }));
    expect(renderSvg(d).svg).toContain("&lt;script&gt;&amp;");
  });
});
