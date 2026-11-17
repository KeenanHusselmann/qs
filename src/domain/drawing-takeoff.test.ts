import { describe, expect, it } from "vitest";

import { checkTakeoff, quoteCarries, quoteNames, readFigure, type ProposedParameter } from "@/domain/drawing-takeoff";
import { evaluate, parseExpression, toNumeric } from "@/domain/measure-expression";

const DRAWING = [
  "Electrical Servitude Total Area Distance : North B/M Boundary wall = 105,40 mNorth West B/M Boundary Wall = 292,69mNorth B/M Boundary wall = 92,96 m Total Perimeter Distance = 491.05m",
  "3000300030003000300015000 730 690730460500500 2500 500 2500",
  "WALL HEIGHT =2500MM ABOVE LOCAL NGL , UNLESS OTHERWISE INDICATED .",
].join("\n");
const locate = (quote: string) => (DRAWING.replace(/\s+/g, " ").includes(quote.replace(/\s+/g, " ")) ? { documentId: "dwg", page: 1 } : null);

const read = (name: string, figure: string, unit: string, quote: string, label = name): ProposedParameter => ({ name, label, figure, unit, quote, expression: null, assumption: null });
const derived = (name: string, expression: string, unit = "m"): ProposedParameter => ({ name, label: name, figure: null, unit, quote: null, expression, assumption: null });

describe("measurement expressions", () => {
  it("evaluates the working a QS would write", () => {
    const p = parseExpression("floor(L / c) + 1");
    expect(p.ok).toBe(true);
    const v = evaluate((p as { ok: true; expr: never }).expr, new Map([["L", 105.4], ["c", 3]]));
    expect(v).toEqual({ ok: true, value: 36 });
  });

  it("does not let a float's 97.99999 become 97 piers", () => {
    const p = parseExpression("floor(L / c)");
    const v = evaluate((p as { ok: true; expr: never }).expr, new Map([["L", 0.3 * 3], ["c", 0.3]]));
    expect(v).toEqual({ ok: true, value: 3 });
  });

  it("refuses anything outside the grammar", () => {
    expect(parseExpression("process.exit(1)").ok).toBe(false);
    expect(parseExpression("sqrt(4)").ok).toBe(false);
    expect(parseExpression("(1 + 2").ok).toBe(false);
  });

  it("writes four places, half away from nought", () => {
    expect(toNumeric(1003.4)).toBe("1003.4000");
    expect(toNumeric(0.00005)).toBe("0.0001");
    expect(toNumeric(79.79745)).toBe("79.7975");
  });
});

describe("reading a printed figure", () => {
  it("reads the drawing's own separators", () => {
    expect(readFigure("292,69")).toBe(292.69);
    expect(readFigure("2 500")).toBe(2500);
    expect(readFigure("491.05")).toBe(491.05);
  });

  it("refuses a figure that could be a thousand times off", () => {
    expect(readFigure("1,250")).toBeNull();
  });

  it("finds a figure inside a run-together dimension string", () => {
    expect(quoteCarries("3000300030003000300015000", "3000")).toBe(true);
    expect(quoteCarries("WALL HEIGHT =2500MM ABOVE LOCAL NGL", "2 500")).toBe(true);
    expect(quoteCarries("WALL HEIGHT =2500MM ABOVE LOCAL NGL", "2 400")).toBe(false);
  });

  it("finds the same length in the other unit", () => {
    expect(quoteCarries("BRICK FORCE IN 2 COURSES ABOVE AND BELOW @+/- 6M SPACING", "6000", "mm")).toBe(true);
    expect(quoteCarries("10mm WIDE MOVEMENT JOINTS @ MAX. 6000mm CENTRES", "6", "m")).toBe(true);
    expect(quoteCarries("BRICK FORCE IN 2 COURSES ABOVE AND BELOW @+/- 6M SPACING", "5000", "mm")).toBe(false);
  });
});

describe("whether a quote names its figure", () => {
  it("takes a labelled figure, or a bare dimension string, as read", () => {
    expect(quoteNames("Wall height", "WALL HEIGHT =2500MM ABOVE LOCAL NGL")).toBe(true);
    expect(quoteNames("Pier centres", "3000300030003000300015000")).toBe(true);
  });

  it("does not take another element's figure as this one", () => {
    expect(quoteNames("Footing depth", "300 X 200 STORMWATER OPENING , BRICK FORCE IN 2")).toBe(false);
  });
});

