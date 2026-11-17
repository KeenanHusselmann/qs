/**
 * Write the sample concept layout the CAD reader is demonstrated on.
 *
 *     npx tsx scripts/make-cad-fixture.mts
 *
 * ── Why a generated drawing ────────────────────────────────────────────────────────────────
 *
 * The repository holds no real DXF, and a client's drawing must not be committed. This is an
 * invented scheme whose every figure was worked by hand first, so the reader can be watched
 * producing answers somebody already knows:
 *
 * | Outline | Layer | Hand-worked |
 * |---|---|---|
 * | Site | A-SITE | 60 × 40 m = 2 400 m² |
 * | Block A footprint | A-FOOTPRINT | 39 × 9 m = 351 m² |
 * | Clubhouse, less its courtyard | A-CLUB | 12 × 8 − 4 × 3 = 84 m² net |
 * | Store, four walls and a bay drawn as loose lines | A-WALL | 5 × 4 + π·2²/2 = 26,2832 m² |
 * | Unit A, inserted 4 times | block UNIT-A | 6 × 9 = 54 m² each, 216 m² |
 * | Unit B, inserted 2 times | block UNIT-B | 7,5 × 9 = 67,5 m² each, 135 m² |
 *
 * Units A and B together are 351 m², the footprint – a second cross-check a QS would make.
 *
 * **One label is wrong on purpose.** Unit B is printed "65,0 m²"; it measures 67,5. A reader that
 * agrees with every label it is shown has not been tested. The fence is left open (a 2 m gate) and
 * a hatch is included, so the report's "not measured" and "not read" sections have something in
 * them. Re-running produces the same bytes.
 */

import { mkdirSync, writeFileSync } from "node:fs";

import { rect, writeDxf, type DxfShape } from "../src/domain/cad/write-dxf";

const unit = (name: string, w: number, label: string): { name: string; shapes: DxfShape[] } => ({
  name,
  shapes: [rect("A-UNIT", 0, 0, w, 9000, `${name}-OUTLINE`), { type: "TEXT", layer: "A-TEXT", at: [600, 4200], height: 450, text: label }],
});

const unitsAlongBlockA: DxfShape[] = [
  ...[10_000, 16_000, 22_000, 28_000].map((x, i): DxfShape => ({ type: "INSERT", layer: "A-UNITS", handle: `UA${i + 1}`, block: "UNIT-A", at: [x, 25_000] })),
  ...[34_000, 41_500].map((x, i): DxfShape => ({ type: "INSERT", layer: "A-UNITS", handle: `UB${i + 1}`, block: "UNIT-B", at: [x, 25_000] })),
];

const dxf = writeDxf({
  insunits: 4,
  layers: ["A-SITE", "A-FOOTPRINT", "A-UNITS", "A-UNIT", "A-CLUB", "A-WALL", "A-FENCE", "A-TEXT", "A-HATCH"],
  blocks: [unit("UNIT-A", 6000, "UNIT A\\P54,0 m²"), unit("UNIT-B", 7500, "UNIT B\\P65,0 m²")],
  entities: [
    rect("A-SITE", 0, 0, 60_000, 40_000, "SITE"),
    { type: "TEXT", layer: "A-TEXT", handle: "T-SITE", at: [1_000, 38_000], height: 700, text: "SITE  2 400 m²" },

    rect("A-FOOTPRINT", 10_000, 25_000, 39_000, 9_000, "FOOTPRINT"),
    { type: "TEXT", layer: "A-TEXT", handle: "T-GFA", at: [10_500, 33_100], height: 600, text: "BLOCK A  GFA 351,0 m²" },
    ...unitsAlongBlockA,

    rect("A-CLUB", 8_000, 4_000, 12_000, 8_000, "CLUB"),
    rect("A-CLUB", 14_000, 6_500, 4_000, 3_000, "CLUB-COURT"),
    { type: "TEXT", layer: "A-TEXT", handle: "T-CLUB", at: [8_600, 10_500], height: 500, text: "CLUBHOUSE 84 m²" },

    { type: "LINE", layer: "A-WALL", handle: "W1", from: [30_000, 5_000], to: [35_000, 5_000] },
    { type: "LINE", layer: "A-WALL", handle: "W2", from: [35_000, 9_000], to: [35_000, 5_000] },
    { type: "LINE", layer: "A-WALL", handle: "W3", from: [35_000, 9_000], to: [30_000, 9_000] },
    { type: "ARC", layer: "A-WALL", handle: "W4", center: [30_000, 7_000], radius: 2_000, start: 90, end: 270 },
    { type: "TEXT", layer: "A-TEXT", handle: "T-STORE", at: [30_600, 6_800], height: 400, text: "STORE 26,3 m²" },

    { type: "LINE", layer: "A-FENCE", handle: "F1", from: [50_000, 2_000], to: [58_000, 2_000] },
    { type: "LINE", layer: "A-FENCE", handle: "F2", from: [58_000, 2_000], to: [58_000, 12_000] },
    { type: "LINE", layer: "A-FENCE", handle: "F3", from: [58_000, 12_000], to: [50_000, 12_000] },
    { type: "LINE", layer: "A-FENCE", handle: "F4", from: [50_000, 12_000], to: [50_000, 4_000] },

    { type: "RAW", lines: [0, "HATCH", 5, "H1", 8, "A-HATCH"] },
  ],
});

mkdirSync("fixtures/cad", { recursive: true });
writeFileSync("fixtures/cad/concept-layout.dxf", dxf);
console.log(`fixtures/cad/concept-layout.dxf  ${dxf.length} bytes`);