describe("checking a take-off from drawings", () => {
  const parameters: ProposedParameter[] = [
    read("L_G1G2", "105,40", "m", "North B/M Boundary wall = 105,40 m", "Boundary wall length G1–G2"),
    read("L_NW", "292,69", "m", "North West B/M Boundary Wall = 292,69m", "North West wall length"),
    read("L_N", "92,96", "m", "North B/M Boundary wall = 92,96 m", "North wall length"),
    read("centres", "3000", "mm", "3000300030003000300015000"),
    read("pier_along", "500", "mm", "690730460500500 2500 500 2500"),
    read("height", "2500", "mm", "WALL HEIGHT =2500MM ABOVE LOCAL NGL", "Wall height"),
    derived("piers", "floor(L_G1G2 / centres) + 1 + floor(L_NW / centres) + 1 + floor(L_N / centres) + 1 - 2", "no"),
    derived("panels", "L_G1G2 + L_NW + L_N - piers * pier_along"),
    { name: "trench", label: "Trench depth", figure: "1000", unit: "mm", quote: null, expression: null, assumption: "Foundations are to the engineer's details; 1 000 mm is a typical strip-footing depth." },
  ];

  it("measures the Marshall Dam wall as it was measured by hand", () => {
    const out = checkTakeoff(
      {
        parameters,
        items: [
          { section: "Masonry", description: "One-brick walling above ground", unit: "m2", lines: [{ location: "Panels", times: null, dimensions: ["panels", "height"], deduct: false }] },
          { section: "Masonry", description: "Piers", unit: "no", lines: [{ location: null, times: "piers", dimensions: [], deduct: false }] },
          { section: "Earthworks", description: "Excavate trenches", unit: "m", lines: [{ location: null, times: null, dimensions: ["panels"], deduct: false }] },
          { section: "Earthworks", description: "Trench depth-dependent item", unit: "m2", lines: [{ location: null, times: null, dimensions: ["panels", "trench"], deduct: false }] },
        ],
      },
      locate,
    );
    expect(out.refused).toEqual([]);
    const piers = out.parameters.find((p) => p.name === "piers")!;
    expect(piers.value).toBe(163);
    expect(out.parameters.find((p) => p.name === "height")!.value).toBe(2.5);
    expect(out.items[0]!.lines[0]).toMatchObject({ timesing: "1.0000", dimensions: ["409.5500", "2.5000"], working: "1 × panels × height" });
    expect(out.items[1]!.lines[0]!.timesing).toBe("163.0000");
    expect(out.items[0]!.assumptions).toEqual([]);
    expect(out.items[3]!.assumptions).toEqual(["trench"]);
    expect(out.parameters.find((p) => p.name === "trench")!.status).toBe("assumed");
  });

  it("refuses a figure the drawings do not print, and every line that used it", () => {
    const out = checkTakeoff(
      {
        parameters: [...parameters, read("coping_w", "330", "mm", "50MM CONCRETE PRECAST CAP 330 wide")],
        items: [{ section: null, description: "Coping", unit: "m2", lines: [{ location: null, times: null, dimensions: ["panels", "coping_w"], deduct: false }] }],
      },
      locate,
    );
    expect(out.refused.map((r) => r.what)).toEqual(["coping_w", "Coping – line 1", "Coping"]);
    expect(out.items).toEqual([]);
  });

  it("keeps a figure quoted from another element, as an assumption to confirm", () => {
    const out = checkTakeoff(
      {
        parameters: [...parameters, { name: "footing_d", label: "Footing depth", figure: "200", unit: "mm", quote: "300 X 200 STORMWATER OPENING", expression: null, assumption: null }],
        items: [{ section: null, description: "Footing", unit: "m3", lines: [{ location: null, times: null, dimensions: ["panels", "pier_along", "footing_d"], deduct: false }] }],
      },
      (q) => (q.includes("STORMWATER") ? { documentId: "dwg", page: 2 } : locate(q)),
    );
    const f = out.parameters.find((p) => p.name === "footing_d")!;
    expect(f.status).toBe("assumed");
    expect(f.assumption).toMatch(/Confirm it is the footing depth/);
    expect(out.items[0]!.assumptions).toEqual(["footing_d"]);
  });

  it("refuses a figure typed into the working instead of read", () => {
    const out = checkTakeoff({ parameters, items: [{ section: null, description: "Wall", unit: "m2", lines: [{ location: null, times: null, dimensions: ["panels", "2.45"], deduct: false }] }] }, locate);
    expect(out.refused[0]!.reason).toMatch(/2.45 is written into/);
  });

  it("refuses a line with the wrong number of dimensions for its unit", () => {
    const out = checkTakeoff({ parameters, items: [{ section: null, description: "Wall", unit: "m2", lines: [{ location: null, times: null, dimensions: ["panels"], deduct: false }] }] }, locate);
    expect(out.refused[0]!.reason).toBe("1 dimension for an item in m2.");
  });
});
